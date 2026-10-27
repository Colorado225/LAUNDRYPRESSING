import type { DashboardSnapshot } from '@/services/dashboardService'
import type { OrderGarmentType, OrderStatus } from '@/types/database'

/**
 * Jeu de données de démonstration.
 *
 * Il reprend **exactement** les valeurs de la maquette validée (chiffre
 * d'affaires, commandes, série de sept jours, tickets `#000125`…) afin que la
 * reproduction visuelle soit comparable à l'image de référence.
 *
 * ⚠️ Ce fichier n'est lu que lorsque `useDemoStore().actif` est vrai, et son
 * contenu est alors signalé à l'écran comme fictif. Aucune de ces valeurs ne
 * doit être importée par un écran de production ni utilisée dans un calcul
 * métier : elles ne sortent jamais de la couche d'affichage.
 */

/** Un point de la courbe de chiffre d'affaires (7 derniers jours). */
export interface PointDemo {
  /** AAAA-MM-JJ */
  date: string
  /** Libellé de l'axe horizontal (« 20 oct. »). */
  label: string
  montant: number
}

/** Indicateur du tableau de bord, avec sa variation annoncée. */
export interface IndicateurDemo {
  libelle: string
  valeur: string
  /** Variation par rapport à la veille, en pourcentage (négatif = baisse). */
  variation: number
  detail: string
  ton: 'neutre' | 'positif' | 'alerte'
}

/** Ligne du tableau « Commandes récentes ». */
export interface CommandeRecenteDemo {
  reference: string
  client: string
  articles: string
  montant: number
  statut: OrderStatus
  date: string
}

/** Carte du Kanban de démonstration. */
export interface CarteAtelierDemo {
  reference: string
  client: string
  articles: number
  montant: number
  recueLe: string
  statut: OrderStatus
}

/**
 * Prix indicatifs affichés sur les tuiles de la réception, en mode démonstration.
 *
 * Le produit réel ne connaît pas de prix par type de vêtement (la migration 021
 * a supprimé le catalogue ; le prix se saisit sur la ligne). Ces valeurs
 * servent uniquement à montrer la maquette : elles ne sont **jamais** utilisées
 * pour calculer un total, et n'apparaissent que si le mode démonstration est
 * actif.
 */
export const PRIX_ARTICLES_DÉMO: Partial<Record<OrderGarmentType, number>> = {
  CHEMISE: 2_500,
  T_SHIRT: 1_500,
  PANTALON: 2_000,
  JEAN: 2_500,
  ROBE: 3_500,
  JUPE: 2_000,
  VESTE: 4_000,
  COSTUME: 6_000,
  BOUBOU: 4_500,
  DRAP: 1_800,
  SERVIETTE: 1_000,
  AUTRE: 1_500,
}

export const SÉRIE_DÉMO: readonly PointDemo[] = [
  { date: '2026-10-20', label: '20 oct.', montant: 250_000 },
  { date: '2026-10-21', label: '21 oct.', montant: 350_000 },
  { date: '2026-10-22', label: '22 oct.', montant: 410_000 },
  { date: '2026-10-23', label: '23 oct.', montant: 300_000 },
  { date: '2026-10-24', label: '24 oct.', montant: 400_000 },
  { date: '2026-10-25', label: '25 oct.', montant: 395_000 },
  { date: '2026-10-26', label: '26 oct.', montant: 610_000 },
]

export const INDICATEURS_DÉMO: readonly IndicateurDemo[] = [
  {
    libelle: "Chiffre d'affaires",
    valeur: '482 500 FCFA',
    variation: 12,
    detail: 'vs hier',
    ton: 'positif',
  },
  { libelle: 'Commandes', valeur: '28', variation: 8, detail: 'vs hier', ton: 'neutre' },
  {
    libelle: 'En cours de traitement',
    valeur: '12',
    variation: -14,
    detail: 'vs hier',
    ton: 'alerte',
  },
  {
    libelle: 'Prêtes à être livrées',
    valeur: '16',
    variation: 23,
    detail: 'vs hier',
    ton: 'positif',
  },
]

