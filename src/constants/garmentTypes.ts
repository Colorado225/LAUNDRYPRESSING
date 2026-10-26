import type { OrderGarmentDetail, OrderGarmentType } from '@/types/database'

/** Types proposés au comptoir pour détailler un lot facturé au poids. */
export const GARMENT_TYPES: ReadonlyArray<{ value: OrderGarmentType; label: string }> = [
  { value: 'CHEMISE', label: 'Chemise' },
  { value: 'T_SHIRT', label: 'T-shirt' },
  { value: 'POLO', label: 'Polo' },
  { value: 'DEBARDEUR', label: 'Débardeur' },
  { value: 'PANTALON', label: 'Pantalon' },
  { value: 'JEAN', label: 'Jean' },
  { value: 'JUPE', label: 'Jupe' },
  { value: 'ROBE', label: 'Robe' },
  { value: 'ENSEMBLE', label: 'Ensemble / tenue complète' },
  { value: 'VESTE', label: 'Veste' },
  { value: 'BLOUSON', label: 'Blouson' },
  { value: 'MANTEAU', label: 'Manteau' },
  { value: 'COSTUME', label: 'Costume' },
  { value: 'BOUBOU', label: 'Boubou / tenue traditionnelle' },
  { value: 'CULOTTE', label: 'Culotte / sous-vêtement' },
  { value: 'CHAUSSETTES', label: 'Chaussettes' },
  { value: 'CHAUSSURES', label: 'Chaussures' },
  { value: 'COUETTE', label: 'Couette' },
  { value: 'DRAP', label: 'Drap / linge de lit' },
  { value: 'TAIE', label: 'Taie d’oreiller' },
  { value: 'SERVIETTE', label: 'Serviette' },
  { value: 'LINGE_DE_MAISON', label: 'Linge de maison' },
  { value: 'TAPIS', label: 'Tapis' },
  { value: 'AUTRE', label: 'Autre vêtement' },
]

const GARMENT_LABELS = new Map(GARMENT_TYPES.map(({ value, label }) => [value, label]))

/** Résumé lisible du détail enregistré pour le lot au kilo. */
export function formatGarmentComposition(
  details?: readonly OrderGarmentDetail[] | null,
): string | null {
  if (!details?.length) return null
  const quantities = new Map<OrderGarmentType, number>()
  for (const detail of details) {
    quantities.set(detail.type, (quantities.get(detail.type) ?? 0) + detail.quantity)
  }
  return [...quantities]
    .map(([type, quantity]) => `${quantity} × ${GARMENT_LABELS.get(type) ?? type}`)
    .join(', ')
}
