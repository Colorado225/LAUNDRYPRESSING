import {
  db,
  type LocalTenantActivity,
  type LocalTenantService,
  type LocalTenantServiceCategory,
  type LocalWeightTier,
} from '@/db/localDb'
import type {
  TenantServiceBillingUnit,
  TenantServicePricingMode,
} from '@/types/database'
import { isSupabaseConfigured } from '@/lib/env'
import { labelActivite } from '@/lib/tenantActivities'
import { getSupabaseClient } from '@/lib/supabaseClient'

export interface TenantActivity {
  id: string
  tenantId: string
  name: string
  sortOrder: number
}

export interface TenantServiceCategory {
  id: string
  tenantId: string
  activityId: string
  name: string
  sortOrder: number
  isActive: boolean
}

export interface WeightTier {
  id: string
  tenantId: string
  tenantServiceId: string
  label: string
  weightKg: number
  priceFcfa: number
  isActive: boolean
  sortOrder: number
}

export interface TenantServiceOffering {
  id: string
  tenantId: string
  activityId: string
  activityName: string
  categoryId: string | null
  serviceName: string
  billingUnit: TenantServiceBillingUnit
  pricingMode: TenantServicePricingMode
  unitPrice: number | null
  description: string | null
  durationMinutes: number | null
  isActive: boolean
  sortOrder: number
}

export interface TenantServiceConfiguration {
  activities: TenantActivity[]
  categories: TenantServiceCategory[]
  services: TenantServiceOffering[]
  tiers: WeightTier[]
}

/** Options supplémentaires d'une prestation (migration 027). */
export interface TenantServiceOptions {
  categoryId?: string | null
  pricingMode?: TenantServicePricingMode
  description?: string | null
  durationMinutes?: number | null
  isActive?: boolean
}

function fromLocalActivity(row: LocalTenantActivity): TenantActivity {
  return { ...row }
}

function fromLocalCategory(row: LocalTenantServiceCategory): TenantServiceCategory {
  return { ...row }
}

function fromLocalTier(row: LocalWeightTier): WeightTier {
  return { ...row }
}

function fromLocalService(row: LocalTenantService): TenantServiceOffering {
  const code = row.activityCode
  return {
    id: row.id,
    tenantId: row.tenantId,
    activityId: row.activityId || `legacy:${code ?? 'unknown'}`,
    activityName: row.activityName || (code ? labelActivite(code) : 'Activité'),
    categoryId: row.categoryId ?? null,
    serviceName: row.serviceName,
    billingUnit: row.billingUnit ?? 'PIECE',
    pricingMode: row.pricingMode ?? 'FIXED',
    unitPrice: row.unitPrice ?? null,
    description: row.description ?? null,
    durationMinutes: row.durationMinutes ?? null,
    isActive: row.isActive ?? true,
    sortOrder: row.sortOrder,
  }
}

async function replaceLocalConfiguration(
  tenantId: string,
  configuration: TenantServiceConfiguration,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.tenantActivities, db.tenantServices, db.tenantServiceCategories, db.weightTiers],
    async () => {
      await Promise.all([
        db.tenantActivities.where('tenantId').equals(tenantId).delete(),
        db.tenantServices.where('tenantId').equals(tenantId).delete(),
        db.tenantServiceCategories.where('tenantId').equals(tenantId).delete(),
        db.weightTiers.where('tenantId').equals(tenantId).delete(),
      ])
      if (configuration.activities.length > 0) {
        await db.tenantActivities.bulkAdd(configuration.activities)
      }
      if (configuration.categories.length > 0) {
        await db.tenantServiceCategories.bulkAdd(configuration.categories)
      }
      if (configuration.services.length > 0) {
        await db.tenantServices.bulkAdd(
          configuration.services.map((service) => ({ ...service, activityCode: null })),
        )
      }
      if (configuration.tiers.length > 0) {
        await db.weightTiers.bulkAdd(configuration.tiers)
      }
    },
  )
}

