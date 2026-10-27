import { describe, expect, it } from 'vitest'
import { suggestCustomersByPhone, countPreviousOrders, lastCustomerNameByPhone } from '@/lib/customerSuggestions'

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

describe('countPreviousOrders', () => {
  it('compte toutes les commandes d’un même numéro malgré les formats', () => {
    expect(countPreviousOrders(orders, '+225 07 00 00 00 01')).toBe(2)
    expect(countPreviousOrders(orders, '07 00 00 00 01')).toBe(2)
    expect(countPreviousOrders(orders, '0700000001')).toBe(2)
  })

  it('retourne 0 pour un numéro inconnu ou trop court', () => {
    expect(countPreviousOrders(orders, '07')).toBe(0)
    expect(countPreviousOrders(orders, '0500000003')).toBe(1)
    expect(countPreviousOrders(orders, '9999999999')).toBe(0)
  })
})

describe('lastCustomerNameByPhone', () => {
  it('retourne le nom le plus récent associé au numéro', () => {
    expect(lastCustomerNameByPhone(orders, '+225 07 00 00 00 01')).toBe('Awa Koné')
    expect(lastCustomerNameByPhone(orders, '07 00 00 00 02')).toBe('Mariam Traoré')
  })

  it('retourne une chaîne vide pour un numéro inconnu', () => {
    expect(lastCustomerNameByPhone(orders, '9999999999')).toBe('')
    expect(lastCustomerNameByPhone(orders, '07')).toBe('')
  })
})
