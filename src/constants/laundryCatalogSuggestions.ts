import type { TenantServiceBillingUnit, TenantServicePricingMode } from '@/types/database'

/**
 * Grilles tarifaires de démonstration inspirées des tarifs de pressings
 * abidjanais (laver-repasser, laver-plier, pièces, paliers kilo).
 *
 * Ces données ne sont JAMAIS écrites automatiquement : le propriétaire les
 * importe explicitement depuis l'écran Services & activités, puis garde la
 * main sur chaque libellé et chaque prix (principe de la migration 021 :
 * aucun tarif prédéfini sans action du pressing).
 */

export interface SuggestedTier {
  label: string
  weightKg: number
  priceFcfa: number
}

export interface SuggestedService {
  activityName: string
  categoryName: string
  serviceName: string
  billingUnit: TenantServiceBillingUnit
  pricingMode: TenantServicePricingMode
  unitPrice: number | null
  tiers: SuggestedTier[]
}

export interface SuggestedCatalog {
  activities: Array<{ name: string }>
  categories: Array<{ activityName: string; name: string }>
  services: SuggestedService[]
}

/** Grille « laver repasser / laver plier » avec pièces et forfaits kilo. */
export const LAUNDRY_GRID_SUGGESTION: SuggestedCatalog = {
  activities: [
    { name: 'Blanchisserie' },
    { name: 'Pressing' },
  ],
  categories: [
    { activityName: 'Blanchisserie', name: 'Forfaits au poids' },
    { activityName: 'Blanchisserie', name: 'Linge de maison' },
    { activityName: 'Pressing', name: 'Vêtements à la pièce' },
    { activityName: 'Pressing', name: 'Repassage' },
    { activityName: 'Pressing', name: 'Services spécifiques' },
  ],
  services: [
    // --- Forfaits poids : laver repasser / laver plier ---
    {
      activityName: 'Blanchisserie',
      categoryName: 'Forfaits au poids',
      serviceName: 'Laver repasser (forfait poids)',
      billingUnit: 'PACKAGE',
      pricingMode: 'FIXED',
      unitPrice: null,
      tiers: [
        { label: '10 kg', weightKg: 10, priceFcfa: 15000 },
        { label: '15 kg', weightKg: 15, priceFcfa: 22000 },
        { label: '20 kg', weightKg: 20, priceFcfa: 28500 },
      ],
    },
    {
      activityName: 'Blanchisserie',
      categoryName: 'Forfaits au poids',
      serviceName: 'Laver plier (forfait poids)',
      billingUnit: 'PACKAGE',
      pricingMode: 'FIXED',
      unitPrice: null,
      tiers: [
        { label: '10 kg', weightKg: 10, priceFcfa: 12000 },
        { label: '15 kg', weightKg: 15, priceFcfa: 16000 },
        { label: '20 kg', weightKg: 20, priceFcfa: 20000 },
      ],
    },
    {
      activityName: 'Blanchisserie',
      categoryName: 'Forfaits au poids',
      serviceName: 'Lavage au kilo (tarif linéaire)',
      billingUnit: 'KG',
      pricingMode: 'FIXED',
      unitPrice: 1500,
      tiers: [],
    },
    // --- Linge de maison ---
    {
      activityName: 'Blanchisserie',
      categoryName: 'Linge de maison',
      serviceName: 'Couette',
      billingUnit: 'PIECE',
      pricingMode: 'FROM',
      unitPrice: 3000,
      tiers: [],
    },
    {
      activityName: 'Blanchisserie',
      categoryName: 'Linge de maison',
      serviceName: 'Drap',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 1000,
      tiers: [],
    },
    {
      activityName: 'Blanchisserie',
      categoryName: 'Linge de maison',
      serviceName: 'Serviette',
      billingUnit: 'PIECE',
      pricingMode: 'FROM',
      unitPrice: 500,
      tiers: [],
    },
    {
      activityName: 'Blanchisserie',
      categoryName: 'Linge de maison',
      serviceName: 'Parure drap + 2 taies',
      billingUnit: 'SET',
      pricingMode: 'FIXED',
      unitPrice: 1000,
      tiers: [],
    },
    {
      activityName: 'Blanchisserie',
      categoryName: 'Linge de maison',
      serviceName: 'Parure 2 draps + 2 taies',
      billingUnit: 'SET',
      pricingMode: 'FIXED',
      unitPrice: 2000,
      tiers: [],
    },
    // --- Pièces ---
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Tee-shirt',
      billingUnit: 'PIECE',
      pricingMode: 'FROM',
      unitPrice: 300,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Débardeur',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 300,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Chemise',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 500,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Polo',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 500,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Pantalon',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 500,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Jeans',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 500,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Jupe',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 500,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Robe simple',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 500,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Robe longue',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 1000,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Robe de soirée',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 1500,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Blouson',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 1000,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Manteau',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 1500,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Costume',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 2000,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Ensemble dame',
      billingUnit: 'PIECE',
      pricingMode: 'FROM',
      unitPrice: 1000,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Culotte',
      billingUnit: 'PIECE',
      pricingMode: 'FIXED',
      unitPrice: 300,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Chaussettes',
      billingUnit: 'PAIR',
      pricingMode: 'FIXED',
      unitPrice: 250,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Vêtements à la pièce',
      serviceName: 'Chaussures',
      billingUnit: 'PAIR',
      pricingMode: 'FIXED',
      unitPrice: 1000,
      tiers: [],
    },
    // --- Repassage ---
    {
      activityName: 'Pressing',
      categoryName: 'Repassage',
      serviceName: 'Repassage à la pièce',
      billingUnit: 'PIECE',
      pricingMode: 'FROM',
      unitPrice: 100,
      tiers: [],
    },
    // --- Services spécifiques ---
    {
      activityName: 'Pressing',
      categoryName: 'Services spécifiques',
      serviceName: 'Amidonnage',
      billingUnit: 'PIECE',
      pricingMode: 'FROM',
      unitPrice: 1000,
      tiers: [],
    },
    {
      activityName: 'Pressing',
      categoryName: 'Services spécifiques',
      serviceName: 'Nettoyage textile délicat (sur devis)',
      billingUnit: 'FLAT',
      pricingMode: 'QUOTE',
      unitPrice: null,
      tiers: [],
    },
  ],
}
