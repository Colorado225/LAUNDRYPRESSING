import { apiError, json } from '../_shared/http.ts'
import { checkPayment, mapPaymentMethod, readConfig, verifySignature } from '../_shared/cinetpay.ts'
import { createAdminClient } from '../_shared/supabaseClients.ts'

/**
 * Edge Function `cinetpay-webhook`
 * -----------------------------------------------------------------------------
 * Rôle : recevoir la notification serveur de CinetPay (notify_url) et mettre à
 * jour le statut de paiement de la commande.
 *
 * Principe de confiance — un webhook n'est JAMAIS cru sur parole :
 *  1. La notification est authentifiée par HMAC-SHA256 (CINETPAY_SECRET_KEY).
 *     Sans clé configurée, on passe en mode « vérification seule » (voir plus bas).
 *  2. Le statut est TOUJOURS reconfirmé par un appel serveur à
 *     `POST /v2/payment/check` : impossible de marquer une commande payée sans
 *     une transaction réellement acceptée chez CinetPay.
 *  3. Le montant encaissé est comparé au montant attendu.
 *  4. Traitement idempotent : CinetPay peut notifier plusieurs fois la même
 *     transaction ; une commande déjà payée n'est pas modifiée à nouveau.
 *
 * Cette fonction est déployée avec `verify_jwt = false` (CinetPay ne peut pas
 * fournir de JWT Supabase) — la sécurité vient des points 1 à 3.
 */

