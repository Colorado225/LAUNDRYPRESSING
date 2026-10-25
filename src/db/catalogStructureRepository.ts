import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'
import { newId } from '@/lib/ids'
import { db, type LocalCatalogStructureRow } from '@/db/localDb'
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

/* ------------------------------------------------------------------ *
 * Repli local (mode démonstration : aucun projet Supabase configuré).
 *
 * La structure du catalogue est normalement un référentiel serveur. En
 * démonstration, il n'y a pas de serveur : les opérations écrites ci-dessous
 * tombent sur une table Dexie unique (`db.catalogStructure`, discriminante
 * par `kind`) qui reproduit les trois schémas serveur. Cela permet d'éprouver
 * toute l'administration de la structure hors ligne. Quand Supabase est
 * configuré, les chemins serveur restent la seule voie.
 * ------------------------------------------------------------------ */

/** Tri serveur : ordre d'affichage, puis nom. */
function comparerParOrdre(a: { sort_order: number; name: string }, b: { sort_order: number; name: string }) {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'fr')
}

function familleDepuisLigne(ligne: LocalCatalogStructureRow): CatalogFamilyRow {
  return {
    id: ligne.id,
    tenant_id: ligne.tenantId,
    name: ligne.name,
    template_code: null,
    description: ligne.description,
    is_active: ligne.isActive,
    sort_order: ligne.sortOrder,
    created_by: null,
    created_at: ligne.updatedAt,
    updated_at: ligne.updatedAt,
  }
}

function articleDepuisLigne(ligne: LocalCatalogStructureRow): CatalogArticleRow {
  return {
    id: ligne.id,
    tenant_id: ligne.tenantId,
    family_id: ligne.familyId ?? '',
    name: ligne.name,
    template_code: null,
    description: ligne.description,
    care_instructions: ligne.careInstructions,
    default_unit: ligne.defaultUnit ?? 'PIECE',
    is_active: ligne.isActive,
    sort_order: ligne.sortOrder,
    created_by: null,
    created_at: ligne.updatedAt,
    updated_at: ligne.updatedAt,
  }
}

function prestationDepuisLigne(ligne: LocalCatalogStructureRow): CatalogServiceRow {
  return {
    id: ligne.id,
    tenant_id: ligne.tenantId,
    name: ligne.name,
    template_code: null,
    service_type: ligne.serviceType ?? 'treatment',
    application_scope: ligne.applicationScope ?? 'article',
    description: ligne.description,
    is_active: ligne.isActive,
    sort_order: ligne.sortOrder,
    created_by: null,
    created_at: ligne.updatedAt,
    updated_at: ligne.updatedAt,
  }
}

/* ------------------------------------------------------------------ *
 * Synchronisation serveur → cache local (mode connecté).
 *
 * La structure est un référentiel serveur, mais l'application est
 * offline-first : chaque lecture serveur reconstitue le cache Dexie, et
 * chaque écrition serveur réussie le met à jour immédiatement. En cas de
 * coupure réseau, `loadCatalogStructure` retombe sur ce cache — le
 * catalogue reste gérable et consultable hors ligne, jusqu'au prochain
 * rafraîchissement serveur.
 * ------------------------------------------------------------------ */

function ligneDepuisFamille(row: CatalogFamilyRow): LocalCatalogStructureRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: 'family',
    name: row.name,
    description: row.description,
    familyId: null,
    careInstructions: null,
    defaultUnit: null,
    serviceType: null,
    applicationScope: null,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  }
}

function ligneDepuisArticle(row: CatalogArticleRow): LocalCatalogStructureRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: 'article',
    name: row.name,
    description: row.description,
    familyId: row.family_id,
    careInstructions: row.care_instructions,
    defaultUnit: row.default_unit,
    serviceType: null,
    applicationScope: null,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  }
}

function ligneDepuisService(row: CatalogServiceRow): LocalCatalogStructureRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: 'service',
    name: row.name,
    description: row.description,
    familyId: null,
    careInstructions: null,
    defaultUnit: null,
    serviceType: row.service_type,
    applicationScope: row.application_scope,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  }
}

/** Écriture best-effort dans le cache local : un échec ne invalide pas le succès serveur. */
async function ecrireReferenceLocale(ligne: LocalCatalogStructureRow): Promise<void> {
  try {
    await db.catalogStructure.put(ligne)
  } catch {
    // Le cache local se recouvre au prochain `loadCatalogStructure`.
  }
}

