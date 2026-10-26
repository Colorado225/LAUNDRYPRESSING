import { db, type LocalCommercialPackage } from '@/db/localDb'
import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { codeDepuisNom } from '@/lib/catalogue'
import { problemeForfait } from '@/lib/prixForfait'
import type { OverflowPolicy } from '@/types/database'

/**
 * Modèles de blanchisserie et forfaits commerciaux (migrations 029 et 030).
 *
 * Les modèles restent une configuration en ligne. Les forfaits, eux, sont
 * vendables au comptoir : Supabase fait foi en ligne, Dexie conserve la
 * dernière version pour l'écran de comptage et les corrections hors ligne.
 * Le serveur recalcule toujours le prix à la synchronisation.
 */

export interface ModeleBlanchisserie {
  id: string
  tenantId: string | null
  code: string
  name: string
  description: string | null
  kind: 'system_template' | 'custom'
  isDefault: boolean
  isActive: boolean
  nbArticles: number
}

export interface ForfaitCommercial {
  id: string
  tenantId: string
  code: string
  name: string
  description: string | null
  priceXof: number
  tenantServiceId: string | null
  /** `null` = ancien forfait global ; sinon nombre de vêtements inclus. */
  garmentsIncluded: number | null
  overflowPolicy: OverflowPolicy
  overflowUnitPriceXof: number | null
  isActive: boolean
  items: Array<{ garmentTypeId: string | null; label: string | null; quantity: number }>
}

async function forfaitsLocaux(tenantId: string): Promise<ForfaitCommercial[]> {
  const forfaits = await db.catalogPackages.where('tenantId').equals(tenantId).toArray()
  return forfaits.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

function requireOnline(): void {
  if (!isSupabaseConfigured) {
    throw new Error('Les modèles et forfaits nécessitent un projet Supabase configuré.')
  }
  if (!navigator.onLine) {
    throw new Error('Cette opération nécessite une connexion internet.')
  }
}

export async function fetchModeles(): Promise<ModeleBlanchisserie[]> {
  if (!isSupabaseConfigured || !navigator.onLine) return []
  const supabase = getSupabaseClient()
  const [profils, items] = await Promise.all([
    supabase
      .from('laundry_profiles')
      .select('id, tenant_id, code, name, description, profile_kind, is_default, is_active')
      .order('name'),
    supabase.from('laundry_profile_items').select('profile_id, garment_code'),
  ])
  if (profils.error) throw profils.error
  if (items.error) throw items.error
  const compteurs = new Map<string, number>()
  for (const item of items.data ?? []) {
    if (item.garment_code) {
      compteurs.set(item.profile_id, (compteurs.get(item.profile_id) ?? 0) + 1)
    }
  }
  return (profils.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    kind: row.profile_kind,
    isDefault: row.is_default,
    isActive: row.is_active,
    nbArticles: compteurs.get(row.id) ?? 0,
  }))
}

/** Copie indépendante d'un modèle (gabarit système ou modèle du pressing). */
export async function dupliquerModele(profileId: string, name?: string): Promise<void> {
  requireOnline()
  const supabase = getSupabaseClient()
  const { error } = await supabase.rpc('duplicate_laundry_profile', {
    p_profile: profileId,
    ...(name ? { p_name: name } : {}),
  })
  if (error) throw error
}

export async function creerModele(tenantId: string, name: string, description: string): Promise<void> {
  requireOnline()
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('laundry_profiles').insert({
    tenant_id: tenantId,
    code: codeDepuisNom(name),
    name: name.trim(),
    description: description.trim() || null,
    profile_kind: 'custom',
  })
  if (error) throw error
}

export async function setModeleActif(profileId: string, tenantId: string, isActive: boolean): Promise<void> {
  requireOnline()
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('laundry_profiles')
    .update({ is_active: isActive, archived_at: isActive ? null : new Date().toISOString() })
    .eq('id', profileId)
    .eq('tenant_id', tenantId)
  if (error) throw error
}

