import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrderMeasurementHistory } from '@/services/orderMeasurementHistory'

const remote = vi.hoisted(() => ({
  table: '',
  selected: '',
  filters: [] as Array<[string, string]>,
  order: null as null | { column: string; ascending: boolean },
  limit: 0,
  result: {
    data: null as unknown[] | null,
    error: null as { message: string } | null,
  },
}))

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      remote.table = table
      const query = {
        select: (columns: string) => {
          remote.selected = columns
          return query
        },
        eq: (column: string, value: string) => {
          remote.filters.push([column, value])
          return query
        },
        order: (column: string, options: { ascending: boolean }) => {
          remote.order = { column, ascending: options.ascending }
          return query
        },
        limit: (count: number) => {
          remote.limit = count
          return Promise.resolve(remote.result)
        },
      }
      return query
    },
  }),
}))

beforeEach(() => {
  remote.table = ''
  remote.selected = ''
  remote.filters = []
  remote.order = null
  remote.limit = 0
  remote.result = { data: [], error: null }
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

describe('lecture sécurisée de l’historique de mesure', () => {
  it('ne lit que l’historique du tenant et de la commande, du plus récent au plus ancien', async () => {
    const rows = [{ id: 'history-1' }]
    remote.result = { data: rows, error: null }

    const result = await getOrderMeasurementHistory('tenant-a', 'order-a')

    expect(result).toEqual(rows)
    expect(remote.table).toBe('order_price_history')
    expect(remote.selected).toContain('previous_snapshot')
    expect(remote.filters).toEqual([
      ['tenant_id', 'tenant-a'],
      ['order_id', 'order-a'],
    ])
    expect(remote.order).toEqual({ column: 'changed_at', ascending: false })
    expect(remote.limit).toBe(100)
  })

  it('traduit un refus du serveur en message français sans exposer la réponse brute', async () => {
    remote.result = { data: null, error: { message: 'permission denied' } }

    await expect(getOrderMeasurementHistory('tenant-a', 'order-a')).rejects.toThrow(
      'Impossible de charger l’historique des mesures pour le moment.',
    )
  })
})
