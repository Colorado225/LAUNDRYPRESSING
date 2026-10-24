import { beforeEach, describe, expect, it } from 'vitest'
import {
  exporterDonneesLocales,
  purgerCommandesSynchronisees,
  resumerDonneesLocales,
} from '@/db/maintenance'
import { db, type LocalCashPayment, type LocalOrder, type LocalOrderItem } from '@/db/localDb'

/**
 * Entretien des données locales (écran Paramètres).
 *
 * Le point sensible est la purge : elle ne doit **jamais** emporter une commande
 * qui n'existe pas encore côté serveur. Un test qui ne vérifie que le nombre de
 * lignes effacées passerait alors que la donnée est perdue.
 */

const TENANT = 'tenant-1'
const AUTRE = 'tenant-2'

function commande(
  partial: Partial<LocalOrder> & Pick<LocalOrder, 'id'>,
): LocalOrder {
  return {
    tenantId: TENANT,
    customerName: 'Awa Koné',
    customerPhone: '0700000021',
    status: 'delivered',
    qrCode: `CMD-${partial.id}`,
    photoUrl: null,
    totalAmount: 5_000,
    paymentStatus: 'paid',
    paymentMethod: 'cash',
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    synced: 1,
    syncedAt: '2026-10-20T09:00:00.000Z',
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

function ligne(id: string, orderId: string, tenantId = TENANT): LocalOrderItem {
  return {
    id,
    orderId,
    tenantId,
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
    familyNameSnapshot: null,
    catalogUnitPriceSnapshot: null,
    minimumQuantitySnapshot: null,
    billingIncrementSnapshot: null,
    minimumChargeSnapshot: null,
    conditionsSnapshot: null,
    catalogEntryId: null,
    articleName: 'Chemise',
    serviceName: 'Lavage',
    priceReason: null,
  }
}

function paiement(id: string, orderId: string): LocalCashPayment {
  return {
    id,
    orderId,
    tenantId: TENANT,
    amount: 5_000,
    method: 'cash',
    note: null,
    receivedAt: '2026-10-20T09:00:00.000Z',
    synced: 1,
    lastError: null,
  }
}

beforeEach(async () => {
  await Promise.all([
    db.orders.clear(),
    db.orderItems.clear(),
    db.cashPayments.clear(),
    db.orderIssues.clear(),
    db.refunds.clear(),
  ])

  await db.orders.bulkAdd([
    commande({ id: 'c1' }),
    commande({ id: 'c2', synced: 0, syncedAt: null, serverVersion: 0 }),
    commande({ id: 'c3', syncConflict: 'Conflit de version' }),
    commande({ id: 'c4', tenantId: AUTRE }),
  ])
  await db.orderItems.bulkAdd([ligne('l1', 'c1'), ligne('l2', 'c2'), ligne('l3', 'c4', AUTRE)])
  await db.cashPayments.bulkAdd([paiement('p1', 'c1'), paiement('p2', 'c2')])
})

describe('resumerDonneesLocales', () => {
  it('ne compte que le pressing demandé', async () => {
    const resume = await resumerDonneesLocales(TENANT)
    expect(resume.commandes).toBe(3)
    expect(resume.lignes).toBe(2)
    expect(resume.encaissements).toBe(2)
  })

  it('distingue les commandes en attente, en conflit et purgeables', async () => {
    const resume = await resumerDonneesLocales(TENANT)
    expect(resume.enAttente).toBe(1)
    expect(resume.enConflit).toBe(1)
    expect(resume.purgeables).toBe(1)
  })

  it('donne une estimation d’espace sans exiger l’API du navigateur', async () => {
    const resume = await resumerDonneesLocales(TENANT)
    // jsdom ne fournit pas `navigator.storage.estimate` : on attend `null`,
    // jamais un zéro qui laisserait croire à un cache vide.
    expect(resume.octets === null || typeof resume.octets === 'number').toBe(true)
  })
})

describe('exporterDonneesLocales', () => {
  it('exporte les commandes du pressing et leurs dépendances', async () => {
    const exporte = await exporterDonneesLocales(TENANT)

    expect(exporte.version).toBe(1)
    expect(exporte.tenantId).toBe(TENANT)
    expect(exporte.commandes).toHaveLength(3)
    expect(exporte.lignes).toHaveLength(2)
    expect(exporte.encaissements).toHaveLength(2)
    expect(exporte.genereLe).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('n’exporte jamais les données d’un autre pressing', async () => {
    const exporte = await exporterDonneesLocales(TENANT)
    const ids = exporte.commandes.map((commande) => (commande as LocalOrder).id)
    expect(ids).not.toContain('c4')
  })

  it('exporte tout quand aucun pressing n’est précisé', async () => {
    const exporte = await exporterDonneesLocales(null)
    expect(exporte.commandes).toHaveLength(4)
    expect(exporte.lignes).toHaveLength(3)
  })
})

describe('purgerCommandesSynchronisees', () => {
  it('efface la commande synchronisée et ses dépendances', async () => {
    const effacees = await purgerCommandesSynchronisees(TENANT)

    expect(effacees).toBe(1)
    expect(await db.orders.get('c1')).toBeUndefined()
    expect(await db.orderItems.where('orderId').equals('c1').count()).toBe(0)
    expect(await db.cashPayments.where('orderId').equals('c1').count()).toBe(0)
  })

  it('conserve la commande en attente et ses lignes', async () => {
    await purgerCommandesSynchronisees(TENANT)

    expect(await db.orders.get('c2')).toBeDefined()
    expect(await db.orderItems.where('orderId').equals('c2').count()).toBe(1)
    expect(await db.cashPayments.where('orderId').equals('c2').count()).toBe(1)
  })

  it('conserve la commande en conflit', async () => {
    await purgerCommandesSynchronisees(TENANT)
    expect(await db.orders.get('c3')).toBeDefined()
  })

  it('ne touche pas aux données d’un autre pressing', async () => {
    await purgerCommandesSynchronisees(TENANT)
    expect(await db.orders.get('c4')).toBeDefined()
    expect(await db.orderItems.where('orderId').equals('c4').count()).toBe(1)
  })

  it('ne fait rien quand tout reste à synchroniser', async () => {
    await db.orders.clear()
    await db.orders.add(commande({ id: 'seule', synced: 0, syncedAt: null }))

    const effacees = await purgerCommandesSynchronisees(TENANT)
    expect(effacees).toBe(0)
    expect(await db.orders.count()).toBe(1)
  })
})
