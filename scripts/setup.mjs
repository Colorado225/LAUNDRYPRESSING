#!/usr/bin/env node
/**
 * Installation guidée — Pressing Pro
 * =============================================================================
 * Objectif : après avoir rempli `.env`, une seule commande doit laisser
 * l'application pleinement fonctionnelle.
 *
 *   npm run setup
 *
 * Ce script enchaîne :
 *   1. lecture et validation du `.env` (aucune valeur par défaut cachée) ;
 *   2. liaison du projet Supabase ;
 *   3. application des migrations SQL (001 puis 002) ;
 *   4. déploiement des deux Edge Functions (le webhook sans vérification JWT) ;
 *   5. envoi des secrets CinetPay côté serveur ;
 *   6. création du pressing et du compte propriétaire ;
 *   7. contrôle final que le schéma répond.
 *
 * Chaque étape est sautable (`--skip-db`, `--skip-functions`, `--skip-account`)
 * et le script est idempotent : le relancer ne crée pas de doublon.
 *
 * Dépendances : Node 18+ (fetch natif) et `npx` pour la CLI Supabase.
 * Aucun paquet npm n'est requis.
 *
 * Options :
 *   --check          vérifie le .env et s'arrête
 *   --dry-run        affiche les actions sans rien exécuter
 *   --skip-db        n'applique pas les migrations
 *   --skip-functions ne déploie pas les Edge Functions
 *   --skip-account   ne crée ni le pressing ni le compte
 *   --help
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig, parseEnvFile, redact, validateConfig } from './lib/config.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = join(ROOT, '.env')

const ARGS = new Set(process.argv.slice(2))
const HELP = ARGS.has('--help') || ARGS.has('-h')
const CHECK_ONLY = ARGS.has('--check')
const DRY_RUN = ARGS.has('--dry-run')
const SKIP_DB = ARGS.has('--skip-db')
const SKIP_FUNCTIONS = ARGS.has('--skip-functions')
const SKIP_ACCOUNT = ARGS.has('--skip-account')

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code) => (text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text)
const bold = paint('1')
const green = paint('32')
const yellow = paint('33')
const red = paint('31')
const dim = paint('2')
const cyan = paint('36')

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx'

/**
 * Version majeure de la CLI Supabase utilisée. Épinglée : la CLI 3 pourrait
 * changer la syntaxe de `link` ou de `functions deploy`, et l'installation
 * doit rester reproductible. `npx` télécharge la CLI au premier lancement,
 * donc aucun paquet n'est ajouté aux dépendances du projet.
 */
const SUPABASE_CLI = 'supabase@2'

/* -------------------------------------------------------------------------- */
/* Affichage                                                                   */
/* -------------------------------------------------------------------------- */

function title(text) {
  console.log(`\n${bold(cyan(`▸ ${text}`))}`)
}

function ok(text) {
  console.log(`  ${green('✓')} ${text}`)
}

function warn(text) {
  console.log(`  ${yellow('!')} ${text}`)
}

function fail(text) {
  console.log(`  ${red('✗')} ${text}`)
}

function info(text) {
  console.log(`  ${dim(text)}`)
}

function usage() {
  console.log(`
${bold('Pressing Pro — installation')}

  ${bold('npm run setup')}              tout installer à partir du fichier .env

  ${bold('--check')}                    vérifier le .env sans rien modifier
  ${bold('--dry-run')}                  afficher les actions sans les exécuter
  ${bold('--skip-db')}                  ne pas appliquer les migrations
  ${bold('--skip-functions')}           ne pas déployer les Edge Functions
  ${bold('--skip-account')}             ne pas créer le pressing ni le compte
  ${bold('--help')}                     cet écran

  Le fichier .env doit être créé à partir de .env.example.
`)
}

/* -------------------------------------------------------------------------- */
/* Exécution de commandes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Masque les valeurs sensibles d'une ligne de commande avant de l'afficher.
 * `supabase db push --password <secret>` ne doit laisser aucune trace du mot
 * de passe dans le terminal, les journaux de CI ou une capture d'écran.
 */
export function printableCommand(command, commandArgs) {
  const masked = commandArgs.map((argument, index) => {
    const previous = commandArgs[index - 1]
    if (previous === '--password' || previous === '-p') return '••••'
    return argument
  })
  return [command, ...masked].join(' ')
}

