import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { isOrderLate, todayIso } from '@/constants/orders'
import type { LocalOrder } from '@/db/localDb'
import type { CustomerRow } from '@/types/database'

/**
 * Clients et historique (palier 3).
 *
 * Deux sources, volontairement séparées :
 *  - la **liste** et l'**historique** sont calculés à partir des commandes
 *    présentes sur la tablette : ils fonctionnent donc hors ligne et restent
 *    instantanés, même avec plusieurs centaines de commandes ;
 *  - la **fiche enrichie** (adresse, préférences) vit sur le serveur, où elle
 *    est créée automatiquement par un déclencheur au moment de la commande.
 *
 * Le rapprochement se fait sur le numéro normalisé, exactement comme la
 * fonction SQL `normalize_phone` : « +225 07 00 00 00 21 » et « 0700000021 »
 * désignent la même personne.
 */

export interface ClientSummary {
  /** Clé de rapprochement (numéro normalisé). */
  key: string
  name: string
  phone: string
  orderCount: number
  /** Total facturé hors annulations. */
  totalSpent: number
  /** Reste à encaisser sur les commandes non soldées. */
  outstanding: number
  lastOrderAt: string
  lateCount: number
  /** Fiche serveur associée, `null` tant qu'aucune fiche n'a été lue. */
  customerId?: string | null
  email?: string | null
  address?: string | null
  /** Vrai si une fiche existe côté serveur (créée par une commande ou à la main). */
  hasCard?: boolean
}

/**
 * Normalise un numéro ivoirien : chiffres uniquement, indicatif 225 retiré.
 * Miroir exact de `public.normalize_phone` (migration 006).
 */
export function normalisePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const chiffres = phone.replace(/\D/g, '')
  if (chiffres.startsWith('225') && chiffres.length > 10) return chiffres.slice(3)
  return chiffres
}

/** Agrège les commandes par client, les plus récents d'abord. */
export function summariseClients(
  orders: LocalOrder[],
  today: string = todayIso(),
): ClientSummary[] {
  const parCle = new Map<string, ClientSummary>()

  for (const order of orders) {
    const key = normalisePhone(order.customerPhone) || order.customerPhone.trim().toLowerCase()
    if (!key) continue

    const existant = parCle.get(key)
    const annulee = order.status === 'cancelled'

    // La fiche affiche le nom de la commande la plus récente : un client a pu
    // faire corriger une faute de frappe au comptoir.
    const plusRecent = !existant || order.createdAt > existant.lastOrderAt

    const cumul: ClientSummary = existant ?? {
      key,
      name: order.customerName,
      phone: order.customerPhone,
      orderCount: 0,
      totalSpent: 0,
      outstanding: 0,
      lastOrderAt: order.createdAt,
      lateCount: 0,
    }

    if (!annulee) {
      cumul.orderCount += 1
      cumul.totalSpent += order.totalAmount
      if (order.paymentStatus !== 'paid') cumul.outstanding += order.totalAmount
      if (isOrderLate(order, today)) cumul.lateCount += 1
    }

    if (plusRecent) {
      cumul.name = order.customerName
      cumul.phone = order.customerPhone
      cumul.lastOrderAt = order.createdAt
    }

    parCle.set(key, cumul)
  }

  return [...parCle.values()].sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt))
}

/** Filtre la liste par nom ou téléphone (recherche libre). */
export function filterClients(clients: ClientSummary[], recherche: string): ClientSummary[] {
  const terme = recherche.trim().toLowerCase()
  if (!terme) return clients

  const chiffres = terme.replace(/\D/g, '')

  return clients.filter((client) => {
    if (client.name.toLowerCase().includes(terme)) return true
    if (client.phone.toLowerCase().includes(terme)) return true
    if (client.email?.toLowerCase().includes(terme)) return true
    return chiffres.length >= 3 && normalisePhone(client.phone).includes(chiffres)
  })
}

/**
 * Fusionne l'historique local et les fiches serveur.
 *
 * L'historique vient des commandes de la tablette ; les fiches servent à faire
 * apparaître un client **créé au comptoir avant toute commande** (livraison à
 * venir, dépôt sans ticket) et à afficher l'e-mail ou l'adresse connus. Une
 * fiche sans commande reste donc visible, avec zéro commande.
 */
