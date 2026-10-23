import type { LocalOrder } from '@/db/localDb'
import { formatDateFr } from './formatters'
import { shortOrderReference } from '@/services/qrService'

/**
 * Prévenir le client — logique pure.
 *
 * Le pressing n'envoie **rien** lui-même : il ouvre WhatsApp (ou le composeur)
 * avec un message déjà écrit. Aucun fournisseur, aucun coût par message, aucun
 * compte à créer — et le client reçoit le message d'un numéro qu'il connaît,
 * donc il répond.
 *
 * Ce module ne touche ni au réseau ni à la base : il produit des liens et des
 * phrases, ce qui permet de les tester exactement, accents compris.
 */

export type CanalNotification = 'whatsapp' | 'appel'

export type MotifNotification = 'pret' | 'retard' | 'relance'

export const CANAUX: Record<CanalNotification, string> = {
  whatsapp: 'WhatsApp',
  appel: 'Appel',
}

/**
 * Trois motifs, trois situations distinctes.
 *
 * `retard` et `relance` ne disent pas la même chose au client : dans un cas le
 * pressing s'excuse d'un retard de traitement, dans l'autre le linge attend
 * depuis un moment. Les confondre ferait promettre une commande qui n'est pas
 * prête.
 */
export const MOTIFS: Record<MotifNotification, { label: string; description: string }> = {
  pret: {
    label: 'Commande prête',
    description: 'Le linge est prêt à être retiré, dans les délais.',
  },
  retard: {
    label: 'Retard de traitement',
    description: 'L’échéance promise est dépassée et la commande n’est pas encore prête.',
  },
  relance: {
    label: 'Linge non retiré',
    description: 'La commande est prête depuis l’échéance, mais le client ne l’a pas retirée.',
  },
}

/**
 * Numéro au format international, sans `+` ni espaces — celui qu'attend `wa.me`.
 *
 * Les numéros ivoiriens s'écrivent sur 10 chiffres depuis 2021 (01, 05, 07,
 * 21, 25, 27…) et l'indicatif 225 ne fait pas partie du numéro : sans cette
 * normalisation, `wa.me` ouvre une conversation avec un numéro inexistant.
 */
export function numeroInternational(telephone: string | null | undefined): string | null {
  if (!telephone) return null

  const chiffres = telephone.replace(/\D/g, '')
  if (chiffres.length === 0) return null

  // Déjà international (225 + 10 chiffres).
  if (chiffres.startsWith('225') && chiffres.length === 13) return chiffres

  if (chiffres.length === 10) return `225${chiffres}`

  // Numéro étranger ou format inconnu : on ne devine pas l'indicatif.
  if (chiffres.length >= 8 && chiffres.length <= 15) return chiffres

  return null
}

