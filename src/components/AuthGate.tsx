import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import Login from '@/pages/Login'
import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { useTenantStore } from '@/lib/tenantContext'
import { restoreSession, signOut } from '@/services/authService'
import { syncPendingOrders } from '@/sync/syncEngine'
import { useSubscriptionStore } from '@/lib/subscriptionContext'
import { isPlatformAdmin } from '@/services/platformService'
import { oublierOnboardingEnSession } from '@/lib/onboardingSession'

/**
 * Porte d'entrée de l'application (phase 5).
 *
 * Remplace l'écran temporaire `TenantGate` : le pressing n'est plus choisi à la
 * main mais déduit du compte connecté (`tenant_users`). L'éditeur de la
 * plateforme est une exception explicite : le RPC `is_platform_admin()` lui
 * permet d'ouvrir la supervision sans appartenance à un pressing.
 *
 * Trois chemins :
 *  1. **Supabase configuré + session valide** → l'application s'ouvre. La
 *     restauration se fait depuis le stockage local, donc **hors ligne aussi** :
 *     une tablette d'atelier qui redémarre sans réseau garde l'accès.
 *  2. **Supabase configuré + aucune session** → écran de connexion.
 *  3. **Supabase non configuré** → écran de connexion en mode démonstration,
 *     qui laisse entrer avec l'UUID d'un pressing pour tester l'offline-first.
 */

type Phase = 'chargement' | 'anonyme' | 'connecte'

export default function AuthGate({ children }: { children: ReactNode }) {
  const tenantId = useTenantStore((state) => state.tenantId)
  const isPlatformAdminStore = useTenantStore((state) => state.isPlatformAdmin)
  const [phase, setPhase] = useState<Phase>(() =>
    isSupabaseConfigured ? 'chargement' : 'anonyme',
  )
  const [notice, setNotice] = useState<string | null>(null)

  // 1. Restauration de la session au démarrage.
  useEffect(() => {
    if (!isSupabaseConfigured) return

    let cancelled = false

    const boot = async () => {
      try {
        const restored = await restoreSession()
        if (cancelled) return

        if (restored?.isPlatformAdmin) {
          useTenantStore.getState().setPlatformAdmin(true)
          setPhase('connecte')
          return
        }

        if (restored?.membership) {
          setPhase('connecte')
          // Une tablette qui revient en ligne doit envoyer tout de suite sa
          // file d'attente, sans attendre le prochain cycle de 60 s.
          void syncPendingOrders()
          return
        }

        if (restored) {
          // Session valide mais compte détaché (accès retiré côté serveur).
          await signOut().catch(() => undefined)
          if (cancelled) return
          setNotice(
            'Votre compte n’est rattaché à aucun pressing. Contactez le propriétaire pour obtenir un accès.',
          )
        }

        setPhase('anonyme')
      } catch {
        // Stockage local corrompu ou client indisponible : on ne bloque pas
        // l'utilisateur sur un écran de chargement éternel.
        if (!cancelled) setPhase('anonyme')
      }
    }

    void boot()

    return () => {
      cancelled = true
    }
  }, [])

  // 2. Une fois la session ouverte (palier 4) : état de l'abonnement et droits
  //    de supervision. Les deux appels sont facultatifs — une panne réseau ne
  //    doit jamais empêcher d'entrer dans l'application.
  useEffect(() => {
    if (phase !== 'connecte') return

    void useSubscriptionStore.getState().refresh()
    void isPlatformAdmin()
      .then((admin) => useTenantStore.getState().setPlatformAdmin(admin))
      .catch(() => undefined)
  }, [phase])

  // 3. Déconnexion explicite (jeton révoqué, mot de passe changé…).
  useEffect(() => {
    if (!isSupabaseConfigured) return

    const supabase = getSupabaseClient()
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return

      // ⚠️ Hors ligne, un échec de rafraîchissement de jeton émet parfois
      // `SIGNED_OUT`. Déconnecter la tablette à ce moment-là priverait
      // l'atelier de toutes ses commandes locales : on ignore l'événement
      // tant que le réseau est absent.
      if (!navigator.onLine) return

      useTenantStore.getState().clear()
      useSubscriptionStore.getState().clear()
      // La configuration du pressing est revalidée à la prochaine connexion :
      // un gérant a pu la modifier depuis une autre tablette entre-temps.
      oublierOnboardingEnSession()
      setNotice('Votre session a expiré. Reconnectez-vous pour synchroniser vos commandes.')
      setPhase('anonyme')
    })

    return () => data.subscription.unsubscribe()
  }, [])

  // Mode démonstration : rien à restaurer, l'accès est purement local.
  if (!isSupabaseConfigured) {
    return tenantId ? (
      <>{children}</>
    ) : (
      <Login onAuthenticated={() => undefined} />
    )
  }

  if (phase === 'chargement') {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-brand-navy text-slate-300"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="animate-spin" size={24} aria-hidden />
        <p className="text-sm">Ouverture de la session…</p>
      </div>
    )
  }

  // L'éditeur de la plateforme n'est membre d'aucun pressing : son accès est
  // autorisé uniquement par `is_platform_admin()` côté serveur.
  // Pour un compte de pressing, l'absence de boutique reste un refus d'accès.
  if (phase === 'anonyme' || (!tenantId && !isPlatformAdminStore)) {
    return (
      <Login
        onAuthenticated={() => setPhase('connecte')}
        notice={phase === 'anonyme' ? notice : null}
      />
    )
  }

  return <>{children}</>
}