function run(command, commandArgs, extraEnv = {}) {
  const printable = printableCommand(command, commandArgs)
  console.log(`  ${dim('$')} ${printable}`)

  if (DRY_RUN) {
    info('(ignoré : --dry-run)')
    return
  }

  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })

  if (result.error) {
    throw new Error(`Impossible de lancer « ${command} » : ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`La commande « ${printable} » a échoué (code ${result.status}).`)
  }
}

/* -------------------------------------------------------------------------- */
/* Appels HTTP (API REST et Admin)                                             */
/* -------------------------------------------------------------------------- */

export async function request(url, { method = 'GET', key, body, headers = {} } = {}) {
  console.log(`  ${dim(method)} ${url}`)

  if (DRY_RUN) {
    info('(ignoré : --dry-run)')
    return { ok: true, status: 0, data: null }
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  return { ok: response.ok, status: response.status, data }
}

/* -------------------------------------------------------------------------- */
/* Étapes                                                                      */
/* -------------------------------------------------------------------------- */

function stepLink(config) {
  title('1/6 · Liaison du projet Supabase')
  ok(`Projet ${bold(config.projectRef)}`)

  // La CLI conserve la référence du projet dans supabase/.temp. On transmet
  // aussi le mot de passe de la base ici : sans lui, `link` ouvre une invite
  // interactive qui bloque une exécution non supervisée (CI, script postinstall).
  run(
    NPX,
    ['--yes', SUPABASE_CLI, 'link', '--project-ref', config.projectRef, '--password', config.dbPassword, '--yes'],
    { SUPABASE_ACCESS_TOKEN: config.accessToken },
  )
}

function stepDatabase(config) {
  title('2/6 · Application des migrations SQL')
  info('001_init.sql (schéma + RLS), puis 002_payments.sql (paiements).')

  // `--project-ref` explicite : l'étape réussit même si le lien local n'a pas
  // pu être écrit (répertoire en lecture seule, cache supprimé).
  // `--yes` évite la confirmation interactive ; `--include-all` est
  // volontairement absent, pour ne jamais rejouer une migration déjà appliquée.
  run(
    NPX,
    [
      '--yes',
      SUPABASE_CLI,
      'db',
      'push',
      '--project-ref',
      config.projectRef,
      '--password',
      config.dbPassword,
      '--yes',
    ],
    { SUPABASE_ACCESS_TOKEN: config.accessToken },
  )
  ok('Migrations appliquées')
}

function stepFunctions(config) {
  title('3/6 · Déploiement des Edge Functions')
  info('cinetpay-init exige un JWT ; cinetpay-webhook est public (signature HMAC).')

  // Sans Docker, la CLI échoue en cherchant à construire l'image localement.
  // `--use-api` délègue l'empaquetage à Supabase : indispensable sur une
  // machine de bureau où Docker n'est pas installé, cas courant.
  const docker = hasDocker()
  if (!docker) info('Docker absent : empaquetage côté Supabase (--use-api).')

  const common = ['--project-ref', config.projectRef, '--yes', ...(docker ? [] : ['--use-api'])]
  const env = { SUPABASE_ACCESS_TOKEN: config.accessToken }

  run(NPX, ['--yes', SUPABASE_CLI, 'functions', 'deploy', 'cinetpay-init', ...common], env)
  run(
    NPX,
    ['--yes', SUPABASE_CLI, 'functions', 'deploy', 'cinetpay-webhook', '--no-verify-jwt', ...common],
    env,
  )
  ok('Fonctions déployées')
}

/** `true` si le démon Docker répond (nécessaire à l'empaquetage local). */
function hasDocker() {
  if (DRY_RUN) return true
  const probe = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 })
  return probe.status === 0
}

function stepSecrets(config) {
  title('4/6 · Secrets serveur')

  const entries = Object.entries({
    CINETPAY_API_KEY: config.cinetpay.apiKey,
    CINETPAY_SITE_ID: config.cinetpay.siteId,
    CINETPAY_SECRET_KEY: config.cinetpay.secretKey,
    CINETPAY_BASE_URL: config.cinetpay.baseUrl,
    CINETPAY_NOTIFY_URL: config.cinetpay.notifyUrl,
    APP_URL: config.appUrl,
    APP_ENV: config.appEnv,
  }).filter(([, value]) => Boolean(value))

  if (entries.length === 0) {
    warn('Aucun secret à envoyer (identifiants CinetPay absents).')
    return
  }

  for (const [key, value] of entries) {
    console.log(`  ${dim('•')} ${key} = ${redact(value)}`)
  }

  // Les secrets passent par un fichier temporaire plutôt que par la ligne de
  // commande : ils n'apparaissent ainsi ni dans l'historique du shell, ni dans
  // la liste des processus de la machine.
  if (DRY_RUN) {
    info('(ignoré : --dry-run)')
    return
  }

  const secretsFile = join(tmpdir(), `pressing-pro-secrets-${process.pid}.env`)
  try {
    writeFileSync(secretsFile, entries.map(([key, value]) => `${key}=${value}`).join('\n'), {
      mode: 0o600,
    })
    run(
      NPX,
      [
        '--yes',
        SUPABASE_CLI,
        'secrets',
        'set',
        '--env-file',
        secretsFile,
        '--project-ref',
        config.projectRef,
        '--yes',
      ],
      { SUPABASE_ACCESS_TOKEN: config.accessToken },
    )
  } finally {
    if (existsSync(secretsFile)) unlinkSync(secretsFile)
  }

  ok('Secrets enregistrés côté Supabase')
}

export async function stepAccount(config) {
  title('5/6 · Pressing et compte propriétaire')

  if (!config.owner.email || !config.owner.password) {
    warn('SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD absents : étape ignorée.')
    info('Créez le compte depuis Supabase puis rattachez-le (README §3.4).')
    return null
  }

  const base = config.supabaseUrl
  const key = config.serviceRoleKey

  if (DRY_RUN) {
    info(`POST ${base}/rest/v1/tenants`)
    info(`POST ${base}/auth/v1/admin/users`)
    info(`POST ${base}/rest/v1/tenant_users`)
    info('(ignoré : --dry-run)')
    return { tenantId: '(simulé)', userId: '(simulé)' }
  }

  // --- Le pressing ---------------------------------------------------------
  const existingTenant = await request(
    `${base}/rest/v1/tenants?select=id,name&name=eq.${encodeURIComponent(config.tenant.name)}&limit=1`,
    { key },
  )

  let tenantId = Array.isArray(existingTenant.data) ? (existingTenant.data[0]?.id ?? null) : null

  if (tenantId) {
    ok(`Pressing existant réutilisé : ${tenantId}`)
  } else {
    const created = await request(`${base}/rest/v1/tenants`, {
      method: 'POST',
      key,
      body: { name: config.tenant.name, phone: config.tenant.phone },
      headers: { Prefer: 'return=representation' },
    })

    tenantId = Array.isArray(created.data) ? (created.data[0]?.id ?? null) : null

    if (!tenantId) {
      throw new Error(
        `Création du pressing impossible (HTTP ${created.status}). Vérifiez que 001_init.sql a bien été appliqué.`,
      )
    }
    ok(`Pressing créé : ${tenantId}`)
  }

  // --- Le compte -----------------------------------------------------------
  // `app_metadata` est posé dès la création : c'est ce que lit
  // `current_tenant_id()` dans la RLS, prioritairement à la table tenant_users.
  const created = await request(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    key,
    body: {
      email: config.owner.email,
      password: config.owner.password,
      email_confirm: true,
      app_metadata: { tenant_id: tenantId, tenant_role: 'owner' },
    },
  })

  let userId = created.data?.user?.id ?? created.data?.id ?? null

  if (!userId && created.status === 422) {
    // Compte déjà existant : on le retrouve pour rester idempotent. L'API
    // d'administration ne filtre pas par e-mail, on parcourt donc les pages
    // (200 comptes par page, 10 pages au maximum).
    info('Compte déjà présent, recherche de l’utilisateur existant…')
    userId = await findUserByEmail(base, key, config.owner.email)

    if (!userId) {
      throw new Error(
        `Le compte ${config.owner.email} existe déjà mais reste introuvable parmi les 2 000 premiers utilisateurs. Rattachez-le manuellement (README §3.4).`,
      )
    }
    ok(`Compte existant réutilisé : ${userId}`)
  } else if (!userId) {
    const detail = typeof created.data === 'string' ? created.data : JSON.stringify(created.data)
    throw new Error(`Création du compte impossible (HTTP ${created.status}) : ${detail}`)
  } else {
    ok(`Compte créé : ${config.owner.email}`)
  }

  // Met à jour les claims même si le compte préexistait : sans eux la RLS
  // retombe sur tenant_users, ce qui fonctionne mais reste plus fragile.
  await request(`${base}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    key,
    body: { app_metadata: { tenant_id: tenantId, tenant_role: 'owner' } },
  })

  // --- Le rattachement -----------------------------------------------------
  const membership = await request(
    `${base}/rest/v1/tenant_users?select=user_id,display_name&user_id=eq.${userId}&tenant_id=eq.${tenantId}&limit=1`,
    { key },
  )

  const ligne = Array.isArray(membership.data) ? membership.data[0] : null

  if (ligne) {
    ok('Rattachement au pressing déjà en place')

    // Nom affiché : il sert au sélecteur d'attribution des commandes.
    if (!ligne.display_name) {
      await request(`${base}/rest/v1/tenant_users?user_id=eq.${userId}&tenant_id=eq.${tenantId}`, {
        method: 'PATCH',
        key,
        body: { display_name: 'Propriétaire' },
      })
      ok('Nom affiché renseigné (Propriétaire)')
    }
  } else {
    const link = await request(`${base}/rest/v1/tenant_users`, {
      method: 'POST',
      key,
      body: {
        user_id: userId,
        tenant_id: tenantId,
        role: 'owner',
        display_name: 'Propriétaire',
      },
    })

    if (!link.ok) {
      throw new Error(`Rattachement impossible (HTTP ${link.status}).`)
    }
    ok('Compte rattaché au pressing (rôle propriétaire)')
  }

  return { tenantId, userId }
}