function localConfiguration(tenantId: string): Promise<TenantServiceConfiguration> {
  return Promise.all([
    db.tenantActivities.where('tenantId').equals(tenantId).toArray(),
    db.tenantServices.where('tenantId').equals(tenantId).toArray(),
    db.tenantServiceCategories.where('tenantId').equals(tenantId).toArray(),
    db.weightTiers.where('tenantId').equals(tenantId).toArray(),
  ]).then(([activities, services, categories, tiers]) => {
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
      categories: categories.map(fromLocalCategory).sort((a, b) => a.sortOrder - b.sortOrder),
      services: services.map(fromLocalService).sort((a, b) => a.sortOrder - b.sortOrder),
      tiers: tiers.map(fromLocalTier).sort((a, b) => a.sortOrder - b.sortOrder),
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

/** Charge activités, catégories, prestations et paliers depuis Supabase. */
export async function fetchTenantServiceConfiguration(
  tenantId: string,
): Promise<TenantServiceConfiguration> {
  if (!isSupabaseConfigured || !navigator.onLine) return localConfiguration(tenantId)

  const supabase = getSupabaseClient()
  const [activitiesResult, categoriesResult, servicesResult, tiersResult] = await Promise.all([
    supabase
      .from('tenant_activities')
      .select('id, tenant_id, name, sort_order')
      .eq('tenant_id', tenantId)
      .order('sort_order'),
    supabase
      .from('tenant_service_categories')
      .select('id, tenant_id, activity_id, name, sort_order, is_active')
      .eq('tenant_id', tenantId)
      .order('sort_order'),
    supabase
      .from('tenant_services')
      .select(
        'id, tenant_id, activity_id, activity_code, category_id, service_name, billing_unit, pricing_mode, unit_price, description, duration_minutes, is_active, sort_order',
      )
      .eq('tenant_id', tenantId)
      .order('sort_order'),
    supabase
      .from('tenant_weight_tiers')
      .select('id, tenant_id, tenant_service_id, label, weight_kg, price_fcfa, is_active, sort_order')
      .eq('tenant_id', tenantId)
      .order('sort_order'),
  ])

  if (activitiesResult.error) throw activitiesResult.error
  if (categoriesResult.error) throw categoriesResult.error
  if (servicesResult.error) throw servicesResult.error
  if (tiersResult.error) throw tiersResult.error

  const activities: TenantActivity[] = (activitiesResult.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sortOrder: row.sort_order,
  }))
  const activityNames = new Map(activities.map((activity) => [activity.id, activity.name]))
  const categories: TenantServiceCategory[] = (categoriesResult.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    activityId: row.activity_id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }))
  const services: TenantServiceOffering[] = (servicesResult.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    activityId: row.activity_id,
    activityName: activityNames.get(row.activity_id) ?? 'Activité',
    categoryId: row.category_id,
    serviceName: row.service_name,
    billingUnit: row.billing_unit,
    pricingMode: row.pricing_mode,
    unitPrice: row.unit_price,
    description: row.description,
    durationMinutes: row.duration_minutes,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }))
  const tiers: WeightTier[] = (tiersResult.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    tenantServiceId: row.tenant_service_id,
    label: row.label,
    weightKg: Number(row.weight_kg),
    priceFcfa: row.price_fcfa,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }))

  const configuration = { activities, categories, services, tiers }
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

  await db.transaction(
    'rw',
    [db.tenantActivities, db.tenantServices, db.tenantServiceCategories, db.weightTiers],
    async () => {
      const services = await db.tenantServices.where('activityId').equals(activityId).toArray()
      const serviceIds = services.map((service) => service.id)
      await db.weightTiers.where('tenantServiceId').anyOf(serviceIds).delete()
      await db.tenantServices.where('activityId').equals(activityId).delete()
      await db.tenantServiceCategories.where('activityId').equals(activityId).delete()
      await db.tenantActivities.delete(activityId)
    },
  )
}

// ---------------------------------------------------------------------------
// Catégories de prestations (migration 027)
// ---------------------------------------------------------------------------

function normalizeCategoryName(name: string): string {
  const clean = name.trim()
  if (clean.length < 2 || clean.length > 80) {
    throw new Error('Le nom de la catégorie doit contenir entre 2 et 80 caractères.')
  }
  return clean
}

