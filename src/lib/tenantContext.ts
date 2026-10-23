import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { getSupabaseClient } from './supabaseClient'
import type { TenantRole } from '@/types/database'

/**
 * Contexte multi-tenant côté client.
 *
 * Principe : le `tenant_id` n'est JAMAIS choisi librement par l'utilisateur.
 * Il est déduit de la ligne `tenant_users` correspondant à son compte Supabase.
 * La sécurité réelle reste assurée par la RLS PostgreSQL : ce store ne sert
 * qu'à filtrer les requêtes et à adapter l'interface.
 *
 * Le store est persisté pour survivre à un rechargement de page hors ligne.
 */

const STORAGE_KEY = 'pressing-pro-tenant'

export interface TenantMembership {
  tenantId: string
  tenantName: string
  role: TenantRole
  /** Compte Supabase connecté, `null` en mode démonstration. */
  userId: string | null
}

interface TenantState {
  tenantId: string | null
  tenantName: string | null
  role: TenantRole | null
  userId: string | null
  setMembership: (membership: TenantMembership) => void
  clear: () => void
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      tenantId: null,
      tenantName: null,
      role: null,
      userId: null,
      setMembership: ({ tenantId, tenantName, role, userId }) =>
        set({ tenantId, tenantName, role, userId }),
      clear: () => set({ tenantId: null, tenantName: null, role: null, userId: null }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tenantId: state.tenantId,
        tenantName: state.tenantName,
        role: state.role,
        userId: state.userId,
      }),
    },
  ),
)

/** Lecture hors composant React (utile pour le moteur de synchronisation). */
export function getTenantId(): string | null {
  return useTenantStore.getState().tenantId
}

export function setTenantId(tenantId: string | null): void {
  if (tenantId === null) {
    useTenantStore.getState().clear()
    return
  }
  useTenantStore.setState({ tenantId })
}

/**
 * Charge le rattachement d'un utilisateur à un pressing.
 *
 * Un utilisateur peut appartenir à plusieurs pressings (ex. un gérant qui
 * possède deux boutiques). On retient ici le premier rattachement ; le
 * sélecteur multi-pressing est hors périmètre du MVP et documenté en V2.
 */
export async function resolveTenantForUser(userId: string): Promise<TenantMembership | null> {
  const supabase = getSupabaseClient()

  const { data: membership, error: membershipError } = await supabase
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (membershipError) throw membershipError
  if (!membership) return null

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('id', membership.tenant_id)
    .maybeSingle()

  if (tenantError) throw tenantError
  if (!tenant) return null

  const resolved: TenantMembership = {
    tenantId: tenant.id,
    tenantName: tenant.name,
    role: membership.role,
    userId,
  }

  useTenantStore.getState().setMembership(resolved)
  return resolved
}
