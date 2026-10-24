import { ORDER_STATUSES, PAYMENT_METHOD_LABELS } from '@/constants/orders'
import type { LocalCashPayment, LocalOrder, LocalOrderItem } from '@/db/localDb'
import { computeBalance } from '@/services/cashService'

/**
 * Facturation (écran facture A4).
 *
 * Tout est **pur** et calculé depuis les données locales : une facture doit
 * pouvoir s'imprimer au comptoir, hors ligne, y compris pour un encaissement
 * qui n'est pas encore transmis au serveur.
 *
 * Deux principes :
 *  - le **numéro de facture est déterministe** (aucun compteur à stocker, donc
 *    aucun trou ni doublon si la tablette est réinstallée) ;
 *  - **aucune TVA n'est inventée**. Le régime fiscal d'un pressing ivoirien
 *    n'est pas connu de l'application : afficher un taux arbitraire produirait
 *    une fausse facture. Le document reste un reçu-facture de prestation, avec
 *    la mention du total en toutes lettres.
 */

/** Lignes regroupées d'une facture. */
export interface LigneFacture {
  libelle: string
  /** Quantité réellement pesée/mesurée et quantité retenue pour facturer. */
  quantiteMesuree: number
  quantite: number
  unite: LocalOrderItem['billingUnit']
  prixStatut: LocalOrderItem['priceStatus']
  /** Prix unitaire et total restent figés dans les instantanés de commande. */
  prixUnitaire: number
  total: number
}

export interface AcompteFacture {
  id: string
  date: string
  montant: number
  moyen: string
}

export interface DocumentFacture {
  numero: string
  emisLe: string
  /** Référence courte de la commande, rappelée sur le document. */
  referenceCommande: string
  client: { nom: string; telephone: string }
  statut: string
  livraisonPromise: string | null
  lignes: LigneFacture[]
  total: number
  acomptes: AcompteFacture[]
  /** Somme des acomptes (espèces connues localement). */
  verse: number
  reste: number
  /** `true` quand le document peut porter la mention « acquittée ». */
  acquittee: boolean
  /** Total en toutes lettres, en francs CFA. */
  totalEnLettres: string
}

/** Référence courte d'une commande : `CMD-XXXXXX`. */
export function referenceCommande(orderId: string): string {
  return `CMD-${orderId.replace(/-/g, '').slice(-6).toUpperCase()}`
}

/**
 * Numéro de facture, déterministe.
 *
 * Format `FA-AAAA-XXXXXX` : l'année de la commande puis les six derniers
 * caractères hexadécimaux de son identifiant. Deux appels donnent le même
 * numéro, sur n'importe quelle tablette, sans table de compteurs à
 * synchroniser — et un numéro ne peut pas désigner deux commandes, l'UUID
 * étant unique.
 *
 * Une numérotation séquentielle « 0001, 0002… » serait plus conventionnelle
 * mais exigerait un compteur serveur : hors ligne, deux tablettes
 * produiraient le même numéro, et une facture réimprimée changerait de numéro.
 */
export function numeroFacture(orderId: string, createdAt: string): string {
  const annee = createdAt.slice(0, 4) || String(new Date().getFullYear())
  return `FA-${annee}-${orderId.replace(/-/g, '').slice(-6).toUpperCase()}`
}

/**
 * Regroupe les lignes identiques.
 *
 * Une commande de cinq chemises saisies séparément donnerait cinq lignes de
 * facture : illisible, et plus long à contrôler au comptoir. On regroupe par
 * libellé **et** par prix unitaire (deux tarifs différents restent deux
 * lignes).
 */
export function lignesFacture(items: LocalOrderItem[]): LigneFacture[] {
  const parCle = new Map<string, LigneFacture>()

  for (const item of items) {
    const libelle = [item.articleName ?? item.label, item.serviceName]
      .filter((morceau): morceau is string => Boolean(morceau && morceau.trim()))
      .join(' — ')
    const quantiteMesuree = item.quantity ?? 1
    const quantite = item.billedQuantity ?? quantiteMesuree
    const unite = item.billingUnit ?? 'PIECE'
    const prixStatut = item.priceStatus ?? 'CONFIRMED'
    const prixUnitaire = item.unitPrice ?? item.price
    // Ne regroupe que des saisies aux quantités, tarifs, statuts et totaux
    // identiques : le minimum facturable peut rendre le total non multiplicatif.
    const cle = `${libelle}|${unite}|${prixUnitaire}|${prixStatut}|${item.price}|${quantiteMesuree}|${quantite}`

    const existante = parCle.get(cle)
    if (existante) {
      existante.quantiteMesuree += quantiteMesuree
      existante.quantite += quantite
      existante.total += item.price
    } else {
      parCle.set(cle, {
        libelle,
        quantiteMesuree,
        quantite,
        unite,
        prixStatut,
        prixUnitaire,
        total: item.price,
      })
    }
  }

  return [...parCle.values()]
}

/**
 * Construit le document de facture.
 *
 * Les acomptes sont les encaissements **espèces** connus localement. Le Mobile
 * Money confirmé côté serveur n'apparaît pas ici : il ne descend pas sur la
 * tablette. La facture le signale dans ses mentions plutôt que d'afficher un
 * solde faux.
 */
