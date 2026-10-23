import type { OrderStatus, PaymentMethod, PaymentStatus, TenantRole } from '@/types/database'

/**
 * Référentiel des statuts de commande.
 *
 * Le libellé technique (`received`…) est celui stocké en base et dans Dexie ;
 * le libellé français n'existe qu'à l'affichage. Cela évite de casser la
 * synchronisation si la formulation métier évolue.
 */

export interface OrderStatusMeta {
  value: OrderStatus
  label: string
  shortLabel: string
  description: string
  /** Classes Tailwind du badge (fond + texte + bordure). */
  badgeClass: string
  /** Étape du parcours linéaire, `null` pour les statuts hors flux. */
  step: number | null
}

export const ORDER_STATUSES: Record<OrderStatus, OrderStatusMeta> = {
  received: {
    value: 'received',
    label: 'Reçue',
    shortLabel: 'Reçue',
    description: 'Commande enregistrée au comptoir, en attente de prise en charge.',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    step: 1,
  },
  sorting: {
    value: 'sorting',
    label: 'En tri',
    shortLabel: 'Tri',
    description: 'Vêtements triés par type, couleur et traitement.',
    badgeClass: 'bg-amber-100 text-amber-700 border-amber-200',
    step: 2,
  },
  washing: {
    value: 'washing',
    label: 'En lavage',
    shortLabel: 'Lavage',
    description: 'Vêtements en machine ou en nettoyage à sec.',
    badgeClass: 'bg-sky-100 text-sky-700 border-sky-200',
    step: 3,
  },
  drying: {
    value: 'drying',
    label: 'En séchage',
    shortLabel: 'Séchage',
    description: 'Lavage terminé, séchage en cours.',
    badgeClass: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    step: 4,
  },
  ironing: {
    value: 'ironing',
    label: 'En repassage',
    shortLabel: 'Repassage',
    description: 'Séchage terminé, repassage et finitions en cours.',
    badgeClass: 'bg-violet-100 text-violet-700 border-violet-200',
    step: 5,
  },
  quality_check: {
    value: 'quality_check',
    label: 'Contrôle qualité',
    shortLabel: 'Contrôle',
    description: 'Vérification des vêtements avant mise à disposition.',
    badgeClass: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    step: 6,
  },
  ready: {
    value: 'ready',
    label: 'Prête',
    shortLabel: 'Prête',
    description: 'Commande prête à être retirée par le client.',
    badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    step: 7,
  },
  delivered: {
    value: 'delivered',
    label: 'Livrée',
    shortLabel: 'Livrée',
    description: 'Vêtements remis au client.',
    badgeClass: 'bg-brand-navy/10 text-brand-navy border-brand-navy/20',
    step: 8,
  },
  cancelled: {
    value: 'cancelled',
    label: 'Annulée',
    shortLabel: 'Annulée',
    description: 'Commande annulée — aucune suite ne sera donnée.',
    badgeClass: 'bg-rose-100 text-rose-700 border-rose-200',
    step: null,
  },
}

/** Parcours linéaire utilisé par l'atelier et par le changement de statut. */
export const ORDER_FLOW: readonly OrderStatus[] = [
  'received',
  'sorting',
  'washing',
  'drying',
  'ironing',
  'quality_check',
  'ready',
  'delivered',
]

/** Statuts encore en cours de traitement (utilisés pour les compteurs). */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'received',
  'sorting',
  'washing',
  'drying',
  'ironing',
  'quality_check',
  'ready',
]

/** Statut suivant dans le parcours linéaire, ou `null` en fin de vie. */
export function getNextStatus(status: OrderStatus): OrderStatus | null {
  const index = ORDER_FLOW.indexOf(status)
  if (index === -1 || index === ORDER_FLOW.length - 1) return null
  return ORDER_FLOW[index + 1] ?? null
}

