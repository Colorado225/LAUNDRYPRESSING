import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { getTenantId } from '@/lib/tenantContext'
import { newId, nowIso } from '@/lib/ids'
import { db, type LocalOrder } from '@/db/localDb'
import type { PaymentMethod, PaymentStatus } from '@/types/database'

/**
 * Service de paiement Mobile Money (CinetPay).
 *
 * Le paiement est le SEUL module qui exige impérativement internet :
 * il ouvre un guichet hébergé par CinetPay. Les commandes, elles, restent
 * créables hors ligne (phase 2).
 *
 * Flux :
 *   navigateur → Edge Function `cinetpay-init` (JWT + montant relu en base)
 *              → CinetPay /v2/payment → URL du guichet
 *   CinetPay    → Edge Function `cinetpay-webhook` (notification serveur)
 *              → vérification /v2/payment/check → orders.payment_status = 'paid'
 *   navigateur → /paiement/retour (lecture seule, ne met JAMAIS à jour la base)
 */

export interface PaymentInitResult {
  paymentUrl: string
  transactionId: string
  /** Montant réellement débité (arrondi au multiple de 5 exigé par CinetPay). */
  chargedAmount: number
  orderAmount: number
}

export class PaymentError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PaymentError'
    this.code = code
  }
}

/** `true` si un paiement peut être initié depuis cet appareil maintenant. */
export function canInitiatePayment(): { ok: boolean; reason: string | null } {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      reason:
        'Supabase n’est pas configuré : le bouton permet seulement une simulation locale, sans encaissement réel.',
    }
  }
  if (!navigator.onLine) {
    return {
      ok: false,
      reason:
        'Le paiement Mobile Money nécessite une connexion internet. La commande reste enregistrée localement.',
    }
  }
  return { ok: true, reason: null }
}

/** Arrondi au multiple de 5 supérieur — même règle que l'Edge Function. */
export function chargeableAmount(total: number): number {
  return Math.ceil(total / 5) * 5
}

/**
 * Initie un paiement et retourne l'URL du guichet CinetPay.
 *
 * Le paramètre `orderId` seul est réellement utilisé : le montant et le nom du
 * client envoyés par l'interface sont ignorés côté serveur, qui relit la base.
 * On les transmet malgré tout pour respecter le contrat du cahier des charges.
 */
export async function initiatePayment(
  order: LocalOrder,
  customer: { name: string; phone: string },
): Promise<PaymentInitResult> {
  const guard = canInitiatePayment()
  if (!guard.ok) {
    const code = isSupabaseConfigured ? 'offline' : 'supabase_unconfigured'
    throw new PaymentError(code, guard.reason ?? 'Paiement indisponible.')
  }

  const tenantId = getTenantId()
  if (!tenantId || tenantId !== order.tenantId) {
    throw new PaymentError(
      'tenant_mismatch',
      'Aucun pressing sélectionné : impossible d’initier le paiement.',
    )
  }

  const supabase = getSupabaseClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    throw new PaymentError(
      'not_authenticated',
      'Vous devez être connecté à votre pressing pour encaisser un paiement.',
    )
  }

  // Trace locale de la tentative (visible même si l'appel échoue).
  const localRecordId = newId()
  await db.pendingPayments.put({
    id: localRecordId,
    orderId: order.id,
    tenantId,
    amount: chargeableAmount(order.totalAmount),
    method: null,
    status: 'sending',
    reference: null,
    createdAt: nowIso(),
    lastError: null,
  })

  try {
    const { data, error } = await supabase.functions.invoke('cinetpay-init', {
      body: {
        orderId: order.id,
        amount: order.totalAmount,
        customerName: customer.name,
        customerPhone: customer.phone,
      },
    })

    if (error) {
      // `error` d'une Edge Function peut encapsuler la réponse JSON d'erreur.
      const details = await extractEdgeFunctionError(error)
      throw new PaymentError(details.code, details.message)
    }

    const payload = data as
      | { payment_url?: string; transaction_id?: string; amount?: number; order_amount?: number }
      | null

    if (!payload?.payment_url || !payload.transaction_id) {
      throw new PaymentError(
        'invalid_response',
        'Réponse inattendue du service de paiement. Réessayez dans un instant.',
      )
    }

    await db.pendingPayments.update(localRecordId, {
      status: 'pending',
      reference: payload.transaction_id,
      lastError: null,
    })

    return {
      paymentUrl: payload.payment_url,
      transactionId: payload.transaction_id,
      chargedAmount: payload.amount ?? chargeableAmount(order.totalAmount),
      orderAmount: payload.order_amount ?? order.totalAmount,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Le paiement n’a pas pu être initié. Vérifiez la connexion et réessayez.'

    await db.pendingPayments.update(localRecordId, {
      status: 'error',
      lastError: message,
    })

    if (error instanceof PaymentError) throw error
    throw new PaymentError('provider_unreachable', message)
  }
}

