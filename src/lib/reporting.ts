import { ACTIVE_ORDER_STATUSES, ORDER_FLOW, ORDER_STATUSES, todayIso } from '@/constants/orders'
import type { LocalCashPayment, LocalOrder, LocalOrderItem } from '@/db/localDb'
import type { OrderStatus } from '@/types/database'
import { computeBalance } from '@/services/cashService'
import { shiftDay } from '@/services/dashboardService'

/**
 * Rapports et statistiques (écran 11).
 *
 * Tous les calculs sont **purs** et **locaux** : ils reçoivent les commandes,
 * les lignes et les encaissements déjà présents sur la tablette. Deux raisons :
 *
 *  - l'écran doit s'ouvrir hors ligne, comme le reste du pressing ;
 *  - un rapport recalculé côté serveur à chaque changement de période rendrait
 *    l'écran inutilisable en 3G, pour des volumes qui tiennent dans IndexedDB.
 *
 * Limite assumée, affichée à l'écran : seuls les encaissements **espèces** sont
 * journalisés localement. Le Mobile Money vient du serveur et n'entre donc pas
 * dans la courbe « encaissé ».
 */

/** Périodes proposées, en jours. */
export const PERIODES = [7, 30, 90] as const
export type Periode = (typeof PERIODES)[number]

/** Libellés des périodes, pour les onglets. */
export const PERIODE_LABELS: Record<Periode, string> = {
  7: '7 jours',
  30: '30 jours',
  90: '90 jours',
}

const JOURS_LONGS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

export interface PointJour {
  /** AAAA-MM-JJ */
  date: string
  /** Libellé court : « 12/10 » pour 30 et 90 jours, « lun. » pour 7 jours. */
  label: string
  /** Montant facturé (commandes créées ce jour-là, hors annulées). */
  facture: number
  /** Espèces encaissées ce jour-là. */
  encaisse: number
  /** Nombre de commandes créées ce jour-là. */
  commandes: number
}

export interface PartStatut {
  status: OrderStatus
  label: string
  count: number
  /** Part du total, entre 0 et 1 (0 si aucune commande). */
  part: number
}

export interface LignePrestation {
  label: string
  count: number
  amount: number
}

export interface JourSemaine {
  label: string
  commandes: number
  facture: number
}

export interface Variation {
  /** Pourcentage arrondi, ou `null` quand la période précédente est vide. */
  facture: number | null
  commandes: number | null
  panierMoyen: number | null
}

export interface Rapport {
  /** Première et dernière date couvertes, incluses. */
  debut: string
  fin: string
  jours: number
  /** Commandes créées pendant la période (hors annulées). */
  commandes: number
  /** Total facturé pendant la période. */
  facture: number
  /** Espèces encaissées pendant la période, toutes commandes confondues. */
  encaisse: number
  /** Facturé / nombre de commandes, arrondi au franc. */
  panierMoyen: number
  /** Reste à encaisser sur les commandes de la période encore ouvertes. */
  resteAEncaisser: number
  /** Commandes annulées pendant la période. */
  annulees: number
  parJour: PointJour[]
  parStatut: PartStatut[]
  topPrestations: LignePrestation[]
  parJourSemaine: JourSemaine[]
  /** Comparaison avec la période précédente, de même durée. */
  variation: Variation
}

/** Date locale (AAAA-MM-JJ) d'un horodatage ISO, sans décalage de fuseau. */
function jourDe(iso: string): string {
  return iso.slice(0, 10)
}

/** Bornes d'une période de `jours` jours se terminant aujourd'hui, incluses. */
export function bornesPeriode(jours: number, aujourdhui: string = todayIso()): {
  debut: string
  fin: string
} {
  const duree = Math.max(1, Math.round(jours))
  return { debut: shiftDay(aujourdhui, -(duree - 1)), fin: aujourdhui }
}

/** Liste des dates d'une période, de la plus ancienne à la plus récente. */
export function joursDeLaPeriode(debut: string, fin: string): string[] {
  const dates: string[] = []
  let courant = debut
  // Garde-fou : une période inversée ou absurde ne doit pas boucler sans fin.
  for (let garde = 0; courant <= fin && garde < 1000; garde += 1) {
    dates.push(courant)
    courant = shiftDay(courant, 1)
  }
  return dates
}

