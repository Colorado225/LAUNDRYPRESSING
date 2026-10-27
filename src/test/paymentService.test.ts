import { describe, expect, it } from 'vitest'
import {
  MESSAGE_CINETPAY_ABSENT,
  PaymentError,
  cinetpayIndisponible,
  extractEdgeFunctionError,
} from '@/services/paymentService'

/**
 * En paiement, un incident réseau ne doit jamais se transformer en succès
 * fictif. Ce classificateur ne sert plus qu'à **expliquer** l'échec : la
 * simulation de paiement a été retirée du produit (le bouton disparaît quand
 * les clés marchandes sont absentes).
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
    // Le code d'erreur, et non son texte, pilote le message affiché.
    expect(cinetpayIndisponible(new PaymentError(erreur.code, erreur.message))).toBe(true)
  })

  it('identifie une fonction qui n’est pas déployée (404)', async () => {
    const erreur = await extractEdgeFunctionError({
      context: new Response('Not Found', { status: 404 }),
    })

    expect(erreur.code).toBe('function_not_deployed')
    expect(cinetpayIndisponible(new PaymentError(erreur.code, erreur.message))).toBe(true)
  })

  it('ne classe pas un refus du serveur comme une absence de guichet', async () => {
    const erreur = await extractEdgeFunctionError({
      context: new Response(
        JSON.stringify({ error: { code: 'forbidden', message: 'Action non autorisée.' } }),
        { status: 403 },
      ),
    })

    expect(erreur.code).toBe('forbidden')
    expect(cinetpayIndisponible(new PaymentError(erreur.code, erreur.message))).toBe(false)
  })

  it('ne classe pas une panne réseau comme une absence de guichet', async () => {
    const erreur = await extractEdgeFunctionError(new Error('Connexion interrompue'))

    expect(erreur.code).toBe('edge_error')
    expect(cinetpayIndisponible(new Error(erreur.message))).toBe(false)
    expect(cinetpayIndisponible(new PaymentError('provider_unreachable', erreur.message))).toBe(
      false,
    )
  })

  it('annonce explicitement qu’aucun montant n’a été encaissé', () => {
    expect(MESSAGE_CINETPAY_ABSENT).toContain('Aucun montant n’a été encaissé')
    expect(MESSAGE_CINETPAY_ABSENT).not.toMatch(/simul/i)
  })
})
