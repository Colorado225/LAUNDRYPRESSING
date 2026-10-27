import { db, type LocalCommercialPackage } from '@/db/localDb'
import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import {
  POLITIQUES_VENDABLES,
  type Forfait,
  type PolitiqueDepassement,
} from '@/lib/packagePricing'

/**
 * Forfaits commerciaux d'un pressing.
 *
 * Un forfait est un **prix global pour un nombre de vêtements** (« Pack 10
 * pièces, 5 000 FCFA »). Il vit dans `commercial_packages` (créé par la
 * migration 028) et reste modifiable par le propriétaire seul — la RLS le
 * garantit côté serveur, l'écran ne fait que refléter ce droit.
 *
 * Lecture : serveur quand il est joignable, cache IndexedDB sinon, pour que le
 * comptoir puisse vendre un forfait même sans réseau. Écriture : en ligne
 * uniquement, comme la configuration des prestations.
 */

export interface SaisieForfait {
  name: string
  description: string | null
  priceXof: number
  garmentsIncluded: number | null
  overflowPolicy: PolitiqueDepassement
  overflowUnitPriceXof: number | null
}

const BORNES = { prixMin: 1, prixMax: 10_000_000, piecesMax: 10_000 }

function requireOnline(): void {
  if (!isSupabaseConfigured) return
  if (!navigator.onLine) {
    throw new Error('La modification des forfaits nécessite une connexion internet.')
  }
}

function nombreEntier(valeur: unknown): boolean {
  return typeof valeur === 'number' && Number.isSafeInteger(valeur)
}

/**
 * Valide une saisie de forfait avant tout appel réseau.
 *
 * Les messages nomment le champ fautif : un refus silencieux au comptoir est
 * pire qu'un forfait absent.
 */
export function validerForfait(saisie: SaisieForfait): SaisieForfait {
  const name = saisie.name.trim()
  if (name.length < 2 || name.length > 80) {
    throw new Error('Le nom du forfait doit contenir entre 2 et 80 caractères.')
  }
  if (!nombreEntier(saisie.priceXof) || saisie.priceXof < BORNES.prixMin || saisie.priceXof > BORNES.prixMax) {
    throw new Error('Le prix du forfait doit être un montant entier entre 1 et 10 000 000 FCFA.')
  }
  const inclus = saisie.garmentsIncluded
  if (inclus !== null && (!nombreEntier(inclus) || inclus < 1 || inclus > BORNES.piecesMax)) {
    throw new Error('Le nombre de vêtements inclus doit être un entier entre 1 et 10 000.')
  }
  if (!POLITIQUES_VENDABLES.includes(saisie.overflowPolicy)) {
    throw new Error('Choisissez ce qui se passe au-delà du nombre de vêtements inclus.')
  }
  let depassement = saisie.overflowUnitPriceXof
  if (saisie.overflowPolicy === 'PER_EXTRA_ITEM') {
    if (depassement === null || !nombreEntier(depassement) || depassement < 1 || depassement > BORNES.prixMax) {
      throw new Error(
        'Indiquez le prix d’une pièce supplémentaire (entier entre 1 et 10 000 000 FCFA).',
      )
    }
  } else {
    // Un prix de dépassement n'a de sens qu'avec un supplément par pièce.
    depassement = null
  }
  return {
    name,
    description: saisie.description?.trim() ? saisie.description.trim() : null,
    priceXof: saisie.priceXof,
    garmentsIncluded: inclus,
    overflowPolicy: saisie.overflowPolicy,
    overflowUnitPriceXof: depassement,
  }
}

/**
 * Code technique d'un forfait, dérivé du nom et rendu unique.
 *
 * Le serveur impose `^[A-Z0-9_]{2,40}$` et l'unicité par pressing. Le
 * propriétaire ne saisit pas ce code : on le fabrique, on l'allonge d'un
 * suffixe en cas de collision, et on ne devine jamais un code déjà pris.
 */
export function codeDepuisNom(nom: string, existants: readonly string[]): string {
  const base =
    nom
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'FORFAIT'
  const pris = new Set(existants)
  if (!pris.has(base)) return base
  for (let suffixe = 2; suffixe < 1000; suffixe += 1) {
    const candidat = `${base.slice(0, 36)}_${suffixe}`
    if (!pris.has(candidat)) return candidat
  }
  throw new Error('Impossible de générer un code unique : renommez le forfait.')
}

