import { describe, expect, it } from 'vitest'
import {
  calculerPrixForfait,
  formaterDetailForfait,
  problemeForfait,
  type ForfaitQuantite,
} from '@/lib/prixForfait'

/**
 * Moteur des forfaits au nombre de vêtements (BL-001→010), miroir de
 * `compute_package_price`. Les montants de la spec sont uniquement des
 * exemples de test : aucun prix n'est imposé aux pressings.
 */

const pack25: ForfaitQuantite = {
  prixXof: 2000,
  inclus: 25,
  politique: 'PER_EXTRA_ITEM',
  prixSupplementXof: 100,
}

describe('calculerPrixForfait — exemples BL', () => {
  it('BL-001/002 : 8 + 6 + 5 + 3 + 3 vêtements = 25, soit 2 000 FCFA', () => {
    const total = [8, 6, 5, 3, 3].reduce((somme, quantite) => somme + quantite, 0)
    expect(total).toBe(25)
    expect(calculerPrixForfait(pack25, total)?.montant).toBe(2000)
  })

  it('BL-004 : la répartition entre articles ne change pas le prix', () => {
    const premiere = [8, 6, 5, 3, 3].reduce((somme, quantite) => somme + quantite, 0)
    const seconde = [25].reduce((somme, quantite) => somme + quantite, 0)
    expect(calculerPrixForfait(pack25, premiere)?.montant).toBe(
      calculerPrixForfait(pack25, seconde)?.montant,
    )
  })

  it('BL-006 : PER_EXTRA_ITEM facture chaque vêtement au-delà des 25 inclus', () => {
    const devis = calculerPrixForfait(pack25, 30)
    expect(devis?.supplement).toBe(5)
    expect(devis?.montant).toBe(2500)
  })

  it('BL-006 : REPEAT_PACKAGE applique un second forfait à 30 vêtements', () => {
    const devis = calculerPrixForfait(
      { ...pack25, politique: 'REPEAT_PACKAGE', prixSupplementXof: null },
      30,
    )
    expect(devis?.nombreForfaits).toBe(2)
    expect(devis?.montant).toBe(4000)
  })

  it('BL-006 : REJECT_OVER_LIMIT refuse tout dépassement', () => {
    expect(
      calculerPrixForfait(
        { ...pack25, politique: 'REJECT_OVER_LIMIT', prixSupplementXof: null },
        26,
      ),
    ).toBeNull()
  })

  it('BL-007 : MANUAL_QUOTE exige un montant uniquement en dépassement', () => {
    const forfait = { ...pack25, politique: 'MANUAL_QUOTE' as const, prixSupplementXof: null }
    expect(calculerPrixForfait(forfait, 25)).toMatchObject({
      montant: 2000,
      manuelRequis: false,
    })
    expect(calculerPrixForfait(forfait, 30)).toMatchObject({
      montant: null,
      manuelRequis: true,
    })
    expect(calculerPrixForfait(forfait, 30, 2700)?.montant).toBe(2700)
    expect(calculerPrixForfait(forfait, 30, 0)).toBeNull()
  })

  it('BL-005 : refuse zéro, les nombres négatifs et non entiers', () => {
    expect(calculerPrixForfait(pack25, 0)).toBeNull()
    expect(calculerPrixForfait(pack25, -3)).toBeNull()
    expect(calculerPrixForfait(pack25, 12.5)).toBeNull()
  })

  it('conserve le prix global d’un ancien forfait sans nombre inclus', () => {
    expect(calculerPrixForfait({ ...pack25, inclus: null }, 42)?.montant).toBe(2000)
  })
})

describe('problemeForfait', () => {
  it('accepte le pack de la spec', () => {
    expect(problemeForfait(pack25)).toBeNull()
  })

  it('refuse un prix nul : un prix non configuré ne devient jamais zéro', () => {
    expect(problemeForfait({ ...pack25, prixXof: 0 })).toMatch(/positif/)
  })

  it('exige le prix du supplément pour PER_EXTRA_ITEM', () => {
    expect(problemeForfait({ ...pack25, prixSupplementXof: null })).toMatch(/supplémentaire/)
  })
})

describe('formaterDetailForfait', () => {
  it('BL-009 : affiche inclus et supplémentaires dans le résumé figé', () => {
    const devis = calculerPrixForfait(pack25, 30)!
    expect(formaterDetailForfait(devis)).toBe(
      '30 vêtement(s) compté(s) — 25 inclus + 5 × 100 FCFA',
    )
  })
})
