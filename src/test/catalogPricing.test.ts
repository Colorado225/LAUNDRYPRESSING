import { describe, expect, it } from 'vitest'
import { calculerTarif, libelleUnite } from '@/lib/catalogPricing'

describe('calculerTarif', () => {
  it('calcule une ligne simple à la pièce', () => {
    expect(calculerTarif({ quantite: 3, prixUnitaire: 1500, unite: 'PIECE' })).toEqual({
      quantiteMesuree: 3,
      quantiteFacturee: 3,
      prixUnitaire: 1500,
      total: 4500,
    })
  })

  it('arrondit le poids vers le haut à l’incrément configuré', () => {
    expect(
      calculerTarif({
        quantite: 6.4,
        prixUnitaire: 1500,
        unite: 'KG',
        increment: 0.5,
      }),
    ).toEqual({ quantiteMesuree: 6.4, quantiteFacturee: 6.5, prixUnitaire: 1500, total: 9750 })
  })

  it('applique la quantité minimale avant l’incrément', () => {
    expect(
      calculerTarif({
        quantite: 0.8,
        prixUnitaire: 500,
        unite: 'METER',
        quantiteMinimum: 2,
        increment: 0.5,
      }).quantiteFacturee,
    ).toBe(2)
  })

  it('applique un minimum de facturation au total', () => {
    expect(
      calculerTarif({
        quantite: 1,
        prixUnitaire: 300,
        unite: 'FLAT',
        minimumFacturable: 500,
      }).total,
    ).toBe(500)
  })

  it('arrondit le montant au FCFA le plus proche', () => {
    expect(calculerTarif({ quantite: 1.5, prixUnitaire: 101, unite: 'KG' }).total).toBe(152)
  })

  it.each([
    { quantite: 0, prixUnitaire: 100, unite: 'KG' as const },
    { quantite: 1.25, prixUnitaire: 100, unite: 'PIECE' as const },
    { quantite: 2, prixUnitaire: 100, unite: 'FLAT' as const },
  ])('refuse les quantités incompatibles ($unite)', (input) => {
    expect(() => calculerTarif(input)).toThrow()
  })

  it('nomme les unités en français', () => {
    expect(libelleUnite('KG')).toBe('kg')
    expect(libelleUnite('M2')).toBe('m²')
    expect(libelleUnite('PIECE')).toBe('pièce')
  })
})
