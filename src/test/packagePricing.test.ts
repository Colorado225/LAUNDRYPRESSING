import { describe, expect, it } from 'vitest'
import {
  nombreVetements,
  POLITIQUES_VENDABLES,
  resumerForfait,
  tariferForfait,
  type Forfait,
} from '@/lib/packagePricing'
import { codeDepuisNom, validerForfait } from '@/services/commercialPackages'

/**
 * Règles pures des forfaits commerciaux.
 *
 * Un forfait promet « 10 vêtements pour 5 000 FCFA ». Ce qui se joue ici :
 * ce que le client paie réellement quand il en dépose 12, et ce que le
 * comptoir ne doit jamais facturer (forfait mal configuré, dépassement
 * refusé). Ces règles décident d'un montant encaissé : elles sont testées
 * une par une, y compris sur les cas limites.
 */

function forfait(partiel: Partial<Forfait> = {}): Forfait {
  return {
    id: 'p0000000-0000-4000-8000-000000000001',
    tenantId: 'tenant-1',
    code: 'PACK_10',
    name: 'Pack 10 pièces',
    description: null,
    priceXof: 5000,
    garmentsIncluded: 10,
    overflowPolicy: 'PER_EXTRA_ITEM',
    overflowUnitPriceXof: 300,
    isActive: true,
    archivedAt: null,
    ...partiel,
  }
}

describe('tarification d’un forfait', () => {
  it('facture le prix global dans la limite incluse', () => {
    const resultat = tariferForfait(forfait(), 8)

    expect(resultat.total).toBe(5000)
    expect(resultat.extras).toBe(0)
    expect(resultat.statut).toBe('inclus')
  })

  it('ajoute les pièces en plus au prix configuré', () => {
    // 12 vêtements = 2 de plus × 300 FCFA.
    const resultat = tariferForfait(forfait(), 12)

    expect(resultat.extras).toBe(2)
    expect(resultat.coutExtras).toBe(600)
    expect(resultat.total).toBe(5600)
    expect(resultat.statut).toBe('supplement')
  })

  it('refuse le dépassement quand le forfait le stipule', () => {
    const resultat = tariferForfait(
      forfait({ overflowPolicy: 'REJECT_OVER_LIMIT', overflowUnitPriceXof: null }),
      11,
    )

    expect(resultat.statut).toBe('refus')
    expect(resultat.total).toBe(5000)
    // Le motif nomme la limite : le comptoir sait quoi annoncer au client.
    expect(resultat.motif).toContain('10 vêtements')
  })

  it('ne déborde jamais d’un forfait illimité', () => {
    const resultat = tariferForfait(forfait({ garmentsIncluded: null }), 40)

    expect(resultat.statut).toBe('inclus')
    expect(resultat.total).toBe(5000)
    expect(resultat.extras).toBe(0)
  })

  it('refuse de facturer une règle de dépassement non prise en charge', () => {
    // `REPEAT_PACKAGE` existe en base mais n'est pas configurable : mieux vaut
    // bloquer la vente que deviner un montant.
    const resultat = tariferForfait(forfait({ overflowPolicy: 'REPEAT_PACKAGE' }), 12)

    expect(resultat.statut).toBe('non_pris_en_charge')
    expect(resultat.total).toBe(5000)
    expect(resultat.motif).toContain('Services & activités')
  })

  it('refuse le supplément si son prix n’est pas configuré', () => {
    const resultat = tariferForfait(forfait({ overflowUnitPriceXof: null }), 12)

    expect(resultat.statut).toBe('non_pris_en_charge')
    expect(resultat.total).toBe(5000)
  })

  it('n’expose que les deux politiques vendables', () => {
    expect([...POLITIQUES_VENDABLES]).toEqual(['PER_EXTRA_ITEM', 'REJECT_OVER_LIMIT'])
  })
})

