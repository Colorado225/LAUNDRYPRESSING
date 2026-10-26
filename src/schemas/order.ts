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
  /** Article du catalogue choisi (obligatoire au comptoir quand le catalogue est installé). */
  garmentTypeId: z.string().uuid("Référence d'article invalide").nullable().optional(),
  /** Forfait vendu par la ligne porteuse (migration 030). */
  commercialPackageId: z.string().uuid('Référence de forfait invalide').nullable().optional(),
  /**
   * Identifiant temporaire commun à la porteuse et à ses détails pendant la
   * saisie ; le dépôt local le remplace par l'identifiant réel de la porteuse.
   */
  forfaitGroupeId: z.string().uuid('Référence de groupe de forfait invalide').nullable().optional(),
  /**
   * Total imposé par un calcul externe (tarification au kilo par tranches) :
   * prime sur quantité × prix unitaire, le serveur recalcule et contrôle.
   */
  totalImpose: z.number().int().positive().max(10_000_000).optional(),
  activityNameSnapshot: z.string().trim().max(80).nullable().optional(),
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

  // Forfait au nombre de vêtements (migration 030) : la porteuse porte le
  // seul prix confirmé, chaque détail énumère un article à 0 FCFA.
  const estPorteuseForfait = Boolean(item.commercialPackageId)
  const estDetailForfait = Boolean(item.forfaitGroupeId && !item.commercialPackageId)
  if (estPorteuseForfait || estDetailForfait) {
    if (item.laundryModelId || item.familyPackageSnapshot != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['commercialPackageId'],
        message: 'Un forfait au nombre de vêtements ne peut pas être combiné à un ancien modèle commercial.',
      })
    }
    if (item.quantity === undefined || !Number.isInteger(quantite) || quantite < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity'],
        message: 'Le comptage d’un forfait se fait en vêtements entiers, au moins un.',
      })
    }
    if (item.billedQuantity !== undefined && item.billedQuantity !== quantite) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billedQuantity'],
        message: 'Pour un forfait, la quantité facturée doit égaler le nombre de vêtements comptés.',
      })
    }
    if (item.priceStatus === 'ESTIMATED') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceStatus'],
        message: 'Confirmez le comptage et le montant du forfait avant de valider.',
      })
    }
    if (item.pricingMode !== undefined && item.pricingMode !== 'FIXED') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pricingMode'],
        message: 'Un forfait au nombre de vêtements est vendu au prix calculé de l’offre.',
      })
    }
  }
  if (estPorteuseForfait) {
    if (!item.forfaitGroupeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forfaitGroupeId'],
        message: 'Associez la ligne du forfait aux articles comptés.',
      })
    }
    if (unite !== 'PACKAGE') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billingUnit'],
        message: 'La ligne porteuse d’un forfait doit utiliser l’unité « forfait ».',
      })
    }
    if (item.garmentTypeId != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['garmentTypeId'],
        message: 'La ligne du forfait ne désigne pas un article unique : les articles sont ses lignes de détail.',
      })
    }
    if (item.totalImpose === undefined || item.price !== item.totalImpose) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: 'Le montant du forfait doit être le total calculé pour le comptage.',
      })
    }
    if (item.unitPrice === undefined || item.unitPrice <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unitPrice'],
        message: 'Calculez le montant du forfait avant de valider.',
      })
    }
  }
  if (estDetailForfait) {
    if (!item.garmentTypeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['garmentTypeId'],
        message: 'Choisissez l’article déposé pour chaque détail de forfait.',
      })
    }
    if (item.price !== 0 || (item.unitPrice ?? 0) !== 0 || item.totalImpose !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: 'Un article inclus dans un forfait doit rester à 0 FCFA : seul le forfait est facturé.',
      })
    }
    if (item.billingUnit !== undefined && item.billingUnit !== 'PIECE') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billingUnit'],
        message: 'Les articles d’un forfait se comptent à la pièce.',
      })
    }
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
  if (unite !== 'KG' && item.garmentDetails?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['garmentDetails'],
      message: 'Le détail des vêtements ne s’applique qu’à une prestation au kilo.',
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

/**
 * Champs sans la cohérence inter-lignes : utilisé pour contrôler une seule
 * étape du formulaire. Zod interdit `.pick()` sur un objet raffiné.
 */
export const createOrderBaseSchema = z.object({
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

export const createOrderSchema = createOrderBaseSchema.superRefine((order, context) => {
  const groupes = new Map<
    string,
    { porteuses: number[]; details: number[]; articles: Set<string> }
  >()

  order.items.forEach((item, index) => {
    if (!item.forfaitGroupeId) return
    const groupe =
      groupes.get(item.forfaitGroupeId) ?? { porteuses: [], details: [], articles: new Set<string>() }
    if (item.commercialPackageId) {
      groupe.porteuses.push(index)
    } else {
      groupe.details.push(index)
      if (item.garmentTypeId) {
        if (groupe.articles.has(item.garmentTypeId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['items', index, 'garmentTypeId'],
            message: 'Comptez chaque article une seule fois dans le forfait.',
          })
        }
        groupe.articles.add(item.garmentTypeId)
      }
    }
    groupes.set(item.forfaitGroupeId, groupe)
  })

  groupes.forEach((groupe) => {
    const premierIndex = groupe.porteuses[0] ?? groupe.details[0] ?? 0
    if (groupe.porteuses.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', premierIndex, 'forfaitGroupeId'],
        message: 'Chaque forfait doit comporter exactement une ligne facturée.',
      })
      return
    }

    const porteuseIndex = groupe.porteuses[0]!
    if (groupe.details.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', porteuseIndex, 'quantity'],
        message: 'Comptez au moins un article dans le forfait.',
      })
      return
    }

    const comptage = groupe.details.reduce(
      (total, index) => total + (order.items[index]?.quantity ?? 1),
      0,
    )
    const annonce = order.items[porteuseIndex]?.quantity ?? 1
    if (comptage !== annonce) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', porteuseIndex, 'quantity'],
        message: `Le forfait annonce ${annonce} vêtement(s), mais le comptage en totalise ${comptage}.`,
      })
    }
  })
})

export type OrderItemInput = z.infer<typeof orderItemInputSchema>
export type CreateOrderInput = z.infer<typeof createOrderBaseSchema>

/**
 * Aplatit les erreurs Zod en une liste de messages français.
 * Utilisé par les formulaires pour afficher le premier message utile.
 */
export function zodMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.message)
}
