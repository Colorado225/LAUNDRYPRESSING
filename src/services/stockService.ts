import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'
import type { StockCategory, StockItemRow, StockMovementRow, StockUnit, SupplierRow } from '@/types/database'

/**
 * Stocks et fournisseurs (palier 3).
 *
 * La quantité d'un article n'est jamais écrite directement : elle est la somme
 * de ses mouvements, tenue par un déclencheur serveur. Le client se contente
 * d'enregistrer des entrées et des sorties, ce qui rend le stock auditable.
 *
 * Ces écrans de gestion fonctionnent **en ligne** (bureau), contrairement au
 * comptoir.
 */

export const STOCK_CATEGORY_LABELS: Record<StockCategory, string> = {
  produit: 'Produit',
  emballage: 'Emballage',
  consommable: 'Consommable',
  autre: 'Autre',
}

export const STOCK_UNITS: StockUnit[] = ['pièce', 'litre', 'kg', 'flacon', 'rouleau']

/** Libellé d'unité au pluriel utile (les quantités sont souvent > 1). */
export const STOCK_UNIT_LABELS: Record<StockUnit, string> = {
  pièce: 'pièces',
  litre: 'litres',
  kg: 'kg',
  flacon: 'flacons',
  rouleau: 'rouleaux',
}

/** Un article est « bas » dès qu'il atteint son seuil d'alerte. */
export function isLowStock(item: Pick<StockItemRow, 'quantity' | 'min_quantity' | 'is_active'>): boolean {
  return item.is_active && Number(item.quantity) <= Number(item.min_quantity)
}

/** Traduit les erreurs PostgreSQL en message exploitable au comptoir. */
export function stockErrorMessage(message: string): string {
  if (message.includes('Stock insuffisant')) return message
  if (message.includes('duplicate key') || message.includes('stock_items_name_unique')) {
    return 'Un article porte déjà ce nom dans ce pressing.'
  }
  if (message.includes('suppliers_name_unique') || message.includes('duplicate key value')) {
    return 'Ce fournisseur existe déjà.'
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Réseau indisponible : la gestion du stock nécessite une connexion.'
  }
  if (message.includes('row-level security')) {
    return "Votre rôle ne permet pas cette action sur le stock."
  }
  return message
}

function requireClient() {
  if (!isSupabaseConfigured) {
    throw new Error('La gestion du stock nécessite une connexion.')
  }
  return getSupabaseClient()
}

export async function listStockItems(tenantId: string): Promise<StockItemRow[]> {
  const { data, error } = await requireClient()
    .from('stock_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

  if (error) throw new Error(stockErrorMessage(error.message))
  return data ?? []
}

export interface CreateStockItemInput {
  name: string
  category: StockCategory
  unit: StockUnit
  minQuantity: number
  unitCost: number | null
  initialQuantity: number
}

export async function createStockItem(
  tenantId: string,
  input: CreateStockItemInput,
): Promise<StockItemRow> {
  const supabase = requireClient()

  const { data, error } = await supabase
    .from('stock_items')
    .insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      category: input.category,
      unit: input.unit,
      min_quantity: Math.max(0, input.minQuantity),
      unit_cost: input.unitCost,
    })
    .select('*')
    .maybeSingle()

  if (error) throw new Error(stockErrorMessage(error.message))
  if (!data) throw new Error('Article non créé : vérifiez vos droits.')

  // Une quantité de départ est un mouvement d'entrée, jamais une écriture
  // directe : le stock reste la somme de son journal.
  if (input.initialQuantity > 0) {
    await recordStockMovement(tenantId, {
      itemId: data.id,
      kind: 'in',
      quantity: input.initialQuantity,
      unitCost: input.unitCost,
      reason: 'Stock initial',
    })
  }

  return data
}

export async function updateStockItem(
  tenantId: string,
  itemId: string,
  patch: Partial<Pick<StockItemRow, 'name' | 'min_quantity' | 'unit_cost' | 'is_active'>>,
): Promise<void> {
  const { error } = await requireClient()
    .from('stock_items')
    .update(patch)
    .eq('tenant_id', tenantId)
    .eq('id', itemId)

  if (error) throw new Error(stockErrorMessage(error.message))
}

export interface MovementInput {
  itemId: string
  kind: 'in' | 'out'
  quantity: number
  unitCost?: number | null
  orderItemId?: string | null
  supplierId?: string | null
  reason?: string | null
}

