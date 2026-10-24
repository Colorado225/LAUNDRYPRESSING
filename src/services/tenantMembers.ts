import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import type { TenantRole } from '@/types/database'

/**
 * Équipe du pressing (palier 2).
 *
 * L'application ne connaît PAS les comptes : elle interroge `tenant_users`, que
 * la politique RLS rend visible aux membres d'un même pressing (la
 * revendication du jeton est lue directement pour éviter la récursion).
 *
 * Hors ligne, la liste est indisponible : le sélecteur d'attribution se
 * rabat alors sur le seul utilisateur courant.
 */
export interface TeamMember {
  userId: string
  role: TenantRole
  displayName: string | null
}

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Propriétaire',
  receptionist: 'Réception',
  artisan: 'Atelier',
}

export async function fetchTeamMembers(tenantId: string): Promise<TeamMember[]> {
  if (!isSupabaseConfigured) return []

  const { data, error } = await getSupabaseClient()
    .from('tenant_users')
    .select('user_id, role, display_name')
    .eq('tenant_id', tenantId)

  if (error) throw error
  if (!data) return []

  const ordre: TenantRole[] = ['owner', 'receptionist', 'artisan']

  return data
    .map((ligne) => ({
      userId: ligne.user_id,
      role: ligne.role,
      displayName: ligne.display_name ?? null,
    }))
    .sort((a, b) => ordre.indexOf(a.role) - ordre.indexOf(b.role))
}

/** Libellé lisible d'un membre, sans jamais afficher d'UUID brut. */
export function memberLabel(membre: TeamMember, currentUserId: string | null): string {
  const suffixe = membre.userId === currentUserId ? ' (moi)' : ''
  const nom = membre.displayName?.trim() || ROLE_LABELS[membre.role]
  return `${nom}${suffixe}`
}