export async function createTenantCategory(
  tenantId: string,
  activityId: string,
  name: string,
): Promise<void> {
  const clean = normalizeCategoryName(name)
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const { error } = await getSupabaseClient().from('tenant_service_categories').insert({
      tenant_id: tenantId,
      activity_id: activityId,
      name: clean,
    })
    if (error) throw error
    await refreshConfiguration(tenantId)
    return
  }

  const categories = await db.tenantServiceCategories
    .where('activityId').equals(activityId).toArray()
  if (categories.some((category) => category.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
    throw new Error('Cette catégorie existe déjà dans cette activité.')
  }
  await db.tenantServiceCategories.add({
    id: localId(),
    tenantId,
    activityId,
    name: clean,
    sortOrder: categories.length,
    isActive: true,
  })
}

export async function updateTenantCategory(
  tenantId: string,
  categoryId: string,
  name: string,
  isActive?: boolean,
): Promise<void> {
  const clean = normalizeCategoryName(name)
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const patch: { name: string; is_active?: boolean } = { name: clean }
    if (isActive !== undefined) patch.is_active = isActive
    const { data, error } = await getSupabaseClient()
      .from('tenant_service_categories')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Catégorie introuvable ou non modifiable.')
    await refreshConfiguration(tenantId)
    return
  }

  await db.tenantServiceCategories.update(categoryId, {
    name: clean,
    ...(isActive === undefined ? {} : { isActive }),
  })
}

export async function deleteTenantCategory(tenantId: string, categoryId: string): Promise<void> {
  requireOnlineConfiguration()
  if (isSupabaseConfigured) {
    const { data, error } = await getSupabaseClient()
      .from('tenant_service_categories')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Catégorie introuvable ou non supprimable.')
    await refreshConfiguration(tenantId)
    return
  }
  // La suppression détache les prestations liées (FK `on delete set null`).
  await db.transaction('rw', [db.tenantServiceCategories, db.tenantServices], async () => {
    await db.tenantServices.where('categoryId').equals(categoryId).modify({ categoryId: null })
    await db.tenantServiceCategories.delete(categoryId)
  })
}

// ---------------------------------------------------------------------------
// Prestations
// ---------------------------------------------------------------------------

function normalizeTenantServicePricing(
  billingUnit: TenantServiceBillingUnit,
  unitPrice: number | null,
  pricingMode: TenantServicePricingMode,
): { billingUnit: TenantServiceBillingUnit; unitPrice: number | null; pricingMode: TenantServicePricingMode } {
  const units: readonly TenantServiceBillingUnit[] = ['PIECE', 'PAIR', 'SET', 'KG', 'PACKAGE', 'FLAT']
  if (!units.includes(billingUnit)) {
    throw new Error('Unité de facturation invalide.')
  }
  if (!['FIXED', 'FROM', 'QUOTE'].includes(pricingMode)) {
    throw new Error('Mode de tarification invalide.')
  }
  if (unitPrice !== null && (!Number.isSafeInteger(unitPrice) || unitPrice < 1 || unitPrice > 10_000_000)) {
    throw new Error('Le tarif de référence doit être un montant entier entre 1 et 10 000 000 FCFA.')
  }
  if (pricingMode === 'QUOTE' && (billingUnit !== 'FLAT' || unitPrice !== null)) {
    throw new Error('Un devis est une prestation forfaitaire sans prix de référence.')
  }
  if (billingUnit === 'FLAT' && pricingMode !== 'QUOTE') {
    throw new Error('L’unité forfaitaire globale est réservée aux devis.')
  }
  if (billingUnit === 'PACKAGE' && pricingMode !== 'FIXED') {
    throw new Error('Un forfait poids utilise un tarif fixe défini par ses paliers.')
  }
  return { billingUnit, unitPrice, pricingMode }
}

function normalizeServiceOptions(
  options: TenantServiceOptions | undefined,
): {
  categoryId: string | null
  description: string | null
  durationMinutes: number | null
  isActive: boolean
} {
  const description = options?.description?.trim()
  const durationMinutes = options?.durationMinutes ?? null
  if (description !== undefined && description !== null && (description.length < 2 || description.length > 200)) {
    throw new Error('La description doit contenir entre 2 et 200 caractères.')
  }
  if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) {
    throw new Error('La durée indicative doit être un nombre de minutes entre 1 et 1440.')
  }
  return {
    categoryId: options?.categoryId ?? null,
    description: description || null,
    durationMinutes,
    isActive: options?.isActive ?? true,
  }
}

