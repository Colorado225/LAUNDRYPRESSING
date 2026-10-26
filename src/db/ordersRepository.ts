import type {
  OrderItemRow,
  OrderRow,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@/types/database'
import { ACTIVE_ORDER_STATUSES } from '@/constants/orders'
import { buildQrString, newId, nowIso } from '@/lib/ids'
import { calculerTarif } from '@/lib/catalogPricing'
import { calculateLaundryModelPrice } from '@/lib/laundryModelPricing'
import {
  createOrderSchema,
  orderItemMeasurementSchema,
  type CreateOrderInput,
  type UpdateOrderItemMeasurementInput,
} from '@/schemas/order'
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
  const validated = createOrderSchema.parse(input)
  const createdAt = nowIso()
  const orderId = newId()

  const items: LocalOrderItem[] = validated.items.map((item) => {
    const quantity = item.quantity ?? 1
    const billingUnit = item.billingUnit ?? 'PIECE'
    const unitPrice = item.unitPrice ?? item.price
    const calculated = calculerTarif({
      quantite: quantity,
      prixUnitaire: unitPrice,
      unite: billingUnit,
      quantiteMinimum: item.minimumQuantitySnapshot,
      increment: item.billingIncrementSnapshot,
      minimumFacturable: item.minimumChargeSnapshot,
    })

    if (item.laundryModelId && item.laundryModelTypeSnapshot && item.laundryWeightKg) {
      const modelPrice = calculateLaundryModelPrice({
        model_type: item.laundryModelTypeSnapshot,
        price_per_kg: item.laundryPricePerKgSnapshot ?? null,
        package_price: item.laundryPackagePriceSnapshot ?? null,
        included_weight_kg: item.laundryIncludedWeightKgSnapshot ?? null,
        overage_price_per_kg: item.laundryOveragePricePerKgSnapshot ?? null,
        minimum_weight_kg: item.laundryMinimumWeightKgSnapshot ?? null,
        billing_increment_kg: item.laundryBillingIncrementKgSnapshot ?? null,
        minimum_charge: item.laundryMinimumChargeSnapshot ?? null,
      }, item.laundryWeightKg)
      if (modelPrice.status === 'PRICED' && modelPrice.amount !== calculated.total) {
        throw new Error('Le montant de la ligne ne correspond pas au modèle commercial sélectionné.')
      }
      if (modelPrice.status === 'QUOTE' && calculated.total < (item.laundryPackagePriceSnapshot ?? 0)) {
        throw new Error('Le montant validé ne peut pas être inférieur au prix du forfait.')
      }
    }

    return {
      id: newId(),
      orderId,
      tenantId,
      label: item.label,
      fabricType: item.fabricType?.trim() ? item.fabricType.trim() : null,
      specialInstructions: item.specialInstructions?.trim()
        ? item.specialInstructions.trim()
        : null,
      price: calculated.total,
      quantity,
      billedQuantity: calculated.quantiteFacturee,
      billingUnit,
      unitPrice,
      pricingMode: item.pricingMode ?? 'FIXED',
      priceStatus: item.priceStatus ?? 'CONFIRMED',
      catalogEntryId: item.catalogEntryId ?? null,
      articleName: item.articleName?.trim() ? item.articleName.trim() : null,
      serviceName: item.serviceName?.trim() ? item.serviceName.trim() : null,
      tenantServiceId: item.tenantServiceId ?? null,
      activityNameSnapshot: item.activityNameSnapshot?.trim() ? item.activityNameSnapshot.trim() : null,
      familyNameSnapshot: item.familyNameSnapshot ?? null,
      catalogUnitPriceSnapshot: item.catalogUnitPriceSnapshot ?? null,
      minimumQuantitySnapshot: item.minimumQuantitySnapshot ?? null,
      billingIncrementSnapshot: item.billingIncrementSnapshot ?? null,
      minimumChargeSnapshot: item.minimumChargeSnapshot ?? null,
      conditionsSnapshot: item.conditionsSnapshot ?? null,
      priceReason: item.priceReason?.trim() ? item.priceReason.trim() : null,
      laundryModelId: item.laundryModelId ?? null,
      laundryModelNameSnapshot: item.laundryModelNameSnapshot ?? null,
      laundryModelTypeSnapshot: item.laundryModelTypeSnapshot ?? null,
      laundryWeightKg: item.laundryWeightKg ?? null,
      laundryPriceBreakdownSnapshot: item.laundryPriceBreakdownSnapshot ?? null,
      laundryServicesSnapshot: item.laundryServicesSnapshot ?? null,
      laundryPricePerKgSnapshot: item.laundryPricePerKgSnapshot ?? null,
      laundryPackagePriceSnapshot: item.laundryPackagePriceSnapshot ?? null,
      laundryIncludedWeightKgSnapshot: item.laundryIncludedWeightKgSnapshot ?? null,
      laundryOveragePricePerKgSnapshot: item.laundryOveragePricePerKgSnapshot ?? null,
      laundryMinimumWeightKgSnapshot: item.laundryMinimumWeightKgSnapshot ?? null,
      laundryBillingIncrementKgSnapshot: item.laundryBillingIncrementKgSnapshot ?? null,
      laundryMinimumChargeSnapshot: item.laundryMinimumChargeSnapshot ?? null,
      familyPackageSnapshot: item.familyPackageSnapshot ?? null,
      garmentDetails: item.garmentDetails ?? [],
    }
  })

  const order: LocalOrder = {
    id: orderId,
    tenantId,
    customerName: validated.customerName,
    customerPhone: validated.customerPhone,
    status: 'received',
    qrCode: buildQrString(tenantId, orderId),
    photoUrl: null,
    totalAmount: items.reduce((total, item) => total + item.price, 0),
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt,
    updatedAt: createdAt,
    dueDate: validated.dueDate ?? null,
    assignedTo: validated.assignedTo ?? null,
    assignedAt: null,
    statusReason: null,
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
 * Confirme ou corrige une mesure de ligne en transaction locale unique.
 *
 * Le prix unitaire et les paramètres du catalogue restent figés. Seuls la
 * quantité mesurée, sa confirmation, le total de ligne et le total commande
 * changent. L'upsert de la ligne au retour du réseau déclenche l'historique
 * tarifaire serveur, sans toucher aux états de paiement.
 */
export async function updateOrderItemMeasurementLocal(
  tenantId: string,
  orderId: string,
  itemId: string,
  input: UpdateOrderItemMeasurementInput,
): Promise<{ order: LocalOrder; item: LocalOrderItem }> {
  const validated = orderItemMeasurementSchema.parse(input)

  return db.transaction('rw', db.orders, db.orderItems, async () => {
    const order = await db.orders.get(orderId)
    const item = await db.orderItems.get(itemId)
    if (!order || !item || item.orderId !== orderId) {
      throw new Error('Commande ou ligne introuvable dans la base locale.')
    }
    if (order.tenantId !== tenantId || item.tenantId !== tenantId) {
      throw new Error('Cette ligne n’appartient pas au pressing sélectionné.')
    }
    if (order.status === 'delivered' || order.status === 'cancelled') {
      throw new Error('Une commande terminée ou annulée ne peut plus être corrigée.')
    }
    if (order.paymentStatus === 'paid') {
      throw new Error('La commande est soldée : corrigez-la après régularisation du paiement.')
    }
    if (item.billingUnit === 'FLAT') {
      throw new Error('Un forfait ne comporte pas de mesure à confirmer.')
    }

    const calcul = calculerTarif({
      quantite: validated.quantity,
      prixUnitaire: item.unitPrice,
      unite: item.billingUnit,
      quantiteMinimum: item.minimumQuantitySnapshot,
      increment: item.billingIncrementSnapshot,
      minimumFacturable: item.minimumChargeSnapshot,
    })
    let laundryBreakdown = item.laundryPriceBreakdownSnapshot
    if (item.laundryModelId && item.laundryModelTypeSnapshot === 'PER_KG') {
      const result = calculateLaundryModelPrice({
        model_type: 'PER_KG',
        price_per_kg: item.laundryPricePerKgSnapshot ?? null,
        package_price: null,
        included_weight_kg: null,
        overage_price_per_kg: null,
        minimum_weight_kg: item.laundryMinimumWeightKgSnapshot ?? null,
        billing_increment_kg: item.laundryBillingIncrementKgSnapshot ?? null,
        minimum_charge: item.laundryMinimumChargeSnapshot ?? null,
      }, validated.quantity)
      if (result.status !== 'PRICED' || result.amount !== calcul.total) {
        throw new Error('Le poids ne correspond plus au tarif du modèle commercial.')
      }
      laundryBreakdown = result.breakdown
    }

    const itemMisAJour: LocalOrderItem = {
      ...item,
      quantity: calcul.quantiteMesuree,
      billedQuantity: calcul.quantiteFacturee,
      price: calcul.total,
      priceStatus: validated.priceStatus,
      ...(item.laundryModelId ? { laundryWeightKg: validated.quantity, laundryPriceBreakdownSnapshot: laundryBreakdown } : {}),
    }

    if (
      itemMisAJour.quantity === item.quantity &&
      itemMisAJour.billedQuantity === item.billedQuantity &&
      itemMisAJour.price === item.price &&
      itemMisAJour.priceStatus === item.priceStatus
    ) {
      return { order, item }
    }

    const toutesLesLignes = await db.orderItems.where('orderId').equals(orderId).toArray()
    const nouveauTotal = toutesLesLignes.reduce(
      (total, ligne) => total + (ligne.id === itemId ? itemMisAJour.price : ligne.price),
      0,
    )
    if (!Number.isSafeInteger(nouveauTotal)) {
      throw new Error('Le total de la commande dépasse le montant pris en charge.')
    }

    const commandeMiseAJour: LocalOrder = {
      ...order,
      totalAmount: nouveauTotal,
      updatedAt: nowIso(),
      synced: 0,
      syncError: null,
    }
    await db.orderItems.put(itemMisAJour)
    await db.orders.put(commandeMiseAJour)
    return { order: commandeMiseAJour, item: itemMisAJour }
  })
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
  reason: string | null = null,
): Promise<LocalOrder> {
  const existing = await db.orders.get(orderId)
  if (!existing) throw new Error('Commande introuvable en base locale')

  const updated: LocalOrder = {
    ...existing,
    status,
    // Le motif accompagne CE changement ; il sera effacé côté serveur une fois
    // journalisé dans l'historique.
    statusReason: reason?.trim() ? reason.trim() : null,
    updatedAt: nowIso(),
    synced: 0,
    syncError: null,
    // Un changement local ne résout pas un conflit : il le laisse ouvert.
    syncConflict: existing.syncConflict ?? null,
  }

  await db.orders.put(updated)
  return updated
}

/**
 * Change l'échéance d'une commande, en local uniquement.
 *
 * L'échéance est un champ métier : sa modification incrémente la version
 * serveur et repasse donc la commande en file de synchronisation.
 */
export async function updateOrderDueDateLocal(
  orderId: string,
  dueDate: string | null,
): Promise<LocalOrder> {
  const existing = await db.orders.get(orderId)
  if (!existing) throw new Error('Commande introuvable en base locale')

  const updated: LocalOrder = {
    ...existing,
    dueDate,
    updatedAt: nowIso(),
    synced: 0,
    syncError: null,
  }

  await db.orders.put(updated)
  return updated
}

/**
 * Attribue la commande à un employé (ou la remet dans le pot commun).
 *
 * Écriture locale d'abord : l'attribution se fait à l'atelier, souvent sans
 * réseau. Le serveur vérifie ensuite que l'employé appartient bien au pressing.
 */
export async function updateOrderAssignmentLocal(
  orderId: string,
  assignedTo: string | null,
): Promise<LocalOrder> {
  const existing = await db.orders.get(orderId)
  if (!existing) throw new Error('Commande introuvable en base locale')

  const updated: LocalOrder = {
    ...existing,
    assignedTo,
    assignedAt: assignedTo ? nowIso() : null,
    updatedAt: nowIso(),
    synced: 0,
    syncError: null,
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

/**
 * État minimal d'une commande tel que renvoyé par la lecture serveur.
 * Volontairement restreint : la synchronisation descendante ne doit jamais
 * écraser les vêtements ni les champs saisis localement.
 */
export interface RemoteOrderState {
  id: string
  version: number
  status: OrderStatus
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  total_amount: number
  due_date: string | null
  assigned_to: string | null
  updated_at: string
}

/**
 * Applique une modification venue d'un autre appareil.
 *
 * Trois refus explicites :
 *  - commande absente en local (elle vient d'un autre poste : sans ses
 *    vêtements, la créer ici donnerait une fiche incomplète) ;
 *  - travail local en attente (`synced = 0`) ou conflit non arbitré : la
 *    version du serveur n'est pas forcément la plus récente pour cette tablette ;
 *  - version identique ou plus ancienne : rien à faire.
 */
export async function applyRemoteOrderState(remote: RemoteOrderState): Promise<boolean> {
  const local = await db.orders.get(remote.id)
  if (!local) return false
  if (local.synced === 0 || local.syncConflict) return false
  if (remote.version <= local.serverVersion) return false

  await db.orders.update(local.id, {
    status: remote.status,
    paymentStatus: remote.payment_status,
    paymentMethod: remote.payment_method,
    totalAmount: remote.total_amount,
    dueDate: remote.due_date,
    assignedTo: remote.assigned_to,
    // L'état distant ne porte pas de motif : celui-ci a déjà été journalisé.
    statusReason: null,
    serverVersion: remote.version,
    updatedAt: remote.updated_at,
    synced: 1 satisfies SyncFlag,
  })

  return true
}

/**
 * Reflète un encaissement au comptoir confirmé par le serveur.
 *
 * On ne touche ni à `synced` ni à `serverVersion` : le statut de paiement est
 * écrit par le serveur et n'incrémente pas la version métier (voir la
 * migration 003), il n'y a donc rien à renvoyer.
 */
export async function applyRemoteCashState(
  orderId: string,
  remaining: number,
  method: PaymentMethod,
): Promise<void> {
  await db.orders.update(orderId, {
    paymentStatus: remaining <= 0 ? 'paid' : 'partial',
    paymentMethod: method,
  })
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
    due_date: order.dueDate,
    assigned_to: order.assignedTo,
    assigned_at: order.assignedAt,
    status_reason: order.statusReason,
    // Trace explicite : la ligne provient du mode hors ligne.
    synced_from_local: true,
    // À l'insertion, la version serveur est 1 ; en mise à jour, le trigger
    // `bump_order_version` écrase cette valeur, elle n'est donc qu'indicative.
    version: order.serverVersion > 0 ? order.serverVersion : 1,
  }
}

export function toSupabaseOrderItem(item: LocalOrderItem): OrderItemRow {
  // Le schéma ne conserve plus de clé vers le catalogue ou les modèles
  // commerciaux. Les informations génériques de la ligne restent figées pour
  // préserver les reçus et les quantités historiques.
  return {
    id: item.id,
    order_id: item.orderId,
    tenant_id: item.tenantId,
    label: item.label,
    fabric_type: item.fabricType,
    special_instructions: item.specialInstructions,
    price: item.price,
    quantity: item.quantity,
    billed_quantity: item.billedQuantity,
    billing_unit: item.billingUnit,
    unit_price: item.unitPrice,
    pricing_mode: item.pricingMode,
    price_status: item.priceStatus,
    article_name: item.articleName,
    service_name: item.serviceName,
    tenant_service_id: item.tenantServiceId ?? null,
    activity_name_snapshot: item.activityNameSnapshot ?? null,
    family_name_snapshot: item.familyNameSnapshot,
    catalog_unit_price_snapshot: item.catalogUnitPriceSnapshot,
    minimum_quantity_snapshot: item.minimumQuantitySnapshot,
    billing_increment_snapshot: item.billingIncrementSnapshot,
    minimum_charge_snapshot: item.minimumChargeSnapshot,
    conditions_snapshot: item.conditionsSnapshot,
    price_reason: item.priceReason,
    garment_details: item.garmentDetails ?? [],
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
    .anyOf(ACTIVE_ORDER_STATUSES.map((status) => [tenantId, status]))
    .toArray()

  return orders.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
