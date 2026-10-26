import {
  db,
  type LocalTenantActivity,
  type LocalTenantService,
} from '@/db/localDb'
import type { TenantServiceBillingUnit } from '@/types/database'
import { isSupabaseConfigured } from '@/lib/env'
import { labelActivite } from '@/lib/tenantActivities'
import { getSupabaseClient } from '@/lib/supabaseClient'

export interface TenantActivity {
  id: string
  tenantId: string
  name: string
  sortOrder: number
}

export interface TenantServiceOffering {
  id: string
  tenantId: string
  activityId: string
  activityName: string
  serviceName: string
  billingUnit: TenantServiceBillingUnit
  unitPrice: number | null
  sortOrder: number
}

export interface TenantServiceConfiguration {
  activities: TenantActivity[]
  services: TenantServiceOffering[]
}

function fromLocalActivity(row: LocalTenantActivity): TenantActivity {
  return { ...row }
}

function fromLocalService(row: LocalTenantService): TenantServiceOffering {
  const code = row.activityCode
  return {
    id: row.id,
    tenantId: row.tenantId,
    activityId: row.activityId || `legacy:${code ?? 'unknown'}`,
    activityName: row.activityName || (code ? labelActivite(code) : 'Activité'),
    serviceName: row.serviceName,
    billingUnit: row.billingUnit ?? 'PIECE',
    unitPrice: row.unitPrice ?? null,
    sortOrder: row.sortOrder,
  }
}

async function replaceLocalConfiguration(
  tenantId: string,
  configuration: TenantServiceConfiguration,
): Promise<void> {
  await db.transaction('rw', [db.tenantActivities, db.tenantServices], async () => {
    await Promise.all([
      db.tenantActivities.where('tenantId').equals(tenantId).delete(),
      db.tenantServices.where('tenantId').equals(tenantId).delete(),
    ])
    if (configuration.activities.length > 0) {
      await db.tenantActivities.bulkAdd(configuration.activities)
    }
    if (configuration.services.length > 0) {
      await db.tenantServices.bulkAdd(configuration.services.map((service) => ({
        ...service,
        activityCode: null,
      })))
    }
  })
}

function localConfiguration(tenantId: string): Promise<TenantServiceConfiguration> {
  return Promise.all([
    db.tenantActivities.where('tenantId').equals(tenantId).toArray(),
    db.tenantServices.where('tenantId').equals(tenantId).toArray(),
  ]).then(([activities, services]) => {
    const activitiesMapped = activities.map(fromLocalActivity)
    const known = new Set(activitiesMapped.map((activity) => activity.id))
    // Cache de l'ancienne version : reconstruit les intitulés des activités
    // héritées tant qu'un appareil n'a pas encore rafraîchi son cache en ligne.
    for (const service of services) {
      const normalized = fromLocalService(service)
      if (known.has(normalized.activityId)) continue
      known.add(normalized.activityId)
      activitiesMapped.push({
        id: normalized.activityId,
        tenantId,
        name: normalized.activityName,
        sortOrder: normalized.sortOrder,
      })
    }
    return {
      activities: activitiesMapped.sort((a, b) => a.sortOrder - b.sortOrder),
      services: services.map(fromLocalService).sort((a, b) => a.sortOrder - b.sortOrder),
    }
  })
}

function localId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function requireOnlineConfiguration(): void {
  if (!navigator.onLine && isSupabaseConfigured) {
    throw new Error('La modification des services nécessite une connexion internet.')
  }
}

