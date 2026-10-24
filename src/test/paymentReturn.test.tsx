import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalOrder } from '@/db/localDb'

const { fetchPaymentState } = vi.hoisted(() => ({ fetchPaymentState: vi.fn() }))
vi.mock('@/services/paymentService', () => ({ fetchPaymentState }))

const { db } = await import('@/db/localDb')
const { default: PaymentReturn } = await import('@/pages/PaymentReturn')

let racine: Root
let hote: HTMLDivElement

function commande(): LocalOrder {
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
  }
}

function RouteActuelle() {
  const location = useLocation()
  return <output data-testid="route-courante">{location.pathname}</output>
}

async function monter(order: LocalOrder) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(
      <MemoryRouter initialEntries={[`/paiement/retour?order=${order.id}&transaction_id=txn-test`]}>
        <Routes>
          <Route path="/paiement/retour" element={<PaymentReturn />} />
          <Route path="/commandes/:orderId/recu" element={<p>Reçu prêt à imprimer</p>} />
        </Routes>
        <RouteActuelle />
      </MemoryRouter>,
    )
    await new Promise((resoudre) => setTimeout(resoudre, 20))
  })
}

function demonter() {
  act(() => racine.unmount())
  hote.remove()
}

beforeEach(async () => {
  await db.orders.clear()
  fetchPaymentState.mockReset()
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
})

afterEach(() => {
  if (hote?.isConnected) demonter()
})

describe('Reçu après retour Mobile Money', () => {
  it('ouvre le reçu uniquement quand le serveur confirme le paiement', async () => {
    const order = commande()
    await db.orders.put(order)
    fetchPaymentState.mockResolvedValue({
      paymentStatus: 'paid',
      paymentMethod: 'wave',
      transactionStatus: 'ACCEPTED',
      paidAt: '2026-10-24T10:00:00.000Z',
      fromServer: true,
    })

    await monter(order)

    expect(hote.querySelector('[data-testid="route-courante"]')?.textContent).toBe(
      `/commandes/${order.id}/recu`,
    )
    expect(hote.textContent).toContain('Reçu prêt à imprimer')

    demonter()
  })

  it('ne redirige pas vers le reçu tant que le paiement est en attente', async () => {
    const order = commande()
    await db.orders.put(order)
    fetchPaymentState.mockResolvedValue({
      paymentStatus: 'pending',
      paymentMethod: 'wave',
      transactionStatus: 'PENDING',
      paidAt: null,
      fromServer: true,
    })

    await monter(order)

    expect(hote.querySelector('[data-testid="route-courante"]')?.textContent).toBe(
      '/paiement/retour',
    )
    expect(hote.textContent).toContain('Vérifier à nouveau')

    demonter()
  })
})
