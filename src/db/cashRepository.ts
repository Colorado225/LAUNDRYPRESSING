import { newId, nowIso } from '@/lib/ids'
import { db, type LocalCashPayment, type SyncFlag } from './localDb'

/**
 * Dépôt des encaissements au comptoir (palier 2).
 *
 * Un encaissement est d'abord écrit EN LOCAL : au moment où le client tend ses
 * billets, la connexion peut manquer. L'argent est réputé reçu dès la saisie ;
 * la transmission au serveur est une opération de synchronisation distincte,
 * idempotente grâce à l'identifiant généré ici.
 */

/** Enregistre un encaissement en espèces dans la file locale. */
export async function queueCashPayment(
  tenantId: string,
  orderId: string,
  amount: number,
  note: string | null = null,
): Promise<LocalCashPayment> {
  const paiement: LocalCashPayment = {
    id: newId(),
    orderId,
    tenantId,
    amount,
    method: 'cash',
    note: note?.trim() ? note.trim() : null,
    receivedAt: nowIso(),
    synced: 0,
    lastError: null,
  }

  await db.cashPayments.add(paiement)
  return paiement
}

/** Encaissements d'un pressing restant à transmettre. */
export async function getPendingCashPayments(tenantId: string): Promise<LocalCashPayment[]> {
  return db.cashPayments.where('[tenantId+synced]').equals([tenantId, 0]).sortBy('receivedAt')
}

/** Marque un encaissement comme transmis. */
export async function markCashPaymentSynced(paymentId: string): Promise<void> {
  await db.cashPayments.update(paymentId, {
    synced: 1 satisfies SyncFlag,
    lastError: null,
  })
}

/**
 * Mémorise un échec de transmission.
 *
 * `definitive` vaut `true` quand le serveur a REFUSÉ l'encaissement (montant
 * invalide, rôle insuffisant, commande inconnue) : le paiement sort alors de
 * la file, mais reste affiché avec son motif. Le renvoyer indéfiniment toutes
 * les minutes ne changerait rien et masquerait le problème.
 */
export async function markCashPaymentError(
  paymentId: string,
  message: string,
  definitive: boolean,
): Promise<void> {
  await db.cashPayments.update(paymentId, {
    synced: (definitive ? 1 : 0) satisfies SyncFlag,
    lastError: message,
  })
}

/** Encaissements connus pour une commande (transmis ou non). */
export async function getCashPaymentsForOrder(orderId: string): Promise<LocalCashPayment[]> {
  return db.cashPayments.where('orderId').equals(orderId).sortBy('receivedAt')
}

/** Encaissements d'une journée, exprimée en date d'Abidjan. */
export async function getCashPaymentsForDay(
  tenantId: string,
  businessDate: string,
): Promise<LocalCashPayment[]> {
  const paiements = await db.cashPayments
    .where('tenantId')
    .equals(tenantId)
    .toArray()

  return paiements
    .filter((paiement) => dayOf(paiement.receivedAt) === businessDate)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

/** Compteurs affichés par le bandeau de synchronisation. */
export async function summariseCash(
  tenantId: string,
): Promise<{ pending: number; blocked: number; total: number }> {
  const paiements = await db.cashPayments.where('tenantId').equals(tenantId).toArray()

  return {
    pending: paiements.filter((paiement) => paiement.synced === 0).length,
    blocked: paiements.filter((paiement) => paiement.synced === 1 && paiement.lastError).length,
    total: paiements.reduce((somme, paiement) => somme + paiement.amount, 0),
  }
}

/** Total encaissé pour une commande. */
export async function totalCashForOrder(orderId: string): Promise<number> {
  const paiements = await getCashPaymentsForOrder(orderId)
  return paiements.reduce((somme, paiement) => somme + paiement.amount, 0)
}

/**
 * Jour calendaire d'un horodatage, dans le fuseau d'Abidjan (UTC+0).
 *
 * `en-CA` produit directement le format AAAA-MM-JJ attendu par PostgreSQL.
 */
export function dayOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Abidjan' }).format(new Date(iso))
}