export function mergeCustomerCards(
  orders: LocalOrder[],
  cards: CustomerRow[],
  today: string = todayIso(),
): ClientSummary[] {
  const parCle = new Map(summariseClients(orders, today).map((client) => [client.key, client]))

  for (const carte of cards) {
    const key = carte.phone_key || normalisePhone(carte.phone) || carte.phone.trim().toLowerCase()
    if (!key) continue

    const existant = parCle.get(key)
    if (existant) {
      // La fiche est tenue à jour par le déclencheur des commandes : elle fait
      // foi sur l'identité, l'historique local restant la source des montants.
      existant.customerId = carte.id
      existant.hasCard = true
      existant.name = carte.name || existant.name
      existant.phone = carte.phone || existant.phone
      existant.email = carte.email
      existant.address = carte.address
      continue
    }

    parCle.set(key, {
      key,
      name: carte.name,
      phone: carte.phone,
      orderCount: 0,
      totalSpent: 0,
      outstanding: 0,
      lastOrderAt: carte.created_at,
      lateCount: 0,
      customerId: carte.id,
      email: carte.email,
      address: carte.address,
      hasCard: true,
    })
  }

  return [...parCle.values()].sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt))
}

/** Commandes d'un client, de la plus récente à la plus ancienne. */
export function ordersForClient(orders: LocalOrder[], key: string): LocalOrder[] {
  return orders
    .filter((order) => {
      const cle = normalisePhone(order.customerPhone) || order.customerPhone.trim().toLowerCase()
      return cle === key
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Longueurs maximales alignées sur les contraintes de la table `customers`. */
export const CUSTOMER_LIMITS = {
  name: 120,
  phone: 30,
  email: 160,
  address: 300,
  notes: 1000,
} as const

/** Traduit les erreurs PostgreSQL en message utilisable au comptoir. */
export function customerErrorMessage(message: string): string {
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Réseau indisponible : cette action sur la fiche client nécessite une connexion.'
  }
  if (
    message.includes('customers_phone_unique') ||
    message.includes('duplicate key')
  ) {
    return 'Un client utilise déjà ce numéro de téléphone dans ce pressing.'
  }
  if (message.includes('row-level security') || message.includes('42501')) {
    return 'Votre rôle ne permet pas cette action sur les fiches clients.'
  }
  if (message.includes('Numéro de téléphone invalide')) {
    return 'Indiquez un numéro de téléphone valide.'
  }
  return message
}

export interface CustomerInput {
  name: string
  phone: string
  email?: string | null
  address?: string | null
  notes?: string | null
}

/** Validation locale, miroir des contraintes SQL (nom, téléphone, longueurs). */
export function validateCustomer(input: CustomerInput): string | null {
  const nom = input.name.trim()
  if (nom.length < 1) return 'Indiquez le nom du client.'
  if (nom.length > CUSTOMER_LIMITS.name) {
    return `Le nom ne peut pas dépasser ${CUSTOMER_LIMITS.name} caractères.`
  }

  const telephone = input.phone.trim()
  if (normalisePhone(telephone).length < 6) {
    return 'Indiquez un numéro de téléphone valide (au moins 6 chiffres).'
  }
  if (telephone.length > CUSTOMER_LIMITS.phone) {
    return `Le téléphone ne peut pas dépasser ${CUSTOMER_LIMITS.phone} caractères.`
  }

  const email = input.email?.trim() ?? ''
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return 'L’adresse e-mail semble invalide.'
  }
  if (email.length > CUSTOMER_LIMITS.email) return 'L’adresse e-mail est trop longue.'
  if ((input.address?.trim().length ?? 0) > CUSTOMER_LIMITS.address) {
    return `L’adresse ne peut pas dépasser ${CUSTOMER_LIMITS.address} caractères.`
  }
  if ((input.notes?.trim().length ?? 0) > CUSTOMER_LIMITS.notes) {
    return `Les préférences ne peuvent pas dépasser ${CUSTOMER_LIMITS.notes} caractères.`
  }

  return null
}

function optional(value: string | null | undefined): string | null {
  const propre = value?.trim()
  return propre ? propre : null
}

/**
 * Fiches serveur du pressing, pour l'écran Clients.
 *
 * Hors ligne ou sans configuration Supabase, la liste est vide : l'écran
 * retombe sur l'historique dérivé des commandes de la tablette.
 */
export async function listCustomerCards(tenantId: string): Promise<CustomerRow[]> {
  if (!isSupabaseConfigured || !navigator.onLine) return []

  const { data, error } = await getSupabaseClient()
    .from('customers')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

  if (error) throw new Error(customerErrorMessage(error.message))
  return data ?? []
}

/**
 * Crée une fiche client sans commande.
 *
 * `phone_key` est calculé par le déclencheur `prepare_customer_row` (migration
 * 025) : le client n'envoie que le numéro tel qu'il a été saisi.
 */
export async function createCustomer(
  tenantId: string,
  input: CustomerInput,
): Promise<CustomerRow> {
  if (!isSupabaseConfigured) {
    throw new Error('La création d’une fiche client nécessite une connexion.')
  }

  const invalide = validateCustomer(input)
  if (invalide) throw new Error(invalide)

  const { data, error } = await getSupabaseClient()
    .from('customers')
    .insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      phone: input.phone.trim(),
      email: optional(input.email),
      address: optional(input.address),
      notes: optional(input.notes),
    })
    .select('*')
    .maybeSingle()

  if (error) throw new Error(customerErrorMessage(error.message))
  if (!data) throw new Error('Fiche non créée : vérifiez vos droits.')
  return data
}

