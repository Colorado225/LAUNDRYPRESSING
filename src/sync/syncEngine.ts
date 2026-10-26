import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { getTenantId } from '@/lib/tenantContext'
import { db, type LocalOrder } from '@/db/localDb'
import {
  countPendingOrders,
  getOrderItems,
  getPendingOrders,
  markOrderSynced,
  markOrderSyncConflict,
  markOrderSyncError,
  toSupabaseOrder,
  toSupabaseOrderItem,
  updateOrderServerVersion,
} from '@/db/ordersRepository'
import { useSyncStore } from '@/stores/syncStore'
import {
  getPendingCashPayments,
  markCashPaymentError,
  markCashPaymentSynced,
  summariseCash,
} from '@/db/cashRepository'
import { applyRemoteCashState, applyRemoteOrderState } from '@/db/ordersRepository'
import {
  countPendingIssues,
  getPendingOrderIssues,
  markIssueError,
  markIssueSynced,
} from '@/db/issueRepository'
import {
  countPendingNotifications,
  getPendingNotifications,
  markNotificationError,
  markNotificationSynced,
} from '@/db/notificationRepository'

/**
 * Moteur de synchronisation offline-first.
 *
 * Règles :
 *  1. On n'envoie que les commandes du pressing courant (défense en profondeur :
 *     la RLS filtre de toute façon côté serveur).
 *  2. Chaque commande est envoyée séparément : un échec sur l'une ne bloque pas
 *     les autres, et l'erreur est mémorisée sur la ligne concernée.
 *  3. L'envoi initial utilise un `insert` idempotent grâce aux UUID générés
 *     côté client ; un doublon (23505) signifie que l'envoi précédent avait
 *     réussi sans que la réponse arrive, on relit alors la version serveur.
 *  4. Les mises à jour suivantes passent par un **verrou optimiste** :
 *     `update ... eq('version', serverVersion)`. Zéro ligne touchée = la
 *     commande a été modifiée sur un autre appareil. On ne l'écrase pas : la
 *     commande est marquée en conflit et attend un arbitrage humain.
 *  5. En cas d'échec réseau, la commande reste en file (`synced = 0`) et sera
 *     retentée au prochain passage (événement `online` ou intervalle de 60 s).
 *
 * Palier 2 — deux ajouts :
 *  6. Les **encaissements au comptoir** en attente sont transmis après les
 *     commandes (l'ordre est important : la commande doit exister côté serveur).
 *     L'identifiant du paiement est généré sur la tablette : un renvoi ne crée
 *     pas de second encaissement.
 *  7. Les **réclamations** (vêtements abîmés) sont transmises après les
 *     commandes. Elles sont immuables : un refus définitif les sort de la file
 *     au lieu de les renvoyer indéfiniment.
 *  8. Les **clients prévenus** (WhatsApp ou appel) sont transmis après les
 *     commandes, dans le même esprit que les réclamations : lignes immuables,
 *     ajout uniquement, doublon d'identifiant = envoi déjà réussi.
 *  9. Une **lecture** légère rapatrie l'état des commandes modifiées ailleurs
 *     (paiement Mobile Money, changement de statut sur une autre tablette).
 *     Elle ne touche JAMAIS une commande ayant du travail local en attente.
 */

const SYNC_INTERVAL_MS = 60_000

let intervalId: ReturnType<typeof setInterval> | null = null
let syncInFlight: Promise<SyncResult> | null = null
let started = false
let handlers: {
  handleOnline: () => void
  handleOffline: () => void
  handleVisibility: () => void
} | null = null

export interface SyncResult {
  attempted: number
  succeeded: number
  failed: number
  /** Commandes bloquées par un conflit, en attente d'arbitrage. */
  conflicts: number
  /** Encaissements au comptoir transmis avec succès. */
  cashSucceeded: number
  /** Clients prévenus transmis avec succès. */
  notificationsSucceeded: number
  /** Réclamations transmises avec succès. */
  issuesSucceeded: number
  /** Commandes dont l'état a été rafraîchi depuis le serveur. */
  pulled: number
  /** `true` quand le passage a été ignoré (hors ligne, non configuré, sans tenant). */
  skipped: boolean
  lastError: string | null
}

