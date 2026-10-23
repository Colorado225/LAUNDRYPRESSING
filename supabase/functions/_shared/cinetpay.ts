/**
 * Client CinetPay — API Checkout v2.
 * Documentation : https://docs.cinetpay.com/api/1.0-fr/checkout/initialisation
 *
 * Rappels importants :
 *  - `amount` doit être un ENTIER, multiple de 5, en XOF.
 *  - `notify_url` est le SEUL mécanisme fiable de mise à jour du paiement.
 *    `return_url` ne sert qu'à l'expérience utilisateur (le client peut fermer
 *    son navigateur avant la redirection).
 *  - Toute notification doit être confirmée par un appel serveur à
 *    `/v2/payment/check` : on ne fait jamais confiance au contenu du webhook.
 */

export type CinetPayStatus = 'ACCEPTED' | 'REFUSED' | 'PENDING'

export interface CinetPayConfig {
  apiKey: string
  siteId: string
  secretKey: string | null
  baseUrl: string
  /**
   * Environnement d'exécution. Vaut `production` par défaut : une installation
   * incomplète doit échouer côté sécurité, pas s'ouvrir silencieusement.
   * La valeur `development` est la seule qui autorise un webhook sans HMAC.
   */
  appEnv: 'production' | 'development'
  /**
   * Mode de paiement demandé.
   *
   * L'API Checkout v2 n'a **pas** d'hôte de bac à sable distinct : CinetPay
   * fournit un `apikey`/`site_id` de test qui s'utilise sur la même URL. Le mode
   * sert donc à deux choses, et à rien d'autre :
   *   • refuser une clé de test en production (erreur explicite plutôt qu'un
   *     paiement fictif cru réel) ;
   *   • marquer les transactions `payment_transactions.provider_payload.mode`,
   *     pour qu'un encaissement d'essai reste identifiable des mois plus tard.
   * Le simulateur local (`scripts/cinetpay-simule.mjs`) s'utilise avec
   * `CINETPAY_MODE=test` et `CINETPAY_BASE_URL=http://localhost:54321`.
   */
  mode: 'test' | 'production'
}

export function readConfig(): CinetPayConfig {
  const apiKey = Deno.env.get('CINETPAY_API_KEY') ?? ''
  const siteId = Deno.env.get('CINETPAY_SITE_ID') ?? ''
  const secretKey = Deno.env.get('CINETPAY_SECRET_KEY') ?? null
  const baseUrl = Deno.env.get('CINETPAY_BASE_URL') ?? 'https://api-checkout.cinetpay.com'
  const appEnv = (Deno.env.get('APP_ENV') ?? 'production').toLowerCase() === 'development'
    ? 'development'
    : 'production'

  const mode = (Deno.env.get('CINETPAY_MODE') ?? 'production').toLowerCase() === 'test'
    ? 'test'
    : 'production'

  if (!apiKey || !siteId) {
    throw new Error(
      "CinetPay n'est pas configuré : définissez CINETPAY_API_KEY et CINETPAY_SITE_ID dans les secrets Supabase.",
    )
  }

  // Garde-fou : une clé d'essai en production encaisserait de faux paiements.
  // On refuse au lieu de laisser passer, avec un message qui dit quoi corriger.
  if (mode === 'production' && isTestCredential(apiKey, siteId)) {
    throw new Error(
      "Clés CinetPay d'essai en mode production : passez CINETPAY_MODE=test, ou installez les identifiants de production.",
    )
  }

  return {
    apiKey,
    siteId,
    secretKey: secretKey && secretKey.length > 0 ? secretKey : null,
    baseUrl,
    appEnv,
    mode,
  }
}

/**
 * Reconnaît un identifiant de démonstration.
 *
 * Volontairement large : mieux vaut refuser une vraie clé par erreur (le
 * message dit comment passer outre) que d'encaisser un paiement fictif en
 * production. Les valeurs couvertes sont celles que l'on rencontre dans les
 * exemples, les simulateurs et les `.env` de recette.
 */
export function isTestCredential(apiKey: string, siteId: string): boolean {
  const suspect = /^(test|demo|exemple|example|fake|dummy|simul)/i
  const contientSimulateur = /(test|demo|exemple|example|fake|dummy|simul)/i
  return (
    suspect.test(apiKey.trim()) ||
    suspect.test(siteId.trim()) ||
    contientSimulateur.test(apiKey.trim().slice(0, 12))
  )
}

export interface InitPaymentParams {
  transactionId: string
  amount: number
  description: string
  notifyUrl: string
  returnUrl: string
  customerName: string
  customerPhone: string
  metadata: string
}

export interface InitPaymentResult {
  paymentUrl: string
  paymentToken: string | null
  raw: unknown
}

/**
 * Arrondit au multiple de 5 supérieur (exigence CinetPay pour le XOF).
 * L'écart maximal est de 4 FCFA et reste tracé dans `payment_transactions`.
 */
export function roundToChargeableAmount(amount: number): number {
  return Math.ceil(amount / 5) * 5
}

