import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

/**
 * Régression : « Maximum update depth exceeded ».
 *
 * La boucle observée en production venait du garde de première configuration :
 * `isTenantOnboardingComplete()` renvoie `null` hors ligne, et l'ancienne
 * version le traitait comme « configuration requise ». Chaque montage de
 * `/bienvenue` renvoyait donc vers lui-même indéfiniment.
 *
 * Ces tests vérifient que la navigation se stabilise dans les trois cas.
 */

const { etat, marquerComplete } = vi.hoisted(() => ({
  etat: { valeur: null as boolean | null },
  marquerComplete: vi.fn(),
}))

vi.mock('@/services/tenantServices', () => ({
  isTenantOnboardingComplete: vi.fn(async () => etat.valeur),
  completeTenantOnboarding: vi.fn(async () => undefined),
}))

vi.mock('@/lib/tenantContext', () => {
  const useTenantStore = (selecteur: (etat: { tenantId: string }) => unknown) =>
    selecteur({ tenantId: 'tenant-test' })
  useTenantStore.getState = () => ({ tenantId: 'tenant-test' })
  return { useTenantStore }
})

// Import après les mocks pour que le module utilise les versions simulées.
const { TenantOnboardingGate, TenantOnboardingProvider } = await import(
  '@/components/TenantOnboardingGate'
)

const { oublierOnboardingEnSession } = await import('@/lib/onboardingSession')

const { useTenantOnboarding } = await import('@/lib/tenantOnboarding')

/** Écran de configuration : se comporte comme `/bienvenue` en production. */
function EcranBienvenue() {
  const { markComplete } = useTenantOnboarding()
  return createElement(
    'button',
    {
      type: 'button',
      id: 'terminer',
      onClick: () => {
        marquerComplete()
        markComplete()
      },
    },
    'Terminer',
  )
}

function Emplacement() {
  const { pathname } = useLocation()
  return createElement('span', { id: 'chemin' }, pathname)
}

async function monter(cheminInitial: string) {
  const conteneur = document.createElement('div')
  document.body.appendChild(conteneur)

  const root: Root = createRoot(conteneur)
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [cheminInitial] },
        createElement(
          TenantOnboardingProvider,
          null,
          createElement(
            TenantOnboardingGate,
            null,
            createElement(Emplacement),
            createElement(
              Routes,
              null,
              createElement(Route, { path: '/bienvenue', element: createElement(EcranBienvenue) }),
              createElement(Route, { path: '/commandes', element: createElement('span', null, 'ok') }),
            ),
          ),
        ),
      ),
    )
  })
  // Laisse la promesse de vérification se résoudre.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

  return {
    root,
    chemin: () => conteneur.querySelector('#chemin')?.textContent ?? '',
    conteneur,
  }
}

describe('TenantOnboardingGate — pas de boucle de navigation', () => {
  let erreurOriginale: typeof console.error

  beforeEach(() => {
    erreurOriginale = console.error
    // Une boucle React émet « Maximum update depth exceeded » via console.error.
    console.error = vi.fn()
    marquerComplete.mockClear()
    // La mémoire de session est un singleton de module : on l'isole entre tests.
    oublierOnboardingEnSession()
  })

  afterEach(() => {
    console.error = erreurOriginale
    document.body.innerHTML = ''
  })

  it('hors ligne (`null`) : ne redirige pas vers /bienvenue', async () => {
    etat.valeur = null

    const { root, chemin } = await monter('/commandes')

    expect(chemin()).toBe('/commandes')
    expect(console.error).not.toHaveBeenCalled()

    await act(async () => root.unmount())
  })

  it('configuration terminée : reste sur la page demandée', async () => {
    etat.valeur = true

    const { root, chemin } = await monter('/commandes')

    expect(chemin()).toBe('/commandes')
    expect(console.error).not.toHaveBeenCalled()

    await act(async () => root.unmount())
  })

  it('configuration requise : redirige une seule fois vers /bienvenue', async () => {
    etat.valeur = false

    const { root, chemin } = await monter('/commandes')

    expect(chemin()).toBe('/bienvenue')

    // Le vrai symptôme de la boucle : une navigation par rendu successif.
    expect(console.error).not.toHaveBeenCalled()

    await act(async () => root.unmount())
  })

  it('après « terminer », reste sur /commandes sans revenir en arrière', async () => {
    etat.valeur = false

    const { root, chemin, conteneur } = await monter('/commandes')
    expect(chemin()).toBe('/bienvenue')

    const bouton = conteneur.querySelector<HTMLButtonElement>('#terminer')
    expect(bouton).not.toBeNull()

    await act(async () => {
      bouton?.click()
      await Promise.resolve()
    })

    expect(chemin()).toBe('/commandes')
    expect(console.error).not.toHaveBeenCalled()

    await act(async () => root.unmount())
  })
})
