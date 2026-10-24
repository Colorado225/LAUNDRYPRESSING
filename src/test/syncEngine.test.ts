import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/localDb'
import {
  createOrderLocal,
  toSupabaseOrder,
  toSupabaseOrderItem,
  updateOrderItemMeasurementLocal,
  updateOrderStatusLocal,
} from '@/db/ordersRepository'
import { useSyncStore } from '@/stores/syncStore'
import { useTenantStore } from '@/lib/tenantContext'

/**
 * Tests du moteur de synchronisation (palier 1).
 *
 * Le moteur est le point le plus sensible du mode hors ligne : une régression
 * peut perdre silencieusement des commandes saisies au comptoir, ou écraser le
 * travail d'une autre tablette. On couvre donc :
 *   - le chemin nominal (insertion puis mise à jour verrouillée) ;
 *   - l'idempotence d'un renvoi après perte de réponse (23505) ;
 *   - le conflit détecté, marqué et NON renvoyé tant qu'il n'est pas arbitré ;
 *   - l'échec partiel et la traduction des erreurs en messages français.
 *
 * Supabase est remplacé par un double en mémoire : aucun réseau, aucune clé.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222'

interface Call {
  table: string
  mode: 'insert' | 'update' | 'upsert'
  rows: unknown
}

const remote = vi.hoisted(() => ({
  calls: [] as Call[],
  configured: true,
  /** Message d'erreur à renvoyer pour un envoi précis. */
  failure: null as null | ((table: string, rows: unknown) => string | null),
  /** Simule une réponse perdue : l'insertion échoue en doublon. */
  duplicateOnInsert: false,
  /** Version renvoyée par le serveur après une mise à jour acceptée. */
  nextVersion: 2,
  /** Simule une modification concurrente : la mise à jour ne touche aucune ligne. */
  conflictOnUpdate: false,
  /** Lignes renvoyées par la lecture descendante (`pullOrders`). */
  pullRows: [] as unknown[],
  /** État serveur lu pendant l'arbitrage d'un conflit. */
  serverOrder: null as unknown,
  serverItems: [] as unknown[],
  serverFamilyPackages: [] as unknown[],
  serverFamilyContents: [] as unknown[],
  /** Encaissements transmis par `record_cash_payment`. */
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  /** Erreur à renvoyer par l'appel RPC d'encaissement. */
  cashError: null as null | { message: string; code: string },
  /** Reste à payer renvoyé par l'encaissement. */
  cashRemaining: 0,
}))

vi.mock('@/lib/env', () => ({
  get isSupabaseConfigured() {
    return remote.configured
  },
}))

