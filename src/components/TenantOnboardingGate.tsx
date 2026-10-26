import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import { useTenantStore } from '@/lib/tenantContext'
import { TenantOnboardingContext, type TenantOnboardingContextValue, type TenantOnboardingState, useTenantOnboarding } from '@/lib/tenantOnboarding'
import { isTenantOnboardingComplete } from '@/services/tenantServices'

export function TenantOnboardingProvider({ children }: { children: ReactNode }) {
  const tenantId = useTenantStore((state) => state.tenantId)
  const [state, setState] = useState<TenantOnboardingState>('loading')

  useEffect(() => {
    if (!tenantId) {
      setState('complete')
      return
    }

    let active = true
    setState('loading')
    void isTenantOnboardingComplete(tenantId)
      .then((complete) => {
        if (active) setState(complete === false ? 'required' : 'complete')
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

  const value = useMemo<TenantOnboardingContextValue>(() => ({
    state,
    markComplete: () => setState('complete'),
  }), [state])

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
