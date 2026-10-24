#!/usr/bin/env node
/**
 * cinetpay-simule.mjs — faux CinetPay local, pour tester le paiement sans
 * identifiants marchands.
 *
 * Pourquoi ce fichier existe
 * -----------------------------------------------------------------------------
 * L'API Checkout v2 n'a pas d'hôte de bac à sable : CinetPay fournit des
 * identifiants d'essai qui tapent la même URL que la production. Sans compte,
 * il était donc impossible d'exercer le parcours complet — initiation,
 * redirection, notification, vérification, commande marquée payée.
 *
 * Ce serveur en reproduit les trois points d'entrée utiles :
 *   POST /v2/payment        → URL de guichet fictive
 *   GET  /paiement/:id      → page de paiement simulée (accepter / refuser)
 *   POST /v2/payment/check  → statut de la transaction
 *
 * Il envoie ensuite la notification au `notify_url` fourni à l'initialisation,
 * en form-urlencoded, exactement comme CinetPay.
 *
 * Usage
 * -----------------------------------------------------------------------------
 *   node scripts/cinetpay-simule.mjs                 # port 54321
 *   PORT=54322 node scripts/cinetpay-simule.mjs
 *   CINETPAY_SIM_SECRET=... node scripts/cinetpay-simule.mjs   # signe en HMAC
 *
 * Côté Edge Functions (secrets Supabase) :
 *   CINETPAY_MODE=test
 *   CINETPAY_BASE_URL=http://localhost:54321
 *   CINETPAY_API_KEY=simulateur-test-key
 *   CINETPAY_SITE_ID=123456
 *
 * ⚠ Sur Supabase, une Edge Function tourne chez Supabase : `localhost` désigne
 *   alors SA machine, pas la vôtre. Pour un essai de bout en bout depuis le
 *   cloud, exposez le simulateur (tunnel) et mettez son URL publique dans
 *   `CINETPAY_BASE_URL`. En local (Docker/Supabase CLI), `localhost` convient.
 */

import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { creerSimulateur, messageSigne } from './lib/cinetpay-simule.mjs'

const PORT = Number(process.env.PORT ?? 54321)
const SECRET = process.env.CINETPAY_SIM_SECRET ?? null

const simulateur = creerSimulateur({
  apiKey: process.env.CINETPAY_SIM_API_KEY ?? 'simulateur-test-key',
  siteId: process.env.CINETPAY_SIM_SITE_ID ?? '123456',
  baseUrl: process.env.CINETPAY_SIM_BASE_URL ?? `http://localhost:${PORT}`,
})

const journal = (...args) => console.log('[simulateur]', ...args)

/** Lit un corps JSON, avec une limite raisonnable. */
async function lireJson(requete) {
  const morceaux = []
  let taille = 0

  for await (const morceau of requete) {
    taille += morceau.length
    if (taille > 64 * 1024) throw new Error('corps trop volumineux')
    morceaux.push(morceau)
  }

  return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}')
}

function repondreJson(reponse, statut, corps) {
  const charge = JSON.stringify(corps)
  reponse.writeHead(statut, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(charge),
    'Cache-Control': 'no-store',
  })
  reponse.end(charge)
}

function repondreHtml(reponse, statut, html) {
  reponse.writeHead(statut, { 'Content-Type': 'text/html; charset=utf-8' })
  reponse.end(html)
}