/** Parcourt les pages de `/auth/v1/admin/users` jusqu'à trouver l'e-mail. */
export async function findUserByEmail(base, key, email) {
  const target = email.toLowerCase()

  for (let page = 1; page <= 10; page += 1) {
    const list = await request(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, { key })
    const users = Array.isArray(list.data?.users) ? list.data.users : []
    if (users.length === 0) return null

    const match = users.find((user) => (user.email ?? '').toLowerCase() === target)
    if (match?.id) return match.id
  }

  return null
}

export async function stepVerify(config) {
  title('6/6 · Contrôle du schéma')

  if (DRY_RUN) {
    info('(ignoré : --dry-run)')
    return
  }

  // Volontairement avec la clé publique : la table doit répondre « accès
  // refusé » (42501) et non « relation inexistante » (42P01).
  const response = await fetch(`${config.supabaseUrl}/rest/v1/orders?select=id&limit=1`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
  })

  if (response.status === 200) {
    ok('La table « orders » répond (RLS active)')
    return
  }

  const payload = await response.json().catch(() => ({}))
  const code = payload?.code ?? ''

  if (code === '42501') {
    ok('La table « orders » existe et refuse l’accès anonyme (attendu)')
    return
  }

  warn(
    `Réponse inattendue du schéma (HTTP ${response.status}${code ? `, code ${code}` : ''}). Vérifiez que les migrations ont bien été appliquées.`,
  )
}

