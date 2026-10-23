import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import Facture from '@/pages/Facture'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'

/**
 * Montage réel de la facture A4.
 *
 * `facturation.test.ts` couvre les calculs. Ici, on vérifie ce que le document
 * contient : numéro, en-tête du pressing, lignes regroupées, acomptes, total en
 * toutes lettres et mention d'acquittement. Un document légal qui afficherait
 * un mauvais total sans qu'aucun test ne le voie serait le pire des cas.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORDER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

let racine: Root
let hote: HTMLDivElement

async function monter() {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(
      <MemoryRouter initialEntries={[`/commandes/${ORDER_ID}/facture`]}>
        <Routes>
          <Route path="/commandes/:orderId/facture" element={<Facture />} />
        </Routes>
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

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  await db.cashPayments.clear()
  useTenantStore.setState({
    tenantId: TENANT,
    tenantName: 'Pressing Cocody',
    role: 'owner',
    userId: 'user-1',
  })
})

describe('page Facture', () => {
  it('affiche l’en-tête, le numéro et le total en toutes lettres', async () => {
    await db.orders.add({
      id: ORDER_ID,
      tenantId: TENANT,
      customerName: 'Awa Koné',
      customerPhone: '0700000021',
      status: 'ready',
      qrCode: 'QR',
      photoUrl: null,
      totalAmount: 9_000,
      paymentStatus: 'partial',
      paymentMethod: 'cash',
      createdAt: '2026-03-14T09:30:00.000Z',
      updatedAt: '2026-03-14T09:30:00.000Z',
      synced: 1,
      syncedAt: '2026-03-14T09:35:00.000Z',
      serverVersion: 1,
      syncError: null,
      syncConflict: null,
      dueDate: '2026-03-16',
      assignedTo: null,
      assignedAt: null,
      statusReason: null,
    })

    await db.orderItems.bulkAdd([
      {
        id: 'l1',
        orderId: ORDER_ID,
        tenantId: TENANT,
        label: 'Chemise',
        fabricType: null,
        specialInstructions: null,
        price: 3_000,
        catalogEntryId: null,
        articleName: 'Chemise',
        serviceName: 'Lavage',
        priceReason: null,
      },
      {
        id: 'l2',
        orderId: ORDER_ID,
        tenantId: TENANT,
        label: 'Chemise',
        fabricType: null,
        specialInstructions: null,
        price: 3_000,
        catalogEntryId: null,
        articleName: 'Chemise',
        serviceName: 'Lavage',
        priceReason: null,
      },
      {
        id: 'l3',
        orderId: ORDER_ID,
        tenantId: TENANT,
        label: 'Pantalon',
        fabricType: null,
        specialInstructions: null,
        price: 3_000,
        catalogEntryId: null,
        articleName: 'Pantalon',
        serviceName: 'Repassage',
        priceReason: null,
      },
    ])

    await db.cashPayments.add({
      id: 'p1',
      orderId: ORDER_ID,
      tenantId: TENANT,
      amount: 4_000,
      method: 'cash',
      note: null,
      receivedAt: '2026-03-14T10:00:00.000Z',
      synced: 1,
      lastError: null,
    })

    await monter()
    // `Intl` insère des espaces insécables dans les montants : on normalise.
    const texte = (hote.textContent ?? '').replace(/\s/g, ' ')

    expect(texte).toContain('Facture')
    expect(texte).toContain('FA-2026-3B4C5D')
    expect(texte).toContain('Pressing Cocody')
    expect(texte).toContain('Awa Koné')
    // Lignes regroupées : deux chemises en une seule ligne, quantité 2.
    expect(texte).toContain('Chemise — Lavage')
    expect(texte).toContain('Pantalon — Repassage')
    expect(texte).toContain('9 000 FCFA')
    expect(texte).toContain('4 000 FCFA')
    expect(texte).toContain('5 000 FCFA')
    expect(texte).toContain('neuf mille francs CFA')
    expect(texte).not.toContain('Facture acquittée')

    demonter()
  })

  it('signale une facture acquittée quand tout est réglé', async () => {
    await db.orders.add({
      id: ORDER_ID,
      tenantId: TENANT,
      customerName: 'Awa Koné',
      customerPhone: '0700000021',
      status: 'delivered',
      qrCode: 'QR',
      photoUrl: null,
      totalAmount: 9_000,
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      createdAt: '2026-03-14T09:30:00.000Z',
      updatedAt: '2026-03-14T09:30:00.000Z',
      synced: 1,
      syncedAt: '2026-03-14T09:35:00.000Z',
      serverVersion: 1,
      syncError: null,
      syncConflict: null,
      dueDate: null,
      assignedTo: null,
      assignedAt: null,
      statusReason: null,
    })
    await db.cashPayments.add({
      id: 'p1',
      orderId: ORDER_ID,
      tenantId: TENANT,
      amount: 9_000,
      method: 'cash',
      note: null,
      receivedAt: '2026-03-14T10:00:00.000Z',
      synced: 1,
      lastError: null,
    })

    await monter()
    expect(hote.textContent).toContain('Facture acquittée')
    demonter()
  })

  it('explique une commande absente plutôt que d’afficher une page blanche', async () => {
    await monter()
    expect(hote.textContent).toContain('Commande introuvable')
    demonter()
  })
})