const EMPTY_RESULT: SyncResult = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  conflicts: 0,
  cashSucceeded: 0,
  issuesSucceeded: 0,
  notificationsSucceeded: 0,
  pulled: 0,
  skipped: true,
  lastError: null,
}

/**
 * Curseur de lecture, conservé d'un passage à l'autre.
 *
 * On repart 10 minutes en arrière à chaque fois : une tablette dont l'horloge
 * avance légèrement ne doit pas manquer une modification. Relire un peu est
 * sans conséquence (les versions identiques sont ignorées), manquer une ligne
 * ne l'est pas.
 */
const PULL_CURSOR_KEY = 'pressing.derniereLecture'
const PULL_OVERLAP_MS = 10 * 60 * 1000

function readPullCursor(): string {
  try {
    const stocke = window.localStorage.getItem(PULL_CURSOR_KEY)
    if (stocke) {
      const date = new Date(stocke)
      if (!Number.isNaN(date.getTime())) {
        return new Date(date.getTime() - PULL_OVERLAP_MS).toISOString()
      }
    }
  } catch {
    // Mode navigation privée ou stockage plein : on relit simplement plus large.
  }
  return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
}

function writePullCursor(iso: string): void {
  try {
    window.localStorage.setItem(PULL_CURSOR_KEY, iso)
  } catch {
    // Sans curseur, la prochaine lecture repartira de 7 jours : correct, plus coûteux.
  }
}

/** Résultat de l'envoi d'une commande vers le serveur. */
type PushResult =
  | { status: 'synced'; version: number }
  | { status: 'conflict' }
  | { status: 'error'; message: string }

/**
 * Envoie une commande, avec ou sans verrou optimiste selon qu'elle a déjà été
 * synchronisée. Aucune écriture n'est faite en base locale ici : l'appelant
 * décide de l'état à conserver.
 */
async function pushOrder(order: LocalOrder): Promise<PushResult> {
  const supabase = getSupabaseClient()
  const payload = toSupabaseOrder(order)

  if (order.serverVersion === 0) {
    const { data, error } = await supabase
      .from('orders')
      .insert(payload)
      .select('version')
      .single()

    if (!error) return { status: 'synced', version: data.version }

    // 23505 (doublon) : l'envoi précédent a abouti mais sa réponse s'est
    // perdue. On relit la version pour rester idempotent plutôt que d'écraser.
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('orders')
        .select('version')
        .eq('id', order.id)
        .maybeSingle()

      if (existing) return { status: 'synced', version: existing.version }
    }

    return { status: 'error', message: error.message }
  }

  // Le statut de paiement est écrit par le webhook, jamais par la tablette :
  // l'inclure ici déclencherait le garde-fou `guard_order_update` (42501) dès
  // que la version locale serait en retard d'un paiement.
  const updatePayload = {
    customer_name: payload.customer_name,
    customer_phone: payload.customer_phone,
    status: payload.status,
    qr_code: payload.qr_code,
    photo_url: payload.photo_url,
    total_amount: payload.total_amount,
    due_date: payload.due_date,
    // L'attribution est décidée à l'atelier, souvent hors ligne : sans ces deux
    // colonnes, le serveur ne la recevait jamais et le prochain rapatriement
    // effaçait l'artisan sélectionné sur la tablette.
    assigned_to: payload.assigned_to,
    assigned_at: payload.assigned_at,
    // `status_reason` est un champ de **transport** : le déclencheur serveur le
    // recopie dans l'historique puis le remet à NULL. L'omettre ici perdait le
    // motif d'annulation saisi au comptoir.
    status_reason: payload.status_reason,
    updated_at: payload.updated_at,
    synced_from_local: payload.synced_from_local,
  }

  // Compare-and-set : la clause `version=eq.N` est évaluée par PostgreSQL dans
  // la même instruction que la mise à jour. Aucune fenêtre de course possible.
  const { data, error } = await supabase
    .from('orders')
    .update(updatePayload)
    .eq('id', order.id)
    .eq('version', order.serverVersion)
    .select('version')

  if (error) return { status: 'error', message: error.message }
  if (!data || data.length === 0) return { status: 'conflict' }

  return { status: 'synced', version: data[0]!.version }
}

