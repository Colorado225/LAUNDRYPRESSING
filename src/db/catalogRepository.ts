import type {
  CatalogBillingUnit,
  CatalogEntryRow,
  CatalogPricingMode,
} from '@/types/database'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'
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
  pricingMode?: CatalogPricingMode
  billingUnit?: CatalogBillingUnit
  minimumQuantity?: number | null
  billingIncrement?: number | null
  minimumCharge?: number | null
  conditions?: string | null
}

function toLocal(
  row: CatalogEntryRow,
  familyName: string | null = null,
  referencesActive = true,
): LocalCatalogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    article: row.article,
    service: row.service,
    price: row.price,
    pricingMode: row.pricing_mode,
    billingUnit: row.billing_unit,
    familyName,
    minimumQuantity: row.minimum_quantity,
    billingIncrement: row.billing_increment,
    minimumCharge: row.minimum_charge,
    conditions: row.conditions,
    requiresReview: row.requires_review,
    isActive: row.is_active,
    referencesActive,
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
      billingUnit:
        (entree.pricingMode ?? (entree.price === 0 ? 'UNCONFIGURED' : 'FIXED')) === 'QUOTE'
          ? 'FLAT'
          : entree.billingUnit ?? 'PIECE',
      familyName: entree.familyName ?? null,
      minimumQuantity: entree.minimumQuantity ?? null,
      billingIncrement: entree.billingIncrement ?? null,
      minimumCharge: entree.minimumCharge ?? null,
      conditions: entree.conditions ?? null,
      // Une entrée mise en cache par une ancienne version n'a pas de preuve de
      // validation : elle reste masquée jusqu'au prochain rafraîchissement serveur.
      requiresReview: entree.requiresReview ?? true,
      // Un ancien cache ne connaissait pas ces références structurées ; le
      // prochain rafraîchissement serveur les vérifiera sans bloquer la saisie.
      referencesActive: entree.referencesActive ?? true,
    }))
    .filter((entree) => options.includeInactive || entree.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.article.localeCompare(b.article, 'fr'))
}

function tarifProposable(entree: LocalCatalogEntry): boolean {
  return (
    entree.isActive &&
    entree.referencesActive !== false &&
    !entree.requiresReview &&
    entree.pricingMode !== 'UNCONFIGURED' &&
    (entree.pricingMode === 'QUOTE' || entree.price > 0)
  )
}

/** Articles distincts des tarifs prêts à être utilisés en commande. */
export function uniqueArticles(entrees: LocalCatalogEntry[]): string[] {
  const proposables = entrees.filter(tarifProposable)
  return [...new Set(proposables.map((entree) => entree.article))].sort((a, b) =>
    a.localeCompare(b, 'fr'),
  )
}

