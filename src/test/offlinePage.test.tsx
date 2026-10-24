import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Offline from '@/pages/Offline'
import { db, type LocalOrder } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'

const TENANT = '11111111-1111-4111-8111-111111111111'
let host: HTMLDivElement
let root: Root

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/offline']}>
        <Offline />
      </MemoryRouter>,
    )
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

beforeEach(async () => {
  await db.orders.clear()
  useTenantStore.setState({ tenantId: TENANT })
  setOnline(false)
})

afterEach(() => {
  setOnline(true)
  if (host?.isConnected) unmount()
})

function commandeEnAttente(): LocalOrder {
  const now = '2026-10-24T10:00:00.000Z'
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenantId: TENANT,
    customerName: 'Awa Koné',
    customerPhone: '+2250700000001',
    status: 'received',
    qrCode: 'QR',
    photoUrl: null,
    totalAmount: 2500,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: now,
    updatedAt: now,
    synced: 0,
    syncedAt: null,
    serverVersion: 0,
    syncError: null,
    syncConflict: null,
    dueDate: null,
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
  }
}

describe('écran hors ligne', () => {
  it('explique les actions disponibles et le nombre de commandes en attente', async () => {
    await db.orders.add(commandeEnAttente())
    await mount()

    const texte = (host.textContent ?? '').replace(/\s/g, ' ')
    expect(texte).toContain('Vous êtes hors ligne')
    expect(texte).toContain('Disponible hors ligne')
    expect(texte).toContain('Scanner les étiquettes QR en atelier')
    expect(texte).toContain('Payer par Mobile Money')
    expect(texte).toContain('1 commande en attente d’envoi')

    unmount()
  })

  it('réagit aux événements de retour et de perte du réseau', async () => {
    await mount()
    expect(host.textContent).toContain('Vous êtes hors ligne')

    act(() => {
      setOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(host.textContent).toContain('La connexion est revenue')

    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(host.textContent).toContain('Vous êtes hors ligne')

    unmount()
  })
})
