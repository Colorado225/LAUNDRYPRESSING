import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/localDb'
import { createOrderLocal, updateOrderItemMeasurementLocal } from '@/db/ordersRepository'

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222'

async function creerCommande() {
  return createOrderLocal(TENANT, {
    customerName: 'Awa Koné',
    customerPhone: '+2250700000001',
    items: [
      {
        label: 'Lavage au kilo',
        price: 3000,
        quantity: 0.5,
        billingUnit: 'KG',
        unitPrice: 1500,
        pricingMode: 'FROM',
        priceStatus: 'ESTIMATED',
        billedQuantity: 1,
        catalogUnitPriceSnapshot: 1200,
        minimumQuantitySnapshot: 1,
        billingIncrementSnapshot: 0.5,
        minimumChargeSnapshot: 3000,
        conditionsSnapshot: 'Séchage inclus',
        priceReason: 'Tarif exceptionnel validé',
      },
      { label: 'Chemise', price: 1000, priceReason: 'Prestation de test' },
    ],
  })
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
})

describe('mise à jour locale d’une mesure de commande', () => {
  it('recalcule la ligne et la commande avec les paramètres tarifaires figés', async () => {
    const { order, items } = await creerCommande()
    const [ligneMesuree] = items

    const result = await updateOrderItemMeasurementLocal(TENANT, order.id, ligneMesuree.id, {
      quantity: 2.1,
      priceStatus: 'CONFIRMED',
    })

    expect(result.item).toMatchObject({
      id: ligneMesuree.id,
      quantity: 2.1,
      billedQuantity: 2.5,
      unitPrice: 1500,
      price: 3750,
      priceStatus: 'CONFIRMED',
      catalogUnitPriceSnapshot: 1200,
      minimumQuantitySnapshot: 1,
      billingIncrementSnapshot: 0.5,
      minimumChargeSnapshot: 3000,
      conditionsSnapshot: 'Séchage inclus',
      priceReason: 'Tarif exceptionnel validé',
    })
    expect(result.order).toMatchObject({
      totalAmount: 4750,
      status: 'received',
      paymentStatus: 'pending',
      paymentMethod: null,
      synced: 0,
      serverVersion: 0,
    })

    expect(await db.orderItems.get(ligneMesuree.id)).toEqual(result.item)
    expect(await db.orders.get(order.id)).toEqual(result.order)
  })

  it('permet de confirmer une quantité inchangée et ne modifie que son statut de mesure', async () => {
    const { order, items } = await creerCommande()
    const [ligneMesuree] = items

    const result = await updateOrderItemMeasurementLocal(TENANT, order.id, ligneMesuree.id, {
      quantity: ligneMesuree.quantity,
      priceStatus: 'CONFIRMED',
    })

    expect(result.item.priceStatus).toBe('CONFIRMED')
    expect(result.item.price).toBe(ligneMesuree.price)
    expect(result.order.totalAmount).toBe(order.totalAmount)
    expect(result.order.paymentStatus).toBe(order.paymentStatus)
    expect(result.order.paymentMethod).toBe(order.paymentMethod)
    expect(result.order.synced).toBe(0)
  })

  it('refuse les mesures invalides, les forfaits et les commandes d’un autre pressing', async () => {
    const { order, items } = await creerCommande()
    const [ligneMesuree] = items

    await expect(
      updateOrderItemMeasurementLocal(TENANT, order.id, ligneMesuree.id, {
        quantity: 0,
        priceStatus: 'CONFIRMED',
      }),
    ).rejects.toThrow()
    await expect(
      updateOrderItemMeasurementLocal(OTHER_TENANT, order.id, ligneMesuree.id, {
        quantity: 2,
        priceStatus: 'CONFIRMED',
      }),
    ).rejects.toThrow(/n’appartient pas/)

    const forfait = await createOrderLocal(TENANT, {
      customerName: 'Awa Koné',
      customerPhone: '+2250700000001',
      items: [{ label: 'Retouche', price: 2500, billingUnit: 'FLAT', priceReason: 'Forfait retouche' }],
    })
    await expect(
      updateOrderItemMeasurementLocal(TENANT, forfait.order.id, forfait.items[0].id, {
        quantity: 1,
        priceStatus: 'CONFIRMED',
      }),
    ).rejects.toThrow(/forfait/)
  })

  it('ne change jamais le règlement d’une commande soldée et rejette les commandes terminées', async () => {
    const { order, items } = await creerCommande()
    const [ligneMesuree] = items
    await db.orders.update(order.id, { paymentStatus: 'paid', paymentMethod: 'cash' })

    await expect(
      updateOrderItemMeasurementLocal(TENANT, order.id, ligneMesuree.id, {
        quantity: 3,
        priceStatus: 'CONFIRMED',
      }),
    ).rejects.toThrow(/soldée/)
    expect(await db.orders.get(order.id)).toMatchObject({
      totalAmount: order.totalAmount,
      paymentStatus: 'paid',
      paymentMethod: 'cash',
    })

    await db.orders.update(order.id, { paymentStatus: 'pending', status: 'delivered' })
    await expect(
      updateOrderItemMeasurementLocal(TENANT, order.id, ligneMesuree.id, {
        quantity: 3,
        priceStatus: 'CONFIRMED',
      }),
    ).rejects.toThrow(/terminée ou annulée/)
  })
})