vi.mock('@/lib/supabaseClient', () => {
  /** Résultat PostgREST minimal : `data`, `error`, puis `single`/`maybeSingle`. */
  const result = (data: unknown, error: { message: string; code?: string } | null) => ({
    data,
    error,
    single: () => Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data, error }),
    maybeSingle: () =>
      Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data, error }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve, reject),
  })

  const chain = (table: string, mode: 'insert' | 'update') => {
    const payload = remote.calls[remote.calls.length - 1]?.rows
    const message = remote.failure?.(table, payload) ?? null

    const finish = () => {
      if (message) return result(null, { message })

      if (mode === 'insert') {
        if (remote.duplicateOnInsert) {
          return result(null, { message: 'duplicate key value', code: '23505' })
        }
        return result({ version: 1 }, null)
      }

      // Mise à jour sous verrou : aucune ligne touchée = conflit.
      if (remote.conflictOnUpdate) return result([], null)
      return result([{ version: remote.nextVersion }], null)
    }

    const builder = {
      eq: () => builder,
      select: () => finish(),
      single: () => finish(),
      maybeSingle: () => finish(),
      // Sans `then`, un `await supabase.from(...).insert(...)` renverrait le
      // constructeur lui-même : `error` serait `undefined` et le test croirait
      // à un succès. Le vrai client est « thenable ».
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(finish()).then(resolve, reject),
    }
    return builder
  }

  return {
    getSupabaseClient: () => ({
      from: (table: string) => ({
        insert: (rows: unknown) => {
          remote.calls.push({ table, mode: 'insert', rows })
          return chain(table, 'insert')
        },
        update: (rows: unknown) => {
          remote.calls.push({ table, mode: 'update', rows })
          return chain(table, 'update')
        },
        upsert: (rows: unknown) => {
          remote.calls.push({ table, mode: 'upsert', rows })
          const message = remote.failure?.(table, rows) ?? null
          return Promise.resolve({ error: message ? { message } : null })
        },
        select: () => {
          // Lecture descendante, relecture d'idempotence et arbitrage des conflits.
          const readRows = table === 'order_items' ? remote.serverItems : table === 'order_item_family_packages' ? remote.serverFamilyPackages : table === 'order_item_family_package_contents' ? remote.serverFamilyContents : remote.pullRows
          const readOrder = remote.serverOrder ?? { version: 7 }
          const builder = {
            eq: () => builder,
            gt: () => builder,
            order: () => builder,
            limit: () => Promise.resolve({ data: remote.pullRows, error: null }),
            maybeSingle: () => Promise.resolve({ data: readOrder, error: null }),
            single: () => Promise.resolve({ data: readOrder, error: null }),
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
              Promise.resolve({ data: readRows, error: null }).then(resolve, reject),
          }
          return builder
        },
      }),
      rpc: (fn: string, args: Record<string, unknown>) => {
        remote.rpcCalls.push({ fn, args })
        if (remote.cashError) return Promise.resolve({ data: null, error: remote.cashError })
        return Promise.resolve({
          data: { payment_id: args['p_payment_id'], paid: 0, remaining: remote.cashRemaining, duplicate: false },
          error: null,
        })
      },
    }),
  }
})

const { queueCashPayment } = await import('@/db/cashRepository')
const { queueNotification } = await import('@/db/notificationRepository')
const { syncPendingOrders } = await import('@/sync/syncEngine')
const { keepLocalVersion, takeServerVersion } = await import('@/services/orderConflictService')

async function preparerConflitDeMesure() {
  const { order, items } = await seedOrder()
  await syncPendingOrders()
  const item = items[0]!

  // Un premier appareil a déjà corrigé à 2 pièces (5 000 FCFA). Le second
  // garde encore la version 1 et saisit ensuite 3 pièces (7 500 FCFA).
  remote.serverOrder = {
    ...toSupabaseOrder(order),
    status: 'washing',
    total_amount: 5_000,
    payment_status: 'partial',
    payment_method: 'cash',
    version: 2,
  }
  remote.serverItems = [{
    ...toSupabaseOrderItem(item),
    quantity: 2,
    billed_quantity: 2,
    price: 5_000,
  }]
  remote.calls.length = 0
  setOnline(false)
  await updateOrderItemMeasurementLocal(TENANT, order.id, item.id, {
    quantity: 3,
    priceStatus: 'CONFIRMED',
  })
  const offlineResult = await syncPendingOrders()

  setOnline(true)
  remote.conflictOnUpdate = true
  const syncResult = await syncPendingOrders()
  remote.conflictOnUpdate = false
  return { order, item, offlineResult, syncResult }
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

async function seedOrder(tenantId = TENANT, label = 'Chemise') {
  return createOrderLocal(tenantId, {
    customerName: 'Awa Koné',
    customerPhone: '+2250700000001',
    items: [{ label, price: 2500, priceReason: 'Prestation de test' }],
  })
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  remote.calls.length = 0
  remote.configured = true
  remote.failure = null
  remote.duplicateOnInsert = false
  remote.nextVersion = 2
  remote.conflictOnUpdate = false
  remote.pullRows = []
  remote.serverOrder = null
  remote.serverItems = []
  remote.serverFamilyPackages = []
  remote.serverFamilyContents = []
  remote.rpcCalls = []
  remote.cashError = null
  remote.cashRemaining = 0
  await db.cashPayments.clear()
  await db.notifications.clear()
  useTenantStore.setState({ tenantId: TENANT, tenantName: 'Pressing Cocody', role: 'owner' })
  useSyncStore.getState().reset()
  setOnline(true)
})

