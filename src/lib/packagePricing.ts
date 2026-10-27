/**
 * Forfaits commerciaux — règles pures.
 *
 * Un forfait vend un **nombre de vêtements pour un prix global** : « Pack 10
 * pièces, 5 000 FCFA ». La composition est libre : le comptoir touche les
 * vêtements réellement déposés, dans la limite du nombre inclus.
 *
 * Ce module ne touche ni au réseau ni au stockage : il décide seulement
 * combien coûte un forfait pour N vêtements, et si N est acceptable. C'est ce
 * qui permet de le tester sans base et de le réutiliser à l'écran comme dans
 * les contrôles d'enregistrement.
 *
 * ⚠️ Seules deux politiques de dépassement sont **vendables** en v1
 *    (`PER_EXTRA_ITEM`, `REJECT_OVER_LIMIT`). Les deux autres existent en base
 *    (héritage) mais ne sont pas configurables : un forfait qui en porterait une
 *    est refusé à la vente plutôt que facturé au hasard.
 */

export type PolitiqueDepassement =
  | 'PER_EXTRA_ITEM'
  | 'REPEAT_PACKAGE'
  | 'REJECT_OVER_LIMIT'
  | 'MANUAL_QUOTE'

/** Politiques réellement proposées par l'écran de configuration. */
export const POLITIQUES_VENDABLES: readonly PolitiqueDepassement[] = [
  'PER_EXTRA_ITEM',
  'REJECT_OVER_LIMIT',
]

export interface Forfait {
  id: string
  tenantId: string
  code: string
  name: string
  description: string | null
  priceXof: number
  /** Nombre de vêtements couverts par le prix global ; `null` = illimité. */
  garmentsIncluded: number | null
  overflowPolicy: PolitiqueDepassement
  /** Prix de la pièce supplémentaire (obligatoire pour `PER_EXTRA_ITEM`). */
  overflowUnitPriceXof: number | null
  isActive: boolean
  archivedAt: string | null
}

export interface TarificationForfait {
  /** Montant total facturé pour ce forfait avec ce nombre de vêtements. */
  total: number
  /** Prix du forfait seul, sans supplément. */
  base: number
  /** Nombre de vêtements au-delà du forfait. */
  extras: number
  /** Coût des vêtements supplémentaires (0 si aucun ou si refusés). */
  coutExtras: number
  statut: 'inclus' | 'supplement' | 'refus' | 'non_pris_en_charge'
  /** Motif lisible quand la vente est refusée. */
  motif: string | null
}

/** Nombre total de vêtements décrits par une composition (`garmentDetails`). */
export function nombreVetements(
  details: readonly { type: string; quantity: number }[] | undefined,
): number {
  return (details ?? []).reduce((somme, detail) => somme + Math.max(0, detail.quantity), 0)
}

/**
 * Tarification d'un forfait pour un nombre de vêtements donné.
 *
 * - dans la limite incluse : le prix global, rien de plus ;
 * - au-delà, `PER_EXTRA_ITEM` ajoute les pièces supplémentaires au prix
 *   configuré, `REJECT_OVER_LIMIT` refuse ;
 * - un forfait illimité (`garmentsIncluded` nul) ne déborde jamais ;
 * - toute autre politique est refusée : mieux vaut bloquer la vente que
 *   inventer un montant.
 */
export function tariferForfait(forfait: Forfait, vetements: number): TarificationForfait {
  const base = forfait.priceXof
  const inclus = forfait.garmentsIncluded
  const nombre = Math.max(0, Math.floor(vetements))
  const extras = inclus === null ? 0 : Math.max(0, nombre - inclus)
  const aucunSupplement = { base, extras: 0, coutExtras: 0 }

  if (extras === 0) {
    return { ...aucunSupplement, total: base, statut: 'inclus', motif: null }
  }

  if (!POLITIQUES_VENDABLES.includes(forfait.overflowPolicy)) {
    return {
      ...aucunSupplement,
      total: base,
      statut: 'non_pris_en_charge',
      motif:
        'Ce forfait utilise une règle de dépassement non prise en charge par la caisse. Modifiez le forfait dans « Services & activités ».',
    }
  }

  if (forfait.overflowPolicy === 'REJECT_OVER_LIMIT') {
    return {
      ...aucunSupplement,
      total: base,
      statut: 'refus',
      motif: `Ce forfait couvre ${inclus} vêtement${inclus && inclus > 1 ? 's' : ''}. Retirez ${extras} pièce${extras > 1 ? 's' : ''} ou choisissez un autre forfait.`,
    }
  }

  const prixPiece = forfait.overflowUnitPriceXof
  if (prixPiece === null || prixPiece <= 0) {
    return {
      ...aucunSupplement,
      total: base,
      statut: 'non_pris_en_charge',
      motif:
        'Le prix de la pièce supplémentaire n’est pas configuré pour ce forfait. Complétez-le dans « Services & activités ».',
    }
  }

  const coutExtras = extras * prixPiece
  return {
    base,
    extras,
    coutExtras,
    total: base + coutExtras,
    statut: 'supplement',
    motif: null,
  }
}

/** Résumé d'un forfait pour les écrans de vente et de configuration. */
export function resumerForfait(forfait: Forfait): string {
  const inclus =
    forfait.garmentsIncluded === null
      ? 'vêtements illimités'
      : `${forfait.garmentsIncluded} vêtement${forfait.garmentsIncluded > 1 ? 's' : ''} inclus`
  const depassement =
    forfait.garmentsIncluded === null
      ? ''
      : forfait.overflowPolicy === 'REJECT_OVER_LIMIT'
        ? ' · au-delà : refusé'
        : forfait.overflowUnitPriceXof
          ? ` · au-delà : ${forfait.overflowUnitPriceXof} FCFA/pièce`
          : ' · au-delà : non configuré'
  return `${inclus}${depassement}`
}