/** Appelle `POST /v2/payment` et renvoie l'URL du guichet de paiement. */
export async function initPayment(
  config: CinetPayConfig,
  params: InitPaymentParams,
): Promise<InitPaymentResult> {
  const body = {
    apikey: config.apiKey,
    site_id: config.siteId,
    transaction_id: params.transactionId,
    amount: params.amount,
    currency: 'XOF',
    description: params.description,
    notify_url: params.notifyUrl,
    return_url: params.returnUrl,
    // `MOBILE_MONEY` n'affiche que les wallets ivoiriens : Wave, Orange Money,
    // MTN MoMo et Moov Money, conformément au périmètre du MVP.
    channels: 'MOBILE_MONEY',
    lang: 'fr',
    metadata: params.metadata,
    customer_name: params.customerName,
    customer_phone_number: params.customerPhone,
    customer_country: 'CI',
  }

  const response = await fetch(`${config.baseUrl}/v2/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })

  const raw = (await response.json().catch(() => null)) as
    | { code?: string; message?: string; description?: string; data?: Record<string, unknown> }
    | null

  if (!response.ok || !raw) {
    throw new Error(`CinetPay a refusé la requête (HTTP ${response.status}).`)
  }

  // Codes observés : « 201 » (CREATED) à l'initialisation.
  if (raw.code !== '201' && raw.code !== '00') {
    throw new Error(
      raw.description ??
        raw.message ??
        `CinetPay a renvoyé le code ${raw.code ?? 'inconnu'} à l'initialisation.`,
    )
  }

  const data = raw.data ?? {}
  const paymentUrl = typeof data['payment_url'] === 'string' ? data['payment_url'] : null
  if (!paymentUrl) {
    throw new Error("CinetPay n'a pas renvoyé d'URL de paiement.")
  }

  return {
    paymentUrl,
    paymentToken: typeof data['payment_token'] === 'string' ? data['payment_token'] : null,
    raw,
  }
}

export interface CheckPaymentResult {
  status: CinetPayStatus
  amount: number | null
  operatorLabel: string | null
  raw: unknown
}

/**
 * `POST /v2/payment/check` — source de vérité du statut d'une transaction.
 * Utilisé par le webhook ET par l'écran de retour (relecture manuelle).
 */
export async function checkPayment(
  config: CinetPayConfig,
  transactionId: string,
): Promise<CheckPaymentResult> {
  const response = await fetch(`${config.baseUrl}/v2/payment/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      apikey: config.apiKey,
      site_id: config.siteId,
      transaction_id: transactionId,
    }),
  })

  const raw = (await response.json().catch(() => null)) as
    | { code?: string; message?: string; data?: Record<string, unknown> }
    | null

  if (!response.ok || !raw) {
    throw new Error(`Vérification CinetPay impossible (HTTP ${response.status}).`)
  }

  // Code « 00 » = transaction trouvée.
  const data = raw.data ?? {}
  const rawStatus = typeof data['status'] === 'string' ? data['status'].toUpperCase() : 'PENDING'
  const status: CinetPayStatus =
    rawStatus === 'ACCEPTED' || rawStatus === 'REFUSED' ? rawStatus : 'PENDING'

  const amountValue = data['amount']
  const amount =
    typeof amountValue === 'number'
      ? amountValue
      : typeof amountValue === 'string'
        ? Number(amountValue)
        : null

  const operatorValue = data['payment_method'] ?? data['operator_id']
  const operatorLabel = typeof operatorValue === 'string' ? operatorValue : null

  return { status, amount: Number.isFinite(amount) ? amount : null, operatorLabel, raw }
}

/**
 * Vérification du jeton HMAC-SHA256 d'une notification.
 *
 * Source : https://docs.cinetpay.com/api/1.0-fr/checkout/hmac
 *
 * CinetPay envoie le jeton dans l'EN-TÊTE `x-token`. Le message à signer est la
 * concaténation des champs du corps, dans cet ordre précis :
 *   cpm_site_id + cpm_trans_id + cpm_trans_date + cpm_amount + cpm_currency
 *   + signature + payment_method + cel_phone_num + cpm_phone_prefixe
 *   + cpm_language + cpm_version + cpm_payment_config + cpm_page_action
 *   + cpm_custom + cpm_designation + cpm_error_message
 *
 * ⚠️ Le champ `signature` du corps n'est PAS le jeton HMAC : c'est un jeton de
 * transaction renvoyé par CinetPay. Il fait simplement partie du message signé.
 */
export async function verifySignature(
  secretKey: string,
  payload: Record<string, string>,
  receivedToken: string | null,
): Promise<{ valid: boolean; reason: string | null }> {
  if (!receivedToken) {
    return { valid: false, reason: 'en-tête x-token absent' }
  }

  const order = [
    'cpm_site_id',
    'cpm_trans_id',
    'cpm_trans_date',
    'cpm_amount',
    'cpm_currency',
    'signature',
    'payment_method',
    'cel_phone_num',
    'cpm_phone_prefixe',
    'cpm_language',
    'cpm_version',
    'cpm_payment_config',
    'cpm_page_action',
    'cpm_custom',
    'cpm_designation',
    'cpm_error_message',
  ]

  const message = order.map((key) => payload[key] ?? '').join('')

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  const computed = Array.from(new Uint8Array(signatureBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return {
    valid: constantTimeEqual(computed.toLowerCase(), receivedToken.trim().toLowerCase()),
    reason: null,
  }
}

/** Comparaison de chaînes à durée constante. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return diff === 0
}

export type AppPaymentMethod = 'wave' | 'orange_money' | 'mtn_momo' | 'moov_money' | 'cash'

/**
 * Convertit le libellé opérateur renvoyé par CinetPay vers notre référentiel.
 * Les libellés varient selon les intégrations : on normalise large.
 */
export function mapPaymentMethod(raw: string | null): AppPaymentMethod | null {
  if (!raw) return null
  const value = raw.toUpperCase().replace(/[\s-]/g, '_')

  if (value.includes('WAVE')) return 'wave'
  if (value.includes('ORANGE') || value === 'OM' || value.includes('OM_')) return 'orange_money'
  if (value.includes('MTN') || value.includes('MOMO')) return 'mtn_momo'
  if (value.includes('MOOV') || value.includes('FLOOZ')) return 'moov_money'
  if (value.includes('CASH') || value.includes('ESPECE')) return 'cash'
  return null
}
