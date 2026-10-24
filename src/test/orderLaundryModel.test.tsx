import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const depot = vi.hoisted(() => ({
  models: [] as Array<Record<string, unknown>>,
  createOrder: vi.fn(),
  getCachedCatalog: vi.fn(),
  refreshCatalog: vi.fn(),
  getCachedLaundryModels: vi.fn(),
  refreshLaundryModels: vi.fn(),
}))

vi.mock('@/db/hooks', () => ({ useCreateOrder: () => depot.createOrder }))
vi.mock('@/db/catalogRepository', () => ({
  getCachedCatalog: depot.getCachedCatalog,
  refreshCatalog: depot.refreshCatalog,
  servicesForArticle: () => [],
  uniqueArticles: () => [],
}))
vi.mock('@/db/laundryModelsRepository', () => ({
  getCachedLaundryModels: depot.getCachedLaundryModels,
  refreshLaundryModels: depot.refreshLaundryModels,
}))

import OrderForm from '@/pages/OrderForm'
import { useTenantStore } from '@/lib/tenantContext'

const TENANT = '11111111-1111-4111-8111-111111111111'
const MODEL = {
  id: '22222222-2222-4222-8222-222222222222',
  tenantId: TENANT,
  name: 'Linge au kilo',
  description: null,
  modelType: 'PER_KG',
  audience: 'ALL',
  pricePerKg: 1000,
  packagePrice: null,
  includedWeightKg: null,
  overagePricePerKg: null,
  minimumWeightKg: 1,
  billingIncrementKg: 0.1,
  minimumCharge: 1500,
  conditions: 'Linge trié par couleur',
  exclusions: null,
  pickupDeliveryTerms: null,
  turnaroundDays: 2,
  isActive: true,
  sortOrder: 0,
  services: [{ serviceId: '33333333-3333-4333-8333-333333333333', serviceName: 'Lavage standard', inclusionMode: 'INCLUDED', sortOrder: 0, serviceActive: true }],
}

let root: Root
let host: HTMLDivElement

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/commandes/nouvelle']}><OrderForm /></MemoryRouter>)
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function clickButton(label: string) {
  const button = [...host.querySelectorAll('button')].find((element) => element.textContent?.includes(label))
  if (!button) throw new Error(`Bouton introuvable : ${label}`)
  act(() => button.click())
}

function changeInput(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) throw new Error(`Champ introuvable : ${id}`)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  depot.models = [MODEL]
  depot.createOrder.mockResolvedValue({ order: { id: 'order-new' } })
  depot.getCachedCatalog.mockResolvedValue([])
  depot.refreshCatalog.mockResolvedValue(false)
  depot.getCachedLaundryModels.mockResolvedValue(depot.models)
  depot.refreshLaundryModels.mockResolvedValue(depot.models)
  useTenantStore.setState({ tenantId: TENANT, tenantName: 'Pressing Cocody', role: 'owner', userId: 'user-1' })
})

afterEach(() => {
  if (host?.isConnected) {
    act(() => root.unmount())
    host.remove()
  }
  vi.clearAllMocks()
})

describe('modèle commercial dans la création de commande', () => {
  it('calcule et transmet le poids réel et le tarif au kilo dans la ligne', async () => {
    await mount()
    changeInput('customer-name', 'Aïssata Koné')
    changeInput('customer-phone', '0700000000')
    clickButton('Suivant')
    clickButton('Au kilo / forfait')
    changeInput('item-laundry-weight-0', '2.35')

    expect(host.textContent).toContain('2.4 kg × 1000 FCFA/kg')
    expect(host.textContent).toContain('2\u202f400 FCFA')

    clickButton('Suivant')
    expect(host.textContent).toContain('2.35 kg')
    clickButton('Enregistrer la commande')

    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(depot.createOrder).toHaveBeenCalledTimes(1)
    const payload = depot.createOrder.mock.calls[0]?.[0]
    expect(payload.items[0]).toMatchObject({
      laundryModelId: MODEL.id,
      laundryModelNameSnapshot: 'Linge au kilo',
      laundryModelTypeSnapshot: 'PER_KG',
      laundryWeightKg: 2.35,
      laundryPricePerKgSnapshot: 1000,
      billingUnit: 'KG',
      quantity: 2.35,
      billedQuantity: 2.4,
      unitPrice: 1000,
      price: 2400,
    })
  })

  it('oblige à saisir et confirmer un montant si le poids dépasse un forfait sans supplément', async () => {
    const model = {
      ...MODEL,
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Forfait linge 5 kg',
      modelType: 'WEIGHT_PACKAGE',
      pricePerKg: null,
      packagePrice: 5000,
      includedWeightKg: 5,
      overagePricePerKg: null,
      minimumWeightKg: null,
      billingIncrementKg: 0.1,
      minimumCharge: null,
    }
    depot.models = [model]
    depot.getCachedLaundryModels.mockResolvedValue(depot.models)
    depot.refreshLaundryModels.mockResolvedValue(depot.models)
    await mount()
    changeInput('customer-name', 'Mariam Traoré')
    changeInput('customer-phone', '0700000001')
    clickButton('Suivant')
    clickButton('Au kilo / forfait')
    changeInput('item-laundry-weight-0', '6')
    changeInput('item-price-0', '6000')

    const confirmation = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0]
    expect(confirmation).toBeDefined()
    act(() => confirmation?.click())
    expect(confirmation?.checked).toBe(true)
    clickButton('Suivant')
    expect(host.textContent).toContain('6 kg')
    clickButton('Enregistrer la commande')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

    expect(depot.createOrder).toHaveBeenCalledTimes(1)
    expect(depot.createOrder.mock.calls[0]?.[0].items[0]).toMatchObject({
      laundryModelId: model.id,
      laundryModelTypeSnapshot: 'WEIGHT_PACKAGE',
      laundryWeightKg: 6,
      pricingMode: 'QUOTE',
      priceStatus: 'CONFIRMED',
      price: 6000,
      priceReason: 'Modèle commercial : Forfait linge 5 kg',
    })
  })
})