export async function createTenantService(
  tenantId: string,
  activityId: string,
  serviceName: string,
  billingUnit: TenantServiceBillingUnit = 'PIECE',
  unitPrice: number | null = null,
  options: TenantServiceOptions = {},
): Promise<void> {
  const clean = serviceName.trim()
  if (clean.length < 2 || clean.length > 80) throw new Error('Le nom de la prestation doit contenir entre 2 et 80 caractères.')
  const pricingMode = options.pricingMode ?? 'FIXED'
  const pricing = normalizeTenantServicePricing(billingUnit, unitPrice, pricingMode)
  const extras = normalizeServiceOptions(options)
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const { error } = await getSupabaseClient().from('tenant_services').insert({
      tenant_id: tenantId,
      activity_id: activityId,
      category_id: extras.categoryId,
      service_name: clean,
      billing_unit: pricing.billingUnit,
      pricing_mode: pricing.pricingMode,
      unit_price: pricing.unitPrice,
      description: extras.description,
      duration_minutes: extras.durationMinutes,
      is_active: extras.isActive,
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
    id: localId(),
    tenantId,
    activityId,
    activityName: activity.name,
    activityCode: null,
    categoryId: extras.categoryId,
    serviceName: clean,
    billingUnit: pricing.billingUnit,
    pricingMode: pricing.pricingMode,
    unitPrice: pricing.unitPrice,
    description: extras.description,
    durationMinutes: extras.durationMinutes,
    isActive: extras.isActive,
    sortOrder: services.length,
  })
}

export async function updateTenantService(
  tenantId: string,
  serviceId: string,
  activityId: string,
  serviceName: string,
  billingUnit: TenantServiceBillingUnit = 'PIECE',
  unitPrice: number | null = null,
  options: TenantServiceOptions = {},
): Promise<void> {
  const clean = serviceName.trim()
  if (clean.length < 2 || clean.length > 80) throw new Error('Le nom de la prestation doit contenir entre 2 et 80 caractères.')
  const pricingMode = options.pricingMode ?? 'FIXED'
  const pricing = normalizeTenantServicePricing(billingUnit, unitPrice, pricingMode)
  const extras = normalizeServiceOptions(options)
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const { data, error } = await getSupabaseClient()
      .from('tenant_services')
      .update({
        activity_id: activityId,
        category_id: extras.categoryId,
        service_name: clean,
        billing_unit: pricing.billingUnit,
        pricing_mode: pricing.pricingMode,
        unit_price: pricing.unitPrice,
        description: extras.description,
        duration_minutes: extras.durationMinutes,
        is_active: extras.isActive,
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
    activityId,
    activityName: activity.name,
    categoryId: extras.categoryId,
    serviceName: clean,
    billingUnit: pricing.billingUnit,
    pricingMode: pricing.pricingMode,
    unitPrice: pricing.unitPrice,
    description: extras.description,
    durationMinutes: extras.durationMinutes,
    isActive: extras.isActive,
  })
}

/**
 * Duplique une prestation (et ses paliers de poids) sous le nom
 * « <nom> (copie) ». Utilisé pour créer rapidement une variante tarifaire.
 */
