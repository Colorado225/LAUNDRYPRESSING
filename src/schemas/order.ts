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
})

export const createOrderSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(2, 'Le nom du client est obligatoire')
    .max(120, 'Nom trop long (120 caractères maximum)'),
  customerPhone: phoneCiSchema,
  items: z.array(orderItemInputSchema).min(1, 'Ajoutez au moins un vêtement'),
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
