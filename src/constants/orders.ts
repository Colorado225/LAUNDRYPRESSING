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
  washing: {
    value: 'washing',
    label: 'En lavage',
    shortLabel: 'Lavage',
    description: 'Vêtements en machine ou en nettoyage à sec.',
    badgeClass: 'bg-sky-100 text-sky-700 border-sky-200',
    step: 2,
  },
  ironing: {
    value: 'ironing',
    label: 'En repassage',
    shortLabel: 'Repassage',
    description: 'Lavage terminé, repassage et finitions en cours.',
    badgeClass: 'bg-violet-100 text-violet-700 border-violet-200',
    step: 3,
  },
  ready: {
    value: 'ready',
    label: 'Prête',
    shortLabel: 'Prête',
    description: 'Commande prête à être retirée par le client.',
    badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    step: 4,
  },
  delivered: {
    value: 'delivered',
    label: 'Livrée',
    shortLabel: 'Livrée',
    description: 'Vêtements remis au client.',
    badgeClass: 'bg-brand-navy/10 text-brand-navy border-brand-navy/20',
    step: 5,
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
  'washing',
  'ironing',
  'ready',
  'delivered',
]

/** Statuts encore en cours de traitement (utilisés pour les compteurs). */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'received',
  'washing',
  'ironing',
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
