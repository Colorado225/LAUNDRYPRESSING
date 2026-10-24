import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listStockConsumptionCosts } from '@/services/stockService'

const remote = vi.hoisted(() => ({
  calls: [] as Array<{ functionName: string; args: Record<string, unknown> }>,
  responses: [] as Array<{
    data: Array<{ order_item_id: string; cost_amount: number | string; missing_cost_movements: number | string }> | null
    error: { message: string } | null
  }>,
}))

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    rpc: async (functionName: string, args: Record<string, unknown>) => {
      remote.calls.push({ functionName, args })
      return remote.responses[remote.calls.length - 1] ?? { data: [], error: null }
    },
  }),
}))

beforeEach(() => {
  remote.calls = []
  remote.responses = []
})

describe('lecture des coûts de consommables imputés', () => {
  it('ne fait aucun appel pour une liste vide et refuse un pressing absent', async () => {
    await expect(listStockConsumptionCosts('tenant-a', [])).resolves.toEqual([])
    expect(remote.calls).toHaveLength(0)
    await expect(listStockConsumptionCosts('  ', ['line-a'])).rejects.toThrow(
      'Pressing actif introuvable.',
    )
    expect(remote.calls).toHaveLength(0)
  })

  it('déduplique les lignes, découpe en lots et convertit les agrégats PostgreSQL', async () => {
    const ids = [...Array.from({ length: 501 }, (_, index) => `line-${index}`), 'line-0']
    remote.responses = [
      { data: [{ order_item_id: 'line-0', cost_amount: '1250', missing_cost_movements: '2' }], error: null },
      { data: [{ order_item_id: 'line-500', cost_amount: '300', missing_cost_movements: '0' }], error: null },
    ]

    const costs = await listStockConsumptionCosts('tenant-a', ids)

    expect(remote.calls).toHaveLength(2)
    expect(remote.calls.map((call) => call.functionName)).toEqual([
      'report_stock_consumption_costs',
      'report_stock_consumption_costs',
    ])
    expect(remote.calls.map((call) => (call.args['p_order_item_ids'] as string[]).length)).toEqual([500, 1])
    expect(costs).toEqual([
      { order_item_id: 'line-0', cost_amount: 1250, missing_cost_movements: 2 },
      { order_item_id: 'line-500', cost_amount: 300, missing_cost_movements: 0 },
    ])
  })

  it('transmet une erreur serveur plutôt que de présenter une marge fausse', async () => {
    remote.responses = [{ data: null, error: { message: 'row-level security policy violation' } }]

    await expect(listStockConsumptionCosts('tenant-a', ['line-a'])).rejects.toThrow(
      'Votre rôle ne permet pas cette action sur le stock.',
    )
  })
})