/** Charge activités + prestations depuis Supabase et met à jour le cache hors ligne. */
export async function fetchTenantServiceConfiguration(
  tenantId: string,
): Promise<TenantServiceConfiguration> {
  if (!isSupabaseConfigured || !navigator.onLine) return localConfiguration(tenantId)

  const supabase = getSupabaseClient()
  const [activitiesResult, servicesResult] = await Promise.all([
    supabase
      .from('tenant_activities')
      .select('id, tenant_id, name, sort_order')
      .eq('tenant_id', tenantId)
      .order('sort_order'),
    supabase
      .from('tenant_services')
      .select('id, tenant_id, activity_id, activity_code, service_name, billing_unit, unit_price, sort_order')
      .eq('tenant_id', tenantId)
      .order('sort_order'),
  ])

  if (activitiesResult.error) throw activitiesResult.error
  if (servicesResult.error) throw servicesResult.error

  const activities: TenantActivity[] = (activitiesResult.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sortOrder: row.sort_order,
  }))
  const activityNames = new Map(activities.map((activity) => [activity.id, activity.name]))
  const services: TenantServiceOffering[] = (servicesResult.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    activityId: row.activity_id,
    activityName: activityNames.get(row.activity_id) ?? 'Activité',
    serviceName: row.service_name,
    billingUnit: row.billing_unit,
    unitPrice: row.unit_price,
    sortOrder: row.sort_order,
  }))

  const configuration = { activities, services }
  await replaceLocalConfiguration(tenantId, configuration)
  return configuration
}

/** Compatibilité du formulaire de commande, qui ne consomme que les libellés. */
export async function fetchTenantServices(tenantId: string): Promise<TenantServiceOffering[]> {
  return (await fetchTenantServiceConfiguration(tenantId)).services
}

/** Renvoie `null` hors ligne ; le mode démonstration ne force pas l'onboarding. */
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

async function refreshConfiguration(tenantId: string): Promise<void> {
  if (isSupabaseConfigured && navigator.onLine) {
    await fetchTenantServiceConfiguration(tenantId)
  }
}

export async function createTenantActivity(tenantId: string, name: string): Promise<void> {
  const clean = name.trim()
  if (clean.length < 2 || clean.length > 80) throw new Error('Le nom de l’activité doit contenir entre 2 et 80 caractères.')
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const { error } = await getSupabaseClient().from('tenant_activities').insert({
      tenant_id: tenantId,
      name: clean,
    })
    if (error) throw error
    await refreshConfiguration(tenantId)
    return
  }

  const activities = await db.tenantActivities.where('tenantId').equals(tenantId).toArray()
  if (activities.some((activity) => activity.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
    throw new Error('Cette activité existe déjà.')
  }
  await db.tenantActivities.add({
    id: localId(), tenantId, name: clean, sortOrder: activities.length,
  })
}

export async function updateTenantActivity(
  tenantId: string,
  activityId: string,
  name: string,
): Promise<void> {
  const clean = name.trim()
  if (clean.length < 2 || clean.length > 80) throw new Error('Le nom de l’activité doit contenir entre 2 et 80 caractères.')
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const { data, error } = await getSupabaseClient()
      .from('tenant_activities')
      .update({ name: clean })
      .eq('tenant_id', tenantId)
      .eq('id', activityId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Cette activité est introuvable ou vous ne pouvez pas la modifier.')
    await refreshConfiguration(tenantId)
    return
  }

  await db.tenantActivities.update(activityId, { name: clean })
}

/** La FK en cascade supprime aussi les prestations rattachées à l'activité. */
export async function deleteTenantActivity(tenantId: string, activityId: string): Promise<void> {
  requireOnlineConfiguration()
  if (isSupabaseConfigured) {
    const { data, error } = await getSupabaseClient()
      .from('tenant_activities')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', activityId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Cette activité est introuvable ou vous ne pouvez pas la supprimer.')
    await refreshConfiguration(tenantId)
    return
  }

  await db.transaction('rw', [db.tenantActivities, db.tenantServices], async () => {
    await db.tenantActivities.delete(activityId)
    await db.tenantServices.where('activityId').equals(activityId).delete()
  })
}

