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

interface SyncStore {
  state: SyncState
  lastSyncedAt: string | null
  lastError: string | null
  /** Nombre de commandes en attente, recalculé à chaque passage. */
  pendingCount: number
  setOffline: () => void
  startSync: () => void
  finishSync: (params: { pendingCount: number; lastError: string | null }) => void
  reset: () => void
}

export const useSyncStore = create<SyncStore>()((set) => ({
  state: 'idle',
  lastSyncedAt: null,
  lastError: null,
  pendingCount: 0,

  setOffline: () => set({ state: 'offline' }),

  startSync: () => set({ state: 'syncing', lastError: null }),

  finishSync: ({ pendingCount, lastError }) =>
    set((previous) => ({
      state: lastError ? 'error' : 'idle',
      pendingCount,
      lastError,
      // On ne met à jour l'horodatage que si le passage s'est bien terminé.
      lastSyncedAt: lastError ? previous.lastSyncedAt : new Date().toISOString(),
    })),

  reset: () => set({ state: 'idle', lastError: null, pendingCount: 0 }),
}))

export const selectSyncState = (state: SyncStore) => state.state
