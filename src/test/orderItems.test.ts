import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/localDb'
import {
  addOrderItemLocal,
  createOrderLocal,
  getOrderWithItems,
  removeOrderItemLocal,
  updateOrderStatusLocal,
} from '@/db/ordersRepository'

/**
 * CRUD des lignes d'une commande déjà déposée.
 *
 * Ces écritures restent **local-first** : elles modifient IndexedDB, marquent
 * la commande à renvoyer, puis le moteur de synchronisation aligne
 * `order_items` côté serveur (upsert + purge des lignes retirées, couverte par
 * `syncEngine.test.ts`). On vérifie ici les règles métier : total recalculé,
 * dernière ligne protégée, commande close ou soldée verrouillée.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222'

async function seed() {
  return createOrderLocal(TENANT, {
    customerName: 'Awa Koné',
    customerPhone: '+2250700000001',
    items: [
      { label: 'Chemise', quantity: 2, unitPrice: 2500, price: 5000 },
      { label: 'Pantalon', quantity: 1, unitPrice: 4000, price: 4000 },
    ],
  })
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
})

describe('ajout d’une ligne au comptoir', () => {
  it('crée une ligne au prix fixé et recalcule le total', async () => {
    const { order } = await seed()

    const { order: commande, item } = await addOrderItemLocal(TENANT, order.id, {
      label: '  Robe  ',
      quantity: 2,
      unitPrice: 3000,
    })

    expect(item.label).toBe('Robe')
    expect(item.price).toBe(6000)
    expect(item.billedQuantity).toBe(2)
    expect(item.billingUnit).toBe('PIECE')
    expect(item.pricingMode).toBe('FIXED')
    expect(item.priceStatus).toBe('CONFIRMED')
    // 2 × 2 500 + 4 000 + 2 × 3 000
    expect(commande.totalAmount).toBe(15_000)
    expect(commande.synced).toBe(0)
  })

  it('refuse une quantité ou un prix non entier', async () => {
    const { order } = await seed()

    await expect(
      addOrderItemLocal(TENANT, order.id, { label: 'Robe', quantity: 0, unitPrice: 3000 }),
    ).rejects.toThrow('quantité')

    await expect(
      addOrderItemLocal(TENANT, order.id, { label: 'Robe', quantity: 1, unitPrice: 12.5 }),
    ).rejects.toThrow('prix unitaire')
  })

  it('refuse un libellé vide et une commande d’un autre pressing', async () => {
    const { order } = await seed()

    await expect(
      addOrderItemLocal(TENANT, order.id, { label: '   ', quantity: 1, unitPrice: 1000 }),
    ).rejects.toThrow('libellé')

    await expect(
      addOrderItemLocal(OTHER_TENANT, order.id, { label: 'Robe', quantity: 1, unitPrice: 1000 }),
    ).rejects.toThrow('introuvable')
  })
})

describe('retrait d’une ligne', () => {
  it('supprime la ligne et recalcule le total', async () => {
    const { order, items } = await seed()

    const { order: commande } = await removeOrderItemLocal(TENANT, order.id, items[0]!.id)

    expect(commande.totalAmount).toBe(4000)
    expect(commande.synced).toBe(0)

    const relu = await getOrderWithItems(order.id)
    expect(relu?.items).toHaveLength(1)
    expect(relu?.items[0]?.label).toBe('Pantalon')
  })

  it('protège la dernière ligne : une commande sans article n’existe pas', async () => {
    const { order, items } = await seed()
    await removeOrderItemLocal(TENANT, order.id, items[0]!.id)

    await expect(removeOrderItemLocal(TENANT, order.id, items[1]!.id)).rejects.toThrow(
      'au moins un article',
    )

    const relu = await getOrderWithItems(order.id)
    expect(relu?.items).toHaveLength(1)
  })

  it('refuse une commande terminée, annulée ou soldée', async () => {
    const { order, items } = await seed()

    await updateOrderStatusLocal(order.id, 'delivered')
    await expect(removeOrderItemLocal(TENANT, order.id, items[0]!.id)).rejects.toThrow(
      'terminée ou annulée',
    )

    await db.orders.update(order.id, { status: 'received', paymentStatus: 'paid' })
    await expect(
      addOrderItemLocal(TENANT, order.id, { label: 'Robe', quantity: 1, unitPrice: 1000 }),
    ).rejects.toThrow('soldée')
  })

  it('refuse une ligne rattachée à un autre pressing', async () => {
    const { order, items } = await seed()

    await expect(removeOrderItemLocal(OTHER_TENANT, order.id, items[0]!.id)).rejects.toThrow(
      'pressing sélectionné',
    )
  })
})