afterEach(() => {
  setOnline(true)
})

describe('syncPendingOrders — forfait famille', () => {
  it('transmet la composition par RPC idempotent, jamais par upsert générique', async () => {
    const modelId = '44444444-4444-4444-8444-444444444444'
    const articleId = '55555555-5555-4555-8555-555555555555'
    const { order, items } = await createOrderLocal(TENANT, {
      customerName: 'Awa Koné',
      customerPhone: '+2250700000001',
      items: [{
        label: 'Forfait famille 2 pièces',
        price: 5000,
        unitPrice: 5000,
        quantity: 1,
        billedQuantity: 1,
        billingUnit: 'FLAT',
        pricingMode: 'FIXED',
        priceStatus: 'CONFIRMED',
        priceReason: 'Forfait famille : tarif confirmé',
        laundryModelId: modelId,
        laundryModelNameSnapshot: 'Forfait famille 2 pièces',
        laundryModelTypeSnapshot: 'FAMILY_PACKAGE',
        laundryWeightKg: null,
        laundryPackagePriceSnapshot: 5000,
        familyPackageSnapshot: {
          modelId,
          modelName: 'Forfait famille 2 pièces',
          packagePrice: 5000,
          includedPieces: 2,
          overagePricePerPiece: null,
          minimumCharge: null,
          pieceCount: 2,
          manualTotalPrice: null,
          contents: [{ articleId, articleName: 'Chemise', familyName: 'Hauts', quantity: 2, careInstructions: null }],
        },
      }],
    })

    const result = await syncPendingOrders()

    expect(result).toMatchObject({ succeeded: 1, failed: 0 })
    expect(items[0]?.familyPackageSnapshot?.pieceCount).toBe(2)
    expect(remote.calls.map((call) => `${call.table}:${call.mode}`)).toEqual(['orders:insert'])
    expect(remote.rpcCalls).toHaveLength(1)
    expect(remote.rpcCalls[0]).toMatchObject({
      fn: 'create_family_package_order_item',
      args: {
        p_order_id: order.id,
        p_laundry_model_id: modelId,
        p_contents: [{ article_id: articleId, quantity: 2 }],
        p_total_price: 5000,
        p_order_item_id: items[0]?.id,
      },
    })
  })
})