export const COMMANDES_RÉCENTES_DÉMO: readonly CommandeRecenteDemo[] = [
  {
    reference: '#000125',
    client: 'Awa Koné',
    articles: '3 pièces',
    montant: 7_500,
    statut: 'received',
    date: '2026-10-26',
  },
  {
    reference: '#000124',
    client: 'Koffi Bah',
    articles: '1 costume',
    montant: 12_000,
    statut: 'washing',
    date: '2026-10-26',
  },
  {
    reference: '#000123',
    client: 'Fatou Diarra',
    articles: '5 pièces',
    montant: 9_500,
    statut: 'ready',
    date: '2026-10-25',
  },
  {
    reference: '#000122',
    client: 'Ibrahim Touré',
    articles: '2 boubous',
    montant: 6_000,
    statut: 'ironing',
    date: '2026-10-25',
  },
  {
    reference: '#000121',
    client: 'N’Guessan Affoué',
    articles: '4 pièces',
    montant: 5_500,
    statut: 'delivered',
    date: '2026-10-25',
  },
]

export const ATELIER_DÉMO: readonly CarteAtelierDemo[] = [
  {
    reference: '#000125',
    client: 'Awa Koné',
    articles: 3,
    montant: 7_500,
    recueLe: '2026-10-26T08:20:00Z',
    statut: 'received',
  },
  {
    reference: '#000124',
    client: 'Koffi Bah',
    articles: 1,
    montant: 12_000,
    recueLe: '2026-10-26T07:45:00Z',
    statut: 'sorting',
  },
  {
    reference: '#000123',
    client: 'Fatou Diarra',
    articles: 5,
    montant: 9_500,
    recueLe: '2026-10-25T16:10:00Z',
    statut: 'washing',
  },
  {
    reference: '#000122',
    client: 'Ibrahim Touré',
    articles: 2,
    montant: 6_000,
    recueLe: '2026-10-25T11:30:00Z',
    statut: 'ironing',
  },
  {
    reference: '#000121',
    client: 'N’Guessan Affoué',
    articles: 4,
    montant: 5_500,
    recueLe: '2026-10-25T09:05:00Z',
    statut: 'ready',
  },
]

/** Somme de la série de démonstration (utilisée pour le total sept jours). */
export function totalSérieDémo(): number {
  return SÉRIE_DÉMO.reduce((somme, point) => somme + point.montant, 0)
}

/**
 * Instantané de démonstration, au **même format** que celui du tableau de bord
 * réel (`DashboardSnapshot`). Les écrans n'ont donc aucune branche à ajouter :
 * ils reçoivent un instantané et l'affichent. La seule différence est le
 * bandeau, affiché par la coquille.
 */
export function instantanéDémo(): DashboardSnapshot {
  return {
    today: '26 oct. 2026',
    ordersToday: 28,
    // 26 commandes la veille : +8 %, la variation annoncée par la maquette.
    ordersYesterday: 26,
    activeOrders: 12,
    readyOrders: 16,
    lateOrders: 3,
    outstanding: 94_000,
    cashToday: 482_500,
    // 430 804 la veille : +12 %, la variation annoncée par la maquette.
    cashYesterday: 430_804,
    cashWeek: totalSérieDémo(),
    averageBasket: 17_232,
    series: SÉRIE_DÉMO.map((point) => ({
      date: point.date,
      label: point.label,
      cash: point.montant,
    })),
    byStatus: [
      { status: 'received', label: 'Reçue', count: 4 },
      { status: 'washing', label: 'En lavage', count: 5 },
      { status: 'ironing', label: 'En repassage', count: 3 },
      { status: 'ready', label: 'Prête', count: 16 },
    ],
    topServices: [
      { label: 'Pressing chemise', count: 42, amount: 105_000 },
      { label: 'Blanchisserie au kilo', count: 18, amount: 216_000 },
      { label: 'Costume complet', count: 7, amount: 84_000 },
    ],
  }
}
