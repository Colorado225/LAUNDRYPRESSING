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
  coutConsommables: number | null
  margeApresConsommables: number | null
}

export interface CoutConsommableParLigne {
  order_item_id: string
  cost_amount: number
  missing_cost_movements: number
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
  /** Coûts directs saisis par sortie de stock et rattachés à une ligne. */
  coutConsommables: number | null
  /** Facturé moins les consommables imputés ; n’inclut pas les charges fixes. */
  margeApresConsommables: number | null
  lignesAvecConsommation: number
  mouvementsSansCout: number
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
  options: {
    jours: number
    aujourdhui?: string
    /** `null` signifie que la lecture serveur n’est pas disponible ; `[]` = aucun coût imputé. */
    stockCosts?: CoutConsommableParLigne[] | null
  } = { jours: 30 },
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
  const commandesPrecedentes = orders.filter((order) => {
    const jour = jourDe(order.createdAt)
    return jour >= precedent.debut && jour <= precedent.fin && order.status !== 'cancelled'
  })
  const avant = totauxPeriode(orders, precedent.debut, precedent.fin)
  const coutsDisponibles = options.stockCosts != null

  const coutsPourCommandes = (commandes: LocalOrder[]) => {
    if (!coutsDisponibles) return null
    const idsCommandes = new Set(commandes.map((order) => order.id))
    const idsLignes = new Set(items.filter((item) => idsCommandes.has(item.orderId)).map((item) => item.id))
    const lignesAvecCout = (options.stockCosts ?? []).filter((row) => idsLignes.has(row.order_item_id))
    return {
      montant: lignesAvecCout.reduce((total, row) => total + row.cost_amount, 0),
      lignes: lignesAvecCout.length,
      mouvementsSansCout: lignesAvecCout.reduce((total, row) => total + row.missing_cost_movements, 0),
    }
  }
  const coutsCourants = coutsPourCommandes(retenues)
  const coutsPrecedents = coutsPourCommandes(commandesPrecedentes)

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
    coutConsommables: coutsCourants?.montant ?? null,
    margeApresConsommables:
      coutsCourants === null ? null : facture - coutsCourants.montant,
    lignesAvecConsommation: coutsCourants?.lignes ?? 0,
    mouvementsSansCout: coutsCourants?.mouvementsSansCout ?? 0,
    variation: {
      facture: variationPourcent(facture, avant.facture),
      commandes: variationPourcent(retenues.length, avant.commandes),
      panierMoyen: variationPourcent(
        retenues.length > 0 ? facture / retenues.length : 0,
        avant.panierMoyen,
      ),
      coutConsommables:
        coutsCourants === null || coutsPrecedents === null
          ? null
          : variationPourcent(coutsCourants.montant, coutsPrecedents.montant),
      margeApresConsommables:
        coutsCourants === null || coutsPrecedents === null
          ? null
          : variationPourcent(
              facture - coutsCourants.montant,
              avant.facture - coutsPrecedents.montant,
            ),
    },
  }
}

/** Protège les cellules contenant séparateurs, retours à la ligne ou formules de tableur. */
function celluleCsv(valeur: string | number): string {
  const texte = String(valeur)
  const protege = typeof valeur === 'string' && /^[=+\-@\t\r]/.test(texte) ? `'${texte}` : texte
  return /[;"\r\n]/.test(protege) ? `"${protege.replace(/"/g, '""')}"` : protege
}

function ligneCsv(valeurs: Array<string | number>): string {
  return valeurs.map(celluleCsv).join(';')
}

/**
 * Export complet compatible avec les tableurs francophones : synthèse,
 * comparaison, série quotidienne, statuts et prestations. Le séparateur `;`
 * évite les conflits avec la virgule décimale ; les montants sont en FCFA.
 * Le BOM est ajouté à l'écriture du fichier, pas ici : ce module reste pur.
 */
export function rapportCsv(rapport: Rapport): string {
  const lignes = [
    ligneCsv(['Synthèse', 'Indicateur', 'Valeur']),
    ligneCsv(['Période', `${rapport.debut} → ${rapport.fin}`, rapport.jours]),
    ligneCsv(['Synthèse', 'Facturé (FCFA)', rapport.facture]),
    ligneCsv(['Synthèse', 'Espèces encaissées (FCFA)', rapport.encaisse]),
    ligneCsv(['Synthèse', 'Commandes', rapport.commandes]),
    ligneCsv(['Synthèse', 'Annulations', rapport.annulees]),
    ligneCsv(['Synthèse', 'Panier moyen (FCFA)', rapport.panierMoyen]),
    ligneCsv(['Synthèse', 'Coûts de consommables imputés (FCFA)', rapport.coutConsommables ?? 'indisponible']),
    ligneCsv(['Synthèse', 'Marge après consommables imputés (FCFA)', rapport.margeApresConsommables ?? 'indisponible']),
    ligneCsv(['Synthèse', 'Lignes avec consommation imputée', rapport.lignesAvecConsommation]),
    ligneCsv(['Synthèse', 'Mouvements sans coût unitaire', rapport.mouvementsSansCout]),
    ligneCsv(['Comparaison', 'Variation du facturé (%)', rapport.variation.facture ?? 'n.d.']),
    ligneCsv(['Comparaison', 'Variation des commandes (%)', rapport.variation.commandes ?? 'n.d.']),
    ligneCsv(['Comparaison', 'Variation du coût consommables (%)', rapport.variation.coutConsommables ?? 'n.d.']),
    ligneCsv(['Comparaison', 'Variation de la marge après consommables (%)', rapport.variation.margeApresConsommables ?? 'n.d.']),
    '',
    ligneCsv(['Série quotidienne']),
    ligneCsv(['Date', 'Facturé (FCFA)', 'Espèces (FCFA)', 'Commandes']),
  ]
  for (const point of rapport.parJour) {
    lignes.push(ligneCsv([point.date, point.facture, point.encaisse, point.commandes]))
  }
  lignes.push(ligneCsv(['Total', rapport.facture, rapport.encaisse, rapport.commandes]))
  lignes.push('', ligneCsv(['Répartition par statut']), ligneCsv(['Statut', 'Commandes', 'Part (%)']))
  for (const part of rapport.parStatut) {
    if (part.count > 0) lignes.push(ligneCsv([part.label, part.count, Math.round(part.part * 100)]))
  }
  lignes.push('', ligneCsv(['Prestations les plus demandées']), ligneCsv(['Prestation', 'Lignes', 'Facturé (FCFA)']))
  for (const prestation of rapport.topPrestations) {
    lignes.push(ligneCsv([prestation.label, prestation.count, prestation.amount]))
  }
  return lignes.join('\n')
}