describe('forfait famille — arbitrage serveur', () => {
  it('reconstitue le snapshot de composition lorsqu’on adopte la version serveur', async () => {
    const modelId = '44444444-4444-4444-8444-444444444444'
    const articleId = '55555555-5555-4555-8555-555555555555'
    const { order, items } = await createOrderLocal(TENANT, {
      customerName: 'Awa Koné', customerPhone: '+2250700000001', items: [{
        label: 'Forfait famille', price: 5000, unitPrice: 5000, quantity: 1, billedQuantity: 1, billingUnit: 'FLAT',
        pricingMode: 'FIXED', priceStatus: 'CONFIRMED',
        priceReason: 'Forfait famille confirmé', laundryModelId: modelId,
        laundryModelNameSnapshot: 'Forfait famille', laundryModelTypeSnapshot: 'FAMILY_PACKAGE',
        familyPackageSnapshot: {
          modelId, modelName: 'Forfait famille', packagePrice: 5000, includedPieces: 2,
          overagePricePerPiece: null, minimumCharge: null, pieceCount: 2, manualTotalPrice: null,
          contents: [{ articleId, articleName: 'Chemise', familyName: 'Hauts', quantity: 2, careInstructions: 'Laver à froid' }],
        },
      }],
    })
    const item = items[0]!
    remote.serverOrder = { ...toSupabaseOrder(order), version: 2 }
    remote.serverItems = [{
      id: item.id, order_id: order.id, tenant_id: TENANT, label: item.label,
      fabric_type: null, special_instructions: null, price: 5000, quantity: 1,
      billed_quantity: 1, billing_unit: 'FLAT', unit_price: 5000, pricing_mode: 'FIXED',
      price_status: 'CONFIRMED', catalog_entry_id: null, article_name: null, service_name: null,
      family_name_snapshot: null, catalog_unit_price_snapshot: null, minimum_quantity_snapshot: null,
      billing_increment_snapshot: null, minimum_charge_snapshot: null, conditions_snapshot: null,
      price_reason: 'Forfait famille confirmé', laundry_model_id: null, laundry_model_name_snapshot: null,
      laundry_model_type_snapshot: null, laundry_weight_kg: null, laundry_price_breakdown_snapshot: null,
      laundry_services_snapshot: null, laundry_price_per_kg_snapshot: null, laundry_package_price_snapshot: null,
      laundry_included_weight_kg_snapshot: null, laundry_overage_price_per_kg_snapshot: null,
      laundry_minimum_weight_kg_snapshot: null, laundry_billing_increment_kg_snapshot: null,
      laundry_minimum_charge_snapshot: null,
    }]
    remote.serverFamilyPackages = [{
      tenant_id: TENANT, order_id: order.id, order_item_id: item.id, laundry_model_id: modelId,
      model_name_snapshot: 'Forfait famille', package_price_snapshot: 5000, included_pieces_snapshot: 2,
      overage_price_per_piece_snapshot: null, minimum_charge_snapshot: null, piece_count: 2,
      scope_snapshot: [], price_breakdown_snapshot: {},
    }]
    remote.serverFamilyContents = [{
      tenant_id: TENANT, order_id: order.id, order_item_id: item.id, article_id: articleId,
      article_name_snapshot: 'Chemise', family_name_snapshot: 'Hauts', quantity: 2,
      care_instructions_snapshot: 'Laver à froid', service_operations_snapshot: [],
    }]

    await takeServerVersion(order)

    expect(await db.orderItems.get(item.id)).toMatchObject({
      laundryModelTypeSnapshot: 'FAMILY_PACKAGE',
      familyPackageSnapshot: {
        modelId, pieceCount: 2,
        contents: [{ articleId, articleName: 'Chemise', familyName: 'Hauts', quantity: 2, careInstructions: 'Laver à froid' }],
      },
    })
  })
})

describe('syncPendingOrders — cas où rien ne doit partir', () => {
  it('ne fait rien hors ligne et bascule le badge en orange', async () => {
    await seedOrder()
    setOnline(false)

    const result = await syncPendingOrders()

    expect(result.skipped).toBe(true)
    expect(remote.calls).toHaveLength(0)
    expect(useSyncStore.getState().state).toBe('offline')
    expect(useSyncStore.getState().pendingCount).toBe(1)
  })

  it('ne fait rien si Supabase n’est pas configuré', async () => {
    await seedOrder()
    remote.configured = false

    const result = await syncPendingOrders()

    expect(result.skipped).toBe(true)
    expect(remote.calls).toHaveLength(0)
  })

  it('ne fait rien sans pressing sélectionné', async () => {
    await seedOrder()
    useTenantStore.setState({ tenantId: null })

    const result = await syncPendingOrders()

    expect(result.skipped).toBe(true)
    expect(remote.calls).toHaveLength(0)
  })

  it('ne fait rien quand la file est vide', async () => {
    const result = await syncPendingOrders()

    expect(result.attempted).toBe(0)
    expect(remote.calls).toHaveLength(0)
  })
})

