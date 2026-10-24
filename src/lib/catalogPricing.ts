import type { CatalogBillingUnit } from '@/types/database'

export interface CalculTarifInput {
  quantite: number
  prixUnitaire: number
  unite: CatalogBillingUnit
  quantiteMinimum?: number | null
  increment?: number | null
  minimumFacturable?: number | null
}

export interface CalculTarifResult {
  quantiteMesuree: number
  quantiteFacturee: number
  prixUnitaire: number
  total: number
}

const UNITES_DISCRETES: readonly CatalogBillingUnit[] = ['PIECE', 'PAIR', 'SET', 'PACKAGE']
const PRECISION_QUANTITE = 3
const EPSILON = 1e-9

/**
 * Calcule le montant d'une ligne suivant la règle commune au formulaire et au
 * serveur : minimum de quantité, arrondi supérieur à l'incrément, puis minimum
 * de facturation. Les montants restent des FCFA entiers.
 */
export function calculerTarif(input: CalculTarifInput): CalculTarifResult {
  const { quantite, prixUnitaire, unite, quantiteMinimum, increment, minimumFacturable } = input

  if (!Number.isFinite(quantite) || quantite <= 0) {
    throw new Error('La quantité doit être supérieure à zéro.')
  }
  if (Number(quantite.toFixed(PRECISION_QUANTITE)) !== quantite) {
    throw new Error('La quantité ne peut pas dépasser trois décimales.')
  }
  if (!Number.isSafeInteger(prixUnitaire) || prixUnitaire <= 0) {
    throw new Error('Le prix unitaire doit être un nombre entier de FCFA supérieur à zéro.')
  }
  if (!Number.isSafeInteger(minimumFacturable ?? 0) || (minimumFacturable ?? 0) < 0) {
    throw new Error('Le minimum de facturation doit être un montant entier positif ou nul.')
  }
  if (quantiteMinimum != null && (!Number.isFinite(quantiteMinimum) || quantiteMinimum <= 0)) {
    throw new Error('La quantité minimum doit être supérieure à zéro.')
  }
  if (increment != null && (!Number.isFinite(increment) || increment <= 0)) {
    throw new Error('L’incrément de facturation doit être supérieur à zéro.')
  }
  if (UNITES_DISCRETES.includes(unite)) {
    if (!Number.isInteger(quantite)) {
      throw new Error('Cette unité se facture en quantité entière.')
    }
    if (quantiteMinimum != null && !Number.isInteger(quantiteMinimum)) {
      throw new Error('Le minimum de cette unité doit être un nombre entier.')
    }
    if (increment != null && !Number.isInteger(increment)) {
      throw new Error('L’incrément de cette unité doit être un nombre entier.')
    }
  }
  if (unite === 'FLAT' && quantite !== 1) {
    throw new Error('Une prestation forfaitaire se facture une seule fois.')
  }

  const base = Math.max(quantite, quantiteMinimum ?? 0)
  const quantiteFacturee = increment
    ? Number((Math.ceil(base / increment - EPSILON) * increment).toFixed(PRECISION_QUANTITE))
    : Number(base.toFixed(PRECISION_QUANTITE))
  const montantCalcule = Math.round(quantiteFacturee * prixUnitaire)
  const total = Math.max(montantCalcule, minimumFacturable ?? 0)

  if (!Number.isSafeInteger(total)) {
    throw new Error('Le total calculé dépasse le montant pris en charge.')
  }

  return { quantiteMesuree: quantite, quantiteFacturee, prixUnitaire, total }
}

/** Libellé utilisateur en français pour les unités stockées en code. */
export function libelleUnite(unite: CatalogBillingUnit): string {
  const libelles: Record<CatalogBillingUnit, string> = {
    PIECE: 'pièce',
    PAIR: 'paire',
    SET: 'ensemble',
    KG: 'kg',
    M2: 'm²',
    METER: 'mètre',
    PACKAGE: 'forfait',
    FLAT: 'forfait',
  }
  return libelles[unite]
}
