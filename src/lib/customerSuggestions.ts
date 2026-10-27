import type { LocalOrder } from '@/db/localDb'

export interface CustomerSuggestion {
  name: string
  phone: string
  normalizedPhone: string
  lastOrderAt: string
}

function digitsOnly(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  // Unifie le format national à 10 chiffres et le format international +225.
  return digits.startsWith('225') ? digits.slice(3) : digits
}

/**
 * Propose les clients déjà rencontrés sur cet appareil à partir de leurs
 * commandes locales. La recherche commence après trois chiffres et conserve
 * la commande la plus récente pour chaque numéro.
 */
export function suggestCustomersByPhone(
  orders: readonly Pick<LocalOrder, 'customerName' | 'customerPhone' | 'createdAt'>[],
  phoneQuery: string,
  limit = 5,
): CustomerSuggestion[] {
  const query = digitsOnly(phoneQuery)
  if (query.length < 3 || limit <= 0) return []

  const latestByPhone = new Map<string, CustomerSuggestion>()
  for (const order of orders) {
    const normalizedPhone = digitsOnly(order.customerPhone)
    if (!normalizedPhone.startsWith(query)) continue

    const previous = latestByPhone.get(normalizedPhone)
    if (!previous || order.createdAt > previous.lastOrderAt) {
      latestByPhone.set(normalizedPhone, {
        name: order.customerName,
        phone: order.customerPhone,
        normalizedPhone,
        lastOrderAt: order.createdAt,
      })
    }
  }

  return [...latestByPhone.values()]
    .sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt))
    .slice(0, limit)
}

/**
 * Compte le nombre de commandes précédentes pour un numéro de téléphone.
 *
 * Utilisé pour afficher l'historique du client à l'étape « Client » du
 * formulaire de commande (ex. « Awa Ndiaye — 4 commandes précédentes »).
 */
export function countPreviousOrders(
  orders: readonly Pick<LocalOrder, 'customerPhone'>[],
  phone: string,
): number {
  const query = digitsOnly(phone)
  if (query.length < 3) return 0

  return orders.reduce((somme, order) => {
    const normalized = digitsOnly(order.customerPhone)
    return normalized === query ? somme + 1 : somme
  }, 0)
}

/**
 * Retourne le nom le plus récent associé à un numéro de téléphone, ou
 * une chaîne vide si aucun client n'a été trouvé.
 */
export function lastCustomerNameByPhone(
  orders: readonly Pick<LocalOrder, 'customerName' | 'customerPhone' | 'createdAt'>[],
  phone: string,
): string {
  const query = digitsOnly(phone)
  if (query.length < 3) return ''

  let latest: { name: string; createdAt: string } | null = null
  for (const order of orders) {
    const normalized = digitsOnly(order.customerPhone)
    if (normalized !== query) continue
    if (!latest || order.createdAt > latest.createdAt) {
      latest = { name: order.customerName, createdAt: order.createdAt }
    }
  }
  return latest?.name ?? ''
}