describe('syncPendingOrders — envoi nominal', () => {
  it('insère la commande puis ses vêtements et mémorise la version', async () => {
    const { order, items } = await seedOrder()

    const result = await syncPendingOrders()

    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0, conflicts: 0 })
    expect(remote.calls.map((call) => `${call.table}:${call.mode}`)).toEqual([
      'orders:insert',
      'order_items:upsert',
    ])

    const stored = await db.orders.get(order.id)
    expect(stored?.synced).toBe(1)
    expect(stored?.serverVersion).toBe(1)
    expect(stored?.syncError).toBeNull()
    expect(stored?.syncConflict).toBeNull()

    const sentItems = remote.calls[1]?.rows as Array<{ order_id: string; tenant_id: string }>
    expect(sentItems).toHaveLength(items.length)
    expect(sentItems[0]?.tenant_id).toBe(TENANT)
    expect(sentItems[0]?.order_id).toBe(order.id)

    expect(useSyncStore.getState().pendingCount).toBe(0)
  })

  it('synchronise une mesure corrigée hors ligne avec la version et les snapshots conservés', async () => {
    const { order, items } = await seedOrder()
    await syncPendingOrders()
    await updateOrderItemMeasurementLocal(TENANT, order.id, items[0]!.id, {
      quantity: 3,
      priceStatus: 'CONFIRMED',
    })
    remote.calls.length = 0

    const result = await syncPendingOrders()

    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0, conflicts: 0 })
    expect(remote.calls.map((call) => `${call.table}:${call.mode}`)).toEqual([
      'orders:update',
      'order_items:upsert',
    ])
    const sentItems = remote.calls[1]?.rows as Array<Record<string, unknown>>
    expect(sentItems[0]).toMatchObject({
      quantity: 3,
      billed_quantity: 3,
      price: 7500,
      price_status: 'CONFIRMED',
      unit_price: 2500,
      billing_unit: 'PIECE',
    })
    expect(sentItems[0]).not.toHaveProperty('payment_status')
    expect((await db.orders.get(order.id))?.synced).toBe(1)
  })

  it('met à jour avec le jeton de version au lieu de réinsérer', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    await updateOrderStatusLocal(order.id, 'washing')
    remote.calls.length = 0

    const result = await syncPendingOrders()

    expect(result.succeeded).toBe(1)
    expect(remote.calls[0]?.mode).toBe('update')

    // La charge utile envoyée ne contient pas le statut de paiement : il est
    // écrit par le webhook, jamais par la tablette.
    const payload = remote.calls[0]?.rows as Record<string, unknown>
    expect(payload).not.toHaveProperty('payment_status')
    expect(payload['status']).toBe('washing')

    const stored = await db.orders.get(order.id)
    expect(stored?.serverVersion).toBe(2)
    expect(stored?.synced).toBe(1)
  })

  it('n’envoie jamais les commandes d’un autre pressing', async () => {
    await seedOrder(OTHER_TENANT, 'Commande Yopougon')

    const result = await syncPendingOrders()

    expect(result.attempted).toBe(0)
    expect(remote.calls).toHaveLength(0)

    const foreign = await db.orders.where('tenantId').equals(OTHER_TENANT).toArray()
    expect(foreign[0]?.synced).toBe(0)
  })

  it('est idempotent : un second passage n’envoie plus rien', async () => {
    await seedOrder()

    await syncPendingOrders()
    remote.calls.length = 0
    await syncPendingOrders()

    expect(remote.calls).toHaveLength(0)
  })

  it('mutualise deux appels concurrents en une seule exécution', async () => {
    await seedOrder()

    const [first, second] = await Promise.all([syncPendingOrders(), syncPendingOrders()])

    expect(remote.calls.filter((call) => call.table === 'orders')).toHaveLength(1)
    expect(first).toEqual(second)
  })
})

describe('syncPendingOrders — renvoi après perte de réponse', () => {
  it('traite un doublon (23505) comme un succès et récupère la version serveur', async () => {
    const { order } = await seedOrder()
    remote.duplicateOnInsert = true

    const result = await syncPendingOrders()

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)

    const stored = await db.orders.get(order.id)
    expect(stored?.synced).toBe(1)
    expect(stored?.serverVersion).toBe(7)
  })
})

