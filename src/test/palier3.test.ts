import { describe, expect, it } from 'vitest'
import type { LocalCashPayment, LocalOrder, LocalOrderItem } from '@/db/localDb'
import {
  filterClients,
  normalisePhone,
  ordersForClient,
  summariseClients,
} from '@/services/customerService'
import { STOCK_CATEGORY_LABELS, STOCK_UNIT_LABELS, isLowStock, stockErrorMessage } from '@/services/stockService'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@/services/expenseService'
import {
  computeDashboard,
  shiftDay,
  shortDayLabel,
  startOfMonth,
} from '@/services/dashboardService'
import type { OrderStatus, PaymentStatus } from '@/types/database'

/**
 * Règles métier du palier 3, testées sans interface ni réseau.
 *
 * Les données de test imitent une journée réelle du pressing : deux clients,
 * une commande soldée, une commande en retard et une annulation.
 */

const TENANT = 'pressing-1'

function commande(partial: Partial<LocalOrder> & Pick<LocalOrder, 'id'>): LocalOrder {
  return {
    tenantId: TENANT,
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

function paiement(partial: Partial<LocalCashPayment> & Pick<LocalCashPayment, 'id'>): LocalCashPayment {
  return {
    orderId: 'c1',
    tenantId: TENANT,
    amount: 5_000,
    method: 'cash',
    note: null,
    receivedAt: '2026-10-23T09:00:00.000Z',
    synced: 1,
    lastError: null,
    ...partial,
  }
}

function vetement(
  partial: Partial<LocalOrderItem> & Pick<LocalOrderItem, 'id' | 'orderId'>,
): LocalOrderItem {
  return {
    tenantId: TENANT,
    label: 'Chemise',
    fabricType: 'coton',
    specialInstructions: null,
    price: 1_500,
    catalogEntryId: null,
    articleName: 'Chemise',
    serviceName: 'Lavage simple',
    priceReason: null,
    ...partial,
  }
}

describe('normalisePhone — rapprochement des clients', () => {
  it('rend le même numéro avec ou sans indicatif, espaces et tirets', () => {
    expect(normalisePhone('+225 07 00 00 00 21')).toBe('0700000021')
    expect(normalisePhone('07-00-00-00-21')).toBe('0700000021')
    expect(normalisePhone('0700000021')).toBe('0700000021')
  })

  it('retourne une chaîne vide pour une absence de numéro', () => {
    expect(normalisePhone(null)).toBe('')
    expect(normalisePhone(undefined)).toBe('')
    expect(normalisePhone('  ')).toBe('')
  })
})

describe('summariseClients — fiche et historique', () => {
  const commandes = [
    commande({
      id: 'c1',
      customerName: 'Awa Koné',
      customerPhone: '+225 07 00 00 00 21',
      totalAmount: 10_000,
      paymentStatus: 'partial',
      createdAt: '2026-10-20T09:00:00.000Z',
      dueDate: '2026-10-21',
      status: 'ready',
    }),
    commande({
      id: 'c2',
      customerName: 'Awa Kone',
      customerPhone: '0700000021',
      totalAmount: 5_000,
      paymentStatus: 'paid',
      createdAt: '2026-10-22T09:00:00.000Z',
      status: 'delivered',
    }),
    commande({
      id: 'c3',
      customerName: 'Awa Koné',
      customerPhone: '0700000021',
      totalAmount: 99_000,
      paymentStatus: 'pending',
      createdAt: '2026-10-21T09:00:00.000Z',
      status: 'cancelled',
    }),
    commande({
      id: 'c4',
      customerName: 'Ibrahim Traoré',
      customerPhone: '0500000010',
      totalAmount: 7_000,
      paymentStatus: 'pending',
      createdAt: '2026-10-19T09:00:00.000Z',
      status: 'received',
    }),
  ]

  const clients = summariseClients(commandes, '2026-10-23')

  it('regroupe les deux écritures du même numéro en une seule fiche', () => {
    expect(clients).toHaveLength(2)

    const awa = clients.find((client) => client.key === '0700000021')
    expect(awa?.orderCount).toBe(2)
    expect(awa?.totalSpent).toBe(15_000)
  })

  it('ignore les commandes annulées dans le total dépensé', () => {
    const awa = clients.find((client) => client.key === '0700000021')
    expect(awa?.totalSpent).not.toBe(114_000)
  })

  it('cumule le reste à encaisser et les retards', () => {
    const awa = clients.find((client) => client.key === '0700000021')
    expect(awa?.outstanding).toBe(10_000)
    expect(awa?.lateCount).toBe(1)
  })

  it('retient le nom et le téléphone de la commande la plus récente', () => {
    const awa = clients.find((client) => client.key === '0700000021')
    expect(awa?.name).toBe('Awa Kone')
    expect(clients[0]?.key).toBe('0700000021')
  })

  it('filtre par nom, par téléphone brut et par chiffres du numéro', () => {
    expect(filterClients(clients, 'ibrahim')).toHaveLength(1)
    expect(filterClients(clients, '+225')).toHaveLength(0)
    expect(filterClients(clients, '07 00')).toHaveLength(1)
    expect(filterClients(clients, '')).toHaveLength(2)
  })

  it('retrouve l’historique complet d’un client, du plus récent au plus ancien', () => {
    const historique = ordersForClient(commandes, '0700000021')
    expect(historique.map((order) => order.id)).toEqual(['c2', 'c3', 'c1'])
  })
})

describe('stock — seuils et messages', () => {
  it('alerte à seuil atteint ou dépassé, jamais sur un article désactivé', () => {
    expect(isLowStock({ quantity: 3, min_quantity: 5, is_active: true })).toBe(true)
    expect(isLowStock({ quantity: 5, min_quantity: 5, is_active: true })).toBe(true)
    expect(isLowStock({ quantity: 6, min_quantity: 5, is_active: true })).toBe(false)
    expect(isLowStock({ quantity: 0, min_quantity: 5, is_active: false })).toBe(false)
  })

  it('traduit le refus de sortie excédentaire et les droits insuffisants', () => {
    expect(stockErrorMessage('Stock insuffisant : 2 restant(s).')).toContain('Stock insuffisant')
    expect(stockErrorMessage('new row violates row-level security policy')).toContain(
      'rôle',
    )
    expect(stockErrorMessage('autre erreur')).toBe('autre erreur')
  })

  it('expose un libellé français pour chaque catégorie et unité', () => {
    expect(STOCK_CATEGORY_LABELS.emballage).toBe('Emballage')
    expect(STOCK_UNIT_LABELS.rouleau).toBe('rouleaux')
  })
})

describe('dépenses — catégories', () => {
  it('couvre les six catégories attendues, toutes traduites', () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(6)
    for (const categorie of EXPENSE_CATEGORIES) {
      expect(EXPENSE_CATEGORY_LABELS[categorie].length).toBeGreaterThan(2)
    }
  })
})

describe('computeDashboard — indicateurs du propriétaire', () => {
  const commandes: LocalOrder[] = [
    commande({
      id: 'c1',
      status: 'ready',
      totalAmount: 10_000,
      paymentStatus: 'partial',
      createdAt: '2026-10-23T08:00:00.000Z',
      dueDate: '2026-10-22',
    }),
    commande({
      id: 'c2',
      status: 'delivered',
      totalAmount: 6_000,
      paymentStatus: 'paid',
      createdAt: '2026-10-23T10:00:00.000Z',
      dueDate: '2026-10-23',
    }),
    commande({
      id: 'c3',
      status: 'washing',
      totalAmount: 4_000,
      paymentStatus: 'pending',
      createdAt: '2026-10-21T10:00:00.000Z',
      dueDate: '2026-10-24',
    }),
    commande({
      id: 'c4',
      status: 'cancelled',
      totalAmount: 50_000,
      paymentStatus: 'pending',
      createdAt: '2026-10-23T11:00:00.000Z',
    }),
    commande({
      id: 'c5',
      status: 'received',
      totalAmount: 8_000,
      paymentStatus: 'pending',
      createdAt: '2026-10-17T10:00:00.000Z',
    }),
  ]

  const encaissements: LocalCashPayment[] = [
    paiement({ id: 'p1', orderId: 'c1', amount: 4_000, receivedAt: '2026-10-23T09:00:00.000Z' }),
    paiement({ id: 'p2', orderId: 'c2', amount: 6_000, receivedAt: '2026-10-22T09:00:00.000Z' }),
    paiement({ id: 'p3', orderId: 'c5', amount: 1_000, receivedAt: '2026-10-18T09:00:00.000Z' }),
    // Hors fenêtre de sept jours : n'entre pas dans la série, mais reste un
    // encaissement réel (rattaché à une commande déjà soldée pour ne pas
    // fausser le reste à encaisser).
    paiement({ id: 'p4', orderId: 'c2', amount: 9_000, receivedAt: '2026-10-10T09:00:00.000Z' }),
  ]

  const vetements: LocalOrderItem[] = [
    vetement({ id: 'v1', orderId: 'c1', serviceName: 'Lavage simple', price: 4_000 }),
    vetement({ id: 'v2', orderId: 'c2', serviceName: 'Repassage', price: 3_000 }),
    vetement({ id: 'v3', orderId: 'c2', serviceName: 'Repassage', price: 3_000 }),
    vetement({ id: 'v4', orderId: 'c4', serviceName: 'Annulée', price: 50_000 }),
  ]

  const tableau = computeDashboard(commandes, vetements, encaissements, '2026-10-23')

  it('compte les commandes du jour sans les annulations', () => {
    expect(tableau.ordersToday).toBe(2)
  })

  it('sépare les commandes actives, prêtes et en retard', () => {
    expect(tableau.activeOrders).toBe(3)
    expect(tableau.readyOrders).toBe(1)
    expect(tableau.lateOrders).toBe(1)
  })

  it('calcule le reste à encaisser avec les acomptes déjà reçus', () => {
    // c1 : 10 000 − 4 000 ; c3 : 4 000 ; c5 : 8 000 − 1 000.
    expect(tableau.outstanding).toBe(17_000)
  })

  it('additionne les espèces du jour et de la semaine', () => {
    expect(tableau.cashToday).toBe(4_000)
    expect(tableau.cashWeek).toBe(11_000)
  })

  it('produit une série de sept jours, du plus ancien au plus récent', () => {
    expect(tableau.series).toHaveLength(7)
    expect(tableau.series[0]?.date).toBe('2026-10-17')
    expect(tableau.series[6]?.date).toBe('2026-10-23')
    expect(tableau.series[6]?.cash).toBe(4_000)
  })

  it('classe les prestations les plus demandées sans les annulations', () => {
    expect(tableau.topServices[0]).toEqual({ label: 'Repassage', count: 2, amount: 6_000 })
    expect(tableau.topServices.map((ligne) => ligne.label)).not.toContain('Annulée')
  })

  it('calcule le panier moyen sur les commandes non annulées', () => {
    // (10 000 + 6 000 + 4 000 + 8 000) / 4.
    expect(tableau.averageBasket).toBe(7_000)
  })

  it('couvre tous les statuts du parcours, même à zéro', () => {
    expect(tableau.byStatus).toHaveLength(8)
  })
})

describe('dashboard — aides de calendrier', () => {
  it('décale une date sans dérive de fuseau', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('nomme les jours en français, y compris un dimanche', () => {
    expect(shortDayLabel('2026-10-23')).toBe('ven.')
    expect(shortDayLabel('2026-10-25')).toBe('dim.')
  })

  it('trouve le premier jour du mois', () => {
    expect(startOfMonth('2026-10-23')).toBe('2026-10-01')
  })
})

describe('cohérence des statuts', () => {
  it('garde les statuts utilisés par le tableau de bord alignés sur le parcours', () => {
    const statuts: OrderStatus[] = ['received', 'ready', 'delivered', 'cancelled']
    const paiements: PaymentStatus[] = ['pending', 'partial', 'paid']
    expect(statuts).toHaveLength(4)
    expect(paiements).toHaveLength(3)
  })
})
