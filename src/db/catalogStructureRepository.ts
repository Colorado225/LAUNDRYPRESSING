import { getSupabaseClient } from '@/lib/supabaseClient'
import { newId } from '@/lib/ids'
import type {
  CatalogArticleRow,
  CatalogBillingUnit,
  CatalogFamilyRow,
  CatalogServiceRow,
  CatalogServiceType,
  CatalogApplicationScope,
} from '@/types/database'

/** Données de référence propres au pressing, lues sous les politiques RLS. */
export interface CatalogStructure {
  families: CatalogFamilyRow[]
  articles: CatalogArticleRow[]
  services: CatalogServiceRow[]
}

export type CatalogFamilyInput = Pick<CatalogFamilyRow, 'name'> &
  Partial<Pick<CatalogFamilyRow, 'description' | 'sort_order' | 'is_active'>>
export type CatalogArticleInput = Pick<CatalogArticleRow, 'name' | 'family_id'> &
  Partial<Pick<CatalogArticleRow, 'description' | 'care_instructions' | 'default_unit' | 'sort_order' | 'is_active'>>
export type CatalogServiceInput = Pick<CatalogServiceRow, 'name'> &
  Partial<Pick<CatalogServiceRow, 'service_type' | 'application_scope' | 'description' | 'sort_order' | 'is_active'>>

const MESSAGE_RLS = 'Seul le propriétaire peut gérer la structure du catalogue.'

function erreurCatalogue(error: { message: string; code?: string }): Error {
  if (error.code === '42501' || /row-level security/i.test(error.message)) {
    return new Error(MESSAGE_RLS)
  }
  if (error.code === '23505') return new Error('Un élément portant ce nom existe déjà dans ce pressing.')
  if (error.code === '23503') {
    return new Error('Suppression impossible : cet élément est encore utilisé dans le catalogue ou l’historique.')
  }
  if (/Failed to fetch|NetworkError/i.test(error.message)) {
    return new Error('Réseau indisponible : la gestion de la structure nécessite une connexion.')
  }
  return new Error(error.message)
}

/** Charge les trois référentiels du tenant ; la RLS reste l'autorité finale. */
export async function loadCatalogStructure(tenantId: string): Promise<CatalogStructure> {
  const supabase = getSupabaseClient()
  const [families, articles, services] = await Promise.all([
    supabase.from('catalog_families').select('*').eq('tenant_id', tenantId).order('sort_order').order('name'),
    supabase.from('catalog_articles').select('*').eq('tenant_id', tenantId).order('sort_order').order('name'),
    supabase.from('catalog_services').select('*').eq('tenant_id', tenantId).order('sort_order').order('name'),
  ])
  const error = families.error ?? articles.error ?? services.error
  if (error) throw erreurCatalogue(error)
  return {
    families: families.data ?? [],
    articles: articles.data ?? [],
    services: services.data ?? [],
  }
}

async function modifierReference(
  table: 'catalog_families' | 'catalog_articles' | 'catalog_services',
  tenantId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from(table)
    .update(values as never)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) throw erreurCatalogue(error)
  if (!data) throw new Error('Élément introuvable dans le catalogue de ce pressing.')
}

async function creerReference(
  table: 'catalog_families' | 'catalog_articles' | 'catalog_services',
  tenantId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabaseClient().from(table).insert({
    id: newId(),
    tenant_id: tenantId,
    ...values,
  } as never)
  if (error) throw erreurCatalogue(error)
}

async function compterDependances(
  table: 'catalog_articles' | 'catalog_services',
  tenantId: string,
  column: 'family_id' | 'article_id' | 'service_id',
  id: string,
  actifsSeulement = false,
): Promise<number> {
  let requete = getSupabaseClient()
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq(column as never, id as never)
  if (actifsSeulement && table === 'catalog_articles') {
    requete = requete.eq('is_active', true)
  }
  if (actifsSeulement && table === 'catalog_services') {
    requete = requete.eq('is_active', true)
  }
  const { count, error } = await requete
  if (error) throw erreurCatalogue(error)
  return count ?? 0
}

async function compterTarifsDependants(
  tenantId: string,
  column: 'article_id' | 'service_id',
  id: string,
  actifsSeulement: boolean,
): Promise<number> {
  let requete = getSupabaseClient()
    .from('catalog_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq(column as never, id as never)
  if (actifsSeulement) requete = requete.eq('is_active', true)
  const { count, error } = await requete
  if (error) throw erreurCatalogue(error)
  return count ?? 0
}

async function supprimerReference(
  table: 'catalog_families' | 'catalog_articles' | 'catalog_services',
  tenantId: string,
  id: string,
): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from(table)
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) throw erreurCatalogue(error)
  if (!data) throw new Error('Élément introuvable dans le catalogue de ce pressing.')
}

