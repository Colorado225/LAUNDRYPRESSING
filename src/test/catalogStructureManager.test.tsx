import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const depot = vi.hoisted(() => ({
  structure: { families: [], articles: [], services: [] } as {
    families: Array<{ id: string; tenant_id: string; name: string; description: string | null; is_active: boolean; sort_order: number; created_by: string | null; created_at: string; updated_at: string }>
    articles: Array<{ id: string; tenant_id: string; family_id: string; name: string; description: string | null; care_instructions: string | null; default_unit: 'PIECE' | 'PAIR' | 'SET' | 'KG' | 'M2' | 'METER' | 'PACKAGE' | 'FLAT'; is_active: boolean; sort_order: number; created_by: string | null; created_at: string; updated_at: string }>
    services: Array<{ id: string; tenant_id: string; name: string; service_type: 'treatment' | 'option' | 'logistics' | 'other'; application_scope: 'article' | 'order'; description: string | null; is_active: boolean; sort_order: number; created_by: string | null; created_at: string; updated_at: string }>
  },
  loadCatalogStructure: vi.fn(),
  initializeCatalogModelTemplates: vi.fn(),
  createCatalogFamily: vi.fn(),
  updateCatalogFamily: vi.fn(),
  deleteCatalogFamily: vi.fn(),
  createCatalogArticle: vi.fn(),
  updateCatalogArticle: vi.fn(),
  setCatalogArticleActive: vi.fn(),
  deleteCatalogArticle: vi.fn(),
  createCatalogService: vi.fn(),
  updateCatalogService: vi.fn(),
  setCatalogServiceActive: vi.fn(),
  deleteCatalogService: vi.fn(),
  refreshCatalog: vi.fn(),
}))

vi.mock('@/db/catalogStructureRepository', () => ({
  loadCatalogStructure: depot.loadCatalogStructure,
  initializeCatalogModelTemplates: depot.initializeCatalogModelTemplates,
  createCatalogFamily: depot.createCatalogFamily,
  updateCatalogFamily: depot.updateCatalogFamily,
  deleteCatalogFamily: depot.deleteCatalogFamily,
  createCatalogArticle: depot.createCatalogArticle,
  updateCatalogArticle: depot.updateCatalogArticle,
  setCatalogArticleActive: depot.setCatalogArticleActive,
  deleteCatalogArticle: depot.deleteCatalogArticle,
  createCatalogService: depot.createCatalogService,
  updateCatalogService: depot.updateCatalogService,
  setCatalogServiceActive: depot.setCatalogServiceActive,
  deleteCatalogService: depot.deleteCatalogService,
}))

vi.mock('@/db/catalogRepository', () => ({ refreshCatalog: depot.refreshCatalog }))

import CatalogStructureManager from '@/components/CatalogStructureManager'

const TENANT = '11111111-1111-4111-8111-111111111111'
const FAMILY = {
  id: 'family-1', tenant_id: TENANT, name: 'Linge courant', description: null,
  is_active: true, sort_order: 0, created_by: null, created_at: '', updated_at: '',
}
const onCatalogChanged = vi.fn(async () => {})
let racine: Root
let hote: HTMLDivElement

async function monter(canManage = false) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(<CatalogStructureManager tenantId={TENANT} canManage={canManage} onCatalogChanged={onCatalogChanged} />)
  })
  await act(async () => new Promise((resoudre) => setTimeout(resoudre, 0)))
}

function demonter() {
  act(() => racine.unmount())
  hote.remove()
}

