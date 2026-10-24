import { db, type LocalOrder, type LocalOrderItem } from '@/db/localDb'
import { getSupabaseClient } from '@/lib/supabaseClient'
import type { OrderItemRow, OrderRow } from '@/types/database'

/**
 * Arbitrage d'un conflit de synchronisation (palier 1).
 *
 * Contexte : deux tablettes peuvent modifier la même commande hors ligne. Au
 * retour du réseau, la seconde est refusée par le verrou optimiste — on ne
 * l'écrase pas en silence. L'utilisateur choisit alors explicitement :
 *
 *  - **conserver la version locale** : on relit le numéro de version courant
 *    côté serveur et on le réutilise ; la prochaine synchronisation écrasera
 *    donc le serveur avec le contenu de cette tablette ;
 *  - **prendre la version du serveur** : on remplace la commande locale (et ses
 *    vêtements) par l'état distant, puis on la marque synchronisée.
 *
 * Dans les deux cas, aucune donnée n'est perdue sans que quelqu'un l'ait
 * décidé — c'est la différence avec un `upsert` qui écrase par défaut.
 */

export class ConflictResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictResolutionError'
  }
}

interface ServerOrder {
  order: OrderRow
  items: OrderItemRow[]
}

/** Lit l'état courant d'une commande sur le serveur (RLS : son pressing seul). */
async function fetchServerOrder(orderId: string): Promise<ServerOrder> {
  const supabase = getSupabaseClient()

  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle()

  if (error) {
    throw new ConflictResolutionError(
      'Impossible de lire la version du serveur : vérifiez votre connexion.',
    )
  }
  if (!order) {
    throw new ConflictResolutionError(
      'Cette commande n’existe plus sur le serveur. Contactez le propriétaire.',
    )
  }

  // Le filtre `tenant_id` est redondant avec la RLS, mais il rend la requête
  // explicitement bornée au pressing — la règle est vérifiée par le test
  // d'isolation statique (`tenantIsolation.test.ts`).
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .eq('tenant_id', order.tenant_id)

  if (itemsError) {
    throw new ConflictResolutionError('Impossible de lire les vêtements de cette commande.')
  }

  return { order, items: items ?? [] }
}

/**
 * Option 1 — garder le travail de cette tablette.
 * La version serveur est reprise telle quelle : la prochaine synchronisation
 * passera le verrou et imposera le contenu local.
 */
export async function keepLocalVersion(order: LocalOrder): Promise<void> {
  const { order: server } = await fetchServerOrder(order.id)

  await db.orders.update(order.id, {
    serverVersion: server.version,
    synced: 0,
    syncConflict: null,
    syncError: null,
  })
}

/**
 * Option 2 — adopter l'état du serveur.
 * La commande locale et ses vêtements sont remplacés, puis marqués synchronisés.
 */
export async function takeServerVersion(order: LocalOrder): Promise<void> {
  const { order: server, items } = await fetchServerOrder(order.id)

  const localItems: LocalOrderItem[] = items.map((item) => ({
    id: item.id,
    orderId: item.order_id,
    tenantId: item.tenant_id,
    label: item.label,
    fabricType: item.fabric_type,
    specialInstructions: item.special_instructions,
    price: item.price,
    quantity: item.quantity ?? 1,
    billedQuantity: item.billed_quantity ?? item.quantity ?? 1,
    billingUnit: item.billing_unit ?? 'PIECE',
    unitPrice: item.unit_price ?? item.price,
    pricingMode: item.pricing_mode ?? 'FIXED',
    priceStatus: item.price_status ?? 'CONFIRMED',
    // Les snapshots absents désignent une ancienne ligne libre/historique.
    catalogEntryId: item.catalog_entry_id ?? null,
    articleName: item.article_name ?? null,
    serviceName: item.service_name ?? null,
    familyNameSnapshot: item.family_name_snapshot ?? null,
    catalogUnitPriceSnapshot: item.catalog_unit_price_snapshot ?? null,
    minimumQuantitySnapshot: item.minimum_quantity_snapshot ?? null,
    billingIncrementSnapshot: item.billing_increment_snapshot ?? null,
    minimumChargeSnapshot: item.minimum_charge_snapshot ?? null,
    conditionsSnapshot: item.conditions_snapshot ?? null,
    priceReason: item.price_reason ?? null,
  }))

  const localOrder: LocalOrder = {
    ...order,
    customerName: server.customer_name,
    customerPhone: server.customer_phone,
    status: server.status,
    qrCode: server.qr_code,
    photoUrl: server.photo_url,
    totalAmount: server.total_amount,
    paymentStatus: server.payment_status,
    paymentMethod: server.payment_method,
    createdAt: server.created_at,
    updatedAt: server.updated_at,
    dueDate: server.due_date ?? null,
    synced: 1,
    syncedAt: new Date().toISOString(),
    serverVersion: server.version,
    syncError: null,
    syncConflict: null,
  }

  await db.transaction('rw', db.orders, db.orderItems, async () => {
    await db.orders.put(localOrder)
    await db.orderItems.where('orderId').equals(order.id).delete()
    if (localItems.length > 0) await db.orderItems.bulkAdd(localItems)
  })
}
