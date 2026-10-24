import { describe, expect, it } from 'vitest'
import type { LocalCashPayment, LocalOrder, LocalOrderItem } from '@/db/localDb'
import {
  PERIODES,
  bornesPeriode,
  computeRapport,
  joursDeLaPeriode,
  labelCourt,
  rapportCsv,
  variationPourcent,
} from '@/lib/reporting'
import type { OrderStatus } from '@/types/database'

/**
 * Écran 11 — rapports et statistiques.
 *
 * Les jeux de données imitent trois semaines d'un pressing : une journée
 * chargée, deux commandes annulées, un encaissement partiel et un règlement
 * postérieur à la commande. C'est le genre de décalage qui fait diverger un
 * rapport du tableau de bord quand les deux calculs sont écrits deux fois.
 */

const AUJOURDHUI = '2026-10-23'

function commande(partial: Partial<LocalOrder> & Pick<LocalOrder, 'id'>): LocalOrder {
  return {
    tenantId: 'pressing-1',
    customerName: 'Awa Koné',
    customerPhone: '0700000021',
    status: 'received',
    qrCode: `CMD-${partial.id}`,
    photoUrl: null,
    totalAmount: 5_000,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: '2026-10-23T08:00:00.000Z',
    updatedAt: '2026-10-23T08:00:00.000Z',
    synced: 1,
    syncedAt: '2026-10-23T08:00:00.000Z',
    serverVersion: 1,
    syncError: null,
    syncConflict: null,
    dueDate: null,
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
    ...partial,
  }
}

function paiement(
  partial: Partial<LocalCashPayment> & Pick<LocalCashPayment, 'id'>,
): LocalCashPayment {
  return {
    orderId: 'c1',
    tenantId: 'pressing-1',
    amount: 5_000,
    method: 'cash',
    receivedAt: '2026-10-23T09:00:00.000Z',
    note: null,
    synced: 1,
    lastError: null,
    ...partial,
  }
}

function ligne(
  partial: Partial<LocalOrderItem> & Pick<LocalOrderItem, 'id' | 'orderId'>,
): LocalOrderItem {
  return {
    tenantId: 'pressing-1',
    label: 'Chemise',
    fabricType: null,
    specialInstructions: null,
    price: 1_500,
    catalogEntryId: null,
    articleName: 'Chemise',
    serviceName: 'Lavage',
    priceReason: null,
    ...partial,
  }
}

/** Statut typé pour éviter les littéraux élargis en `string`. */
function statut(valeur: OrderStatus): OrderStatus {
  return valeur
}

describe('bornesPeriode', () => {
  it('couvre sept jours en incluant aujourd’hui', () => {
    expect(bornesPeriode(7, AUJOURDHUI)).toEqual({ debut: '2026-10-17', fin: '2026-10-23' })
  })

  it('franchit correctement un changement de mois', () => {
    expect(bornesPeriode(30, '2026-11-02')).toEqual({ debut: '2026-10-04', fin: '2026-11-02' })
  })

  it('ne descend jamais sous un jour', () => {
    expect(bornesPeriode(0, AUJOURDHUI)).toEqual({ debut: '2026-10-23', fin: '2026-10-23' })
  })
})

describe('joursDeLaPeriode et labelCourt', () => {
  it('produit une date par jour, bornes incluses', () => {
    const dates = joursDeLaPeriode('2026-10-20', '2026-10-23')
    expect(dates).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'])
  })

  it('renvoie une liste vide si la borne de fin précède celle de début', () => {
    expect(joursDeLaPeriode('2026-10-23', '2026-10-20')).toEqual([])
  })

  it('formate en jour/mois', () => {
    expect(labelCourt('2026-10-07')).toBe('07/10')
  })
})

describe('variationPourcent', () => {
  it('calcule une hausse', () => {
    expect(variationPourcent(150, 100)).toBe(50)
  })

  it('calcule une baisse', () => {
    expect(variationPourcent(80, 100)).toBe(-20)
  })

  it('refuse de conclure quand la période précédente est vide', () => {
    expect(variationPourcent(120, 0)).toBeNull()
  })

  it('supporte des valeurs non finies sans renvoyer NaN', () => {
    expect(variationPourcent(Number.NaN, 100)).toBeNull()
  })
})

