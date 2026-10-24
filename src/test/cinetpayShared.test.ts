import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkPayment, type CinetPayConfig } from '../../supabase/functions/_shared/cinetpay'

const config: CinetPayConfig = {
  apiKey: 'test-key',
  siteId: '123456',
  secretKey: null,
  baseUrl: 'https://api.example.test',
  mode: 'test',
  appEnv: 'development',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('checkPayment — validation du montant vérifié', () => {
  it('renvoie null si CinetPay ne fournit aucun montant, même avec ACCEPTED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: '00', data: { status: 'ACCEPTED' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await checkPayment(config, 'transaction-sans-montant')

    expect(result.status).toBe('ACCEPTED')
    expect(result.amount).toBeNull()
  })

  it('renvoie null si le montant vérifié est invalide', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: '00', data: { status: 'ACCEPTED', amount: 'abc' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await checkPayment(config, 'transaction-montant-invalide')

    expect(result.amount).toBeNull()
  })

  it('conserve le montant entier réellement vérifié', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: '00', data: { status: 'ACCEPTED', amount: '8500' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await checkPayment(config, 'transaction-8500')

    expect(result.amount).toBe(8500)
  })
})
