import { describe, expect, it } from 'vitest'
import { suggestCustomersByPhone } from '@/lib/customerSuggestions'

const orders = [
  { customerName: 'Awa Koné', customerPhone: '07 00 00 00 01', createdAt: '2026-01-01T10:00:00.000Z' },
  { customerName: 'Awa Koné', customerPhone: '0700000001', createdAt: '2026-02-01T10:00:00.000Z' },
  { customerName: 'Mariam Traoré', customerPhone: '+225 07 00 00 00 02', createdAt: '2026-01-15T10:00:00.000Z' },
  { customerName: 'Koffi Yao', customerPhone: '0500000003', createdAt: '2026-03-01T10:00:00.000Z' },
]

describe('suggestCustomersByPhone', () => {
  it('cherche par chiffres malgré les espaces et le préfixe du numéro', () => {
    expect(suggestCustomersByPhone(orders, '07 00')).toEqual([
      expect.objectContaining({ name: 'Awa Koné', normalizedPhone: '0700000001' }),
      expect.objectContaining({ name: 'Mariam Traoré', normalizedPhone: '0700000002' }),
    ])
  })

  it('ne propose que la commande la plus récente par numéro et trie les résultats', () => {
    const suggestions = suggestCustomersByPhone(orders, '070', 1)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      name: 'Awa Koné',
      phone: '0700000001',
      lastOrderAt: '2026-02-01T10:00:00.000Z',
    })
  })

  it('attend trois chiffres et ne dépasse pas la limite demandée', () => {
    expect(suggestCustomersByPhone(orders, '07')).toEqual([])
    expect(suggestCustomersByPhone(orders, '07', 0)).toEqual([])
    expect(suggestCustomersByPhone(orders, '0', 2)).toEqual([])
  })
})