export async function createCatalogFamily(tenantId: string, input: CatalogFamilyInput): Promise<void> {
  await creerReference('catalog_families', tenantId, {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    sort_order: input.sort_order ?? 0,
    is_active: input.is_active ?? true,
  })
}

export async function updateCatalogFamily(
  tenantId: string,
  id: string,
  input: Partial<CatalogFamilyInput>,
): Promise<void> {
  await modifierReference('catalog_families', tenantId, id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
    ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
  })
}

export async function deleteCatalogFamily(tenantId: string, id: string): Promise<void> {
  const count = await compterDependances('catalog_articles', tenantId, 'family_id', id)
  if (count > 0) throw new Error('Cette catégorie contient encore des articles : archivez-la ou déplacez-les avant suppression.')
  await supprimerReference('catalog_families', tenantId, id)
}

export async function createCatalogArticle(tenantId: string, input: CatalogArticleInput): Promise<void> {
  await creerReference('catalog_articles', tenantId, {
    name: input.name.trim(),
    family_id: input.family_id,
    description: input.description?.trim() || null,
    care_instructions: input.care_instructions?.trim() || null,
    default_unit: input.default_unit ?? ('PIECE' satisfies CatalogBillingUnit),
    sort_order: input.sort_order ?? 0,
    is_active: input.is_active ?? true,
  })
}

export async function updateCatalogArticle(
  tenantId: string,
  id: string,
  input: Partial<CatalogArticleInput>,
): Promise<void> {
  await modifierReference('catalog_articles', tenantId, id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.family_id !== undefined ? { family_id: input.family_id } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    ...(input.care_instructions !== undefined ? { care_instructions: input.care_instructions?.trim() || null } : {}),
    ...(input.default_unit !== undefined ? { default_unit: input.default_unit } : {}),
    ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
    ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
  })
}

export async function setCatalogArticleActive(tenantId: string, id: string, isActive: boolean): Promise<void> {
  if (!isActive) {
    const count = await compterTarifsDependants(tenantId, 'article_id', id, true)
    if (count > 0) throw new Error('Désactivez d’abord les tarifs actifs de cet article. Les tarifs archivés conserveront leur historique.')
  }
  await modifierReference('catalog_articles', tenantId, id, { is_active: isActive })
}

export async function deleteCatalogArticle(tenantId: string, id: string): Promise<void> {
  const count = await compterTarifsDependants(tenantId, 'article_id', id, false)
  if (count > 0) throw new Error('Cet article est référencé par des tarifs : archivez-le pour préserver l’historique.')
  await supprimerReference('catalog_articles', tenantId, id)
}

export async function createCatalogService(tenantId: string, input: CatalogServiceInput): Promise<void> {
  await creerReference('catalog_services', tenantId, {
    name: input.name.trim(),
    service_type: input.service_type ?? ('treatment' satisfies CatalogServiceType),
    application_scope: input.application_scope ?? ('article' satisfies CatalogApplicationScope),
    description: input.description?.trim() || null,
    sort_order: input.sort_order ?? 0,
    is_active: input.is_active ?? true,
  })
}

export async function updateCatalogService(
  tenantId: string,
  id: string,
  input: Partial<CatalogServiceInput>,
): Promise<void> {
  await modifierReference('catalog_services', tenantId, id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.service_type !== undefined ? { service_type: input.service_type } : {}),
    ...(input.application_scope !== undefined ? { application_scope: input.application_scope } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
    ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
  })
}

export async function setCatalogServiceActive(tenantId: string, id: string, isActive: boolean): Promise<void> {
  if (!isActive) {
    const count = await compterTarifsDependants(tenantId, 'service_id', id, true)
    if (count > 0) throw new Error('Désactivez d’abord les tarifs actifs de cette prestation. Les tarifs archivés conserveront leur historique.')
  }
  await modifierReference('catalog_services', tenantId, id, { is_active: isActive })
}

export async function deleteCatalogService(tenantId: string, id: string): Promise<void> {
  const count = await compterTarifsDependants(tenantId, 'service_id', id, false)
  if (count > 0) throw new Error('Cette prestation est référencée par des tarifs : archivez-la pour préserver l’historique.')
  await supprimerReference('catalog_services', tenantId, id)
}
