import { db, type LocalTenantService } from '@/db/localDb'
import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import type { TenantActivityCode } from '@/types/database'

export interface TenantServiceOffering {
  id: string
  tenantId: string
  activityCode: TenantActivityCode
  serviceName: string
  sortOrder: number
}

export interface TenantServiceInput {
  activityCode: TenantActivityCode
  serviceName: string
}

function fromLocal(row: LocalTenantService): TenantServiceOffering {
  return { ...row }
}

async function replaceLocalServices(
  tenantId: string,
  services: TenantServiceOffering[],
): Promise<void> {
  await db.transaction('rw', db.tenantServices, async () => {
    await db.tenantServices.where('tenantId').equals(tenantId).delete()
    if (services.length > 0) await db.tenantServices.bulkAdd(services)
  })
}

/** Lit les prestations du pressing ; le cache Dexie sert de repli hors ligne. */
export async function fetchTenantServices(tenantId: string): Promise<TenantServiceOffering[]> {
  const cached = await db.tenantServices.where('tenantId').equals(tenantId).toArray()

  if (!isSupabaseConfigured || !navigator.onLine) {
    return cached.map(fromLocal).sort((a, b) => a.sortOrder - b.sortOrder)
  }

  const { data, error } = await getSupabaseClient()
    .from('tenant_services')
    .select('id, tenant_id, activity_code, service_name, sort_order')
    .eq('tenant_id', tenantId)
    .order('sort_order')

  if (error) {
    if (cached.length > 0) return cached.map(fromLocal).sort((a, b) => a.sortOrder - b.sortOrder)
    throw error
  }

  const services: TenantServiceOffering[] = (data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    activityCode: row.activity_code,
    serviceName: row.service_name,
    sortOrder: row.sort_order,
  }))
  await replaceLocalServices(tenantId, services)
  return services
}

/** Renvoie `null` hors ligne ; le mode démonstration est déjà considéré configuré. */
export async function isTenantOnboardingComplete(tenantId: string): Promise<boolean | null> {
  if (!isSupabaseConfigured) return true
  if (!navigator.onLine) return null

  const { data, error } = await getSupabaseClient()
    .from('tenants')
    .select('onboarding_completed_at')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) throw error
  return Boolean(data?.onboarding_completed_at)
}

/** Enregistre les prestations côté serveur puis rafraîchit leur cache local. */
export async function saveTenantServices(
  tenantId: string,
  services: TenantServiceInput[],
): Promise<void> {
  if (services.length === 0) throw new Error('Choisissez au moins une prestation.')

  if (isSupabaseConfigured) {
    if (!navigator.onLine) {
      throw new Error('La configuration des prestations nécessite une connexion internet.')
    }
    const { error } = await getSupabaseClient().rpc('save_tenant_services', {
      p_services: services.map(({ activityCode, serviceName }) => ({
        activity_code: activityCode,
        service_name: serviceName.trim(),
      })),
    })
    if (error) throw error

    // Récupère les UUID générés côté serveur, puis garde le référentiel hors ligne.
    await fetchTenantServices(tenantId)
    return
  }

  const now = Date.now()
  await replaceLocalServices(tenantId, services.map((service, index) => ({
    id: `local-${tenantId}-${now}-${index}`,
    tenantId,
    activityCode: service.activityCode,
    serviceName: service.serviceName.trim(),
    sortOrder: index,
  })))
}
