import { describe, expect, it } from 'vitest'
import {
  FORMULES_ATTENDUES,
  TABLES_ATTENDUES,
  construireControles,
  executerRecette,
  resume,
} from './recette.mjs'

/**
 * Tests de la recette technique (`scripts/recette.mjs`).
 *
 * Le script tourne sur un vrai projet chez le client : il doit donc être
 * **faux-positif-proof**. On simule ici des réponses Supabase pour vérifier
 * qu'une RLS ouverte, une table manquante ou un webhook absent sont bien
 * signalés comme des échecs.
 */

const CONFIG = {
  supabaseUrl: 'https://exemple.supabase.co',
  anonKey: 'anon-key',
  serviceRoleKey: 'service-key',
}

/** Fabrique une réponse HTTP minimale. */
function reponse(status, corps = null) {
  return {
    status,
    async json() {
      if (corps === null) throw new Error('corps vide')
      return corps
    },
  }
}

/** Routeur de faux `fetch` : une fonction par URL, sinon 404. */
function fauxFetch(routes) {
  return async (url, init = {}) => {
    const chemin = url.replace(CONFIG.supabaseUrl, '')

    for (const [motif, reponseFabrique] of routes) {
      if (chemin.startsWith(motif)) return reponseFabrique(init)
    }

    return reponse(404, { code: '42P01' })
  }
}

/** Projet « sain » : toutes les vérifications doivent passer. */
function projetSain() {
  return fauxFetch([
    ['/rest/v1/orders', () => reponse(401, { code: '42501' })],
    ['/rest/v1/platform_admins', () => reponse(401, { code: '42501' })],
    ['/rest/v1/plans', () => reponse(200, [{ code: 'essentiel' }, { code: 'pro' }, { code: 'reseau' }])],
    ['/rest/v1/rpc/my_subscription', () => reponse(401, { code: '42501' })],
    ['/functions/v1/cinetpay-webhook', () => reponse(405)],
    ['/rest/v1/', () => reponse(200)],
    // Toute autre table répond une page vide : elle existe.
    ['/rest/v1/', () => reponse(200, [])],
  ])
}

describe('construireControles', () => {
  it('couvre les sept contrôles attendus', () => {
    const identifiants = construireControles(CONFIG).map((controle) => controle.id)

    expect(identifiants).toEqual([
      'api',
      'rls-orders',
      'tables',
      'plans',
      'rpc-abonnement',
      'supervision-verrouillee',
      'webhook',
    ])
  })

  it('attend les vingt tables des migrations 001 à 007', () => {
    expect(TABLES_ATTENDUES).toHaveLength(20)
    expect(TABLES_ATTENDUES).toContain('support_requests')
  })
})

describe('executerRecette', () => {
  it('valide un projet sain', async () => {
    const resultats = await executerRecette(CONFIG, projetSain())

    expect(resultats.every((resultat) => resultat.ok)).toBe(true)
    expect(resume(resultats)).toBe('7/7 contrôle(s) réussi(s)')
  })

  it('signale une RLS ouverte sur orders', async () => {
    const fetchImpl = fauxFetch([
      ['/rest/v1/orders', () => reponse(200, [{ id: 'commande-d-un-autre-pressing' }])],
      ['/rest/v1/', () => reponse(200, [])],
    ])

    const resultats = await executerRecette(CONFIG, fetchImpl)
    const controle = resultats.find((resultat) => resultat.id === 'rls-orders')

    expect(controle.ok).toBe(false)
    expect(controle.indice).toContain('RLS')
  })

  it('signale une table manquante', async () => {
    const fetchImpl = fauxFetch([
      ['/rest/v1/stock_movements', () => reponse(404, { code: '42P01' })],
      ['/rest/v1/orders', () => reponse(401, { code: '42501' })],
      ['/rest/v1/plans', () => reponse(200, [{}, {}, {}])],
      ['/rest/v1/rpc/my_subscription', () => reponse(401)],
      ['/functions/v1/cinetpay-webhook', () => reponse(405)],
      ['/rest/v1/', () => reponse(200, [])],
    ])

    const resultats = await executerRecette(CONFIG, fetchImpl)
    const controle = resultats.find((resultat) => resultat.id === 'tables')

    expect(controle.ok).toBe(false)
    expect(controle.detail).toContain('stock_movements')
  })

  it('signale un webhook absent', async () => {
    const fetchImpl = fauxFetch([
      ['/rest/v1/orders', () => reponse(401, { code: '42501' })],
      ['/rest/v1/plans', () => reponse(200, [{}, {}, {}])],
      ['/rest/v1/rpc/my_subscription', () => reponse(401)],
      ['/rest/v1/', () => reponse(200, [])],
    ])

    const resultats = await executerRecette(CONFIG, fetchImpl)
    const controle = resultats.find((resultat) => resultat.id === 'webhook')

    expect(controle.ok).toBe(false)
    expect(controle.detail).toBe('HTTP 404')
  })

  it('signale une supervision exposée au public', async () => {
    const fetchImpl = fauxFetch([
      ['/rest/v1/platform_admins', () => reponse(200, [{ user_id: 'editeur' }])],
      ['/rest/v1/orders', () => reponse(401, { code: '42501' })],
      ['/rest/v1/plans', () => reponse(200, [{}, {}, {}])],
      ['/rest/v1/rpc/my_subscription', () => reponse(401)],
      ['/functions/v1/cinetpay-webhook', () => reponse(405)],
      ['/rest/v1/', () => reponse(200, [])],
    ])

    const resultats = await executerRecette(CONFIG, fetchImpl)
    const controle = resultats.find((resultat) => resultat.id === 'supervision-verrouillee')

    expect(controle.ok).toBe(false)
  })

  it('transforme une panne réseau en échec explicite', async () => {
    const resultats = await executerRecette(CONFIG, async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })

    expect(resultats).toHaveLength(7)
    expect(resultats.every((resultat) => !resultat.ok)).toBe(true)
    expect(resultats[0].detail).toContain('erreur réseau')
  })

  it('exige au moins trois formules', async () => {
    const fetchImpl = fauxFetch([
      ['/rest/v1/plans', () => reponse(200, [{ code: 'pro' }])],
      ['/rest/v1/orders', () => reponse(401, { code: '42501' })],
      ['/rest/v1/platform_admins', () => reponse(401, { code: '42501' })],
      ['/rest/v1/rpc/my_subscription', () => reponse(401)],
      ['/functions/v1/cinetpay-webhook', () => reponse(405)],
      ['/rest/v1/', () => reponse(200, [])],
    ])

    const resultats = await executerRecette(CONFIG, fetchImpl)
    const controle = resultats.find((resultat) => resultat.id === 'plans')

    expect(controle.ok).toBe(false)
    expect(controle.detail).toContain('1 formule')
    expect(FORMULES_ATTENDUES).toBe(3)
  })
})