/** Statut précédent (permet à l'atelier de corriger une erreur de scan). */
export function getPreviousStatus(status: OrderStatus): OrderStatus | null {
  const index = ORDER_FLOW.indexOf(status)
  if (index <= 0) return null
  return ORDER_FLOW[index - 1] ?? null
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Non payée',
  partial: 'Partiellement payée',
  paid: 'Payée',
}

export const PAYMENT_STATUS_BADGE_CLASS: Record<PaymentStatus, string> = {
  pending: 'bg-rose-100 text-rose-700 border-rose-200',
  partial: 'bg-amber-100 text-amber-700 border-amber-200',
  paid: 'bg-emerald-100 text-emerald-700 border-emerald-200',
}

/* -------------------------------------------------------------------------- */
/* Rôles et moyens de paiement                                                 */
/* -------------------------------------------------------------------------- */

/** Libellés français des rôles de `tenant_users` (phase 5). */
export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Propriétaire',
  receptionist: 'Réceptionniste',
  artisan: 'Artisan',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  wave: 'Wave',
  orange_money: 'Orange Money',
  mtn_momo: 'MTN MoMo',
  moov_money: 'Moov Money',
  cash: 'Espèces',
}

/**
 * Rang d'un statut dans le parcours (1 → 8), `null` pour une sortie de
 * parcours (annulation). Doit rester aligné sur la fonction SQL
 * `order_status_rank` : c'est elle qui fait foi, cette copie sert à
 * n'afficher dans l'interface que des transitions réellement acceptées.
 */
export function orderStatusRank(status: OrderStatus): number | null {
  const index = ORDER_FLOW.indexOf(status)
  return index === -1 ? null : index + 1
}

/**
 * Une commande est en retard si son échéance est passée et qu'elle n'est ni
 * livrée ni annulée. `today` est une date ISO (`AAAA-MM-JJ`) fournie par
 * l'appelant pour que la fonction reste pure et testable.
 */
export function isOrderLate(
  order: { dueDate: string | null; status: OrderStatus },
  today: string,
): boolean {
  if (!order.dueDate) return false
  if (order.status === 'delivered' || order.status === 'cancelled') return false
  return order.dueDate < today
}

/** Date ISO (AAAA-MM-JJ) du jour, dans le fuseau du pressing (Abidjan, UTC+0). */
export function todayIso(now: Date = new Date()): string {
  // `en-CA` produit directement AAAA-MM-JJ ; le fuseau explicite évite le
  // décalage d'un jour sur une tablette mal configurée.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Abidjan' }).format(now)
}

/**
 * Statuts vers lesquels un rôle peut faire évoluer une commande.
 *
 * Cette liste reflète exactement `guard_order_update` (migration 004) :
 *  - tout le monde peut avancer (le saut d'étapes est permis, c'est une petite
 *    structure où la même personne enchaîne souvent tri et lavage) ;
 *  - seul le propriétaire peut revenir en arrière ;
 *  - l'annulation est réservée au propriétaire et au réceptionniste ;
 *  - une commande annulée n'est rouverte que par le propriétaire.
 *
 * Filtrer côté interface évite qu'un clic inutile parte puis revienne en erreur
 * 42501 — la sécurité reste serveur, ceci n'est que du confort.
 */
export function allowedStatusTargets(
  current: OrderStatus,
  role: TenantRole | null | undefined,
): OrderStatus[] {
  const rangCourant = orderStatusRank(current)

  if (current === 'cancelled') {
    return role === 'owner' ? [...ORDER_FLOW] : []
  }

  if (rangCourant === null) return []

  const avant = ORDER_FLOW.filter((statut) => (orderStatusRank(statut) ?? 0) > rangCourant)
  const arriere = ORDER_FLOW.filter((statut) => (orderStatusRank(statut) ?? 0) < rangCourant)

  if (role === 'owner') return [...arriere, ...avant, 'cancelled']

  if (role === 'receptionist') {
    // Une commande livrée est définitive pour le comptoir.
    return current === 'delivered' ? [] : [...avant, 'cancelled']
  }

  return avant
}