describe('syncPendingOrders — conflits', () => {
  it('marque la commande en conflit sans l’écraser', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    await updateOrderStatusLocal(order.id, 'washing')
    remote.conflictOnUpdate = true

    const result = await syncPendingOrders()

    expect(result.conflicts).toBe(1)
    expect(result.succeeded).toBe(0)

    const stored = await db.orders.get(order.id)
    // Le travail local est intact : seul le marqueur change.
    expect(stored?.status).toBe('washing')
    expect(stored?.synced).toBe(0)
    expect(stored?.syncConflict).toContain('Conflit')
    expect(stored?.serverVersion).toBe(1)
  })

  it('détecte deux corrections hors ligne de la même mesure sans envoyer la ligne en conflit', async () => {
    const { order, item, offlineResult, syncResult } = await preparerConflitDeMesure()

    expect(offlineResult.skipped).toBe(true)
    expect(syncResult).toMatchObject({ conflicts: 1, succeeded: 0 })
    expect(remote.calls.map((call) => `${call.table}:${call.mode}`)).toEqual(['orders:update'])
    expect(await db.orderItems.get(item.id)).toMatchObject({
      quantity: 3,
      billedQuantity: 3,
      price: 7_500,
    })
    expect(await db.orders.get(order.id)).toMatchObject({
      totalAmount: 7_500,
      serverVersion: 1,
      synced: 0,
      syncConflict: expect.stringContaining('Conflit'),
    })
  })

  it('garder la mesure locale recharge le jeton puis synchronise le choix explicite', async () => {
    const { order, item, syncResult } = await preparerConflitDeMesure()
    expect(syncResult.conflicts).toBe(1)
    const commandeEnConflit = (await db.orders.get(order.id))!

    await keepLocalVersion(commandeEnConflit)
    expect(await db.orderItems.get(item.id)).toMatchObject({ quantity: 3, price: 7_500 })
    expect(await db.orders.get(order.id)).toMatchObject({
      serverVersion: 2,
      synced: 0,
      syncConflict: null,
    })

    remote.calls.length = 0
    const result = await syncPendingOrders()
    expect(result).toMatchObject({ succeeded: 1, conflicts: 0 })
    expect(remote.calls.map((call) => `${call.table}:${call.mode}`)).toEqual([
      'orders:update',
      'order_items:upsert',
    ])
    expect((remote.calls[1]?.rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      quantity: 3,
      price: 7_500,
    })
  })

  it('prendre la version du serveur restaure sa mesure sans garder la correction locale', async () => {
    const { order, item, syncResult } = await preparerConflitDeMesure()
    expect(syncResult.conflicts).toBe(1)
    const commandeEnConflit = (await db.orders.get(order.id))!

    await takeServerVersion(commandeEnConflit)

    expect(await db.orderItems.get(item.id)).toMatchObject({
      quantity: 2,
      billedQuantity: 2,
      price: 5_000,
    })
    expect(await db.orders.get(order.id)).toMatchObject({
      totalAmount: 5_000,
      status: 'washing',
      paymentStatus: 'partial',
      paymentMethod: 'cash',
      serverVersion: 2,
      synced: 1,
      syncConflict: null,
    })
  })

  it('ne renvoie plus une commande en conflit tant qu’il n’est pas arbitré', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()
    await updateOrderStatusLocal(order.id, 'washing')
    remote.conflictOnUpdate = true
    await syncPendingOrders()

    remote.calls.length = 0
    remote.conflictOnUpdate = false

    const result = await syncPendingOrders()

    expect(result.conflicts).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(remote.calls).toHaveLength(0)
  })
})