export async function duplicateTenantService(
  tenantId: string,
  serviceId: string,
): Promise<void> {
  requireOnlineConfiguration()
  const configuration = isSupabaseConfigured && navigator.onLine
    ? await fetchTenantServiceConfiguration(tenantId)
    : await localConfiguration(tenantId)
  const source = configuration.services.find((service) => service.id === serviceId)
  if (!source) throw new Error('Prestation introuvable.')
  const copyName = `${source.serviceName} (copie)`.slice(0, 80)

  if (isSupabaseConfigured && navigator.onLine) {
    const supabase = getSupabaseClient()
    const { data: created, error } = await supabase
      .from('tenant_services')
      .insert({
        tenant_id: tenantId,
        activity_id: source.activityId,
        category_id: source.categoryId,
        service_name: copyName,
        billing_unit: source.billingUnit,
        pricing_mode: source.pricingMode,
        unit_price: source.unitPrice,
        description: source.description,
        duration_minutes: source.durationMinutes,
        is_active: source.isActive,
      })
      .select('id')
      .single()
    if (error) throw error
    const tiers = configuration.tiers.filter((tier) => tier.tenantServiceId === serviceId)
    if (tiers.length > 0 && created) {
      const { error: tierError } = await supabase.from('tenant_weight_tiers').insert(
        tiers.map((tier, index) => ({
          tenant_id: tenantId,
          tenant_service_id: created.id,
          label: tier.label,
          weight_kg: tier.weightKg,
          price_fcfa: tier.priceFcfa,
          sort_order: index,
        })),
      )
      if (tierError) throw tierError
    }
    await refreshConfiguration(tenantId)
    return
  }

  const newId = localId()
  await db.transaction('rw', [db.tenantServices, db.weightTiers], async () => {
    const siblings = await db.tenantServices.where('activityId').equals(source.activityId).toArray()
    await db.tenantServices.add({
      id: newId,
      tenantId,
      activityId: source.activityId,
      activityName: source.activityName,
      activityCode: null,
      categoryId: source.categoryId,
      serviceName: copyName,
      billingUnit: source.billingUnit,
      pricingMode: source.pricingMode,
      unitPrice: source.unitPrice,
      description: source.description,
      durationMinutes: source.durationMinutes,
      isActive: source.isActive,
      sortOrder: siblings.length,
    })
    const tiers = await db.weightTiers.where('tenantServiceId').equals(serviceId).toArray()
    for (const [index, tier] of tiers.entries()) {
      await db.weightTiers.add({
        id: localId(),
        tenantId,
        tenantServiceId: newId,
        label: tier.label,
        weightKg: tier.weightKg,
        priceFcfa: tier.priceFcfa,
        isActive: tier.isActive,
        sortOrder: index,
      })
    }
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
  await db.transaction('rw', [db.tenantServices, db.weightTiers], async () => {
    await db.weightTiers.where('tenantServiceId').equals(serviceId).delete()
    await db.tenantServices.delete(serviceId)
  })
}

// ---------------------------------------------------------------------------
// Paliers de poids des forfaits (migration 027)
// ---------------------------------------------------------------------------

function normalizeTier(
  label: string,
  weightKg: number,
  priceFcfa: number,
): { label: string; weightKg: number; priceFcfa: number } {
  const clean = label.trim()
  if (clean.length < 1 || clean.length > 40) throw new Error('Le libellé du palier doit contenir entre 1 et 40 caractères.')
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 10_000) {
    throw new Error('Le poids du palier doit être supérieur à zéro.')
  }
  if (!Number.isSafeInteger(priceFcfa) || priceFcfa < 1 || priceFcfa > 10_000_000) {
    throw new Error('Le prix du palier doit être un entier entre 1 et 10 000 000 FCFA.')
  }
  return { label: clean, weightKg: Number(weightKg.toFixed(2)), priceFcfa }
}

export async function createWeightTier(
  tenantId: string,
  tenantServiceId: string,
  label: string,
  weightKg: number,
  priceFcfa: number,
): Promise<void> {
  const tier = normalizeTier(label, weightKg, priceFcfa)
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const { error } = await getSupabaseClient().from('tenant_weight_tiers').insert({
      tenant_id: tenantId,
      tenant_service_id: tenantServiceId,
      label: tier.label,
      weight_kg: tier.weightKg,
      price_fcfa: tier.priceFcfa,
    })
    if (error) throw error
    await refreshConfiguration(tenantId)
    return
  }

  const service = await db.tenantServices.get(tenantServiceId)
  if (!service || service.tenantId !== tenantId) throw new Error('Prestation introuvable.')
  if (service.billingUnit !== 'PACKAGE') {
    throw new Error('Un palier de poids ne se rattache qu’à une prestation en forfait poids.')
  }
  const existing = await db.weightTiers.where('tenantServiceId').equals(tenantServiceId).toArray()
  if (existing.some((row) => row.weightKg === tier.weightKg)) {
    throw new Error('Un palier existe déjà pour ce poids.')
  }
  await db.weightTiers.add({
    id: localId(),
    tenantId,
    tenantServiceId,
    label: tier.label,
    weightKg: tier.weightKg,
    priceFcfa: tier.priceFcfa,
    isActive: true,
    sortOrder: existing.length,
  })
}

