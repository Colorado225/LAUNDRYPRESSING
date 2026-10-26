import { describe, expect, it } from 'vitest'
import {
  calculerPrixKilo,
  formaterDetailKilo,
  poidsFacture,
  problemeTranches,
  type RegleKilo,
  type TrancheKilo,
} from '@/lib/prixKilo'

/**
 * Moteur de tarification au kilo par tranches (spec §7-8, PRICE-002→006).
 * Miroir de `compute_weight_price` : les mêmes exemples doivent donner les
 * mêmes montants des deux côtés, sinon la caisse et le serveur divergent.
 */

const progressif: RegleKilo = {
  mode: 'progressive_tiers',
  minBillableKg: 0,
  stepKg: 0.1,
  rounding: 'exact',
}
const tranchesProgressives: TrancheKilo[] = [
  { minKg: 0, maxKg: 5, prixParKg: 700 },
  { minKg: 5, maxKg: 10, prixParKg: 600 },
  { minKg: 10, maxKg: null, prixParKg: 500 },
]

describe('calculerPrixKilo — exemples de la spec', () => {
  it('PRICE-002 : 5 kg progressif = 3 500 FCFA', () => {
    expect(calculerPrixKilo(progressif, tranchesProgressives, 5)?.montant).toBe(3500)
  })

  it('PRICE-004 : 12 kg progressif = 5×700 + 5×600 + 2×500 = 7 500 FCFA', () => {
    const devis = calculerPrixKilo(progressif, tranchesProgressives, 12)
    expect(devis?.montant).toBe(7500)
    expect(devis?.detail.map((d) => d.kg)).toEqual([5, 5, 2])
  })

  it('PRICE-003 : 12 kg en palier (tranche ≥ 10 kg à 600) = 7 200 FCFA', () => {
    const devis = calculerPrixKilo(
      { ...progressif, mode: 'flat_rate' },
      [
        { minKg: 0, maxKg: 10, prixParKg: 700 },
        { minKg: 10, maxKg: null, prixParKg: 600 },
      ],
      12,
    )
    expect(devis?.montant).toBe(7200)
  })

  it('refuse un poids absent ou négatif (PRICE-007)', () => {
    expect(calculerPrixKilo(progressif, tranchesProgressives, 0)).toBeNull()
    expect(calculerPrixKilo(progressif, tranchesProgressives, -2)).toBeNull()
  })

  it('retourne null si aucune tranche ne couvre le poids', () => {
    expect(
      calculerPrixKilo({ ...progressif, mode: 'flat_rate' }, [{ minKg: 0, maxKg: 5, prixParKg: 700 }], 9),
    ).toBeNull()
  })
})

describe('poidsFacture', () => {
  it('arrondit au pas supérieur en mode ceil', () => {
    expect(poidsFacture({ ...progressif, rounding: 'ceil', stepKg: 0.5 }, 12.1)).toBe(12.5)
    expect(poidsFacture({ ...progressif, rounding: 'ceil', stepKg: 0.5 }, 12)).toBe(12)
  })

  it('arrondit au plus proche en mode nearest', () => {
    expect(poidsFacture({ ...progressif, rounding: 'nearest', stepKg: 0.5 }, 12.2)).toBe(12)
    expect(poidsFacture({ ...progressif, rounding: 'nearest', stepKg: 0.5 }, 12.3)).toBe(12.5)
  })

  it('applique le minimum facturable', () => {
    expect(poidsFacture({ ...progressif, minBillableKg: 3 }, 1.2)).toBe(3)
  })
})

describe('problemeTranches', () => {
  it('accepte le jeu progressif de la spec', () => {
    expect(problemeTranches(tranchesProgressives)).toBeNull()
  })

  it('PRICE-006 : refuse les chevauchements', () => {
    expect(
      problemeTranches([
        { minKg: 0, maxKg: 6, prixParKg: 700 },
        { minKg: 5, maxKg: null, prixParKg: 500 },
      ]),
    ).toMatch(/chevauchent/)
  })

  it('refuse une première tranche qui ne démarre pas à 0', () => {
    expect(problemeTranches([{ minKg: 2, maxKg: null, prixParKg: 500 }])).toMatch(/0 kg/)
  })

  it('refuse un tarif nul ou négatif (PRICE-005)', () => {
    expect(problemeTranches([{ minKg: 0, maxKg: null, prixParKg: 0 }])).toMatch(/positif/)
  })
})

describe('formaterDetailKilo', () => {
  it('produit le résumé figé sur la ligne', () => {
    const devis = calculerPrixKilo(progressif, tranchesProgressives, 12)!
    expect(formaterDetailKilo(devis)).toBe('12 kg facturés — 5 kg × 700 + 5 kg × 600 + 2 kg × 500 FCFA/kg')
  })
})
