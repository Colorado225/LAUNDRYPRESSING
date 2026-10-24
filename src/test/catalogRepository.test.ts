import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, type LocalCatalogEntry } from '@/db/localDb'
import { getCachedCatalog } from '@/db/catalogRepository'

const TENANT = '11111111-1111-4111-8111-111111111111'

beforeEach(async () => {
  await db.catalogEntries.clear()
  await db.catalogEntries.bulkAdd([
    {
      id: 'active',
      tenantId: TENANT,
      article: 'Chemise',
      service: 'Lavage',
      price: 1000,
      pricingMode: 'FIXED',
      billingUnit: 'PIECE',
      requiresReview: false,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: 'archived',
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
    {
      id: 'other-tenant',
      tenantId: '22222222-2222-4222-8222-222222222222',
      article: 'Robe',
      service: 'Nettoyage à sec',
      price: 3000,
      pricingMode: 'FIXED',
      billingUnit: 'PIECE',
      requiresReview: false,
      isActive: true,
      sortOrder: 1,
    },
  ])
})

afterEach(async () => {
  await db.catalogEntries.clear()
})

describe('getCachedCatalog', () => {
  it('ne propose par défaut que les tarifs actifs du tenant demandé', async () => {
    const entries = await getCachedCatalog(TENANT)

    expect(entries.map((entry) => entry.id)).toEqual(['active'])
  })

  it('inclut les archives uniquement sur demande, pour les réactiver', async () => {
    const entries = await getCachedCatalog(TENANT, { includeInactive: true })

    expect(entries.map((entry) => entry.id)).toEqual(['active', 'archived'])
  })

  it('conserve en cache le mode, l’unité et le statut de vérification du tarif', async () => {
    const entries = await getCachedCatalog(TENANT)

    expect(entries[0]).toMatchObject({
      pricingMode: 'FIXED',
      billingUnit: 'PIECE',
      requiresReview: false,
    })
  })

  it('bloque prudemment un ancien cache sans indicateur de vérification', async () => {
    await db.catalogEntries.add({
      id: 'cache-ancienne-version',
      tenantId: TENANT,
      article: 'Robe',
      service: 'Lavage',
      price: 2000,
      isActive: true,
      sortOrder: 3,
    } as unknown as LocalCatalogEntry)

    const entries = await getCachedCatalog(TENANT)
    expect(entries.find((entry) => entry.id === 'cache-ancienne-version')?.requiresReview).toBe(true)
  })
})
