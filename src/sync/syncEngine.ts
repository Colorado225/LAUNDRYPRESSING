import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { getTenantId } from '@/lib/tenantContext'
import type { LocalOrder } from '@/db/localDb'
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
  /** `true` quand le passage a été ignoré (hors ligne, non configuré, sans tenant). */
  skipped: boolean
  lastError: string | null
}

const EMPTY_RESULT: SyncResult = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  conflicts: 0,
  skipped: true,
  lastError: null,
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
 * Envoie toutes les commandes en attente vers Supabase.
 * Les appels concurrents sont mutualisés : un seul envoi à la fois.
 */
export async function syncPendingOrders(): Promise<SyncResult> {
  syncInFlight ??= runSync().finally(() => {
    syncInFlight = null
  })
  return syncInFlight
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
  if (pendingOrders.length === 0) {
    useSyncStore.getState().finishSync({ pendingCount: 0, lastError: null })
    return { ...EMPTY_RESULT, skipped: false }
  }

  useSyncStore.getState().startSync()

  const supabase = getSupabaseClient()
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

    try {
      const pushed = await pushOrder(order)

      if (pushed.status === 'conflict') {
        conflicts += 1
        await markOrderSyncConflict(
          order.id,
          'Conflit : cette commande a été modifiée sur un autre appareil.',
        )
        continue
      }

      if (pushed.status === 'error') throw new Error(pushed.message)

      // La version est enregistrée AVANT l'envoi des vêtements : si celui-ci
      // échoue, la nouvelle tentative repartira du bon jeton au lieu de
      // fabriquer un faux conflit avec sa propre écriture.
      await updateOrderServerVersion(order.id, pushed.version)

      const items = await getOrderItems(order.id)
      if (items.length > 0) {
        const { error: itemsError } = await supabase
          .from('order_items')
          .upsert(items.map(toSupabaseOrderItem), { onConflict: 'id' })

        if (itemsError) throw new Error(itemsError.message)
      }

      await markOrderSynced(order.id, pushed.version)
      succeeded += 1
    } catch (error) {
      failed += 1
      lastError = toFrenchSyncError(error)
      await markOrderSyncError(order.id, lastError)
    }
  }

  const remaining = await countPendingOrders(tenantId)
  useSyncStore.getState().finishSync({ pendingCount: remaining, lastError })

  return {
    attempted: pendingOrders.length,
    succeeded,
    failed,
    conflicts,
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
