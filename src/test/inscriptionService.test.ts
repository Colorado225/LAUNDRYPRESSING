import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Inscription vue du service : ce qui part réellement vers Supabase.
 *
 * Le client est remplacé par un double qui enregistre les appels. Ce qui se
 * vérifie ici, ce sont les décisions qui coûtent cher si elles sont fausses :
 *  - ne pas créer de pressing quand la confirmation par e-mail est exigée
 *    (aucune session, donc aucun droit d'écrire) ;
 *  - reprendre une inscription interrompue sans recréer de compte ;
 *  - refuser une adresse déjà utilisée au lieu d'annoncer un faux succès.
 */

const appels: string[] = []

interface Etat {
  session: { user: { id: string; email: string } } | null
  signUp: { data: unknown; error: unknown }
  rpc: { data: unknown; error: unknown }
}

const etat: Etat = {
  session: null,
  signUp: { data: { user: null, session: null }, error: null },
  rpc: { data: 'tenant-cree', error: null },
}

const clientFactice = {
  auth: {
    getSession: async () => {
      appels.push('getSession')
      return { data: { session: etat.session } }
    },
    signUp: async (payload: { email: string }) => {
      appels.push(`signUp:${payload.email}`)
      return etat.signUp
    },
  },
  rpc: async (nom: string, args: Record<string, unknown>) => {
    appels.push(`rpc:${nom}:${JSON.stringify(args)}`)
    return etat.rpc
  },
  from: () => {
    appels.push('from')
    const chaine: Record<string, unknown> = {
      select: () => chaine,
      eq: () => chaine,
      order: async () => ({ data: [], error: null }),
      in: async () => ({ data: [], error: null }),
    }
    return chaine
  },
}

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => clientFactice }))

const { AuthError, createPressingForCurrentUser, signUpWithPassword } = await import(
  '@/services/authService'
)
const { useTenantStore } = await import('@/lib/tenantContext')

function utilisateur(id = 'user-1', email = 'patron@pressing.ci') {
  return { id, email, identities: [{ id: 'identite-1' }] }
}

beforeEach(() => {
  appels.length = 0
  etat.session = null
  etat.signUp = { data: { user: null, session: null }, error: null }
  etat.rpc = { data: 'tenant-cree', error: null }
  useTenantStore.setState({ tenantId: null, tenantName: null, role: null, shops: [] })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

const saisie = {
  email: 'Patron@Pressing.ci',
  motDePasse: 'lavage2026',
  nomPressing: 'Pressing Cocody',
  telephone: '07 07 07 07 07',
}

describe('signUpWithPassword', () => {
  it('crée le compte puis le pressing quand la session est ouverte', async () => {
    etat.signUp = {
      data: { user: utilisateur(), session: { user: utilisateur() } },
      error: null,
    }

    const resultat = await signUpWithPassword(saisie)

    expect(resultat.confirmationRequise).toBe(false)
    expect(resultat.tenantId).toBe('tenant-cree')
    // L'adresse est normalisée en minuscules : deux saisies différentes ne
    // doivent pas produire deux comptes.
    expect(appels).toContain('signUp:patron@pressing.ci')
    expect(appels.some((appel) => appel.startsWith('rpc:create_tenant_for_user'))).toBe(true)
  })

  it('n’appelle pas la création de pressing quand la confirmation e-mail est exigée', async () => {
    etat.signUp = { data: { user: utilisateur(), session: null }, error: null }

    const resultat = await signUpWithPassword(saisie)

    expect(resultat.confirmationRequise).toBe(true)
    expect(resultat.tenantId).toBeNull()
    expect(appels.some((appel) => appel.startsWith('rpc:'))).toBe(false)
  })

  it('refuse une adresse déjà utilisée au lieu d’annoncer un faux succès', async () => {
    etat.signUp = {
      data: { user: { ...utilisateur(), identities: [] }, session: null },
      error: null,
    }

    await expect(signUpWithPassword(saisie)).rejects.toMatchObject({
      code: 'email_deja_utilise',
    })
  })

  it('reprend une inscription interrompue sans recréer de compte', async () => {
    etat.session = { user: { id: 'user-9', email: 'patron@pressing.ci' } }

    const resultat = await signUpWithPassword(saisie)

    expect(appels).not.toContain('signUp:patron@pressing.ci')
    expect(resultat.tenantId).toBe('tenant-cree')
  })

  it('traduit une adresse déjà enregistrée côté Supabase', async () => {
    etat.signUp = {
      data: { user: null, session: null },
      error: { message: 'User already registered', status: 422 },
    }

    await expect(signUpWithPassword(saisie)).rejects.toBeInstanceOf(AuthError)
  })

  it('refuse de travailler hors ligne', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await expect(signUpWithPassword(saisie)).rejects.toMatchObject({ code: 'offline' })
  })
})

describe('createPressingForCurrentUser', () => {
  it('transmet le nom et le téléphone à la fonction serveur', async () => {
    const tenantId = await createPressingForCurrentUser('Pressing Cocody', '07 07 07 07 07')

    expect(tenantId).toBe('tenant-cree')
    expect(appels.at(-1)).toBe(
      'rpc:create_tenant_for_user:{"p_name":"Pressing Cocody","p_phone":"07 07 07 07 07"}',
    )
  })

  it('envoie `null` quand le téléphone est vide', async () => {
    await createPressingForCurrentUser('Pressing Cocody', '   ')
    expect(appels.at(-1)).toContain('"p_phone":null')
  })

  it('explique un compte déjà rattaché', async () => {
    etat.rpc = { data: null, error: { code: '23505', message: 'déjà rattaché' } }
    await expect(createPressingForCurrentUser('Pressing', '')).rejects.toMatchObject({
      code: 'deja_rattache',
    })
  })

  it('remonte une saisie refusée par le serveur', async () => {
    etat.rpc = { data: null, error: { code: '22023', message: 'nom trop court' } }
    await expect(createPressingForCurrentUser('X', '')).rejects.toMatchObject({
      code: 'saisie_invalide',
    })
  })

  it('signale une session perdue', async () => {
    etat.rpc = { data: null, error: { code: '42501', message: 'connexion requise' } }
    await expect(createPressingForCurrentUser('Pressing', '')).rejects.toMatchObject({
      code: 'session_perdue',
    })
  })

  it('refuse une réponse vide plutôt que de prétendre au succès', async () => {
    etat.rpc = { data: null, error: null }
    await expect(createPressingForCurrentUser('Pressing', '')).rejects.toMatchObject({
      code: 'pressing_refuse',
    })
  })
})