/**
 * Transmet les encaissements au comptoir en attente.
 *
 * Erreurs « définitives » (montant invalide, commande inconnue) : le paiement
 * est marqué comme traité avec son message, sinon la tablette le renverrait
 * toutes les 60 secondes sans jamais pouvoir aboutir. Il reste visible dans
 * l'écran Caisse avec son motif.
 */
async function pushCashPayments(tenantId: string): Promise<{ succeeded: number; lastError: string | null }> {
  const supabase = getSupabaseClient()
  const pending = await getPendingCashPayments(tenantId)

  let succeeded = 0
  let lastError: string | null = null

  for (const payment of pending) {
    try {
      const { data, error } = await supabase.rpc('record_cash_payment', {
        p_order_id: payment.orderId,
        p_amount: payment.amount,
        p_payment_id: payment.id,
        p_note: payment.note,
      })

      if (error) throw Object.assign(new Error(error.message), { code: error.code })

      await markCashPaymentSynced(payment.id)
      await applyRemoteCashState(payment.orderId, data.remaining, 'cash')
      succeeded += 1
    } catch (error) {
      const message = toFrenchSyncError(error)
      const code = (error as { code?: string }).code
      const definitive = code === '22023' || code === '42501' || code === 'P0002'

      lastError = message
      await markCashPaymentError(payment.id, message, definitive)
    }
  }

  return { succeeded, lastError }
}

/**
 * Transmet les réclamations en attente.
 *
 * Contrairement aux commandes, il n'y a pas de version : une réclamation ne
 * fait que s'ajouter. Un doublon d'identifiant signifie simplement que l'envoi
 * précédent avait abouti sans réponse — on la marque transmise.
 */
async function pushOrderIssues(
  tenantId: string,
): Promise<{ succeeded: number; lastError: string | null }> {
  const enAttente = await getPendingOrderIssues(tenantId)
  if (enAttente.length === 0) return { succeeded: 0, lastError: null }

  const supabase = getSupabaseClient()
  let succeeded = 0
  let lastError: string | null = null

  for (const issue of enAttente) {
    const { error } = await supabase.from('order_issues').insert({
      id: issue.id,
      tenant_id: tenantId,
      order_id: issue.orderId,
      order_item_id: issue.orderItemId,
      kind: issue.kind,
      severity: issue.severity,
      stage: issue.stage,
      description: issue.description,
      created_at: issue.createdAt,
    })

    if (error) {
      const code = 'code' in error ? String(error.code ?? '') : ''
      const definitive =
        error.message.includes('duplicate key') ||
        ['23505', '23503', '23514', '22023', '42501'].includes(code)
      lastError = toFrenchSyncError(error)

      if (error.message.includes('duplicate key')) {
        // Déjà présente côté serveur : le travail est fait.
        await markIssueSynced(issue.id)
        succeeded += 1
      } else {
        await markIssueError(issue.id, lastError, definitive)
      }
      continue
    }

    await markIssueSynced(issue.id)
    succeeded += 1
  }

  return { succeeded, lastError }
}

/**
 * Transmet les clients prévenus.
 *
 * Même contrat que les réclamations : ajout seul, identifiant généré sur la
 * tablette, doublon = envoi déjà réussi. Un refus définitif (rôle, abonnement
 * échu) sort la ligne de la file : elle reste consultable localement avec son
 * motif, sans bloquer les suivantes.
 */
