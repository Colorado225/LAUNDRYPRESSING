import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const tenantServiceMock = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string
    tenantId: string
    activityId: string
    activityName: string
    serviceName: string
    billingUnit: 'PIECE' | 'KG'
    unitPrice: number | null
    sortOrder: number
  }>,
}))

vi.mock('@/services/tenantServices', () => ({
  fetchTenantServices: vi.fn(async () => tenantServiceMock.rows),
}))
import OrderForm from '@/pages/OrderForm'
import { db } from '@/db/localDb'
import { toSupabaseOrderItem } from '@/db/ordersRepository'
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

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  if (!setter) throw new Error('Setter de valeur select indisponible')
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  await db.tenantActivities.clear()
  await db.tenantServices.clear()
  tenantServiceMock.rows = []
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

  it('énumère les vêtements, pèse le lot et calcule une prestation au kilo', async () => {
    tenantServiceMock.rows = [{
      id: 'service-kilo',
      tenantId: TENANT,
      activityId: 'activity-blanchisserie',
      activityName: 'Blanchisserie',
      serviceName: 'Lavage et repassage au kilo',
      billingUnit: 'KG',
      unitPrice: 1500,
      sortOrder: 0,
    }]
    await mount()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const clientInputs = host.querySelectorAll('input')
    setInput(clientInputs[0]!, 'Awa Koné')
    setInput(clientInputs[1]!, '0700000001')
    await act(async () => button('Suivant').click())

    const selectPrestation = host.querySelector<HTMLSelectElement>('[aria-label="Prestation de la ligne 1"]')
    expect(selectPrestation).not.toBeNull()
    setSelect(selectPrestation!, 'service-kilo')
    const poids = host.querySelector<HTMLInputElement>('[aria-label="Poids total (kg) ligne 1"]')
    const tarif = host.querySelector<HTMLInputElement>('[aria-label="Tarif au kilo ligne 1 (FCFA)"]')
    expect(poids).not.toBeNull()
    expect(tarif).not.toBeNull()
    setInput(poids!, '1')
    setInput(tarif!, '1500')

    setSelect(host.querySelector<HTMLSelectElement>('[aria-label="Type de vêtement 1 ligne 1"]')!, 'CHEMISE')
    await act(async () => button('Ajouter un type').click())
    setSelect(host.querySelector<HTMLSelectElement>('[aria-label="Type de vêtement 2 ligne 1"]')!, 'PANTALON')
    const nombrePantalons = host.querySelector<HTMLInputElement>('[aria-label="Nombre d’articles 2 ligne 1"]')
    expect(nombrePantalons).not.toBeNull()
    setInput(nombrePantalons!, '2')
    expect(host.textContent?.replace(/\s/g, '')).toContain('1500FCFA')
    expect(host.textContent).toContain('1 × Chemise, 2 × Pantalon')

    await act(async () => button('Suivant').click())
    await act(async () => {
      button('Enregistrer la commande').click()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const order = await db.orders.toCollection().first()
    const item = await db.orderItems.toCollection().first()
    expect(order?.totalAmount).toBe(1500)
    expect(item?.billingUnit).toBe('KG')
    expect(item?.quantity).toBe(1)
    expect(item?.unitPrice).toBe(1500)
    const composition = [
      { type: 'CHEMISE', quantity: 1 },
      { type: 'PANTALON', quantity: 2 },
    ]
    expect(item?.garmentDetails).toEqual(composition)
    expect(item && toSupabaseOrderItem(item).garment_details).toEqual(composition)
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
