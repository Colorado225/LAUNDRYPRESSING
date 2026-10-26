import {
  db,
  type LocalCatalogGarment,
  type LocalCatalogPrice,
} from '@/db/localDb'
import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import type { CatalogBillingUnit } from '@/types/database'

/**
 * Accès au catalogue du pressing (Lot 1, migration 027).
 *
 * Même patron que `tenantServices.ts` : Supabase fait foi en ligne, Dexie sert
 * de cache hors ligne pour vendre sans connexion. Les écritures (articles,
 * prix) exigent une connexion — ce sont des actes de configuration du
 * propriétaire, jamais des gestes comptoir en urgence.
 */

export interface CatalogConfiguration {
  garments: LocalCatalogGarment[]
  prices: LocalCatalogPrice[]
}

export interface CatalogCategory {
  id: string
  tenantId: string | null
  code: string
  name: string
  sortOrder: number
  isSystem: boolean
}

async function localConfiguration(tenantId: string): Promise<CatalogConfiguration> {
  const [garments, prices] = await Promise.all([
    db.catalogGarments.where('tenantId').equals(tenantId).toArray(),
    db.catalogPrices.where('tenantId').equals(tenantId).toArray(),
  ])
  return { garments, prices }
}

async function replaceLocalConfiguration(
  tenantId: string,
  configuration: CatalogConfiguration,
): Promise<void> {
  await db.transaction('rw', [db.catalogGarments, db.catalogPrices], async () => {
    await Promise.all([
      db.catalogGarments.where('tenantId').equals(tenantId).delete(),
      db.catalogPrices.where('tenantId').equals(tenantId).delete(),
    ])
    if (configuration.garments.length > 0) await db.catalogGarments.bulkAdd(configuration.garments)
    if (configuration.prices.length > 0) await db.catalogPrices.bulkAdd(configuration.prices)
  })
}

/** Charge articles + prix depuis Supabase et met à jour le cache hors ligne. */
export async function fetchCatalogConfiguration(tenantId: string): Promise<CatalogConfiguration> {
  if (!isSupabaseConfigured || !navigator.onLine) return localConfiguration(tenantId)

  const supabase = getSupabaseClient()
  const [categoriesResult, garmentsResult, pricesResult] = await Promise.all([
    supabase
      .from('garment_categories')
      .select('id, code, name')
      .eq('tenant_id', tenantId),
    supabase
      .from('garment_types')
      .select('id, tenant_id, category_id, code, name, icon_key, default_unit, is_delicate, is_active, sort_order')
      .eq('tenant_id', tenantId)
      .order('sort_order'),
    supabase
      .from('service_garment_prices')
      .select('id, tenant_id, tenant_service_id, garment_type_id, price_xof, is_active')
      .eq('tenant_id', tenantId),
  ])

  if (categoriesResult.error) throw categoriesResult.error
  if (garmentsResult.error) throw garmentsResult.error
  if (pricesResult.error) throw pricesResult.error

  const categories = new Map(
    (categoriesResult.data ?? []).map((row) => [row.id, { code: row.code, name: row.name }]),
  )
  const garments: LocalCatalogGarment[] = (garmentsResult.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id ?? tenantId,
    categoryId: row.category_id,
    categoryCode: categories.get(row.category_id)?.code ?? 'SANS_CATEGORIE',
    categoryName: categories.get(row.category_id)?.name ?? 'Sans catégorie',
    code: row.code,
    name: row.name,
    iconKey: row.icon_key,
    defaultUnit: row.default_unit,
    isDelicate: row.is_delicate,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }))
  const prices: LocalCatalogPrice[] = (pricesResult.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    tenantServiceId: row.tenant_service_id,
    garmentTypeId: row.garment_type_id,
    priceXof: row.price_xof,
    isActive: row.is_active,
  }))

  const configuration = { garments, prices }
  await replaceLocalConfiguration(tenantId, configuration)
  return configuration
}

/** Catégories du pressing (pour les formulaires d'articles). */
export async function fetchCatalogCategories(tenantId: string): Promise<CatalogCategory[]> {
  if (!isSupabaseConfigured || !navigator.onLine) return []
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('garment_categories')
    .select('id, tenant_id, code, name, sort_order, is_system')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    sortOrder: row.sort_order,
    isSystem: row.is_system,
  }))
}

function requireOnlineConfiguration(): void {
  if (!isSupabaseConfigured) {
    throw new Error('Le catalogue nécessite un projet Supabase configuré.')
  }
  if (!navigator.onLine) {
    throw new Error('La modification du catalogue nécessite une connexion internet.')
  }
}

/** Clone la bibliothèque système (sans prix) pour le pressing courant. Idempotent. */
export async function installCatalogReference(
  tenantId: string,
): Promise<{ categoriesCreees: number; articlesCrees: number }> {
  requireOnlineConfiguration()
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('install_catalog_reference')
  if (error) throw error
  await fetchCatalogConfiguration(tenantId)
  const resultat = (data ?? {}) as { categories_creees?: number; articles_crees?: number }
  return {
    categoriesCreees: resultat.categories_creees ?? 0,
    articlesCrees: resultat.articles_crees ?? 0,
  }
}

export async function createCatalogGarment(
  tenantId: string,
  input: {
    categoryId: string
    code: string
    name: string
    defaultUnit: CatalogBillingUnit
    isDelicate: boolean
  },
): Promise<void> {
  requireOnlineConfiguration()
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('garment_types').insert({
    tenant_id: tenantId,
    category_id: input.categoryId,
    code: input.code,
    name: input.name.trim(),
    default_unit: input.defaultUnit,
    is_delicate: input.isDelicate,
  })
  if (error) throw error
  await fetchCatalogConfiguration(tenantId)
}

/** Active ou archive un article (l'archivage préserve l'historique des commandes). */
export async function setCatalogGarmentActive(
  tenantId: string,
  garmentId: string,
  isActive: boolean,
): Promise<void> {
  requireOnlineConfiguration()
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('garment_types')
    .update({ is_active: isActive, archived_at: isActive ? null : new Date().toISOString() })
    .eq('id', garmentId)
    .eq('tenant_id', tenantId)
  if (error) throw error
  await fetchCatalogConfiguration(tenantId)
}

/**
 * Définit le prix d'un couple prestation × article ; `priceXof = null`
 * retire le tarif (retour explicite à « non configuré »).
 */
export async function setGarmentPrice(
  tenantId: string,
  tenantServiceId: string,
  garmentTypeId: string,
  priceXof: number | null,
): Promise<void> {
  requireOnlineConfiguration()
  const supabase = getSupabaseClient()
  if (priceXof === null) {
    const { error } = await supabase
      .from('service_garment_prices')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('tenant_service_id', tenantServiceId)
      .eq('garment_type_id', garmentTypeId)
    if (error) throw error
  } else {
    if (!Number.isInteger(priceXof) || priceXof <= 0) {
      throw new Error('Le tarif doit être un montant positif en FCFA (ou vide pour le retirer).')
    }
    const { error } = await supabase.from('service_garment_prices').upsert(
      {
        tenant_id: tenantId,
        tenant_service_id: tenantServiceId,
        garment_type_id: garmentTypeId,
        price_xof: priceXof,
        is_active: true,
      },
      { onConflict: 'tenant_id,tenant_service_id,garment_type_id' },
    )
    if (error) throw error
  }
  await fetchCatalogConfiguration(tenantId)
}