async function pushNotifications(
  tenantId: string,
): Promise<{ succeeded: number; lastError: string | null }> {
  const enAttente = await getPendingNotifications(tenantId)
  if (enAttente.length === 0) return { succeeded: 0, lastError: null }

  const supabase = getSupabaseClient()
  let succeeded = 0
  let lastError: string | null = null

  for (const notification of enAttente) {
    const { error } = await supabase.from('notifications').insert({
      id: notification.id,
      tenant_id: tenantId,
      order_id: notification.orderId,
      channel: notification.channel,
      reason: notification.reason,
      customer_name: notification.customerName,
      customer_phone: notification.customerPhone,
      message: notification.message,
      created_at: notification.createdAt,
    })

    if (error) {
      const code = 'code' in error ? String(error.code ?? '') : ''
      const definitive =
        error.message.includes('duplicate key') ||
        ['23505', '23503', '23514', '22023', '42501'].includes(code)
      lastError = toFrenchSyncError(error)

      if (error.message.includes('duplicate key')) {
        await markNotificationSynced(notification.id)
        succeeded += 1
      } else {
        await markNotificationError(notification.id, lastError, definitive)
      }
      continue
    }

    await markNotificationSynced(notification.id)
    succeeded += 1
  }

  return { succeeded, lastError }
}

/** Rafraîchit l'état des commandes modifiées sur un autre appareil. */
async function pullOrders(tenantId: string): Promise<number> {
  const supabase = getSupabaseClient()
  const depuis = readPullCursor()

  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, version, status, payment_status, payment_method, total_amount, due_date, assigned_to, updated_at',
    )
    .eq('tenant_id', tenantId)
    .gt('updated_at', depuis)
    .order('updated_at', { ascending: true })
    .limit(300)

  if (error || !data) return 0

  let appliquees = 0

  for (const ligne of data) {
    const applique = await applyRemoteOrderState(ligne)
    if (applique) appliquees += 1

    if (typeof ligne.updated_at === 'string') writePullCursor(ligne.updated_at)
  }

  return appliquees
}

/**
 * Envoie toutes les commandes en attente vers Supabase.
 * Les appels concurrents sont mutualisés : un seul envoi à la fois.
 */
export async function syncPendingOrders(): Promise<SyncResult> {
  syncInFlight ??= runSync().finally(() => {
    syncInFlight = null
  })
  return syncInFlight
}

/** Résultat de l'envoi d'une commande précise. */
export type EnvoiCommande =
  | { statut: 'synced'; version: number }
  | { statut: 'conflict'; message: string }
  | { statut: 'error'; message: string }

const MESSAGE_CONFLIT =
  'Conflit : cette commande a été modifiée sur un autre appareil.'

/**
 * Envoie **une** commande et ses lignes, puis marque son état local.
 *
 * Fonction unique partagée par la synchronisation périodique et par l'envoi
 * immédiat qui suit la création (`syncOrderNow`). La factoriser évite que les
 * deux chemins divergent : une commande créée au comptoir doit suivre
 * exactement les mêmes règles que celles envoyées par la boucle de fond.
 *
 * Ordre volontaire :
 *   1. la commande (jeton de version) ;
 *   2. la version serveur enregistrée AVANT les lignes — si l'envoi des lignes
 *      échoue, la nouvelle tentative repart du bon jeton au lieu de fabriquer
 *      un faux conflit avec sa propre écriture ;
 *   3. les lignes (upsert) puis la purge des lignes distantes retirées.
 */
// Un seul envoi à la fois par commande. La boucle de fond et l'envoi immédiat
// peuvent viser la même commande au même instant : sans ce verrou, les deux
// tenteraient l'insertion et la seconde créerait un faux conflit.
const envoisEnCours = new Map<string, Promise<EnvoiCommande>>()

/**
 * Consigne un incident d'envoi dans la base (`log_client_sync`, migration 026).
 *
 * Raison d'être : un refus serveur ne laisse aucune trace — la base reste vide
 * et le poste garde la commande en attente. Le compte connecté peut ainsi
 * relire, depuis son propre pressing, ce que SON appareil a réellement reçu
 * comme erreur (RLS, jeton expiré, contrainte). Jamais bloquant : si la
 * journalisation échoue elle-même, on continue.
 */