/** Lien WhatsApp pré-rempli, ou `null` si le numéro est inexploitable. */
export function lienWhatsApp(
  telephone: string | null | undefined,
  message: string,
): string | null {
  const numero = numeroInternational(telephone)
  if (!numero) return null
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`
}

/** Lien d'appel (`tel:`), ou `null` si le numéro est inexploitable. */
export function lienAppel(telephone: string | null | undefined): string | null {
  const numero = numeroInternational(telephone)
  return numero ? `tel:+${numero}` : null
}

export interface ContexteMessage {
  /** Nom du client ; vide ou inconnu donne « Bonjour ». */
  customerName: string
  /** Nom du pressing, tel qu'il apparaît sur le reçu. */
  pressing: string
  /** Identifiant de la commande, abrégé en `CMD-XXXXXX`. */
  orderId: string
  /** Échéance promise (`AAAA-MM-JJ`), `null` si aucune. */
  dueDate: string | null
  /** Statut de la commande, pour distinguer un retard d'une commande prête. */
  status: LocalOrder['status']
}

function salutation(customerName: string): string {
  const nom = customerName.trim().split(/\s+/)[0] ?? ''
  return nom ? `Bonjour ${nom}` : 'Bonjour'
}

function echeance(dueDate: string | null): string {
  return dueDate ? formatDateFr(dueDate) : 'la date convenue'
}

/**
 * Message proposé pour un motif donné.
 *
 * Volontairement court : un message long n'est pas lu au comptoir, et WhatsApp
 * le tronque derrière « Lire la suite ». Aucun montant n'y figure — un prix
 * contesté se règle de vive voix, pas par message.
 */
export function messageNotification(motif: MotifNotification, contexte: ContexteMessage): string {
  const reference = shortOrderReference(contexte.orderId)
  const pressing = contexte.pressing.trim() || 'votre pressing'
  const debut = salutation(contexte.customerName)

  switch (motif) {
    case 'pret':
      return `${debut}, votre linge est prêt chez ${pressing}. Commande ${reference}. Vous pouvez venir le retirer. Merci !`
    case 'retard':
      return `${debut}, nous avons pris du retard sur votre commande ${reference} chez ${pressing} (prévue le ${echeance(contexte.dueDate)}). Nous vous préviendrons dès qu’elle est prête. Merci de votre patience.`
    case 'relance':
      return `${debut}, votre commande ${reference} vous attend chez ${pressing} depuis le ${echeance(contexte.dueDate)}. Merci de venir la retirer aux heures d’ouverture.`
  }
}

/** Notification enregistrée, réduite à ce dont le calcul a besoin. */
export interface NotificationConnue {
  orderId: string | null
  reason: MotifNotification
  createdAt: string
}

export interface Proposition {
  order: LocalOrder
  motif: MotifNotification
  message: string
  whatsapp: string | null
  appel: string | null
  /** `true` quand le client a déjà été prévenu depuis le dernier changement. */
  dejaPrevenu: boolean
}

function estActive(order: LocalOrder): boolean {
  return order.status !== 'delivered' && order.status !== 'cancelled'
}

/**
 * Motif à proposer pour une commande, ou `null` si elle n'appelle rien.
 *
 * La règle tient en une phrase : une commande prête se signale ; une commande
 * dont l'échéance est passée se signale aussi, mais avec le bon message.
 * Les commandes livrées ou annulées ne se signalent jamais.
 */
export function motifPour(order: LocalOrder, today: string): MotifNotification | null {
  if (!estActive(order)) return null

  const enRetard = order.dueDate !== null && order.dueDate < today

  if (order.status === 'ready') return enRetard ? 'relance' : 'pret'
  if (enRetard) return 'retard'

  return null
}

/**
 * Commandes à prévenir maintenant, les urgences d'abord.
 *
 * Une commande est considérée comme déjà prévenue si une notification a été
 * enregistrée **après son dernier changement** : changer le statut ou
 * l'échéance la remet donc dans la liste, ce qui est le comportement attendu
 * (le client doit être prévenu de la nouvelle situation).
 */
export function clientsAPrevenir(
  orders: readonly LocalOrder[],
  notifications: readonly NotificationConnue[],
  options: { today: string; pressing: string },
): Proposition[] {
  const derniereParCommande = new Map<string, string>()

  for (const notification of notifications) {
    if (!notification.orderId) continue
    const connue = derniereParCommande.get(notification.orderId)
    if (!connue || notification.createdAt > connue) {
      derniereParCommande.set(notification.orderId, notification.createdAt)
    }
  }

  const propositions: Proposition[] = []

  for (const order of orders) {
    const motif = motifPour(order, options.today)
    if (!motif) continue

    const derniere = derniereParCommande.get(order.id)
    const dejaPrevenu = derniere !== undefined && derniere >= order.updatedAt

    const message = messageNotification(motif, {
      customerName: order.customerName,
      pressing: options.pressing,
      orderId: order.id,
      dueDate: order.dueDate,
      status: order.status,
    })

    propositions.push({
      order,
      motif,
      message,
      whatsapp: lienWhatsApp(order.customerPhone, message),
      appel: lienAppel(order.customerPhone),
      dejaPrevenu,
    })
  }

  return propositions
    .filter((proposition) => !proposition.dejaPrevenu)
    .sort((a, b) => {
      // Les retards d'abord : ce sont eux qui font perdre un client.
      const urgence = (motif: MotifNotification) => (motif === 'retard' ? 0 : motif === 'relance' ? 1 : 2)
      const difference = urgence(a.motif) - urgence(b.motif)
      if (difference !== 0) return difference

      // Puis l'échéance la plus ancienne.
      return (a.order.dueDate ?? '9999-12-31').localeCompare(b.order.dueDate ?? '9999-12-31')
    })
}
