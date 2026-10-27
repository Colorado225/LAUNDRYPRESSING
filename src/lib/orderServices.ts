import { GARMENT_GRID, getGarmentImage } from '@/constants/garmentImages'
import type { TenantActivityCode, OrderGarmentType } from '@/types/database'
import type { TenantServiceOffering } from '@/services/tenantServices'

/**
 * Parcours de commande : deux gestes différents au comptoir.
 *
 *  - **pressing** : des vêtements identifiés un par un, facturés à la pièce ;
 *  - **blanchisserie** : du linge pesé (drap, serviette, uniforme…), facturé au
 *    kilo, avec la composition du lot conservée pour le suivi du linge.
 *
 * Ce module ne contient **que des règles pures** : quelles catégories afficher,
 * quel parcours correspond à une activité du pressing, quels articles sont
 * proposés. Il ne touche ni au stockage ni au réseau, ce qui le rend testable
 * et réutilisable par les écrans comme par les tests.
 *
 * ⚠️ Aucun tarif n'est inventé ici. Les prix viennent de la saisie au comptoir
 *    ou du tarif au kilo configuré dans « Services & activités » ; les forfaits
 *    commerciaux (paquets de 2 kg…) ont été retirés du schéma par la migration
 *    020 et ne sont donc pas proposés.
 */

export type ParcoursService = 'pressing' | 'blanchisserie'

/** Article proposé dans la grille tactile d'un parcours. */
export interface ArticleGrille {
  type: OrderGarmentType
  libelle: string
  /** Chemin public de l'icône existante (`public/images/…`). */
  image: string
  categorie: string
  favori: boolean
}

interface DefinitionCategorie {
  id: string
  libelle: string
  types: readonly OrderGarmentType[]
}

/**
 * Catégories du parcours pressing, dans l'ordre d'usage d'un comptoir
 * d'Abidjan : le quotidien d'abord, l'occasionnel ensuite.
 */
export const CATEGORIES_PRESSING: readonly DefinitionCategorie[] = [
  { id: 'quotidien', libelle: 'Quotidien', types: ['CHEMISE', 'T_SHIRT', 'PANTALON', 'JEAN'] },
  { id: 'femme', libelle: 'Robes et jupes', types: ['ROBE', 'JUPE'] },
  { id: 'costumes', libelle: 'Costumes et vestes', types: ['COSTUME', 'VESTE', 'BOUBOU'] },
  { id: 'autre', libelle: 'Autre', types: ['AUTRE'] },
]

/**
 * Catégories du parcours blanchisserie : linge de lit, linge de toilette,
 * uniformes du personnel puis articles divers. Les types sont ceux du modèle
 * `OrderGarmentType` — aucun type nouveau n'est introduit, donc rien ne change
 * côté schéma ni côté synchronisation.
 */
export const CATEGORIES_BLANCHISSERIE: readonly DefinitionCategorie[] = [
  { id: 'lit', libelle: 'Linge de lit', types: ['DRAP'] },
  { id: 'toilette', libelle: 'Linge de toilette', types: ['SERVIETTE'] },
  { id: 'uniformes', libelle: 'Uniformes', types: ['CHEMISE', 'T_SHIRT', 'PANTALON'] },
  { id: 'autre', libelle: 'Autres articles', types: ['AUTRE', 'VESTE', 'JEAN', 'JUPE', 'ROBE', 'COSTUME', 'BOUBOU'] },
]

const CATEGORIES: Record<ParcoursService, readonly DefinitionCategorie[]> = {
  pressing: CATEGORIES_PRESSING,
  blanchisserie: CATEGORIES_BLANCHISSERIE,
}

/** Libellé d'un type de vêtement, repris de la grille existante. */
const LIBELLES = new Map<OrderGarmentType, string>(
  GARMENT_GRID.map(({ type, label }) => [type, label]),
)

/** Catégories affichées pour un parcours, dans l'ordre. */
export function categoriesDuParcours(parcours: ParcoursService): readonly DefinitionCategorie[] {
  return CATEGORIES[parcours]
}

/**
 * Articles proposés, catégorie par catégorie.
 *
 * Les icônes sont celles de `public/images` via `getGarmentImage()` : le
 * mapping type → fichier reste centralisé dans `constants/garmentImages.ts`.
 * Un type présent dans deux catégories n'apparaît qu'une fois.
 */
