import type { TenantActivityCode } from '@/types/database'

export interface ActivityDefinition {
  code: TenantActivityCode
  label: string
  description: string
  suggestions: string[]
}

/** Exemples personnalisables : les noms et les prix ne sont jamais imposés. */
export const TENANT_ACTIVITIES: ActivityDefinition[] = [
  {
    code: 'pressing',
    label: 'Pressing',
    description: 'Entretien courant des vêtements et textiles.',
    suggestions: ['Lavage et repassage', 'Lavage seul', 'Repassage seul', 'Détachage'],
  },
  {
    code: 'blanchisserie',
    label: 'Blanchisserie',
    description: 'Linge au kilo, linge de maison ou linge professionnel.',
    suggestions: ['Linge au kilo', 'Linge de maison', 'Linge professionnel'],
  },
  {
    code: 'nettoyage_sec',
    label: 'Nettoyage à sec',
    description: 'Textiles délicats et traitements spécifiques.',
    suggestions: ['Nettoyage à sec', 'Nettoyage textile délicat', 'Détachage spécialisé'],
  },
  {
    code: 'repassage',
    label: 'Repassage',
    description: 'Repassage et finition des vêtements.',
    suggestions: ['Repassage à la pièce', 'Repassage au kilo', 'Pliage du linge'],
  },
  {
    code: 'retouches',
    label: 'Retouches et couture',
    description: 'Ajustements, réparations et petites retouches.',
    suggestions: ['Ourlet', 'Réparation couture', 'Ajustement vêtement'],
  },
  {
    code: 'collecte_livraison',
    label: 'Collecte et livraison',
    description: 'Service à domicile ou en entreprise.',
    suggestions: ['Collecte', 'Livraison', 'Collecte et livraison'],
  },
  {
    code: 'tapis_moquettes',
    label: 'Tapis et ameublement',
    description: 'Nettoyage des tapis, moquettes et textiles d’ameublement.',
    suggestions: ['Nettoyage tapis', 'Nettoyage moquette', 'Nettoyage canapé'],
  },
  {
    code: 'cuir',
    label: 'Cuir et daim',
    description: 'Nettoyage et entretien des articles en cuir.',
    suggestions: ['Nettoyage cuir', 'Entretien cuir', 'Nettoyage daim'],
  },
]

export function labelActivite(code: TenantActivityCode): string {
  return TENANT_ACTIVITIES.find((activity) => activity.code === code)?.label ?? code
}
