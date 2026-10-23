import { apiError, corsHeaders, json } from '../_shared/http.ts'
import { initPayment, readConfig, roundToChargeableAmount } from '../_shared/cinetpay.ts'
import {
  createAdminClient,
  createUserClient,
  readBearerToken,
} from '../_shared/supabaseClients.ts'

/**
 * Edge Function `cinetpay-init`
 * -----------------------------------------------------------------------------
 * Rôle : créer un guichet de paiement CinetPay pour une commande et renvoyer
 * l'URL vers laquelle rediriger le client.
 *
 * Sécurité (dans cet ordre) :
 *  1. JWT Supabase obligatoire.
 *  2. L'utilisateur doit être rattaché au pressing de la commande
 *     (`tenant_users`), sinon 403.
 *  3. Le MONTANT N'EST JAMAIS celui envoyé par le client : il est relu dans la
 *     table `orders`. Le client peut donc omettre `amount`, il sera ignoré.
 *  4. Une commande déjà payée ne peut pas être repayée.
 *  5. Un artisan ne peut pas encaisser (rôle vérifié côté serveur).
 *  6. Un seul guichet ouvert par commande : une tentative récente est
 *     réutilisée au lieu d'en créer une seconde (protection contre le double
 *     paiement, renforcée par un index unique partiel en base).
 *  7. Chaque tentative crée une ligne `payment_transactions` (traçabilité).
 *
 * Entrée  : { orderId, amount?, customerName?, customerPhone? }
 * Sortie  : { payment_url, transaction_id, amount }
 */

interface InitRequestBody {
  orderId?: string
  amount?: number
  customerName?: string
  customerPhone?: string
}

