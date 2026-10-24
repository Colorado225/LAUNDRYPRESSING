import type { CatalogEntryRow } from '@/types/database'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { newId } from '@/lib/ids'
import { db, type LocalCatalogEntry } from './localDb'

/**
 * Catalogue des prestations (palier 2).
 *
 * Le référentiel vit sur le serveur : seul le propriétaire l'écrit (RLS de
 * `catalog_entries`). La tablette en garde une **copie locale en lecture
 * seule**, rafraîchie à chaque synchronisation, pour que la saisie d'une
 * commande reste possible en mode avion.
 *
 * Les prix ne sont jamais recopiés depuis le catalogue au moment de
 * l'affichage d'une ancienne commande : `order_items.price` fige le tarif
 * appliqué, c'est la garantie d'historisation.
 */

export interface CatalogEntryInput {
  article: string
  service: string
  price: number
}

function toLocal(row: CatalogEntryRow): LocalCatalogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    article: row.article,
    service: row.service,
    price: row.price,
    pricingMode: row.pricing_mode,
    billingUnit: row.billing_unit,
    requiresReview: row.requires_review,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }
}

/**
 * Copie locale du catalogue, triée pour l'affichage.
 *
 * Les écrans de commande ne voient que les tarifs actifs. La gestion du
 * catalogue peut demander les archives afin de les réactiver sans recréer une
 * entrée ni casser les références des anciennes commandes.
 */
export async function getCachedCatalog(
  tenantId: string,
  options: { includeInactive?: boolean } = {},
): Promise<LocalCatalogEntry[]> {
  const entrees = await db.catalogEntries.where('tenantId').equals(tenantId).toArray()
  return entrees
    // Les propriétés ajoutées au cache sont normalisées à la lecture pour
    // garder compatibles les données Dexie créées par une version précédente.
    .map((entree) => ({
      ...entree,
      pricingMode: entree.pricingMode ?? (entree.price === 0 ? 'UNCONFIGURED' : 'FIXED'),
      billingUnit: entree.billingUnit ?? 'PIECE',
      // Une entrée mise en cache par une ancienne version n'a pas de preuve de
      // validation : elle reste masquée jusqu'au prochain rafraîchissement serveur.
      requiresReview: entree.requiresReview ?? true,
    }))
    .filter((entree) => options.includeInactive || entree.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.article.localeCompare(b.article, 'fr'))
}

function tarifProposable(entree: LocalCatalogEntry): boolean {
  return (
    entree.isActive &&
    !entree.requiresReview &&
    entree.billingUnit === 'PIECE' &&
    (entree.pricingMode === 'FIXED' || entree.pricingMode === 'FROM') &&
    entree.price > 0
  )
}

/** Articles distincts des tarifs prêts à être utilisés en commande. */
export function uniqueArticles(entrees: LocalCatalogEntry[]): string[] {
  const proposables = entrees.filter(tarifProposable)
  return [...new Set(proposables.map((entree) => entree.article))].sort((a, b) =>
    a.localeCompare(b, 'fr'),
  )
}

/** Prestations proposées pour un article donné, hors tarifs à confirmer/devis. */
export function servicesForArticle(
  entrees: LocalCatalogEntry[],
  article: string,
): LocalCatalogEntry[] {
  return entrees
    .filter((entree) => tarifProposable(entree) && entree.article === article)
    .sort((a, b) => a.service.localeCompare(b.service, 'fr'))
}

/**
 * Recharge la copie locale depuis le serveur.
 *
 * En cas d'échec (hors ligne), la copie existante est conservée : mieux vaut
 * un tarif légèrement daté qu'un formulaire inutilisable.
 */
export async function refreshCatalog(tenantId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('catalog_entries')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })

    if (error || !data) return false

    await db.transaction('rw', db.catalogEntries, async () => {
      await db.catalogEntries.where('tenantId').equals(tenantId).delete()
      await db.catalogEntries.bulkPut(data.map(toLocal))
    })

    return true
  } catch {
    return false
  }
}

/** Crée une prestation tarifée (propriétaire, en ligne). */
export async function createCatalogEntry(
  tenantId: string,
  input: CatalogEntryInput,
): Promise<LocalCatalogEntry> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('catalog_entries')
    .insert({
      id: newId(),
      tenant_id: tenantId,
      article: input.article.trim(),
      service: input.service.trim(),
      price: input.price,
    })
    .select('*')
    .single()

  if (error) throw new Error(traduireErreurCatalogue(error.message, error.code))
  return toLocal(data as CatalogEntryRow)
}