function depuisLigne(row: Record<string, unknown>): Forfait {
  const inclus = row['garments_included']
  const depassement = row['overflow_unit_price_xof']
  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    code: String(row['code']),
    name: String(row['name']),
    description: (row['description'] as string | null) ?? null,
    priceXof: Number(row['price_xof']),
    garmentsIncluded: inclus === null || inclus === undefined ? null : Number(inclus),
    overflowPolicy: row['overflow_policy'] as PolitiqueDepassement,
    overflowUnitPriceXof:
      depassement === null || depassement === undefined ? null : Number(depassement),
    isActive: Boolean(row['is_active']),
    archivedAt: (row['archived_at'] as string | null) ?? null,
  }
}

function depuisCache(row: LocalCommercialPackage): Forfait {
  return { ...row }
}

const COLONNES =
  'id, tenant_id, code, name, description, price_xof, garments_included, overflow_policy, overflow_unit_price_xof, is_active, archived_at'

/** Forfaits du pressing, du serveur si possible, sinon du cache local. */
export async function fetchCommercialPackages(tenantId: string): Promise<Forfait[]> {
  if (!isSupabaseConfigured || !navigator.onLine) {
    const cache = await db.commercialPackages.where('tenantId').equals(tenantId).toArray()
    return cache.map(depuisCache).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }

  const { data, error } = await getSupabaseClient()
    .from('commercial_packages')
    .select(COLONNES)
    .eq('tenant_id', tenantId)
    .order('name')

  if (error) throw error
  const forfaits = (data ?? []).map(depuisLigne)

  // Le cache ne contient que ce que le serveur vient de renvoyer : un forfait
  // supprimé ou archivé ailleurs ne doit pas rester vendable hors ligne.
  await db.commercialPackages.where('tenantId').equals(tenantId).delete()
  if (forfaits.length > 0) {
    await db.commercialPackages.bulkAdd(
      forfaits.map((forfait) => ({ ...forfait })) as LocalCommercialPackage[],
    )
  }
  return forfaits
}

/** Forfaits actifs, dans l'ordre d'affichage du comptoir. */
export function forfaitsActifs(forfaits: readonly Forfait[]): Forfait[] {
  return forfaits.filter((forfait) => forfait.isActive && forfait.archivedAt === null)
}

async function apresEcriture(tenantId: string): Promise<void> {
  // Relecture immédiate : l'écran affiche l'état réel, jamais l'état supposé.
  await fetchCommercialPackages(tenantId)
}

export async function createCommercialPackage(
  tenantId: string,
  saisie: SaisieForfait,
): Promise<void> {
  const propre = validerForfait(saisie)
  requireOnline()

  const existants = await fetchCommercialPackages(tenantId)
  const code = codeDepuisNom(propre.name, existants.map((forfait) => forfait.code))

  const { error } = await getSupabaseClient().from('commercial_packages').insert({
    tenant_id: tenantId,
    code,
    name: propre.name,
    description: propre.description,
    price_xof: propre.priceXof,
    garments_included: propre.garmentsIncluded,
    overflow_policy: propre.overflowPolicy,
    overflow_unit_price_xof: propre.overflowUnitPriceXof,
  })
  if (error) throw error
  await apresEcriture(tenantId)
}

export async function updateCommercialPackage(
  tenantId: string,
  forfaitId: string,
  saisie: SaisieForfait,
): Promise<void> {
  const propre = validerForfait(saisie)
  requireOnline()

  const { data, error } = await getSupabaseClient()
    .from('commercial_packages')
    .update({
      name: propre.name,
      description: propre.description,
      price_xof: propre.priceXof,
      garments_included: propre.garmentsIncluded,
      overflow_policy: propre.overflowPolicy,
      overflow_unit_price_xof: propre.overflowUnitPriceXof,
    })
    .eq('tenant_id', tenantId)
    .eq('id', forfaitId)
    .select('id')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Ce forfait est introuvable ou vous ne pouvez pas le modifier.')
  await apresEcriture(tenantId)
}

/**
 * Retire un forfait de la vente **sans effacer son historique** : les lignes
 * de commande déjà enregistrées gardent leur référence (`on delete set null`
 * côté serveur, mais on n'efface pas). L'archivage est réversible en base.
 */
export async function archiveCommercialPackage(
  tenantId: string,
  forfaitId: string,
): Promise<void> {
  requireOnline()

  const { data, error } = await getSupabaseClient()
    .from('commercial_packages')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', forfaitId)
    .select('id')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Ce forfait est introuvable ou vous ne pouvez pas le retirer.')
  await apresEcriture(tenantId)
}
