import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'
import type {
  PlatformSupportRequest,
  SubscriptionState,
  SupportRequestRow,
  SupportRequestStatus,
  TenantOverviewRow,
  TenantRole,
} from '@/types/database'

/**
 * Supervision de l'éditeur et support (palier 4).
 *
 * Deux familles d'appels :
 *  - côté pressing : créer une demande, relire les réponses à ses propres
 *    demandes (RLS par `tenant_id`) ;
 *  - côté éditeur : console de supervision. Ces fonctions `security definer`
 *    vérifient `is_platform_admin()` et refusent tout autre compte
 *    (`42501`). Le contrôle n'est donc pas seulement visuel.
 */

export interface MemberRow {
  tenant_id: string
  tenant_name: string
  user_id: string
  email: string | null
  role: TenantRole
  display_name: string | null
  created_at: string
}

export class PlatformError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlatformError'
  }
}

function traduire(message: string): string {
  const bas = message.toLowerCase()
  if (bas.includes('supervision réservée')) {
    return 'Action réservée à l’éditeur de la plateforme.'
  }
  if (bas.includes('limite atteinte') || bas.includes('limitée à')) {
    return message
  }
  if (bas.includes('dernier propriétaire')) {
    return 'Impossible de détacher le dernier propriétaire du pressing.'
  }
  if (bas.includes('row-level security') || bas.includes('permission denied')) {
    return 'Votre rôle ne permet pas cette action.'
  }
  return message
}

/** Vrai si le compte connecté supervise la plateforme. */
export async function isPlatformAdmin(): Promise<boolean> {
  if (!isSupabaseConfigured) return false

  const { data, error } = await getSupabaseClient().rpc('is_platform_admin')
  if (error) return false
  return data === true
}

export async function fetchTenantOverview(): Promise<TenantOverviewRow[]> {
  const { data, error } = await getSupabaseClient().rpc('platform_tenants_overview')
  if (error) throw new PlatformError(traduire(error.message))
  return data ?? []
}

export async function setSubscription(input: {
  tenantId: string
  plan: string
  days?: number
  status?: SubscriptionState
  reason?: string | null
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc('platform_set_subscription', {
    p_tenant: input.tenantId,
    p_plan: input.plan,
    p_days: input.days ?? 0,
    p_status: input.status ?? 'active',
    p_reason: input.reason ?? null,
  })

  if (error) throw new PlatformError(traduire(error.message))
}

export async function createShop(input: {
  name: string
  phone?: string | null
  ownerId?: string | null
  plan: string
  days?: number
}): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('platform_create_shop', {
    p_name: input.name,
    p_phone: input.phone ?? null,
    p_owner: input.ownerId ?? null,
    p_plan: input.plan,
    p_days: input.days ?? 0,
  })

  if (error) throw new PlatformError(traduire(error.message))
  const boutique = data as { tenant_id?: string } | null
  if (!boutique?.tenant_id) throw new PlatformError('Boutique non créée.')
  return boutique.tenant_id
}

export async function fetchMembers(): Promise<MemberRow[]> {
  const { data, error } = await getSupabaseClient().rpc('platform_members')
  if (error) throw new PlatformError(traduire(error.message))
  return data ?? []
}

export async function setMember(input: {
  tenantId: string
  userId: string
  role: TenantRole | null
  displayName?: string | null
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc('platform_set_member', {
    p_tenant: input.tenantId,
    p_user: input.userId,
    p_role: input.role,
    p_display_name: input.displayName ?? null,
  })

  if (error) throw new PlatformError(traduire(error.message))
}

/* ------------------------------------------------------------------------- */
/* Support                                                                    */
/* ------------------------------------------------------------------------- */

export async function createSupportRequest(input: {
  tenantId: string
  authorId: string | null
  authorName: string | null
  subject: string
  message: string
}): Promise<void> {
  const { error } = await getSupabaseClient().from('support_requests').insert({
    tenant_id: input.tenantId,
    author_id: input.authorId,
    author_name: input.authorName,
    subject: input.subject.trim(),
    message: input.message.trim(),
  })

  if (error) throw new PlatformError(traduire(error.message))
}

export async function fetchMySupportRequests(tenantId: string): Promise<SupportRequestRow[]> {
  const { data, error } = await getSupabaseClient()
    .from('support_requests')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw new PlatformError(traduire(error.message))
  return data ?? []
}

export async function fetchPlatformSupportRequests(): Promise<PlatformSupportRequest[]> {
  const { data, error } = await getSupabaseClient().rpc('platform_support_requests')
  if (error) throw new PlatformError(traduire(error.message))
  return data ?? []
}

export async function answerSupport(
  id: string,
  response: string,
  status: SupportRequestStatus = 'closed',
): Promise<void> {
  const { error } = await getSupabaseClient().rpc('platform_answer_support', {
    p_id: id,
    p_response: response,
    p_status: status,
  })

  if (error) throw new PlatformError(traduire(error.message))
}

export const SUPPORT_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  open: 'Ouverte',
  in_progress: 'En cours',
  closed: 'Clôturée',
}