describe('composition libre', () => {
  it('compte les vêtements d’une composition', () => {
    const details = [
      { type: 'DRAP' as const, quantity: 2 },
      { type: 'SERVIETTE' as const, quantity: 3 },
    ]

    expect(nombreVetements(details)).toBe(5)
    expect(nombreVetements([])).toBe(0)
    expect(nombreVetements(undefined)).toBe(0)
  })
})

describe('résumé d’un forfait', () => {
  it('annonce le nombre inclus et le prix du dépassement', () => {
    expect(resumerForfait(forfait())).toBe('10 vêtements inclus · au-delà : 300 FCFA/pièce')
  })

  it('annonce le refus et l’illimité', () => {
    expect(
      resumerForfait(forfait({ overflowPolicy: 'REJECT_OVER_LIMIT', overflowUnitPriceXof: null })),
    ).toBe('10 vêtements inclus · au-delà : refusé')
    expect(resumerForfait(forfait({ garmentsIncluded: null }))).toBe('vêtements illimités')
  })
})

describe('validation d’une saisie de forfait', () => {
  const valide = {
    name: 'Pack 10 pièces',
    description: null,
    priceXof: 5000,
    garmentsIncluded: 10,
    overflowPolicy: 'PER_EXTRA_ITEM' as const,
    overflowUnitPriceXof: 300,
  }

  it('accepte une saisie complète et nettoie le nom', () => {
    const propre = validerForfait({ ...valide, name: '  Pack 10 pièces  ' })

    expect(propre.name).toBe('Pack 10 pièces')
    expect(propre.priceXof).toBe(5000)
  })

  it('exige un prix entier dans les bornes', () => {
    expect(() => validerForfait({ ...valide, priceXof: 0 })).toThrow(/prix du forfait/i)
    expect(() => validerForfait({ ...valide, priceXof: 10_000_001 })).toThrow(/prix du forfait/i)
    expect(() => validerForfait({ ...valide, priceXof: 5000.5 })).toThrow(/prix du forfait/i)
  })

  it('exige un nombre de vêtements entier et positif', () => {
    expect(() => validerForfait({ ...valide, garmentsIncluded: 0 })).toThrow(/vêtements inclus/i)
    expect(() => validerForfait({ ...valide, garmentsIncluded: 2.5 })).toThrow(/vêtements inclus/i)
  })

  it('exige le prix de la pièce en plus quand le supplément est choisi', () => {
    expect(() =>
      validerForfait({ ...valide, overflowPolicy: 'PER_EXTRA_ITEM', overflowUnitPriceXof: null }),
    ).toThrow(/pièce supplémentaire/i)
  })

  it('ignore un prix de dépassement quand le forfait refuse au-delà', () => {
    const propre = validerForfait({
      ...valide,
      overflowPolicy: 'REJECT_OVER_LIMIT',
      overflowUnitPriceXof: 300,
    })

    expect(propre.overflowUnitPriceXof).toBeNull()
  })

  it('refuse une politique non proposée par l’écran', () => {
    expect(() =>
      validerForfait({ ...valide, overflowPolicy: 'REPEAT_PACKAGE' as never }),
    ).toThrow(/au-delà/i)
  })
})

describe('code technique d’un forfait', () => {
  it('dérive un code normalisé du nom', () => {
    expect(codeDepuisNom('Pack 10 pièces', [])).toBe('PACK_10_PIECES')
    expect(codeDepuisNom('Forfait été', [])).toBe('FORFAIT_ETE')
  })

  it('rend le code unique sans écraser un forfait existant', () => {
    expect(codeDepuisNom('Pack 10 pièces', ['PACK_10_PIECES'])).toBe('PACK_10_PIECES_2')
    expect(codeDepuisNom('Pack 10 pièces', ['PACK_10_PIECES', 'PACK_10_PIECES_2'])).toBe(
      'PACK_10_PIECES_3',
    )
  })

  it('reste conforme au format imposé par le serveur', () => {
    const code = codeDepuisNom('  ', [])

    expect(code).toBe('FORFAIT')
    expect(code).toMatch(/^[A-Z0-9_]{2,40}$/)
  })
})
