import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Connexion réservée à l'éditeur de la plateforme.
 *
 * Un administrateur invité dans Supabase Auth n'a pas besoin d'être inscrit
 * comme membre d'un pressing. Seul le RPC `is_platform_admin()` peut l'autoriser;
 * un compte client non rattaché reste refusé et sa session est fermée.
 */
const doublures = vi.hoisted(() => ({
  connexion: vi.fn(),
  session: vi.fn(),
  deconnexion: vi.fn(),
  rpc: vi.fn(),
  resoudreBoutique: vi.fn(),
  fixerDroitEditeur: vi.fn(),
}))

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    auth: {
      signInWithPassword: doublures.connexion,
      getSession: doublures.session,
      signOut: doublures.deconnexion,
    },
    rpc: doublures.rpc,
  }),
}))

vi.mock('@/lib/tenantContext', () => ({
  resolveTenantForUser: doublures.resoudreBoutique,
  useTenantStore: {
    getState: () => ({
      tenantId: null,
      tenantName: null,
      role: null,
      userId: null,
      isPlatformAdmin: false,
      setPlatformAdmin: doublures.fixerDroitEditeur,
    }),
  },
}))

const { restoreSession, signInWithPassword } = await import('@/services/authService')

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  doublures.session.mockResolvedValue({ data: { session: null }, error: null })
  doublures.connexion.mockResolvedValue({
    data: {
      user: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: 'durandobi634@gmail.com',
        user_metadata: {},
      },
    },
    error: null,
  })
  doublures.resoudreBoutique.mockResolvedValue(null)
  doublures.rpc.mockResolvedValue({ data: true, error: null })
  doublures.deconnexion.mockResolvedValue({ error: null })
})

describe('accès du super-administrateur', () => {
  it('ouvre la session éditeur sans créer ni exiger un pressing', async () => {
    const session = await signInWithPassword('durandobi634@gmail.com', 'mot-de-passe-factice')

    expect(session.membership).toBeNull()
    expect(session.isPlatformAdmin).toBe(true)
    expect(doublures.rpc).toHaveBeenCalledWith('is_platform_admin')
    expect(doublures.fixerDroitEditeur).toHaveBeenCalledWith(true)
    expect(doublures.deconnexion).not.toHaveBeenCalled()
  })

  it('refuse et ferme la session d’un compte sans pressing ni droit éditeur', async () => {
    doublures.rpc.mockResolvedValue({ data: false, error: null })

    await expect(
      signInWithPassword('client@pressing.ci', 'mot-de-passe-factice'),
    ).rejects.toMatchObject({ code: 'no_membership' })

    expect(doublures.deconnexion).toHaveBeenCalledOnce()
    expect(doublures.fixerDroitEditeur).not.toHaveBeenCalledWith(true)
  })

  it('refuse de se connecter comme éditeur si le contrôle serveur échoue', async () => {
    doublures.rpc.mockResolvedValue({ data: null, error: new Error('Panne serveur') })

    await expect(
      signInWithPassword('client@pressing.ci', 'mot-de-passe-factice'),
    ).rejects.toMatchObject({ code: 'no_membership' })

    expect(doublures.deconnexion).toHaveBeenCalledOnce()
  })

  it('restaure une session éditeur sans pressing après rechargement', async () => {
    doublures.session.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            email: 'durandobi634@gmail.com',
          },
        },
      },
      error: null,
    })

    const session = await restoreSession()

    expect(session).toMatchObject({ membership: null, isPlatformAdmin: true, fromCache: false })
    expect(doublures.rpc).toHaveBeenCalledWith('is_platform_admin')
  })
})
