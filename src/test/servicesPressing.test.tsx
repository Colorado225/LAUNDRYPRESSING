import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantOnboardingContextValue } from '@/lib/tenantOnboarding'
import type { TenantServiceConfiguration } from '@/services/tenantServices'

const serviceMocks = vi.hoisted(() => ({
  fetchTenantServiceConfiguration: vi.fn(),
  createTenantActivity: vi.fn(),
  updateTenantActivity: vi.fn(),
  deleteTenantActivity: vi.fn(),
  createTenantService: vi.fn(),
  updateTenantService: vi.fn(),
  deleteTenantService: vi.fn(),
  completeTenantOnboarding: vi.fn(),
}))

vi.mock('@/services/tenantServices', () => ({
  fetchTenantServiceConfiguration: serviceMocks.fetchTenantServiceConfiguration,
  createTenantActivity: serviceMocks.createTenantActivity,
  updateTenantActivity: serviceMocks.updateTenantActivity,
  deleteTenantActivity: serviceMocks.deleteTenantActivity,
  createTenantService: serviceMocks.createTenantService,
  updateTenantService: serviceMocks.updateTenantService,
  deleteTenantService: serviceMocks.deleteTenantService,
  completeTenantOnboarding: serviceMocks.completeTenantOnboarding,
}))

const { useTenantStore } = await import('@/lib/tenantContext')
const { TenantOnboardingContext } = await import('@/lib/tenantOnboarding')
const { default: ServicesPressing } = await import('@/pages/ServicesPressing')

let root: Root
let host: HTMLDivElement
let configuration: TenantServiceConfiguration
const onboarding: TenantOnboardingContextValue = {
  state: 'required',
  markComplete: vi.fn(),
}

function button(label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find((element) =>
    (element.textContent ?? '').includes(label),
  )
  if (!result) throw new Error(`Bouton « ${label} » introuvable`)
  return result
}

function input(label: string): HTMLInputElement {
  const result = [...host.querySelectorAll('input')].find((element) =>
    element.getAttribute('aria-label') === label,
  )
  if (!result) throw new Error(`Champ « ${label} » introuvable`)
  return result
}

function select(label: string): HTMLSelectElement {
  const result = [...host.querySelectorAll('select')].find((element) =>
    element.getAttribute('aria-label') === label,
  )
  if (!result) throw new Error(`Sélecteur « ${label} » introuvable`)
  return result
}

async function choisir(selecteur: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(selecteur, value)
    selecteur.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function saisir(champ: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(champ, value)
    champ.dispatchEvent(new Event('input', { bubbles: true }))
    champ.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/bienvenue']}>
        <TenantOnboardingContext.Provider value={onboarding}>
          <Routes>
            <Route path="/bienvenue" element={<ServicesPressing />} />
            <Route path="/commandes" element={<p>Commandes</p>} />
          </Routes>
        </TenantOnboardingContext.Provider>
      </MemoryRouter>,
    )
  })
  await act(async () => { await Promise.resolve() })
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

