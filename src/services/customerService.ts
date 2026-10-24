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
    return chiffres.length >= 3 && normalisePhone(client.phone).includes(chiffres)
  })
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

/** Fiche serveur d'un client, `null` hors ligne ou si elle n'existe pas. */
export async function fetchCustomerCard(
  tenantId: string,
  phoneKey: string,
): Promise<CustomerRow | null> {
  if (!isSupabaseConfigured) return null

  const { data, error } = await getSupabaseClient()
    .from('customers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('phone_key', phoneKey)
    .maybeSingle()

  return error ? null : data
}

/**
 * Enregistre les informations enrichies d'une fiche.
 *
 * Cette écriture est **en ligne uniquement** : une adresse ou une préférence
 * n'a pas besoin d'être saisie en pleine coupure, et un conflit silencieux
 * entre deux tablettes serait plus gênant qu'utile.
 */
export async function updateCustomerCard(
  tenantId: string,
  customerId: string,
  patch: { notes?: string | null; address?: string | null },
): Promise<CustomerRow> {
  if (!isSupabaseConfigured) {
    throw new Error('La fiche client détaillée nécessite une connexion.')
  }

  const { data, error } = await getSupabaseClient()
    .from('customers')
    .update({
      notes: patch.notes?.trim() ? patch.notes.trim() : null,
      address: patch.address?.trim() ? patch.address.trim() : null,
    })
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Fiche client introuvable ou non modifiable.')
  return data
}
