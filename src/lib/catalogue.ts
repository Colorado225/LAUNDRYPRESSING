import type { LocalCatalogGarment, LocalCatalogPrice } from '@/db/localDb'

/**
 * Règles pures du catalogue (Lot 1) — résolution des prix et contrôles comptoir.
 *
 * Principe (spec UI-002) : un tarif absent de la matrice est **non configuré**.
 * Il n'est jamais assimilé à 0 FCFA ni remplacé par un prix deviné : la ligne
 * est bloquée avec un message explicite, au comptoir comme côté serveur
 * (déclencheur `guard_order_item_catalog`, migration 027).
 */

export type ArticleCatalogue = LocalCatalogGarment
export type PrixCatalogue = LocalCatalogPrice

/** Clé d'index d'un prix : prestation + article. */
export function clePrix(tenantServiceId: string, garmentTypeId: string): string {
  return `${tenantServiceId}::${garmentTypeId}`
}

/** Indexe les prix actifs pour un accès O(1) dans le formulaire. */
export function indexerPrix(prices: readonly PrixCatalogue[]): Map<string, number> {
  const index = new Map<string, number>()
  for (const price of prices) {
    if (!price.isActive) continue
    index.set(clePrix(price.tenantServiceId, price.garmentTypeId), price.priceXof)
  }
  return index
}

/**
 * Prix configuré pour un couple prestation × article, ou `null` si le tarif
 * n'a pas été défini. `null` est une information métier, pas une erreur.
 */
export function prixConfigure(
  index: ReadonlyMap<string, number>,
  tenantServiceId: string | null | undefined,
  garmentTypeId: string | null | undefined,
): number | null {
  if (!tenantServiceId || !garmentTypeId) return null
  return index.get(clePrix(tenantServiceId, garmentTypeId)) ?? null
}

/**
 * Contrôle d'une ligne catalogue avant enregistrement.
 * Retourne un message français prêt à afficher, ou `null` si la ligne est vendable.
 */
export function problemeLigneCatalogue(input: {
  garmentTypeId: string | null | undefined
  garmentName?: string | null
  tenantServiceId: string | null | undefined
  serviceName?: string | null
  prix: number | null
}): string | null {
  if (!input.garmentTypeId) {
    return 'Choisissez un article du catalogue pour chaque ligne à la pièce.'
  }
  if (!input.tenantServiceId) {
    return `Choisissez la prestation pour « ${input.garmentName?.trim() || 'cet article'} ».`
  }
  if (input.prix === null) {
    const article = input.garmentName?.trim() || 'cet article'
    const service = input.serviceName?.trim() || 'cette prestation'
    return `Tarif non configuré : « ${article} » × « ${service} ». Définissez le prix dans Catalogue → Tarifs avant de vendre cette ligne.`
  }
  if (!Number.isFinite(input.prix) || input.prix <= 0) {
    return 'Le tarif catalogue doit être un montant positif en FCFA.'
  }
  return null
}

export interface GroupeArticles {
  categoryCode: string
  categoryName: string
  articles: ArticleCatalogue[]
}

/** Regroupe les articles actifs par catégorie, dans l'ordre d'affichage. */
export function articlesParCategorie(garments: readonly ArticleCatalogue[]): GroupeArticles[] {
  const groupes = new Map<string, GroupeArticles>()
  const tries = [...garments]
    .filter((garment) => garment.isActive)
    .sort(
      (a, b) =>
        a.categoryName.localeCompare(b.categoryName, 'fr') ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, 'fr'),
    )
  for (const garment of tries) {
    const groupe = groupes.get(garment.categoryCode) ?? {
      categoryCode: garment.categoryCode,
      categoryName: garment.categoryName,
      articles: [],
    }
    groupe.articles.push(garment)
    groupes.set(garment.categoryCode, groupe)
  }
  return [...groupes.values()]
}

/** Progression de la grille : combien de couples prestation × article sont tarifés. */
export function progressionGrille(input: {
  garments: readonly ArticleCatalogue[]
  serviceIdsPiece: readonly string[]
  index: ReadonlyMap<string, number>
}): { configures: number; total: number } {
  const articlesActifs = input.garments.filter((garment) => garment.isActive)
  let configures = 0
  for (const serviceId of input.serviceIdsPiece) {
    for (const garment of articlesActifs) {
      if (prixConfigure(input.index, serviceId, garment.id) !== null) configures += 1
    }
  }
  return { configures, total: articlesActifs.length * input.serviceIdsPiece.length }
}

/** Code technique stable dérivé d'un nom saisi (« Grand boubou » → `GRAND_BOUBOU`). */
export function codeDepuisNom(name: string): string {
  const code = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return code.length >= 2 ? code : `ARTICLE_${code}`.slice(0, 40)
}
