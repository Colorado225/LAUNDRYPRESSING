import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import { useTenantStore } from '@/lib/tenantContext'
import { TenantOnboardingContext, type TenantOnboardingContextValue, type TenantOnboardingState, useTenantOnboarding } from '@/lib/tenantOnboarding'
import { isTenantOnboardingComplete } from '@/services/tenantServices'
import {
  estTermineEnSession,
  marquerTermineEnSession,
} from '@/lib/onboardingSession'

/**
 * Garde de première configuration.
 *
 * ⚠️ Deux pièges ont provoqué une boucle infinie de navigation (« Maximum update
 * depth exceeded ») dans une version précédente :
 *
 * 1. `isTenantOnboardingComplete` renvoie `null` quand le pressing est
 *    configuré mais la tablette **hors ligne**. En testant `!== true`, on
 *    repassait en `required` à chaque montage : `/bienvenue` → `markComplete` →
 *    `/commandes` → rechargement → `required` → `/bienvenue`… Le `null` est
 *    désormais traité comme « configuration supposée, vérification différée ».
 * 2. Une fois `markComplete()` appelé, le serveur reste la source de vérité ;
 *    sans mémoire de session, le prochain montage redemandait la vérification
 *    et pouvait renvoyer vers `/bienvenue`. La complétion est donc mémorisée
 *    par pressing pour la durée de la session uniquement (jamais persistée :
 *    elle ne doit pas survivre à une modification faite depuis une autre
 *    tablette).
 *
 * Enfin, un échec réseau conserve l'état précédent (`complete`) au lieu de
 * rendre la main à une étape de configuration : hors ligne, l'atelier doit
 * pouvoir travailler sur ses commandes locales.
 */

/** Pressings dont la configuration a été confirmée pendant cette session. */

export function TenantOnboardingProvider({ children }: { children: ReactNode }) {
  const tenantId = useTenantStore((state) => state.tenantId)
  const [state, setState] = useState<TenantOnboardingState>('loading')
  const dejaComplet = useRef(false)

  useEffect(() => {
    if (!tenantId) {
      setState('complete')
      return
    }

    // Complété dans cette session : on ne redemande pas le serveur, et on ne
    // repasse surtout pas par `loading`, qui démonterait le routeur.
    if (estTermineEnSession(tenantId)) {
      setState('complete')
      return
    }

    let active = true
    // On ne revient pas à `loading` si l'on a déjà un état exploitable :
    // afficher l'écran de vérification à chaque re-render produirait un
    // clignotement, et un `Navigate` rendu pendant ce temps relancerait la
    // boucle.
    if (!dejaComplet.current) setState('loading')

    void isTenantOnboardingComplete(tenantId)
      .then((complet) => {
        if (!active) return
        // `null` = hors ligne : on fait confiance à l'état précédent plutôt que
        // de renvoyer l'atelier vers un écran de configuration.
        if (complet === null) {
          setState('complete')
          return
        }
        dejaComplet.current = complet
        if (complet) marquerTermineEnSession(tenantId)
        setState(complet ? 'complete' : 'required')
      })
      .catch(() => {
        // Le garde ne doit jamais bloquer le fonctionnement offline-first ni
        // les pressings sur un schéma précédent ; la migration 021 activera le
        // parcours dès qu'elle sera appliquée.
        if (active) setState('complete')
      })

    return () => {
      active = false
    }
  }, [tenantId])

  const value = useMemo<TenantOnboardingContextValue>(
    () => ({
      state,
      markComplete: () => {
        if (tenantId) marquerTermineEnSession(tenantId)
        dejaComplet.current = true
        setState('complete')
      },
    }),
    [state, tenantId],
  )

  return <TenantOnboardingContext.Provider value={value}>{children}</TenantOnboardingContext.Provider>
}

/** Force l'étape de personnalisation uniquement aux pressings qui ne l'ont pas terminée. */
export function TenantOnboardingGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { state } = useTenantOnboarding()

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-slate-500" role="status">
        <Loader2 className="animate-spin" size={20} aria-hidden />
        Vérification de la configuration du pressing…
      </div>
    )
  }

  if (state === 'required' && pathname !== '/bienvenue') return <Navigate to="/bienvenue" replace />
  if (state === 'complete' && pathname === '/bienvenue') return <Navigate to="/commandes" replace />

  return <>{children}</>
}
