import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const depot = vi.hoisted(() => ({
  found: null as Record<string, unknown> | null,
  workshopOrders: [] as Array<Record<string, unknown>>,
  updateStatus: vi.fn(),
}))

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => depot.workshopOrders }))
vi.mock('@/components/QrScanner', () => ({ default: () => null }))
vi.mock('@/db/hooks', () => ({ useUpdateOrderStatus: () => depot.updateStatus }))
vi.mock('@/db/ordersRepository', () => ({
  findOrderByQrCode: async () => depot.found,
  getOrderWithItems: async () => depot.found,
  getWorkshopOrders: async () => [],
}))

import Atelier from '@/pages/Atelier'
import { useTenantStore } from '@/lib/tenantContext'

const TENANT = '11111111-1111-4111-8111-111111111111'
let root: Root
let host: HTMLDivElement

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><Atelier /></MemoryRouter>)
  })
}

function changeCode(value: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Code de l’étiquette"]')
  if (!input) throw new Error('Champ de code introuvable')
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function scan(code: string) {
  changeCode(code)
  const button = [...host.querySelectorAll('button')].find((entry) => entry.textContent?.includes('Rechercher'))
  if (!button) throw new Error('Bouton Rechercher introuvable')
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function atelierOrder(
  id: string,
  customerName: string,
  customerPhone: string,
  status: string,
): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    id,
    tenantId: TENANT,
    customerName,
    customerPhone,
    status,
    qrCode: `CMD-${id}`,
    photoUrl: null,
    totalAmount: 5000,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: now,
    updatedAt: now,
    synced: 1,
    syncedAt: now,
    serverVersion: 1,
    syncError: null,
    syncConflict: null,
    dueDate: null,
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
  }
}

beforeEach(() => {
  depot.workshopOrders = []
  depot.found = {
    order: {
      id: 'order-1',
      tenantId: TENANT,
      customerName: 'Awa Koné',
      customerPhone: '0700000001',
      status: 'washing',
      qrCode: 'CMD-order-1',
      totalAmount: 5000,
      paymentStatus: 'pending',
      synced: 1,
    },
    items: [{ id: 'item-1', label: 'Robe', fabricType: 'Coton', specialInstructions: null }],
  }
  depot.updateStatus.mockResolvedValue(undefined)
  useTenantStore.setState({ tenantId: TENANT, role: 'owner', userId: 'owner-1' })
})

afterEach(() => {
  if (host?.isConnected) {
    act(() => root.unmount())
    host.remove()
  }
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('améliorations UX de l’atelier', () => {
  it('annonce le scan, indique l’étape et met en avant la prochaine action', async () => {
    await mount()
    await scan('CMD-order-1')

    expect(host.querySelector('[role="status"]')?.textContent).toContain('Commande trouvée')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext'))
      .toBe('Étape 3 sur 8 : En lavage')
    expect(host.textContent).toContain('Étape suivante : En séchage')
    expect(host.querySelector('button.bg-brand-teal')?.className).toContain('min-h-14')
    expect([...host.querySelectorAll('button')].filter((button) => button.textContent?.trim() === 'Annulée'))
      .toHaveLength(1)
  })

  it('recherche par client et filtre la file par étape', async () => {
    depot.workshopOrders = [
      atelierOrder('order-awa', 'Awa Koné', '0700000001', 'washing'),
      atelierOrder('order-koffi', 'Koffi Yao', '0500000002', 'sorting'),
    ]
    depot.workshopOrders[1]!['dueDate'] = '2000-01-01'
    await mount()

    expect(host.querySelector('ul.grid li a')?.textContent).toContain('Koffi Yao')
    expect(host.textContent).toContain('En retard')
    expect(host.textContent).toContain('Awa Koné')
    expect(host.textContent).toContain('Koffi Yao')
    const search = host.querySelector<HTMLInputElement>('[aria-label="Rechercher une commande en atelier"]')
    if (!search) throw new Error('Recherche atelier introuvable')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, 'Awa')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.textContent).toContain('Awa Koné')
    expect(host.textContent).not.toContain('Koffi Yao')

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, '')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const sortingFilter = [...host.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('Filtrer : En tri'))
    if (!sortingFilter) throw new Error('Filtre de tri introuvable')
    act(() => sortingFilter.click())
    expect(host.textContent).toContain('Koffi Yao')
    expect(host.textContent).not.toContain('Awa Koné')
  })

  it('demande confirmation avant annulation depuis le résultat du scan', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await mount()
    await scan('CMD-order-1')
    const cancelButton = [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Annulée')
    if (!cancelButton) throw new Error('Bouton d’annulation introuvable')

    await act(async () => cancelButton.click())

    expect(confirmation).toHaveBeenCalledOnce()
    expect(depot.updateStatus).not.toHaveBeenCalled()
  })
})
