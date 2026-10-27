import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalOrder } from '@/db/localDb'
import type { DisponibilitePaiement } from '@/services/paymentAvailability'

/**
 * Bouton « Payer par Mobile Money » — règle : aucun paiement fictif.
 *
 * Trois situations sont couvertes :
 *  1. clés marchandes absentes → le bouton n'est pas rendu du tout ;
 *  2. disponibilité inconnue (sonde muette) → bouton visible, mais un clic qui
 *     révèle l'absence de clés affiche une erreur claire **sans rien simuler** ;
 *  3. guichet installé → le clic ouvre réellement le guichet CinetPay.
 */

const etat: { disponibilite: DisponibilitePaiement | null; charger: () => Promise<DisponibilitePaiement | null> } =
  {
    disponibilite: null,
    charger: async () => null,
  }

const toastErreur = vi.fn()
const toastSucces = vi.fn()

vi.mock('react-hot-toast', () => {
  const appelable = Object.assign(vi.fn(), { error: toastErreur, success: toastSucces })
  return { default: appelable }
})

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))

vi.mock('@/services/paymentAvailability', async () => {
  const reel =
    await vi.importActual<typeof import('@/services/paymentAvailability')>(
      '@/services/paymentAvailability',
    )
  return {
    ...reel,
    // Le composant lit le cache au premier rendu puis interroge le serveur.
    lireDisponibiliteMemoisee: () => etat.disponibilite,
    chargerDisponibilitePaiement: () => etat.charger(),
    memoriserDisponibilite: () => undefined,
  }
})

const initiatePayment = vi.fn()
const redirectToPayment = vi.fn()

vi.mock('@/services/paymentService', async () => {
  const reel =
    await vi.importActual<typeof import('@/services/paymentService')>('@/services/paymentService')
  return {
    ...reel,
    initiatePayment: (...args: unknown[]) => initiatePayment(...args),
    redirectToPayment: (...args: unknown[]) => redirectToPayment(...args),
  }
})

const { db } = await import('@/db/localDb')
const { useTenantStore } = await import('@/lib/tenantContext')
const { MESSAGE_CINETPAY_ABSENT, PaymentError } = await import('@/services/paymentService')
const { default: PaymentButton } = await import('@/components/PaymentButton')

let racine: Root
let hote: HTMLDivElement

function commande(surcharge: Partial<LocalOrder> = {}): LocalOrder {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tenantId: '11111111-1111-4111-8111-111111111111',
    customerName: 'Awa Koné',
    customerPhone: '0707070707',
    status: 'ready',
    qrCode: 'CMD-EEEEEE',
    photoUrl: null,
    totalAmount: 15000,
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

async function monter(order: LocalOrder) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(<PaymentButton order={order} />)
  })
  await act(async () => {
    await new Promise((resoudre) => setTimeout(resoudre, 0))
  })
}

function demonter() {
  act(() => racine.unmount())
  hote.remove()
}

function texte(): string {
  return (hote.textContent ?? '').replace(/\u202f|\u00a0/g, ' ')
}

function boutonPay(): HTMLButtonElement | null {
  const trouve = [...hote.querySelectorAll('button')].find((element) =>
    element.textContent?.includes('Payer par Mobile Money'),
  )
  return (trouve as HTMLButtonElement | undefined) ?? null
}

async function cliquerPayer() {
  const bouton = boutonPay()
  if (!bouton) throw new Error('Bouton de paiement introuvable')
  await act(async () => {
    bouton.click()
  })
  await act(async () => {
    await new Promise((resoudre) => setTimeout(resoudre, 0))
  })
}

beforeEach(async () => {
  etat.disponibilite = null
  etat.charger = async () => null
  toastErreur.mockClear()
  toastSucces.mockClear()
  initiatePayment.mockReset()
  redirectToPayment.mockReset()
  await db.pendingPayments.clear()
  await db.orders.clear()
  useTenantStore.setState({
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantName: 'Pressing Cocody',
    role: 'receptionist',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Bouton Mobile Money', () => {
  it('n’affiche rien quand les clés marchandes sont absentes', async () => {
    etat.disponibilite = {
      configured: false,
      mode: 'production',
      missing: ['CINETPAY_API_KEY', 'CINETPAY_SITE_ID', 'CINETPAY_SECRET_KEY'],
    }
    etat.charger = async () => etat.disponibilite

    const order = commande()
    await db.orders.put(order)
    await monter(order)

    expect(hote.textContent).toBe('')
    expect(boutonPay()).toBeNull()

    demonter()
  })

  it('disparaît après que le serveur a révélé l’absence de clés, sans rien simuler', async () => {
    // Sonde muette : le bouton reste proposé (on ne masque pas un paiement qui
    // pourrait fonctionner).
    etat.charger = async () => null
    initiatePayment.mockRejectedValue(
      new PaymentError('provider_not_configured', 'CinetPay n’est pas configuré.'),
    )

    const order = commande()
    await db.orders.put(order)
    await monter(order)

    expect(boutonPay()).not.toBeNull()

    await cliquerPayer()

    // Message explicite, et aucune trace de paiement fictif.
    expect(toastErreur).toHaveBeenCalledWith(MESSAGE_CINETPAY_ABSENT, expect.anything())
    expect(toastSucces).not.toHaveBeenCalled()
    expect(await db.pendingPayments.count()).toBe(0)
    expect((await db.orders.get(order.id))?.paymentStatus).toBe('pending')

    // Le bouton est retiré immédiatement (la réponse serveur est mémorisée).
    expect(hote.textContent).toBe('')
    expect(boutonPay()).toBeNull()

    demonter()
  })

  it('ouvre réellement le guichet quand les clés sont installées', async () => {
    etat.disponibilite = { configured: true, mode: 'test', missing: [] }
    etat.charger = async () => etat.disponibilite
    initiatePayment.mockResolvedValue({
      paymentUrl: 'https://checkout.cinetpay.com/paiement/exemple',
      transactionId: 'TX-12345',
      chargedAmount: 15000,
      orderAmount: 15000,
    })

    const order = commande()
    await db.orders.put(order)
    await monter(order)

    expect(texte()).toContain('Payer par Mobile Money')

    await cliquerPayer()

    expect(initiatePayment).toHaveBeenCalledTimes(1)
    expect(redirectToPayment).toHaveBeenCalledWith('https://checkout.cinetpay.com/paiement/exemple')
    expect(toastErreur).not.toHaveBeenCalled()
    expect(await db.pendingPayments.count()).toBe(0)

    demonter()
  })

  it('n’affiche rien pour un rôle sans droit d’encaisser', async () => {
    etat.disponibilite = { configured: true, mode: 'production', missing: [] }
    useTenantStore.setState({ role: 'artisan' })

    await monter(commande())

    expect(hote.textContent).toBe('')

    demonter()
  })

  it('signale une commande déjà réglée sans proposer de nouveau paiement', async () => {
    etat.disponibilite = { configured: true, mode: 'production', missing: [] }

    const order = commande({ paymentStatus: 'paid' })
    await db.orders.put(order)
    await monter(order)

    expect(texte()).toContain('Commande réglée')
    expect(boutonPay()).toBeNull()

    demonter()
  })
})
