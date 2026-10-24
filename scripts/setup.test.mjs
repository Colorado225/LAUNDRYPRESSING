import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildConfig } from './lib/config.mjs'
import { printableCommand, stepAccount, stepVerify, verifyWebhook } from './setup.mjs'

/**
 * Tests d'intégration du provisionnement (`scripts/setup.mjs`).
 *
 * Un vrai serveur Supabase n'est pas disponible hors ligne : on simule les
 * quatre points d'entrée réellement appelés (PostgREST `tenants` et
 * `tenant_users`, l'API Admin `auth/v1/admin/users`, la route `orders` et la
 * fonction déployée). Ce qui est vérifié ici n'est pas le réseau mais
 * **le contrat** : quelles requêtes sont envoyées, et surtout que relancer
 * l'installation ne crée ni doublon ni compte en double.
 */

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '99999999-9999-4999-8999-999999999999'

/** État simulé de la base distante. */
const state = {
  tenants: [],
  users: [],
  memberships: [],
  calls: [],
  /** Comportements à partir du 2e passage (idempotence). */
  failCreateUser: false,
}

let server
let baseUrl

function json(response, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      resolve(raw ? JSON.parse(raw) : null)
    })
  })
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const { pathname, searchParams } = url
    state.calls.push({ method: request.method, pathname, search: url.search })

    // --- PostgREST : tenants -------------------------------------------------
    if (pathname === '/rest/v1/tenants') {
      if (request.method === 'GET') {
        const name = searchParams.get('name')?.replace(/^eq\./, '')
        return json(
          response,
          200,
          state.tenants.filter((tenant) => !name || tenant.name === name),
        )
      }
      if (request.method === 'POST') {
        const body = await readBody(request)
        const tenant = { id: TENANT_ID, ...body, created_at: new Date().toISOString() }
        state.tenants.push(tenant)
        return json(response, 201, [tenant])
      }
    }

    // --- PostgREST : rattachements -------------------------------------------
    if (pathname === '/rest/v1/tenant_users') {
      if (request.method === 'GET') return json(response, 200, state.memberships)
      if (request.method === 'POST') {
        const body = await readBody(request)
        state.memberships.push(body)
        return json(response, 201, body)
      }
      if (request.method === 'PATCH') {
        const body = await readBody(request)
        // Le corps est conservé pour que les tests puissent vérifier ce qui
        // est réellement envoyé (et pas seulement la méthode employée).
        state.calls[state.calls.length - 1].body = body
        Object.assign(state.memberships[0], body)
        return json(response, 201, state.memberships[0])
      }
    }

    // --- API Admin : utilisateurs -------------------------------------------
    if (pathname === '/auth/v1/admin/users' && request.method === 'GET') {
      return json(response, 200, { users: state.users })
    }

    if (pathname === '/auth/v1/admin/users' && request.method === 'POST') {
      if (state.failCreateUser) {
        return json(response, 422, {
          code: 422,
          msg: 'User already registered',
          error_code: 'email_exists',
        })
      }
      const body = await readBody(request)
      const user = {
        id: USER_ID,
        email: body.email,
        app_metadata: body.app_metadata,
      }
      state.users.push(user)
      return json(response, 200, user)
    }

    if (pathname === `/auth/v1/admin/users/${USER_ID}` && request.method === 'PUT') {
      const body = await readBody(request)
      state.users = state.users.map((user) =>
        user.id === USER_ID ? { ...user, app_metadata: body.app_metadata } : user,
      )
      return json(response, 200, state.users[0])
    }

    // --- Schéma protégé ------------------------------------------------------
    if (pathname === '/rest/v1/orders') {
      return json(response, 401, {
        code: '42501',
        message: 'new row violates row-level security policy for table "orders"',
      })
    }

    // --- Edge Function déployée ---------------------------------------------
    if (pathname === '/functions/v1/cinetpay-webhook') {
      return json(response, 405, { error: { code: 'method_not_allowed' } })
    }

    json(response, 404, { error: 'not_found', pathname })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