export async function updateWeightTier(
  tenantId: string,
  tierId: string,
  label: string,
  weightKg: number,
  priceFcfa: number,
  isActive?: boolean,
): Promise<void> {
  const tier = normalizeTier(label, weightKg, priceFcfa)
  requireOnlineConfiguration()

  if (isSupabaseConfigured) {
    const patch: {
      label: string
      weight_kg: number
      price_fcfa: number
      is_active?: boolean
    } = {
      label: tier.label,
      weight_kg: tier.weightKg,
      price_fcfa: tier.priceFcfa,
    }
    if (isActive !== undefined) patch.is_active = isActive
    const { data, error } = await getSupabaseClient()
      .from('tenant_weight_tiers')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', tierId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Palier introuvable ou non modifiable.')
    await refreshConfiguration(tenantId)
    return
  }

  await db.weightTiers.update(tierId, {
    label: tier.label,
    weightKg: tier.weightKg,
    priceFcfa: tier.priceFcfa,
    ...(isActive === undefined ? {} : { isActive }),
  })
}

export async function deleteWeightTier(tenantId: string, tierId: string): Promise<void> {
  requireOnlineConfiguration()
  if (isSupabaseConfigured) {
    const { data, error } = await getSupabaseClient()
      .from('tenant_weight_tiers')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', tierId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Palier introuvable ou non supprimable.')
    await refreshConfiguration(tenantId)
    return
  }
  await db.weightTiers.delete(tierId)
}

// ---------------------------------------------------------------------------
// Import d'une grille tarifaire suggérée (action explicite du propriétaire)
// ---------------------------------------------------------------------------

export interface CatalogImportSummary {
  activitiesCreated: number
  categoriesCreated: number
  servicesCreated: number
  tiersCreated: number
  skipped: number
}

/**
 * Importe une grille type en ne créant que les éléments absents (même nom,
 * casse et espaces ignorés). Idempotent : un second import ne crée rien.
 */
