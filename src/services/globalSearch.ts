import { ORDER_STATUSES } from '@/constants/orders'
import { shortOrderReference } from '@/services/qrService'
import type { LocalOrder } from '@/db/localDb'

/**
 * Recherche globale de l'en-tête.
 *
 * Elle interroge **ce que l'appareil possède déjà** : les commandes enregistrées
 * dans IndexedDB et les destinations de l'application. Aucune requête réseau :
 * la barre de recherche doit répondre en mode avion, comme le reste de
 * l'application.
 *
 * Ce qu'elle ne fait pas (et n'annonce donc pas) : chercher dans un répertoire
 * clients serveur, qui n'existe pas dans le schéma. Les clients trouvés sont
 * ceux qui apparaissent dans les commandes — ce qui couvre l'usage réel au
 * comptoir (« le monsieur d'hier »).
 */

export type TypeResultat = 'commande' | 'page'

export interface ResultatRecherche {
  id: string
  type: TypeResultat
  titre: string
  detail: string
  /** Destination : fiche de commande ou page de l'application. */
  to: string
}

/** Destination navigable proposée par la recherche (miroir réduit du menu). */
export interface DestinationRecherche {
  to: string
  label: string
  /** Mots supplémentaires qui doivent aussi faire correspondre. */
  motsCles?: string
}

const DESTINATIONS: readonly DestinationRecherche[] = [
  { to: '/tableau-de-bord', label: 'Tableau de bord', motsCles: 'accueil kpi statistiques' },
  { to: '/commandes/nouvelle', label: 'Nouvelle commande', motsCles: 'réception créer pos' },
  { to: '/commandes', label: 'Commandes', motsCles: 'liste tickets' },
  { to: '/atelier', label: 'Atelier', motsCles: 'production kanban suivi' },
  { to: '/caisse', label: 'Caisse', motsCles: 'encaissement espèces' },
  { to: '/clients', label: 'Clients', motsCles: 'fichier carnet' },
  { to: '/stock', label: 'Stock', motsCles: 'fournitures inventaire' },
  { to: '/depenses', label: 'Dépenses', motsCles: 'charges achats' },
  { to: '/rapports', label: 'Rapports', motsCles: 'bilan chiffre affaires' },
  { to: '/prestations', label: 'Services & activités', motsCles: 'catalogue tarifs prix' },
  { to: '/parametres', label: 'Paramètres', motsCles: 'réglages configuration' },
]

/** Minuscules, sans accents : « Koné » se trouve en tapant « kone ». */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .trim()
}

/** Chiffres seuls, pour comparer des téléphones saisis avec ou sans espaces. */
function chiffres(texte: string): string {
  return texte.replace(/\D/g, '')
}

/**
 * Résultats pour un terme donné.
 *
 * Ordre volontaire : les **commandes** d'abord (c'est ce qu'on cherche au
 * comptoir), puis les pages. Chaque catégorie est plafonnée pour que la liste
 * reste lisible sur une tablette.
 */
export function rechercherGlobalement(
  terme: string,
  commandes: readonly LocalOrder[],
  limite = 6,
): ResultatRecherche[] {
  const recherche = normaliser(terme)
  if (recherche.length < 2) return []

  const digits = chiffres(recherche)

  const commandesTrouvees: ResultatRecherche[] = []
  for (const commande of commandes) {
    const reference = shortOrderReference(commande.id)
    const nom = normaliser(commande.customerName ?? '')
    // Un numéro de téléphone se compare chiffre à chiffre : « 0709 » doit
    // trouver « 07 09 44 12 08 ».
    const telephone = chiffres(commande.customerPhone ?? '')

    const correspond =
      normaliser(reference).includes(recherche) ||
      nom.includes(recherche) ||
      (digits.length >= 3 && telephone.includes(digits))

    if (!correspond) continue

    commandesTrouvees.push({
      id: commande.id,
      type: 'commande',
      titre: `${reference} · ${commande.customerName || 'Client sans nom'}`,
      detail: `${ORDER_STATUSES[commande.status].label} · ${commande.customerPhone ?? 'sans téléphone'}`,
      to: `/commandes/${commande.id}`,
    })

    if (commandesTrouvees.length >= limite) break
  }

  const pages: ResultatRecherche[] = DESTINATIONS.filter((destination) =>
    normaliser(`${destination.label} ${destination.motsCles ?? ''}`).includes(recherche),
  )
    .slice(0, 3)
    .map((destination) => ({
      id: destination.to,
      type: 'page',
      titre: destination.label,
      detail: 'Page de l’application',
      to: destination.to,
    }))

  return [...commandesTrouvees, ...pages]
}