beforeEach(() => {
  configuration = { activities: [], services: [] }
  serviceMocks.fetchTenantServiceConfiguration.mockReset().mockImplementation(async () => structuredClone(configuration))
  serviceMocks.createTenantActivity.mockReset().mockImplementation(async (_tenantId: string, name: string) => {
    configuration.activities.push({ id: 'activity-1', tenantId: 'tenant-new', name, sortOrder: 0 })
  })
  serviceMocks.updateTenantActivity.mockReset().mockImplementation(async (_tenantId: string, id: string, name: string) => {
    configuration.activities = configuration.activities.map((activity) => activity.id === id ? { ...activity, name } : activity)
  })
  serviceMocks.deleteTenantActivity.mockReset().mockImplementation(async (_tenantId: string, id: string) => {
    configuration.activities = configuration.activities.filter((activity) => activity.id !== id)
    configuration.services = configuration.services.filter((service) => service.activityId !== id)
  })
  serviceMocks.createTenantService.mockReset().mockImplementation(async (
    _tenantId: string,
    activityId: string,
    serviceName: string,
    billingUnit: 'PIECE' | 'KG',
    unitPrice: number | null,
  ) => {
    const activity = configuration.activities.find((entry) => entry.id === activityId)
    if (!activity) return
    configuration.services.push({
      id: 'service-1', tenantId: 'tenant-new', activityId, activityName: activity.name, serviceName, billingUnit, unitPrice, sortOrder: 0,
    })
  })
  serviceMocks.updateTenantService.mockReset().mockImplementation(async (
    _tenantId: string,
    id: string,
    activityId: string,
    name: string,
    billingUnit: 'PIECE' | 'KG',
    unitPrice: number | null,
  ) => {
    const activity = configuration.activities.find((entry) => entry.id === activityId)
    configuration.services = configuration.services.map((service) => service.id === id
      ? { ...service, activityId, activityName: activity?.name ?? '', serviceName: name, billingUnit, unitPrice }
      : service)
  })
  serviceMocks.deleteTenantService.mockReset().mockImplementation(async (_tenantId: string, id: string) => {
    configuration.services = configuration.services.filter((service) => service.id !== id)
  })
  serviceMocks.completeTenantOnboarding.mockReset().mockResolvedValue(undefined)
  vi.mocked(onboarding.markComplete).mockClear()
  useTenantStore.setState({ tenantId: 'tenant-new', role: 'owner', tenantName: 'Pressing Cocody' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('CRUD des activités et prestations du pressing', () => {
  it('crée une activité, lui rattache une prestation et termine l’onboarding', async () => {
    await mount()
    expect(host.textContent).toContain('Services & activités')
    expect(host.querySelector('[role="tablist"]')).not.toBeNull()

    await saisir(input('Nom de la nouvelle activité'), 'Nettoyage de tapis')
    await act(async () => button('Ajouter l’activité').click())
    expect(serviceMocks.createTenantActivity).toHaveBeenCalledWith('tenant-new', 'Nettoyage de tapis')

    await act(async () => button('Prestations').click())
    await saisir(input('Nom de la nouvelle prestation'), 'Tapis grand format')
    await act(async () => button('Ajouter la prestation').click())
    expect(serviceMocks.createTenantService).toHaveBeenCalledWith('tenant-new', 'activity-1', 'Tapis grand format', 'PIECE', null)

    await act(async () => button('Terminer la configuration').click())
    expect(serviceMocks.completeTenantOnboarding).toHaveBeenCalledWith('tenant-new')
    expect(onboarding.markComplete).toHaveBeenCalledOnce()
    unmount()
  })

  it('permet de renommer et supprimer une activité', async () => {
    configuration.activities = [{ id: 'activity-1', tenantId: 'tenant-new', name: 'Pressing', sortOrder: 0 }]
    await mount()

    await act(async () => button('Modifier').click())
    await saisir(input('Nouveau nom de Pressing'), 'Blanchisserie')
    await act(async () => button('Enregistrer').click())
    expect(serviceMocks.updateTenantActivity).toHaveBeenCalledWith('tenant-new', 'activity-1', 'Blanchisserie')
    expect(host.textContent).toContain('Blanchisserie')

    await act(async () => button('Supprimer').click())
    expect(serviceMocks.deleteTenantActivity).toHaveBeenCalledWith('tenant-new', 'activity-1')
    unmount()
  })

  it('configure une prestation au kilo avec un tarif personnalisé optionnel', async () => {
    configuration.activities = [{ id: 'activity-1', tenantId: 'tenant-new', name: 'Blanchisserie', sortOrder: 0 }]
    await mount()
    await act(async () => button('Prestations').click())
    await saisir(input('Nom de la nouvelle prestation'), 'Lavage et repassage au kilo')
    await choisir(select('Mode de facturation de la nouvelle prestation'), 'KG')
    await saisir(input('Tarif au kilo de la nouvelle prestation'), '1500')
    await act(async () => button('Ajouter la prestation').click())

    expect(serviceMocks.createTenantService).toHaveBeenCalledWith(
      'tenant-new', 'activity-1', 'Lavage et repassage au kilo', 'KG', 1500,
    )
    unmount()
  })
})
