import type { OrderStatus } from '@/types/database'

/**
 * Regroupement des commandes en trois colonnes d'atelier.
 *
 * Le parcours réel compte huit statuts (`received` → `delivered`). La maquette
 * n'en montre que trois colonnes. Réduire le modèle à trois statuts
 * appauvrirait le suivi et la base (le statut est historisé, il pilote le
 * garde-fou serveur et les notifications client) : on **regroupe** donc, sans
 * rien perdre. Chaque carte conserve son statut exact, et la colonne n'est
 * qu'une vue d'ensemble.
 *
 * Module volontairement pur : aucune lecture de base, aucun rendu. Il est donc
 * testable et réutilisable par l'écran comme par les tests.
 */

export type IdentifiantColonne = 'recues' | 'en_cours' | 'pretes'

export interface ColonneAtelier {
  id: IdentifiantColonne
  titre: string
  description: string
  /** Statuts réels regroupés dans cette colonne. */
  statuts: readonly OrderStatus[]
  /** Classes Tailwind de l'en-tête (fond pâle + texte + bordure). */
  enteteClass: string
  /** Classe du fond de colonne (très légèrement teinté). */
  fondClass: string
}

export const COLONNES_ATELIER: readonly ColonneAtelier[] = [
  {
    id: 'recues',
    titre: 'Reçues',
    description: 'Déposées au comptoir, pas encore prises en charge.',
    statuts: ['received', 'sorting'],
    enteteClass: 'border-sky-200 bg-sky-50 text-sky-900',
    fondClass: 'bg-sky-50/40',
  },
  {
    id: 'en_cours',
    titre: 'En cours',
    description: 'Lavage, séchage, repassage ou contrôle qualité.',
    statuts: ['washing', 'drying', 'ironing', 'quality_check'],
    enteteClass: 'border-amber-200 bg-amber-50 text-amber-900',
    fondClass: 'bg-amber-50/40',
  },
  {
    id: 'pretes',
    titre: 'Prêtes',
    description: 'À remettre au client — l’argent est déjà gagné.',
    statuts: ['ready'],
    enteteClass: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    fondClass: 'bg-emerald-50/40',
  },
]

/** Colonne d'un statut donné ; `null` pour les statuts hors atelier. */
export function colonneDe(statut: OrderStatus): IdentifiantColonne | null {
  const colonne = COLONNES_ATELIER.find((candidate) => candidate.statuts.includes(statut))
  return colonne?.id ?? null
}

export interface RepartitionAtelier<T> {
  colonne: ColonneAtelier
  commandes: T[]
}

/**
 * Répartit des commandes dans les trois colonnes, dans l'ordre du parcours.
 *
 * Les commandes livrées ou annulées ne figurent dans aucune colonne : elles ne
 * sont plus dans l'atelier. Les laisser dans « Prêtes » ferait croire qu'il
 * reste du linge à remettre.
 */
export function repartirParColonne<T extends { status: OrderStatus }>(
  commandes: readonly T[],
): RepartitionAtelier<T>[] {
  return COLONNES_ATELIER.map((colonne) => ({
    colonne,
    commandes: commandes.filter((commande) => colonne.statuts.includes(commande.status)),
  }))
}

/** Nombre total de commandes présentes dans l'atelier (hors livrées/annulées). */
export function totalAtelier<T extends { status: OrderStatus }>(commandes: readonly T[]): number {
  return commandes.filter((commande) => colonneDe(commande.status) !== null).length
}