describe('syncPendingOrders — échecs', () => {
  it('un échec sur une commande n’empêche pas les autres de partir', async () => {
    const failing = await seedOrder(TENANT, 'Costume')
    const healthy = await seedOrder(TENANT, 'Rideau')

    remote.failure = (table, rows) => {
      if (table !== 'orders') return null
      const row = rows as { id: string }
      return row.id === failing.order.id ? 'Failed to fetch' : null
    }

    const result = await syncPendingOrders()

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(1)

    const failedRow = await db.orders.get(failing.order.id)
    expect(failedRow?.synced).toBe(0)

    const healthyRow = await db.orders.get(healthy.order.id)
    expect(healthyRow?.synced).toBe(1)

    expect(useSyncStore.getState().state).toBe('error')
    expect(useSyncStore.getState().pendingCount).toBe(1)
  })

  it('traduit une erreur RLS en message compréhensible', async () => {
    const { order } = await seedOrder()
    remote.failure = () => 'new row violates row-level security policy for table "orders"'

    await syncPendingOrders()

    const stored = await db.orders.get(order.id)
    expect(stored?.syncError).toContain('Accès refusé par la sécurité du serveur')
    expect(useSyncStore.getState().lastError).toContain('RLS')
  })

  it('traduit une coupure réseau en message français', async () => {
    const { order } = await seedOrder()
    remote.failure = () => 'Failed to fetch'

    await syncPendingOrders()

    const stored = await db.orders.get(order.id)
    expect(stored?.syncError).toBe(
      'Réseau indisponible : la synchronisation reprendra automatiquement.',
    )
  })
})

describe('syncPendingOrders — encaissements au comptoir (palier 2)', () => {
  it('transmet l’encaissement, solde la commande et le retire de la file', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    const paiement = await queueCashPayment(TENANT, order.id, 2500, 'Acompte')
    remote.rpcCalls = []
    remote.cashRemaining = 0

    const result = await syncPendingOrders()

    expect(result.cashSucceeded).toBe(1)
    expect(remote.rpcCalls).toHaveLength(1)
    expect(remote.rpcCalls[0]?.fn).toBe('record_cash_payment')
    // L'identifiant local garantit l'idempotence : le serveur le reçoit tel quel.
    expect(remote.rpcCalls[0]?.args).toMatchObject({
      p_order_id: order.id,
      p_amount: 2500,
      p_payment_id: paiement.id,
    })

    const stocke = await db.cashPayments.get(paiement.id)
    expect(stocke?.synced).toBe(1)
    expect(stocke?.lastError).toBeNull()

    const commande = await db.orders.get(order.id)
    expect(commande?.paymentStatus).toBe('paid')
    expect(commande?.paymentMethod).toBe('cash')
  })

  it('un acompte laisse la commande partiellement réglée', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    await queueCashPayment(TENANT, order.id, 1000, null)
    remote.cashRemaining = 1500

    await syncPendingOrders()

    const commande = await db.orders.get(order.id)
    expect(commande?.paymentStatus).toBe('partial')
  })

  it('un refus définitif sort l’encaissement de la file et conserve le motif', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    const paiement = await queueCashPayment(TENANT, order.id, 99, null)
    remote.cashError = { message: 'Le montant dépasse le reste à payer (0 FCFA).', code: '22023' }

    await syncPendingOrders()

    const stocke = await db.cashPayments.get(paiement.id)
    expect(stocke?.synced).toBe(1)
    expect(stocke?.lastError).toContain('dépasse le reste à payer')
  })

  it('une coupure réseau laisse l’encaissement en attente', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    const paiement = await queueCashPayment(TENANT, order.id, 1000, null)
    remote.cashError = { message: 'Failed to fetch', code: 'FETCH' }

    await syncPendingOrders()

    const stocke = await db.cashPayments.get(paiement.id)
    expect(stocke?.synced).toBe(0)
    expect(stocke?.lastError).toBe(
      'Réseau indisponible : la synchronisation reprendra automatiquement.',
    )
  })
})

