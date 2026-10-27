import type { OrderGarmentCondition, OrderGarmentDetail, OrderGarmentType } from '@/types/database'

/** Types proposés au comptoir pour détailler un lot facturé au poids. */
export const GARMENT_TYPES: ReadonlyArray<{ value: OrderGarmentType; label: string }> = [
  { value: 'CHEMISE', label: 'Chemise' },
  { value: 'T_SHIRT', label: 'T-shirt' },
  { value: 'PANTALON', label: 'Pantalon' },
  { value: 'JEAN', label: 'Jean' },
  { value: 'ROBE', label: 'Robe' },
  { value: 'JUPE', label: 'Jupe' },
  { value: 'VESTE', label: 'Veste' },
  { value: 'COSTUME', label: 'Costume' },
  { value: 'BOUBOU', label: 'Boubou / tenue traditionnelle' },
  { value: 'DRAP', label: 'Drap / linge de lit' },
  { value: 'SERVIETTE', label: 'Serviette' },
  { value: 'AUTRE', label: 'Autre vêtement' },
]

const GARMENT_LABELS = new Map(GARMENT_TYPES.map(({ value, label }) => [value, label]))

/** Résumé lisible du détail enregistré pour le lot au kilo. */
export function formatGarmentComposition(
  details?: readonly OrderGarmentDetail[] | null,
): string | null {
  if (!details?.length) return null
  const quantities = new Map<OrderGarmentType, { quantity: number; condition?: OrderGarmentCondition }>()
  for (const detail of details) {
    const existe = quantities.get(detail.type)
    if (!existe) {
      quantities.set(detail.type, { quantity: detail.quantity, condition: detail.condition })
    } else {
      existe.quantity += detail.quantity
      // Si un des lots est taché, on le signale dans le résumé.
      if (detail.condition === 'TACHE') existe.condition = 'TACHE'
    }
  }
  return [...quantities]
    .map(([type, { quantity, condition }]) => {
      const libelle = GARMENT_LABELS.get(type) ?? type
      return condition === 'TACHE' ? `${quantity} × ${libelle} (taché)` : `${quantity} × ${libelle}`
    })
    .join(', ')
}
