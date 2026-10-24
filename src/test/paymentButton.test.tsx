import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalOrder } from '@/db/localDb'

/**
 * Bouton « Payer par Mobile Money », avant l'installation de la clé marchande.
 *
 * Ce que le comptoir doit voir aujourd'hui : ni erreur technique, ni commande
 * marquée payée à tort, mais un message clair disant que le parcours a été
 * **simulé** et que rien n'a été encaissé.
 */

vi.mock('@/services/paymentService', async () => {
  const reel = await vi.importActual<typeof import('@/services/paymentService')>(
    '@/services/paymentService',
  )
  return {
    ...reel,
    canInitiatePayment: () => ({ ok: true, reason: null }),
    initiatePayment: async () => {
      throw new reel.PaymentError(
        'provider_not_configured',
        'CinetPay n’est pas configuré : définissez CINETPAY_API_KEY.',
      )
    },
    redirectToPayment: () => undefined,
  }
})

const { db } = await import('@/db/localDb')
const { useTenantStore } = await import('@/lib/tenantContext')
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

function boutonPay(): HTMLButtonElement {
  const trouve = [...hote.querySelectorAll('button')].find((element) =>
    element.textContent?.includes('Payer par Mobile Money'),
  )
  if (!trouve) throw new Error('Bouton de paiement introuvable')
  return trouve as HTMLButtonElement
}

beforeEach(async () => {
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

describe('Bouton Mobile Money sans clé CinetPay', () => {
  it('simule le paiement au lieu d’afficher une erreur technique', async () => {
    const order = commande()
    await db.orders.put(order)
    await monter(order)

    await act(async () => {
      boutonPay().click()
    })
    await act(async () => {
      await new Promise((resoudre) => setTimeout(resoudre, 0))
    })

    const lignes = await db.pendingPayments.where('orderId').equals(order.id).toArray()
    expect(lignes).toHaveLength(1)
    expect(lignes[0].status).toBe('simulated')
    expect(texte()).toContain('simulé')
    expect(texte()).toContain('Aucun argent n’a été encaissé')

    demonter()
  })

  it('laisse la commande à régler', async () => {
    const order = commande()
    await db.orders.put(order)
    await monter(order)

    await act(async () => {
      boutonPay().click()
    })
    await act(async () => {
      await new Promise((resoudre) => setTimeout(resoudre, 0))
    })

    const locale = await db.orders.get(order.id)
    expect(locale?.paymentStatus).toBe('pending')
    expect(locale?.paymentMethod).toBeNull()

    demonter()
  })

  it('rappelle une simulation déjà faite après rechargement', async () => {
    const order = commande()
    await db.pendingPayments.put({
      id: 'paiement-simule',
      orderId: order.id,
      tenantId: order.tenantId,
      amount: 15000,
      method: 'wave',
      status: 'simulated',
      reference: 'SIM-20261023140509',
      createdAt: '2026-10-23T14:05:09.000Z',
      lastError: null,
    })

    await monter(order)

    expect(texte()).toContain('SIM-20261023140509')
    expect(texte()).toContain('simulé')

    demonter()
  })

  it('n’affiche rien pour un rôle sans droit d’encaisser', async () => {
    useTenantStore.setState({ role: 'artisan' })
    await monter(commande())

    expect(hote.textContent).toBe('')

    demonter()
  })
})
