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

/**
 * Pagination **par curseur** (listes alimentées par le serveur).
 *
 * Pourquoi pas `offset` ? Parce qu'entre deux pages une dépense peut être
 * ajoutée : avec `range(0, 24)` puis `range(25, 49)`, la nouvelle ligne décale
 * tout et l'utilisateur voit deux fois la même dépense — puis en rate une. Le
 * curseur retient la **dernière ligne vue** et demande « ce qui vient après »,
 * ce qui reste juste même si la liste bouge.
 *
 * Le tri doit être total : `created_at` seul ne suffit pas (deux dépenses
 * peuvent partager l'horodatage), d'où `id` en second critère.
 */
export interface Curseur {
  /** Valeur de la colonne de tri de la dernière ligne vue (ISO). */
  valeur: string
  /** Identifiant de cette ligne, départage deux valeurs égales. */
  id: string
}

/**
 * Découpe une page reçue du serveur.
 *
 * On demande `limite + 1` lignes : la ligne supplémentaire sert uniquement à
 * savoir s'il existe une suite, sans compter la table entière (un `count(*)`
 * coûte un balayage complet à chaque page).
 */
export function decouperPageCurseur<T extends { id: string }>(
  lignes: readonly T[],
  limite: number,
  valeurDe: (ligne: T) => string,
): { lignes: T[]; curseur: Curseur | null; aPlus: boolean } {
  const taille = Math.max(1, Math.floor(limite))
  const aPlus = lignes.length > taille
  const retenues = lignes.slice(0, taille)
  const derniere = retenues.at(-1)

  return {
    lignes: retenues,
    curseur: derniere ? { valeur: valeurDe(derniere), id: derniere.id } : null,
    aPlus,
  }
}

/**
 * Filtre PostgREST « strictement après ce curseur ».
 *
 * Produit `created_at.lt.V, and(created_at.eq.V, id.lt.ID)`, à passer à `.or()`.
 * L'ordre décroissant se lit donc : plus ancien que la dernière ligne vue, ou
 * même horodatage mais identifiant plus petit.
 *
 * Les valeurs sont échappées des caractères qui ont un sens dans la syntaxe
 * PostgREST (`,`, `(`, `)`). Un horodatage ISO et un UUID n'en contiennent
 * jamais, mais la fonction ne doit pas dépendre de cette hypothèse.
 */
export function filtreCurseur(colonne: string, curseur: Curseur): string {
  const valeur = String(curseur.valeur).replace(/[,()]/g, '')
  const id = String(curseur.id).replace(/[,()]/g, '')
  return `${colonne}.lt.${valeur},and(${colonne}.eq.${valeur},id.lt.${id})`
}
