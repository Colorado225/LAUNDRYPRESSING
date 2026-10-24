/**
 * État du faux CinetPay — logique pure, sans réseau.
 *
 * Séparé du serveur HTTP pour deux raisons :
 *  - on peut le tester sans ouvrir de port (donc dans la CI) ;
 *  - les décisions qui comptent (idempotence, montant, signature) sont lisibles
 *    à un seul endroit, au lieu d'être noyées dans le routage.
 *
 * Ce simulateur imite **seulement** ce que nos Edge Functions utilisent :
 * `POST /v2/payment`, `POST /v2/payment/check` et la notification
 * form-urlencoded. Il ne cherche pas à reproduire CinetPay, seulement à
 * déclencher les mêmes branches de code, y compris les mauvaises.
 */

/** Statuts renvoyés par `check`, alignés sur le vocabulaire CinetPay. */
export const STATUTS = {
  attente: 'PENDING',
  accepte: 'ACCEPTED',
  refuse: 'REFUSED',
}

export function creerSimulateur(options = {}) {
  const transactions = new Map()
  const journal = []
  const config = {
    apiKey: options.apiKey ?? 'simulateur-test-key',
    siteId: options.siteId ?? '123456',
    baseUrl: options.baseUrl ?? 'http://localhost:54321',
    /** Quand `true`, la notification n'est pas envoyée : le webhook n'est jamais appelé. */
    sansNotification: options.sansNotification ?? false,
  }

  function enregistrer(evenement) {
    journal.push({ ...evenement, at: new Date().toISOString() })
  }

  return {
    config,
    journal,
    transactions,

    /**
     * Équivalent de `POST /v2/payment`.
     *
     * Contrôles reproduits : identifiants, montant positif multiple de 5,
     * `notify_url` et `return_url` présents, `transaction_id` unique. Ce sont
     * exactement ceux que CinetPay applique — un simulateur plus permissif
     * laisserait passer du code qui échouerait en production.
     */
    initialiser(corps) {
      const refus = (code, description) => ({ ok: false, code, description })

      if (corps?.apikey !== config.apiKey || String(corps?.site_id) !== String(config.siteId)) {
        enregistrer({ type: 'init.refus', motif: 'identifiants' })
        return refus('401', 'Identifiants du marchand invalides.')
      }

      const montant = Number(corps?.amount)
      if (!Number.isInteger(montant) || montant <= 0) {
        enregistrer({ type: 'init.refus', motif: 'montant' })
        return refus('400', 'Montant invalide : entier positif attendu.')
      }
      if (montant % 5 !== 0) {
        enregistrer({ type: 'init.refus', motif: 'multiple_de_5' })
        return refus('400', 'Le montant doit être un multiple de 5.')
      }

      const transactionId = String(corps?.transaction_id ?? '').trim()
      if (!transactionId) {
        enregistrer({ type: 'init.refus', motif: 'transaction_id' })
        return refus('400', 'transaction_id manquant.')
      }
      if (!corps?.notify_url || !corps?.return_url) {
        enregistrer({ type: 'init.refus', motif: 'urls' })
        return refus('400', 'notify_url et return_url sont obligatoires.')
      }
      if (transactions.has(transactionId)) {
        // CinetPay refuse un identifiant déjà utilisé : c'est justement ce qui
        // protège du double paiement côté prestataire.
        enregistrer({ type: 'init.refus', motif: 'transaction_deja_vue' })
        return refus('409', 'Cette transaction existe déjà.')
      }

      transactions.set(transactionId, {
        transactionId,
        montant,
        devise: corps.currency ?? 'XOF',
        description: String(corps.description ?? ''),
        notifyUrl: corps.notify_url,
        returnUrl: corps.return_url,
        statut: STATUTS.attente,
        operateur: null,
        telephone: corps.customer_phone_number ?? null,
        creeLe: new Date().toISOString(),
        notifications: 0,
      })

      enregistrer({ type: 'init.ok', transactionId, montant })

      return {
        ok: true,
        code: '201',
        data: {
          payment_url: `${config.baseUrl}/paiement/${encodeURIComponent(transactionId)}`,
          payment_token: `sim-${transactionId}`,
          transaction_id: transactionId,
          amount: montant,
        },
      }
    },

    /** Équivalent de `POST /v2/payment/check`. */
    verifier(corps) {
      const transactionId = String(corps?.transaction_id ?? '').trim()

      if (corps?.apikey !== config.apiKey || String(corps?.site_id) !== String(config.siteId)) {
        return { ok: false, code: '401', description: 'Identifiants du marchand invalides.' }
      }

      const transaction = transactions.get(transactionId)
      if (!transaction) {
        return { ok: false, code: '404', description: 'Transaction introuvable.' }
      }

      return {
        ok: true,
        code: '00',
        data: {
          status: transaction.statut,
          amount: transaction.montant,
          currency: transaction.devise,
          payment_method: transaction.operateur,
          transaction_id: transaction.transactionId,
        },
      }
    },

    /**
     * Décision du client sur la page de paiement simulée.
     *
     * `accepte` bascule le statut ; refuser ou laisser en attente reste
     * possible, car ce sont les deux cas que nos tests doivent couvrir.
     */
    decider(transactionId, decision) {
      const transaction = transactions.get(transactionId)
      if (!transaction) return { ok: false, motif: 'inconnue' }

      if (decision === 'accepter') {
        transaction.statut = STATUTS.accepte
        transaction.operateur = 'WAVE'
      } else if (decision === 'refuser') {
        transaction.statut = STATUTS.refuse
        transaction.operateur = null
      } else {
        return { ok: false, motif: 'decision_inconnue' }
      }

      enregistrer({ type: `decision.${decision}`, transactionId })
      return { ok: true, transaction }
    },

    /**
     * Corps de la notification envoyée au `notify_url`.
     *
     * `signature` est le jeton de transaction, **pas** le HMAC : c'est ce que
     * CinetPay envoie réellement dans le corps, et cela surprend la première
     * fois. Le HMAC, lui, voyage dans l'en-tête `x-token`.
     */
    corpsNotification(transactionId) {
      const transaction = transactions.get(transactionId)
      if (!transaction) return null

      transaction.notifications += 1

      return {
        cpm_site_id: String(config.siteId),
        cpm_trans_id: transaction.transactionId,
        cpm_trans_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
        cpm_amount: String(transaction.montant),
        cpm_currency: transaction.devise,
        signature: `sim-signature-${transaction.transactionId}`,
        payment_method: transaction.operateur ?? '',
        cel_phone_num: transaction.telephone ?? '',
        cpm_phone_prefixe: '225',
        cpm_language: 'fr',
        cpm_version: 'V4',
        cpm_payment_config: 'SINGLE',
        cpm_page_action: 'PAYMENT',
        cpm_custom: '',
        cpm_designation: transaction.description,
        cpm_error_message:
          transaction.statut === STATUTS.refuse ? 'Transaction refusée par le client.' : '',
      }
    },
  }
}

/**
 * Message signé par HMAC, dans l'ordre imposé par CinetPay.
 *
 * Dupliqué volontairement depuis `_shared/cinetpay.ts` (Deno) : le simulateur
 * doit rester exécutable en Node sans étape de compilation. Un test vérifie que
 * les deux listes de champs sont identiques — voir `scripts/simulateur.test.mjs`.
 */
export const CHAMPS_SIGNES = [
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

export function messageSigne(corps) {
  return CHAMPS_SIGNES.map((champ) => corps[champ] ?? '').join('')
}