async function purgerReferenceLocale(id: string): Promise<void> {
  try {
    await db.catalogStructure.delete(id)
  } catch {
    // Idem : le prochain rafraîchissement serveur purgera la ligne.
  }
}

/**
 * Rafraîchissement complet du cache local d'un tenant à partir d'un
 * jeu serveur complet : les lignes supprimées côté serveur disparaissent
 * du cache (le serveur est l'autorité).
 */
async function synchroniserCacheLocal(
  tenantId: string,
  lignes: LocalCatalogStructureRow[],
): Promise<void> {
  try {
    await db.transaction('rw', db.catalogStructure, async () => {
      await db.catalogStructure.where('tenantId').equals(tenantId).delete()
      await db.catalogStructure.bulkPut(lignes)
    })
  } catch {
    // Un cache : l'affichage serveur reste valable sans lui.
  }
}

async function creerReferenceLocale(
  tenantId: string,
  ligne: Omit<LocalCatalogStructureRow, 'id' | 'tenantId' | 'updatedAt'>,
): Promise<void> {
  await db.catalogStructure.put({
    ...ligne,
    id: newId(),
    tenantId,
    updatedAt: new Date().toISOString(),
  })
}

async function modifierReferenceLocale(
  tenantId: string,
  id: string,
  patch: Partial<LocalCatalogStructureRow>,
): Promise<void> {
  const ligne = await db.catalogStructure.get(id)
  if (!ligne || ligne.tenantId !== tenantId) {
    throw new Error('Élément introuvable dans le catalogue de ce pressing.')
  }
  const misesAJour = await db.catalogStructure.update(id, {
    ...patch,
    updatedAt: new Date().toISOString(),
  })
  if (!misesAJour) throw new Error('Élément introuvable dans le catalogue de ce pressing.')
}

async function supprimerReferenceLocale(tenantId: string, id: string): Promise<void> {
  const ligne = await db.catalogStructure.get(id)
  if (!ligne || ligne.tenantId !== tenantId) {
    throw new Error('Élément introuvable dans le catalogue de ce pressing.')
  }
  await db.catalogStructure.delete(id)
}

/** Dépendances d'une catégorie : les articles qui lui appartiennent. */
async function compterArticlesDansFamilleLocal(tenantId: string, familyId: string): Promise<number> {
  return db.catalogStructure
    .where('tenantId')
    .equals(tenantId)
    .filter((ligne) => ligne.kind === 'article' && ligne.familyId === familyId)
    .count()
}

/**
 * Dépendances tarifaires : les tarifs du cache local qui mentionnent le
 * libellé de l'article ou de la prestation. En démonstration, les tarifs
 * vivent dans le cache Dexie — on les compte par correspondance de libellé,
 * comme le ferait la contrainte FK serveur.
 */
async function compterTarifsDependantsLocal(
  tenantId: string,
  kind: 'article' | 'service',
  id: string,
  actifsSeulement: boolean,
): Promise<number> {
  const ligne = await db.catalogStructure.get(id)
  if (!ligne) return 0
  const entrees = await db.catalogEntries.where('tenantId').equals(tenantId).toArray()
  return entrees.filter(
    (entree) =>
      (kind === 'article' ? entree.article : entree.service) === ligne.name &&
      (actifsSeulement ? entree.isActive : true),
  ).length
}

