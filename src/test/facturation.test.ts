import { describe, expect, it } from 'vitest'
import {
  construireFacture,
  lignesFacture,
  montantEnLettres,
  numeroFacture,
  referenceCommande,
} from '@/lib/facturation'
import type { LocalCashPayment, LocalOrder, LocalOrderItem } from '@/db/localDb'

/**
 * Facturation (document A4).
 *
 * Trois choses peuvent coûter cher si elles sont fausses : un numéro de
 * facture instable, un total qui ne correspond pas aux lignes, et un montant
 * en lettres erroné sur un document remis au client.
 */

const ORDER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

function commande(partial: Partial<LocalOrder> = {}): LocalOrder {
  return {
    id: ORDER_ID,
    tenantId: 'tenant-1',
    customerName: 'Awa Koné',
    customerPhone: '+2250700000021',
    status: 'ready',
    qrCode: 'QR',
    photoUrl: null,
    totalAmount: 9_000,
    paymentStatus: 'partial',
    paymentMethod: 'cash',
    createdAt: '2026-03-14T09:30:00.000Z',
    updatedAt: '2026-03-14T09:30:00.000Z',
    synced: 1,
    syncedAt: '2026-03-14T09:35:00.000Z',
    serverVersion: 1,
    syncError: null,
    syncConflict: null,
    dueDate: '2026-03-16',
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
    ...partial,
  }
}

function ligne(partial: Partial<LocalOrderItem> & Pick<LocalOrderItem, 'id'>): LocalOrderItem {
  return {
    orderId: ORDER_ID,
    tenantId: 'tenant-1',
    label: 'Chemise',
    fabricType: null,
    specialInstructions: null,
    price: 1_500,
    quantity: 1,
    billedQuantity: 1,
    billingUnit: 'PIECE',
    unitPrice: 1_500,
    pricingMode: 'FIXED',
    priceStatus: 'CONFIRMED',
    catalogEntryId: null,
    articleName: 'Chemise',
    serviceName: 'Lavage',
    familyNameSnapshot: null,
    catalogUnitPriceSnapshot: null,
    minimumQuantitySnapshot: null,
    billingIncrementSnapshot: null,
    minimumChargeSnapshot: null,
    conditionsSnapshot: null,
    priceReason: null,
    ...partial,
  }
}

function paiement(
  partial: Partial<LocalCashPayment> & Pick<LocalCashPayment, 'id'>,
): LocalCashPayment {
  return {
    orderId: ORDER_ID,
    tenantId: 'tenant-1',
    amount: 4_000,
    method: 'cash',
    note: null,
    receivedAt: '2026-03-14T10:00:00.000Z',
    synced: 1,
    lastError: null,
    ...partial,
  }
}

describe('numeroFacture', () => {
  it('reprend l’année de la commande et la fin de son identifiant', () => {
    expect(numeroFacture(ORDER_ID, '2026-03-14T09:30:00.000Z')).toBe('FA-2026-3B4C5D')
  })

  it('est stable : deux appels donnent le même numéro', () => {
    const premier = numeroFacture(ORDER_ID, '2026-03-14T09:30:00.000Z')
    const second = numeroFacture(ORDER_ID, '2026-03-14T09:30:00.000Z')
    expect(premier).toBe(second)
  })

  it('diffère pour deux commandes différentes', () => {
    const a = numeroFacture('11111111-1111-4111-8111-111111111111', '2026-03-14T09:30:00Z')
    const b = numeroFacture('22222222-2222-4222-8222-222222222222', '2026-03-14T09:30:00Z')
    expect(a).not.toBe(b)
  })

  it('tolère une date absente sans produire « FA-- »', () => {
    const numero = numeroFacture(ORDER_ID, '')
    expect(numero).toMatch(/^FA-\d{4}-3B4C5D$/)
  })
})

describe('referenceCommande', () => {
  it('reprend les six derniers caractères de l’identifiant, en majuscules', () => {
    expect(referenceCommande(ORDER_ID)).toBe('CMD-3B4C5D')
  })
})

