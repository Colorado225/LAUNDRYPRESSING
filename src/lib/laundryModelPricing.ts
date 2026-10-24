import type { LaundryModelRow } from '@/types/database'

export type LaundryModelPriceResult =
  | {
      status: 'PRICED'
      actualWeightKg: number
      billedWeightKg: number
      extraWeightKg: number
      amount: number
      breakdown: string
    }
  | {
      status: 'QUOTE'
      actualWeightKg: number
      billedWeightKg: number
      extraWeightKg: number
      amount: null
      breakdown: string
    }

function ceilToIncrement(value: number, increment: number | null): number {
  if (!increment || increment <= 0) return value
  const units = Math.ceil(value / increment - 1e-10)
  return Number((units * increment).toFixed(3))
}

function validPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} doit être supérieur à zéro.`)
  }
}

/**
 * Calcule un montant de service au kilo ou au forfait, sans dépendre de l'UI.
 * Les montants sont des FCFA entiers ; le poids peut être saisi au millième de kg.
 */
export function calculateLaundryModelPrice(
  model: Pick<
    LaundryModelRow,
    | 'model_type'
    | 'price_per_kg'
    | 'package_price'
    | 'included_weight_kg'
    | 'overage_price_per_kg'
    | 'minimum_weight_kg'
    | 'billing_increment_kg'
    | 'minimum_charge'
  >,
  actualWeightKg: number,
): LaundryModelPriceResult {
  validPositive(actualWeightKg, 'Le poids')
  if (actualWeightKg > 10_000) throw new RangeError('Le poids ne peut pas dépasser 10 000 kg.')

  const increment = model.billing_increment_kg
  const minimumCharge = model.minimum_charge ?? 0

  if (model.model_type === 'FAMILY_PACKAGE') {
    throw new RangeError('Un forfait famille se calcule à partir de ses pièces, pas de son poids.')
  }

  if (model.model_type === 'PER_KG') {
    const price = model.price_per_kg
    if (price === null || price <= 0) throw new RangeError('Le prix au kilo doit être renseigné.')
    const minimumWeight = model.minimum_weight_kg ?? 0
    const billedWeightKg = ceilToIncrement(Math.max(actualWeightKg, minimumWeight), increment)
    const amount = Math.max(Math.round(billedWeightKg * price), minimumCharge)
    return {
      status: 'PRICED',
      actualWeightKg,
      billedWeightKg,
      extraWeightKg: 0,
      amount,
      breakdown: `${billedWeightKg} kg × ${price} FCFA/kg`,
    }
  }

  const packagePrice = model.package_price
  const includedWeight = model.included_weight_kg
  if (packagePrice === null || packagePrice <= 0) throw new RangeError('Le prix du forfait doit être renseigné.')
  if (includedWeight === null || includedWeight <= 0) {
    throw new RangeError('Le poids inclus dans le forfait doit être renseigné.')
  }

  const extraWeightKg = Math.max(0, actualWeightKg - includedWeight)
  const billedExtraWeightKg = ceilToIncrement(extraWeightKg, increment)
  const billedWeightKg = includedWeight + billedExtraWeightKg
  if (extraWeightKg > 0 && model.overage_price_per_kg === null) {
    return {
      status: 'QUOTE',
      actualWeightKg,
      billedWeightKg,
      extraWeightKg: billedExtraWeightKg,
      amount: null,
      breakdown: 'Le poids dépasse le forfait ; un tarif complémentaire doit être validé.',
    }
  }

  const extraAmount = billedExtraWeightKg * (model.overage_price_per_kg ?? 0)
  const amount = Math.max(Math.round(packagePrice + extraAmount), minimumCharge)
  return {
    status: 'PRICED',
    actualWeightKg,
    billedWeightKg,
    extraWeightKg: billedExtraWeightKg,
    amount,
    breakdown:
      billedExtraWeightKg > 0
        ? `${packagePrice} FCFA le forfait + ${billedExtraWeightKg} kg supplémentaire × ${model.overage_price_per_kg} FCFA/kg`
        : `${packagePrice} FCFA le forfait (jusqu'à ${includedWeight} kg)`,
  }
}