/**
 * Modifie une fiche : identité, contact et préférences.
 *
 * L'écriture est **en ligne uniquement** : une adresse ou une préférence n'a
 * pas besoin d'être saisie en pleine coupure, et un conflit silencieux entre
 * deux tablettes serait plus gênant qu'utile. Un changement de téléphone est
 * refusé si une autre fiche porte déjà ce numéro (index unique du pressing).
 */
export async function updateCustomer(
  tenantId: string,
  customerId: string,
  patch: Partial<CustomerInput>,
): Promise<CustomerRow> {
  if (!isSupabaseConfigured) {
    throw new Error('La fiche client détaillée nécessite une connexion.')
  }

  const valeurs: Partial<Pick<CustomerRow, 'name' | 'phone' | 'email' | 'address' | 'notes'>> = {}
  if (patch.name !== undefined) valeurs.name = patch.name.trim()
  if (patch.phone !== undefined) valeurs.phone = patch.phone.trim()
  if (patch.email !== undefined) valeurs.email = optional(patch.email)
  if (patch.address !== undefined) valeurs.address = optional(patch.address)
  if (patch.notes !== undefined) valeurs.notes = optional(patch.notes)

  if (Object.keys(valeurs).length === 0) {
    throw new Error('Aucune modification à enregistrer.')
  }

  // Un patch partiel (adresse seule, par exemple) ne doit pas exiger les
  // autres champs : chaque valeur fournie est validée séparément.
  const controles: Array<[boolean, string | null]> = [
    [patch.name !== undefined, valeurs.name && valeurs.name.length >= 1 ? null : 'Indiquez le nom du client.'],
    [
      patch.name !== undefined,
      (valeurs.name?.length ?? 0) > CUSTOMER_LIMITS.name
        ? `Le nom ne peut pas dépasser ${CUSTOMER_LIMITS.name} caractères.`
        : null,
    ],
    [
      patch.phone !== undefined,
      normalisePhone(valeurs.phone ?? '').length >= 6
        ? null
        : 'Indiquez un numéro de téléphone valide (au moins 6 chiffres).',
    ],
    [
      patch.phone !== undefined,
      (valeurs.phone?.length ?? 0) > CUSTOMER_LIMITS.phone
        ? `Le téléphone ne peut pas dépasser ${CUSTOMER_LIMITS.phone} caractères.`
        : null,
    ],
    [
      patch.email !== undefined,
      valeurs.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valeurs.email)
        ? 'L’adresse e-mail semble invalide.'
        : null,
    ],
    [
      patch.email !== undefined,
      (valeurs.email?.length ?? 0) > CUSTOMER_LIMITS.email
        ? 'L’adresse e-mail est trop longue.'
        : null,
    ],
    [
      patch.address !== undefined,
      (valeurs.address?.length ?? 0) > CUSTOMER_LIMITS.address
        ? `L’adresse ne peut pas dépasser ${CUSTOMER_LIMITS.address} caractères.`
        : null,
    ],
    [
      patch.notes !== undefined,
      (valeurs.notes?.length ?? 0) > CUSTOMER_LIMITS.notes
        ? `Les préférences ne peuvent pas dépasser ${CUSTOMER_LIMITS.notes} caractères.`
        : null,
    ],
  ]
  const erreur = controles.find(([actif, message]) => actif && message)?.[1]
  if (erreur) throw new Error(erreur)

  const { data, error } = await getSupabaseClient()
    .from('customers')
    .update(valeurs)
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(customerErrorMessage(error.message))
  if (!data) throw new Error('Fiche client introuvable ou non modifiable.')
  return data
}

/**
 * Ancienne signature conservée pour l'écran historique : elle n'expose que les
 * deux champs enrichis. Les nouveaux écrans passent par `updateCustomer`.
 */
export async function updateCustomerCard(
  tenantId: string,
  customerId: string,
  patch: { notes?: string | null; address?: string | null },
): Promise<CustomerRow> {
  return updateCustomer(tenantId, customerId, patch)
}

/**
 * Supprime une fiche client (propriétaire uniquement, RLS `customers_delete_owner`).
 *
 * Les commandes ne sont pas touchées : elles gardent le nom et le téléphone
 * saisis, seul le lien vers la fiche est remis à `NULL`.
 */
export async function deleteCustomer(tenantId: string, customerId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('La suppression d’une fiche client nécessite une connexion.')
  }

  const { error } = await getSupabaseClient()
    .from('customers')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', customerId)

  if (error) throw new Error(customerErrorMessage(error.message))
}
