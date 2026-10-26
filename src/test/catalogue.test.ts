import { describe, expect, it } from 'vitest'
import type { LocalCatalogGarment, LocalCatalogPrice } from '@/db/localDb'
import {
  articlesParCategorie,
  clePrix,
  codeDepuisNom,
  indexerPrix,
  prixConfigure,
  problemeLigneCatalogue,
  progressionGrille,
} from '@/lib/catalogue'

/**
 * Catalogue Lot 1 — règles pures de la grille tarifaire.
 *
 * Le point critique (spec UI-002) : un tarif absent vaut « non configuré »
 * (null) et bloque la ligne ; il ne doit jamais être confondu avec 0 FCFA
 * ni contourné par un prix saisi librement.
 */

function article(partial: Partial<LocalCatalogGarment> & Pick<LocalCatalogGarment, 'id'>): LocalCatalogGarment {
  return {
    tenantId: 'tenant-1',
    categoryId: 'cat-1',
    categoryCode: 'TOPS',
    categoryName: 'Hauts',
    code: 'SHIRT',
    name: 'Chemise',
    iconKey: 'shirt',
    defaultUnit: 'PIECE',
    isDelicate: false,
    isActive: true,
    sortOrder: 10,
    ...partial,
  }
}

function prix(partial: Partial<LocalCatalogPrice> & Pick<LocalCatalogPrice, 'id'>): LocalCatalogPrice {
  return {
    tenantId: 'tenant-1',
    tenantServiceId: 'service-1',
    garmentTypeId: 'article-1',
    priceXof: 800,
    isActive: true,
    ...partial,
  }
}

describe('prixConfigure', () => {
  it('retourne le tarif de grille pour le couple prestation × article (PRICE-001 : 800 FCFA)', () => {
    const index = indexerPrix([prix({ id: 'p1' })])
    expect(prixConfigure(index, 'service-1', 'article-1')).toBe(800)
  })

  it('retourne null (non configuré) sans tarif, jamais zéro', () => {
    const index = indexerPrix([])
    expect(prixConfigure(index, 'service-1', 'article-1')).toBeNull()
    expect(prixConfigure(index, null, 'article-1')).toBeNull()
    expect(prixConfigure(index, 'service-1', undefined)).toBeNull()
  })

  it('ignore les prix désactivés', () => {
    const index = indexerPrix([prix({ id: 'p1', isActive: false })])
    expect(prixConfigure(index, 'service-1', 'article-1')).toBeNull()
  })

  it('distingue les prestations pour un même article', () => {
    const index = indexerPrix([
      prix({ id: 'p1', tenantServiceId: 'lavage', priceXof: 500 }),
      prix({ id: 'p2', tenantServiceId: 'lavage-repassage', priceXof: 800 }),
    ])
    expect(index.get(clePrix('lavage', 'article-1'))).toBe(500)
    expect(prixConfigure(index, 'lavage-repassage', 'article-1')).toBe(800)
  })
})

describe('problemeLigneCatalogue', () => {
  const base = {
    garmentTypeId: 'article-1',
    garmentName: 'Chemise',
    tenantServiceId: 'service-1',
    serviceName: 'Lavage + repassage',
    prix: 800 as number | null,
  }

  it('accepte une ligne complète au tarif de grille', () => {
    expect(problemeLigneCatalogue(base)).toBeNull()
  })

  it('bloque sans article (catalogue obligatoire)', () => {
    expect(problemeLigneCatalogue({ ...base, garmentTypeId: null })).toMatch(/article du catalogue/)
  })

  it('bloque sans prestation', () => {
    expect(problemeLigneCatalogue({ ...base, tenantServiceId: '' })).toMatch(/prestation/)
  })

  it('bloque explicitement un tarif non configuré en nommant le couple', () => {
    const message = problemeLigneCatalogue({ ...base, prix: null })
    expect(message).toContain('Tarif non configuré')
    expect(message).toContain('Chemise')
    expect(message).toContain('Lavage + repassage')
  })
})

describe('articlesParCategorie et progressionGrille', () => {
  const articles = [
    article({ id: 'a1', name: 'Chemise', categoryCode: 'TOPS', categoryName: 'Hauts' }),
    article({ id: 'a2', name: 'Pantalon', code: 'TROUSERS', categoryCode: 'BOTTOMS', categoryName: 'Bas' }),
    article({ id: 'a3', name: 'Ancien article', code: 'OLD', isActive: false }),
  ]

  it('groupe les articles actifs et exclut les archivés', () => {
    const groupes = articlesParCategorie(articles)
    expect(groupes.map((g) => g.categoryName)).toEqual(['Bas', 'Hauts'])
    expect(groupes.flatMap((g) => g.articles.map((a) => a.id))).toEqual(['a2', 'a1'])
  })

  it('compte les couples tarifés sur le total attendu', () => {
    const index = indexerPrix([prix({ id: 'p1', garmentTypeId: 'a1' })])
    expect(
      progressionGrille({ garments: articles, serviceIdsPiece: ['service-1', 'service-2'], index }),
    ).toEqual({ configures: 1, total: 4 })
  })
})

describe('codeDepuisNom', () => {
  it('dérive un code stable sans accents', () => {
    expect(codeDepuisNom('Grand boubou brodé')).toBe('GRAND_BOUBOU_BRODE')
    expect(codeDepuisNom('Taie d’oreiller')).toBe('TAIE_D_OREILLER')
  })

  it('garantit au moins deux caractères', () => {
    expect(codeDepuisNom('É')).toMatch(/^ARTICLE/)
  })
})
