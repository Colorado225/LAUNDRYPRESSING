import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantOnboardingContextValue } from '@/lib/tenantOnboarding'

const serviceMocks = vi.hoisted(() => ({
  fetchTenantServices: vi.fn(),
  saveTenantServices: vi.fn(),
}))

vi.mock('@/services/tenantServices', () => ({
  fetchTenantServices: serviceMocks.fetchTenantServices,
  saveTenantServices: serviceMocks.saveTenantServices,
}))

const { useTenantStore } = await import('@/lib/tenantContext')
const { TenantOnboardingContext } = await import('@/lib/tenantOnboarding')
const { default: ServicesPressing } = await import('@/pages/ServicesPressing')

let root: Root
let host: HTMLDivElement
const onboarding: TenantOnboardingContextValue = {
  state: 'required',
  markComplete: vi.fn(),
}

function textButton(label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((element) =>
    (element.textContent ?? '').includes(label),
  )
  if (!button) throw new Error(`Bouton « ${label} » introuvable`)
  return button
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
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

beforeEach(() => {
  serviceMocks.fetchTenantServices.mockReset().mockResolvedValue([])
  serviceMocks.saveTenantServices.mockReset().mockResolvedValue(undefined)
  vi.mocked(onboarding.markComplete).mockClear()
  useTenantStore.setState({ tenantId: 'tenant-new', role: 'owner', tenantName: 'Pressing Cocody' })
})

describe('onboarding des prestations du pressing', () => {
  it('permet de choisir une activité, personnaliser ses prestations et terminer', async () => {
    await mount()

    await act(async () => {
      await Promise.resolve()
    })

    expect(host.textContent).toContain('Quelles activités proposez-vous ?')
    await act(async () => textButton('Pressing').click())
    await act(async () => textButton('Continuer vers les prestations').click())

    expect(host.textContent).toContain('Personnalisez vos prestations')
    await act(async () => textButton('Terminer la configuration').click())

    expect(serviceMocks.saveTenantServices).toHaveBeenCalledWith('tenant-new', expect.arrayContaining([
      { activityCode: 'pressing', serviceName: 'Lavage et repassage' },
      { activityCode: 'pressing', serviceName: 'Détachage' },
    ]))
    expect(onboarding.markComplete).toHaveBeenCalledOnce()

    unmount()
  })
})
