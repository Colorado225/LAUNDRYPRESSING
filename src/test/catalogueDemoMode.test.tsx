/**
 * Reproduction en mode démonstration (pas de projet Supabase configuré).
 *
 * Objectif : garantir que les parcours signalés par l'utilisateur fonctionnent
 * hors ligne sur l'écran Catalogue :
 *   1. le guide contextuel avance avec « Étape suivante » ;
 *   2. le bouton « Ajouter » du gestionnaire de structure (catégories,
 *      articles, prestations) enregistre vraiment l'élément ;
 *   3. le bouton « Ajouter le tarif » de la grille tarifaire enregistre
 *      vraiment le tarif dans le cache local.
 *
 * Les repositories ne sont pas mockés : le repli local Dexie doit prendre le
 * relais quand Supabase est absent.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Catalogue from '@/pages/Catalogue'
import { CatalogGuide } from '@/components/CatalogGuide'
import { createCatalogFamily, loadCatalogStructure } from '@/db/catalogStructureRepository'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'

// Le `.env` réel active le chemin Supabase : ces tests de reproduction du
// mode démonstration doivent forcer le repli local, quel que soit le contenu
// de `.env`.
vi.mock('@/lib/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/env')>()
  return {
    ...original,
    isSupabaseConfigured: false,
  }
})

const TENANT = '11111111-1111-4111-8111-111111111111'

let racine: Root
let hote: HTMLDivElement

async function monter(element: React.ReactElement) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(<MemoryRouter>{element}</MemoryRouter>)
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

function saisir(champ: HTMLInputElement | null, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(champ, valeur)
  champ?.dispatchEvent(new Event('input', { bubbles: true }))
  champ?.dispatchEvent(new Event('change', { bubbles: true }))
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(async () => {
  if (hote?.isConnected) demonter()
  await db.catalogStructure.clear()
  await db.catalogEntries.clear()
  vi.restoreAllMocks()
})

describe('Catalogue — mode démonstration (pas de Supabase)', () => {
  beforeEach(() => {
    useTenantStore.setState({
      tenantId: TENANT,
      tenantName: 'Pressing Cocody',
      role: 'owner',
      userId: 'user-1',
    })
  })

  it('le guide avance avec « Étape suivante »', async () => {
    await monter(<CatalogGuide onPremiereCreation={() => {}} />)

    const suivant = bouton('Étape suivante')
    await act(async () => suivant.click())
    expect(hote.textContent).toContain('Étape 2')
  })

  it('enregistre une catégorie avec le bouton Ajouter, hors ligne', async () => {
    await db.catalogStructure.clear()
    await db.catalogEntries.clear()
    await monter(<Catalogue />)

    const sectionStructure = [...hote.querySelectorAll('section')].find((section) =>
      section.textContent?.includes('Structure du catalogue'),
    )
    expect(sectionStructure).toBeDefined()
    const champNom = sectionStructure!.querySelector('input')
    expect(champNom).not.toBeNull()

    await act(async () => {
      saisir(champNom as HTMLInputElement, 'Linge de maison')
    })

    await act(async () => {
      const ajouter = [...sectionStructure!.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Ajouter'),
      )
      expect(ajouter).toBeDefined()
      ajouter?.click()
    })
    await act(async () => {
      await new Promise((resoudre) => setTimeout(resoudre, 0))
    })

    const lignes = await db.catalogStructure.where('tenantId').equals(TENANT).toArray()
    expect(lignes).toHaveLength(1)
    expect(lignes[0]?.kind).toBe('family')
    expect(lignes[0]?.name).toBe('Linge de maison')
    expect(sectionStructure!.textContent).toContain('Linge de maison')
  })

  it('enregistre un article lié à une catégorie créée localement', async () => {
    await db.catalogStructure.clear()
    await db.catalogEntries.clear()
    await monter(<Catalogue />)

    const section = [...hote.querySelectorAll('section')].find((section) =>
      section.textContent?.includes('Structure du catalogue'),
    )!

    // 1. Créer la catégorie « Linge de maison » sur l'onglet Catégories.
    await act(async () => {
      saisir(section.querySelector('input') as HTMLInputElement, 'Linge de maison')
    })
    await act(async () => {
      const ajouter = [...section.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Ajouter'),
      )
      ajouter?.click()
    })
    await act(async () => {
      await new Promise((resoudre) => setTimeout(resoudre, 0))
    })

    const familles = await db.catalogStructure.where('tenantId').equals(TENANT).toArray()
    const ligneFamille = familles.find((ligne) => ligne.kind === 'family')
    expect(ligneFamille).toBeDefined()

    // 2. Passer sur l'onglet Articles et remplir le formulaire.
    const ongletArticles = [...section.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Articles'),
    )
    await act(async () => ongletArticles?.click())

    await act(async () => {
      saisir(section.querySelector('input') as HTMLInputElement, 'Chemise')
    })
    await act(async () => {
      const selectCategorie = section.querySelector('select') as HTMLSelectElement
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(selectCategorie, ligneFamille!.id)
      selectCategorie.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      const ajouter = [...section.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Ajouter'),
      )
      ajouter?.click()
    })
    await act(async () => {
      await new Promise((resoudre) => setTimeout(resoudre, 0))
    })

    const lignes = await db.catalogStructure.where('tenantId').equals(TENANT).toArray()
    const ligneArticle = lignes.find((ligne) => ligne.kind === 'article')
    expect(ligneArticle).toBeDefined()
    expect(ligneArticle?.name).toBe('Chemise')
    expect(ligneArticle?.familyId).toBe(ligneFamille!.id)
  })

  it('enregistre un tarif avec le bouton « Ajouter le tarif », hors ligne', async () => {
    await db.catalogStructure.clear()
    await db.catalogEntries.clear()
    await monter(<Catalogue />)

    const article = hote.querySelector<HTMLInputElement>('input[placeholder="Chemise"]')
    const service = hote.querySelector<HTMLInputElement>('input[placeholder="Lavage"]')
    const prix = hote.querySelector<HTMLInputElement>('input[placeholder="1500"]')
    expect(article).not.toBeNull()
    expect(service).not.toBeNull()
    expect(prix).not.toBeNull()

    await act(async () => {
      saisir(article as HTMLInputElement, 'Chemise')
      saisir(service as HTMLInputElement, 'Lavage')
      saisir(prix as HTMLInputElement, '1500')
    })

    await act(async () => {
      bouton('Ajouter le tarif').click()
    })
    await act(async () => {
      await new Promise((resoudre) => setTimeout(resoudre, 0))
    })

    const entrees = await db.catalogEntries.where('tenantId').equals(TENANT).toArray()
    expect(entrees).toHaveLength(1)
    expect(entrees[0]?.article).toBe('Chemise')
    expect(entrees[0]?.service).toBe('Lavage')
    expect(entrees[0]?.price).toBe(1500)
    // Convention démo : le tarif est « à vérifier » jusqu'à confirmation.
    expect(entrees[0]?.requiresReview).toBe(true)
    expect(hote.textContent).toContain('Chemise')
  })

  it('trie les catégories par ordre d’affichage, comme le serveur', async () => {
    await db.catalogStructure.clear()
    await db.catalogEntries.clear()
    await createCatalogFamily(TENANT, { name: 'Ordre 5', sort_order: 5 })
    await createCatalogFamily(TENANT, { name: 'Ordre 1', sort_order: 1 })
    await createCatalogFamily(TENANT, { name: 'Ordre 5b', sort_order: 5 })

    const structure = await loadCatalogStructure(TENANT)
    expect(structure.families.map((famille) => famille.name)).toEqual(['Ordre 1', 'Ordre 5', 'Ordre 5b'])
  })
})
