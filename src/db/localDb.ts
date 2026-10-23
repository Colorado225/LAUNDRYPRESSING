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
  /**
   * Version connue côté serveur (0 tant que la commande n'a jamais été
   * synchronisée). Sert de jeton au verrou optimiste : une mise à jour n'est
   * acceptée que si le serveur est toujours à cette version.
   */
  serverVersion: number
  /** Dernière erreur de synchronisation, affichée dans le bandeau d'état. */
  syncError: string | null
  /**
   * Renseigné quand le serveur a refusé une mise à jour parce que la commande
   * avait été modifiée ailleurs. La commande reste en file et n'est plus
   * renvoyée tant que l'utilisateur n'a pas choisi quelle version garder.
   */
  syncConflict: string | null
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
  /** Opérateur choisi sur le guichet CinetPay : inconnu au moment de l'initiation. */
  method: PaymentMethod | null
  /** `pending` = guichet ouvert, en attente de la confirmation serveur. */
  status: 'pending' | 'sending' | 'error'
  /** Identifiant de transaction CinetPay (`transaction_id`). */
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

    // v2 (phase 3) : ajout de l'index `qrCode`, indispensable au scan de
    // l'atelier — rechercher une commande sans index parcourrait toute la table.
    // Dexie réindexe automatiquement les enregistrements existants.
    this.version(2).stores({
      orders: 'id, tenantId, status, synced, createdAt, qrCode, [tenantId+status], [tenantId+synced]',
    })

    // v3 (palier 1) : verrou optimiste et marqueur de conflit. Aucun index
    // nouveau — ces champs ne servent pas de critère de requête — mais les
    // enregistrements existants doivent recevoir une valeur par défaut, sinon
    // `serverVersion` resterait `undefined` et la première mise à jour
    // partirait avec un jeton invalide.
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('orders')
          .toCollection()
          .modify((order: LocalOrder & Record<string, unknown>) => {
            // Une commande déjà synchronisée existait forcément côté serveur
            // en version ≥ 1 ; on suppose 1, et un éventuel décalage sera
            // détecté comme un conflit à la première mise à jour.
            if (order.serverVersion === undefined) {
              order.serverVersion = order.synced === 1 ? 1 : 0
            }
            if (order.syncConflict === undefined) order.syncConflict = null
          })
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
