/**
 * Pagination en mémoire (liste des commandes).
 *
 * Pourquoi paginer côté client alors que les données sont déjà sur l'appareil ?
 * Parce que le rendu, lui, coûte : une tablette d'entrée de gamme qui affiche
 * 800 commandes avec leurs badges ralentit nettement. On découpe donc
 * l'affichage, sans jamais interroger le réseau — la liste complète reste dans
 * IndexedDB.
 *
 * Le calcul est pur et sans dépendance, ce qui permet de le tester sans DOM.
 */

export interface Page<T> {
  /** Éléments de la page demandée (vide si la liste l'est). */
  items: T[]
  /** Page réellement affichée, après bornage (1 si la liste est vide). */
  page: number
  /** Nombre total de pages, au moins 1 pour que l'interface ait un repère. */
  pageCount: number
  total: number
  /** Rang du premier élément affiché (1-based), 0 quand la page est vide. */
  from: number
  /** Rang du dernier élément affiché (1-based), 0 quand la page est vide. */
  to: number
}

/** Taille de page retenue par la liste des commandes. */
export const DEFAULT_PAGE_SIZE = 20

export function paginate<T>(items: readonly T[], page: number, pageSize = DEFAULT_PAGE_SIZE): Page<T> {
  const taille = Math.max(1, Math.floor(pageSize))
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / taille))

  // Bornage : un filtre qui réduit la liste ne doit pas laisser l'utilisateur
  // sur une page vide.
  const demandee = Number.isFinite(page) ? Math.floor(page) : 1
  const courante = Math.min(Math.max(demandee, 1), pageCount)

  const debut = (courante - 1) * taille
  const itemsPage = items.slice(debut, debut + taille)

  return {
    items: itemsPage,
    page: courante,
    pageCount,
    total,
    from: itemsPage.length === 0 ? 0 : debut + 1,
    to: itemsPage.length === 0 ? 0 : debut + itemsPage.length,
  }
}
