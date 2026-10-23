import type { OrderItemRow, OrderRow, OrderStatus } from '@/types/database'
import { buildQrString, newId, nowIso } from '@/lib/ids'
import type { CreateOrderInput } from '@/schemas/order'
import {
  db,
  type LocalOrder,
  type LocalOrderItem,
  type SyncFlag,
} from './localDb'

/**
 * Accès aux commandes locales.
 *
 * Toutes les fonctions sont volontairement indépendantes de React et du store
 * de tenant : elles reçoivent `tenantId` en paramètre. Cela les rend testables
 * et réutilisables par le moteur de synchronisation.
 */

export interface LocalOrderWithItems {
  order: LocalOrder
  items: LocalOrderItem[]
}

/** Crée une commande COMPLÈTE en local (transaction unique), sans réseau. */
export async function createOrderLocal(
  tenantId: string,
  input: CreateOrderInput,
): Promise<LocalOrderWithItems> {
  const createdAt = nowIso()
  const orderId = newId()

  const items: LocalOrderItem[] = input.items.map((item) => ({
    id: newId(),
    orderId,
    tenantId,
    label: item.label,
    fabricType: item.fabricType?.trim() ? item.fabricType.trim() : null,
    specialInstructions: item.specialInstructions?.trim()
      ? item.specialInstructions.trim()
      : null,
    price: item.price,
  }))

  const order: LocalOrder = {
    id: orderId,
    tenantId,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    status: 'received',
    qrCode: buildQrString(tenantId, orderId),
    photoUrl: null,
    totalAmount: items.reduce((total, item) => total + item.price, 0),
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt,
    updatedAt: createdAt,
    // Une commande neuve n'existe pas encore côté serveur.
    synced: 0,
    syncedAt: null,
    serverVersion: 0,
    syncError: null,
    syncConflict: null,
  }

  await db.transaction('rw', db.orders, db.orderItems, async () => {
    await db.orders.add(order)
    await db.orderItems.bulkAdd(items)
  })

  return { order, items }
}

/**
 * Change le statut d'une commande, en local uniquement.
 *
 * La commande redevient « à synchroniser » (synced = 0) : le moteur enverra
 * l'état complet au retour du réseau. L'historique détaillé des statuts est
 * construit côté serveur par trigger ; en mode avion, seul l'état final est
 * transmis (limite documentée du MVP, cf. README).
 */
export async function updateOrderStatusLocal(
  orderId: string,
  status: OrderStatus,
): Promise<LocalOrder> {
  const existing = await db.orders.get(orderId)
  if (!existing) throw new Error('Commande introuvable en base locale')

  const updated: LocalOrder = {
    ...existing,
    status,
    updatedAt: nowIso(),
    synced: 0,
    syncError: null,
    // Un changement local ne résout pas un conflit : il le laisse ouvert.
    syncConflict: existing.syncConflict ?? null,
  }

  await db.orders.put(updated)
  return updated
}

/** Récupère une commande et ses vêtements. */
export async function getOrderWithItems(orderId: string): Promise<LocalOrderWithItems | null> {
  const order = await db.orders.get(orderId)
  if (!order) return null
  const items = await db.orderItems.where('orderId').equals(orderId).toArray()
  return { order, items }
}

/** Commandes à synchroniser pour un pressing donné, les plus anciennes d'abord. */
export async function getPendingOrders(tenantId: string): Promise<LocalOrder[]> {
  return db.orders.where('[tenantId+synced]').equals([tenantId, 0]).sortBy('createdAt')
}

/** Nombre de commandes en attente d'envoi (badge, indicateur de synchro). */
export async function countPendingOrders(tenantId: string): Promise<number> {
  return db.orders.where('[tenantId+synced]').equals([tenantId, 0]).count()
}

/** Marque une commande comme synchronisée et mémorise la version serveur. */
export async function markOrderSynced(orderId: string, serverVersion: number): Promise<void> {
  const syncedAt = nowIso()
  await db.orders.update(orderId, {
    synced: 1 satisfies SyncFlag,
    syncedAt,
    serverVersion,
    syncError: null,
    syncConflict: null,
  })
}

/** Mémorise la version serveur sans marquer la commande comme synchronisée. */
export async function updateOrderServerVersion(orderId: string, version: number): Promise<void> {
  await db.orders.update(orderId, { serverVersion: version })
}

/** Conserve la commande en file et mémorise la raison de l'échec. */
export async function markOrderSyncError(orderId: string, message: string): Promise<void> {
  await db.orders.update(orderId, { synced: 0, syncError: message })
}

/**
 * Le serveur a refusé la mise à jour : la commande a été modifiée ailleurs.
 * On conserve la version locale intacte et on arrête les tentatives jusqu'à ce
 * que l'utilisateur choisisse (voir `orderConflictService`).
 */
