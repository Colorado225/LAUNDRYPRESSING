import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import OfflineBadge from '@/components/OfflineBadge'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'
import { useSyncStore } from '@/stores/syncStore'

const TENANT = '11111111-1111-4111-8111-111111111111'

let root: Root
let host: HTMLDivElement

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><OfflineBadge /></MemoryRouter>)
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

beforeEach(async () => {
  await db.orders.clear()
  await db.cashPayments.clear()
  await db.orderIssues.clear()
  await db.notifications.clear()
  localStorage.clear()
  useTenantStore.setState({ tenantId: TENANT })
  useSyncStore.getState().reset()
})

describe('badge de synchronisation', () => {
  it('explique les éléments en attente et affiche la dernière réussite', async () => {
    const now = new Date().toISOString()
    await db.orders.add({
      id: 'pending-order',
      tenantId: TENANT,
      customerName: 'Awa Koné',
      customerPhone: '0700000001',
      status: 'received',
      qrCode: 'CMD-pending',
      photoUrl: null,
      totalAmount: 5000,
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
    })
    useSyncStore.getState().finishSync({ tenantId: TENANT, pendingCount: 0, lastError: null })

    await mount()
    const text = host.textContent ?? ''
    expect(text).toContain('En attente d’envoi')
    expect(text).toContain('1 élément en attente')
    expect(text).toContain('Dernière synchro')
    expect(text).toContain('Synchroniser')
    unmount()
  })
})
