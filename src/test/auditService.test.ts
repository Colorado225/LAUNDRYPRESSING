import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Lecture du journal d'audit côté service.
 *
 * Le client Supabase est remplacé par un double qui enregistre la requête
 * construite. Ce qui se vérifie ici : le cloisonnement par pressing, la
 * pagination par curseur et le filtre par famille — trois choses qui, si elles
 * sont fausses, donnent un journal incomplet sans lever d'erreur.
 */

const appels: { nom: string; argument?: unknown }[] = []

interface Reponse {
  data: unknown[]
  error: { message: string } | null
}

const etat: { reponse: Reponse } = { reponse: { data: [], error: null } }

const chaine = {
  select: () => chaine,
  eq: (colonne: string, valeur: unknown) => {
    appels.push({ nom: `eq:${colonne}`, argument: valeur })
    return chaine
  },
  in: (colonne: string, valeurs: unknown) => {
    appels.push({ nom: `in:${colonne}`, argument: valeurs })
    return chaine
  },
  or: (filtre: string) => {
    appels.push({ nom: 'or', argument: filtre })
    return chaine
  },
  order: (colonne: string, options: unknown) => {
    appels.push({ nom: `order:${colonne}`, argument: options })
    return chaine
  },
  limit: (n: number) => {
    appels.push({ nom: 'limit', argument: n })
    return chaine
  },
  // Le constructeur de requêtes Supabase est « thenable » : c'est l'`await`
  // final qui déclenche l'appel. On reproduit ce comportement, sinon un filtre
  // ajouté après `limit` ne serait pas testable tel quel.
  then: (resolve: (valeur: unknown) => unknown, reject?: (erreur: unknown) => unknown) =>
    Promise.resolve(etat.reponse).then(resolve, reject),
}

const clientFactice = {
  from: (table: string) => {
    appels.push({ nom: `from:${table}` })
    return chaine
  },
}

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => clientFactice }))

const { TAILLE_PAGE_AUDIT, listAuditPage, auditErrorMessage } = await import(
  '@/services/auditService'
)

function ligneAudit(id: string, createdAt: string) {
  return {
    id,
    tenant_id: 'tenant-1',
    actor_id: null,
    actor_email: null,
    actor_role: null,
    action: 'tenants.update',
    entity: 'tenants',
    entity_id: 'tenant-1',
    details: {},
    created_at: createdAt,
  }
}

beforeEach(() => {
  appels.length = 0
  etat.reponse = { data: [], error: null }
})

describe('listAuditPage', () => {
  it('lit la table audit_log du pressing demandé', async () => {
    await listAuditPage('tenant-1')

    expect(appels[0]).toEqual({ nom: 'from:audit_log' })
    expect(appels).toContainEqual({ nom: 'eq:tenant_id', argument: 'tenant-1' })
  })

  it('trie du plus récent au plus ancien, avec id en second critère', async () => {
    await listAuditPage('tenant-1')

    const tris = appels.filter((appel) => appel.nom.startsWith('order:'))
    expect(tris).toEqual([
      { nom: 'order:created_at', argument: { ascending: false } },
      { nom: 'order:id', argument: { ascending: false } },
    ])
  })

  it('demande une ligne de plus que la page pour savoir s’il y a une suite', async () => {
    await listAuditPage('tenant-1')

    expect(appels).toContainEqual({ nom: 'limit', argument: TAILLE_PAGE_AUDIT + 1 })
  })

  it('découpe la page et expose un curseur', async () => {
    etat.reponse = {
      data: [ligneAudit('b', '2026-10-23T10:00:00.000Z'), ligneAudit('a', '2026-10-23T09:00:00.000Z')],
      error: null,
    }

    const page = await listAuditPage('tenant-1', { limite: 2 })

    // Trois lignes demandées, deux reçues : il n'y a pas de suite.
    expect(page.lignes).toHaveLength(2)
    expect(page.aPlus).toBe(false)
    expect(page.curseur).toEqual({ valeur: '2026-10-23T09:00:00.000Z', id: 'a' })
  })

  it('signale une suite quand la ligne supplémentaire arrive', async () => {
    etat.reponse = {
      data: [
        ligneAudit('c', '2026-10-23T11:00:00.000Z'),
        ligneAudit('b', '2026-10-23T10:00:00.000Z'),
        ligneAudit('a', '2026-10-23T09:00:00.000Z'),
      ],
      error: null,
    }

    const page = await listAuditPage('tenant-1', { limite: 2 })

    expect(page.lignes.map((ligne) => ligne.id)).toEqual(['c', 'b'])
    expect(page.aPlus).toBe(true)
  })

  it('reprend après le curseur fourni', async () => {
    await listAuditPage('tenant-1', {
      curseur: { valeur: '2026-10-23T09:00:00.000Z', id: 'a' },
    })

    const filtre = appels.find((appel) => appel.nom === 'or')
    expect(String(filtre?.argument)).toContain('created_at.lt.2026-10-23T09:00:00.000Z')
  })

  it('filtre par famille en visant les tables correspondantes', async () => {
    await listAuditPage('tenant-1', { famille: 'caisse' })

    // La caisse couvre deux tables : une clôture et un remboursement ne vivent
    // pas dans la même table, mais relèvent du même sujet pour le gérant.
    expect(appels).toContainEqual({
      nom: 'in:entity',
      argument: ['cash_sessions', 'payment_refunds'],
    })
  })

  it('n’ajoute aucun filtre de famille pour « toutes »', async () => {
    await listAuditPage('tenant-1', { famille: null })

    expect(appels.filter((appel) => appel.nom.startsWith('in:'))).toHaveLength(0)
  })

  it('remonte une erreur lisible en cas de refus de la RLS', async () => {
    etat.reponse = {
      data: [],
      error: { message: 'new row violates row-level security policy' },
    }

    await expect(listAuditPage('tenant-1')).rejects.toThrow(
      'Seul le propriétaire peut consulter le journal d’audit.',
    )
  })
})

describe('auditErrorMessage', () => {
  it('explique l’absence de réseau', () => {
    expect(auditErrorMessage('Failed to fetch')).toContain('hors ligne')
  })

  it('laisse passer un message inconnu pour ne pas le masquer', () => {
    expect(auditErrorMessage('autre problème')).toBe('autre problème')
  })
})
