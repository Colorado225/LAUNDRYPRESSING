import { z } from 'zod'

/**
 * Schémas Zod — validation des formulaires et des payloads locaux.
 *
 * Les mêmes contraintes existent en SQL (voir 001_init.sql). La validation
 * côté client sert au confort (messages en français immédiats) ; elle ne
 * remplace jamais les contraintes serveur.
 */

/** Numéro ivoirien : 10 chiffres, avec ou sans indicatif +225 / 00225. */
export const phoneCiSchema = z
  .string()
  .trim()
  .min(1, 'Le numéro de téléphone est obligatoire')
  .refine((value) => {
    const digits = value.replace(/[\s.-]/g, '').replace(/^(\+225|00225)/, '')
    return /^\d{10}$/.test(digits)
  }, 'Numéro invalide : 10 chiffres attendus (ex. 07 00 00 00 00)')

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
  serviceName: z.string().trim().max(60).optional(),
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
}).superRefine((item, context) => {
  const unite = item.billingUnit ?? 'PIECE'
  const quantite = item.quantity ?? 1
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
  if (!item.catalogEntryId && (item.priceReason ?? '').trim().length < 10) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priceReason'],
      message: 'Une ligne saisie librement exige un motif de 10 caractères minimum.',
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
