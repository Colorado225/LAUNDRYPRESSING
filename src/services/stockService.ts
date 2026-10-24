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
  supplierId?: string | null
  reason?: string | null
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
