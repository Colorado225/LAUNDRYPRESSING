import type { TenantRole } from '@/types/database'

/**
 * Matrice d'autorisations (palier 1).
 *
 * Une seule source de vérité pour l'interface : les écrans interrogent `can()`
 * au lieu de comparer des rôles à la main, ce qui évite qu'un nouvel écran
 * oublie une règle.
 *
 * ⚠ Cette matrice ne remplace PAS la sécurité serveur. La RLS limite déjà les
 *   insertions au propriétaire et au réceptionniste, et un trigger
 *   (`guard_order_update`, migration 003) empêche un artisan de modifier les
 *   montants ou les coordonnées. L'interface ne fait que masquer ce qui serait
 *   refusé de toute façon.
 *
 * Décisions produit explicites :
 *  - l'artisan ne voit PAS les montants (il n'encaisse pas et n'a pas à
 *    connaître le prix des vêtements qu'il traite) ;
 *  - seul le propriétaire supprime une commande, gère le pressing et fixe les
 *    tarifs du catalogue ;
 *  - le réceptionniste encaisse (Mobile Money et espèces), clôture la caisse
 *    et crée les commandes, comme le propriétaire ;
 *  - le **stock** se consulte et se mouvemente au comptoir, mais seuls le
 *    propriétaire crée les articles, les fournisseurs et les dépenses ;
 *  - le **tableau de bord** est réservé au propriétaire : il expose la
 *    trésorerie du pressing ;
 *  - l'**abonnement** se consulte chez le propriétaire ; le **support** est
 *    ouvert au comptoir, qui constate les pannes matérielles les premiers ;
 *  - le **journal d'audit** est réservé au propriétaire : il expose qui a
 *    changé un tarif, un rôle ou une clôture, donc des décisions de gestion ;
 *  - la **console de supervision** n'est pas un rôle de pressing : elle
 *    s'appuie sur `is_platform_admin()` côté serveur.
 */
export type Capability =
  | 'orders.create'
  | 'orders.updateStatus'
  | 'orders.editDetails'
  | 'orders.delete'
  | 'payments.initiate'
  | 'cash.manage'
  | 'catalog.manage'
  | 'customers.manage'
  | 'stock.manage'
  | 'stock.move'
  | 'expenses.manage'
  | 'dashboard.view'
  | 'support.contact'
  | 'subscription.view'
  | 'audit.view'
  | 'amounts.view'
  | 'tenant.manage'

const MATRIX: Record<TenantRole, readonly Capability[]> = {
  owner: [
    'orders.create',
    'orders.updateStatus',
    'orders.editDetails',
    'orders.delete',
    'payments.initiate',
    'cash.manage',
    'catalog.manage',
    'customers.manage',
    'stock.manage',
    'stock.move',
    'expenses.manage',
    'dashboard.view',
    'support.contact',
    'subscription.view',
    'audit.view',
    'amounts.view',
    'tenant.manage',
  ],
  receptionist: [
    'orders.create',
    'orders.updateStatus',
    'orders.editDetails',
    'payments.initiate',
    'cash.manage',
    'customers.manage',
    'stock.move',
    'support.contact',
    'amounts.view',
  ],
  artisan: ['orders.updateStatus'],
}

/** `true` si le rôle courant autorise l'action. */
export function can(role: TenantRole | null | undefined, capability: Capability): boolean {
  if (!role) return false
  return MATRIX[role].includes(capability)
}

/** Raccourci lisible pour masquer les montants dans les écrans. */
export function canSeeAmounts(role: TenantRole | null | undefined): boolean {
  return can(role, 'amounts.view')
}
