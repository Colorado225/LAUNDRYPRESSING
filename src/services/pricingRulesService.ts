import { db, type LocalPricingRule } from '@/db/localDb'
import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { problemeTranches, type TrancheKilo } from '@/lib/prixKilo'

/**
 * Règles de tarification au kilo par tranches (migration 028).
 *
 * Supabase fait foi en ligne ; Dexie conserve la dernière version pour
 * tarifer hors ligne. Le serveur recalcule systématiquement (`compute
 * _weight_price`) : un cache périmé produit un refus explicite à l'envoi,
 * jamais un montant silencieusement faux.
 */

export interface RegleKiloSaisie {
  tenantServiceId: string
  ruleName: string
  ruleMode: 'flat_rate' | 'progressive_tiers'
  minBillableKg: number
  stepKg: number
  roundingMode: 'ceil' | 'nearest' | 'exact'
  tiers: TrancheKilo[]
}

async function reglesLocales(tenantId: string): Promise<LocalPricingRule[]> {
  return db.catalogPricingRules.where('tenantId').equals(tenantId).toArray()
}

export async function fetchPricingRules(tenantId: string): Promise<LocalPricingRule[]> {
  if (!isSupabaseConfigured || !navigator.onLine) return reglesLocales(tenantId)

  const supabase = getSupabaseClient()
  const [rulesResult, tiersResult] = await Promise.all([
    supabase
      .from('pricing_rules')
      .select(
        'id, tenant_id, tenant_service_id, rule_name, rule_mode, min_billable_kg, step_kg, rounding_mode, is_active',
      )
      .eq('tenant_id', tenantId),
    supabase
      .from('pricing_rule_tiers')
      .select('pricing_rule_id, min_kg, max_kg, price_per_kg_xof')
      .order('min_kg'),
  ])
  if (rulesResult.error) throw rulesResult.error
  if (tiersResult.error) throw tiersResult.error

  const tiersParRegle = new Map<string, LocalPricingRule['tiers']>()
  for (const tier of tiersResult.data ?? []) {
    const liste = tiersParRegle.get(tier.pricing_rule_id) ?? []
    liste.push({
      minKg: Number(tier.min_kg),
      maxKg: tier.max_kg === null ? null : Number(tier.max_kg),
      pricePerKgXof: tier.price_per_kg_xof,
    })
    tiersParRegle.set(tier.pricing_rule_id, liste)
  }

  const regles: LocalPricingRule[] = (rulesResult.data ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    tenantServiceId: row.tenant_service_id,
    ruleName: row.rule_name,
    ruleMode: row.rule_mode,
    minBillableKg: Number(row.min_billable_kg),
    stepKg: Number(row.step_kg),
    roundingMode: row.rounding_mode,
    isActive: row.is_active,
    tiers: tiersParRegle.get(row.id) ?? [],
  }))

  await db.transaction('rw', db.catalogPricingRules, async () => {
    await db.catalogPricingRules.where('tenantId').equals(tenantId).delete()
    if (regles.length > 0) await db.catalogPricingRules.bulkAdd(regles)
  })
  return regles
}

function requireOnlineConfiguration(): void {
  if (!isSupabaseConfigured) {
    throw new Error('Les règles au kilo nécessitent un projet Supabase configuré.')
  }
  if (!navigator.onLine) {
    throw new Error('La modification des règles nécessite une connexion internet.')
  }
}

/**
 * Crée ou remplace la règle active d'une prestation et ses tranches.
 * La validation des tranches est faite des deux côtés (client + garde SQL).
 */
export async function savePricingRule(tenantId: string, saisie: RegleKiloSaisie): Promise<void> {
  requireOnlineConfiguration()
  const probleme = problemeTranches(saisie.tiers)
  if (probleme) throw new Error(probleme)

  const supabase = getSupabaseClient()
  const { data: existante, error: lectureError } = await supabase
    .from('pricing_rules')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('tenant_service_id', saisie.tenantServiceId)
    .eq('is_active', true)
    .maybeSingle()
  if (lectureError) throw lectureError

  let ruleId = existante?.id
  const valeurs = {
    rule_name: saisie.ruleName.trim(),
    rule_mode: saisie.ruleMode,
    min_billable_kg: saisie.minBillableKg,
    step_kg: saisie.stepKg,
    rounding_mode: saisie.roundingMode,
    is_active: true,
  }
  if (ruleId) {
    const { error } = await supabase.from('pricing_rules').update(valeurs).eq('id', ruleId)
    if (error) throw error
  } else {
    const { data, error } = await supabase
      .from('pricing_rules')
      .insert({ tenant_id: tenantId, tenant_service_id: saisie.tenantServiceId, ...valeurs })
      .select('id')
      .single()
    if (error) throw error
    ruleId = data.id
  }

  const { error: purgeError } = await supabase
    .from('pricing_rule_tiers')
    .delete()
    .eq('pricing_rule_id', ruleId)
  if (purgeError) throw purgeError

  const { error: tiersError } = await supabase.from('pricing_rule_tiers').insert(
    saisie.tiers.map((tier) => ({
      pricing_rule_id: ruleId!,
      min_kg: tier.minKg,
      max_kg: tier.maxKg,
      price_per_kg_xof: tier.prixParKg,
    })),
  )
  if (tiersError) throw tiersError

  await fetchPricingRules(tenantId)
}

/** Désactive la règle active d'une prestation (retour au tarif/kg libre de 023). */
export async function disablePricingRule(tenantId: string, ruleId: string): Promise<void> {
  requireOnlineConfiguration()
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('pricing_rules')
    .update({ is_active: false })
    .eq('id', ruleId)
    .eq('tenant_id', tenantId)
  if (error) throw error
  await fetchPricingRules(tenantId)
}
