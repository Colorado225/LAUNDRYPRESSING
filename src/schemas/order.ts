import { z } from 'zod'

/**
 * Schémas Zod — validation des formulaires et des payloads locaux.
 *
 * Les mêmes contraintes existent en SQL (voir 001_init.sql). La validation
 * côté client sert au confort (messages en français immédiats) ; elle ne
 * remplace jamais les contraintes serveur.
 */

/**
 * Normalise un numéro ivoirien saisi au comptoir.
 *
 * On ne garde que les chiffres : un numéro collé depuis un carnet de contacts
 * arrive souvent avec des espaces insécables, des tirets, des points ou même
 * une espace de largeur nulle — autant de caractères qu'un simple
 * `replace(/[\s.-]/g, '')` laissait passer et qui faisaient échouer la
 * validation sans que le guichetier comprenne pourquoi.
 * L'indicatif pays (+225, 00225) est retiré pour ne conserver que les 10
 * chiffres locaux, identiques à ce que calcule `normalize_phone` en base.
 */
export function normalizePhoneCi(value: string): string {
  const chiffres = value.replace(/\D/g, '')

  if (chiffres.startsWith('00225')) return chiffres.slice(5)
  if (chiffres.startsWith('225') && chiffres.length > 10) return chiffres.slice(3)

  return chiffres
}

/** Numéro ivoirien : 10 chiffres, avec ou sans indicatif +225 / 00225. */
export const phoneCiSchema = z
  .string()
  .trim()
  .min(1, 'Le numéro de téléphone est obligatoire')
  .refine(
    (value) => /^\d{10}$/.test(normalizePhoneCi(value)),
    'Numéro invalide : 10 chiffres attendus (ex. 07 00 00 00 00)',
  )