export function construireFacture(
  order: LocalOrder,
  items: LocalOrderItem[],
  paiements: LocalCashPayment[],
): DocumentFacture {
  const lignes = lignesFacture(items)
  const solde = computeBalance(order.totalAmount, order.paymentStatus, paiements)

  const acomptes: AcompteFacture[] = [...paiements]
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0))
    .map((paiement) => ({
      id: paiement.id,
      date: paiement.receivedAt,
      montant: paiement.amount,
      moyen: PAYMENT_METHOD_LABELS[paiement.method] ?? 'Espèces',
    }))

  return {
    numero: numeroFacture(order.id, order.createdAt),
    emisLe: order.createdAt,
    referenceCommande: referenceCommande(order.id),
    client: { nom: order.customerName, telephone: order.customerPhone },
    statut: ORDER_STATUSES[order.status].label,
    livraisonPromise: order.dueDate,
    lignes,
    total: order.totalAmount,
    acomptes,
    verse: solde.paid,
    reste: solde.remaining,
    acquittee: solde.settled,
    totalEnLettres: montantEnLettres(order.totalAmount),
  }
}

// ---------------------------------------------------------------------------
// Montant en toutes lettres
// ---------------------------------------------------------------------------

const UNITES = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
]

const DIZAINES = [
  '',
  '',
  'vingt',
  'trente',
  'quarante',
  'cinquante',
  'soixante',
  'soixante',
  'quatre-vingt',
  'quatre-vingt',
]

/**
 * 0..99 en français, avec les règles de liaison (et un, soixante et onze…).
 *
 * `suivi` vaut `true` quand un autre numéral suit (« quatre-vingt**s** mille »
 * mais « quatre-vingt mille ») : le pluriel de `quatre-vingts` tombe alors.
 */
function deuxChiffres(n: number, suivi = false): string {
  if (n < 17) return UNITES[n] ?? ''

  if (n < 20) return `dix-${UNITES[n - 10] ?? ''}`

  if (n < 70) {
    const dizaine = Math.floor(n / 10)
    const unite = n % 10
    if (unite === 0) return DIZAINES[dizaine] ?? ''
    if (unite === 1) return `${DIZAINES[dizaine]} et un`
    return `${DIZAINES[dizaine]}-${UNITES[unite] ?? ''}`
  }

  if (n < 80) {
    // 70-79 : « soixante-dix », « soixante et onze », « soixante-douze »…
    const reste = n - 60
    return reste === 11 ? 'soixante et onze' : `soixante-${deuxChiffres(reste)}`
  }

  // 80-99 : « quatre-vingt », « quatre-vingt-onze », « quatre-vingt-dix-neuf ».
  const reste = n - 80
  if (reste === 0) return suivi ? 'quatre-vingt' : 'quatre-vingts'
  return `quatre-vingt-${deuxChiffres(reste, suivi)}`
}

/** 0..999. `suivi` : un numéral suit (« deux cent mille », pas « deux cents »). */
function troisChiffres(n: number, suivi = false): string {
  if (n < 100) return deuxChiffres(n, suivi)

  const centaines = Math.floor(n / 100)
  const reste = n % 100
  const plurielCent = reste === 0 && !suivi ? 's' : ''
  const tete =
    centaines === 1 ? 'cent' : `${UNITES[centaines] ?? ''} cent${plurielCent}`

  return reste === 0 ? tete : `${tete} ${deuxChiffres(reste)}`
}

const GRANDS = [
  { seuil: 1_000_000_000, singulier: 'milliard', pluriel: 'milliards' },
  { seuil: 1_000_000, singulier: 'million', pluriel: 'millions' },
  { seuil: 1_000, singulier: 'mille', pluriel: 'mille' },
]

/**
 * Montant entier en toutes lettres : `6000` → « six mille francs CFA ».
 *
 * Utile sur un reçu : un montant en chiffres se surcharge à la main, un montant
 * écrit en lettres se conteste beaucoup plus difficilement.
 *
 * Le franc CFA n'ayant pas de sous-unité, la fonction refuse les décimales
 * plutôt que de les arrondir en silence.
 */
export function montantEnLettres(montant: number): string {
  if (!Number.isFinite(montant) || montant < 0) return 'montant indéterminé'

  const entier = Math.round(montant)
  const devise = entier > 1 ? 'francs CFA' : 'franc CFA'
  if (entier === 0) return `zéro ${devise}`
  if (entier >= 1_000_000_000_000) return `${entier} ${devise}`

  const morceaux: string[] = []
  let reste = entier

  for (const grand of GRANDS) {
    const quantite = Math.floor(reste / grand.seuil)
    if (quantite === 0) continue
    reste %= grand.seuil

    // `troisChiffres(quantite, true)` : le numéral qui suit fait tomber le
    // pluriel de « cent » et de « quatre-vingts » (« deux cent mille »).
    if (grand.seuil === 1_000) {
      // « mille » est invariable et ne prend jamais « un ».
      morceaux.push(quantite === 1 ? 'mille' : `${troisChiffres(quantite, true)} mille`)
    } else {
      const mot = quantite > 1 ? grand.pluriel : grand.singulier
      morceaux.push(`${troisChiffres(quantite, true)} ${mot}`)
    }
  }

  if (reste > 0) morceaux.push(troisChiffres(reste))

  return `${morceaux.join(' ')} ${devise}`
}
