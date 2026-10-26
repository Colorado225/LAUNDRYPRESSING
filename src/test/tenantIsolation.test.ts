import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Vérification de l'isolation multi-tenant (phase 6, étape 3 du cahier des charges).
 *
 * L'isolation repose sur la RLS PostgreSQL, pas sur le frontend. Ce fichier
 * vérifie donc **la source de vérité** (les migrations SQL) plutôt que de
 * simuler une base : une requête oubliée côté client serait de toute façon
 * bloquée par le serveur, mais une politique RLS manquante serait une faille
 * réelle.
 *
 * Le test « deux pressings, deux connexions » proprement dit exige un projet
 * Supabase réel : il est fourni sous forme de script exécutable dans
 * `supabase/tests/isolation.sql` (voir README §7sexies).
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')
const SRC_DIR = join(process.cwd(), 'src')

/** Tables métier devant être protégées, avec la preuve d'isolation attendue. */
const TABLES = [
  'tenants',
  'tenant_users',
  'tenant_activities',
  'tenant_services',
  'orders',
  'order_items',
  'order_status_history',
  'payment_transactions',
] as const

function readMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    .join('\n')
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      return entry === 'test' ? [] : listSourceFiles(full)
    }
    return /\.(ts|tsx)$/.test(entry) ? [full] : []
  })
}

/** Extrait les blocs `create policy ... ;` associés à une table. */
function policiesFor(sql: string, table: string): string[] {
  const pattern = new RegExp(
    `create policy[^;]*?on\\s+public\\.${table}\\b[\\s\\S]*?;`,
    'gi',
  )
  return sql.match(pattern) ?? []
}

describe('RLS — chaque table métier est protégée', () => {
  const sql = readMigrations()

  it.each(TABLES)('%s active la RLS', (table) => {
    const pattern = new RegExp(
      `alter table\\s+(if exists\\s+)?public\\.${table}\\s+enable row level security`,
      'i',
    )
    expect(sql).toMatch(pattern)
  })

  it.each(TABLES)('%s possède au moins une politique', (table) => {
    expect(policiesFor(sql, table).length).toBeGreaterThan(0)
  })

  it.each(TABLES)('%s ne laisse aucune politique permissive', (table) => {
    for (const policy of policiesFor(sql, table)) {
      // Une politique sans portée (using (true)) ouvrirait la table à tous les
      // comptes connectés, donc à tous les pressings.
      expect(policy).not.toMatch(/using\s*\(\s*true\s*\)/i)
      expect(policy).toMatch(/current_tenant_id\(\)|auth\.uid\(\)/i)
    }
  })

  it('interdit tout accès anonyme aux tables métier', () => {
    // La migration regroupe les tables dans une seule instruction `revoke` :
    // on recense donc les tables citées par chaque instruction, plutôt que de
    // chercher une instruction par table.
    const revoked = new Set<string>()
    for (const statement of sql.match(/revoke[\s\S]*?from\s+anon\s*;/gi) ?? []) {
      for (const found of statement.matchAll(/public\.([a-z_]+)/gi)) {
        revoked.add(found[1] ?? '')
      }
    }

    for (const table of TABLES) {
      expect(revoked.has(table), `« ${table} » doit être révoquée pour anon`).toBe(true)
    }
  })
})

describe('RLS — les écritures de paiement sont réservées au serveur', () => {
  const sql = readMigrations()

  it('payment_transactions n’expose qu’une politique de lecture', () => {
    const policies = policiesFor(sql, 'payment_transactions')

    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatch(/for select/i)
  })

  it('la clé service_role n’apparaît jamais dans le code client', () => {
    const offenders = listSourceFiles(SRC_DIR).filter((file) =>
      /SERVICE_ROLE/i.test(readFileSync(file, 'utf8')),
    )

    // Si ce test échoue : une clé d'administration a fuité dans le bundle.
    expect(offenders).toEqual([])
  })
})

describe('Requêtes Supabase — toutes portent un filtre de périmètre', () => {
  /**
   * Deux familles de garanties sont contrôlées ici :
   *
   *  1. **Règle générale** — toute nouvelle requête doit contenir un filtre
   *     explicite (`.eq('tenant_id')`, `.eq('user_id')`, `.eq('id')`) ou un
   *     champ `tenant_id` dans son voisinage immédiat.
   *  2. **Exceptions documentées** — quelques appels dont le périmètre est
   *     porté autrement (charge utile d'un `upsert`, lecture par `order_id`
   *     bornée par la RLS). Ils sont listés nommément, ce qui oblige à
   *     justifier toute nouvelle exception en revue.
   */
  const DOCUMENTED_EXCEPTIONS: Array<{ file: string; table: string; reason: string }> = [
    {
      file: 'src/sync/syncEngine.ts',
      table: 'orders',
      reason:
        'upsert dont la charge utile contient tenant_id (toSupabaseOrder) ; la politique « with check » du serveur refuse tout autre pressing.',
    },
    {
      file: 'src/sync/syncEngine.ts',
      table: 'order_items',
      reason:
        'idem : tenant_id présent dans chaque ligne envoyée par toSupabaseOrderItem.',
    },
    {
      file: 'src/services/paymentService.ts',
      table: 'payment_transactions',
      reason:
        "lecture de la dernière transaction d'une commande (.eq('order_id')) ; la RLS restreint déjà au pressing courant.",
    },
    {
      file: 'src/services/pricingRulesService.ts',
      table: 'pricing_rule_tiers',
      reason:
        'les tranches n’ont pas de tenant_id propre : elles sont lues toutes, la RLS borne déjà aux règles du pressing courant (politiques « exists » sur la règle parente).',
    },
    {
      file: 'src/services/subscriptionService.ts',
      table: 'plans',
      reason:
        'catalogue commercial de l’éditeur : données globales, aucune donnée de pressing ; lecture ouverte à tout compte authentifié.',
    },
  ]

  const SCOPING = /\.eq\(\s*'(tenant_id|user_id|id)'|tenant_?id/i

  function isDocumented(file: string, table: string): boolean {
    return DOCUMENTED_EXCEPTIONS.some(
      (entry) => file.endsWith(entry.file) && entry.table === table,
    )
  }

  function collectCalls() {
    const calls: Array<{ file: string; table: string; line: number; window: string }> = []

    for (const file of listSourceFiles(SRC_DIR)) {
      const source = readFileSync(file, 'utf8')
      const pattern = /\.from\(\s*'([a-z_]+)'\s*\)/g
      let match: RegExpExecArray | null

      while ((match = pattern.exec(source)) !== null) {
        calls.push({
          file,
          table: match[1] ?? '',
          line: source.slice(0, match.index).split('\n').length,
          window: source.slice(match.index, match.index + 600),
        })
      }
    }

    return calls
  }

  it('chaque `.from(...)` du code client est filtré ou documenté', () => {
    const problems = collectCalls()
      .filter((call) => !SCOPING.test(call.window) && !isDocumented(call.file, call.table))
      .map((call) => `${call.file}:${call.line} — table « ${call.table} » sans filtre de tenant`)

    expect(problems).toEqual([])
  })

  it('chaque exception documentée correspond à un appel réel', () => {
    const calls = collectCalls()

    for (const exception of DOCUMENTED_EXCEPTIONS) {
      const found = calls.some(
        (call) => call.file.endsWith(exception.file) && call.table === exception.table,
      )
      // Une exception obsolète masquerait une règle qu'on croit encore vérifiée.
      expect(found, `exception périmée : ${exception.file} → ${exception.table}`).toBe(true)
    }
  })
})