export async function initializeCatalogModelTemplates(): Promise<void> {
  if (!isSupabaseConfigured) return
  const { error } = await getSupabaseClient().rpc('initialize_catalog_model_templates')
  if (!error) return
  // Tolère un client temporairement plus récent que le schéma distant : le
  // catalogue reste gérable, mais les modèles apparaîtront après la migration.
  if (error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist/i.test(error.message)) return
  throw erreurCatalogue(error)
}

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
  if (!isSupabaseConfigured) {
    const lignes = await db.catalogStructure.where('tenantId').equals(tenantId).toArray()
    const familles = lignes.filter((l) => l.kind === 'family').map(familleDepuisLigne).sort(comparerParOrdre)
    const articles = lignes.filter((l) => l.kind === 'article').map(articleDepuisLigne).sort(comparerParOrdre)
    const services = lignes.filter((l) => l.kind === 'service').map(prestationDepuisLigne).sort(comparerParOrdre)
    return { families: familles, articles, services }
  }
  try {
    const supabase = getSupabaseClient()
    const [families, articles, services] = await Promise.all([
      supabase.from('catalog_families').select('*').eq('tenant_id', tenantId).order('sort_order,name'),
      supabase.from('catalog_articles').select('*').eq('tenant_id', tenantId).order('sort_order,name'),
      supabase.from('catalog_services').select('*').eq('tenant_id', tenantId).order('sort_order,name'),
    ])
    const error = families.error ?? articles.error ?? services.error
    if (error) throw erreurCatalogue(error)
    const famillesData = (families.data ?? []) as CatalogFamilyRow[]
    const articlesData = (articles.data ?? []) as CatalogArticleRow[]
    const servicesData = (services.data ?? []) as CatalogServiceRow[]
    await synchroniserCacheLocal(
      tenantId,
      [
        ...famillesData.map(ligneDepuisFamille),
        ...articlesData.map(ligneDepuisArticle),
        ...servicesData.map(ligneDepuisService),
      ],
    )
    return { families: famillesData, articles: articlesData, services: servicesData }
  } catch (cause) {
    // Hors ligne : la copie locale mémorisée reste consultable — mieux vaut
    // une structure légèrement datée qu'un écran inutilisable. Sans cache,
    // on relaie l'erreur serveur (RLS, réseau) pour l'afficher.
    const lignes = await db.catalogStructure.where('tenantId').equals(tenantId).toArray()
    if (lignes.length === 0) throw cause
    const familles = lignes.filter((l) => l.kind === 'family').map(familleDepuisLigne).sort(comparerParOrdre)
    const articles = lignes.filter((l) => l.kind === 'article').map(articleDepuisLigne).sort(comparerParOrdre)
    const services = lignes.filter((l) => l.kind === 'service').map(prestationDepuisLigne).sort(comparerParOrdre)
    return { families: familles, articles: articles, services: services }
  }
}

type TableReference = 'catalog_families' | 'catalog_articles' | 'catalog_services'
type LigneReference = CatalogFamilyRow | CatalogArticleRow | CatalogServiceRow

/** Reconstitue la ligne de cache local correspondant à une ligne serveur. */
function ligneDepuisReference(table: TableReference, ligne: LigneReference): LocalCatalogStructureRow {
  if (table === 'catalog_families') return ligneDepuisFamille(ligne as CatalogFamilyRow)
  if (table === 'catalog_articles') return ligneDepuisArticle(ligne as CatalogArticleRow)
  return ligneDepuisService(ligne as CatalogServiceRow)
}

async function modifierReference(
  table: TableReference,
  tenantId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<LigneReference> {
  const { data, error } = await getSupabaseClient()
    .from(table)
    .update(values as never)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) throw erreurCatalogue(error)
  if (!data) throw new Error('Élément introuvable dans le catalogue de ce pressing.')
  const ligne = data as LigneReference
  await ecrireReferenceLocale(ligneDepuisReference(table, ligne))
  return ligne
}

async function creerReference(
  table: TableReference,
  tenantId: string,
  values: Record<string, unknown>,
): Promise<LigneReference> {
  const { data, error } = await getSupabaseClient()
    .from(table)
    .insert({
      id: newId(),
      tenant_id: tenantId,
      ...values,
    } as never)
    .select('*')
    .single()
  if (error) throw erreurCatalogue(error)
  const ligne = data as LigneReference
  await ecrireReferenceLocale(ligneDepuisReference(table, ligne))
  return ligne
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
  table: TableReference,
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
  await purgerReferenceLocale(id)
}

export async function createCatalogFamily(tenantId: string, input: CatalogFamilyInput): Promise<void> {
  if (!isSupabaseConfigured) {
    await creerReferenceLocale(tenantId, {
      kind: 'family',
      name: input.name.trim(),
      description: input.description?.trim() || null,
      familyId: null,
      careInstructions: null,
      defaultUnit: null,
      serviceType: null,
      applicationScope: null,
      isActive: input.is_active ?? true,
      sortOrder: input.sort_order ?? 0,
    })
    return
  }
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
  if (!isSupabaseConfigured) {
    await modifierReferenceLocale(tenantId, id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
      ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
    })
    return
  }
  await modifierReference('catalog_families', tenantId, id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
    ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
  })
}

export async function deleteCatalogFamily(tenantId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const count = await compterArticlesDansFamilleLocal(tenantId, id)
    if (count > 0) throw new Error('Cette catégorie contient encore des articles : archivez-la ou déplacez-les avant suppression.')
    await supprimerReferenceLocale(tenantId, id)
    return
  }
  const count = await compterDependances('catalog_articles', tenantId, 'family_id', id)
  if (count > 0) throw new Error('Cette catégorie contient encore des articles : archivez-la ou déplacez-les avant suppression.')
  await supprimerReference('catalog_families', tenantId, id)
}