interface NotificationPayload {
  [key: string]: string
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    // CinetPay n'appelle pas en CORS, mais on reste tolérant.
    return new Response('ok', { status: 200 })
  }

  // CinetPay « ping » l'URL pour vérifier sa disponibilité, parfois en GET.
  if (request.method === 'GET') {
    return json({ status: 'ok', message: 'Webhook CinetPay opérationnel.' }, 200)
  }

  if (request.method !== 'POST') {
    return apiError('method_not_allowed', 'Méthode non autorisée.', 405)
  }

  // --- 1. Lecture du corps (form-urlencoded ou JSON) ------------------------
  let payload: NotificationPayload
  try {
    payload = await readPayload(request)
  } catch {
    return apiError('invalid_body', 'Notification illisible.', 400)
  }

  const transactionId = (payload['cpm_trans_id'] ?? payload['transaction_id'] ?? '').trim()
  if (!transactionId) {
    return apiError('missing_transaction', 'Identifiant de transaction absent.', 400)
  }

  let config
  try {
    config = readConfig()
  } catch (configError) {
    return apiError(
      'provider_not_configured',
      configError instanceof Error ? configError.message : 'CinetPay non configuré.',
      503,
    )
  }

  // --- 2. Authentification de la notification ------------------------------
  let signatureVerified = false
  if (config.secretKey) {
    // Le jeton HMAC est transmis dans l'en-tête `x-token` (doc CinetPay « HMAC »).
    const verification = await verifySignature(
      config.secretKey,
      payload,
      request.headers.get('x-token'),
    )
    if (!verification.valid) {
      // On ne révèle pas le détail au client : seulement une trace serveur.
      console.error('[cinetpay-webhook] signature invalide', {
        transactionId,
        reason: verification.reason,
      })
      return apiError('invalid_signature', 'Signature de la notification invalide.', 401)
    }
    signatureVerified = true
  } else {
    console.warn(
      '[cinetpay-webhook] CINETPAY_SECRET_KEY absent : notification validée uniquement par l’API de vérification.',
    )
  }

  const admin = createAdminClient()

  // --- 3. Retrouver la transaction enregistrée -----------------------------
  const { data: transaction, error: transactionError } = await admin
    .from('payment_transactions')
    .select('id, tenant_id, order_id, amount, status, paid_at')
    .eq('transaction_id', transactionId)
    .maybeSingle()

  if (transactionError) {
    console.error('[cinetpay-webhook] lecture transaction', transactionError)
    return apiError('lookup_failed', 'Erreur interne.', 500)
  }

  if (!transaction) {
    // Transaction inconnue : on répond 200 pour éviter les relances infinies.
    console.warn('[cinetpay-webhook] transaction inconnue', { transactionId })
    return json({ status: 'ignored', reason: 'transaction_inconnue' }, 200)
  }

  // --- 4. Statut réel chez CinetPay ----------------------------------------
  let check
  try {
    check = await checkPayment(config, transactionId)
  } catch (error) {
    console.error('[cinetpay-webhook] vérification impossible', error)
    // 503 : CinetPay réessaiera la notification.
    return apiError('verification_unavailable', 'Vérification du paiement indisponible.', 503)
  }

  const operatorLabel = payload['payment_method'] ?? check.operatorLabel
  const paymentMethod = mapPaymentMethod(operatorLabel)

  // --- 5. Mise à jour -------------------------------------------------------
  // Verrou d'idempotence : une transaction déjà marquée `paid` est définitive.
  // CinetPay peut rejouer des notifications dans le désordre ; une notification
  // tardive « REFUSED » ne doit jamais annuler un paiement encaissé.
  if (transaction.status === 'paid' && check.status !== 'ACCEPTED') {
    console.warn('[cinetpay-webhook] notification tardive ignorée', {
      transactionId,
      statutRecu: check.status,
    })
    return json({ status: 'already_paid', ignored: check.status }, 200)
  }

  if (check.status !== 'ACCEPTED') {
    await admin
      .from('payment_transactions')
      .update({
        status: check.status === 'REFUSED' ? 'refused' : 'pending',
        payment_method: paymentMethod,
        operator_label: operatorLabel,
        signature_verified: signatureVerified,
        provider_payload: { notification: payload, check: check.raw },
      })
      .eq('id', transaction.id)

    return json({ status: check.status }, 200)
  }

  // Contrôle du montant : une transaction acceptée du mauvais montant est
  // enregistrée mais la commande n'est pas marquée payée.
  if (check.amount !== null && check.amount !== transaction.amount) {
    console.error('[cinetpay-webhook] montant incohérent', {
      transactionId,
      attendu: transaction.amount,
      recu: check.amount,
    })
    await admin
      .from('payment_transactions')
      .update({
        status: 'error',
        payment_method: paymentMethod,
        operator_label: operatorLabel,
        signature_verified: signatureVerified,
        provider_payload: { notification: payload, check: check.raw, error: 'montant_incoherent' },
      })
      .eq('id', transaction.id)

    return json({ status: 'amount_mismatch' }, 200)
  }

  // Idempotence : si déjà payée, on ne fait rien de plus.
  if (transaction.status !== 'paid') {
    const paidAt = new Date().toISOString()

    await admin
      .from('payment_transactions')
      .update({
        status: 'paid',
        payment_method: paymentMethod,
        operator_label: operatorLabel,
        signature_verified: signatureVerified,
        paid_at: paidAt,
        provider_payload: { notification: payload, check: check.raw },
      })
      .eq('id', transaction.id)

    const { error: orderError } = await admin
      .from('orders')
      .update({
        payment_status: 'paid',
        payment_method: paymentMethod,
        updated_at: paidAt,
      })
      .eq('id', transaction.order_id)

    if (orderError) {
      console.error('[cinetpay-webhook] mise à jour commande', orderError)
      return apiError('order_update_failed', 'Erreur interne.', 500)
    }
  }

  return json({ status: 'ACCEPTED', payment_method: paymentMethod }, 200)
})

/** Accepte `application/x-www-form-urlencoded` (format CinetPay) et JSON. */
async function readPayload(request: Request): Promise<NotificationPayload> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const raw = (await request.json()) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, value === null ? '' : String(value)]),
    )
  }

  const form = await request.formData()
  const payload: NotificationPayload = {}
  for (const [key, value] of form.entries()) {
    payload[key] = typeof value === 'string' ? value : ''
  }
  return payload
}
