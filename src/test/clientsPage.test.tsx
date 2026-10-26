import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Clients from '@/pages/Clients'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'

/**
 * Écran Clients après l'ajout du CRUD (migration 025).
 *
 * Le rendu est réel et le client Supabase est remplacé par une chaîne vide :
 * ce qui se vérifie ici, c'est ce que le comptoir voit et peut déclencher.
 * Les requêtes elles-mêmes sont couvertes par `crudServices.test.ts`, et les
 * politiques RLS par `supabase/tests/crud_complet.sql`.
 */

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))

const clientFactice = vi.hoisted(() => {
  const chaine: Record<string, unknown> = {
    select: () => chaine,
    eq: () => chaine,
    order: () => chaine,
    then: (resoudre: (valeur: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resoudre),
  }

  return {
    from: () => chaine,
    rpc: () => Promise.resolve({ data: null, error: null }),
  }
})

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => clientFactice }))

const TENANT = '11111111-1111-4111-8111-111111111111'

let racine: Root
let hote: HTMLDivElement

async function monter() {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(
      <MemoryRouter>
        <Clients />
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

function bouton(libelle: string): HTMLButtonElement | undefined {
  return [...hote.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(libelle),
  ) as HTMLButtonElement | undefined
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  useTenantStore.setState({
    tenantId: TENANT,
    tenantName: 'Pressing Cocody',
    role: 'owner',
    userId: 'user-1',
    shops: [{ tenantId: TENANT, tenantName: 'Pressing Cocody', role: 'owner' }],
  })
})

describe('page Clients', () => {
  it('affiche l’état vide et le formulaire de création pour le propriétaire', async () => {
    await monter()

    expect(hote.textContent).toContain('Clients')
    expect(hote.textContent).toContain('0 client connu')
    expect(hote.textContent).toContain('Aucun client ne correspond à cette recherche.')

    await act(async () => {
      bouton('Nouveau client')?.click()
    })

    expect(hote.textContent).toContain('Pour un client qui n’a pas encore de commande')
    expect(hote.querySelector('input[placeholder="07 00 00 00 21"]')).not.toBeNull()

    demonter()
  })

  it('ouvre la création au réceptionniste mais pas à l’atelier', async () => {
    useTenantStore.setState({ role: 'receptionist' })
    await monter()
    expect(bouton('Nouveau client')).toBeDefined()
    demonter()

    useTenantStore.setState({ role: 'artisan' })
    await monter()
    expect(bouton('Nouveau client')).toBeUndefined()
    demonter()
  })

  it('liste un client issu d’une commande locale et son reste dû', async () => {
    await db.orders.add({
      id: 'commande-1',
      tenantId: TENANT,
      customerName: 'Awa Koné',
      customerPhone: '0700000021',
      status: 'received',
      qrCode: 'CMD-1',
      photoUrl: null,
      totalAmount: 7_500,
      paymentStatus: 'partial',
      paymentMethod: null,
      createdAt: '2026-10-23T08:00:00.000Z',
      updatedAt: '2026-10-23T08:00:00.000Z',
      synced: 1,
      syncedAt: '2026-10-23T08:00:00.000Z',
      serverVersion: 1,
      syncError: null,
      syncConflict: null,
      dueDate: null,
      assignedTo: null,
      assignedAt: null,
      statusReason: null,
    })

    await monter()

    expect(hote.textContent).toContain('Awa Koné')
    expect(hote.textContent).toContain('1 commande')

    await act(async () => {
      bouton('Awa Koné')?.click()
    })

    expect(hote.textContent).toContain('Reste dû')
    expect(hote.textContent).toContain('Créer la fiche détaillée')
    expect(hote.textContent).toContain('Créer la fiche')

    demonter()
  })
})