function normalizeTenantServicePricing(
  billingUnit: TenantServiceBillingUnit,
  unitPrice: number | null,
): { billingUnit: TenantServiceBillingUnit; unitPrice: number | null } {
  if (billingUnit !== 'PIECE' && billingUnit !== 'KG') {
    throw new Error('Unité de facturation invalide.')
  }
  if (billingUnit === 'PIECE') return { billingUnit, unitPrice: null }
  if (unitPrice !== null && (!Number.isSafeInteger(unitPrice) || unitPrice < 1 || unitPrice > 10_000_000)) {
    throw new Error('Le tarif au kilo doit être un montant entier entre 1 et 10 000 000 FCFA.')
  }
  return { billingUnit, unitPrice }
}

export async function createTenantService(
  tenantId: string,
  activityId: string,
  serviceName: string,
  billingUnit: TenantServiceBillingUnit = 'PIECE',
  unitPrice: number | null = null,
): Promise<void> {
  const clean = serviceName.trim()
  if (clean.length < 2 || clean.length > 80) throw new Error('Le nom de la prestation doit contenir entre 2 et 80 caractères.')
  const pricing = normalizeTenantServicePricing(billingUnit, unitPrice)
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const { error } = await getSupabaseClient().from('tenant_services').insert({
      tenant_id: tenantId,
      activity_id: activityId,
      service_name: clean,
      billing_unit: pricing.billingUnit,
      unit_price: pricing.unitPrice,
    })
    if (error) throw error
    await refreshConfiguration(tenantId)
    return
  }

  const services = await db.tenantServices.where('activityId').equals(activityId).toArray()
  if (services.some((service) => service.serviceName.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
    throw new Error('Cette prestation existe déjà dans cette activité.')
  }
  const activity = await db.tenantActivities.get(activityId)
  if (!activity || activity.tenantId !== tenantId) throw new Error('Activité introuvable.')
  await db.tenantServices.add({
    id: localId(), tenantId, activityId, activityName: activity.name,
    activityCode: null, serviceName: clean, ...pricing, sortOrder: services.length,
  })
}

export async function updateTenantService(
  tenantId: string,
  serviceId: string,
  activityId: string,
  serviceName: string,
  billingUnit: TenantServiceBillingUnit = 'PIECE',
  unitPrice: number | null = null,
): Promise<void> {
  const clean = serviceName.trim()
  if (clean.length < 2 || clean.length > 80) throw new Error('Le nom de la prestation doit contenir entre 2 et 80 caractères.')
  const pricing = normalizeTenantServicePricing(billingUnit, unitPrice)
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const { data, error } = await getSupabaseClient()
      .from('tenant_services')
      .update({
        activity_id: activityId,
        service_name: clean,
        billing_unit: pricing.billingUnit,
        unit_price: pricing.unitPrice,
      })
      .eq('tenant_id', tenantId)
      .eq('id', serviceId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Cette prestation est introuvable ou vous ne pouvez pas la modifier.')
    await refreshConfiguration(tenantId)
    return
  }

  const activity = await db.tenantActivities.get(activityId)
  if (!activity || activity.tenantId !== tenantId) throw new Error('Activité introuvable.')
  await db.tenantServices.update(serviceId, {
    activityId, activityName: activity.name, serviceName: clean, ...pricing,
  })
}

export async function deleteTenantService(tenantId: string, serviceId: string): Promise<void> {
  requireOnlineConfiguration()
  if (isSupabaseConfigured) {
    const { data, error } = await getSupabaseClient()
      .from('tenant_services')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', serviceId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Cette prestation est introuvable ou vous ne pouvez pas la supprimer.')
    await refreshConfiguration(tenantId)
    return
  }
  await db.tenantServices.delete(serviceId)
}

/** Marque la première configuration terminée côté serveur, après contrôle RLS. */
export async function completeTenantOnboarding(tenantId: string): Promise<void> {
  if (isSupabaseConfigured) {
    requireOnlineConfiguration()
    const { error } = await getSupabaseClient().rpc('complete_tenant_onboarding')
    if (error) throw error
  }
  // Mode démo : la configuration reste locale et le garde est désactivé.
  void tenantId
}
