import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const tenantServiceMock = vi.hoisted(() => ({
  configuration: {
    activities: [] as Array<{ id: string; tenantId: string; name: string; sortOrder: number }>,
    services: [] as Array<{
      id: string
      tenantId: string
      activityId: string
      activityName: string
      serviceName: string
      billingUnit: 'PIECE' | 'KG'
      unitPrice: number | null
      sortOrder: number
    }>,
  },
}))

vi.mock('@/services/tenantServices', () => ({
  fetchTenantServiceConfiguration: vi.fn(async () => tenantServiceMock.configuration),
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
  tenantServiceMock.configuration = { activities: [], services: [] }
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
    tenantServiceMock.configuration = {
      activities: [{
        id: 'activity-blanchisserie',
        tenantId: TENANT,
        name: 'Blanchisserie',
        sortOrder: 0,
      }],
      services: [{
        id: '77777777-7777-4777-8777-777777777777',
        tenantId: TENANT,
        activityId: 'activity-blanchisserie',
        activityName: 'Blanchisserie',
        serviceName: 'Lavage et repassage au kilo',
        billingUnit: 'KG',
        unitPrice: 1500,
        sortOrder: 0,
      }],
    }
    await mount()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const clientInputs = host.querySelectorAll('input')
    setInput(clientInputs[0]!, 'Awa Koné')
    setInput(clientInputs[1]!, '0700000001')
    await act(async () => button('Suivant').click())

    const selectActivite = host.querySelector<HTMLSelectElement>('[aria-label="Activité de la ligne 1"]')
    const selectPrestation = host.querySelector<HTMLSelectElement>('[aria-label="Prestation de la ligne 1"]')
    expect(selectActivite).not.toBeNull()
    expect(selectPrestation).not.toBeNull()
    setSelect(selectActivite!, 'activity-blanchisserie')
    setSelect(selectPrestation!, '77777777-7777-4777-8777-777777777777')
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
    expect(item?.tenantServiceId).toBe('77777777-7777-4777-8777-777777777777')
    expect(item?.activityNameSnapshot).toBe('Blanchisserie')
    const composition = [
      { type: 'CHEMISE', quantity: 1 },
      { type: 'PANTALON', quantity: 2 },
    ]
    expect(item?.garmentDetails).toEqual(composition)
    expect(item && toSupabaseOrderItem(item).garment_details).toEqual(composition)
    expect(item && toSupabaseOrderItem(item).tenant_service_id).toBe('77777777-7777-4777-8777-777777777777')
    expect(item && toSupabaseOrderItem(item).activity_name_snapshot).toBe('Blanchisserie')
    unmount()
  })

  it('filtre les prestations par activité et enregistre les identifiants configurés', async () => {
    tenantServiceMock.configuration = {
      activities: [
        { id: 'activity-blanchisserie', tenantId: TENANT, name: 'Blanchisserie', sortOrder: 0 },
        { id: 'activity-repassage', tenantId: TENANT, name: 'Repassage', sortOrder: 1 },
      ],
      services: [{
        id: '88888888-8888-4888-8888-888888888888',
        tenantId: TENANT,
        activityId: 'activity-repassage',
        activityName: 'Repassage',
        serviceName: 'Repassage simple',
        billingUnit: 'PIECE',
        unitPrice: null,
        sortOrder: 0,
      }],
    }
    await mount()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    setInput(host.querySelectorAll('input')[0]!, 'Awa Koné')
    setInput(host.querySelectorAll('input')[1]!, '0700000001')
    await act(async () => button('Suivant').click())
    const article = host.querySelector<HTMLInputElement>('fieldset input')!
    setInput(article, 'Chemise')
    const activity = host.querySelector<HTMLSelectElement>('[aria-label="Activité de la ligne 1"]')!
    const service = host.querySelector<HTMLSelectElement>('[aria-label="Prestation de la ligne 1"]')!
    setSelect(activity, 'activity-blanchisserie')
    expect([...service.options].some((option) => option.textContent === 'Repassage simple')).toBe(false)
    setSelect(activity, 'activity-repassage')
    expect([...service.options].some((option) => option.textContent === 'Repassage simple')).toBe(true)
    setSelect(service, '88888888-8888-4888-8888-888888888888')
    expect(article.value).toBe('Chemise')
    setInput(host.querySelectorAll<HTMLInputElement>('fieldset input')[2]!, '2500')

    await act(async () => button('Suivant').click())
    await act(async () => {
      button('Enregistrer la commande').click()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const item = await db.orderItems.toCollection().first()
    expect(item?.label).toBe('Chemise')
    expect(item?.serviceName).toBe('Repassage simple')
    expect(item?.tenantServiceId).toBe('88888888-8888-4888-8888-888888888888')
    expect(item?.activityNameSnapshot).toBe('Repassage')
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
