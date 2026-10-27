import {
  ACTIVE_ORDER_STATUSES,
  ORDER_FLOW,
  ORDER_STATUSES,
  isOrderLate,
  todayIso,
} from '@/constants/orders'
import type { LocalCashPayment, LocalOrder, LocalOrderItem } from '@/db/localDb'
import type { OrderStatus } from '@/types/database'
import { computeBalance } from '@/services/cashService'

/**
 * Tableau de bord du propriétaire (palier 3).
 *
 * Tous les indicateurs sont calculés **localement** à partir des commandes et
 * des encaissements présents sur la tablette : le tableau de bord reste donc
 * consultable hors ligne, et il ne dépend pas d'une agrégation serveur lente.
 *
 * Deux limites assumées, affichées à l'écran :
 *  - les encaissements **Mobile Money** ne sont pas journalisés localement :
 *    ils viennent du serveur, et sont marqués indisponibles hors ligne ;
 *  - les **dépenses** sont lues au serveur (propriétaire uniquement).
 */

/**
 * Cinq dernières commandes, de la plus récente à la plus ancienne.
 *
 * L'ordre suit `createdAt` (horodatage ISO, donc comparable tel quel) et non
 * `updatedAt` : une commande ancienne qui change de statut ne doit pas
 * remonter en tête des « dernières arrivées ».
 */
export function recentOrders(orders: LocalOrder[], limit = 5): LocalOrder[] {
  return [...orders]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, Math.max(0, limit))
}

export interface DailyPoint {
  /** AAAA-MM-JJ */
  date: string
  /** Libellé court (« lun. », « mar. »…). */
  label: string
  cash: number
}

export interface TopService {
  label: string
  count: number
  amount: number
}

export interface DashboardSnapshot {
  today: string
  /** Commandes enregistrées aujourd'hui. */
  ordersToday: number
  /** Commandes enregistrées la veille (base des variations affichées). */
  ordersYesterday: number
  /** Commandes encore en atelier (hors livrées et annulées). */
  activeOrders: number
  /** Commandes prêtes à retirer. */
  readyOrders: number
  /** Commandes en retard. */
  lateOrders: number
  /** Somme des restes à encaisser sur les commandes actives. */
  outstanding: number
  /** Espèces encaissées aujourd'hui. */
  cashToday: number
  /** Espèces encaissées la veille (base des variations affichées). */
  cashYesterday: number
  /** Espèces encaissées sur les sept derniers jours. */
  cashWeek: number
  /** Panier moyen (commandes non annulées). */
  averageBasket: number
  /** Série de sept jours, du plus ancien au plus récent. */
  series: DailyPoint[]
  /** Répartition par statut, dans l'ordre du parcours. */
  byStatus: Array<{ status: OrderStatus; label: string; count: number }>
  /** Prestations les plus facturées (par nombre de lignes). */
  topServices: TopService[]
}

const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

/** Date locale (AAAA-MM-JJ) d'un horodatage ISO, sans décalage de fuseau. */
function jourDe(iso: string): string {
  return iso.slice(0, 10)
}

/** Décale une date AAAA-MM-JJ de `delta` jours. */
export function shiftDay(date: string, delta: number): string {
  const [annee, mois, jour] = date.split('-').map(Number)
  const valeur = new Date(Date.UTC(annee ?? 1970, (mois ?? 1) - 1, jour ?? 1))
  valeur.setUTCDate(valeur.getUTCDate() + delta)
  return valeur.toISOString().slice(0, 10)
}

/** Libellé court d'un jour, en français, sans dépendre de l'ICU du navigateur. */
export function shortDayLabel(date: string): string {
  const [annee, mois, jour] = date.split('-').map(Number)
  const valeur = new Date(Date.UTC(annee ?? 1970, (mois ?? 1) - 1, jour ?? 1))
  return JOURS_COURTS[valeur.getUTCDay()] ?? ''
}

