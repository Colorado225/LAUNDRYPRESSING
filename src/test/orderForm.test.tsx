import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import OrderForm from '@/pages/OrderForm'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'

const TENANT = '11111111-1111-4111-8111-111111111111'
let root: Root
let host: HTMLDivElement

function CurrentPath() {
  const location = useLocation()
  return <output data-testid="path">{location.pathname}{location.search}</output>
}

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/commandes/nouvelle']}>
        <CurrentPath />
        <Routes>
          <Route path="/commandes/nouvelle" element={<OrderForm />} />
          <Route path="/commandes/:id" element={null} />
          <Route path="/commandes" element={null} />
        </Routes>
      </MemoryRouter>,
    )
  })
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((entry) => entry.textContent?.includes(label))
  if (!found) throw new Error(`Bouton « ${label} » introuvable`)
  return found
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Setter de valeur input indisponible')
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  useTenantStore.setState({ tenantId: TENANT, tenantName: 'Pressing Cocody', role: 'owner' })
})

describe('OrderForm — création libre', () => {
  it('crée la commande puis ouvre la fiche pour confirmer les espèces', async () => {
    await mount()
    const clientInputs = host.querySelectorAll('input')
    setInput(clientInputs[0]!, 'Awa Koné')
    setInput(clientInputs[1]!, '0700000001')
    await act(async () => button('Suivant').click())

    const lineInputs = host.querySelectorAll('input')
    setInput(lineInputs[0]!, 'Chemise')
    setInput(lineInputs[2]!, '2500')
    expect(host.textContent?.replace(/\s/g, '')).toContain('2500FCFA')
    await act(async () => button('Suivant').click())
    await act(async () => button('Encaisser des espèces maintenant').click())
    await act(async () => {
      button('Enregistrer la commande').click()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(await db.orders.count()).toBe(1)
    const order = await db.orders.toCollection().first()
    expect(order?.totalAmount).toBe(2500)
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(`/commandes/${order?.id}?regler=1`)
    unmount()
  })

  it('annule le formulaire client et revient à la liste', async () => {
    await mount()
    await act(async () => button('Annuler').click())
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe('/commandes')
    expect(await db.orders.count()).toBe(0)
    unmount()
  })
})
