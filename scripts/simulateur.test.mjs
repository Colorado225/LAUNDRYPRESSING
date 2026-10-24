import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHAMPS_SIGNES,
  STATUTS,
  creerSimulateur,
  messageSigne,
} from './lib/cinetpay-simule.mjs'

/**
 * Simulateur CinetPay — mode essai, sans compte marchand.
 *
 * Deux niveaux sont testés :
 *  1. l'état pur (`scripts/lib/cinetpay-simule.mjs`), sans réseau : c'est là que
 *     vivent les règles qui comptent (montant multiple de 5, transaction
 *     unique, idempotence de la notification) ;
 *  2. le vrai serveur HTTP, lancé sur un port libre, avec un faux webhook en
 *     face : c'est le seul moyen de vérifier que la notification part bien en
 *     form-urlencoded, signée dans l'en-tête `x-token`, et que la redirection
 *     de retour porte l'identifiant attendu.
 *
 * Ce que ce test ne prouve pas : que les Edge Functions déployées répondent.
 * Sans identifiants marchands ni projet joignable depuis la CI, ce contrôle
 * reste manuel (voir `docs/DEPLOIEMENT-FONCTIONS.md`).
 */

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const IDENTIFIANTS = { apikey: 'simulateur-test-key', site_id: '123456' }

/** Transaction valide de référence : tous les champs obligatoires. */
function corpsInit(surcharge = {}) {
  return {
    ...IDENTIFIANTS,
    transaction_id: 'SIM-0001',
    amount: 15000,
    currency: 'XOF',
    description: 'Pressing Cocody — commande 12',
    notify_url: 'http://127.0.0.1:9/webhook',
    return_url: 'http://127.0.0.1:9/retour',
    customer_phone_number: '0707070707',
    ...surcharge,
  }
}

describe('CHAMPS_SIGNES', () => {
  it('reste identique à l’ordre signé par les Edge Functions', () => {
    // Le simulateur duplique volontairement la liste (Node pur, sans étape de
    // compilation). Si les deux divergent, les notifications d'essai seront
    // rejetées en « HMAC invalide » et l'écart sera très difficile à voir.
    const source = readFileSync(
      resolve(RACINE, 'supabase/functions/_shared/cinetpay.ts'),
      'utf8',
    )
    const debut = source.indexOf('const order = [')
    const fin = source.indexOf(']', debut)
    expect(debut).toBeGreaterThan(-1)

    const cotes = source.slice(debut, fin)
    const champs = [...cotes.matchAll(/'([a-z_]+)'/g)].map((correspondance) => correspondance[1])

    expect(champs).toEqual(CHAMPS_SIGNES)
  })

  it('concatène les champs vides en chaîne vide', () => {
    expect(messageSigne({ cpm_site_id: '123456' })).toBe('123456')
    expect(messageSigne({})).toBe('')
  })
})

describe('creerSimulateur — initialisation', () => {
  it('accepte une transaction conforme et renvoie une URL de guichet', () => {
    const simulateur = creerSimulateur()
    const resultat = simulateur.initialiser(corpsInit())

    expect(resultat.ok).toBe(true)
    expect(resultat.data.payment_url).toBe('http://localhost:54321/paiement/SIM-0001')
    expect(resultat.data.amount).toBe(15000)
    expect(simulateur.transactions.get('SIM-0001').statut).toBe(STATUTS.attente)
  })

  it('refuse des identifiants inconnus', () => {
    const simulateur = creerSimulateur()
    const resultat = simulateur.initialiser(corpsInit({ apikey: 'mauvaise-cle' }))

    expect(resultat).toMatchObject({ ok: false, code: '401' })
    expect(simulateur.journal.at(-1).motif).toBe('identifiants')
  })

  it('refuse un montant non multiple de 5, comme CinetPay', () => {
    const simulateur = creerSimulateur()

    expect(simulateur.initialiser(corpsInit({ amount: 1234 }))).toMatchObject({
      ok: false,
      code: '400',
    })

    // 15 000 est un multiple de 5 : le contrôle ne doit pas être trop strict.
    expect(simulateur.initialiser(corpsInit({ amount: 15000 })).ok).toBe(true)
  })

  it('refuse un montant nul, une transaction sans identifiant ou sans URL', () => {
    const simulateur = creerSimulateur()

    expect(simulateur.initialiser(corpsInit({ amount: 0 })).ok).toBe(false)
    expect(simulateur.initialiser(corpsInit({ transaction_id: '  ' })).ok).toBe(false)
    expect(simulateur.initialiser(corpsInit({ notify_url: '' })).ok).toBe(false)
    expect(simulateur.initialiser(corpsInit({ return_url: '' })).ok).toBe(false)
  })

  it('refuse une transaction déjà vue', () => {
    const simulateur = creerSimulateur()
    simulateur.initialiser(corpsInit())
    const resultat = simulateur.initialiser(corpsInit())

    expect(resultat).toMatchObject({ ok: false, code: '409' })
  })
})

