import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Montage de la page d'authentification.
 *
 * Deux modes sont exercés : configuration Supabase complète (onglets Connexion
 * et Création de compte) et configuration absente (mode démonstration). Le but
 * n'est pas de simuler un navigateur complet, mais de vérifier qu'un
 * utilisateur voit bien les deux chemins et que la validation bloque l'envoi.
 */

const etatEnv = { mode: 'ok' as 'ok' | 'demo' }

vi.mock('@/lib/env', () => ({
  get supabaseConfigState() {
    return etatEnv.mode
  },
  get missingSupabaseEnvVars() {
    return etatEnv.mode === 'demo' ? ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] : []
  },
  DEMO_TENANT_ID: null,
  isSupabaseConfigured: true,
}))

// Aucun appel réseau ne doit partir d'un simple rendu.
vi.mock('@/services/authService', () => ({
  AuthError: class AuthError extends Error {},
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
}))

const { default: Login } = await import('@/pages/Login')

let racine: Root
let hote: HTMLDivElement

async function monter() {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(<Login onAuthenticated={() => undefined} />)
  })
}

function demonter() {
  act(() => racine.unmount())
  hote.remove()
}

function cliquer(libelle: string) {
  const bouton = [...hote.querySelectorAll('button')].find(
    (element) => (element.textContent ?? '').trim() === libelle,
  )
  if (!bouton) throw new Error(`Bouton « ${libelle} » introuvable`)
  act(() => bouton.click())
}

beforeEach(() => {
  etatEnv.mode = 'ok'
})

describe('page de connexion', () => {
  it('affiche les deux onglets et le formulaire de connexion', async () => {
    await monter()
    const texte = hote.textContent ?? ''

    expect(texte).toContain('Se connecter')
    expect(texte).toContain('Créer un compte')
    expect(texte).toContain('Mot de passe oublié ?')
    expect(hote.querySelector('#email')).not.toBeNull()
    expect(hote.querySelector('#signup-email')).toBeNull()

    demonter()
  })

  it('bascule vers le formulaire d’inscription', async () => {
    await monter()
    cliquer('Créer un compte')

    const texte = hote.textContent ?? ''
    expect(texte).toContain('Nom du pressing')
    expect(texte).toContain('Téléphone du pressing')
    expect(texte).toContain('Confirmer le mot de passe')
    expect(texte).toContain('essai de 14 jours')
    expect(hote.querySelector('#signup-email')).not.toBeNull()

    demonter()
  })

  it('refuse l’envoi d’un formulaire d’inscription incomplet', async () => {
    await monter()
    cliquer('Créer un compte')

    const formulaire = hote.querySelector('form')
    act(() => {
      formulaire?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    const texte = hote.textContent ?? ''
    expect(texte).toContain('Corrigez les champs signalés pour continuer.')
    expect(texte).toContain('Indiquez une adresse e-mail valide')

    demonter()
  })

  it('bascule en mode démonstration quand Supabase n’est pas configuré', async () => {
    etatEnv.mode = 'demo'
    await monter()

    const texte = hote.textContent ?? ''
    expect(texte).toContain('Mode démonstration')
    expect(texte).toContain('Identifiant du pressing (UUID)')
    expect(hote.querySelector('#signup-email')).toBeNull()

    demonter()
  })
})
