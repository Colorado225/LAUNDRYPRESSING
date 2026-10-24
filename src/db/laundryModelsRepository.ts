import { db, type LocalLaundryModel } from '@/db/localDb'
import { getSupabaseClient } from '@/lib/supabaseClient'
import type {
  LaundryModelAudience,
  LaundryModelRow,
  LaundryModelServiceMode,
  LaundryModelType,
} from '@/types/database'

type LaundryModelInput = Omit<
  LaundryModelRow,
  'id' | 'tenant_id' | 'created_by' | 'created_at' | 'updated_at'
>

export interface LaundryModelServiceInput {
  service_id: string
  inclusion_mode: LaundryModelServiceMode
  sort_order: number
}

export interface LaundryModelServiceReference extends LaundryModelServiceInput {
  service_name: string
  service_active: boolean
}

export interface LaundryModelRecord extends LaundryModelRow {
  services: LaundryModelServiceReference[]
}

export type LaundryModelDraft = {
  id?: string
  name: string
  description: string | null
  model_type: LaundryModelType
  audience: LaundryModelAudience
  price_per_kg: number | null
  package_price: number | null
  included_weight_kg: number | null
  overage_price_per_kg: number | null
  minimum_weight_kg: number | null
  billing_increment_kg: number | null
  minimum_charge: number | null
  conditions: string | null
  exclusions: string | null
  pickup_delivery_terms: string | null
  turnaround_days: number | null
  is_active: boolean
  sort_order: number
}

function mapLocal(model: LaundryModelRecord, tenantId: string): LocalLaundryModel {
  return {
    id: model.id,
    tenantId,
    name: model.name,
    description: model.description,
    modelType: model.model_type,
    audience: model.audience,
    pricePerKg: model.price_per_kg,
    packagePrice: model.package_price,
    includedWeightKg: model.included_weight_kg,
    overagePricePerKg: model.overage_price_per_kg,
    minimumWeightKg: model.minimum_weight_kg,
    billingIncrementKg: model.billing_increment_kg,
    minimumCharge: model.minimum_charge,
    conditions: model.conditions,
    exclusions: model.exclusions,
    pickupDeliveryTerms: model.pickup_delivery_terms,
    turnaroundDays: model.turnaround_days,
    isActive: model.is_active,
    sortOrder: model.sort_order,
    services: model.services.map((service) => ({
      serviceId: service.service_id,
      serviceName: service.service_name,
      inclusionMode: service.inclusion_mode,
      sortOrder: service.sort_order,
      serviceActive: service.service_active,
    })),
  }
}

function errorMessage(error: { code?: string; message: string }): Error {
  if (error.code === '42501' || /row-level security|permission denied/i.test(error.message)) {
    return new Error('Seul le propriétaire peut gérer les modèles commerciaux.')
  }
  if (error.code === '23505') return new Error('Un modèle portant ce nom existe déjà dans ce pressing.')
  if (error.code === '23503') return new Error('Une prestation sélectionnée n’est plus disponible dans ce pressing.')
  if (/Failed to fetch|NetworkError/i.test(error.message)) {
    return new Error('Réseau indisponible : reconnectez-vous pour enregistrer un modèle commercial.')
  }
  return new Error(error.message)
}

export async function loadLaundryModels(tenantId: string): Promise<LaundryModelRecord[]> {
  const supabase = getSupabaseClient()
  const { data: models, error: modelsError } = await supabase
    .from('laundry_models')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('sort_order')
    .order('name')
  if (modelsError) throw errorMessage(modelsError)

  const ids = (models ?? []).map((model) => model.id)
  if (ids.length === 0) return []

  const { data: links, error: linksError } = await supabase
    .from('laundry_model_services')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('model_id', ids)
    .order('sort_order')
  if (linksError) throw errorMessage(linksError)

  const serviceIds = [...new Set((links ?? []).map((link) => link.service_id))]
  const serviceNames = new Map<string, { name: string; active: boolean }>()
  if (serviceIds.length > 0) {
    const { data: services, error: servicesError } = await supabase
      .from('catalog_services')
      .select('id, name, is_active')
      .eq('tenant_id', tenantId)
      .in('id', serviceIds)
    if (servicesError) throw errorMessage(servicesError)
    for (const service of services ?? []) {
      serviceNames.set(service.id, { name: service.name, active: service.is_active })
    }
  }

  return (models ?? []).map((model) => ({
    ...model,
    services: (links ?? [])
      .filter((link) => link.model_id === model.id)
      .map((link) => {
        const reference = serviceNames.get(link.service_id)
        return {
          service_id: link.service_id,
          inclusion_mode: link.inclusion_mode,
          sort_order: link.sort_order,
          service_name: reference?.name ?? 'Prestation archivée',
          service_active: reference?.active ?? false,
        }
      }),
  }))
}

export async function refreshLaundryModels(tenantId: string): Promise<LocalLaundryModel[]> {
  const models = await loadLaundryModels(tenantId)
  const localModels = models.map((model) => mapLocal(model, tenantId))
  await db.transaction('rw', db.laundryModels, async () => {
    await db.laundryModels.where('tenantId').equals(tenantId).delete()
    if (localModels.length > 0) await db.laundryModels.bulkPut(localModels)
  })
  return localModels
}

export async function getCachedLaundryModels(tenantId: string): Promise<LocalLaundryModel[]> {
  return db.laundryModels.where('tenantId').equals(tenantId).sortBy('sortOrder')
}

export async function saveLaundryModel(
  draft: LaundryModelDraft,
  services: LaundryModelServiceInput[],
): Promise<string> {
  const model = {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name,
    description: draft.description,
    model_type: draft.model_type,
    audience: draft.audience,
    price_per_kg: draft.price_per_kg,
    package_price: draft.package_price,
    included_weight_kg: draft.included_weight_kg,
    overage_price_per_kg: draft.overage_price_per_kg,
    minimum_weight_kg: draft.minimum_weight_kg,
    billing_increment_kg: draft.billing_increment_kg,
    minimum_charge: draft.minimum_charge,
    conditions: draft.conditions,
    exclusions: draft.exclusions,
    pickup_delivery_terms: draft.pickup_delivery_terms,
    turnaround_days: draft.turnaround_days,
    is_active: draft.is_active,
    sort_order: draft.sort_order,
  }
  const payloadServices = services.map((service) => ({
    service_id: service.service_id,
    inclusion_mode: service.inclusion_mode,
    sort_order: service.sort_order,
  }))
  const { data, error } = await getSupabaseClient().rpc('save_laundry_model', {
    p_model: model as unknown as import('@/types/database').Json,
    p_services: payloadServices as unknown as import('@/types/database').Json,
  })
  if (error) throw errorMessage(error)
  if (!data) throw new Error('Le modèle commercial n’a pas pu être enregistré.')
  return data
}

export type { LaundryModelInput }
