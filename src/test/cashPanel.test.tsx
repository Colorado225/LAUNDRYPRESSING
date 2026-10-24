import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LocalOrder } from '@/db/localDb'

const { db } = await import('@/db/localDb')
const { useTenantStore } = await import('@/lib/tenantContext')
const { default: CashPanel } = await import('@/components/CashPanel')

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

function SuiviNavigation() {
  const location = useLocation()
  return <output data-testid="route-courante">{location.pathname}</output>
}

async function monter(order: LocalOrder) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(
      <MemoryRouter initialEntries={[`/commandes/${order.id}`]}>
        <CashPanel order={order} />
        <SuiviNavigation />
      </MemoryRouter>,
    )
  })
  await act(async () => {
    await new Promise((resoudre) => setTimeout(resoudre, 0))
  })
}

function demonter() {
  act(() => racine.unmount())
  hote.remove()
}

function bouton(libelle: string): HTMLButtonElement {
  const element = [...hote.querySelectorAll('button')].find((candidat) =>
    candidat.textContent?.includes(libelle),
  )
  if (!element) throw new Error(`Bouton introuvable : ${libelle}`)
  return element as HTMLButtonElement
}

beforeEach(async () => {
  await db.cashPayments.clear()
  await db.refunds.clear()
  useTenantStore.setState({
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantName: 'Pressing Cocody',
    role: 'receptionist',
  })
})

afterEach(() => {
  if (hote?.isConnected) demonter()
})

describe('Reçu après encaissement espèces', () => {
  it('ouvre automatiquement le reçu de la commande après l’enregistrement local du paiement', async () => {
    const order = commande()
    await monter(order)

    await act(async () => {
      bouton('Encaisser en espèces').click()
    })
    await act(async () => {
      bouton('Confirmer l’encaissement').click()
      await new Promise((resoudre) => setTimeout(resoudre, 40))
    })

    expect(hote.querySelector('[data-testid="route-courante"]')?.textContent).toBe(
      `/commandes/${order.id}/recu`,
    )
    const paiements = await db.cashPayments.where('orderId').equals(order.id).toArray()
    expect(paiements).toHaveLength(1)
    expect(paiements[0]).toMatchObject({ orderId: order.id, amount: 15000, method: 'cash' })

    demonter()
  })
})