export async function createCatalogArticle(tenantId: string, input: CatalogArticleInput): Promise<void> {
  if (!isSupabaseConfigured) {
    await creerReferenceLocale(tenantId, {
      kind: 'article',
      name: input.name.trim(),
      description: input.description?.trim() || null,
      familyId: input.family_id,
      careInstructions: input.care_instructions?.trim() || null,
      defaultUnit: input.default_unit ?? ('PIECE' satisfies CatalogBillingUnit),
      serviceType: null,
      applicationScope: null,
      isActive: input.is_active ?? true,
      sortOrder: input.sort_order ?? 0,
    })
    return
  }
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
  if (!isSupabaseConfigured) {
    await modifierReferenceLocale(tenantId, id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.family_id !== undefined ? { familyId: input.family_id } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.care_instructions !== undefined ? { careInstructions: input.care_instructions?.trim() || null } : {}),
      ...(input.default_unit !== undefined ? { defaultUnit: input.default_unit } : {}),
      ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
      ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
    })
    return
  }
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
  if (!isSupabaseConfigured) {
    if (!isActive) {
      const count = await compterTarifsDependantsLocal(tenantId, 'article', id, true)
      if (count > 0) throw new Error('Désactivez d’abord les tarifs actifs de cet article. Les tarifs archivés conserveront leur historique.')
    }
    await modifierReferenceLocale(tenantId, id, { isActive })
    return
  }
  if (!isActive) {
    const count = await compterTarifsDependants(tenantId, 'article_id', id, true)
    if (count > 0) throw new Error('Désactivez d’abord les tarifs actifs de cet article. Les tarifs archivés conserveront leur historique.')
  }
  await modifierReference('catalog_articles', tenantId, id, { is_active: isActive })
}

export async function deleteCatalogArticle(tenantId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const count = await compterTarifsDependantsLocal(tenantId, 'article', id, false)
    if (count > 0) throw new Error('Cet article est référencé par des tarifs : archivez-le pour préserver l’historique.')
    await supprimerReferenceLocale(tenantId, id)
    return
  }
  const count = await compterTarifsDependants(tenantId, 'article_id', id, false)
  if (count > 0) throw new Error('Cet article est référencé par des tarifs : archivez-le pour préserver l’historique.')
  await supprimerReference('catalog_articles', tenantId, id)
}

export async function createCatalogService(tenantId: string, input: CatalogServiceInput): Promise<void> {
  if (!isSupabaseConfigured) {
    await creerReferenceLocale(tenantId, {
      kind: 'service',
      name: input.name.trim(),
      description: input.description?.trim() || null,
      familyId: null,
      careInstructions: null,
      defaultUnit: null,
      serviceType: input.service_type ?? ('treatment' satisfies CatalogServiceType),
      applicationScope: input.application_scope ?? ('article' satisfies CatalogApplicationScope),
      isActive: input.is_active ?? true,
      sortOrder: input.sort_order ?? 0,
    })
    return
  }
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
  if (!isSupabaseConfigured) {
    await modifierReferenceLocale(tenantId, id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.service_type !== undefined ? { serviceType: input.service_type } : {}),
      ...(input.application_scope !== undefined ? { applicationScope: input.application_scope } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
      ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
    })
    return
  }
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
  if (!isSupabaseConfigured) {
    if (!isActive) {
      const count = await compterTarifsDependantsLocal(tenantId, 'service', id, true)
      if (count > 0) throw new Error('Désactivez d’abord les tarifs actifs de cette prestation. Les tarifs archivés conserveront leur historique.')
    }
    await modifierReferenceLocale(tenantId, id, { isActive })
    return
  }
  if (!isActive) {
    const count = await compterTarifsDependants(tenantId, 'service_id', id, true)
    if (count > 0) throw new Error('Désactivez d’abord les tarifs actifs de cette prestation. Les tarifs archivés conserveront leur historique.')
  }
  await modifierReference('catalog_services', tenantId, id, { is_active: isActive })
}

export async function deleteCatalogService(tenantId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const count = await compterTarifsDependantsLocal(tenantId, 'service', id, false)
    if (count > 0) throw new Error('Cette prestation est référencée par des tarifs : archivez-la pour préserver l’historique.')
    await supprimerReferenceLocale(tenantId, id)
    return
  }
  const count = await compterTarifsDependants(tenantId, 'service_id', id, false)
  if (count > 0) throw new Error('Cette prestation est référencée par des tarifs : archivez-la pour préserver l’historique.')
  await supprimerReference('catalog_services', tenantId, id)
}