function saisir(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

beforeEach(() => {
  depot.structure = { families: [], articles: [], services: [] }
  depot.loadCatalogStructure.mockImplementation(async () => depot.structure)
  for (const action of [
    depot.createCatalogFamily, depot.updateCatalogFamily, depot.deleteCatalogFamily,
    depot.createCatalogArticle, depot.updateCatalogArticle, depot.setCatalogArticleActive, depot.deleteCatalogArticle,
    depot.createCatalogService, depot.updateCatalogService, depot.setCatalogServiceActive, depot.deleteCatalogService,
  ]) action.mockResolvedValue(undefined)
  depot.refreshCatalog.mockResolvedValue(true)
  onCatalogChanged.mockClear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  if (hote?.isConnected) demonter()
  vi.clearAllMocks()
})

describe('gestion de la structure du catalogue', () => {
  it('initialise les modèles sans prix au premier accès du propriétaire', async () => {
    await monter(true)

    expect(depot.initializeCatalogModelTemplates).toHaveBeenCalledTimes(1)
    demonter()
  })

  it('ajoute une catégorie avec sa description et son ordre', async () => {
    await monter()
    const nom = hote.querySelector<HTMLInputElement>('input[required]')
    const description = hote.querySelector<HTMLTextAreaElement>('textarea')
    expect(nom).not.toBeNull()

    await act(async () => {
      if (nom) saisir(nom, 'Linge de maison')
      if (description) saisir(description, 'Draps, serviettes et couettes')
    })
    const formulaire = hote.querySelector('form')
    await act(async () => formulaire?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    expect(depot.createCatalogFamily).toHaveBeenCalledWith(TENANT, {
      name: 'Linge de maison', description: 'Draps, serviettes et couettes', sort_order: 0,
    })
    expect(depot.refreshCatalog).toHaveBeenCalledWith(TENANT)
    demonter()
  })

  it('exige une catégorie et enregistre les propriétés d’un article', async () => {
    depot.structure = { families: [FAMILY], articles: [], services: [] }
    await monter()
    const boutonArticles = [...hote.querySelectorAll('button')].find((button) => button.textContent?.includes('Articles'))
    await act(async () => boutonArticles?.click())

    const champs = [...hote.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')]
    const nom = champs.find((champ) => champ instanceof HTMLInputElement)
    const categorie = hote.querySelector<HTMLSelectElement>('select')
    const selections = [...hote.querySelectorAll<HTMLSelectElement>('select')]
    const unite = selections[1]
    const consignes = [...hote.querySelectorAll<HTMLTextAreaElement>('textarea')][0]

    await act(async () => {
      if (nom) saisir(nom, 'Couette')
      if (categorie) saisir(categorie, FAMILY.id)
      if (unite) saisir(unite, 'KG')
      if (consignes) saisir(consignes, 'Nettoyage doux')
    })
    const formulaire = hote.querySelector('form')
    await act(async () => formulaire?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    expect(depot.createCatalogArticle).toHaveBeenCalledWith(TENANT, expect.objectContaining({
      name: 'Couette', family_id: FAMILY.id, default_unit: 'KG', care_instructions: 'Nettoyage doux',
    }))
    demonter()
  })

  it('enregistre le type et la portée d’une prestation logistique', async () => {
    await monter()
    const boutonPrestations = [...hote.querySelectorAll('button')].find((button) => button.textContent?.includes('Prestations'))
    await act(async () => boutonPrestations?.click())

    const nom = hote.querySelector<HTMLInputElement>('input[required]')
    const selects = [...hote.querySelectorAll<HTMLSelectElement>('select')]
    await act(async () => {
      if (nom) saisir(nom, 'Collecte à domicile')
      if (selects[0]) saisir(selects[0], 'logistics')
      if (selects[1]) saisir(selects[1], 'order')
    })
    const formulaire = hote.querySelector('form')
    await act(async () => formulaire?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    expect(depot.createCatalogService).toHaveBeenCalledWith(TENANT, expect.objectContaining({
      name: 'Collecte à domicile', service_type: 'logistics', application_scope: 'order',
    }))
    demonter()
  })

  it('refuse un doublon de nom côté client', async () => {
    depot.structure = { families: [FAMILY], articles: [], services: [] }
    await monter()

    const nom = hote.querySelector<HTMLInputElement>('input[required]')
    expect(nom).not.toBeNull()
    await act(async () => {
      if (nom) saisir(nom, FAMILY.name)
    })
    await act(async () => {
      hote.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(depot.createCatalogFamily).not.toHaveBeenCalled()
    demonter()
  })

  it('supprime une catégorie et rafraîchit le catalogue tarifaire', async () => {
    depot.structure = { families: [FAMILY], articles: [], services: [] }
    await monter()

    const supprimer = hote.querySelector<HTMLButtonElement>('[aria-label="Supprimer Linge courant"]')
    expect(supprimer).not.toBeNull()
    await act(async () => supprimer?.click())
    await act(async () => new Promise((resoudre) => setTimeout(resoudre, 0)))

    expect(depot.deleteCatalogFamily).toHaveBeenCalledWith(TENANT, 'family-1')
    expect(onCatalogChanged).toHaveBeenCalled()
    demonter()
  })
})