export async function importSuggestedCatalog(
  tenantId: string,
  suggestion: import('@/constants/laundryCatalogSuggestions').SuggestedCatalog,
): Promise<CatalogImportSummary> {
  requireOnlineConfiguration()
  const current = isSupabaseConfigured && navigator.onLine
    ? await fetchTenantServiceConfiguration(tenantId)
    : await localConfiguration(tenantId)

  const sameName = (a: string, b: string): boolean =>
    a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

  const summary: CatalogImportSummary = {
    activitiesCreated: 0,
    categoriesCreated: 0,
    servicesCreated: 0,
    tiersCreated: 0,
    skipped: 0,
  }

  // Activités manquantes.
  const activities = [...current.activities]
  for (const suggestionActivity of suggestion.activities) {
    if (activities.some((activity) => sameName(activity.name, suggestionActivity.name))) continue
    if (isSupabaseConfigured && navigator.onLine) {
      const { error } = await getSupabaseClient().from('tenant_activities').insert({
        tenant_id: tenantId,
        name: suggestionActivity.name.trim(),
      })
      if (error) throw error
    } else {
      await db.tenantActivities.add({
        id: localId(),
        tenantId,
        name: suggestionActivity.name.trim(),
        sortOrder: activities.length,
      })
    }
    activities.push({
      id: localId(),
      tenantId,
      name: suggestionActivity.name.trim(),
      sortOrder: activities.length,
    })
    summary.activitiesCreated += 1
  }

  // Recharger les identifiants réels en ligne après les créations d'activités.
  const refreshed = isSupabaseConfigured && navigator.onLine
    ? await fetchTenantServiceConfiguration(tenantId)
    : await localConfiguration(tenantId)
  const findActivity = (name: string) =>
    refreshed.activities.find((activity) => sameName(activity.name, name))

  // Catégories manquantes, groupées par activité.
  for (const suggestedCategory of suggestion.categories) {
    const activity = findActivity(suggestedCategory.activityName)
    if (!activity) continue
    const exists = refreshed.categories.some(
      (category) => category.activityId === activity.id && sameName(category.name, suggestedCategory.name),
    )
    if (exists) continue
    if (isSupabaseConfigured && navigator.onLine) {
      const { error } = await getSupabaseClient().from('tenant_service_categories').insert({
        tenant_id: tenantId,
        activity_id: activity.id,
        name: suggestedCategory.name.trim(),
      })
      if (error) throw error
    } else {
      const existing = await db.tenantServiceCategories.where('activityId').equals(activity.id).toArray()
      await db.tenantServiceCategories.add({
        id: localId(),
        tenantId,
        activityId: activity.id,
        name: suggestedCategory.name.trim(),
        sortOrder: existing.length,
        isActive: true,
      })
    }
    summary.categoriesCreated += 1
  }

  const withCategories = isSupabaseConfigured && navigator.onLine
    ? await fetchTenantServiceConfiguration(tenantId)
    : await localConfiguration(tenantId)
  const findCategory = (activityName: string, categoryName: string) =>
    withCategories.categories.find(
      (category) =>
        sameName(
          withCategories.activities.find((activity) => activity.id === category.activityId)?.name ?? '',
          activityName,
        ) && sameName(category.name, categoryName),
    )

  // Prestations manquantes, puis leurs paliers pour les forfaits poids.
  for (const suggestedService of suggestion.services) {
    const activity = withCategories.activities.find(
      (entry) => sameName(entry.name, suggestedService.activityName),
    )
    if (!activity) continue
    const exists = withCategories.services.some(
      (service) => service.activityId === activity.id && sameName(service.serviceName, suggestedService.serviceName),
    )
    if (exists) {
      summary.skipped += 1
      continue
    }
    const category = findCategory(suggestedService.activityName, suggestedService.categoryName)
    if (isSupabaseConfigured && navigator.onLine) {
      const { data: inserted, error } = await getSupabaseClient()
        .from('tenant_services')
        .insert({
          tenant_id: tenantId,
          activity_id: activity.id,
          category_id: category?.id ?? null,
          service_name: suggestedService.serviceName.trim(),
          billing_unit: suggestedService.billingUnit,
          pricing_mode: suggestedService.pricingMode,
          unit_price: suggestedService.unitPrice,
        })
        .select('id')
        .single()
      if (error) throw error
      if (suggestedService.tiers.length > 0 && inserted) {
        const { error: tierError } = await getSupabaseClient()
          .from('tenant_weight_tiers')
          .insert(
            suggestedService.tiers.map((tier, index) => ({
              tenant_id: tenantId,
              tenant_service_id: inserted.id,
              label: tier.label,
              weight_kg: tier.weightKg,
              price_fcfa: tier.priceFcfa,
              sort_order: index,
            })),
          )
        if (tierError) throw tierError
        summary.tiersCreated += suggestedService.tiers.length
      }
    } else {
      const existingServices = await db.tenantServices.where('activityId').equals(activity.id).toArray()
      const serviceId = localId()
      await db.tenantServices.add({
        id: serviceId,
        tenantId,
        activityId: activity.id,
        activityName: activity.name,
        activityCode: null,
        categoryId: category?.id ?? null,
        serviceName: suggestedService.serviceName.trim(),
        billingUnit: suggestedService.billingUnit,
        pricingMode: suggestedService.pricingMode,
        unitPrice: suggestedService.unitPrice,
        description: null,
        durationMinutes: null,
        isActive: true,
        sortOrder: existingServices.length,
      })
      for (const [index, tier] of suggestedService.tiers.entries()) {
        await db.weightTiers.add({
          id: localId(),
          tenantId,
          tenantServiceId: serviceId,
          label: tier.label,
          weightKg: tier.weightKg,
          priceFcfa: tier.priceFcfa,
          isActive: true,
          sortOrder: index,
        })
        summary.tiersCreated += 1
      }
    }
    summary.servicesCreated += 1
  }

  await refreshConfiguration(tenantId)
  return summary
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