/** Page de paiement simulée : deux boutons, rien de plus. */
function pagePaiement(transaction) {
  const montant = transaction.montant.toLocaleString('fr-FR').replace(/\u202f/g, ' ')
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Paiement simulé — ${montant} FCFA</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #0f172a;
           display: grid; place-items: center; min-height: 100vh; margin: 0; }
    main { background: #fff; padding: 2rem; border-radius: 1.25rem; max-width: 26rem; width: 90%;
           box-shadow: 0 30px 80px -30px rgba(2,6,23,.9); }
    h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
    .montant { font-size: 2rem; font-weight: 700; margin: 1rem 0; }
    p { color: #475569; font-size: .9rem; line-height: 1.5; }
    a { display: block; text-align: center; padding: .9rem; border-radius: .75rem;
        text-decoration: none; font-weight: 600; margin-top: .75rem; }
    .ok { background: #0f766e; color: #fff; }
    .ko { background: #f1f5f9; color: #0f172a; }
    code { background: #f1f5f9; padding: .1rem .3rem; border-radius: .25rem; font-size: .8rem; }
  </style>
</head>
<body>
  <main>
    <p style="text-transform:uppercase;letter-spacing:.08em;font-size:.7rem;color:#0f766e">
      Simulateur CinetPay — aucun argent réel
    </p>
    <h1>${transaction.description || 'Paiement de commande'}</h1>
    <div class="montant">${montant} FCFA</div>
    <p>Transaction <code>${transaction.transactionId}</code></p>
    <a class="ok" href="/simulateur/accepter?id=${encodeURIComponent(transaction.transactionId)}">
      Simuler un paiement accepté
    </a>
    <a class="ko" href="/simulateur/refuser?id=${encodeURIComponent(transaction.transactionId)}">
      Simuler un refus du client
    </a>
  </main>
</body>
</html>`
}

/** Envoie la notification au `notify_url`, comme le ferait CinetPay. */
async function notifier(transaction) {
  const corps = simulateur.corpsNotification(transaction.transactionId)
  if (!corps) return { ok: false, motif: 'transaction inconnue' }

  const entetes = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (SECRET) {
    // Le HMAC voyage dans l'en-tête `x-token`, pas dans le corps.
    entetes['x-token'] = createHmac('sha256', SECRET).update(messageSigne(corps)).digest('hex')
  }

  const charge = new URLSearchParams(corps).toString()

  try {
    const reponse = await fetch(transaction.notifyUrl, { method: 'POST', headers: entetes, body: charge })
    journal(`notification ${transaction.transactionId} → ${transaction.notifyUrl} : ${reponse.status}`)
    return { ok: reponse.ok, statut: reponse.status }
  } catch (erreur) {
    journal(`notification impossible (${erreur.message}) — le webhook doit rester joignable`)
    return { ok: false, motif: erreur.message }
  }
}

const serveur = createServer(async (requete, reponse) => {
  const url = new URL(requete.url ?? '/', `http://localhost:${PORT}`)
  const chemin = url.pathname

  try {
    if (requete.method === 'POST' && chemin === '/v2/payment') {
      const corps = await lireJson(requete)
      const resultat = simulateur.initialiser(corps)

      if (!resultat.ok) {
        journal(`init refusée : ${resultat.description}`)
        return repondreJson(reponse, 200, { code: resultat.code, message: resultat.description })
      }

      journal(`init ${resultat.data.transaction_id} — ${resultat.data.amount} FCFA`)
      return repondreJson(reponse, 200, {
        code: '201',
        message: 'CREATED',
        data: resultat.data,
        description: 'Transaction créée (simulateur).',
      })
    }

    if (requete.method === 'POST' && chemin === '/v2/payment/check') {
      const corps = await lireJson(requete)
      const resultat = simulateur.verifier(corps)

      if (!resultat.ok) {
        return repondreJson(reponse, 200, { code: resultat.code, message: resultat.description })
      }

      return repondreJson(reponse, 200, { code: '00', message: 'SUCCES', data: resultat.data })
    }

    if (requete.method === 'GET' && chemin.startsWith('/paiement/')) {
      const identifiant = decodeURIComponent(chemin.slice('/paiement/'.length))
      const transaction = simulateur.transactions.get(identifiant)
      if (!transaction) return repondreHtml(reponse, 404, '<h1>Transaction inconnue</h1>')
      return repondreHtml(reponse, 200, pagePaiement(transaction))
    }

    if (requete.method === 'GET' && chemin.startsWith('/simulateur/')) {
      const identifiant = url.searchParams.get('id') ?? ''
      const decision = chemin === '/simulateur/accepter' ? 'accepter' : 'refuser'
      const resultat = simulateur.decider(identifiant, decision)

      if (!resultat.ok) return repondreHtml(reponse, 404, '<h1>Transaction inconnue</h1>')

      journal(`${identifiant} → ${decision}`)
      const notification = await notifier(resultat.transaction)

      // On renvoie le client vers le `return_url` fourni à l'initialisation,
      // comme le fait CinetPay. L'application y relit le statut.
      const retour = new URL(resultat.transaction.returnUrl)
      retour.searchParams.set('transaction_id', identifiant)
      retour.searchParams.set('simulateur', notification.ok ? 'notifie' : 'notification_echouee')
      reponse.writeHead(302, { Location: retour.toString() })
      return reponse.end()
    }

    if (requete.method === 'GET' && chemin === '/') {
      return repondreJson(reponse, 200, {
        simulateur: 'CinetPay',
        transactions: [...simulateur.transactions.values()].map((transaction) => ({
          transaction_id: transaction.transactionId,
          montant: transaction.montant,
          statut: transaction.statut,
          notifications: transaction.notifications,
        })),
      })
    }

    return repondreJson(reponse, 404, { message: 'Route inconnue.' })
  } catch (erreur) {
    journal(`erreur : ${erreur.message}`)
    return repondreJson(reponse, 400, { message: 'Requête illisible.' })
  }
})

serveur.listen(PORT, '0.0.0.0', () => {
  journal(`à l'écoute sur http://localhost:${PORT}`)
  journal(`identifiants : apikey=${simulateur.config.apiKey} site_id=${simulateur.config.siteId}`)
  journal(SECRET ? 'notifications signées en HMAC (x-token)' : 'notifications non signées')
})