describe('lignesFacture', () => {
  it('regroupe les prestations identiques et additionne les quantités', () => {
    const lignes = lignesFacture([
      ligne({ id: 'l1' }),
      ligne({ id: 'l2' }),
      ligne({ id: 'l3', price: 3_000, serviceName: 'Repassage' }),
    ])

    expect(lignes).toHaveLength(2)
    expect(lignes[0]).toEqual({
      libelle: 'Chemise — Lavage',
      quantiteMesuree: 2,
      quantite: 2,
      unite: 'PIECE',
      prixStatut: 'CONFIRMED',
      prixUnitaire: 1_500,
      total: 3_000,
    })
  })

  it('garde deux lignes séparées quand le prix diffère', () => {
    const lignes = lignesFacture([
      ligne({ id: 'l1', price: 1_500 }),
      ligne({ id: 'l2', price: 2_000, priceReason: 'Tissu épais' }),
    ])
    expect(lignes).toHaveLength(2)
  })

  it('utilise le libellé libre quand aucun article de catalogue n’est renseigné', () => {
    const lignes = lignesFacture([
      ligne({ id: 'l1', articleName: null, serviceName: null, label: 'Couverture' }),
    ])
    expect(lignes[0]?.libelle).toBe('Couverture')
  })

  it('conserve la quantité mesurée, la quantité facturée et le statut estimé', () => {
    const [lignePesee] = lignesFacture([
      ligne({
        id: 'kg-1',
        label: 'Couette',
        articleName: 'Couette',
        serviceName: 'Lavage au poids',
        price: 9_750,
        quantity: 6.4,
        billedQuantity: 6.5,
        billingUnit: 'KG',
        unitPrice: 1_500,
        priceStatus: 'ESTIMATED',
      }),
    ])

    expect(lignePesee).toEqual({
      libelle: 'Couette — Lavage au poids',
      quantiteMesuree: 6.4,
      quantite: 6.5,
      unite: 'KG',
      prixStatut: 'ESTIMATED',
      prixUnitaire: 1_500,
      total: 9_750,
    })
  })

  it('renvoie une liste vide sans ligne', () => {
    expect(lignesFacture([])).toEqual([])
  })
})

describe('construireFacture', () => {
  const items = [ligne({ id: 'l1' }), ligne({ id: 'l2' }), ligne({ id: 'l3', price: 6_000 })]

  it('refuse de produire une facture si une mesure est encore estimée', () => {
    expect(() =>
      construireFacture(commande(), [ligne({ id: 'estimée', priceStatus: 'ESTIMATED' })], []),
    ).toThrow(/toutes les mesures ne sont pas confirmées/)
  })
  const paiements = [
    paiement({ id: 'p2', amount: 2_000, receivedAt: '2026-03-15T08:00:00.000Z' }),
    paiement({ id: 'p1', amount: 2_000, receivedAt: '2026-03-14T10:00:00.000Z' }),
  ]

  it('somme les acomptes et calcule le reste', () => {
    const facture = construireFacture(commande(), items, paiements)

    expect(facture.total).toBe(9_000)
    expect(facture.verse).toBe(4_000)
    expect(facture.reste).toBe(5_000)
    expect(facture.acquittee).toBe(false)
  })

  it('classe les acomptes du plus ancien au plus récent', () => {
    const facture = construireFacture(commande(), items, paiements)
    expect(facture.acomptes.map((acompte) => acompte.id)).toEqual(['p1', 'p2'])
    expect(facture.acomptes[0]?.moyen).toBe('Espèces')
  })

  it('marque la facture acquittée quand le solde est nul', () => {
    const facture = construireFacture(commande({ paymentStatus: 'paid' }), items, [
      paiement({ id: 'p1', amount: 9_000 }),
    ])
    expect(facture.reste).toBe(0)
    expect(facture.acquittee).toBe(true)
  })

  it('reprend les coordonnées du client et la livraison promise', () => {
    const facture = construireFacture(commande(), items, [])
    expect(facture.client).toEqual({ nom: 'Awa Koné', telephone: '+2250700000021' })
    expect(facture.livraisonPromise).toBe('2026-03-16')
    expect(facture.statut).toBe('Prête')
  })

  it('écrit le total en toutes lettres', () => {
    const facture = construireFacture(commande(), items, [])
    expect(facture.totalEnLettres).toBe('neuf mille francs CFA')
  })
})

describe('montantEnLettres', () => {
  const cas: Array<[number, string]> = [
    [0, 'zéro franc CFA'],
    [1, 'un franc CFA'],
    [17, 'dix-sept francs CFA'],
    [21, 'vingt et un francs CFA'],
    [70, 'soixante-dix francs CFA'],
    [71, 'soixante et onze francs CFA'],
    [80, 'quatre-vingts francs CFA'],
    [81, 'quatre-vingt-un francs CFA'],
    [99, 'quatre-vingt-dix-neuf francs CFA'],
    [100, 'cent francs CFA'],
    [200, 'deux cents francs CFA'],
    [201, 'deux cent un francs CFA'],
    [1_000, 'mille francs CFA'],
    [2_500, 'deux mille cinq cents francs CFA'],
    [80_000, 'quatre-vingt mille francs CFA'],
    [1_000_000, 'un million francs CFA'],
    [2_000_000, 'deux millions francs CFA'],
  ]

  for (const [montant, attendu] of cas) {
    it(`${montant} → « ${attendu} »`, () => {
      expect(montantEnLettres(montant)).toBe(attendu)
    })
  }

  it('refuse un montant négatif au lieu d’inventer une phrase', () => {
    expect(montantEnLettres(-500)).toBe('montant indéterminé')
  })

  it('refuse une valeur non finie', () => {
    expect(montantEnLettres(Number.NaN)).toBe('montant indéterminé')
  })
})