async function journaliserEnvoi(
  kind: 'push_error' | 'push_ok' | 'push_conflict',
  order: LocalOrder | null,
  message: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = getSupabaseClient()
    await supabase.rpc('log_client_sync', {
      p_kind: kind,
      p_message: message,
      p_order_id: order?.id ?? null,
      p_details: {
        poste: MARQUEUR_POSTE,
        ...details,
        tenant_local: order?.tenantId ?? getTenantId(),
        version_locale: order?.serverVersion ?? null,
        lignes: order ? (await getOrderItems(order.id)).length : null,
        en_ligne: typeof navigator !== 'undefined' ? navigator.onLine : null,
        agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    })
  } catch {
    // Le diagnostic ne doit jamais casser le comptoir.
  }
}

/**
 * Envoie une commande au serveur, en évitant tout envoi concurrent pour la même
 * commande (un appel déjà en cours est réutilisé tel quel).
 */
export function envoyerCommande(order: LocalOrder): Promise<EnvoiCommande> {
  const enCours = envoisEnCours.get(order.id)
  if (enCours) return enCours

  const envoi = pousserCommande(order).finally(() => {
    envoisEnCours.delete(order.id)
  })
  envoisEnCours.set(order.id, envoi)
  return envoi
}

async function pousserCommande(order: LocalOrder): Promise<EnvoiCommande> {
  const supabase = getSupabaseClient()

  try {
    const pushed = await pushOrder(order)

    if (pushed.status === 'conflict') {
      await markOrderSyncConflict(order.id, MESSAGE_CONFLIT)
      void journaliserEnvoi('push_conflict', order, MESSAGE_CONFLIT)
      return { statut: 'conflict', message: MESSAGE_CONFLIT }
    }

    if (pushed.status === 'error') {
      const message = toFrenchSyncError(new Error(pushed.message))
      await markOrderSyncError(order.id, message)
      void journaliserEnvoi('push_error', order, message, {
        etape: 'orders',
        message_serveur: pushed.message,
      })
      return { statut: 'error', message }
    }

    await updateOrderServerVersion(order.id, pushed.version)

    const items = await getOrderItems(order.id)
    if (items.length > 0) {
      const { error: itemsError } = await supabase
        .from('order_items')
        .upsert(items.map(toSupabaseOrderItem), { onConflict: 'id' })
      if (itemsError) throw new Error(itemsError.message)

      // Une ligne retirée au comptoir doit aussi disparaître du serveur :
      // l'upsert ne fait qu'ajouter et mettre à jour. On supprime donc les
      // lignes distantes absentes de la liste locale (jamais l'inverse : la
      // liste locale est la référence de cette tablette). Rien à purger lors
      // du premier envoi : la commande n'existe pas encore côté serveur.
      if (order.serverVersion > 0) {
        // UUID : ni guillemets ni virgule possible, la liste reste sûre.
        const ids = items.map((ligne) => ligne.id).join(',')
        const { error: purgeError } = await supabase
          .from('order_items')
          .delete()
          .eq('order_id', order.id)
          .not('id', 'in', `(${ids})`)
        if (purgeError) throw new Error(purgeError.message)
      }
    }

    await markOrderSynced(order.id, pushed.version)
    return { statut: 'synced', version: pushed.version }
  } catch (error) {
    const message = toFrenchSyncError(error)
    await markOrderSyncError(order.id, message)
    void journaliserEnvoi('push_error', order, message, {
      etape: 'items',
      message_serveur: error instanceof Error ? error.message : String(error),
    })
    return { statut: 'error', message }
  }
}

/**
 * Envoie immédiatement une commande, sans attendre la synchronisation de fond.
 *
 * Utilisée juste après l'enregistrement d'une nouvelle commande : le comptoir
 * voit tout de suite si la commande est arrivée en base, au lieu de laisser une
 * commande « en attente » pendant une minute. Hors ligne ou sans backend, le
 * travail reste dans IndexedDB et l'appelant reçoit un motif explicite.
 */