describe('syncPendingOrders — lecture des modifications distantes', () => {
  it('applique l’état d’une commande modifiée sur un autre appareil', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    remote.pullRows = [
      {
        id: order.id,
        version: 2,
        status: 'ready',
        payment_status: 'paid',
        payment_method: 'wave',
        total_amount: 2500,
        due_date: '2026-10-30',
        updated_at: '2026-10-23T12:00:00.000Z',
      },
    ]

    const result = await syncPendingOrders()

    expect(result.pulled).toBe(1)

    const local = await db.orders.get(order.id)
    expect(local?.status).toBe('ready')
    expect(local?.paymentStatus).toBe('paid')
    expect(local?.paymentMethod).toBe('wave')
    expect(local?.dueDate).toBe('2026-10-30')
    expect(local?.serverVersion).toBe(2)
    expect(local?.synced).toBe(1)
  })

  it('n’écrase jamais une commande ayant du travail local en attente', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    await updateOrderStatusLocal(order.id, 'washing')

    // L'envoi échoue : la commande reste en file.
    remote.failure = (table) => (table === 'orders' ? 'Failed to fetch' : null)
    remote.pullRows = [
      {
        id: order.id,
        version: 2,
        status: 'ready',
        payment_status: 'pending',
        payment_method: null,
        total_amount: 2500,
        due_date: null,
        updated_at: '2026-10-23T12:00:00.000Z',
      },
    ]

    await syncPendingOrders()

    const local = await db.orders.get(order.id)
    expect(local?.status).toBe('washing')
    expect(local?.synced).toBe(0)
  })

  it('ignore une version identique ou plus ancienne', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    remote.pullRows = [
      {
        id: order.id,
        version: 1,
        status: 'ready',
        payment_status: 'paid',
        payment_method: 'wave',
        total_amount: 2500,
        due_date: null,
        updated_at: '2026-10-23T12:00:00.000Z',
      },
    ]

    const result = await syncPendingOrders()

    expect(result.pulled).toBe(0)
    const local = await db.orders.get(order.id)
    expect(local?.status).toBe('received')
  })
})

describe('syncPendingOrders — clients prévenus', () => {
  it('transmet le journal des sollicitations après les commandes', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    const notification = await queueNotification(TENANT, {
      orderId: order.id,
      channel: 'whatsapp',
      reason: 'pret',
      customerName: 'Awa Koné',
      customerPhone: '+2250700000001',
      message: 'Bonjour Awa, votre linge est prêt.',
    })

    remote.calls.length = 0
    const result = await syncPendingOrders()

    expect(remote.calls.map((call) => `${call.table}:${call.mode}`)).toContain(
      'notifications:insert',
    )
    expect(result.notificationsSucceeded).toBe(1)

    const local = await db.notifications.get(notification.id)
    expect(local?.synced).toBe(1)
  })

  it('considère un doublon comme déjà transmis au lieu de le renvoyer sans fin', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    const notification = await queueNotification(TENANT, {
      orderId: order.id,
      channel: 'appel',
      reason: 'retard',
      customerName: 'Awa Koné',
      customerPhone: '+2250700000001',
      message: 'Bonjour Awa, nous avons pris du retard.',
    })

    remote.calls.length = 0
    remote.duplicateOnInsert = true

    const result = await syncPendingOrders()

    expect(result.notificationsSucceeded).toBe(1)
    const local = await db.notifications.get(notification.id)
    expect(local?.synced).toBe(1)
  })

  it('compte les notifications en attente dans le badge', async () => {
    const { order } = await seedOrder()
    await syncPendingOrders()

    await queueNotification(TENANT, {
      orderId: order.id,
      channel: 'whatsapp',
      reason: 'pret',
      customerName: 'Awa Koné',
      customerPhone: '+2250700000001',
      message: 'Bonjour Awa, votre linge est prêt.',
    })

    remote.failure = (table) => (table === 'notifications' ? 'Failed to fetch' : null)
    const result = await syncPendingOrders()

    expect(result.notificationsSucceeded).toBe(0)
    expect(useSyncStore.getState().pendingCount).toBe(1)
  })
})