describe('creerSimulateur — vérification et décision', () => {
  it('renvoie PENDING puis ACCEPTED après acceptation', () => {
    const simulateur = creerSimulateur()
    simulateur.initialiser(corpsInit())

    expect(simulateur.verifier({ ...IDENTIFIANTS, transaction_id: 'SIM-0001' }).data.status).toBe(
      STATUTS.attente,
    )

    simulateur.decider('SIM-0001', 'accepter')

    const apres = simulateur.verifier({ ...IDENTIFIANTS, transaction_id: 'SIM-0001' })
    expect(apres.data).toMatchObject({ status: STATUTS.accepte, payment_method: 'WAVE' })
  })

  it('renvoie REFUSED après refus du client', () => {
    const simulateur = creerSimulateur()
    simulateur.initialiser(corpsInit())
    simulateur.decider('SIM-0001', 'refuser')

    expect(simulateur.verifier({ ...IDENTIFIANTS, transaction_id: 'SIM-0001' }).data.status).toBe(
      STATUTS.refuse,
    )

    const corps = simulateur.corpsNotification('SIM-0001')
    expect(corps.cpm_error_message).not.toBe('')
  })

  it('refuse de décider une transaction inconnue ou une décision inconnue', () => {
    const simulateur = creerSimulateur()
    simulateur.initialiser(corpsInit())

    expect(simulateur.decider('SIM-9999', 'accepter')).toEqual({ ok: false, motif: 'inconnue' })
    expect(simulateur.decider('SIM-0001', 'peut-etre')).toEqual({
      ok: false,
      motif: 'decision_inconnue',
    })
  })

  it('protège la vérification par les identifiants marchands', () => {
    const simulateur = creerSimulateur()
    simulateur.initialiser(corpsInit())

    expect(
      simulateur.verifier({ apikey: 'x', site_id: '123456', transaction_id: 'SIM-0001' }).ok,
    ).toBe(false)
    expect(simulateur.verifier({ ...IDENTIFIANTS, transaction_id: 'INCONNUE' })).toMatchObject({
      ok: false,
      code: '404',
    })
  })

  it('compte les notifications envoyées', () => {
    const simulateur = creerSimulateur()
    simulateur.initialiser(corpsInit())

    simulateur.corpsNotification('SIM-0001')
    const corps = simulateur.corpsNotification('SIM-0001')

    expect(corps.cpm_site_id).toBe('123456')
    expect(corps.cpm_amount).toBe('15000')
    // `signature` est un jeton de transaction, pas le HMAC : piège classique.
    expect(corps.signature).toMatch(/^sim-signature-/)
    expect(simulateur.transactions.get('SIM-0001').notifications).toBe(2)
    expect(simulateur.corpsNotification('SIM-9999')).toBeNull()
  })
})

// --- Serveur réel -----------------------------------------------------------

const SECRET = 'secret-simulateur-de-test'
const enfants = []
const serveurs = []

/** Port TCP libre, choisi par le système pour éviter tout conflit. */
function portLibre() {
  return new Promise((resoudre, rejeter) => {
    const sonde = createServer()
    sonde.once('error', rejeter)
    sonde.listen(0, '127.0.0.1', () => {
      const { port } = sonde.address()
      sonde.close(() => resoudre(port))
    })
  })
}

async function attendre(condition, delai = 5000) {
  const debut = Date.now()
  while (Date.now() - debut < delai) {
    try {
      if (await condition()) return true
    } catch {
      // Le serveur n'écoute peut-être pas encore : on réessaie.
    }
    await new Promise((resoudre) => setTimeout(resoudre, 50))
  }
  throw new Error('Délai dépassé en attendant le simulateur.')
}

