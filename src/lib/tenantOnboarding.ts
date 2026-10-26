import { createContext, useContext } from 'react'
export type TenantOnboardingState = 'loading' | 'complete' | 'required'

export interface TenantOnboardingContextValue {
  state: TenantOnboardingState
  markComplete: () => void
}

export const TenantOnboardingContext = createContext<TenantOnboardingContextValue | null>(null)

export function useTenantOnboarding(): TenantOnboardingContextValue {
  const context = useContext(TenantOnboardingContext)
  if (!context) throw new Error('useTenantOnboarding doit être utilisé dans TenantOnboardingProvider.')
  return context
}