/**
 * Vérifie que le webhook déployé répond autre chose que « fonction absente ».
 *
 * Une requête GET doit être refusée (405). Un 404 signifie que le déploiement
 * n'a pas abouti — avertissement et non erreur bloquante : la propagation peut
 * prendre quelques secondes, et cette vérification ne doit pas faire échouer
 * une installation par ailleurs correcte.
 */
export async function verifyWebhook(config) {
  if (DRY_RUN) {
    info('(ignoré : --dry-run)')
    return 'skipped'
  }

  const url = `${config.supabaseUrl}/functions/v1/cinetpay-webhook`

  let status
  try {
    const response = await fetch(url, { method: 'GET' })
    status = response.status
  } catch {
    warn('Webhook injoignable : vérifiez le déploiement des Edge Functions.')
    return 'unreachable'
  }

  if (status === 404) {
    warn('Webhook absent (HTTP 404) : relancez « npm run setup --skip-db --skip-account ».')
    return 'missing'
  }

  ok(`Webhook en ligne (HTTP ${status} sur une requête GET, attendu : refus de méthode).`)
  return 'ok'
}

/* -------------------------------------------------------------------------- */
/* Programme principal                                                         */
/* -------------------------------------------------------------------------- */

function loadEnv() {
  if (!existsSync(ENV_FILE)) {
    fail('Fichier .env introuvable.')
    info('Copiez .env.example vers .env, puis renseignez les valeurs :')
    info(process.platform === 'win32' ? '  copy .env.example .env' : '  cp .env.example .env')
    process.exit(1)
  }
  return parseEnvFile(readFileSync(ENV_FILE, 'utf8'))
}