export async function markOrderSyncConflict(orderId: string, message: string): Promise<void> {
  await db.orders.update(orderId, { synced: 0, syncError: message, syncConflict: message })
}

/** Rouvre une commande après arbitrage d'un conflit (jeton serveur à jour). */
export async function reopenOrderForSync(
  orderId: string,
  serverVersion: number | null,
): Promise<void> {
  const patch: Partial<LocalOrder> = {
    synced: 0,
    syncConflict: null,
    syncError: null,
  }
  if (serverVersion !== null) patch.serverVersion = serverVersion
  await db.orders.update(orderId, patch)
}

/** Récupère les vêtements d'une commande (usage interne au moteur de synchro). */
export async function getOrderItems(orderId: string): Promise<LocalOrderItem[]> {
  return db.orderItems.where('orderId').equals(orderId).toArray()
}

// -----------------------------------------------------------------------------
// Correspondance avec le schéma Supabase (snake_case)
// -----------------------------------------------------------------------------

export function toSupabaseOrder(order: LocalOrder): OrderRow {
  return {
    id: order.id,
    tenant_id: order.tenantId,
    customer_name: order.customerName,
    customer_phone: order.customerPhone,
    status: order.status,
    qr_code: order.qrCode,
    photo_url: order.photoUrl,
    total_amount: order.totalAmount,
    payment_status: order.paymentStatus,
    payment_method: order.paymentMethod,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    // Trace explicite : la ligne provient du mode hors ligne.
    synced_from_local: true,
    // À l'insertion, la version serveur est 1 ; en mise à jour, le trigger
    // `bump_order_version` écrase cette valeur, elle n'est donc qu'indicative.
    version: order.serverVersion > 0 ? order.serverVersion : 1,
  }
}

export function toSupabaseOrderItem(item: LocalOrderItem): OrderItemRow {
  return {
    id: item.id,
    order_id: item.orderId,
    tenant_id: item.tenantId,
    label: item.label,
    fabric_type: item.fabricType,
    special_instructions: item.specialInstructions,
    price: item.price,
  }
}

/**
 * Recherche une commande par le contenu de son QR Code (phase 3).
 *
 * Le scan peut renvoyer :
 *  - la chaîne exacte stockée (`qrCode`) → correspondance directe ;
 *  - un code légèrement différent (étiquette réimprimée avec un autre
 *    horodatage) → repli sur l'identifiant de commande extrait du QR.
 *
 * `tenantId` est vérifié côté client pour prévenir le scan d'une étiquette
 * appartenant à un autre pressing ; la RLS reste la sécurité de référence.
 */
export async function findOrderByQrCode(
  tenantId: string,
  decodedText: string,
): Promise<LocalOrderWithItems | { foreignTenantId: string } | null> {
  const trimmed = decodedText.trim()

  const direct = await db.orders.where('qrCode').equals(trimmed).first()
  const order =
    direct ??
    (await findOrderByShortReference(tenantId, trimmed)) ??
    (await findOrderByParsedQr(trimmed))

  if (!order) return null

  // Étiquette d'un autre pressing : on ne divulgue aucune donnée client.
  if (order.tenantId !== tenantId) {
    return { foreignTenantId: order.tenantId }
  }

  const items = await db.orderItems.where('orderId').equals(order.id).toArray()
  return { order, items }
}

/**
 * Repli sur la référence courte imprimée (`CMD-7F3A2B`) saisie à la main,
 * lorsque le QR Code est illisible.
 */
async function findOrderByShortReference(
  tenantId: string,
  input: string,
): Promise<LocalOrder | undefined> {
  const match = /^CMD-([0-9a-f]{6})$/i.exec(input)
  if (!match?.[1]) return undefined

  const suffix = match[1].toUpperCase()
  const candidates = await db.orders.where('tenantId').equals(tenantId).toArray()
  return candidates.find((order) => order.id.replace(/-/g, '').slice(-6).toUpperCase() === suffix)
}

async function findOrderByParsedQr(decodedText: string): Promise<LocalOrder | undefined> {
  // Import dynamique volontaire : la librairie `qrcode` (~50 Ko) ne doit être
  // chargée que lors d'un scan, pas au démarrage de la liste des commandes.
  const { parseQrString } = await import('@/services/qrService')
  const parsed = parseQrString(decodedText)
  if (!parsed) return undefined
  return db.orders.get(parsed.orderId)
}

/** Commandes actuellement en atelier (hors « livrée » et « annulée »). */
export async function getWorkshopOrders(tenantId: string): Promise<LocalOrder[]> {
  const orders = await db.orders
    .where('[tenantId+status]')
    .anyOf([
      [tenantId, 'received'],
      [tenantId, 'washing'],
      [tenantId, 'ironing'],
      [tenantId, 'ready'],
    ])
    .toArray()

  return orders.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
