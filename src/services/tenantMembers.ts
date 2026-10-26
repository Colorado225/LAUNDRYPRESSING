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
  /** E-mail du compte, renseigné par la fonction `tenant_team()` (migration 025). */
  email?: string | null
}

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Propriétaire',
  receptionist: 'Réception',
  artisan: 'Atelier',
}

/**
 * Équipe du pressing actif.
 *
 * La fonction `tenant_team()` (migration 025) renvoie aussi l'e-mail, utile
 * pour distinguer deux membres qui portent le même rôle. Si le projet distant
 * n'a pas encore la migration, on retombe sur la lecture directe de
 * `tenant_users` : l'écran continue de fonctionner, sans les e-mails.
 */
export async function fetchTeamMembers(tenantId: string): Promise<TeamMember[]> {
  if (!isSupabaseConfigured) return []

  const supabase = getSupabaseClient()
  const rpc = await supabase.rpc('tenant_team')

  if (!rpc.error) {
    const ordre: TenantRole[] = ['owner', 'receptionist', 'artisan']
    return (rpc.data ?? [])
      .map((ligne) => ({
        userId: ligne.user_id,
        role: ligne.role,
        displayName: ligne.display_name ?? null,
        email: ligne.email ?? null,
      }))
      .sort((a, b) => ordre.indexOf(a.role) - ordre.indexOf(b.role))
  }

  const { data, error } = await supabase
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
      email: null,
    }))
    .sort((a, b) => ordre.indexOf(a.role) - ordre.indexOf(b.role))
}

/** Traduit les refus de gestion d'équipe en message lisible par le propriétaire. */
export function teamErrorMessage(message: string): string {
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Réseau indisponible : la gestion de l’équipe nécessite une connexion.'
  }
  if (message.includes('dernier propriétaire')) {
    return 'Impossible de retirer le dernier propriétaire du pressing.'
  }
  if (message.includes('limitée à') || message.includes('limite atteinte')) return message
  if (message.includes('Aucun compte ne porte cet e-mail')) {
    return 'Aucun compte ne porte cet e-mail : le collègue doit d’abord créer son compte.'
  }
  if (message.includes('Abonnement échu')) return message
  if (message.includes('row-level security') || message.includes('42501')) {
    return 'Seul le propriétaire peut gérer l’équipe du pressing.'
  }
  return message
}

/**
 * Rattache un compte existant, ou met à jour son rôle / son nom affiché.
 *
 * Le navigateur n'a aucun droit d'écriture sur `tenant_users` : la fonction
 * serveur `tenant_set_member` (security definer) revérifie le rôle, la limite
 * de comptes de la formule et la règle du dernier propriétaire.
 */
export async function updateTeamMember(input: {
  userId: string
  role: TenantRole
  displayName?: string | null
}): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('La gestion de l’équipe nécessite une connexion.')
  }

  const { error } = await getSupabaseClient().rpc('tenant_set_member', {
    p_user: input.userId,
    p_role: input.role,
    p_display_name: input.displayName?.trim() ? input.displayName.trim() : null,
  })

  if (error) throw new Error(teamErrorMessage(error.message))
}

/** Rattachement par e-mail : le propriétaire n'a pas à connaître les UUID. */
export async function addTeamMemberByEmail(input: {
  email: string
  role: TenantRole
  displayName?: string | null
}): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('La gestion de l’équipe nécessite une connexion.')
  }

  const email = input.email.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Indiquez l’adresse e-mail du collègue.')
  }

  const { error } = await getSupabaseClient().rpc('tenant_attach_member_by_email', {
    p_email: email,
    p_role: input.role,
    p_display_name: input.displayName?.trim() ? input.displayName.trim() : null,
  })

  if (error) throw new Error(teamErrorMessage(error.message))
}

/** Détache un membre. Le dernier propriétaire est protégé côté serveur. */
export async function removeTeamMember(userId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('La gestion de l’équipe nécessite une connexion.')
  }

  const { error } = await getSupabaseClient().rpc('tenant_remove_member', {
    p_user: userId,
  })

  if (error) throw new Error(teamErrorMessage(error.message))
}

/** Libellé lisible d'un membre, sans jamais afficher d'UUID brut. */
export function memberLabel(membre: TeamMember, currentUserId: string | null): string {
  const suffixe = membre.userId === currentUserId ? ' (moi)' : ''
  const nom = membre.displayName?.trim() || ROLE_LABELS[membre.role]
  return `${nom}${suffixe}`
}