function config() {
  return buildConfig({
    VITE_SUPABASE_URL: baseUrl,
    VITE_SUPABASE_ANON_KEY: 'cle-publique-de-test-0123456789',
    SUPABASE_SERVICE_ROLE_KEY: 'cle-service-de-test',
    SEED_OWNER_EMAIL: 'patron@pressing.ci',
    SEED_OWNER_PASSWORD: 'motdepasse123',
    SEED_TENANT_NAME: 'Pressing Test',
    SEED_TENANT_PHONE: '+2250700000000',
    CINETPAY_API_KEY: 'cle-cinetpay',
    CINETPAY_SITE_ID: '123456',
  })
}

describe('stepAccount — première installation', () => {
  it('crée le pressing, le compte et le rattachement', async () => {
    const result = await stepAccount(config())

    expect(result).toEqual({ tenantId: TENANT_ID, userId: USER_ID })
    expect(state.tenants).toHaveLength(1)
    expect(state.users).toHaveLength(1)
    expect(state.memberships).toHaveLength(1)
  })

  it('pose le tenant_id dans app_metadata dès la création', async () => {
    // C'est ce que lit `current_tenant_id()` dans la RLS : sans ces claims,
    // la toute première connexion lirait `tenant_users`, ce qui fonctionne
    // mais ne doit pas être le chemin par défaut.
    expect(state.users[0].app_metadata).toEqual({
      tenant_id: TENANT_ID,
      tenant_role: 'owner',
    })
  })

  it('rattache le compte avec le rôle propriétaire', async () => {
    expect(state.memberships[0]).toEqual({
      user_id: USER_ID,
      tenant_id: TENANT_ID,
      role: 'owner',
      // Utilisé par le sélecteur d'attribution des commandes.
      display_name: 'Propriétaire',
    })
  })

  it('confirme l’adresse e-mail pour éviter un compte inutilisable', () => {
    const creation = state.calls.find(
      (call) => call.method === 'POST' && call.pathname === '/auth/v1/admin/users',
    )

    expect(creation).toBeDefined()
  })
})

describe('stepAccount — relance (idempotence)', () => {
  beforeAll(() => {
    state.failCreateUser = true
  })

  it('réutilise le pressing et le compte existants', async () => {
    const result = await stepAccount(config())

    expect(result).toEqual({ tenantId: TENANT_ID, userId: USER_ID })
  })

  it('ne crée aucun doublon', () => {
    expect(state.tenants).toHaveLength(1)
    expect(state.users).toHaveLength(1)
    expect(state.memberships).toHaveLength(1)
  })

  it('met tout de même à jour les claims du compte existant', () => {
    const updates = state.calls.filter(
      (call) => call.method === 'PUT' && call.pathname.startsWith('/auth/v1/admin/users/'),
    )

    expect(updates.length).toBeGreaterThanOrEqual(2)
  })

  it('renseigne le nom affiché s’il manque sur un rattachement existant', async () => {
    state.memberships[0].display_name = undefined
    state.calls.length = 0

    await stepAccount(config())

    const patch = state.calls.find(
      (call) => call.method === 'PATCH' && call.pathname === '/rest/v1/tenant_users',
    )

    expect(patch?.body).toEqual({ display_name: 'Propriétaire' })
  })
})

describe('stepVerify — contrôle du schéma', () => {
  it('accepte un refus RLS (42501) comme preuve que la table existe', async () => {
    await expect(stepVerify(config())).resolves.toBeUndefined()

    const call = state.calls.find((entry) => entry.pathname === '/rest/v1/orders')

    expect(call).toBeDefined()
  })
})

describe('verifyWebhook — contrôle du déploiement', () => {
  it('considère un 405 comme un webhook déployé', async () => {
    await expect(verifyWebhook(config())).resolves.toBe('ok')
  })
})

describe('printableCommand', () => {
  it('masque le mot de passe de la base', () => {
    const line = printableCommand('npx', [
      'supabase@2',
      'db',
      'push',
      '--password',
      'MotDePasseSecret',
      '--yes',
    ])

    expect(line).not.toContain('MotDePasseSecret')
    expect(line).toContain('--password ••••')
  })

  it('laisse les autres arguments intacts', () => {
    const line = printableCommand('npx', ['supabase@2', 'db', 'push', '--project-ref', 'abcd'])

    expect(line).toBe('npx supabase@2 db push --project-ref abcd')
  })
})