function report(config) {
  const { errors, warnings } = validateConfig(config)

  title('Vérification de la configuration')

  const shown = [
    ['VITE_SUPABASE_URL', config.supabaseUrl],
    ['VITE_SUPABASE_ANON_KEY', redact(config.anonKey)],
    ['SUPABASE_PROJECT_REF', config.projectRef],
    ['SUPABASE_ACCESS_TOKEN', redact(config.accessToken)],
    ['SUPABASE_SERVICE_ROLE_KEY', redact(config.serviceRoleKey)],
    ['APP_URL', config.appUrl],
    ['CINETPAY_SITE_ID', config.cinetpay.siteId ?? '(non configuré)'],
    ['CINETPAY_SECRET_KEY', redact(config.cinetpay.secretKey)],
    ['Compte propriétaire', config.owner.email ?? '(non configuré)'],
  ]

  for (const [key, value] of shown) {
    console.log(`  ${dim('•')} ${key.padEnd(26)} ${value || '—'}`)
  }

  for (const warning of warnings) {
    warn(`${warning.key} : ${warning.message}`)
  }
  for (const error of errors) {
    fail(`${error.key} : ${error.message}`)
  }

  return { errors, warnings }
}

async function main() {
  if (HELP) {
    usage()
    return
  }

  console.log(bold('\nPressing Pro — installation du MVP'))
  if (DRY_RUN) console.log(yellow('Mode simulation : rien ne sera exécuté.'))

  const config = buildConfig(loadEnv())
  const { errors } = report(config)

  if (errors.length > 0) {
    console.log(
      `\n${red(bold('Installation interrompue.'))} Corrigez ${errors.length} point(s) dans .env puis relancez.\n`,
    )
    process.exit(1)
  }

  if (CHECK_ONLY) {
    console.log(`\n${green(bold('Configuration valide.'))} Lancez « npm run setup » pour installer.\n`)
    return
  }

  if (!SKIP_DB || !SKIP_FUNCTIONS) {
    stepLink(config)
  }

  if (!SKIP_DB) stepDatabase(config)
  else info('Migrations ignorées (--skip-db).')

  if (!SKIP_FUNCTIONS) stepFunctions(config)
  else info('Edge Functions ignorées (--skip-functions).')

  stepSecrets(config)

  const account = SKIP_ACCOUNT ? null : await stepAccount(config)
  if (SKIP_ACCOUNT) info('Compte et pressing ignorés (--skip-account).')

  await stepVerify(config)

  if (!SKIP_FUNCTIONS) await verifyWebhook(config)

  console.log(`\n${green(bold('Installation terminée.'))}\n`)
  console.log(`  ${bold('Application')} : ${config.appUrl || 'http://localhost:5173'}`)
  if (account) {
    console.log(`  ${bold('Pressing')}    : ${account.tenantId}`)
    console.log(`  ${bold('Compte')}      : ${config.owner.email}`)
  }
  console.log(`
  ${bold('Étapes suivantes')}
  1. ${cyan('npm run dev')} — vérifier la connexion en local
  2. déployer le front (Vercel) et reporter l'URL dans APP_URL, puis relancer
     ${cyan('npm run setup')} pour mettre à jour les redirections de paiement
  3. exécuter ${cyan('supabase/tests/isolation.sql')} dans le SQL Editor
`)
}

// Importé par les tests (`scripts/setup.test.mjs`) : `main` ne doit alors pas
// s'exécuter. La comparaison porte sur le chemin réel du module.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(
      `\n${red(bold('Échec :'))} ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
}
