import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/localDb'
import { createOrderLocal } from '@/db/ordersRepository'
import { useSyncStore } from '@/stores/syncStore'
import { useTenantStore } from '@/lib/tenantContext'

/**
 * Tests du moteur de synchronisation (phase 6).
 *
 * Le moteur est le point le plus sensible du mode hors ligne : une régression
 * peut perdre silencieusement des commandes saisies au comptoir. On vérifie donc
 * non seulement le chemin nominal, mais aussi l'échec partiel, l'idempotence et
 * la traduction des erreurs techniques en messages exploitables.
 *
 * Supabase est remplacé par un double en mémoire : aucun réseau, aucune clé.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222'

interface UpsertCall {
  table: string
  rows: unknown
}

const remote = vi.hoisted(() => ({
  calls: [] as UpsertCall[],
  configured: true,
  /** Renvoie un message d'erreur pour faire échouer un `upsert` précis. */
  failure: null as null | ((table: string, rows: unknown) => string | null),
}))

vi.mock('@/lib/env', () => ({
  get isSupabaseConfigured() {
    return remote.configured
  },
}))

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => ({
      upsert: (rows: unknown) => {
        remote.calls.push({ table, rows })
        const message = remote.failure?.(table, rows) ?? null
        return Promise.resolve({ error: message ? { message } : null })
      },
    }),
  }),
}))

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
    // La file locale doit rester connue même sans réseau.
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
    expect(useSyncStore.getState().state).toBe('idle')
  })
})

describe('syncPendingOrders — envoi nominal', () => {
  it('envoie la commande et ses vêtements, puis les marque synchronisés', async () => {
    const { order, items } = await seedOrder()

    const result = await syncPendingOrders()

    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0, skipped: false })
    expect(remote.calls.map((call) => call.table)).toEqual(['orders', 'order_items'])

    const stored = await db.orders.get(order.id)
    expect(stored?.synced).toBe(1)
    expect(stored?.syncError).toBeNull()
    expect(stored?.syncedAt).not.toBeNull()

    // Les lignes envoyées portent bien le tenant et l'identifiant de commande.
    const sentItems = remote.calls[1]?.rows as Array<{ order_id: string; tenant_id: string }>
    expect(sentItems).toHaveLength(items.length)
    expect(sentItems[0]?.tenant_id).toBe(TENANT)
    expect(sentItems[0]?.order_id).toBe(order.id)

    expect(useSyncStore.getState().state).toBe('idle')
    expect(useSyncStore.getState().pendingCount).toBe(0)
    expect(useSyncStore.getState().lastSyncedAt).not.toBeNull()
  })

  it('n’envoie jamais les commandes d’un autre pressing', async () => {
    await seedOrder(OTHER_TENANT, 'Commande Yopougon')

    const result = await syncPendingOrders()

    expect(result.attempted).toBe(0)
    expect(remote.calls).toHaveLength(0)

    // La commande de l'autre pressing reste en attente, intacte.
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

describe('syncPendingOrders — échecs', () => {
  it('un échec sur une commande n’empêche pas les autres de partir', async () => {
    const failing = await seedOrder(TENANT, 'Costume')
    const healthy = await seedOrder(TENANT, 'Rideau')

    remote.failure = (table, rows) => {
      if (table !== 'orders') return null
      // On cible la commande par son identifiant, pas par son libellé : les
      // deux commandes de ce test ont le même client.
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
