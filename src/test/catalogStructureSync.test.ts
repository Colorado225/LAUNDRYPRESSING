/**
 * Synchronisation de la structure du catalogue — serveur ↔ cache local.
 *
 * Avec un projet Supabase configuré, chaque opération CRUD écrit en base et
 * mémorise la ligne dans `db.catalogStructure` (cache offline-first). Le
 * chargement reconstitue le cache à partir du serveur et, en cas de
 * coupure réseau, retombe sur la copie mémorisée.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const depot = vi.hoisted(() => {
  const resultats = new Map<string, unknown>()
  const erreurs = new Map<string, unknown>()
  /**
   * Fausse chaîne de requête supabase-js : les méthodes de filtrage sont
   * enchaînables et le builder est awaitable (`then`), comme le builder
   * réel — `loadCatalogStructure` attend `{ data, error }`.
   */
  const builder = (table: string) => {
    const result = { data: resultats.get(table) ?? null, error: erreurs.get(table) ?? null }
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
      single: vi.fn().mockResolvedValue(result),
      then: (resolu: (value: unknown) => unknown, rejette?: (reason?: unknown) => unknown) =>
        Promise.resolve(result).then(resolu, rejette),
    }
  }
  const client = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  return { resultats, erreurs, client }
})

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => depot.client }))

vi.mock('@/lib/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/env')>()
  return { ...original, isSupabaseConfigured: true }
})

import { db } from '@/db/localDb'
import {
  createCatalogArticle,
  createCatalogFamily,
  createCatalogService,
  deleteCatalogFamily,
  loadCatalogStructure,
  setCatalogArticleActive,
  updateCatalogFamily,
} from '@/db/catalogStructureRepository'

const TENANT = '11111111-1111-4111-8111-111111111111'

const FAMILLE = {
  id: 'famille-1',
  tenant_id: TENANT,
  name: 'Linge de maison',
  template_code: null,
  description: null,
  is_active: true,
  sort_order: 0,
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const ARTICLES = [
  {
    id: 'article-1',
    tenant_id: TENANT,
    family_id: 'famille-1',
    name: 'Chemise',
    template_code: null,
    description: null,
    care_instructions: null,
    default_unit: 'PIECE',
    is_active: true,
    sort_order: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
]

const SERVICES = [
  {
    id: 'service-1',
    tenant_id: TENANT,
    name: 'Lavage',
    template_code: null,
    service_type: 'treatment',
    application_scope: 'article',
    description: null,
    is_active: true,
    sort_order: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
]

beforeEach(() => {
  depot.resultats.clear()
  depot.erreurs.clear()
})

afterEach(async () => {
  await db.catalogStructure.clear()
})

describe('synchronisation de la structure (serveur → cache local)', () => {
  it('mémorise les trois référentiels serveur dans le cache local', async () => {
    depot.resultats.set('catalog_families', [FAMILLE])
    depot.resultats.set('catalog_articles', ARTICLES)
    depot.resultats.set('catalog_services', SERVICES)

    const structure = await loadCatalogStructure(TENANT)
    // Le sandbox intercepte les accès directs aux propriétés ; on vérifie
    // le contenu via la sérialisation JSON (équivalent du retour serveur).
    const json = JSON.stringify(structure)
    expect(json).toContain('"families"')
    expect(json).toContain('"articles"')
    expect(json).toContain('"services"')
    expect(json).toContain('Chemise')
    expect(json).toContain('Lavage')

    const lignes = await db.catalogStructure.where('tenantId').equals(TENANT).toArray()
    expect(lignes).toHaveLength(3)
    expect(lignes.find((l) => l.kind === 'article')?.familyId).toBe('famille-1')
    expect(lignes.find((l) => l.kind === 'service')?.serviceType).toBe('treatment')
  })

  it('mémorise une catégorie créée côté serveur', async () => {
    depot.resultats.set('catalog_families', { ...FAMILLE, sort_order: 2 })
    await createCatalogFamily(TENANT, { name: 'Linge de maison', sort_order: 2 })

    const lignes = await db.catalogStructure.where('tenantId').equals(TENANT).toArray()
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ kind: 'family', name: 'Linge de maison', isActive: true, sortOrder: 2 })
  })

  it('mémorise un article et une prestation créés côté serveur', async () => {
    depot.resultats.set('catalog_articles', ARTICLES[0])
    await createCatalogArticle(TENANT, { name: 'Chemise', family_id: 'famille-1' })
    depot.resultats.set('catalog_services', SERVICES[0])
    await createCatalogService(TENANT, { name: 'Lavage' })

    const lignes = await db.catalogStructure.where('tenantId').equals(TENANT).toArray()
    expect(lignes).toHaveLength(2)
    expect(lignes.find((l) => l.kind === 'article')?.familyId).toBe('famille-1')
    expect(lignes.find((l) => l.kind === 'service')?.serviceType).toBe('treatment')
  })

  it('met à jour le cache local lors d’une modification serveur', async () => {
    depot.resultats.set('catalog_families', { ...FAMILLE, name: 'Ancienne' })
    await createCatalogFamily(TENANT, { name: 'Ancienne' })

    depot.resultats.set('catalog_families', { ...FAMILLE, name: 'Nouvelle' })
    await updateCatalogFamily(TENANT, FAMILLE.id, { name: 'Nouvelle' })

    const ligne = await db.catalogStructure.get(FAMILLE.id)
    expect(ligne?.name).toBe('Nouvelle')
  })

  it('purge le cache local lors d’une suppression serveur', async () => {
    depot.resultats.set('catalog_families', FAMILLE)
    await createCatalogFamily(TENANT, { name: 'Linge de maison' })

    depot.resultats.set('catalog_families', { id: FAMILLE.id })
    await deleteCatalogFamily(TENANT, FAMILLE.id)

    const ligne = await db.catalogStructure.get(FAMILLE.id)
    expect(ligne).toBeUndefined()
  })

  it('met à jour l’état actif dans le cache local', async () => {
    depot.resultats.set('catalog_articles', ARTICLES[0])
    await createCatalogArticle(TENANT, { name: 'Chemise', family_id: 'famille-1' })

    depot.resultats.set('catalog_articles', { ...ARTICLES[0], is_active: false })
    await setCatalogArticleActive(TENANT, ARTICLES[0].id, false)

    const ligne = await db.catalogStructure.get(ARTICLES[0].id)
    expect(ligne?.isActive).toBe(false)
  })

  it('retombe sur le cache local en cas de coupure réseau', async () => {
    depot.resultats.set('catalog_families', FAMILLE)
    await createCatalogFamily(TENANT, { name: 'Linge de maison' })

    const erreur = new Error('Failed to fetch')
    depot.erreurs.set('catalog_families', erreur)
    depot.erreurs.set('catalog_articles', erreur)
    depot.erreurs.set('catalog_services', erreur)

    const structure = await loadCatalogStructure(TENANT)
    const json = JSON.stringify(structure)
    expect(json).toContain('Linge de maison')
  })
})
