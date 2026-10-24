import { create } from 'zustand'
import { fetchSubscription } from '@/services/subscriptionService'
import type { SubscriptionSnapshot } from '@/types/database'

/**
 * État d'abonnement du pressing (palier 4).
 *
 * Volontairement hors du store persistant : un abonnement mis à jour par
 * l'éditeur doit être relu à chaque ouverture de session. Hors ligne, la
 * dernière valeur connue reste affichée ; `null` signifie « inconnu », jamais
 * « bloqué » — l'interface ne ferme donc pas l'accès sur une simple coupure.
 */
interface SubscriptionState {
  snapshot: SubscriptionSnapshot | null
  loading: boolean
  refresh: () => Promise<void>
  clear: () => void
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  snapshot: null,
  loading: false,
  refresh: async () => {
    set({ loading: true })
    try {
      const snapshot = await fetchSubscription()
      set({ snapshot })
    } catch {
      // Panne réseau : on conserve l'état précédent.
    } finally {
      set({ loading: false })
    }
  },
  clear: () => set({ snapshot: null, loading: false }),
}))
