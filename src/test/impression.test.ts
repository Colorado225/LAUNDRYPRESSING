import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLASSE_IMPRESSION,
  STYLE_IMPRESSION_ID,
  feuilleDeStyleImpression,
  imprimerDocument,
} from '@/lib/impression'

/**
 * Impression des documents.
 *
 * Le point fragile : la taille du papier (`@page`) ne peut pas dépendre d'une
 * classe du DOM. Si la feuille injectée à l'impression ne passait pas, la
 * facture sortirait en 80 mm — ou l'étiquette en A4. Ces tests figent les deux
 * règles et le nettoyage après impression.
 */

afterEach(() => {
  document.body.className = ''
  document.getElementById(STYLE_IMPRESSION_ID)?.remove()
  vi.restoreAllMocks()
})

describe('feuilleDeStyleImpression', () => {
  it('impose une page A4 pour la facture', () => {
    const css = feuilleDeStyleImpression('A4')
    expect(css).toContain('size: A4 portrait')
    expect(css).toContain('margin: 12mm')
  })

  it('conserve le rouleau 80 mm pour l’étiquette', () => {
    const css = feuilleDeStyleImpression('etiquette')
    expect(css).toContain('size: 80mm auto')
    expect(css).toContain('margin: 0')
  })

  it('masque l’application et n’imprime que le document', () => {
    for (const format of ['A4', 'etiquette'] as const) {
      const css = feuilleDeStyleImpression(format)
      expect(css).toContain(`body.${CLASSE_IMPRESSION} #root { display: none !important; }`)
      expect(css).toContain(`body.${CLASSE_IMPRESSION} #print-root { display: block !important; }`)
    }
  })
})

describe('imprimerDocument', () => {
  it('injecte la feuille A4 et pose la classe sur le body', () => {
    const imprimante = vi.fn()
    vi.spyOn(window, 'print').mockImplementation(imprimante)

    imprimerDocument({ format: 'A4' })

    expect(imprimante).toHaveBeenCalledTimes(1)
    expect(document.body.classList.contains(CLASSE_IMPRESSION)).toBe(true)
    const style = document.getElementById(STYLE_IMPRESSION_ID)
    expect(style?.textContent).toContain('size: A4 portrait')
  })

  it('n’empile pas deux feuilles si l’on imprime deux fois', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined)
    imprimerDocument({ format: 'A4' })
    imprimerDocument({ format: 'A4' })
    expect(document.querySelectorAll(`#${STYLE_IMPRESSION_ID}`)).toHaveLength(1)
  })

  it('nettoie la classe après `afterprint`', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined)
    imprimerDocument({ format: 'A4' })

    window.dispatchEvent(new Event('afterprint'))

    expect(document.body.classList.contains(CLASSE_IMPRESSION)).toBe(false)
    expect(document.getElementById(STYLE_IMPRESSION_ID)).toBeNull()
  })
})
