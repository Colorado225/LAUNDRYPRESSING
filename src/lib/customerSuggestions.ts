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
