import { describe, expect, it } from 'vitest'
import { extractEdgeFunctionError, PaymentError } from '@/services/paymentService'
import { cinetpayIndisponible } from '@/services/paymentSimulation'

/**
 * En paiement, un incident réseau ne doit jamais se transformer en succès
 * fictif : seul le serveur qui dit explicitement « CinetPay non configuré »
 * ou « fonction absente » autorise le toast de simulation.
 */

describe('erreurs du guichet Mobile Money', () => {
  it('identifie la configuration CinetPay manquante (503)', async () => {
    const erreur = await extractEdgeFunctionError({
      context: new Response(
        JSON.stringify({
          error: {
            code: 'provider_not_configured',
            message: 'CinetPay n’est pas configuré.',
          },
        }),
        { status: 503 },
      ),
    })

    expect(erreur.code).toBe('provider_not_configured')
    // Le code d'erreur, et non son texte, pilote la simulation.
    expect(cinetpayIndisponible(new PaymentError(erreur.code, erreur.message))).toBe(true)
  })

  it('identifie une fonction qui n’est pas déployée (404)', async () => {
    const erreur = await extractEdgeFunctionError({
      context: new Response('Not Found', { status: 404 }),
    })

    expect(erreur.code).toBe('function_not_deployed')
    expect(cinetpayIndisponible(new PaymentError(erreur.code, erreur.message))).toBe(true)
  })

  it('ne transforme pas un refus du serveur en simulation', async () => {
    const erreur = await extractEdgeFunctionError({
      context: new Response(
        JSON.stringify({ error: { code: 'forbidden', message: 'Action non autorisée.' } }),
        { status: 403 },
      ),
    })

    expect(erreur.code).toBe('forbidden')
    const { PaymentError } = await import('@/services/paymentService')
    expect(cinetpayIndisponible(new PaymentError(erreur.code, erreur.message))).toBe(false)
  })

  it('ne transforme pas une panne réseau en simulation', async () => {
    const erreur = await extractEdgeFunctionError(new Error('Connexion interrompue'))

    expect(erreur.code).toBe('edge_error')
    expect(cinetpayIndisponible(new Error(erreur.message))).toBe(false)
  })
})