export function computeDashboard(
  orders: LocalOrder[],
  items: LocalOrderItem[],
  cashPayments: LocalCashPayment[],
  today: string = todayIso(),
): DashboardSnapshot {
  const actives = orders.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status))
  const nonAnnulees = orders.filter((order) => order.status !== 'cancelled')

  const ordersToday = orders.filter(
    (order) => jourDe(order.createdAt) === today && order.status !== 'cancelled',
  ).length

  const hier = shiftDay(today, -1)
  const ordersYesterday = orders.filter(
    (order) => jourDe(order.createdAt) === hier && order.status !== 'cancelled',
  ).length

  const cashYesterday = cashPayments
    .filter((paiement) => jourDe(paiement.receivedAt) === hier)
    .reduce((total, paiement) => total + paiement.amount, 0)

  const cashToday = cashPayments
    .filter((paiement) => jourDe(paiement.receivedAt) === today)
    .reduce((total, paiement) => total + paiement.amount, 0)

  const debutSemaine = shiftDay(today, -6)
  const cashWeek = cashPayments
    .filter((paiement) => {
      const jour = jourDe(paiement.receivedAt)
      return jour >= debutSemaine && jour <= today
    })
    .reduce((total, paiement) => total + paiement.amount, 0)

  // Reste à encaisser : on s'appuie sur le même calcul que le comptoir, pour
  // que le tableau de bord et la fiche commande ne divergent jamais.
  const encaissementsParCommande = new Map<string, LocalCashPayment[]>()
  for (const paiement of cashPayments) {
    const liste = encaissementsParCommande.get(paiement.orderId) ?? []
    liste.push(paiement)
    encaissementsParCommande.set(paiement.orderId, liste)
  }

  const outstanding = actives.reduce((total, order) => {
    const solde = computeBalance(
      order.totalAmount,
      order.paymentStatus,
      encaissementsParCommande.get(order.id) ?? [],
    )
    return total + solde.remaining
  }, 0)

  const series: DailyPoint[] = []
  for (let decalage = 6; decalage >= 0; decalage -= 1) {
    const date = shiftDay(today, -decalage)
    const montant = cashPayments
      .filter((paiement) => jourDe(paiement.receivedAt) === date)
      .reduce((total, paiement) => total + paiement.amount, 0)

    series.push({ date, label: shortDayLabel(date), cash: montant })
  }

  const byStatus = ORDER_FLOW.map((status) => ({
    status,
    label: ORDER_STATUSES[status].shortLabel,
    count: orders.filter((order) => order.status === status).length,
  }))

  const parPrestation = new Map<string, TopService>()
  for (const item of items) {
    const commande = orders.find((order) => order.id === item.orderId)
    if (!commande || commande.status === 'cancelled') continue

    const libelle = item.serviceName?.trim() || item.label
    const existant = parPrestation.get(libelle) ?? { label: libelle, count: 0, amount: 0 }
    existant.count += 1
    existant.amount += item.price
    parPrestation.set(libelle, existant)
  }

  const topServices = [...parPrestation.values()]
    .sort((a, b) => b.count - a.count || b.amount - a.amount)
    .slice(0, 5)

  const totalFacture = nonAnnulees.reduce((total, order) => total + order.totalAmount, 0)

  return {
    today,
    ordersToday,
    ordersYesterday,
    activeOrders: actives.length,
    readyOrders: orders.filter((order) => order.status === 'ready').length,
    lateOrders: orders.filter((order) => isOrderLate(order, today)).length,
    outstanding,
    cashToday,
    cashYesterday,
    cashWeek,
    averageBasket: nonAnnulees.length > 0 ? Math.round(totalFacture / nonAnnulees.length) : 0,
    series,
    byStatus,
    topServices,
  }
}

/**
 * Variation en pourcentage entre deux valeurs.
 *
 * Renvoie `null` plutôt qu'un chiffre quand la base est nulle ou négative : on
 * ne peut pas annoncer « +100 % » sur une journée où rien n'a été encaissé, et
 * une carte qui afficherait « +∞ % » ou « +0 % » mentirait dans les deux cas.
 * L'appelant masque alors simplement la variation.
 */
export function variationPourcent(actuel: number, precedent: number): number | null {
  if (!Number.isFinite(actuel) || !Number.isFinite(precedent) || precedent <= 0) return null
  return Math.round(((actuel - precedent) / precedent) * 100)
}

/** Début du mois courant, au format AAAA-MM-JJ. */
export function startOfMonth(date: string = todayIso()): string {
  return `${date.slice(0, 7)}-01`
}