/** `2026-10-07` → `07/10`. */
export function labelCourt(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

/** Index du jour de semaine, 0 = lundi (et non 0 = dimanche comme `Date`). */
function indexJourSemaine(date: string): number {
  const [annee, mois, jour] = date.split('-').map(Number)
  const valeur = new Date(Date.UTC(annee ?? 1970, (mois ?? 1) - 1, jour ?? 1))
  return (valeur.getUTCDay() + 6) % 7
}

/**
 * Écart relatif en pourcentage, arrondi.
 *
 * `null` quand la base de comparaison est nulle : afficher « +100 % » sur une
 * période précédente vide laisserait croire à une croissance mesurée.
 */
export function variationPourcent(actuel: number, precedent: number): number | null {
  if (!Number.isFinite(actuel) || !Number.isFinite(precedent) || precedent === 0) return null
  return Math.round(((actuel - precedent) / precedent) * 100)
}

interface Totaux {
  commandes: number
  facture: number
  panierMoyen: number
}

/** Totaux d'une plage de dates, hors annulées. */
function totauxPeriode(
  orders: LocalOrder[],
  debut: string,
  fin: string,
): Totaux {
  const periode = orders.filter((order) => {
    const jour = jourDe(order.createdAt)
    return jour >= debut && jour <= fin && order.status !== 'cancelled'
  })
  const facture = periode.reduce((total, order) => total + order.totalAmount, 0)
  return {
    commandes: periode.length,
    facture,
    panierMoyen: periode.length > 0 ? Math.round(facture / periode.length) : 0,
  }
}

export function computeRapport(
  orders: LocalOrder[],
  items: LocalOrderItem[],
  cashPayments: LocalCashPayment[],
  options: { jours: number; aujourdhui?: string } = { jours: 30 },
): Rapport {
  const aujourdhui = options.aujourdhui ?? todayIso()
  const { debut, fin } = bornesPeriode(options.jours, aujourdhui)
  const dates = joursDeLaPeriode(debut, fin)

  const commandesPeriode = orders.filter((order) => {
    const jour = jourDe(order.createdAt)
    return jour >= debut && jour <= fin
  })
  const retenues = commandesPeriode.filter((order) => order.status !== 'cancelled')

  const facture = retenues.reduce((total, order) => total + order.totalAmount, 0)

  const encaissementsPeriode = cashPayments.filter((paiement) => {
    const jour = jourDe(paiement.receivedAt)
    return jour >= debut && jour <= fin
  })
  const encaisse = encaissementsPeriode.reduce((total, paiement) => total + paiement.amount, 0)

  // Reste à encaisser : même calcul que le comptoir et la fiche commande, pour
  // que trois écrans ne donnent jamais trois chiffres différents.
  const parCommande = new Map<string, LocalCashPayment[]>()
  for (const paiement of cashPayments) {
    const liste = parCommande.get(paiement.orderId) ?? []
    liste.push(paiement)
    parCommande.set(paiement.orderId, liste)
  }
  const resteAEncaisser = retenues
    .filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status))
    .reduce(
      (total, order) =>
        total +
        computeBalance(order.totalAmount, order.paymentStatus, parCommande.get(order.id) ?? [])
          .remaining,
      0,
    )

  const parJour: PointJour[] = dates.map((date) => {
    const duJour = retenues.filter((order) => jourDe(order.createdAt) === date)
    return {
      date,
      label: labelCourt(date),
      facture: duJour.reduce((total, order) => total + order.totalAmount, 0),
      encaisse: encaissementsPeriode
        .filter((paiement) => jourDe(paiement.receivedAt) === date)
        .reduce((total, paiement) => total + paiement.amount, 0),
      commandes: duJour.length,
    }
  })

  // `ORDER_FLOW` décrit le parcours de production : il ne contient pas
  // l'annulation. Un rapport qui masquerait les annulations laisserait croire
  // que toutes les commandes saisies ont été fabriquées — on l'ajoute donc
  // après la boucle, et seulement si elle existe dans la période.
  const statutsAffiches: OrderStatus[] = [...ORDER_FLOW]
  if (commandesPeriode.some((order) => order.status === 'cancelled')) {
    statutsAffiches.push('cancelled')
  }

  const parStatut: PartStatut[] = statutsAffiches.map((status) => {
    const count = commandesPeriode.filter((order) => order.status === status).length
    return {
      status,
      label: ORDER_STATUSES[status].shortLabel,
      count,
      part: commandesPeriode.length > 0 ? count / commandesPeriode.length : 0,
    }
  })

  const parPrestation = new Map<string, LignePrestation>()
  const idsRetenues = new Set(retenues.map((order) => order.id))
  for (const item of items) {
    if (!idsRetenues.has(item.orderId)) continue
    const libelle = item.serviceName?.trim() || item.label
    const existant = parPrestation.get(libelle) ?? { label: libelle, count: 0, amount: 0 }
    existant.count += 1
    existant.amount += item.price
    parPrestation.set(libelle, existant)
  }
  const topPrestations = [...parPrestation.values()]
    .sort((a, b) => b.count - a.count || b.amount - a.amount)
    .slice(0, 5)

  const parJourSemaine: JourSemaine[] = JOURS_LONGS.map((label, index) => {
    const duJour = retenues.filter((order) => indexJourSemaine(jourDe(order.createdAt)) === index)
    return {
      label,
      commandes: duJour.length,
      facture: duJour.reduce((total, order) => total + order.totalAmount, 0),
    }
  })

  // Période précédente : mêmes bornes moins la durée, pour comparer des
  // semaines complètes plutôt que des jours ouvrés isolés.
  const precedent = bornesPeriode(options.jours, shiftDay(debut, -1))
  const avant = totauxPeriode(orders, precedent.debut, precedent.fin)

  return {
    debut,
    fin,
    jours: dates.length,
    commandes: retenues.length,
    facture,
    encaisse,
    panierMoyen: retenues.length > 0 ? Math.round(facture / retenues.length) : 0,
    resteAEncaisser,
    annulees: commandesPeriode.filter((order) => order.status === 'cancelled').length,
    parJour,
    parStatut,
    topPrestations,
    parJourSemaine,
    variation: {
      facture: variationPourcent(facture, avant.facture),
      commandes: variationPourcent(retenues.length, avant.commandes),
      panierMoyen: variationPourcent(
        retenues.length > 0 ? facture / retenues.length : 0,
        avant.panierMoyen,
      ),
    },
  }
}

/**
 * Export CSV de la série quotidienne.
 *
 * Séparateur `;` et virgule décimale : c'est ce qu'attend un tableur configuré
 * en français. Les montants restent entiers (le franc CFA n'a pas de centime).
 * Le BOM est ajouté à l'écriture du fichier, pas ici : ce module reste pur.
 */
export function rapportCsv(rapport: Rapport): string {
  const lignes = ['date;facture;encaisse;commandes']
  for (const point of rapport.parJour) {
    lignes.push(`${point.date};${point.facture};${point.encaisse};${point.commandes}`)
  }
  lignes.push('')
  lignes.push(`total;${rapport.facture};${rapport.encaisse};${rapport.commandes}`)
  return lignes.join('\n')
}