export async function syncOrderNow(orderId: string): Promise<EnvoiCommande> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      statut: 'error',
      message: 'Hors ligne : la commande reste sur cet appareil et partira à la reconnexion.',
    }
  }

  if (!isSupabaseConfigured) {
    return {
      statut: 'error',
      message:
        'Supabase n’est pas configuré : la commande reste sur cet appareil (mode démonstration).',
    }
  }

  const order = await db.orders.get(orderId)
  if (!order) {
    return { statut: 'error', message: 'Commande introuvable sur cet appareil.' }
  }

  if (order.syncConflict) {
    return { statut: 'conflict', message: MESSAGE_CONFLIT }
  }

  useSyncStore.getState().startSync()
  const resultat = await envoyerCommande(order)
  const tenantId = getTenantId()

  if (resultat.statut === 'synced' && tenantId) {
    useSyncStore.getState().finishSync({ pendingCount: await countPendingOrders(tenantId), lastError: null, tenantId })
  } else if (resultat.statut !== 'synced') {
    useSyncStore.setState({ lastError: resultat.message })
  }

  return resultat
}

/**
 * Marqueur de version du poste, joint aux diagnostics.
 *
 * Permet de distinguer un vrai refus serveur d'un navigateur qui exécute encore
 * un ancien paquet (cache du service worker) : sans ce repère, les deux se
 * ressemblent à s'y méprendre.
 */
export const MARQUEUR_POSTE = 'commandes/2026-10-26'

/**
 * Sonde d'ouverture d'écran : consigne l'état réel du poste (boutique, rôle,
 * droit de création, réseau) dans le journal de diagnostic.
 *
 * Utile quand le blocage est antérieur à toute requête métier — un bouton
 * désactivé ne produit, lui, aucune erreur à capturer.
 */
export async function signalerSonde(details: Record<string, unknown>): Promise<void> {
  try {
    const supabase = getSupabaseClient()
    await supabase.rpc('log_client_sync', {
      p_kind: 'probe',
      p_message: 'ouverture du formulaire de commande',
      p_details: { poste: MARQUEUR_POSTE, ...details },
    })
  } catch {
    // Diagnostic uniquement.
  }
}

/**
 * Signale au serveur un incident survenu AVANT l'envoi (validation, écriture
 * locale refusée). Sans cela, un blocage au moment du clic ne laisse aucune
 * trace : ni commande en base, ni erreur consultable.
 */
export async function signalerIncidentCommande(
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await journaliserEnvoi('push_error', null, message, { origine: 'formulaire', ...details })
}

async function runSync(): Promise<SyncResult> {
  const tenantId = getTenantId()

  // 1. Hors ligne : on marque l'état AVANT toute autre vérification, pour que
  //    le bandeau passe en orange même si Supabase n'est pas configuré.
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    useSyncStore.getState().setOffline()
    if (tenantId) {
      useSyncStore.setState({ pendingCount: await countPendingOrders(tenantId) })
    }
    return { ...EMPTY_RESULT, skipped: true }
  }

  // 2. Pas de backend configuré ou pas de pressing : rien à envoyer.
  if (!isSupabaseConfigured || !tenantId) {
    return EMPTY_RESULT
  }

  const pendingOrders = await getPendingOrders(tenantId)
  const pendingCash = await getPendingCashPayments(tenantId)
  const pendingIssues = await getPendingOrderIssues(tenantId)
  const pendingNotifications = await getPendingNotifications(tenantId)

  if (
    pendingOrders.length === 0 &&
    pendingCash.length === 0 &&
    pendingIssues.length === 0 &&
    pendingNotifications.length === 0
  ) {
    // Rien à envoyer, mais d'autres appareils ont peut-être écrit : on relit.
    const pulled = await pullOrders(tenantId).catch(() => 0)
    useSyncStore.getState().finishSync({ pendingCount: 0, lastError: null, tenantId })
    return { ...EMPTY_RESULT, pulled, skipped: false }
  }

  useSyncStore.getState().startSync()

  let succeeded = 0
  let failed = 0
  let conflicts = 0
  let lastError: string | null = null

  for (const order of pendingOrders) {
    // Un conflit non arbitré n'est JAMAIS renvoyé : sans cela, la tablette
    // écraserait le travail de l'autre appareil à chaque tentative.
    if (order.syncConflict) {
      conflicts += 1
      continue
    }

    const resultat = await envoyerCommande(order)

    if (resultat.statut === 'synced') {
      succeeded += 1
    } else if (resultat.statut === 'conflict') {
      conflicts += 1
    } else {
      failed += 1
      lastError = resultat.message
    }
  }

  // 3. Encaissements au comptoir : APRÈS les commandes, pour qu'une commande
  //    créée hors ligne existe côté serveur au moment du paiement.
  const cash = await pushCashPayments(tenantId).catch((error: unknown) => ({
    succeeded: 0,
    lastError: toFrenchSyncError(error),
  }))

  if (cash.lastError) lastError = cash.lastError

  // 4. Réclamations : après les commandes, qu'elles référencent.
  const issues = await pushOrderIssues(tenantId).catch((error: unknown) => ({
    succeeded: 0,
    lastError: toFrenchSyncError(error),
  }))

  if (issues.lastError) lastError = issues.lastError

  // 5. Clients prévenus : après les commandes, qu'ils référencent.
  const notifications = await pushNotifications(tenantId).catch((error: unknown) => ({
    succeeded: 0,
    lastError: toFrenchSyncError(error),
  }))

  if (notifications.lastError) lastError = notifications.lastError

  // 6. Lecture des modifications faites ailleurs.
  const pulled = await pullOrders(tenantId).catch(() => 0)

  const remaining = await countPendingOrders(tenantId)
  const cashSummary = await summariseCash(tenantId)
  const remainingIssues = await countPendingIssues(tenantId)
  const remainingNotifications = await countPendingNotifications(tenantId)
  useSyncStore.getState().finishSync({
    pendingCount: remaining + cashSummary.pending + remainingIssues + remainingNotifications,
    lastError,
    tenantId,
  })

  return {
    attempted: pendingOrders.length,
    succeeded,
    failed,
    conflicts,
    cashSucceeded: cash.succeeded,
    issuesSucceeded: issues.succeeded,
    notificationsSucceeded: notifications.succeeded,
    pulled,
    skipped: false,
    lastError,
  }
}

