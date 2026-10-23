import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { getTenantId } from '@/lib/tenantContext'
import { countPendingOrders, getOrderItems, getPendingOrders, markOrderSynced, markOrderSyncError, toSupabaseOrder, toSupabaseOrderItem } from '@/db/ordersRepository'
import { useSyncStore } from '@/stores/syncStore'

/**
 * Moteur de synchronisation offline-first.
 *
 * Règles :
 *  1. On n'envoie que les commandes du pressing courant (défense en profondeur :
 *     la RLS filtre de toute façon côté serveur).
 *  2. Chaque commande est envoyée séparément : un échec sur l'une ne bloque pas
 *     les autres, et l'erreur est mémorisée sur la ligne concernée.
 *  3. L'`upsert` est idempotent grâce aux UUID générés côté client : rejouer
 *     une synchronisation ne crée jamais de doublon.
 *  4. En cas d'échec, la commande reste en file (`synced = 0`) et sera retentée
 *     au prochain passage (événement `online` ou intervalle de 60 s).
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
  /** `true` quand le passage a été ignoré (hors ligne, non configuré, sans tenant). */
  skipped: boolean
  lastError: string | null
}

const EMPTY_RESULT: SyncResult = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  skipped: true,
  lastError: null,
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
  let lastError: string | null = null

  for (const order of pendingOrders) {
    try {
      const items = await getOrderItems(order.id)

      // 1. La commande (upsert idempotent sur la clé primaire).
      const { error: orderError } = await supabase
        .from('orders')
        .upsert(toSupabaseOrder(order), { onConflict: 'id' })

      if (orderError) throw new Error(orderError.message)

      // 2. Ses vêtements.
      if (items.length > 0) {
        const { error: itemsError } = await supabase
          .from('order_items')
          .upsert(items.map(toSupabaseOrderItem), { onConflict: 'id' })

        if (itemsError) throw new Error(itemsError.message)
      }

      await markOrderSynced(order.id)
      succeeded += 1
    } catch (error) {
      failed += 1
      lastError = toFrenchSyncError(error)
      await markOrderSyncError(order.id, lastError)
    }
  }

  const remaining = await countPendingOrders(tenantId)
  useSyncStore.getState().finishSync({ pendingCount: remaining, lastError })

  return { attempted: pendingOrders.length, succeeded, failed, skipped: false, lastError }
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