/** Prestations utilisables pour un article donné, y compris les devis à confirmer. */
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

    const articleIds = [...new Set(data.flatMap((row) => (row.article_id ? [row.article_id] : [])))]
    const serviceIds = [...new Set(data.map((row) => row.service_id))]
    const familleParArticle = new Map<string, string>()
    const articleActifParId = new Map<string, boolean>()
    const serviceActifParId = new Map<string, boolean>()

    if (articleIds.length > 0) {
      const { data: articles, error: erreurArticles } = await supabase
        .from('catalog_articles')
        .select('id,family_id,is_active')
        .eq('tenant_id', tenantId)
        .in('id', articleIds)
      if (erreurArticles || !articles) return false

      articles.forEach((article) => articleActifParId.set(article.id, article.is_active))
      const familyIds = [...new Set(articles.map((article) => article.family_id))]
      const { data: familles, error: erreurFamilles } = await supabase
        .from('catalog_families')
        .select('id,name')
        .eq('tenant_id', tenantId)
        .in('id', familyIds)
      if (erreurFamilles || !familles) return false

      const nomParFamille = new Map(familles.map((famille) => [famille.id, famille.name]))
      articles.forEach((article) => {
        const name = nomParFamille.get(article.family_id)
        if (name) familleParArticle.set(article.id, name)
      })
    }

    if (serviceIds.length > 0) {
      const { data: services, error: erreurServices } = await supabase
        .from('catalog_services')
        .select('id,is_active')
        .eq('tenant_id', tenantId)
        .in('id', serviceIds)
      if (erreurServices || !services) return false
      services.forEach((service) => serviceActifParId.set(service.id, service.is_active))
    }

    await db.transaction('rw', db.catalogEntries, async () => {
      await db.catalogEntries.where('tenantId').equals(tenantId).delete()
      await db.catalogEntries.bulkPut(
        data.map((row) => {
          const articleActive = row.article_id ? articleActifParId.get(row.article_id) === true : true
          const serviceActive = serviceActifParId.get(row.service_id) === true
          return toLocal(
            row,
            row.article_id ? (familleParArticle.get(row.article_id) ?? null) : null,
            articleActive && serviceActive,
          )
        }),
      )
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
  if (!isSupabaseConfigured) {
    // Mode démonstration : aucun projet Supabase, le tarif est enregistré
    // directement dans le cache local — comme la grille de départ. Il reste
    // « à vérifier » : la décision tarifaire appartient au propriétaire, et
    // la confirmer (« Modifier » puis « Enregistrer ») levera le signal.
    const entree: LocalCatalogEntry = {
      id: newId(),
      tenantId,
      article: input.article.trim(),
      service: input.service.trim(),
      price: input.price,
      pricingMode: input.pricingMode ?? 'FIXED',
      billingUnit: input.billingUnit ?? 'PIECE',
      familyName: null,
      minimumQuantity: input.minimumQuantity ?? null,
      billingIncrement: input.billingIncrement ?? null,
      minimumCharge: input.minimumCharge ?? null,
      conditions: input.conditions?.trim() || null,
      requiresReview: true,
      isActive: true,
      sortOrder: 0,
    }
    await db.catalogEntries.put(entree)
    return entree
  }
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('catalog_entries')
    .insert({
      id: newId(),
      tenant_id: tenantId,
      article: input.article.trim(),
      service: input.service.trim(),
      price: input.price,
      ...(input.pricingMode !== undefined ? { pricing_mode: input.pricingMode } : {}),
      ...(input.billingUnit !== undefined ? { billing_unit: input.billingUnit } : {}),
      ...(input.minimumQuantity !== undefined ? { minimum_quantity: input.minimumQuantity } : {}),
      ...(input.billingIncrement !== undefined ? { billing_increment: input.billingIncrement } : {}),
      ...(input.minimumCharge !== undefined ? { minimum_charge: input.minimumCharge } : {}),
      ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
    })
    .select('*')
    .single()

  if (error) throw new Error(traduireErreurCatalogue(error.message, error.code))
  const entree = toLocal(data as CatalogEntryRow)
  // Mise à jour immédiate du cache local : si le rafraîchissement complet
  // `refreshCatalog` échoue sur une micro-coupure réseau juste après la
  // création, l'entrée reste visible et utilisable — le succès serveur est
  // déjà acquis, le cache doit le refléter.
  await db.catalogEntries.put(entree)
  return entree
}

/** Modifie une prestation existante (propriétaire, en ligne). */
export async function updateCatalogEntry(
  tenantId: string,
  entryId: string,
  input: Partial<CatalogEntryInput> & { isActive?: boolean; requiresReview?: boolean },
): Promise<void> {
  if (!isSupabaseConfigured) {
    // Mode démonstration : mise à jour directe du cache local.
    const entree = await db.catalogEntries.get(entryId)
    if (!entree || entree.tenantId !== tenantId) {
      throw new Error('Tarif introuvable dans le catalogue de ce pressing.')
    }
    const misesAJour = await db.catalogEntries.update(entryId, {
      ...(input.article !== undefined ? { article: input.article.trim() } : {}),
      ...(input.service !== undefined ? { service: input.service.trim() } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.pricingMode !== undefined ? { pricingMode: input.pricingMode } : {}),
      ...(input.billingUnit !== undefined ? { billingUnit: input.billingUnit } : {}),
      ...(input.minimumQuantity !== undefined ? { minimumQuantity: input.minimumQuantity } : {}),
      ...(input.billingIncrement !== undefined ? { billingIncrement: input.billingIncrement } : {}),
      ...(input.minimumCharge !== undefined ? { minimumCharge: input.minimumCharge } : {}),
      ...(input.conditions !== undefined ? { conditions: input.conditions?.trim() || null } : {}),
      ...(input.requiresReview !== undefined ? { requiresReview: input.requiresReview } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    })
    if (!misesAJour) throw new Error('Tarif introuvable dans le catalogue de ce pressing.')
    return
  }
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('catalog_entries') // tenant_id est aussi vérifié en filtre après la mise à jour.
    .update({
      ...(input.article !== undefined ? { article: input.article.trim() } : {}),
      ...(input.service !== undefined ? { service: input.service.trim() } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.pricingMode !== undefined ? { pricing_mode: input.pricingMode } : {}),
      ...(input.billingUnit !== undefined ? { billing_unit: input.billingUnit } : {}),
      ...(input.minimumQuantity !== undefined ? { minimum_quantity: input.minimumQuantity } : {}),
      ...(input.billingIncrement !== undefined ? { billing_increment: input.billingIncrement } : {}),
      ...(input.minimumCharge !== undefined ? { minimum_charge: input.minimumCharge } : {}),
      ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
      ...(input.requiresReview !== undefined ? { requires_review: input.requiresReview } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    })
    .eq('tenant_id', tenantId)
    .eq('id', entryId)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(traduireErreurCatalogue(error.message, error.code))
  if (!data) throw new Error('Tarif introuvable dans le catalogue de ce pressing.')
  // Même principe que `createCatalogEntry` : le cache local suit la modification
  // même si le `refreshCatalog` qui suit échoue sur une coupure réseau.
  await db.catalogEntries.put(toLocal(data as CatalogEntryRow))
}

/** Désactive une prestation (historique préservé, elle n'est plus proposée). */
export async function deactivateCatalogEntry(tenantId: string, entryId: string): Promise<void> {
  await updateCatalogEntry(tenantId, entryId, { isActive: false })
}

/** Supprime définitivement une prestation du catalogue (en ligne ou en cache local). */
export async function deleteCatalogEntry(tenantId: string, entryId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const entree = await db.catalogEntries.get(entryId)
    if (!entree || entree.tenantId !== tenantId) {
      throw new Error('Tarif introuvable dans le catalogue de ce pressing.')
    }
    await db.catalogEntries.delete(entryId)
    return
  }

  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('catalog_entries')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', entryId)

  if (error) throw new Error(traduireErreurCatalogue(error.message, error.code))
  await db.catalogEntries.delete(entryId)
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
 *
 * Mode démonstration (pas de projet Supabase) : la grille est installée
 * directement dans le cache local, comme le reste du catalogue en démo. Elle
 * reste marquée « à vérifier » — la décision tarifaire appartient au
 * propriétaire, même hors réseau. Elle sera remplacée par le référentiel
 * serveur au premier `refreshCatalog` réussi.
 */
export async function seedDefaultCatalog(tenantId: string): Promise<number> {
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

  if (!isSupabaseConfigured) {
    await db.transaction('rw', db.catalogEntries, async () => {
      await db.catalogEntries.bulkPut(
        lignes.map((ligne) => ({
          id: ligne.id,
          tenantId: ligne.tenant_id,
          article: ligne.article,
          service: ligne.service,
          price: ligne.price,
          pricingMode: ligne.pricing_mode,
          billingUnit: ligne.billing_unit,
          familyName: null,
          minimumQuantity: null,
          billingIncrement: null,
          minimumCharge: null,
          conditions: null,
          requiresReview: ligne.requires_review,
          isActive: true,
          referencesActive: true,
          sortOrder: ligne.sort_order,
        })),
      )
    })
    return lignes.length
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('catalog_entries')
    .upsert(lignes, { onConflict: 'tenant_id,article,service', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(traduireErreurCatalogue(error.message, error.code))
  return data?.length ?? 0
}