export const orderItemInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(2, 'Décrivez le vêtement (ex. « Chemise »)')
    .max(120, 'Libellé trop long (120 caractères maximum)'),
  fabricType: z.string().trim().max(60, 'Tissu trop long (60 caractères maximum)').optional(),
  specialInstructions: z
    .string()
    .trim()
    .max(200, 'Instructions trop longues (200 caractères maximum)')
    .optional(),
  price: z
    .number({ message: 'Indiquez un prix valide' })
    .int('Le prix doit être un nombre entier de FCFA')
    .min(0, 'Le prix ne peut pas être négatif')
    .max(10_000_000, 'Prix trop élevé'),
  /** Entrée de catalogue utilisée (prix historisé), absente pour une ligne libre. */
  catalogEntryId: z.string().uuid("Référence de catalogue invalide").optional(),
  articleName: z.string().trim().max(60).optional(),
  serviceName: z.string().trim().max(80).optional(),
  /** Prestation configurée source et nom de son activité figé au dépôt. */
  tenantServiceId: z.string().uuid('Référence de prestation invalide').nullable().optional(),
  activityNameSnapshot: z.string().trim().max(80).nullable().optional(),
  /**
   * Forfait commercial vendu (table `commercial_packages`) : la ligne porte le
   * prix global, sa composition libre est dans `garmentDetails`.
   */
  commercialPackageId: z.string().uuid('Référence de forfait invalide').nullable().optional(),
  /** Ligne de détail d'un forfait, dont le prix est déjà inclus dans l'en-tête. */
  packageLineId: z.string().uuid('Référence de forfait invalide').nullable().optional(),
  /** Types et quantités énumérés pour une ligne de prestation au kilo. */
  garmentDetails: z.array(z.object({
    type: z.enum([
      'CHEMISE', 'T_SHIRT', 'PANTALON', 'JEAN', 'ROBE', 'JUPE',
      'VESTE', 'COSTUME', 'BOUBOU', 'DRAP', 'SERVIETTE', 'AUTRE',
    ]),
    quantity: z.number().int().min(1).max(1000),
  })).max(100).optional(),
  /** Quantité réellement pesée/mesurée ; 1 par défaut pour les anciennes lignes. */
  quantity: z
    .number()
    .positive('La quantité doit être supérieure à zéro')
    .max(1_000_000)
    .refine((value) => Number(value.toFixed(3)) === value, 'Trois décimales maximum pour la quantité')
    .optional(),
  billingUnit: z
    .enum(['PIECE', 'PAIR', 'SET', 'KG', 'M2', 'METER', 'PACKAGE', 'FLAT'])
    .optional(),
  /** Prix par unité de facturation (le champ `price` reste le total de ligne). */
  unitPrice: z.number().int().min(0).max(10_000_000).optional(),
  pricingMode: z.enum(['FIXED', 'FROM', 'QUOTE', 'UNCONFIGURED']).optional(),
  priceStatus: z.enum(['CONFIRMED', 'ESTIMATED']).optional(),
  billedQuantity: z.number().positive().max(1_000_000).optional(),
  familyNameSnapshot: z.string().trim().max(80).nullable().optional(),
  catalogUnitPriceSnapshot: z.number().int().nonnegative().nullable().optional(),
  minimumQuantitySnapshot: z.number().positive().nullable().optional(),
  billingIncrementSnapshot: z.number().positive().nullable().optional(),
  minimumChargeSnapshot: z.number().int().nonnegative().nullable().optional(),
  conditionsSnapshot: z.string().trim().max(1000).nullable().optional(),
  /**
   * Motif exigé par le serveur pour toute ligne libre ou toute dérogation au
   * tarif catalogue, afin qu'aucun prix arbitraire ne contourne la traçabilité.
   */
  priceReason: z
    .string()
    .trim()
    .max(300, 'Motif trop long (300 caractères maximum)')
    .optional(),
  laundryModelId: z.string().uuid('Modèle commercial invalide').nullable().optional(),
  laundryModelNameSnapshot: z.string().trim().min(2).max(80).nullable().optional(),
  laundryModelTypeSnapshot: z.enum(['PER_KG', 'WEIGHT_PACKAGE', 'FAMILY_PACKAGE']).nullable().optional(),
  laundryWeightKg: z.number().positive().max(10_000).refine((value) => Number(value.toFixed(3)) === value).nullable().optional(),
  laundryPriceBreakdownSnapshot: z.string().trim().max(500).nullable().optional(),
  laundryServicesSnapshot: z.string().trim().max(1000).nullable().optional(),
  laundryPricePerKgSnapshot: z.number().int().positive().nullable().optional(),
  laundryPackagePriceSnapshot: z.number().int().positive().nullable().optional(),
  laundryIncludedWeightKgSnapshot: z.number().positive().nullable().optional(),
  laundryOveragePricePerKgSnapshot: z.number().int().nonnegative().nullable().optional(),
  laundryMinimumWeightKgSnapshot: z.number().positive().nullable().optional(),
  laundryBillingIncrementKgSnapshot: z.number().positive().nullable().optional(),
  laundryMinimumChargeSnapshot: z.number().int().nonnegative().nullable().optional(),
  familyPackageSnapshot: z.object({
    modelId: z.string().uuid(),
    modelName: z.string().trim().min(2).max(80),
    packagePrice: z.number().int().positive(),
    includedPieces: z.number().int().min(1).max(1000),
    overagePricePerPiece: z.number().int().nonnegative().nullable(),
    minimumCharge: z.number().int().nonnegative().nullable(),
    pieceCount: z.number().int().min(0).max(10000),
    manualTotalPrice: z.number().int().positive().nullable(),
    contents: z.array(z.object({
      articleId: z.string().uuid(),
      articleName: z.string().trim().min(1).max(80),
      familyName: z.string().trim().max(80).nullable(),
      quantity: z.number().int().min(1).max(1000),
      careInstructions: z.string().max(1000).nullable(),
    })).max(500),
  }).nullable().optional(),
}).superRefine((item, context) => {
  const unite = item.billingUnit ?? 'PIECE'
  const quantite = item.quantity ?? 1
  // Une ligne ne peut pas être à la fois un forfait et une ligne de détail :
  // le serveur refuse exactement la même combinaison (`order_items_package_role_check`).
  if (item.commercialPackageId && item.packageLineId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['commercialPackageId'],
      message: 'Une ligne ne peut pas être un forfait et un détail de forfait à la fois.',
    })
  }
  if (item.commercialPackageId && item.billingUnit !== 'PACKAGE') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['billingUnit'],
      message: 'Un forfait se facture en unité « forfait ».',
    })
  }
  if (item.packageLineId && item.price !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['price'],
      message: 'Le détail d’un forfait est compris dans le prix global : il ne peut pas être refacturé.',
    })
  }
  if (item.laundryModelId) {
    if (item.catalogEntryId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['catalogEntryId'], message: 'Une ligne modèle ne peut pas dépendre d’un tarif à la pièce.' })
    }
    const forfaitFamille = item.laundryModelTypeSnapshot === 'FAMILY_PACKAGE'
    if (!item.laundryModelNameSnapshot || !item.laundryModelTypeSnapshot || (!forfaitFamille && item.laundryWeightKg == null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['laundryModelId'], message: 'Actualisez les informations du modèle commercial avant de valider.' })
    }
    if (forfaitFamille) {
      const snapshot = item.familyPackageSnapshot
      if (!snapshot || snapshot.modelId !== item.laundryModelId || snapshot.modelName !== item.laundryModelNameSnapshot) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['familyPackageSnapshot'], message: 'La composition du forfait famille est manquante ou ne correspond pas au modèle.' })
      } else {
        const count = snapshot.contents.reduce((sum, content) => sum + content.quantity, 0)
        if (snapshot.contents.length === 0 || snapshot.pieceCount !== count) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['familyPackageSnapshot'], message: 'Ajoutez les articles et vérifiez leurs quantités.' })
        }
        const expected = count <= snapshot.includedPieces
          ? Math.max(snapshot.packagePrice, snapshot.minimumCharge ?? 0)
          : snapshot.overagePricePerPiece !== null
            ? Math.max(snapshot.packagePrice + (count - snapshot.includedPieces) * snapshot.overagePricePerPiece, snapshot.minimumCharge ?? 0)
            : null
        if (expected !== null && item.price !== expected) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: `Le total du forfait doit être de ${expected} FCFA.` })
        }
        if (expected === null && (snapshot.manualTotalPrice !== item.price || item.price < snapshot.packagePrice)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'Confirmez un prix global au moins égal au prix du forfait.' })
        }
      }
      if (unite !== 'FLAT' || quantite !== 1 || item.unitPrice !== item.price || item.priceStatus !== 'CONFIRMED') {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['billingUnit'], message: 'Un forfait famille doit être une ligne forfaitaire globale à prix confirmé.' })
      }
    } else if (item.familyPackageSnapshot != null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['familyPackageSnapshot'], message: 'La composition famille ne peut être utilisée qu’avec un modèle famille.' })
    }
    if (item.laundryModelTypeSnapshot === 'PER_KG' && unite !== 'KG') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['billingUnit'], message: 'Un modèle au kilo doit être facturé en kg.' })
    }
    if (item.laundryModelTypeSnapshot === 'WEIGHT_PACKAGE' && (unite !== 'FLAT' || quantite !== 1)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['billingUnit'], message: 'Un forfait de poids doit rester une ligne forfaitaire.' })
    }
  } else if (
    item.laundryModelNameSnapshot != null || item.laundryModelTypeSnapshot != null || item.laundryWeightKg != null || item.familyPackageSnapshot != null
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['laundryModelId'], message: 'La référence du modèle commercial est manquante.' })
  }
  if (item.tenantServiceId && (!item.serviceName?.trim() || !item.activityNameSnapshot?.trim())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tenantServiceId'],
      message: 'Rechargez la prestation sélectionnée pour conserver son activité et son libellé.',
    })
  }
  if (unite === 'KG' && (item.unitPrice ?? 0) <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unitPrice'],
      message: 'Indiquez un tarif au kilo supérieur à zéro.',
    })
  }
  if (unite === 'KG' && item.garmentDetails !== undefined && item.garmentDetails.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['garmentDetails'],
      message: 'Énumérez au moins un type de vêtement pour cette prestation au kilo.',
    })
  }
  // Le détail des vêtements décrit aussi la composition libre d'un forfait,
  // mais ne s'applique à aucune autre unité (une pièce reste une pièce).
  if (unite !== 'KG' && unite !== 'PACKAGE' && item.garmentDetails?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['garmentDetails'],
      message: 'Le détail des vêtements ne s’applique qu’à une prestation au kilo ou à un forfait.',
    })
  }
  if (['PIECE', 'PAIR', 'SET', 'PACKAGE'].includes(unite) && !Number.isInteger(quantite)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantity'],
      message: 'Cette unité se facture en quantité entière.',
    })
  }
  if (unite === 'FLAT' && quantite !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantity'],
      message: 'Une prestation forfaitaire se facture une seule fois.',
    })
  }
  if (item.pricingMode === 'UNCONFIGURED') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['catalogEntryId'],
      message: 'Ce tarif doit être configuré avant de créer la commande.',
    })
  }
  if (item.pricingMode === 'QUOTE' && unite !== 'FLAT') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['billingUnit'],
      message: 'Le montant d’un devis est un forfait final, indépendant d’une quantité mesurée.',
    })
  }
  if (item.pricingMode === 'QUOTE' && (item.unitPrice ?? 0) <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unitPrice'],
      message: 'Confirmez le montant du devis avant de valider la commande.',
    })
  }
  if (item.pricingMode === 'QUOTE' && item.priceStatus === 'ESTIMATED') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priceStatus'],
      message: 'Un devis doit avoir un montant confirmé.',
    })
  }
  if (item.catalogEntryId && (!item.pricingMode || !item.billingUnit || item.unitPrice === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['catalogEntryId'],
      message: 'Rechargez le catalogue pour conserver le mode, l’unité et le prix de référence.',
    })
  }
  if (
    item.catalogEntryId &&
    (item.pricingMode === 'FIXED' || item.pricingMode === 'FROM') &&
    item.catalogUnitPriceSnapshot == null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['catalogUnitPriceSnapshot'],
      message: 'Le prix de référence de ce tarif est manquant.',
    })
  }
  if (
    item.pricingMode === 'FROM' &&
    item.catalogUnitPriceSnapshot != null &&
    item.unitPrice !== undefined &&
    item.unitPrice < item.catalogUnitPriceSnapshot
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unitPrice'],
      message: 'Le prix unitaire ne peut pas être inférieur au tarif « à partir de ».',
    })
  }
  if (
    item.catalogEntryId &&
    (item.pricingMode === 'FIXED' || item.pricingMode === 'FROM') &&
    item.catalogUnitPriceSnapshot != null &&
    item.unitPrice !== undefined &&
    item.unitPrice !== item.catalogUnitPriceSnapshot &&
    (item.priceReason ?? '').trim().length < 10
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priceReason'],
      message: 'Un tarif différent du catalogue exige un motif de 10 caractères minimum.',
    })
  }
})

