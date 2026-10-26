/**
 * Tarification au kilo par tranches — miroir client de `compute_weight_price`
 * (migration 028). Le serveur reste la source de vérité : il recalcule chaque
 * ligne au kilo et refuse tout total différent sans motif de dérogation.
 *
 * Deux modes (spec §7) :
 *  - `flat_rate` : le poids facturé désigne UNE tranche, appliquée à tout le
 *    poids (12 kg dans la tranche ≥ 10 kg à 600 FCFA → 7 200 FCFA) ;
 *  - `progressive_tiers` : chaque tranche est facturée à son tarif
 *    (5×700 + 5×600 + 2×500 = 7 500 FCFA pour 12 kg).
 */

export type ModeRegleKilo = 'flat_rate' | 'progressive_tiers'
export type ArrondiKilo = 'ceil' | 'nearest' | 'exact'

export interface RegleKilo {
  mode: ModeRegleKilo
  minBillableKg: number
  stepKg: number
  rounding: ArrondiKilo
}

export interface TrancheKilo {
  minKg: number
  maxKg: number | null
  prixParKg: number
}

export interface DetailTranche {
  deKg: number
  aKg: number | null
  kg: number
  prixParKg: number
  sousTotal: number
}

export interface DevisKilo {
  poidsPeseKg: number
  poidsFactureKg: number
  montant: number
  detail: DetailTranche[]
}

const EPSILON = 1e-9

/** Arrondit à 3 décimales (précision du dépôt) en évitant les poussières flottantes. */
function a3Decimales(valeur: number): number {
  return Math.round(valeur * 1000) / 1000
}

/** Poids effectivement facturé après pas de pesée et minimum facturable. */
export function poidsFacture(regle: RegleKilo, poids: number): number {
  let facture: number
  switch (regle.rounding) {
    case 'ceil':
      facture = Math.ceil(poids / regle.stepKg - EPSILON) * regle.stepKg
      break
    case 'nearest':
      facture = Math.round(poids / regle.stepKg) * regle.stepKg
      break
    default:
      facture = poids
  }
  return a3Decimales(Math.max(facture, regle.minBillableKg))
}

/**
 * Calcule le devis au kilo, ou `null` si le poids est invalide ou si aucune
 * tranche ne couvre le poids facturé (le comptoir doit alors corriger la règle).
 */
export function calculerPrixKilo(
  regle: RegleKilo,
  tranches: readonly TrancheKilo[],
  poids: number,
): DevisKilo | null {
  if (!Number.isFinite(poids) || poids <= 0) return null
  const facture = poidsFacture(regle, poids)
  const triees = [...tranches].sort((a, b) => a.minKg - b.minKg)

  if (regle.mode === 'flat_rate') {
    const tranche = [...triees]
      .reverse()
      .find((t) => facture >= t.minKg && (t.maxKg === null || facture < t.maxKg))
    if (!tranche) return null
    const montant = Math.round(facture * tranche.prixParKg)
    return {
      poidsPeseKg: poids,
      poidsFactureKg: facture,
      montant,
      detail: [
        {
          deKg: tranche.minKg,
          aKg: tranche.maxKg,
          kg: facture,
          prixParKg: tranche.prixParKg,
          sousTotal: montant,
        },
      ],
    }
  }

  const detail: DetailTranche[] = []
  let montant = 0
  for (const tranche of triees) {
    if (facture <= tranche.minKg) continue
    const borne = tranche.maxKg ?? facture
    const segment = a3Decimales(Math.min(facture, borne) - tranche.minKg)
    if (segment <= 0) continue
    const sousTotal = Math.round(segment * tranche.prixParKg)
    montant += segment * tranche.prixParKg
    detail.push({
      deKg: tranche.minKg,
      aKg: tranche.maxKg,
      kg: segment,
      prixParKg: tranche.prixParKg,
      sousTotal,
    })
  }
  if (detail.length === 0) return null
  return { poidsPeseKg: poids, poidsFactureKg: facture, montant: Math.round(montant), detail }
}

/**
 * Valide un jeu de tranches avant enregistrement (miroir de la garde serveur).
 * Retourne un message français ou `null` si le jeu est cohérent.
 */
export function problemeTranches(tranches: readonly TrancheKilo[]): string | null {
  if (tranches.length === 0) return 'Ajoutez au moins une tranche de poids.'
  const triees = [...tranches].sort((a, b) => a.minKg - b.minKg)
  for (const tranche of triees) {
    if (!Number.isFinite(tranche.minKg) || tranche.minKg < 0) {
      return 'Le début de tranche doit être un poids positif ou nul.'
    }
    if (tranche.maxKg !== null && tranche.maxKg <= tranche.minKg) {
      return 'La fin de tranche doit dépasser son début.'
    }
    if (!Number.isInteger(tranche.prixParKg) || tranche.prixParKg <= 0) {
      return 'Chaque tranche exige un tarif au kilo positif en FCFA.'
    }
  }
  for (let i = 1; i < triees.length; i += 1) {
    const precedente = triees[i - 1]!
    const courante = triees[i]!
    if (precedente.maxKg === null || courante.minKg < precedente.maxKg) {
      return 'Les tranches se chevauchent : chaque poids doit appartenir à une seule tranche.'
    }
  }
  if (triees[0]!.minKg !== 0) {
    return 'La première tranche doit commencer à 0 kg pour couvrir les petits poids.'
  }
  return null
}

/** Résumé lisible figé sur la ligne (reçu, historique) : « 5 kg × 700 + 2 kg × 500 ». */
export function formaterDetailKilo(devis: DevisKilo): string {
  const segments = devis.detail
    .map((d) => `${d.kg} kg × ${d.prixParKg}`)
    .join(' + ')
  return `${devis.poidsFactureKg} kg facturés — ${segments} FCFA/kg`
}
