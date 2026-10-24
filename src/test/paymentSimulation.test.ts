import { beforeEach, describe, expect, it } from 'vitest'
import { db, type LocalOrder } from '@/db/localDb'
import { PaymentError } from '@/services/paymentService'
import {
  cinetpayIndisponible,
  referenceSimulee,
  simulationExistante,
  simulerPaiement,
} from '@/services/paymentSimulation'

/**
 * Paiement simulé, en attendant la clé marchande.
 *
 * Deux garanties à protéger :
 *  1. la simulation **ne touche pas** au statut de paiement de la commande —
 *     une recette fictive fausserait le reste à encaisser, et le serveur
 *     refuserait de toute façon l'écriture (`guard_order_update`) ;
 *  2. seuls les échecs « CinetPay pas encore installé » déclenchent une
 *     simulation : un vrai refus (droits, montant) doit rester une erreur
 *     visible, jamais un paiement simulé silencieux.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'

function commande(surcharge: Partial<LocalOrder> = {}): LocalOrder {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tenantId: TENANT,
    customerName: 'Awa Koné',
    customerPhone: '0707070707',
    status: 'ready',
    qrCode: 'CMD-EEEEEE',
    photoUrl: null,
    totalAmount: 12003,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-21T09:00:00.000Z',
    synced: 1,
    syncedAt: '2026-10-21T09:01:00.000Z',
    serverVersion: 1,
    syncError: null,
    syncConflict: null,
    dueDate: '2026-10-25',
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
    ...surcharge,
  }
}

beforeEach(async () => {
  await db.pendingPayments.clear()
  await db.orders.clear()
})

describe('referenceSimulee', () => {
  it('porte un préfixe impossible à confondre avec CinetPay', () => {
    expect(referenceSimulee()).toMatch(/^SIM-\d{14}$/)
  })

  it('est stable pour une date donnée', () => {
    expect(referenceSimulee(new Date('2026-10-23T14:05:09.000Z'))).toBe('SIM-20261023140509')
  })
})

describe('simulerPaiement', () => {
  it('enregistre une trace locale au montant arrondi', async () => {
    const resultat = await simulerPaiement(commande())

    expect(resultat.montant).toBe(12005)
    const lignes = await db.pendingPayments.where('orderId').equals(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ).toArray()
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ status: 'simulated', amount: 12005, method: 'wave' })
  })

  it('ne modifie jamais la commande : rien n’a été encaissé', async () => {
    const order = commande()
    await db.orders.put(order)

    await simulerPaiement(order)

    const locale = await db.orders.get(order.id)
    expect(locale?.paymentStatus).toBe('pending')
    expect(locale?.paymentMethod).toBeNull()
    expect(locale?.synced).toBe(1)
  })

  it('reste idempotente quand on reclique', async () => {
    const order = commande()
    const premiere = await simulerPaiement(order)
    const seconde = await simulerPaiement(order)

    expect(seconde.reference).toBe(premiere.reference)
    expect(await db.pendingPayments.count()).toBe(1)
  })

  it('retrouve une simulation existante, et rien s’il n’y en a pas', async () => {
    const order = commande()
    expect(await simulationExistante(order.id)).toBeNull()

    const resultat = await simulerPaiement(order)
    expect((await simulationExistante(order.id))?.reference).toBe(resultat.reference)
  })
})

describe('cinetpayIndisponible', () => {
  it('reconnaît une fonction qui répond « non configuré »', () => {
    expect(cinetpayIndisponible(new PaymentError('provider_not_configured', 'CinetPay non configuré'))).toBe(true)
  })

  it('reconnaît une fonction non déployée et la configuration Supabase absente', () => {
    expect(cinetpayIndisponible(new PaymentError('function_not_deployed', 'Fonction non déployée'))).toBe(true)
    expect(cinetpayIndisponible(new PaymentError('supabase_unconfigured', 'Supabase non configuré'))).toBe(true)
  })

  it('ne masque PAS une panne réseau ou un vrai refus par une simulation', () => {
    expect(cinetpayIndisponible(new PaymentError('forbidden', 'Action non autorisée'))).toBe(false)
    expect(cinetpayIndisponible(new PaymentError('not_authenticated', 'Connectez-vous'))).toBe(false)
    expect(cinetpayIndisponible(new PaymentError('offline_or_unconfigured', 'Hors ligne'))).toBe(false)
    expect(cinetpayIndisponible(new PaymentError('edge_error', 'Le serveur ne répond pas'))).toBe(false)
    expect(cinetpayIndisponible(new PaymentError('provider_config_invalid', 'Configuration invalide'))).toBe(false)
    expect(cinetpayIndisponible(new Error('FunctionsFetchError: Failed to send a request'))).toBe(false)
    expect(cinetpayIndisponible(new Error('Montant invalide'))).toBe(false)
  })
})
