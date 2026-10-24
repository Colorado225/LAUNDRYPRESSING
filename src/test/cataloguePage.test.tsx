import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const depot = vi.hoisted(() => ({
  entries: [] as Array<{
    id: string
    tenantId: string
    article: string
    service: string
    price: number
    pricingMode: 'FIXED' | 'FROM' | 'QUOTE' | 'UNCONFIGURED'
    billingUnit: 'PIECE' | 'PAIR' | 'SET' | 'KG' | 'M2' | 'METER' | 'PACKAGE' | 'FLAT'
    requiresReview: boolean
    isActive: boolean
    sortOrder: number
  }>,
  createCatalogEntry: vi.fn(),
  deactivateCatalogEntry: vi.fn(),
  getCachedCatalog: vi.fn(),
  refreshCatalog: vi.fn(),
  seedDefaultCatalog: vi.fn(),
  updateCatalogEntry: vi.fn(),
}))

vi.mock('@/db/catalogRepository', () => depot)

import Catalogue from '@/pages/Catalogue'
import { useTenantStore } from '@/lib/tenantContext'

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
        <Catalogue />
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

function bouton(libelle: string): HTMLButtonElement {
  const trouve = [...hote.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(libelle),
  )
  if (!trouve) throw new Error(`Bouton introuvable : ${libelle}`)
  return trouve as HTMLButtonElement
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  depot.entries = [
    {
      id: 'tarif-actif',
      tenantId: TENANT,
      article: 'Chemise',
      service: 'Lavage et repassage',
      price: 1000,
      pricingMode: 'FIXED',
      billingUnit: 'PIECE',
      requiresReview: false,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: 'tarif-archive',
      tenantId: TENANT,
      article: 'Pantalon',
      service: 'Repassage seul',
      price: 500,
      pricingMode: 'FIXED',
      billingUnit: 'PIECE',
      requiresReview: false,
      isActive: false,
      sortOrder: 2,
    },
  ]
  depot.createCatalogEntry.mockResolvedValue(undefined)
  depot.deactivateCatalogEntry.mockResolvedValue(undefined)
  depot.getCachedCatalog.mockImplementation(async () => depot.entries)
  depot.refreshCatalog.mockResolvedValue(true)
  depot.seedDefaultCatalog.mockResolvedValue(0)
  depot.updateCatalogEntry.mockResolvedValue(undefined)
  useTenantStore.setState({
    tenantId: TENANT,
    tenantName: 'Pressing Cocody',
    role: 'owner',
    userId: 'user-1',
  })
})

afterEach(() => {
  if (hote?.isConnected) demonter()
  vi.clearAllMocks()
})

describe('Catalogue — administration des tarifs existants', () => {
  it('permet de modifier le nom et le prix sans recréer le tarif', async () => {
    await monter()

    const edit = hote.querySelector<HTMLButtonElement>(
      '[aria-label="Modifier Chemise — Lavage et repassage"]',
    )
    expect(edit).not.toBeNull()
    await act(async () => edit?.click())

    const article = hote.querySelector<HTMLInputElement>('input[placeholder="Chemise"]')
    const prix = hote.querySelector<HTMLInputElement>('input[placeholder="1500"]')
    expect(article?.value).toBe('Chemise')
    expect(prix?.value).toBe('1000')

    await act(async () => {
      if (article) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(article, 'Chemise délicate')
        article.dispatchEvent(new Event('input', { bubbles: true }))
        article.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (prix) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(prix, '1800')
        prix.dispatchEvent(new Event('input', { bubbles: true }))
        prix.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })

    await act(async () => bouton('Enregistrer').click())

    expect(depot.updateCatalogEntry).toHaveBeenCalledWith(TENANT, 'tarif-actif', {
      article: 'Chemise délicate',
      service: 'Lavage et repassage',
      price: 1800,
      requiresReview: false,
    })
    demonter()
  })

  it('signale un tarif hérité et exige une confirmation du propriétaire', async () => {
    depot.entries[0]!.requiresReview = true
    await monter()

    expect(hote.textContent).toContain('À vérifier')
    await act(async () => {
      hote
        .querySelector<HTMLButtonElement>('[aria-label="Modifier Chemise — Lavage et repassage"]')
        ?.click()
    })
    expect(hote.textContent).toContain('Confirmez d’abord le tarif réel')

    await act(async () => bouton('Enregistrer').click())
    expect(depot.updateCatalogEntry).toHaveBeenCalledWith(TENANT, 'tarif-actif', {
      article: 'Chemise',
      service: 'Lavage et repassage',
      price: 1000,
      requiresReview: false,
    })
    demonter()
  })

  it('affiche les archives et permet de réactiver une entrée sans la recréer', async () => {
    await monter()
    expect(hote.textContent).not.toContain('Repassage seul')

    await act(async () => bouton('Voir les archives').click())
    expect(hote.textContent).toContain('Repassage seul')
    expect(hote.textContent).toContain('Archivée')

    const reactiver = hote.querySelector<HTMLButtonElement>(
      '[aria-label="Réactiver Pantalon — Repassage seul"]',
    )
    expect(reactiver).not.toBeNull()
    await act(async () => reactiver?.click())

    expect(depot.updateCatalogEntry).toHaveBeenCalledWith(TENANT, 'tarif-archive', { isActive: true })
    demonter()
  })

  it('ne donne pas accès à l’administration au réceptionniste', async () => {
    useTenantStore.setState({ role: 'receptionist' })
    await monter()

    expect(hote.textContent).toContain('Prestations réservées au propriétaire')
    expect(hote.querySelector('[aria-label^="Modifier "]')).toBeNull()
    demonter()
  })
})
