import { create } from 'zustand'

/**
 * État de la synchronisation, exposé à l'interface.
 *
 * Stratégie de couleurs (cf. OfflineBadge) :
 *  - `idle`    : en ligne, file vide            → vert
 *  - `syncing` : envoi en cours                 → bleu
 *  - `offline` : navigateur hors ligne          → orange
 *  - `error`   : au moins un envoi a échoué     → rouge
 */

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error'

const LAST_SYNC_KEY = 'pressingpro:last-sync:'

export function getSavedLastSyncAt(tenantId: string | null): string | null {
  if (!tenantId || typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(`${LAST_SYNC_KEY}${tenantId}`)
  } catch {
    return null
  }
}

interface SyncStore {
  state: SyncState
  lastSyncedAt: string | null
  lastSyncedTenantId: string | null
  lastError: string | null
  /** Nombre total d'éléments en attente, recalculé à chaque passage. */
  pendingCount: number
  setOffline: () => void
  startSync: () => void
  finishSync: (params: { pendingCount: number; lastError: string | null; tenantId: string }) => void
  reset: () => void
}

export const useSyncStore = create<SyncStore>()((set) => ({
  state: 'idle',
  lastSyncedAt: null,
  lastSyncedTenantId: null,
  lastError: null,
  pendingCount: 0,

  setOffline: () => set({ state: 'offline' }),

  startSync: () => set({ state: 'syncing', lastError: null }),

  finishSync: ({ pendingCount, lastError, tenantId }) => {
    const syncedAt = lastError ? null : new Date().toISOString()
    if (syncedAt && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`${LAST_SYNC_KEY}${tenantId}`, syncedAt)
      } catch {
        // La synchronisation reste réussie si le navigateur refuse le stockage local.
      }
    }
    set((previous) => ({
      state: lastError ? 'error' : 'idle',
      pendingCount,
      lastError,
      // Une erreur conserve la dernière réussite connue, pour ne pas l'effacer.
      lastSyncedAt: syncedAt ?? previous.lastSyncedAt,
      lastSyncedTenantId: syncedAt ? tenantId : previous.lastSyncedTenantId,
    }))
  },

  reset: () => set({
    state: 'idle',
    lastSyncedAt: null,
    lastSyncedTenantId: null,
    lastError: null,
    pendingCount: 0,
  }),
}))

export const selectSyncState = (state: SyncStore) => state.state