export async function fetchForfaits(tenantId: string): Promise<ForfaitCommercial[]> {
  if (!isSupabaseConfigured || !navigator.onLine) return forfaitsLocaux(tenantId)
  const supabase = getSupabaseClient()
  const [packs, items] = await Promise.all([
    supabase
      .from('commercial_packages')
      .select(
        'id, tenant_id, code, name, description, price_xof, tenant_service_id, garments_included, overflow_policy, overflow_unit_price_xof, is_active',
      )
      .eq('tenant_id', tenantId)
      .order('name'),
    supabase
      .from('commercial_package_items')
      .select('package_id, garment_type_id, label, quantity')
      .eq('tenant_id', tenantId)
      .order('sort_order'),
  ])
  if (packs.error) throw packs.error
  if (items.error) throw items.error
  const parForfait = new Map<string, ForfaitCommercial['items']>()
  for (const item of items.data ?? []) {
    const liste = parForfait.get(item.package_id) ?? []
    liste.push({
      garmentTypeId: item.garment_type_id,
      label: item.label,
      quantity: item.quantity,
    })
    parForfait.set(item.package_id, liste)
  }
  const forfaits: LocalCommercialPackage[] = (packs.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceXof: row.price_xof,
    tenantServiceId: row.tenant_service_id,
    garmentsIncluded: row.garments_included,
    overflowPolicy: row.overflow_policy,
    overflowUnitPriceXof: row.overflow_unit_price_xof,
    isActive: row.is_active,
    items: parForfait.get(row.id) ?? [],
  }))

  await db.transaction('rw', db.catalogPackages, async () => {
    await db.catalogPackages.where('tenantId').equals(tenantId).delete()
    if (forfaits.length > 0) await db.catalogPackages.bulkAdd(forfaits)
  })
  return forfaits
}

export async function creerForfait(
  tenantId: string,
  input: {
    name: string
    description: string
    priceXof: number
    tenantServiceId?: string | null
    garmentsIncluded?: number | null
    overflowPolicy?: OverflowPolicy
    overflowUnitPriceXof?: number | null
    items: Array<{ garmentTypeId: string; garmentName: string; quantity: number }>
  },
): Promise<void> {
  requireOnline()
  const forfaitQuantite = {
    prixXof: input.priceXof,
    inclus: input.garmentsIncluded ?? null,
    politique: input.overflowPolicy ?? 'PER_EXTRA_ITEM',
    prixSupplementXof: input.overflowUnitPriceXof ?? null,
  } as const
  const probleme = problemeForfait(forfaitQuantite)
  if (probleme) throw new Error(probleme)
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('commercial_packages')
    .insert({
      tenant_id: tenantId,
      code: codeDepuisNom(input.name),
      name: input.name.trim(),
      description: input.description.trim() || null,
      price_xof: input.priceXof,
      tenant_service_id: input.tenantServiceId ?? null,
      garments_included: forfaitQuantite.inclus,
      overflow_policy: forfaitQuantite.politique,
      overflow_unit_price_xof: forfaitQuantite.prixSupplementXof,
    })
    .select('id')
    .single()
  if (error) throw error
  if (input.items.length > 0) {
    const { error: itemsError } = await supabase.from('commercial_package_items').insert(
      input.items.map((item, index) => ({
        tenant_id: tenantId,
        package_id: data.id,
        garment_type_id: item.garmentTypeId,
        label: item.garmentName,
        quantity: item.quantity,
        sort_order: index * 10,
      })),
    )
    if (itemsError) throw itemsError
  }
  await fetchForfaits(tenantId)
}

export async function setForfaitActif(packageId: string, tenantId: string, isActive: boolean): Promise<void> {
  requireOnline()
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('commercial_packages')
    .update({ is_active: isActive, archived_at: isActive ? null : new Date().toISOString() })
    .eq('id', packageId)
    .eq('tenant_id', tenantId)
  if (error) throw error
  await fetchForfaits(tenantId)
}