describe('serveur HTTP du simulateur', () => {
  let base
  let simulateur
  let portWebhook
  const notifications = []
  let webhook

  beforeAll(async () => {
    // Faux webhook : il enregistre ce que CinetPay enverrait vraiment.
    portWebhook = await portLibre()
    webhook = createHttpServer((requete, reponse) => {
      const morceaux = []
      requete.on('data', (morceau) => morceaux.push(morceau))
      requete.on('end', () => {
        notifications.push({
          entetes: requete.headers,
          corps: Object.fromEntries(
            new URLSearchParams(Buffer.concat(morceaux).toString('utf8')),
          ),
        })
        reponse.writeHead(200, { 'Content-Type': 'text/plain' })
        reponse.end('OK')
      })
    })
    await new Promise((resoudre) => webhook.listen(portWebhook, '127.0.0.1', resoudre))
    serveurs.push(webhook)

    const port = await portLibre()
    base = `http://127.0.0.1:${port}`

    simulateur = spawn(process.execPath, [resolve(RACINE, 'scripts/cinetpay-simule.mjs')], {
      env: {
        ...process.env,
        PORT: String(port),
        CINETPAY_SIM_SECRET: SECRET,
        CINETPAY_SIM_BASE_URL: base,
      },
      stdio: 'ignore',
    })
    enfants.push(simulateur)

    await attendre(async () => {
      const reponse = await fetch(`${base}/`)
      return reponse.ok
    })
  }, 20000)

  afterAll(async () => {
    for (const enfant of enfants) enfant.kill('SIGKILL')
    for (const serveur of serveurs) {
      await new Promise((resoudre) => serveur.close(resoudre))
    }
  })

  it('initie un paiement, notifie le webhook en HMAC et redirige vers le retour', async () => {
    const retour = 'http://127.0.0.1:9/retour'

    const initialisation = await fetch(`${base}/v2/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        corpsInit({
          transaction_id: 'SIM-HTTP-1',
          notify_url: `http://127.0.0.1:${portWebhook}/webhook`,
          return_url: retour,
        }),
      ),
    })
    const init = await initialisation.json()
    expect(init.code).toBe('201')
    expect(init.data.payment_url).toBe(`${base}/paiement/SIM-HTTP-1`)

    // La page de guichet ne doit jamais parler d'argent réel.
    const page = await (await fetch(init.data.payment_url)).text()
    expect(page).toContain('aucun argent réel')
    expect(page).toContain('15 000 FCFA')

    const decision = await fetch(`${base}/simulateur/accepter?id=SIM-HTTP-1`, {
      method: 'GET',
      redirect: 'manual',
    })
    expect(decision.status).toBe(302)

    const redirection = new URL(decision.headers.get('location'))
    expect(`${redirection.origin}${redirection.pathname}`).toBe(retour)
    expect(redirection.searchParams.get('transaction_id')).toBe('SIM-HTTP-1')
    expect(redirection.searchParams.get('simulateur')).toBe('notifie')

    await attendre(() => notifications.length > 0)
    const notification = notifications.at(-1)

    // Notification form-urlencoded, comme CinetPay : pas de JSON ici.
    expect(notification.entetes['content-type']).toContain('application/x-www-form-urlencoded')
    expect(notification.corps.cpm_trans_id).toBe('SIM-HTTP-1')
    expect(notification.corps.cpm_amount).toBe('15000')
    expect(notification.corps.cpm_designation).toBe('Pressing Cocody — commande 12')

    // Le HMAC voyage dans `x-token`, calculé sur l'ordre imposé des champs.
    const attendu = createHmac('sha256', SECRET)
      .update(messageSigne(notification.corps))
      .digest('hex')
    expect(notification.entetes['x-token']).toBe(attendu)
    expect(notification.corps.signature).not.toBe(attendu)

    // Et la vérification serveur confirme le paiement.
    const verification = await fetch(`${base}/v2/payment/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...IDENTIFIANTS, transaction_id: 'SIM-HTTP-1' }),
    })
    expect((await verification.json()).data.status).toBe(STATUTS.accepte)
  }, 20000)

  it('signale un webhook injoignable au lieu de bloquer le retour', async () => {
    await fetch(`${base}/v2/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        corpsInit({
          transaction_id: 'SIM-HTTP-2',
          notify_url: 'http://127.0.0.1:1/webhook',
        }),
      ),
    })

    const decision = await fetch(`${base}/simulateur/refuser?id=SIM-HTTP-2`, {
      method: 'GET',
      redirect: 'manual',
    })

    expect(decision.status).toBe(302)
    const redirection = new URL(decision.headers.get('location'))
    expect(redirection.searchParams.get('simulateur')).toBe('notification_echouee')

    const verification = await fetch(`${base}/v2/payment/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...IDENTIFIANTS, transaction_id: 'SIM-HTTP-2' }),
    })
    expect((await verification.json()).data.status).toBe(STATUTS.refuse)
  }, 20000)

  it('répond 404 à une transaction inconnue et à une route inconnue', async () => {
    expect((await fetch(`${base}/paiement/INCONNUE`)).status).toBe(404)
    expect((await fetch(`${base}/simulateur/accepter?id=INCONNUE`)).status).toBe(404)
    expect((await fetch(`${base}/nimporte-quoi`)).status).toBe(404)
  }, 20000)
})
