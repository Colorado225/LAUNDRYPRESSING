import { describe, expect, it } from 'vitest'
import type { LaundryModelRow } from '@/types/database'
import { calculateLaundryModelPrice } from '@/lib/laundryModelPricing'

const base = {
  price_per_kg: 1_000,
  package_price: null,
  included_weight_kg: null,
  overage_price_per_kg: null,
  minimum_weight_kg: null,
  billing_increment_kg: 0.1,
  minimum_charge: null,
} satisfies Omit<
  LaundryModelRow,
  | 'id'
  | 'tenant_id'
  | 'name'
  | 'description'
  | 'model_type'
  | 'audience'
  | 'conditions'
  | 'exclusions'
  | 'pickup_delivery_terms'
  | 'turnaround_days'
  | 'is_active'
  | 'sort_order'
  | 'created_by'
  | 'created_at'
  | 'updated_at'
>

describe('calculateLaundryModelPrice', () => {
  it('calcule le poids réel selon le tarif au kilo', () => {
    expect(calculateLaundryModelPrice({ ...base, model_type: 'PER_KG' }, 2.35)).toMatchObject({
      status: 'PRICED',
      billedWeightKg: 2.4,
      amount: 2_400,
    })
  })

  it('applique le poids minimal avant l’incrément et le minimum de facturation', () => {
    expect(
      calculateLaundryModelPrice(
        { ...base, model_type: 'PER_KG', minimum_weight_kg: 1, minimum_charge: 1_500 },
        0.42,
      ),
    ).toMatchObject({ status: 'PRICED', billedWeightKg: 1, amount: 1_500 })
  })

  it('inclut un dépassement forfaitaire par incrément', () => {
    expect(
      calculateLaundryModelPrice(
        {
          ...base,
          model_type: 'WEIGHT_PACKAGE',
          price_per_kg: null,
          package_price: 5_000,
          included_weight_kg: 5,
          overage_price_per_kg: 800,
        },
        5.15,
      ),
    ).toMatchObject({ status: 'PRICED', extraWeightKg: 0.2, amount: 5_160 })
  })

  it('signale un devis si le forfait est dépassé sans prix de dépassement', () => {
    expect(
      calculateLaundryModelPrice(
        {
          ...base,
          model_type: 'WEIGHT_PACKAGE',
          price_per_kg: null,
          package_price: 5_000,
          included_weight_kg: 5,
        },
        6,
      ),
    ).toMatchObject({ status: 'QUOTE', amount: null })
  })

  it('refuse un poids nul ou négatif', () => {
    expect(() => calculateLaundryModelPrice({ ...base, model_type: 'PER_KG' }, 0)).toThrow(RangeError)
    expect(() => calculateLaundryModelPrice({ ...base, model_type: 'PER_KG' }, -1)).toThrow(RangeError)
  })
})