export const orderItemMeasurementSchema = z.object({
  quantity: z
    .number({ message: 'Indiquez une mesure valide.' })
    .positive('La mesure doit être supérieure à zéro.')
    .max(1_000_000)
    .refine((value) => Number(value.toFixed(3)) === value, 'Trois décimales maximum pour la mesure.'),
  priceStatus: z.enum(['CONFIRMED', 'ESTIMATED']),
})

export type UpdateOrderItemMeasurementInput = z.infer<typeof orderItemMeasurementSchema>

export const createOrderSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(2, 'Le nom du client est obligatoire')
    .max(120, 'Nom trop long (120 caractères maximum)'),
  customerPhone: phoneCiSchema,
  items: z.array(orderItemInputSchema).min(1, 'Ajoutez au moins une ligne de commande'),
  /** Échéance promise au client, au format AAAA-MM-JJ. */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de livraison invalide')
    .optional(),
  /** Employé à qui la commande est confiée dès la réception. */
  assignedTo: z.string().uuid('Employé invalide').optional(),
})

export type OrderItemInput = z.infer<typeof orderItemInputSchema>
export type CreateOrderInput = z.infer<typeof createOrderSchema>

/**
 * Aplatit les erreurs Zod en une liste de messages français.
 * Utilisé par les formulaires pour afficher le premier message utile.
 */
export function zodMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.message)
}
