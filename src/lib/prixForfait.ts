import type { OverflowPolicy } from '@/types/database'

/**
 * Tarification d'un forfait au nombre de vêtements — miroir client de
 * `compute_package_price` (migration 030).
 *
 * Le prix ne dépend jamais de la répartition entre articles : l'écran de
 * comptage additionne toutes les quantités admissibles, puis ce module
 * applique uniquement le prix du forfait, son nombre inclus et sa politique
 * de dépassement. Le serveur recalcule le même résultat à la synchronisation.
 */

export type PolitiqueDepassement = OverflowPolicy

export interface ForfaitQuantite {
  prixXof: number
  /** `null` = ancien forfait global, sans comptage tarifaire. */
  inclus: number | null
  politique: PolitiqueDepassement
  prixSupplementXof: number | null
}

export interface DevisForfait {
  vetements: number
  inclus: number | null
  /** Nombre de vêtements au-delà du forfait initial. */
  supplement: number
  politique: PolitiqueDepassement
  prixSupplementXof: number | null
  /** Nombre de forfaits appliqués (`REPEAT_PACKAGE`). */
  nombreForfaits: number
  /** `null` uniquement lorsque `manuelRequis` est vrai. */
  montant: number | null
  manuelRequis: boolean
}

const MONTANT_MAX = 10_000_000
const POLITIQUES: readonly PolitiqueDepassement[] = [
  'PER_EXTRA_ITEM',
  'REPEAT_PACKAGE',
  'REJECT_OVER_LIMIT',
  'MANUAL_QUOTE',
]

function montantValide(valeur: number): boolean {
  return Number.isInteger(valeur) && valeur >= 1 && valeur <= MONTANT_MAX
}

/**
 * Valide la configuration d'un forfait quantité avant son enregistrement ou
 * sa vente. Retourne un message français, ou `null` si le forfait est vendable.
 */
export function problemeForfait(forfait: ForfaitQuantite): string | null {
  if (!montantValide(forfait.prixXof)) {
    return 'Le prix du forfait doit être un montant positif en FCFA.'
  }
  if (!POLITIQUES.includes(forfait.politique)) {
    return 'Choisissez ce qui se passe lorsque le nombre inclus est dépassé.'
  }
  if (
    forfait.inclus !== null &&
    (!Number.isInteger(forfait.inclus) || forfait.inclus < 1 || forfait.inclus > 10_000)
  ) {
    return 'Le nombre de vêtements inclus doit être un entier entre 1 et 10 000.'
  }
  if (forfait.prixSupplementXof !== null && !montantValide(forfait.prixSupplementXof)) {
    return 'Le prix du vêtement supplémentaire doit être un montant positif en FCFA.'
  }
  if (
    forfait.inclus !== null &&
    forfait.politique === 'PER_EXTRA_ITEM' &&
    forfait.prixSupplementXof === null
  ) {
    return 'Indiquez le prix de chaque vêtement supplémentaire.'
  }
  return null
}

/**
 * Calcule le devis d'un forfait, ou `null` si le comptage/configuration est
 * invalide ou si la politique refuse ce dépassement.
 */
export function calculerPrixForfait(
  forfait: ForfaitQuantite,
  vetements: number,
  montantManuel?: number | null,
): DevisForfait | null {
  if (problemeForfait(forfait) !== null) return null
  if (!Number.isFinite(vetements) || !Number.isInteger(vetements) || vetements <= 0) return null

  const base: Omit<DevisForfait, 'montant' | 'manuelRequis'> = {
    vetements,
    inclus: forfait.inclus,
    supplement:
      forfait.inclus === null ? 0 : Math.max(0, vetements - forfait.inclus),
    politique: forfait.politique,
    prixSupplementXof: forfait.prixSupplementXof,
    nombreForfaits: 1,
  }

  if (forfait.inclus === null) {
    return { ...base, montant: forfait.prixXof, manuelRequis: false }
  }

  let montant: number
  switch (forfait.politique) {
    case 'PER_EXTRA_ITEM': {
      if (base.supplement > 0 && forfait.prixSupplementXof === null) return null
      montant = forfait.prixXof + base.supplement * (forfait.prixSupplementXof ?? 0)
      break
    }
    case 'REPEAT_PACKAGE': {
      base.nombreForfaits = Math.ceil(vetements / forfait.inclus)
      montant = forfait.prixXof * base.nombreForfaits
      break
    }
    case 'REJECT_OVER_LIMIT': {
      if (base.supplement > 0) return null
      montant = forfait.prixXof
      break
    }
    case 'MANUAL_QUOTE': {
      if (base.supplement === 0) {
        montant = forfait.prixXof
        break
      }
      if (montantManuel == null) {
        return { ...base, montant: null, manuelRequis: true }
      }
      if (!montantValide(montantManuel)) return null
      montant = montantManuel
      break
    }
    default:
      return null
  }

  if (!montantValide(montant)) return null
  return { ...base, montant, manuelRequis: false }
}

/** Résumé lisible figé sur la ligne porteuse (`conditions_snapshot`). */
export function formaterDetailForfait(devis: DevisForfait): string {
  const compte = `${devis.vetements} vêtement(s) compté(s)`
  if (devis.inclus === null) return `${compte} — forfait global`
  if (devis.supplement === 0) return `${compte} — ${devis.inclus} inclus`

  switch (devis.politique) {
    case 'PER_EXTRA_ITEM':
      return `${compte} — ${devis.inclus} inclus + ${devis.supplement} × ${devis.prixSupplementXof ?? 0} FCFA`
    case 'REPEAT_PACKAGE':
      return `${compte} — ${devis.nombreForfaits} forfait(s) de ${devis.inclus} vêtements`
    case 'MANUAL_QUOTE':
      return `${compte} — ${devis.inclus} inclus + ${devis.supplement} supplémentaire(s), montant validé au comptoir`
    default:
      return `${compte} — ${devis.inclus} inclus + ${devis.supplement} supplémentaire(s)`
  }
}
