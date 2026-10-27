import { describe, expect, it, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/**
 * Le hook remplace `useReducedMotion()` de framer-motion, retiré du projet.
 * On vérifie les comportements qui comptent en atelier : lecture initiale,
 * écoute à chaud, nettoyage au démontage, absence de `matchMedia`, et le repli
 * sur l'API obsolète des WebView Android anciennes.
 *
 * Le projet n'installe pas `@testing-library/react` : on monte donc un composant
 * réel avec `createRoot`, comme le font déjà les autres tests d'interface.
 */

type Ecouteur = (evenement: MediaQueryListEvent) => void

interface FauxMedia {
  requete: {
    matches: boolean
    media: string
    addEventListener?: ReturnType<typeof vi.fn>
    removeEventListener?: ReturnType<typeof vi.fn>
    addListener?: ReturnType<typeof vi.fn>
    removeListener?: ReturnType<typeof vi.fn>
    dispatchEvent: ReturnType<typeof vi.fn>
    onchange: null
  }
  ecouteurs: Set<Ecouteur>
}

function installerMatchMedia(
  correspondInitialement: boolean,
  options: { apiModerne?: boolean } = {},
): FauxMedia {
  const { apiModerne = true } = options
  const ecouteurs = new Set<Ecouteur>()

  const requete: FauxMedia['requete'] = {
    matches: correspondInitialement,
    media: '(prefers-reduced-motion: reduce)',
    dispatchEvent: vi.fn(),
    onchange: null,
  }

  if (apiModerne) {
    requete.addEventListener = vi.fn((_: string, ecouteur: Ecouteur) => ecouteurs.add(ecouteur))
    requete.removeEventListener = vi.fn((_: string, ecouteur: Ecouteur) => ecouteurs.delete(ecouteur))
  } else {
    // WebView Android < 14 : seule l'API obsolète existe.
    requete.addListener = vi.fn((ecouteur: Ecouteur) => ecouteurs.add(ecouteur))
    requete.removeListener = vi.fn((ecouteur: Ecouteur) => ecouteurs.delete(ecouteur))
  }

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn(() => requete),
  })

  return { requete, ecouteurs }
}

/** Monte un composant qui rend la valeur du hook dans un texte. */
async function monterHook(): Promise<{ conteneur: HTMLDivElement; root: Root; valeur: () => boolean }> {
  const conteneur = document.createElement('div')
  document.body.appendChild(conteneur)

  function Sonde() {
    const reduit = usePrefersReducedMotion()
    return createElement('span', { 'data-testid': 'valeur' }, String(reduit))
  }

  const root = createRoot(conteneur)
  await act(async () => {
    root.render(createElement(Sonde))
  })

  return {
    conteneur,
    root,
    valeur: () => {
      const texte = conteneur.textContent ?? ''
      return texte === 'true'
    },
  }
}

describe('usePrefersReducedMotion', () => {
  const matchMediaOriginal = window.matchMedia

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: matchMediaOriginal,
    })
    document.body.innerHTML = ''
  })

  it('lit la préférence dès le premier rendu, sans flash animé', async () => {
    installerMatchMedia(true)

    const { root, valeur } = await monterHook()

    expect(valeur()).toBe(true)

    await act(async () => root.unmount())
  })

  it('suit un changement de préférence système pendant la session', async () => {
    const media = installerMatchMedia(false)

    const { root, valeur } = await monterHook()
    expect(valeur()).toBe(false)

    await act(async () => {
      media.requete.matches = true
      for (const ecouteur of media.ecouteurs) {
        ecouteur({ matches: true } as MediaQueryListEvent)
      }
    })
    expect(valeur()).toBe(true)

    await act(async () => {
      media.requete.matches = false
      for (const ecouteur of media.ecouteurs) {
        ecouteur({ matches: false } as MediaQueryListEvent)
      }
    })
    expect(valeur()).toBe(false)

    await act(async () => root.unmount())
  })

  it('retire son écouteur au démontage (pas de fuite entre écrans)', async () => {
    const media = installerMatchMedia(false)

    const { root } = await monterHook()
    expect(media.ecouteurs.size).toBe(1)

    await act(async () => root.unmount())
    expect(media.ecouteurs.size).toBe(0)
  })

  it('ne casse pas le rendu quand matchMedia est absent', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    })

    const { root, valeur } = await monterHook()

    // Sans information, on conserve l'animation plutôt que de bloquer l'écran.
    expect(valeur()).toBe(false)

    await act(async () => root.unmount())
  })

  it('utilise addListener quand addEventListener est indisponible', async () => {
    const media = installerMatchMedia(false, { apiModerne: false })

    const { root } = await monterHook()

    expect(media.requete.addListener).toHaveBeenCalledTimes(1)
    expect(media.ecouteurs.size).toBe(1)

    await act(async () => root.unmount())
    expect(media.requete.removeListener).toHaveBeenCalledTimes(1)
    expect(media.ecouteurs.size).toBe(0)
  })
})
