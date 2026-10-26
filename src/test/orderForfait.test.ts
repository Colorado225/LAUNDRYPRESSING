import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/localDb'
import {
  createOrderLocal,
  getOrderWithItems,
  removeOrderItemLocal,
  toSupabaseOrderItem,
  updateOrderItemMeasurementLocal,
} from '@/db/ordersRepository'

/**
 * Forfait au nombre de vêtements (Lot 3) dans le dépôt local.
 *
 * Le groupe temporaire du formulaire devient une vraie relation locale :
 * une ligne porteuse facturée et des détails à 0 FCFA. Toute correction de
 * comptage ou tout retrait doit re-tarifer la porteuse depuis le cache,
 * sans jamais laisser un détail orphelin.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const FORFAIT = '33333333-3333-4333-8333-333333333333'
const GROUPE = '44444444-4444-4444-8444-444444444444'
const CHEMISE = '55555555-5555-4555-8555-555555555555'
const PANTALON = '66666666-6666-4666-8666-666666666666'

async function mettreForfaitEnCache() {
  await db.catalogPackages.add({
    id: FORFAIT,
    tenantId: TENANT,
    code: 'pack-25',
    name: 'Pack 25 vêtements',
    description: null,
    priceXof: 2000,
    tenantServiceId: null,
    garmentsIncluded: 25,
    overflowPolicy: 'PER_EXTRA_ITEM',
    overflowUnitPriceXof: 100,
    isActive: true,
    items: [],
  })
}

async function creerCommandeForfait(avecLigneLibre = false) {
  return createOrderLocal(TENANT, {
    customerName: 'Awa Koné',
    customerPhone: '+2250700000001',
    items: [
      // Un détail précède volontairement sa porteuse : le dépôt attribue les
      // identifiants avant de construire les lignes.
      {
        label: 'Chemise',
        articleName: 'Chemise',
        price: 0,
        quantity: 20,
        billedQuantity: 20,
        billingUnit: 'PIECE',
        unitPrice: 0,
        pricingMode: 'FIXED',
        priceStatus: 'CONFIRMED',
        garmentTypeId: CHEMISE,
        forfaitGroupeId: GROUPE,
      },
      {
        label: 'Pack 25 vêtements',
        price: 2000,
        totalImpose: 2000,
        quantity: 25,
        billedQuantity: 25,
        billingUnit: 'PACKAGE',
        unitPrice: 80,
        pricingMode: 'FIXED',
        priceStatus: 'CONFIRMED',
        commercialPackageId: FORFAIT,
        forfaitGroupeId: GROUPE,
        conditionsSnapshot: '25 vêtement(s) compté(s) — 25 inclus',
      },
      {
        label: 'Pantalon',
        articleName: 'Pantalon',
        price: 0,
        quantity: 5,
        billedQuantity: 5,
        billingUnit: 'PIECE',
        unitPrice: 0,
        pricingMode: 'FIXED',
        priceStatus: 'CONFIRMED',
        garmentTypeId: PANTALON,
        forfaitGroupeId: GROUPE,
      },
      ...(avecLigneLibre
        ? [
            {
              label: 'Retouche',
              price: 1000,
              quantity: 1,
              unitPrice: 1000,
              priceReason: 'Prestation de test',
            },
          ]
        : []),
    ],
  })
}

function lignesForfait(items: Awaited<ReturnType<typeof creerCommandeForfait>>['items']) {
  const porteuse = items.find((item) => item.commercialPackageId === FORFAIT)
  const chemise = items.find((item) => item.garmentTypeId === CHEMISE)
  const pantalon = items.find((item) => item.garmentTypeId === PANTALON)
  if (!porteuse || !chemise || !pantalon) throw new Error('Groupe de forfait incomplet')
  return { porteuse, chemise, pantalon }
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  await db.catalogPackages.clear()
})

describe('création locale d’un forfait compté', () => {
  it('rattache chaque détail à la porteuse, quel que soit l’ordre du payload', async () => {
    const { order, items } = await creerCommandeForfait(true)
    const { porteuse, chemise, pantalon } = lignesForfait(items)

    expect(order.totalAmount).toBe(3000)
    expect(porteuse).toMatchObject({
      commercialPackageId: FORFAIT,
      packageLineId: null,
      quantity: 25,
      billedQuantity: 25,
      price: 2000,
      priceReason: null,
    })
    for (const detail of [chemise, pantalon]) {
      expect(detail).toMatchObject({
        commercialPackageId: null,
        packageLineId: porteuse.id,
        price: 0,
        unitPrice: 0,
        priceReason: null,
      })
    }

    expect(toSupabaseOrderItem(porteuse)).toMatchObject({
      commercial_package_id: FORFAIT,
      package_line_id: null,
      price_reason: null,
    })
    expect(toSupabaseOrderItem(chemise)).toMatchObject({
      commercial_package_id: null,
      package_line_id: porteuse.id,
      price: 0,
      price_reason: null,
    })
  })
})

describe('correction du comptage d’un forfait', () => {
  it('recalcule la porteuse et le total depuis le forfait en cache', async () => {
    await mettreForfaitEnCache()
    const { order, items } = await creerCommandeForfait(true)
    const { porteuse, chemise } = lignesForfait(items)

    const result = await updateOrderItemMeasurementLocal(TENANT, order.id, chemise.id, {
      quantity: 25,
      priceStatus: 'CONFIRMED',
    })

    expect(result.item).toMatchObject({ quantity: 25, billedQuantity: 25, price: 0 })
    expect(result.order.totalAmount).toBe(3500)
    await expect(db.orderItems.get(porteuse.id)).resolves.toMatchObject({
      quantity: 30,
      billedQuantity: 30,
      // 2 000 FCFA + 5 vêtements supplémentaires × 100 FCFA.
      price: 2500,
      unitPrice: 83,
      conditionsSnapshot: expect.stringContaining('30 vêtement'),
    })
  })

  it('refuse la porteuse en direct et une correction sans forfait en cache', async () => {
    await mettreForfaitEnCache()
    const { order, items } = await creerCommandeForfait()
    const { porteuse, chemise } = lignesForfait(items)

    await expect(
      updateOrderItemMeasurementLocal(TENANT, order.id, porteuse.id, {
        quantity: 30,
        priceStatus: 'CONFIRMED',
      }),
    ).rejects.toThrow(/depuis un article inclus/)

    await db.catalogPackages.clear()
    await expect(
      updateOrderItemMeasurementLocal(TENANT, order.id, chemise.id, {
        quantity: 21,
        priceStatus: 'CONFIRMED',
      }),
    ).rejects.toThrow(/Forfait introuvable hors ligne/)
  })
})

describe('retraits dans un groupe de forfait', () => {
  it('retire un détail et re-tarife la porteuse sur le comptage restant', async () => {
    await mettreForfaitEnCache()
    const { order, items } = await creerCommandeForfait(true)
    const { porteuse, pantalon } = lignesForfait(items)

    const { order: commande } = await removeOrderItemLocal(TENANT, order.id, pantalon.id)

    expect(commande.totalAmount).toBe(3000)
    await expect(db.orderItems.get(porteuse.id)).resolves.toMatchObject({
      quantity: 20,
      billedQuantity: 20,
      price: 2000,
      unitPrice: 100,
    })
    expect((await getOrderWithItems(order.id))?.items).toHaveLength(3)
  })

  it('retire tout le groupe quand la porteuse est supprimée', async () => {
    const { order, items } = await creerCommandeForfait(true)
    const { porteuse } = lignesForfait(items)

    const { order: commande } = await removeOrderItemLocal(TENANT, order.id, porteuse.id)

    expect(commande.totalAmount).toBe(1000)
    const relu = await getOrderWithItems(order.id)
    expect(relu?.items).toHaveLength(1)
    expect(relu?.items[0]?.label).toBe('Retouche')
  })

  it('ne supprime jamais le dernier détail en laissant une commande vide', async () => {
    await mettreForfaitEnCache()
    const { order, items } = await creerCommandeForfait()
    const { chemise, pantalon } = lignesForfait(items)

    await removeOrderItemLocal(TENANT, order.id, chemise.id)
    await expect(removeOrderItemLocal(TENANT, order.id, pantalon.id)).rejects.toThrow(
      /au moins un article/,
    )

    expect((await getOrderWithItems(order.id))?.items).toHaveLength(2)
  })
})
