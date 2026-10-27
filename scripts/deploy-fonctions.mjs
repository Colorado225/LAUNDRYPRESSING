#!/usr/bin/env node
/**
 * deploy-fonctions.mjs — assemble et déploie les Edge Functions CinetPay.
 *
 * Pourquoi un script plutôt que la CLI Supabase ?
 * -----------------------------------------------------------------------------
 * La CLI suppose un projet « lié » (un `supabase link` interactif, un mot de
 * passe de base, des fichiers temporaires). Ici, tout passe par l'API
 * d'administration, avec le seul jeton `SUPABASE_ACCESS_TOKEN` — le même que
 * `scripts/setup.mjs` utilise déjà.
 *
 * Ce que le script fait, dans l'ordre
 * -----------------------------------------------------------------------------
 *  1. assemble chaque fonction en un fichier unique (`_shared` inclus) ;
 *  2. affiche ce qu'il va envoyer (`--verifier`, aucun appel réseau) ;
 *  3. pousse les variables CinetPay comme secrets du projet ;
 *  4. crée ou met à jour chaque fonction selon qu'elle existe déjà.
 *
 * ⚠ `cinetpay-webhook` est déployé avec `verify_jwt = false` : CinetPay ne
 *   peut pas fournir de JWT Supabase. Sa sécurité vient du HMAC (x-token) et de
 *   la reconfirmation du statut auprès de l'API — pas de la passerelle.
 *
 * Usage
 *   node scripts/deploy-fonctions.mjs --verifier     # assemble, ne déploie rien
 *   node scripts/deploy-fonctions.mjs                # secrets + les deux fonctions
 *   node scripts/deploy-fonctions.mjs --sans-secrets # fonctions seules
 *   node scripts/deploy-fonctions.mjs --secrets-seulement
 *
 * Les secrets sont poussés **par défaut** : c'est le geste attendu quand on
 * colle une clé CinetPay dans `.env`. Exiger un drapeau supplémentaire ferait
 * déployer une fonction sans ses clés, et l'erreur n'apparaîtrait qu'au premier
 * paiement réel — au comptoir, devant un client.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assembler } from './lib/bundle.mjs'
import { buildConfig, parseEnvFile } from './lib/config.mjs'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Fonctions à déployer, avec leur exigence de JWT. */
const FONCTIONS = [
  { slug: 'cinetpay-init', verifyJwt: true },
  // Dit au navigateur si les clés marchandes existent (booléens seulement) :
  // sans elle, l'application ne peut pas masquer un bouton de paiement inopérant.
  { slug: 'cinetpay-status', verifyJwt: true },
  // Pas de JWT : l'appelant est CinetPay. La sécurité repose sur le HMAC.
  { slug: 'cinetpay-webhook', verifyJwt: false },
]

/** Secrets CinetPay transmis si renseignés dans `.env`; aucun secret n'est affiché. */
const SECRETS = [
  'CINETPAY_API_KEY',
  'CINETPAY_SITE_ID',
  'CINETPAY_SECRET_KEY',
  'CINETPAY_BASE_URL',
  'CINETPAY_MODE',
  'CINETPAY_NOTIFY_URL',
  'APP_ENV',
  'APP_URL',
]

const API = 'https://api.supabase.com/v1'

/**
 * Options de ligne de commande, isolées pour être testables sans lancer un
 * déploiement : la règle « secrets par défaut » mérite un test, pas une
 * relecture attentive.
 */
export function optionsDepuisArguments(argv = []) {
  const args = new Set(argv)

  return {
    verifierSeulement: args.has('--verifier') || args.has('--dry-run'),
    pousserSecrets: !args.has('--sans-secrets') || args.has('--secrets'),
    secretsSeulement: args.has('--secrets-seulement'),
  }
}

const { verifierSeulement, pousserSecrets, secretsSeulement } = optionsDepuisArguments(
  process.argv.slice(2),
)

