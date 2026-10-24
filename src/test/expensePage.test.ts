import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pagination serveur des dépenses.
 *
 * Le client Supabase est remplacé par une chaîne factice qui enregistre les
 * appels : ce qui se vérifie ici, c'est la **requête construite** (tri total,
 * une ligne de plus que la page, filtre de curseur au deuxième appel) et le
 * découpage de la réponse. Une pagination par décalage passerait des tests de
 * rendu tout en produisant des doublons à l'usage.
 */

const appels: string[] = []
let reponse: { data: unknown[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
}

function creerChaine() {
  const chaine: Record<string, unknown> = {
    select: () => chaine,
    eq: () => chaine,
    order: (colonne: string, options: { ascending: boolean }) => {
      appels.push(`order:${colonne}:${options.ascending ? 'asc' : 'desc'}`)
      return chaine
    },
    limit: (nombre: number) => {
      appels.push(`limit:${nombre}`)
      return chaine
    },
    or: (filtre: string) => {
      appels.push(`or:${filtre}`)
      return chaine
    },
    then: (resoudre: (valeur: typeof reponse) => unknown) => resoudre(reponse),
  }
  return chaine
}

const clientFactice = {
  from: (table: string) => {
    appels.push(`from:${table}`)
    return creerChaine()
  },
}

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => clientFactice }))

const { TAILLE_PAGE_DEPENSES, listExpensesPage } = await import('@/services/expenseService')

function depense(id: string, createdAt: string) {
  return {
    id,
    tenant_id: 'tenant-1',
    label: `Dépense ${id}`,
    category: 'autre',
    amount: 1_000,
    spent_on: createdAt.slice(0, 10),
    supplier_id: null,
    note: null,
    created_at: createdAt,
  }
}

beforeEach(() => {
  appels.length = 0
  reponse = { data: [], error: null }
})

describe('listExpensesPage', () => {
  it('demande une ligne de plus que la page pour savoir s’il y a une suite', async () => {
    reponse = { data: [depense('a', '2026-10-23T10:00:00Z')], error: null }

    const page = await listExpensesPage('tenant-1')

    expect(appels).toContain(`limit:${TAILLE_PAGE_DEPENSES + 1}`)
    expect(page.aPlus).toBe(false)
    expect(page.lignes).toHaveLength(1)
  })

  it('trie sur created_at puis id, dans les deux cas en décroissant', async () => {
    await listExpensesPage('tenant-1')
    expect(appels).toContain('order:created_at:desc')
    expect(appels).toContain('order:id:desc')
    // L'ordre des critères compte : `id` n'est qu'un départage.
    expect(appels.indexOf('order:created_at:desc')).toBeLessThan(appels.indexOf('order:id:desc'))
  })

  it('n’applique aucun filtre de curseur sur la première page', async () => {
    await listExpensesPage('tenant-1')
    expect(appels.some((appel) => appel.startsWith('or:'))).toBe(false)
  })

  it('applique le filtre « strictement après » sur les pages suivantes', async () => {
    reponse = { data: [depense('b', '2026-10-22T10:00:00Z')], error: null }
    await listExpensesPage('tenant-1', {
      curseur: { valeur: '2026-10-23T10:00:00Z', id: 'a' },
      limite: 10,
    })

    expect(appels).toContain(
      'or:created_at.lt.2026-10-23T10:00:00Z,and(created_at.eq.2026-10-23T10:00:00Z,id.lt.a)',
    )
    expect(appels).toContain('limit:11')
  })

  it('renvoie le curseur de la dernière ligne conservée et signale la suite', async () => {
    reponse = {
      data: [
        depense('a', '2026-10-23T10:00:00Z'),
        depense('b', '2026-10-22T10:00:00Z'),
        depense('c', '2026-10-21T10:00:00Z'),
      ],
      error: null,
    }

    const page = await listExpensesPage('tenant-1', { limite: 2 })

    expect(page.lignes.map((ligne) => ligne.id)).toEqual(['a', 'b'])
    expect(page.aPlus).toBe(true)
    expect(page.curseur).toEqual({ valeur: '2026-10-22T10:00:00Z', id: 'b' })
  })

  it('traduit une erreur de droits en message français', async () => {
    reponse = { data: null, error: { message: 'new row violates row-level security policy' } }
    await expect(listExpensesPage('tenant-1')).rejects.toThrow(
      'Seul le propriétaire peut consulter et enregistrer les dépenses.',
    )
  })

  it('traduit une coupure réseau en message français', async () => {
    reponse = { data: null, error: { message: 'TypeError: Failed to fetch' } }
    await expect(listExpensesPage('tenant-1')).rejects.toThrow(
      'Réseau indisponible : les dépenses nécessitent une connexion.',
    )
  })

  it('renvoie une page vide quand le serveur ne renvoie rien', async () => {
    reponse = { data: null, error: null }
    const page = await listExpensesPage('tenant-1')
    expect(page).toEqual({ lignes: [], curseur: null, aPlus: false })
  })
})