/** Modifie une prestation existante (propriétaire, en ligne). */
export async function updateCatalogEntry(
  tenantId: string,
  entryId: string,
  input: Partial<CatalogEntryInput> & { isActive?: boolean; requiresReview?: boolean },
): Promise<void> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('catalog_entries')
    .update({
      ...(input.article !== undefined ? { article: input.article.trim() } : {}),
      ...(input.service !== undefined ? { service: input.service.trim() } : {}),
      ...(input.price !== undefined
        ? { price: input.price, pricing_mode: input.price > 0 ? 'FIXED' : 'UNCONFIGURED' }
        : {}),
      ...(input.requiresReview !== undefined ? { requires_review: input.requiresReview } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    })
    .eq('tenant_id', tenantId)
    .eq('id', entryId)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(traduireErreurCatalogue(error.message, error.code))
  if (!data) throw new Error('Tarif introuvable dans le catalogue de ce pressing.')
}

/** Désactive une prestation (historique préservé, elle n'est plus proposée). */
export async function deactivateCatalogEntry(tenantId: string, entryId: string): Promise<void> {
  await updateCatalogEntry(tenantId, entryId, { isActive: false })
}

function traduireErreurCatalogue(message: string, code?: string): string {
  if (code === '23505') return 'Cette prestation existe déjà pour cet article.'
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'Seul le propriétaire peut modifier les tarifs.'
  }
  if (/Failed to fetch|NetworkError/i.test(message)) {
    return 'Réseau indisponible : la modification du catalogue nécessite une connexion.'
  }
  return message
}

/* -------------------------------------------------------------------------- */
/* Jeu de départ                                                               */
/* -------------------------------------------------------------------------- */

const ARTICLES: Array<[string, number]> = [
  ['Chemise', 1500],
  ['Pantalon', 1500],
  ['Costume 3 pièces', 5000],
  ['Robe', 2500],
  ['Boubou', 3000],
  ['Drap 2 places', 2000],
  ['Couette', 4000],
  ['Rideau', 2500],
]

const PRESTATIONS: Array<[string, number]> = [
  ['Lavage', 1],
  ['Nettoyage à sec', 1.6],
  ['Repassage seul', 0.5],
  ['Amidonnage', 1.2],
  ['Traitement délicat', 1.3],
]

/**
 * Prestations courantes d'un pressing d'Abidjan, proposées en un clic.
 *
 * Les prix sont des ordres de grandeur à ajuster : ils servent à éviter un
 * catalogue vide, pas à imposer une grille tarifaire.
 */
export function defaultCatalog(): Array<CatalogEntryInput & { sortOrder: number }> {
  const entrees: Array<CatalogEntryInput & { sortOrder: number }> = []

  ARTICLES.forEach(([article, base], indexArticle) => {
    PRESTATIONS.forEach(([service, coefficient], indexService) => {
      // Arrondi à 50 FCFA : un tarif affiché « 2 400 » se retient mieux
      // qu'un « 2 387 » produit par un calcul.
      const prix = Math.round((base * coefficient) / 50) * 50
      entrees.push({
        article,
        service,
        price: prix,
        // Tri stable : par article, puis par prestation.
        sortOrder: indexArticle * 100 + indexService,
      })
    })
  })

  return entrees
}

/**
 * Installe le jeu de départ, sans écraser l'existant.
 *
 * `on conflict do nothing` côté PostgREST : relancer l'opération n'ajoute que
 * les prestations manquantes.
 */
export async function seedDefaultCatalog(tenantId: string): Promise<number> {
  const supabase = getSupabaseClient()
  const lignes = defaultCatalog().map((entree) => ({
    id: newId(),
    tenant_id: tenantId,
    article: entree.article,
    service: entree.service,
    price: entree.price,
    pricing_mode: 'FIXED' as const,
    billing_unit: 'PIECE' as const,
    requires_review: true,
    sort_order: entree.sortOrder,
  }))

  const { data, error } = await supabase
    .from('catalog_entries')
    .upsert(lignes, { onConflict: 'tenant_id,article,service', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(traduireErreurCatalogue(error.message, error.code))
  return data?.length ?? 0
}
