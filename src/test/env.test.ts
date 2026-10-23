import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests de l'état de configuration lu par l'interface.
 *
 * `src/lib/env.ts` ne lit `import.meta.env` qu'une fois, à l'import. Chaque cas
 * réinitialise donc le registre de modules puis réimporte le module.
 */

async function loadEnvModule(values: Record<string, string>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value)
  }
  return import('@/lib/env')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('supabaseConfigState', () => {
  it('vaut « ok » quand l’URL et la clé publique sont présentes', async () => {
    const env = await loadEnvModule({
      VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'cle-publique-de-test-0123456789',
    })

    expect(env.supabaseConfigState).toBe('ok')
    expect(env.isSupabaseConfigured).toBe(true)
    expect(env.missingSupabaseEnvVars).toEqual([])
  })

  it('vaut « demo » quand aucune des deux n’est renseignée', async () => {
    const env = await loadEnvModule({
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    })

    expect(env.supabaseConfigState).toBe('demo')
    expect(env.isSupabaseConfigured).toBe(false)
    expect(env.missingSupabaseEnvVars).toHaveLength(2)
  })

  it('vaut « incomplete » quand seule l’URL est renseignée', async () => {
    const env = await loadEnvModule({
      VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
      VITE_SUPABASE_ANON_KEY: '',
    })

    // Le point clé : on ne retombe PAS en mode démonstration, qui laisserait
    // saisir un UUID de pressing à la place d'un e-mail.
    expect(env.supabaseConfigState).toBe('incomplete')
    expect(env.missingSupabaseEnvVars).toEqual(['VITE_SUPABASE_ANON_KEY'])
  })

  it('vaut « incomplete » quand seule la clé publique est renseignée', async () => {
    const env = await loadEnvModule({
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: 'cle-publique-de-test-0123456789',
    })

    expect(env.supabaseConfigState).toBe('incomplete')
    expect(env.missingSupabaseEnvVars).toEqual(['VITE_SUPABASE_URL'])
  })

  it('ignore les valeurs faites uniquement d’espaces', async () => {
    const env = await loadEnvModule({
      VITE_SUPABASE_URL: '   ',
      VITE_SUPABASE_ANON_KEY: '   ',
    })

    expect(env.supabaseConfigState).toBe('demo')
  })
})

describe('maskSupabaseUrl', () => {
  it('ne conserve que l’origine', async () => {
    const env = await loadEnvModule({})

    expect(env.maskSupabaseUrl('https://abcdefghijklmnop.supabase.co/rest/v1/orders')).toBe(
      'https://abcdefghijklmnop.supabase.co',
    )
  })

  it('retourne un tiret pour une valeur illisible', async () => {
    const env = await loadEnvModule({})

    expect(env.maskSupabaseUrl('pas une url')).toBe('—')
  })
})