/** Traduit les erreurs techniques en message exploitable par l'utilisateur. */
function toFrenchSyncError(error: unknown): string {
  if (error instanceof Error) {
    if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
      return 'Réseau indisponible : la synchronisation reprendra automatiquement.'
    }
    if (/row-level security/i.test(error.message)) {
      return "Accès refusé par la sécurité du serveur (RLS) : vérifiez le rattachement de l'utilisateur au pressing."
    }
    if (/violates foreign key constraint/i.test(error.message)) {
      return "Le pressing n'existe pas encore sur le serveur : appliquez la migration et le jeu de démonstration."
    }
    return error.message
  }
  return 'Erreur inconnue pendant la synchronisation.'
}

/**
 * Démarre la synchronisation automatique :
 *  - au lancement ;
 *  - à chaque retour du réseau (`online`) ;
 *  - au retour au premier plan (tablette en veille) ;
 *  - toutes les 60 s si la connexion est disponible.
 *
 * Idempotent : appeler deux fois ne crée pas deux intervalles.
 */
export function startSyncEngine(): void {
  if (started) return
  started = true

  handlers = {
    handleOnline: () => {
      void syncPendingOrders()
    },
    handleOffline: () => {
      useSyncStore.getState().setOffline()
    },
    handleVisibility: () => {
      // Au retour au premier plan (tablette sortie de veille), on retente.
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void syncPendingOrders()
      }
    },
  }

  window.addEventListener('online', handlers.handleOnline)
  window.addEventListener('offline', handlers.handleOffline)
  document.addEventListener('visibilitychange', handlers.handleVisibility)

  intervalId = setInterval(() => {
    if (navigator.onLine) void syncPendingOrders()
  }, SYNC_INTERVAL_MS)

  if (!navigator.onLine) {
    useSyncStore.getState().setOffline()
  } else {
    void syncPendingOrders()
  }
}

/** Arrête les écouteurs et l'intervalle (utile en test et au démontage). */
export function stopSyncEngine(): void {
  if (!started) return
  started = false

  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }

  if (handlers) {
    window.removeEventListener('online', handlers.handleOnline)
    window.removeEventListener('offline', handlers.handleOffline)
    document.removeEventListener('visibilitychange', handlers.handleVisibility)
    handlers = null
  }
}