function echec(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

async function appelApi(chemin, options, jeton) {
  const reponse = await fetch(`${API}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${jeton}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  const texte = await reponse.text()
  let corps = null
  try {
    corps = texte ? JSON.parse(texte) : null
  } catch {
    corps = texte
  }

  return { ok: reponse.ok, statut: reponse.status, corps }
}

/* -------------------------------------------------------------------------- */
/* 1. Assemblage                                                              */
/* -------------------------------------------------------------------------- */

function assemblerFonctions() {
  return FONCTIONS.map(({ slug, verifyJwt }) => {
    const entree = resolve(RACINE, 'supabase/functions', slug, 'index.ts')
    const { code, fichiers } = assembler(entree)
    return { slug, verifyJwt, entree, code, fichiers }
  })
}

/* -------------------------------------------------------------------------- */
/* 2. Secrets                                                                 */
/* -------------------------------------------------------------------------- */

export function lireSecrets(source = lireValeursEnv()) {
  const secrets = []

  for (const nom of SECRETS) {
    const valeur = source[nom]
    if (valeur === undefined || valeur === '') continue
    secrets.push({ name: nom, value: valeur })
  }

  return secrets
}

async function pousserLesSecrets(config, secrets) {
  if (secrets.length === 0) {
    console.log('• Aucun secret à pousser (variables absentes du fichier .env).')
    return
  }

  const resultat = await appelApi(
    `/projects/${config.projectRef}/secrets`,
    {
      method: 'POST',
      body: JSON.stringify(secrets.map(({ name, value }) => ({ name, value }))),
    },
    config.accessToken,
  )

  if (!resultat.ok) {
    echec(`Envoi des secrets refusé (HTTP ${resultat.statut}) : ${JSON.stringify(resultat.corps)}`)
  }

  // On n'affiche jamais les valeurs : un journal de déploiement peut fuiter.
  console.log(`✓ ${secrets.length} secret(s) poussé(s) : ${secrets.map((s) => s.name).join(', ')}`)
}

/* -------------------------------------------------------------------------- */
/* 3. Déploiement                                                             */
/* -------------------------------------------------------------------------- */

async function fonctionsExistantes(config) {
  const resultat = await appelApi(
    `/projects/${config.projectRef}/functions`,
    { method: 'GET' },
    config.accessToken,
  )

  if (!resultat.ok) {
    echec(`Liste des fonctions illisible (HTTP ${resultat.statut}) : ${JSON.stringify(resultat.corps)}`)
  }

  const liste = Array.isArray(resultat.corps) ? resultat.corps : []
  return new Set(liste.map((fonction) => fonction.slug))
}

async function deploiement(config, fonction, existe) {
  const charge = JSON.stringify({
    slug: fonction.slug,
    name: fonction.slug,
    // `body` attend le SOURCE du fichier, pas un chemin.
    body: fonction.code,
    verify_jwt: fonction.verifyJwt,
  })

  const chemin = existe
    ? `/projects/${config.projectRef}/functions/${fonction.slug}`
    : `/projects/${config.projectRef}/functions`

  const resultat = await appelApi(
    chemin,
    { method: existe ? 'PATCH' : 'POST', body: charge },
    config.accessToken,
  )

  if (!resultat.ok) {
    echec(
      `Déploiement de ${fonction.slug} refusé (HTTP ${resultat.statut}) : ${JSON.stringify(resultat.corps)}`,
    )
  }

  const version = resultat.corps?.version ?? '?'
  console.log(
    `✓ ${fonction.slug} ${existe ? 'mis à jour' : 'créé'} (version ${version}, verify_jwt=${fonction.verifyJwt})`,
  )
}

/* -------------------------------------------------------------------------- */
/* Programme                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Configuration lue depuis `.env` puis `.env.local`.
 *
 * Le second fichier l'emporte : c'est la convention de Vite, et cela permet de
 * garder un `.env` de recette versionné à la main tout en surchargeant
 * localement avec le simulateur.
 */
function lireValeursEnv() {
  const valeurs = {}

  for (const nom of ['.env', '.env.local']) {
    const chemin = resolve(RACINE, nom)
    if (existsSync(chemin)) Object.assign(valeurs, parseEnvFile(readFileSync(chemin, 'utf8')))
  }

  // Les variables d'environnement du shell priment sur les fichiers.
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (typeof valeur === 'string') valeurs[cle] = valeur
  }

  return valeurs
}

export function lireConfig() {
  return buildConfig(lireValeursEnv())
}

/**
 * Avertissements propres à un déploiement réel (pas à `--verifier`).
 *
 * Le piège : `CINETPAY_MODE=test` avec le simulateur sur `localhost` fonctionne
 * à merveille en local, puis échoue en production déployée — depuis une Edge
 * Function hébergée, `localhost` désigne la machine de Supabase. Le bouton
 * « Payer » renverrait alors une erreur réseau au lieu d'être simplement inactif.
 * Mieux vaut le dire avant d'envoyer le code que le découvrir chez un client.
 */
export function erreursPrerequisPaiement(valeurs) {
  const mode = (valeurs.CINETPAY_MODE ?? 'production').trim().toLowerCase()
  const identifiants = [
    ['CINETPAY_API_KEY', valeurs.CINETPAY_API_KEY],
    ['CINETPAY_SITE_ID', valeurs.CINETPAY_SITE_ID],
    ...(mode === 'test' ? [] : [['CINETPAY_SECRET_KEY', valeurs.CINETPAY_SECRET_KEY]]),
  ]
  const toutesLesCles = [
    valeurs.CINETPAY_API_KEY,
    valeurs.CINETPAY_SITE_ID,
    valeurs.CINETPAY_SECRET_KEY,
  ]
  const enCours = toutesLesCles.some((valeur) => Boolean(valeur?.trim()))
  if (!enCours) return []

  const erreurs = identifiants
    .filter(([, valeur]) => !valeur?.trim())
    .map(([nom]) => `${nom} manque : les identifiants requis sont incomplets.`)

  const appUrl = (valeurs.APP_URL ?? '').trim()

  if (!appUrl) {
    erreurs.push('APP_URL manque : indiquez l’adresse publique de l’application.')
  } else if (mode !== 'test') {
    try {
      const adresse = new URL(appUrl)
      if (
        adresse.protocol !== 'https:' ||
        ['localhost', '127.0.0.1', '[::1]'].includes(adresse.hostname.toLowerCase())
      ) {
        erreurs.push('APP_URL doit être une adresse HTTPS publique en mode production.')
      }
    } catch {
      erreurs.push('APP_URL doit être une adresse HTTPS valide en mode production.')
    }
  }

  return erreurs
}

export function avertissementsDeploiement(config) {
  const alertes = []
  const { mode = 'production', baseUrl } = config.cinetpay ?? {}
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(baseUrl ?? '')

  if (mode === 'test' && local) {
    alertes.push(
      'Mode test avec une adresse CinetPay locale : depuis une fonction hébergée, ' +
        'localhost désigne la machine de Supabase. Le bouton « Payer » échouera. ' +
        'Exposez le simulateur par un tunnel public, ou déployez sans identifiants CinetPay.',
    )
  } else if (mode === 'test') {
    alertes.push(
      'Mode test déployé : les paiements sont fictifs. Chaque transaction sera marquée « test ».',
    )
  }

  return alertes
}

async function principal() {
  const assemblees = assemblerFonctions()

  console.log('Fonctions assemblées :')
  for (const fonction of assemblees) {
    console.log(
      `  • ${fonction.slug} — ${(fonction.code.length / 1024).toFixed(1)} Ko, ` +
        `${fonction.fichiers.length} module(s)`,
    )
  }

  if (verifierSeulement) {
    // Écriture sur disque : on inspecte ce qui partirait, sans appel réseau.
    const dossier = resolve(RACINE, 'supabase/functions/.build')
    mkdirSync(dossier, { recursive: true })
    for (const fonction of assemblees) {
      writeFileSync(resolve(dossier, `${fonction.slug}.ts`), fonction.code)
    }
    console.log(`\n• Vérification seule : fichiers écrits dans supabase/functions/.build/`)
    console.log('  Aucun appel à l’API Supabase n’a été effectué.')
    return
  }

  const config = lireConfig()
  if (!config.accessToken) echec('SUPABASE_ACCESS_TOKEN absent du fichier .env.')
  if (!config.projectRef) echec('SUPABASE_PROJECT_REF (ou VITE_SUPABASE_URL) absent du fichier .env.')

  if (pousserSecrets) {
    const erreursPaiement = erreursPrerequisPaiement(config.raw)
    if (erreursPaiement.length > 0) {
      echec(`Configuration CinetPay incomplète :\n  • ${erreursPaiement.join('\n  • ')}`)
    }
    await pousserLesSecrets(config, lireSecrets(config.raw))
  }

  if (secretsSeulement) return

  for (const alerte of avertissementsDeploiement(config)) {
    console.warn(`⚠ ${alerte}`)
  }

  const existantes = await fonctionsExistantes(config)

  for (const fonction of assemblees) {
    await deploiement(config, fonction, existantes.has(fonction.slug))
  }

  console.log(
    `\nAdresses :\n  ${config.supabaseUrl}/functions/v1/cinetpay-init\n  ${config.supabaseUrl}/functions/v1/cinetpay-status\n  ${config.supabaseUrl}/functions/v1/cinetpay-webhook`,
  )
  console.log('\nRappel : le webhook doit être joignable publiquement pour CinetPay.')

  // Sans clés, `cinetpay-init` répond 503 et `cinetpay-status` annonce
  // `configured: false` : l'application masque alors le bouton Mobile Money.
  // Aucun paiement n'est simulé, il faut donc le dire à l'installateur.
  if (!process.env.CINETPAY_API_KEY && !lireSecrets().some((s) => s.name === 'CINETPAY_API_KEY')) {
    console.log(
      '\n• Aucune clé CinetPay installée : le bouton « Payer par Mobile Money » sera MASQUÉ.\n' +
        '  Les encaissements en espèces restent disponibles. Collez CINETPAY_API_KEY,\n' +
        '  CINETPAY_SITE_ID et CINETPAY_SECRET_KEY dans .env, puis relancez cette commande :\n' +
        '  le bouton réapparaît au rechargement suivant, rien d’autre à modifier.',
    )
  }
}

/**
 * Exécution seulement si le fichier est lancé directement.
 *
 * Sans ce garde-fou, importer le module depuis un test déclencherait un
 * déploiement réel — exactement le genre d'effet de bord qu'un test ne doit
 * jamais provoquer.
 */
const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (lanceDirectement) {
  principal().catch((erreur) => echec(erreur instanceof Error ? erreur.message : String(erreur)))
}

export { FONCTIONS, SECRETS, assemblerFonctions }
