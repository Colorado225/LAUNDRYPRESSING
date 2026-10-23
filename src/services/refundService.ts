import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'
import { nowIso } from '@/lib/ids'
import { db } from '@/db/localDb'

/**
 * Remboursements (palier 2).
 *
 * Un remboursement SORT de l'argent : il n'est jamais enregistré hors ligne.
 * La tablette ne peut donc pas « promettre » un remboursement qui serait refusé
 * plus tard par le serveur. Le propriétaire seul y a droit (contrôle double :
 * interface et fonction `record_refund` en base).
 */

export class RefundError extends Error {}

export interface RefundResult {
  refundId: string
  refundedTotal: number
  refundableAmount: number
}

export const MIN_REFUND_REASON = 10

export async function recordRefund(params: {
  orderId: string
  tenantId: string
  amount: number
  reason: string
  channel?: 'cash' | 'mobile_money'
}): Promise<RefundResult> {
  if (!isSupabaseConfigured) {
    throw new RefundError(
      'Le remboursement exige une connexion : il doit être validé par le serveur.',
    )
  }

  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new RefundError('Indiquez un montant entier positif.')
  }

  if (params.reason.trim().length < MIN_REFUND_REASON) {
    throw new RefundError(
      `Le motif doit contenir au moins ${MIN_REFUND_REASON} caractères.`,
    )
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('record_refund', {
    p_order_id: params.orderId,
    p_amount: params.amount,
    p_reason: params.reason.trim(),
    p_channel: params.channel ?? 'cash',
  })

  if (error) {
    throw new RefundError(traduireErreur(error.message))
  }

  // La fonction SQL renvoie du snake_case (convention PostgreSQL).
  const resultat: RefundResult = {
    refundId: data.refund_id,
    refundedTotal: data.refunded_total,
    refundableAmount: data.refundable_amount,
  }

  // Miroir local : le reçu et la fiche commande doivent afficher le
  // remboursement même si le réseau retombe juste après.
  await db.refunds.put({
    id: resultat.refundId,
    orderId: params.orderId,
    tenantId: params.tenantId,
    amount: params.amount,
    channel: params.channel ?? 'cash',
    reason: params.reason.trim(),
    refundedAt: nowIso(),
    refundedBy: null,
  })

  return resultat
}

/** Traduit les refus de la fonction SQL en message utilisable. */
function traduireErreur(message: string): string {
  if (message.includes('Seul le propriétaire')) {
    return 'Seul le propriétaire peut enregistrer un remboursement.'
  }
  if (message.includes('dépasse les encaissements nets')) {
    return message
  }
  if (message.includes('motif')) {
    return 'Un motif de 10 caractères minimum est exigé pour un remboursement.'
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Réseau indisponible : le remboursement n’a pas été enregistré.'
  }
  return message
}
