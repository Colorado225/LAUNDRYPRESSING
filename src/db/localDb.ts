import Dexie, { type Table } from 'dexie'
import type { OrderStatus, PaymentMethod, PaymentStatus } from '@/types/database'

/**
 * Base locale (IndexedDB via Dexie) — socle du mode offline-first.
 *
 * Principes :
 *  - L'application écrit TOUJOURS en local d'abord, puis synchronise.
 *  - `synced` vaut 1 quand la ligne est identique à la version serveur.
 *    Il repasse à 0 à chaque modification locale (création OU changement de
 *    statut) : le moteur de synchronisation ré-envoie alors la ligne entière.
 *    Ce choix évite une file d'opérations séparée, au prix d'un `upsert`
 *    complet — acceptable pour des volumes de quelques dizaines de
 *    commandes par jour.
 *  - `synced` est un NOMBRE (0/1) et non un booléen : IndexedDB n'accepte pas
 *    les booléens comme clé d'index.
 */

export type SyncFlag = 0 | 1

/** Commande stockée localement (camelCase, aligné sur le frontend). */
export interface LocalOrder {
  id: string
  tenantId: string
  customerName: string
  customerPhone: string
  status: OrderStatus
  qrCode: string
  photoUrl: string | null
  totalAmount: number
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod | null
  createdAt: string
  updatedAt: string
  synced: SyncFlag
  syncedAt: string | null
  /** Dernière erreur de synchronisation, affichée dans le bandeau d'état. */
  syncError: string | null
}

/** Vêtement d'une commande. */
export interface LocalOrderItem {
  id: string
  orderId: string
  tenantId: string
  label: string
  fabricType: string | null
  specialInstructions: string | null
  price: number
}

/**
 * Paiement Mobile Money en attente d'envoi (utilisé en Phase 4).
 * Le store existe dès la Phase 2 pour éviter une migration de schéma Dexie.
 */
export interface LocalPendingPayment {
  id: string
  orderId: string
  tenantId: string
  amount: number
  method: PaymentMethod
  status: 'pending' | 'sending' | 'error'
  reference: string | null
  createdAt: string
  lastError: string | null
}

export class PressingDatabase extends Dexie {
  orders!: Table<LocalOrder, string>
  orderItems!: Table<LocalOrderItem, string>
  pendingPayments!: Table<LocalPendingPayment, string>

  constructor() {
    super('pressing-pro')

    this.version(1).stores({
      // Index composites : les requêtes de l'application filtrent toujours
      // par tenant AVANT de filtrer par statut ou par état de synchro.
      orders: 'id, tenantId, status, synced, createdAt, [tenantId+status], [tenantId+synced]',
      orderItems: 'id, orderId, tenantId, [orderId+tenantId]',
      pendingPayments: 'id, orderId, tenantId, status, createdAt',
    })
  }
}

export const db = new PressingDatabase()

/** Supprime toutes les données locales (déconnexion, changement de pressing). */
export async function clearLocalData(): Promise<void> {
  await db.transaction('rw', db.orders, db.orderItems, db.pendingPayments, async () => {
    await Promise.all([db.orders.clear(), db.orderItems.clear(), db.pendingPayments.clear()])
  })
}
