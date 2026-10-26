import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantOnboardingContextValue } from '@/lib/tenantOnboarding'
import type {
  TenantServiceConfiguration,
  TenantServiceOffering,
} from '@/services/tenantServices'

const serviceMocks = vi.hoisted(() => ({
  fetchTenantServiceConfiguration: vi.fn(),
  createTenantActivity: vi.fn(),
  updateTenantActivity: vi.fn(),
  deleteTenantActivity: vi.fn(),
  createTenantCategory: vi.fn(),
  updateTenantCategory: vi.fn(),
  deleteTenantCategory: vi.fn(),
  createTenantService: vi.fn(),
  updateTenantService: vi.fn(),
  deleteTenantService: vi.fn(),
  duplicateTenantService: vi.fn(),
  createWeightTier: vi.fn(),
  updateWeightTier: vi.fn(),
  deleteWeightTier: vi.fn(),
  importSuggestedCatalog: vi.fn(),
  completeTenantOnboarding: vi.fn(),
}))

vi.mock('@/services/tenantServices', () => ({
  fetchTenantServiceConfiguration: serviceMocks.fetchTenantServiceConfiguration,
  createTenantActivity: serviceMocks.createTenantActivity,
  updateTenantActivity: serviceMocks.updateTenantActivity,
  deleteTenantActivity: serviceMocks.deleteTenantActivity,
  createTenantCategory: serviceMocks.createTenantCategory,
  updateTenantCategory: serviceMocks.updateTenantCategory,
  deleteTenantCategory: serviceMocks.deleteTenantCategory,
  createTenantService: serviceMocks.createTenantService,
  updateTenantService: serviceMocks.updateTenantService,
  deleteTenantService: serviceMocks.deleteTenantService,
  duplicateTenantService: serviceMocks.duplicateTenantService,
  createWeightTier: serviceMocks.createWeightTier,
  updateWeightTier: serviceMocks.updateWeightTier,
  deleteWeightTier: serviceMocks.deleteWeightTier,
  importSuggestedCatalog: serviceMocks.importSuggestedCatalog,
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

function offering(overrides: Partial<TenantServiceOffering>): TenantServiceOffering {
  return {
    id: `service-${Math.random().toString(36).slice(2)}`,
    tenantId: 'tenant-new',
    activityId: 'activity-1',
    activityName: 'Blanchisserie',
    categoryId: null,
    serviceName: 'Prestation',
    billingUnit: 'PIECE',
    pricingMode: 'FIXED',
    unitPrice: null,
    description: null,
    durationMinutes: null,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  }
}

beforeEach(() => {
  configuration = { activities: [], categories: [], services: [], tiers: [] }
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
  serviceMocks.createTenantCategory.mockReset().mockImplementation(async (
    _tenantId: string,
    activityId: string,
    name: string,
  ) => {
    configuration.categories.push({
      id: 'category-1', tenantId: 'tenant-new', activityId, name, sortOrder: 0, isActive: true,
    })
  })
  serviceMocks.updateTenantCategory.mockResolvedValue(undefined)
  serviceMocks.deleteTenantCategory.mockReset().mockImplementation(async (_tenantId: string, id: string) => {
    configuration.categories = configuration.categories.filter((category) => category.id !== id)
  })
  serviceMocks.createTenantService.mockReset().mockImplementation(async (
    _tenantId: string,
    activityId: string,
    serviceName: string,
    billingUnit: TenantServiceOffering['billingUnit'],
    unitPrice: number | null,
  ) => {
    const activity = configuration.activities.find((entry) => entry.id === activityId)
    if (!activity) return
    configuration.services.push(
      offering({
        id: `service-${configuration.services.length + 1}`,
        activityId,
        activityName: activity.name,
        serviceName,
        billingUnit,
        unitPrice,
      }),
    )
  })
  serviceMocks.updateTenantService.mockResolvedValue(undefined)
  serviceMocks.duplicateTenantService.mockResolvedValue(undefined)
  serviceMocks.deleteTenantService.mockReset().mockImplementation(async (_tenantId: string, id: string) => {
    configuration.services = configuration.services.filter((service) => service.id !== id)
  })
  serviceMocks.createWeightTier.mockReset().mockImplementation(async (
    _tenantId: string,
    tenantServiceId: string,
    label: string,
    weightKg: number,
    priceFcfa: number,
  ) => {
    configuration.tiers.push({
      id: `tier-${configuration.tiers.length + 1}`,
      tenantId: 'tenant-new',
      tenantServiceId,
      label,
      weightKg,
      priceFcfa,
      isActive: true,
      sortOrder: configuration.tiers.length,
    })
  })
  serviceMocks.updateWeightTier.mockResolvedValue(undefined)
  serviceMocks.deleteWeightTier.mockResolvedValue(undefined)
  serviceMocks.importSuggestedCatalog.mockResolvedValue({
    activitiesCreated: 2,
    categoriesCreated: 5,
    servicesCreated: 26,
    tiersCreated: 6,
    skipped: 0,
  })
  serviceMocks.completeTenantOnboarding.mockReset().mockResolvedValue(undefined)
  vi.mocked(onboarding.markComplete).mockClear()
  useTenantStore.setState({ tenantId: 'tenant-new', role: 'owner', tenantName: 'Pressing Cocody' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('CRUD des activités et prestations du pressing', () => {
  it('crée une activité, lui rattache une prestation et termine l’onboarding', async () => {
    await mount()
    expect(host.textContent).toContain('Catalogue de prestations')
    expect(host.querySelector('[role="tablist"]')).not.toBeNull()

    await saisir(input('Nom de la nouvelle activité'), 'Nettoyage de tapis')
    await act(async () => button('Ajouter l’activité').click())
    expect(serviceMocks.createTenantActivity).toHaveBeenCalledWith('tenant-new', 'Nettoyage de tapis')

    await act(async () => button('Prestations').click())
    await saisir(input('Nom de la prestation'), 'Tapis grand format')
    await act(async () => button('Ajouter la prestation').click())
    const appel = serviceMocks.createTenantService.mock.calls[0]
    expect(appel?.slice(0, 5)).toEqual([
      'tenant-new', 'activity-1', 'Tapis grand format', 'PIECE', null,
    ])

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

  it('configure une prestation au kilo avec un tarif de référence', async () => {
    configuration.activities = [{ id: 'activity-1', tenantId: 'tenant-new', name: 'Blanchisserie', sortOrder: 0 }]
    await mount()
    await act(async () => button('Prestations').click())
    await saisir(input('Nom de la prestation'), 'Lavage et repassage au kilo')
    await choisir(select('Mode de facturation de la prestation'), 'KG')
    await saisir(input('Tarif de référence de la prestation'), '1500')
    await act(async () => button('Ajouter la prestation').click())

    expect(serviceMocks.createTenantService).toHaveBeenCalledWith(
      'tenant-new', 'activity-1', 'Lavage et repassage au kilo', 'KG', 1500,
      expect.objectContaining({ pricingMode: 'FIXED' }),
    )
    unmount()
  })

  it('crée une catégorie rattachée à une activité', async () => {
    configuration.activities = [{ id: 'activity-1', tenantId: 'tenant-new', name: 'Blanchisserie', sortOrder: 0 }]
    await mount()
    await act(async () => button('Catégories').click())

    await saisir(input('Nom de la nouvelle catégorie'), 'Forfaits au poids')
    await act(async () => button('Ajouter la catégorie').click())
    expect(serviceMocks.createTenantCategory).toHaveBeenCalledWith(
      'tenant-new', 'activity-1', 'Forfaits au poids',
    )
    unmount()
  })

  it('crée un forfait poids puis ses paliers', async () => {
    configuration.activities = [{ id: 'activity-1', tenantId: 'tenant-new', name: 'Blanchisserie', sortOrder: 0 }]
    configuration.services = [
      offering({
        id: 'service-forfait',
        serviceName: 'Laver repasser (forfait poids)',
        billingUnit: 'PACKAGE',
      }),
    ]
    await mount()
    await act(async () => button('Prestations').click())

    // Création d'un forfait : aucun prix de référence possible.
    await saisir(input('Nom de la prestation'), 'Laver plier (forfait poids)')
    await choisir(select('Mode de facturation de la prestation'), 'PACKAGE')
    expect(host.querySelector('[aria-label="Tarif de référence de la prestation"]')).toBeNull()
    await act(async () => button('Ajouter la prestation').click())
    expect(serviceMocks.createTenantService).toHaveBeenCalledWith(
      'tenant-new', 'activity-1', 'Laver plier (forfait poids)', 'PACKAGE', null,
      expect.objectContaining({ pricingMode: 'FIXED' }),
    )

    // Gestion des paliers sur la carte du forfait existant.
    await act(async () => button('Gérer').click())
    await saisir(input('Libellé du palier pour Laver repasser (forfait poids)'), '10 kg')
    await saisir(input('Poids du palier pour Laver repasser (forfait poids)'), '10')
    await saisir(input('Prix du palier pour Laver repasser (forfait poids)'), '15000')
    const boutonAjout = [...host.querySelectorAll('button')].find(
      (element) => (element.textContent ?? '').trim() === 'Ajouter',
    ) as HTMLButtonElement
    await act(async () => boutonAjout.click())
    expect(serviceMocks.createWeightTier).toHaveBeenCalledWith(
      'tenant-new', 'service-forfait', '10 kg', 10, 15000,
    )
    unmount()
  })

  it('un devis n’expose aucun tarif de référence', async () => {
    configuration.activities = [{ id: 'activity-1', tenantId: 'tenant-new', name: 'Pressing', sortOrder: 0 }]
    await mount()
    await act(async () => button('Prestations').click())

    await saisir(input('Nom de la prestation'), 'Nettoyage canapé sur devis')
    await choisir(select('Mode de facturation de la prestation'), 'FLAT')
    expect(select('Mode de tarification de la prestation').value).toBe('QUOTE')
    expect(host.querySelector('[aria-label="Tarif de référence de la prestation"]')).toBeNull()
    unmount()
  })

  it('propose l’import explicite de la grille type', async () => {
    await mount()
    await act(async () => button('Importer la grille type').click())
    expect(serviceMocks.importSuggestedCatalog).toHaveBeenCalledOnce()
    unmount()
  })
})