export function articlesDuParcours(parcours: ParcoursService): ArticleGrille[] {
  const vus = new Set<OrderGarmentType>()
  const articles: ArticleGrille[] = []
  for (const categorie of categoriesDuParcours(parcours)) {
    for (const type of categorie.types) {
      if (vus.has(type)) continue
      vus.add(type)
      articles.push({
        type,
        libelle: LIBELLES.get(type) ?? type,
        image: getGarmentImage(type),
        categorie: categorie.libelle,
        favori: Boolean(GARMENT_GRID.find((ligne) => ligne.type === type)?.favori),
      })
    }
  }
  return articles
}

/** Filtre insensible à la casse et aux accents, sur le libellé de l'article. */
export function filtrerArticles(
  articles: readonly ArticleGrille[],
  recherche: string,
): ArticleGrille[] {
  const terme = normaliser(recherche.trim())
  if (!terme) return [...articles]
  return articles.filter((article) =>
    normaliser(`${article.libelle} ${article.categorie}`).includes(terme),
  )
}

function normaliser(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
}

/** Codes d'activité rattachés au parcours pressing. */
const CODES_PRESSING: ReadonlySet<TenantActivityCode> = new Set<TenantActivityCode>([
  'pressing',
  'nettoyage_sec',
  'repassage',
  'retouches',
  'collecte_livraison',
  'tapis_moquettes',
  'cuir',
])

/**
 * Parcours correspondant à une activité du pressing.
 *
 * Le code du référentiel fait foi quand il existe. À défaut (activité créée
 * librement par le propriétaire), on retombe sur les mots du nom — jamais sur
 * une supposition silencieuse : `null` signifie « on ne sait pas classer ».
 */
export function parcoursDepuisActivite(
  code: TenantActivityCode | null | undefined,
  nom: string | null | undefined,
): ParcoursService | null {
  if (code === 'blanchisserie') return 'blanchisserie'
  if (code && CODES_PRESSING.has(code)) return 'pressing'

  const texte = normaliser(nom ?? '')
  if (!texte) return null
  if (texte.includes('blanchiss')) return 'blanchisserie'
  if (
    texte.includes('pressing') ||
    texte.includes('repass') ||
    texte.includes('nettoyage') ||
    texte.includes('retouche') ||
    texte.includes('couture') ||
    texte.includes('cuir')
  ) {
    return 'pressing'
  }
  return null
}

/** Parcours d'une prestation, d'après le code ou le nom de son activité. */
export function parcoursDepuisPrestation(service: TenantServiceOffering): ParcoursService | null {
  return parcoursDepuisActivite(service.activityCode, service.activityName)
}

/** Prestations du parcours demandé, dans l'ordre du pressing. */
export function servicesDuParcours(
  services: readonly TenantServiceOffering[],
  parcours: ParcoursService,
): TenantServiceOffering[] {
  return services
    .filter((service) => parcoursDepuisPrestation(service) === parcours)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.serviceName.localeCompare(b.serviceName, 'fr'))
}

/** Prestations facturées au kilo (seules à porter un tarif configuré). */
export function servicesAuKilo(services: readonly TenantServiceOffering[]): TenantServiceOffering[] {
  return services.filter((service) => service.billingUnit === 'KG')
}

/** Prestations à la pièce. */
export function servicesALaPiece(services: readonly TenantServiceOffering[]): TenantServiceOffering[] {
  return services.filter((service) => service.billingUnit === 'PIECE')
}

/** Présentation des deux cartes de l'écran 1. */
export interface PresentationParcours {
  titre: string
  resume: string
  exemples: readonly string[]
}

export const PRESENTATION_PARCOURS: Record<ParcoursService, PresentationParcours> = {
  pressing: {
    titre: 'Pressing',
    resume: 'Vêtements traités à la pièce, lavés et repassés.',
    exemples: ['Chemises et pantalons', 'Robes et costumes', 'Repassage et retouches'],
  },
  blanchisserie: {
    titre: 'Blanchisserie',
    resume: 'Linge de maison et professionnel, facturé au kilo.',
    exemples: ['Draps et serviettes', 'Uniformes du personnel', 'Linge en volume'],
  },
}