describe('computeRapport', () => {
  const orders: LocalOrder[] = [
    // Période courante : deux commandes facturées.
    commande({
      id: 'c1',
      totalAmount: 5_000,
      status: 'ready',
      createdAt: '2026-10-23T08:00:00.000Z',
    }),
    commande({
      id: 'c2',
      totalAmount: 3_000,
      status: 'delivered',
      paymentStatus: 'paid',
      createdAt: '2026-10-21T08:00:00.000Z',
    }),
    // Annulée : ne compte ni dans le facturé ni dans le panier moyen.
    commande({ id: 'c3', totalAmount: 9_000, status: statut('cancelled'), createdAt: '2026-10-22T08:00:00.000Z' }),
    // Hors période de 7 jours.
    commande({ id: 'c4', totalAmount: 7_000, status: 'received', createdAt: '2026-10-01T08:00:00.000Z' }),
  ]

  const items: LocalOrderItem[] = [
    ligne({ id: 'l1', orderId: 'c1', price: 3_000, serviceName: 'Lavage' }),
    ligne({ id: 'l2', orderId: 'c1', price: 2_000, serviceName: 'Repassage' }),
    ligne({ id: 'l3', orderId: 'c2', price: 3_000, serviceName: 'Lavage' }),
    ligne({ id: 'l4', orderId: 'c3', price: 9_000, serviceName: 'Lavage' }),
  ]

  const paiements: LocalCashPayment[] = [
    paiement({ id: 'p1', orderId: 'c2', amount: 3_000, receivedAt: '2026-10-21T10:00:00.000Z' }),
    paiement({ id: 'p2', orderId: 'c1', amount: 2_000, receivedAt: '2026-10-23T11:00:00.000Z' }),
    // Encaissement d'une commande antérieure : il compte dans la trésorerie de
    // la période, même si la commande n'y a pas été créée.
    paiement({ id: 'p3', orderId: 'c4', amount: 1_000, receivedAt: '2026-10-22T10:00:00.000Z' }),
  ]

  const rapport = computeRapport(orders, items, paiements, { jours: 7, aujourdhui: AUJOURDHUI })

  it('délimite la période correctement', () => {
    expect(rapport.debut).toBe('2026-10-17')
    expect(rapport.fin).toBe('2026-10-23')
    expect(rapport.jours).toBe(7)
  })

  it('ne compte pas les annulées dans le facturé', () => {
    expect(rapport.commandes).toBe(2)
    expect(rapport.facture).toBe(8_000)
    expect(rapport.annulees).toBe(1)
  })

  it('calcule le panier moyen sur les commandes retenues', () => {
    expect(rapport.panierMoyen).toBe(4_000)
  })

  it('compte les espèces encaissées, y compris sur une commande antérieure', () => {
    expect(rapport.encaisse).toBe(6_000)
  })

  it('ne réclame que le reste dû des commandes actives', () => {
    // c1 : 5 000 facturés, 2 000 encaissés → 3 000 restants. c2 est livrée.
    expect(rapport.resteAEncaisser).toBe(3_000)
  })

  it('produit une série continue, sans trou de jour', () => {
    expect(rapport.parJour).toHaveLength(7)
    expect(rapport.parJour[0]?.date).toBe('2026-10-17')
    expect(rapport.parJour.at(-1)?.date).toBe('2026-10-23')
    expect(rapport.parJour.at(-1)?.facture).toBe(5_000)
    expect(rapport.parJour.at(-1)?.encaisse).toBe(2_000)
  })

  it('répartit les commandes par statut sans perdre l’annulée', () => {
    const annulees = rapport.parStatut.find((part) => part.status === 'cancelled')
    expect(annulees?.count).toBe(1)
    const total = rapport.parStatut.reduce((somme, part) => somme + part.count, 0)
    expect(total).toBe(3)
  })

  it('classe les prestations par nombre de lignes', () => {
    expect(rapport.topPrestations[0]).toMatchObject({ label: 'Lavage', count: 2 })
    expect(rapport.topPrestations).toHaveLength(2)
    // L'annulée ne doit pas apparaître : son libellé unique reste « Lavage »
    // mais son montant de 9 000 ne doit jamais entrer dans le total.
    const totalPrestations = rapport.topPrestations.reduce((s, l) => s + l.amount, 0)
    expect(totalPrestations).toBe(8_000)
  })

  it('répartit l’activité sur les sept jours de la semaine', () => {
    expect(rapport.parJourSemaine).toHaveLength(7)
    expect(rapport.parJourSemaine[0]?.label).toBe('lun.')
    expect(rapport.parJourSemaine.at(-1)?.label).toBe('dim.')
  })

  it('compare avec la période précédente', () => {
    // Période précédente (10 au 16 octobre) : aucune commande → pas de variation.
    expect(rapport.variation.facture).toBeNull()
    expect(rapport.variation.commandes).toBeNull()
  })
})

describe('computeRapport sur 30 jours', () => {
  it('inclut la commande du 1er octobre et calcule une variation', () => {
    const orders = [
      commande({ id: 'c1', totalAmount: 2_000, createdAt: '2026-10-20T08:00:00.000Z' }),
      commande({ id: 'c2', totalAmount: 4_000, createdAt: '2026-10-01T08:00:00.000Z' }),
      // Période précédente (4 septembre → 3 octobre) : antérieure, exclue.
      commande({ id: 'c3', totalAmount: 1_000, createdAt: '2026-09-10T08:00:00.000Z' }),
    ]
    const rapport = computeRapport(orders, [], [], { jours: 30, aujourdhui: AUJOURDHUI })
    expect(rapport.debut).toBe('2026-09-24')
    expect(rapport.jours).toBe(30)
    expect(rapport.commandes).toBe(2)
    expect(rapport.facture).toBe(6_000)
    expect(rapport.parJour).toHaveLength(30)
  })
})

describe('rapportCsv', () => {
  it('produit un en-tête et une ligne par jour, séparateur point-virgule', () => {
    const orders = [
      commande({ id: 'c1', totalAmount: 5_000, createdAt: '2026-10-23T08:00:00.000Z' }),
    ]
    const rapport = computeRapport(orders, [], [], { jours: 7, aujourdhui: AUJOURDHUI })
    const lignes = rapportCsv(rapport).split('\n')
    expect(lignes[0]).toBe('date;facture;encaisse;commandes')
    expect(lignes).toHaveLength(1 + 7 + 2)
    expect(lignes.at(-1)).toBe('total;5000;0;1')
  })
})

describe('PERIODES', () => {
  it('propose trois durées croissantes', () => {
    expect([...PERIODES]).toEqual([7, 30, 90])
  })
})