export interface StockOrderItemChoice {
  orderItemId: string
  orderId: string
  customerName: string
  createdAt: string
  label: string
  amount: number
}

export interface StockConsumptionCost {
  order_item_id: string
  cost_amount: number
  missing_cost_movements: number
}

/** Lignes récentes proposées pour imputer une consommation réelle. */
export async function listRecentStockOrderItems(tenantId: string): Promise<StockOrderItemChoice[]> {
  const supabase = requireClient()
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, customer_name, created_at, status')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(100)
  if (ordersError) throw new Error(stockErrorMessage(ordersError.message))

  const orderRows = orders ?? []
  if (orderRows.length === 0) return []
  const orderIds = orderRows.map((order) => order.id)
  const { data: lines, error: linesError } = await supabase
    .from('order_items')
    .select('id, order_id, label, service_name, laundry_model_name_snapshot, price')
    .eq('tenant_id', tenantId)
    .in('order_id', orderIds)
  if (linesError) throw new Error(stockErrorMessage(linesError.message))

  const byId = new Map(orderRows.map((order) => [order.id, order]))
  return (lines ?? []).flatMap((line) => {
    const order = byId.get(line.order_id)
    if (!order) return []
    return [{
      orderItemId: line.id,
      orderId: line.order_id,
      customerName: order.customer_name,
      createdAt: order.created_at,
      label: line.laundry_model_name_snapshot || line.service_name || line.label,
      amount: line.price,
    }]
  })
}

/** Coûts unitaires figés, agrégés par ligne de commande côté serveur. */
export async function listStockConsumptionCosts(
  tenantId: string,
  orderItemIds: string[],
): Promise<StockConsumptionCost[]> {
  if (!tenantId.trim()) throw new Error('Pressing actif introuvable.')
  const ids = [...new Set(orderItemIds)]
  if (ids.length === 0) return []
  const batches: string[][] = []
  for (let offset = 0; offset < ids.length; offset += 500) {
    batches.push(ids.slice(offset, offset + 500))
  }
  const responses = await Promise.all(batches.map(async (batch) => {
    const { data, error } = await requireClient().rpc('report_stock_consumption_costs', {
      p_order_item_ids: batch,
    })
    if (error) throw new Error(stockErrorMessage(error.message))
    return data ?? []
  }))
  return responses.flat().map((row) => ({
    order_item_id: row.order_item_id,
    cost_amount: Number(row.cost_amount),
    missing_cost_movements: Number(row.missing_cost_movements),
  }))
}


export async function recordStockMovement(
  tenantId: string,
  input: MovementInput,
): Promise<void> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('Indiquez une quantité supérieure à zéro.')
  }

  const { error } = await requireClient()
    .from('stock_movements')
    .insert({
      tenant_id: tenantId,
      item_id: input.itemId,
      kind: input.kind,
      quantity: input.quantity,
      unit_cost: input.unitCost ?? null,
      order_item_id: input.kind === 'out' ? input.orderItemId ?? null : null,
      supplier_id: input.supplierId ?? null,
      reason: input.reason?.trim() ? input.reason.trim() : null,
    })

  if (error) throw new Error(stockErrorMessage(error.message))
}

export async function listStockMovements(
  tenantId: string,
  limit = 40,
): Promise<StockMovementRow[]> {
  const { data, error } = await requireClient()
    .from('stock_movements')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(stockErrorMessage(error.message))
  return data ?? []
}

export async function listSuppliers(tenantId: string): Promise<SupplierRow[]> {
  const { data, error } = await requireClient()
    .from('suppliers')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

  if (error) throw new Error(stockErrorMessage(error.message))
  return data ?? []
}

export async function createSupplier(
  tenantId: string,
  input: { name: string; phone: string | null; notes: string | null },
): Promise<SupplierRow> {
  const { data, error } = await requireClient()
    .from('suppliers')
    .insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      phone: input.phone?.trim() ? input.phone.trim() : null,
      notes: input.notes?.trim() ? input.notes.trim() : null,
    })
    .select('*')
    .maybeSingle()

  if (error) throw new Error(stockErrorMessage(error.message))
  if (!data) throw new Error('Fournisseur non créé : vérifiez vos droits.')
  return data
}