interface OrderRecord {
  id: string
  tenant_id: string
  customer_name: string
  customer_phone: string
  total_amount: number
  payment_status: string
  status: string
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get('Origin')

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }

  if (request.method !== 'POST') {
    return apiError('method_not_allowed', 'Méthode non autorisée : POST attendu.', 405, origin)
  }

  // --- 1. Authentification ---------------------------------------------------
  const token = readBearerToken(request)
  if (!token) {
    return apiError('unauthorized', 'Authentification requise.', 401, origin)
  }

  const admin = createAdminClient()
  const userClient = createUserClient(token)

  const { data: userData, error: userError } = await userClient.auth.getUser(token)
  if (userError || !userData.user) {
    return apiError('unauthorized', 'Session invalide ou expirée.', 401, origin)
  }
  const userId = userData.user.id

  // --- 2. Lecture de la requête ---------------------------------------------
  let body: InitRequestBody
  try {
    body = (await request.json()) as InitRequestBody
  } catch {
    return apiError('invalid_body', 'Corps de requête JSON invalide.', 400, origin)
  }

  const orderId = body.orderId?.trim()
  if (!orderId) {
    return apiError('missing_order', 'Identifiant de commande manquant.', 400, origin)
  }

  // --- 3. Commande et appartenance au pressing ------------------------------
  const { data: orderData, error: orderError } = await admin
    .from('orders')
    .select('id, tenant_id, customer_name, customer_phone, total_amount, payment_status, status')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) {
    return apiError('order_lookup_failed', 'Impossible de lire la commande.', 500, origin)
  }
  if (!orderData) {
    return apiError('order_not_found', 'Commande introuvable.', 404, origin)
  }

  const order = orderData as OrderRecord

  const { data: membership } = await admin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', userId)
    .eq('tenant_id', order.tenant_id)
    .maybeSingle()

  if (!membership) {
    return apiError(
      'forbidden',
      "Votre compte n'est pas rattaché au pressing de cette commande.",
      403,
      origin,
    )
  }

  if (membership.role === 'artisan') {
    return apiError(
      'forbidden',
      'Un artisan ne peut pas encaisser : demandez au comptoir.',
      403,
      origin,
    )
  }

  if (order.payment_status === 'paid') {
    return apiError('already_paid', 'Cette commande est déjà réglée.', 409, origin)
  }

  if (order.status === 'cancelled') {
    return apiError('order_cancelled', 'Une commande annulée ne peut pas être payée.', 409, origin)
  }

  // --- 4. Montant : celui de la base, jamais celui du client ----------------
  const chargeableAmount = roundToChargeableAmount(order.total_amount)
  if (chargeableAmount < 100) {
    return apiError(
      'amount_too_low',
      'Le montant minimum accepté par Mobile Money est de 100 FCFA.',
      422,
      origin,
    )
  }

  // --- 5. Configuration et URLs --------------------------------------------
  let config
  try {
    config = readConfig()
  } catch (configError) {
    return apiError(
      'provider_not_configured',
      configError instanceof Error ? configError.message : 'CinetPay non configuré.',
      503,
      origin,
    )
  }

  const appUrl = (Deno.env.get('APP_URL') ?? origin ?? 'http://localhost:5173').replace(/\/+$/, '')
  const notifyUrl =
    Deno.env.get('CINETPAY_NOTIFY_URL') ??
    `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/cinetpay-webhook`
  const returnUrl = `${appUrl}/paiement/retour?order=${encodeURIComponent(order.id)}`

  // --- 6. Un seul guichet ouvert par commande -------------------------------
  // Sans cette étape, deux clics (ou deux tablettes) créent deux transactions
  // valides chez CinetPay : le client peut payer deux fois, sans remboursement
  // automatique. La fenêtre de réutilisation couvre le temps de saisie normal.
  const REUSE_WINDOW_MS = 15 * 60 * 1000
  const { data: openRows } = await admin
    .from('payment_transactions')
    .select('id, transaction_id, amount, payment_url, status, created_at')
    .eq('order_id', order.id)
    .in('status', ['pending', 'initiated'])
    .order('created_at', { ascending: false })
    .limit(1)

  const open = openRows?.[0]

  if (open) {
    const age = Date.now() - new Date(open.created_at as string).getTime()
    const sameAmount = open.amount === chargeableAmount

    if (sameAmount && open.payment_url && age < REUSE_WINDOW_MS) {
      return json(
        {
          payment_url: open.payment_url,
          transaction_id: open.transaction_id,
          amount: open.amount,
          order_amount: order.total_amount,
          reused: true,
        },
        200,
        origin,
      )
    }

    // Guichet trop ancien, montant modifié ou tentative interrompue : on le
    // clôture avant d'en ouvrir un nouveau (l'index unique l'exigerait).
    await admin
      .from('payment_transactions')
      .update({ status: 'cancelled' })
      .eq('id', open.id)
  }

  // Identifiant court et unique (CinetPay recommande ≤ 30 caractères).
  const transactionId = `PP${Date.now().toString(36).toUpperCase()}${crypto
    .randomUUID()
    .slice(0, 6)
    .toUpperCase()}`

  // --- 6. Trace locale AVANT l'appel (audit en cas d'échec) -----------------
  const { error: insertError } = await admin.from('payment_transactions').insert({
    tenant_id: order.tenant_id,
    order_id: order.id,
    transaction_id: transactionId,
    amount: chargeableAmount,
    order_amount: order.total_amount,
    currency: 'XOF',
    status: 'pending',
    payment_method: null,
    payment_url: null,
  })

  if (insertError) {
    // 23505 : une autre requête a ouvert son guichet entre-temps (index
    // unique partiel `uniq_payment_open_per_order`). On renvoie le gagnant
    // plutôt que d'échouer, pour que les deux appels aboutissent au même
    // paiement.
    if (insertError.code === '23505') {
      const { data: winner } = await admin
        .from('payment_transactions')
        .select('transaction_id, amount, payment_url')
        .eq('order_id', order.id)
        .in('status', ['pending', 'initiated'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (winner?.payment_url) {
        return json(
          {
            payment_url: winner.payment_url,
            transaction_id: winner.transaction_id,
            amount: winner.amount,
            order_amount: order.total_amount,
            reused: true,
          },
          200,
          origin,
        )
      }

      return apiError(
        'payment_in_progress',
        'Un paiement est déjà en cours pour cette commande. Réessayez dans un instant.',
        409,
        origin,
      )
    }

    return apiError(
      'trace_failed',
      "Impossible d'enregistrer la tentative de paiement.",
      500,
      origin,
    )
  }

  // --- 7. Appel CinetPay ----------------------------------------------------
  try {
    const result = await initPayment(config, {
      transactionId,
      amount: chargeableAmount,
      // CinetPay refuse les caractères spéciaux dans `description`.
      description: `Pressing Pro commande ${order.id.slice(0, 8)}`,
      notifyUrl,
      returnUrl,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      metadata: JSON.stringify({ orderId: order.id, tenantId: order.tenant_id }),
    })

    await admin
      .from('payment_transactions')
      .update({
        status: 'initiated',
        payment_url: result.paymentUrl,
        provider_payload: { init: result.raw },
      })
      .eq('transaction_id', transactionId)

    return json(
      {
        payment_url: result.paymentUrl,
        transaction_id: transactionId,
        amount: chargeableAmount,
        order_amount: order.total_amount,
      },
      200,
      origin,
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Échec de l'initialisation du paiement."

    await admin
      .from('payment_transactions')
      .update({ status: 'error', provider_payload: { error: message } })
      .eq('transaction_id', transactionId)

    return apiError('provider_error', message, 502, origin)
  }
})
