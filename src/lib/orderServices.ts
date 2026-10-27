import { GARMENT_GRID, getGarmentImage } from '@/constants/garmentImages'
import type { TenantActivityCode, OrderGarmentType } from '@/types/database'
import type { TenantServiceOffering } from '@/services/tenantServices'

/**
 * Parcours de commande : deux gestes différents au comptoir.
 *
 *  - **pressing** : des vêtements identifiés un par un, facturés à la pièce ;
 *  - **blanchisserie** : du linge de maison ou professionnel (drap, serviette,
 *    uniforme…), facturé **au nombre de vêtements** d'après le prix par article
 *    configuré dans « Services & activités » ; le kilo reste disponible en
 *    option quand la prestation est configurée au kilo.
 *
 * Ce module ne contient **que des règles pures** : quelles catégories afficher,
 * quel parcours correspond à une activité du pressing, quels articles sont
 * proposés. Il ne touche ni au stockage ni au réseau, ce qui le rend testable
 * et réutilisable par les écrans comme par les tests.
 *
 * ⚠️ Aucun tarif n'est inventé ici. Les prix viennent de la saisie au comptoir
 *    ou du tarif configuré dans « Services & activités » — par pièce pour un
 *    article, au kilo pour une prestation pesée. Les anciens forfaits
 *    commerciaux (paquets de 2 kg…) ont été retirés du schéma par la migration
 *    020 : le « forfait » d'aujourd'hui, c'est le prix par article.
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

/**
 * Prestation à la pièce qui porte le tarif d'un article donné.
 *
 * Le lien entre un article de la grille (« Drap ») et une prestation
 * configurée (« Drap », 500 FCFA) est le **nom** : c'est ainsi que le
 * propriétaire saisit son forfait par article. On compare sans casse ni
 * accents, puis on tolère un libellé plus précis (« Lavage drap »). Aucun
 * rapprochement approximatif au-delà : `null` signifie « pas de tarif
 * configuré pour cet article », et le prix se saisit alors au comptoir.
 */
export function prestationPourArticle(
  services: readonly TenantServiceOffering[],
  type: OrderGarmentType,
  libelle?: string,
): TenantServiceOffering | null {
  const cible = normaliser(libelle ?? LIBELLES.get(type) ?? type)
  if (!cible) return null
  const pieces = servicesALaPiece(services)
  return (
    pieces.find((service) => normaliser(service.serviceName) === cible) ??
    pieces.find((service) => {
      const nom = normaliser(service.serviceName)
      return nom.length > 0 && (nom.includes(cible) || cible.includes(nom))
    }) ??
    null
  )
}

/**
 * Mode de facturation proposé d'emblée en blanchisserie : **à la pièce** dès
 * qu'un prix par article existe, au kilo sinon. Le comptoir peut toujours
 * basculer vers l'autre mode ; ce choix ne fait que décider de l'écran affiché.
 */
export function modeFacturationParDefaut(
  services: readonly TenantServiceOffering[],
): 'piece' | 'kilo' {
  return servicesALaPiece(services).length > 0 ? 'piece' : 'kilo'
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
    resume: 'Linge de maison et professionnel, facturé au nombre de vêtements.',
    exemples: ['Draps et serviettes', 'Uniformes du personnel', 'Linge en volume'],
  },
}
