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
    familyName?: string | null
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
      familyName: 'Vêtements',
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
      familyName: 'Vêtements',
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

    await act(async () => bouton('Enregistrer le tarif').click())

    expect(depot.updateCatalogEntry).toHaveBeenCalledWith(TENANT, 'tarif-actif', {
      article: 'Chemise délicate',
      service: 'Lavage et repassage',
      price: 1800,
      pricingMode: 'FIXED',
      billingUnit: 'PIECE',
      minimumQuantity: null,
      billingIncrement: null,
      minimumCharge: null,
      conditions: null,
      requiresReview: false,
    })
    demonter()
  })

  it('configure un tarif à partir du kilogramme avec minimum, pas et plancher', async () => {
    await monter()
    const sectionTarifs = [...hote.querySelectorAll('section')].find((section) => section.textContent?.includes('Ajouter un tarif'))
    expect(sectionTarifs).not.toBeUndefined()
    const selects = [...(sectionTarifs?.querySelectorAll('select') ?? [])]
    const numeros = [...(sectionTarifs?.querySelectorAll<HTMLInputElement>('input[type="number"]') ?? [])]
    const article = sectionTarifs?.querySelector<HTMLInputElement>('input[placeholder="Chemise"]')
    const service = sectionTarifs?.querySelector<HTMLInputElement>('input[placeholder="Lavage"]')
    const prix = sectionTarifs?.querySelector<HTMLInputElement>('input[placeholder="1500"]')
    const conditions = sectionTarifs?.querySelector<HTMLTextAreaElement>('textarea')

    await act(async () => {
      const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      if (selects[0]) {
        setSelect?.call(selects[0], 'FROM')
        selects[0].dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (selects[1]) {
        setSelect?.call(selects[1], 'KG')
        selects[1].dispatchEvent(new Event('change', { bubbles: true }))
      }
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      for (const [element, value] of [
        [article, 'Drap'],
        [service, 'Lavage au kilo'],
        [prix, '1200'],
        [numeros[1], '1.5'],
        [numeros[2], '0.5'],
        [numeros[3], '2500'],
      ] as const) {
        if (!element) continue
        setInput?.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (conditions) {
        const setText = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setText?.call(conditions, 'Poids final vérifié à la réception')
        conditions.dispatchEvent(new Event('input', { bubbles: true }))
        conditions.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })

    await act(async () => bouton('Ajouter le tarif').click())

    expect(depot.createCatalogEntry).toHaveBeenCalledWith(TENANT, {
      article: 'Drap',
      service: 'Lavage au kilo',
      price: 1200,
      pricingMode: 'FROM',
      billingUnit: 'KG',
      minimumQuantity: 1.5,
      billingIncrement: 0.5,
      minimumCharge: 2500,
      conditions: 'Poids final vérifié à la réception',
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

    await act(async () => bouton('Enregistrer le tarif').click())
    expect(depot.updateCatalogEntry).toHaveBeenCalledWith(TENANT, 'tarif-actif', {
      article: 'Chemise',
      service: 'Lavage et repassage',
      price: 1000,
      pricingMode: 'FIXED',
      billingUnit: 'PIECE',
      minimumQuantity: null,
      billingIncrement: null,
      minimumCharge: null,
      conditions: null,
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

  it('rafraîchit les sélecteurs de mode et d’unité en modifiant un tarif devis', async () => {
    depot.entries = [
      ...depot.entries,
      {
        id: 'tarif-devis',
        tenantId: TENANT,
        article: 'Robe',
        service: 'Nettoyage à sec',
        price: 0,
        pricingMode: 'QUOTE',
        billingUnit: 'FLAT',
        requiresReview: true,
        isActive: true,
        sortOrder: 3,
      },
    ]
    await monter()

    await act(async () => {
      hote
        .querySelector<HTMLButtonElement>('[aria-label="Modifier Robe — Nettoyage à sec"]')
        ?.click()
    })

    const sectionTarifs = [...hote.querySelectorAll('section')].find((section) =>
      section.textContent?.includes('Modifier un tarif'),
    )
    const selects = [...(sectionTarifs?.querySelectorAll('select') ?? [])]
    expect(selects[0]?.value).toBe('QUOTE')
    expect(selects[1]?.value).toBe('FLAT')
    demonter()
  })

  it('n’affiche pas le guide de création quand le catalogue contient déjà des tarifs', async () => {
    await monter()
    expect(hote.textContent).not.toContain('Guide de création')
    demonter()
  })

  it('installe la grille de départ depuis l’état vide', async () => {
    depot.entries = []
    depot.seedDefaultCatalog.mockResolvedValue(40)
    await monter()

    const boutonGrille = [...hote.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Installer la grille de départ'),
    )
    expect(boutonGrille).toBeDefined()
    await act(async () => boutonGrille?.click())

    expect(depot.seedDefaultCatalog).toHaveBeenCalledWith(TENANT)
    expect(depot.refreshCatalog).toHaveBeenCalledWith(TENANT)
    demonter()
  })

  it('filtre instantanément les prestations et articles via la barre de recherche en haut de page (par article, prestation et catégorie)', async () => {
    depot.entries = [
      ...depot.entries,
      {
        id: 'tarif-drap',
        tenantId: TENANT,
        article: 'Drap plat',
        service: 'Lavage au kilo',
        price: 1500,
        pricingMode: 'FIXED',
        billingUnit: 'PIECE',
        familyName: 'Linge de maison',
        requiresReview: false,
        isActive: true,
        sortOrder: 3,
      },
      {
        id: 'tarif-costume',
        tenantId: TENANT,
        article: 'Costume 2 pièces',
        service: 'Nettoyage à sec',
        price: 3500,
        pricingMode: 'FIXED',
        billingUnit: 'PIECE',
        familyName: 'Tenues habillées',
        requiresReview: false,
        isActive: true,
        sortOrder: 4,
      },
    ]

    await monter()

    const searchInput = hote.querySelector<HTMLInputElement>(
      'input[aria-label="Rechercher dans le catalogue"]',
    )
    expect(searchInput).not.toBeNull()

    const saisirRecherche = async (valeur: string) => {
      await act(async () => {
        if (searchInput) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          setter?.call(searchInput, valeur)
          searchInput.dispatchEvent(new Event('input', { bubbles: true }))
          searchInput.dispatchEvent(new Event('change', { bubbles: true }))
        }
      })
    }

    // Tous les articles actifs sont affichés au départ
    expect(hote.textContent).toContain('Chemise')
    expect(hote.textContent).toContain('Drap plat')
    expect(hote.textContent).toContain('Costume 2 pièces')

    // 1. Filtrage par nom d'article ("Drap")
    await saisirRecherche('Drap')
    expect(hote.textContent).toContain('Drap plat')
    expect(hote.textContent).not.toContain('Chemise')
    expect(hote.textContent).not.toContain('Costume 2 pièces')

    // 2. Filtrage par nom de prestation ("Nettoyage")
    await saisirRecherche('Nettoyage')
    expect(hote.textContent).toContain('Costume 2 pièces')
    expect(hote.textContent).toContain('Nettoyage à sec')
    expect(hote.textContent).not.toContain('Chemise')
    expect(hote.textContent).not.toContain('Drap plat')

    // 3. Filtrage par nom de catégorie ("Linge de maison")
    await saisirRecherche('Linge')
    expect(hote.textContent).toContain('Drap plat')
    expect(hote.textContent).not.toContain('Chemise')
    expect(hote.textContent).not.toContain('Costume 2 pièces')

    // 4. Recherche sans résultat
    await saisirRecherche('IntrouvableXYZ')
    expect(hote.textContent).toContain('Aucune prestation trouvée')
    expect(hote.textContent).toContain('ne correspond à aucun article, prestation ou catégorie')

    // 5. Effacement de la recherche
    const boutonEffacer = hote.querySelector<HTMLButtonElement>(
      'button[aria-label="Effacer la recherche"]',
    )
    expect(boutonEffacer).not.toBeNull()
    await act(async () => boutonEffacer?.click())
    expect(hote.textContent).toContain('Chemise')
    expect(hote.textContent).toContain('Drap plat')
    expect(hote.textContent).toContain('Costume 2 pièces')

    demonter()
  })
})

