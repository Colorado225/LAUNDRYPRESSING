import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/localDb'
import { createOrderLocal, updateOrderStatusLocal } from '@/db/ordersRepository'
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
          // Deux usages distincts :
          //  - relecture après doublon (`.select('version').eq(…).maybeSingle()`) ;
          //  - lecture descendante (`select(...).eq(…).gt(…).order(…).limit(…)`).
          const builder = {
            eq: () => builder,
            gt: () => builder,
            order: () => builder,
            limit: () => Promise.resolve({ data: remote.pullRows, error: null }),
            maybeSingle: () => Promise.resolve({ data: { version: 7 }, error: null }),
            single: () => Promise.resolve({ data: { version: 7 }, error: null }),
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
              Promise.resolve({ data: remote.pullRows, error: null }).then(resolve, reject),
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
const { syncPendingOrders } = await import('@/sync/syncEngine')

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

async function seedOrder(tenantId = TENANT, label = 'Chemise') {
  return createOrderLocal(tenantId, {
    customerName: 'Awa Koné',
    customerPhone: '+2250700000001',
    items: [{ label, price: 2500 }],
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
  remote.rpcCalls = []
  remote.cashError = null
  remote.cashRemaining = 0
  await db.cashPayments.clear()
  useTenantStore.setState({ tenantId: TENANT, tenantName: 'Pressing Cocody', role: 'owner' })
  useSyncStore.getState().reset()
  setOnline(true)
})

afterEach(() => {
  setOnline(true)
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