/** Redirige le navigateur vers le guichet CinetPay. */
export function redirectToPayment(paymentUrl: string): void {
  window.location.assign(paymentUrl)
}

export interface PaymentState {
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod | null
  /** Statut de la dernière transaction CinetPay, si connue du serveur. */
  transactionStatus: string | null
  paidAt: string | null
  /** `false` si Supabase est injoignable : l'état affiché vient du cache local. */
  fromServer: boolean
}

/**
 * Relit l'état du paiement.
 *
 * 1. Interroge `payment_transactions` (lecture autorisée par la RLS au tenant).
 * 2. Si la transaction est acceptée, met à jour la copie locale de la commande.
 *
 * C'est une opération de LECTURE : l'écran de retour ne valide jamais un
 * paiement par lui-même (seul le webhook fait autorité).
 */
export async function fetchPaymentState(orderId: string): Promise<PaymentState> {
  const local = await db.orders.get(orderId)
  const fallback: PaymentState = {
    paymentStatus: local?.paymentStatus ?? 'pending',
    paymentMethod: local?.paymentMethod ?? null,
    transactionStatus: null,
    paidAt: null,
    fromServer: false,
  }

  if (!isSupabaseConfigured || !navigator.onLine) return fallback

  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('payment_transactions')
      .select('status, payment_method, paid_at, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return fallback

    const row = data as {
      status: string
      payment_method: PaymentMethod | null
      paid_at: string | null
    }

    const isPaid = row.status === 'paid'

    if (local && isPaid && local.paymentStatus !== 'paid') {
      await db.orders.update(orderId, {
        paymentStatus: 'paid',
        paymentMethod: row.payment_method ?? local.paymentMethod,
        synced: 1,
        syncedAt: row.paid_at ?? nowIso(),
        syncError: null,
      })
    }

    return {
      paymentStatus: isPaid ? 'paid' : local?.paymentStatus ?? 'pending',
      paymentMethod: row.payment_method ?? local?.paymentMethod ?? null,
      transactionStatus: row.status,
      paidAt: row.paid_at,
      fromServer: true,
    }
  } catch {
    return fallback
  }
}

/** Extrait le message d'erreur d'une réponse d'Edge Function non-2xx. */
export async function extractEdgeFunctionError(
  error: unknown,
): Promise<{ code: string; message: string }> {
  const candidate = error as { context?: Response; message?: string }

  if (candidate.context instanceof Response) {
    try {
      const body = (await candidate.context.json()) as {
        error?: { code?: string; message?: string }
      }
      if (body.error?.message) {
        return {
          // Seuls ces deux états autorisent le parcours simulé : la fonction
          // n'est pas déployée, ou CinetPay n'a pas encore ses clés. Un 401,
          // 403, 422 ou 500 conserve son erreur réelle et ne devient jamais
          // silencieusement une « simulation réussie ».
          code:
            candidate.context.status === 404
              ? 'function_not_deployed'
              : body.error.code ?? 'edge_error',
          message: body.error.message,
        }
      }
    } catch {
      // Corps non JSON : on retombe sur le message générique.
    }

    if (candidate.context.status === 404) {
      return {
        code: 'function_not_deployed',
        message: 'La fonction de paiement n’est pas encore déployée.',
      }
    }
  }

  return {
    code: 'edge_error',
    message:
      candidate.message ??
      'Le service de paiement est injoignable. Vérifiez la connexion puis réessayez.',
  }
}
