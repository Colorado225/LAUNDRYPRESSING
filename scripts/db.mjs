#!/usr/bin/env node
/**
 * Branchement PostgreSQL géré (Neon ou tout autre PostgreSQL 15+) — Pressing Pro
 * =============================================================================
 * L'application parle à Supabase (PostgREST + Auth + RLS + Edge Functions). Ce
 * script sert à ce que le **schéma** du projet puisse aussi vivre et être
 * vérifié sur une base PostgreSQL gérée, sans compte Supabase :
 *
 *   npm run db:etat       lecture seule : version, tables, RLS, migrations
 *   npm run db:push       applique le socle + les migrations + le jeu de démo
 *   npm run db:verifier   rejoue les tests SQL (RLS, rôles, paliers 1 à 4)
 *
 * La chaîne de connexion est lue dans `DATABASE_URL` (`.env` ou variables
 * d'environnement). Elle n'est **jamais** écrite dans un fichier suivi par Git,
 * jamais affichée en clair, et jamais exposée au navigateur : voir
 * `docs/NEON.md` pour la raison (un navigateur ne peut pas garder un secret
 * d'administration de base).
 *
 * Options :
 *   --dry-run   affiche le plan sans rien écrire
 *   --force     passe outre l'avertissement « base déjà initialisée »
 *
 * Sortie : bilan en français, code 0 si tout va bien, 1 sinon.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { parseEnvFile } from './lib/config.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE = resolve(ICI, '..')

/**
 * Fichiers appliqués dans cet ordre.
 *
 * `00_bootstrap.sql` recrée ce que Supabase fournit d'office (rôles `anon`,
 * `authenticated`, `service_role`, schéma `auth`, `auth.uid()`). Il est idempotent
 * et sans danger sur une base déjà initialisée ; il est en revanche **inutile**
 * sur un vrai projet Supabase, où `db:push` n'a pas à être lancé.
 */
export const FICHIERS_SCHEMA = [
  'supabase/tests/local/00_bootstrap.sql',
  'supabase/migrations/001_init.sql',
  'supabase/migrations/002_payments.sql',
  'supabase/migrations/003_palier1.sql',
  'supabase/migrations/004_palier2.sql',
  'supabase/migrations/005_palier2_complement.sql',
  'supabase/migrations/006_palier3.sql',
  'supabase/migrations/007_palier4.sql',
  'supabase/migrations/008_inscription.sql',
  'supabase/migrations/009_audit.sql',
  'supabase/seed.sql',
]

/** Tests SQL rejoués par `db:verifier`, après le schéma. */
export const FICHIERS_TESTS = [
  'supabase/tests/isolation.sql',
  'supabase/tests/palier1.sql',
  'supabase/tests/palier2.sql',
  'supabase/tests/palier2_complement.sql',
  'supabase/tests/palier3.sql',
  'supabase/tests/palier4.sql',
  'supabase/tests/roles.sql',
  'supabase/tests/inscription.sql',
  'supabase/tests/audit.sql',
]

/** Table de suivi : une ligne par fichier déjà appliqué. */
export const TABLE_SUIVI = '_pressing_migrations'

/**
 * Masque le mot de passe d'une URL de connexion avant tout affichage.
 * `postgresql://user:secret@hote/base` → `postgresql://user:***@hote/base`
 */
export function masquerUrl(url) {
  if (!url) return ''
  return url.replace(/(:\/\/[^:/@]+):[^@]*@/, '$1:***@')
}

/**
 * La base est-elle locale ? Décide du TLS.
 *
 * Neon impose TLS ; un PostgreSQL de développement sur `localhost` n'en a
 * souvent pas. On se fie à l'hôte plutôt qu'à `sslmode`, que `pg` interprète
 * différemment de `libpq`.
 */
export function estLocale(url) {
  try {
    const hote = new URL(url).hostname
    return hote === 'localhost' || hote === '127.0.0.1' || hote === '' || hote === '::1'
  } catch {
    // URL sans hôte (socket Unix, `?host=/var/run/postgresql`) : local.
    return true
  }
}

/**
 * Nettoie l'URL pour `pg` : on retire les paramètres que le pilote Node gère
 * lui-même (`sslmode`, `channel_binding`) afin d'éviter un double réglage.
 *
 * `channel_binding=require` est propre à `libpq`. Le pilote `pg` négocie SCRAM
 * sans liaison de canal : laisser le paramètre ne change rien, mais le retirer
 * évite un avertissement trompeur.
 */
export function urlPourPg(url) {
  if (!url) return ''
  try {
    const propre = new URL(url)
    propre.searchParams.delete('sslmode')
    propre.searchParams.delete('channel_binding')
    return propre.toString()
  } catch {
    return url
  }
}

/**
 * Ce qu'il reste à appliquer, d'après les fichiers déjà enregistrés dans la
 * table de suivi. Pure : testable sans base.
 */
export function planDePush(dejaAppliques, fichiers = FICHIERS_SCHEMA) {
  const deja = new Set(dejaAppliques)
  return {
    aAppliquer: fichiers.filter((fichier) => !deja.has(fichier)),
    deja: fichiers.filter((fichier) => deja.has(fichier)),
  }
}

/** Compte les contrôles réussis dans les NOTICE émises par les tests SQL. */
export function compterControles(notices) {
  return notices.filter((texte) => /^OK\b/.test(texte.trim())).length
}

/** Lit `.env` puis laisse la priorité aux variables d'environnement. */
export function chargerEnvironnement(racine = RACINE, env = process.env) {
  const fichiers = {}
  if (existsSync(join(racine, '.env'))) {
    Object.assign(fichiers, parseEnvFile(readFileSync(join(racine, '.env'), 'utf8')))
  }
  return { ...fichiers, ...env }
}

function creerClient(url) {
  return new pg.Client({
    connectionString: urlPourPg(url),
    ssl: estLocale(url) ? false : { rejectUnauthorized: true },
    application_name: 'pressing-pro-db',
  })
}

/** Erreur de configuration, message actionnable en français. */
function exigerUrl(env) {
  const url = (env.DATABASE_URL ?? '').trim()
  if (!url) {
    throw new Error(
      'DATABASE_URL est absente. Renseignez-la dans `.env` (voir `.env.example`),\n' +
        '  par exemple : DATABASE_URL=postgresql://utilisateur:motdepasse@hote/base?sslmode=require',
    )
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error('DATABASE_URL doit commencer par `postgresql://` ou `postgres://`.')
  }
  return url
}

/** Crée la table de suivi si besoin (jamais en simulation). */
async function creerSuivi(client) {
  await client.query(
    `create table if not exists ${TABLE_SUIVI} (
       fichier     text primary key,
       applique_le timestamptz not null default now()
     )`,
  )
}

/** Applique un fichier SQL dans une transaction : tout ou rien. */
async function appliquerFichier(client, fichier) {
  const contenu = readFileSync(join(RACINE, fichier), 'utf8')
  await client.query('begin')
  try {
    await client.query(contenu)
    await client.query(
      `insert into ${TABLE_SUIVI} (fichier) values ($1) on conflict (fichier) do nothing`,
      [fichier],
    )
    await client.query('commit')
  } catch (erreur) {
    await client.query('rollback').catch(() => {})
    throw new Error(`${fichier} : ${erreur.message}`)
  }
}

/** Liste les fichiers déjà appliqués, ou un tableau vide si la table n'existe pas. */
async function lireSuivi(client) {
  const { rows } = await client.query(
    "select to_regclass($1) is not null as existe",
    [`public.${TABLE_SUIVI}`],
  )
  if (!rows[0]?.existe) return []
  const resultat = await client.query(`select fichier from ${TABLE_SUIVI} order by fichier`)
  return resultat.rows.map((ligne) => ligne.fichier)
}

async function commandeEtat(client, url) {
  const { rows } = await client.query(
    `select current_database() as base, current_user as utilisateur,
            current_setting('server_version') as version,
            (select count(*) from pg_tables
              where schemaname = 'public' and tablename <> $1) as tables,
            (select count(*) from pg_policies where schemaname = 'public') as politiques,
            (select count(*) from pg_tables
              where schemaname = 'public' and not rowsecurity and tablename <> $1) as sans_rls`,
    [TABLE_SUIVI],
  )
  // Les agrégats `count(*)` reviennent en `bigint`, donc en chaîne : on
  // convertit avant toute comparaison, sinon `'0' === 0` est faux.
  const inventaire = {
    ...rows[0],
    tables: Number(rows[0].tables),
    politiques: Number(rows[0].politiques),
    sans_rls: Number(rows[0].sans_rls),
  }

  console.log(`Base        : ${inventaire.base} (${masquerUrl(url)})`)
  console.log(`Serveur     : PostgreSQL ${inventaire.version} · rôle ${inventaire.utilisateur}`)
  console.log(`Tables      : ${inventaire.tables} dans le schéma public`)
  console.log(`Politiques  : ${inventaire.politiques} règles RLS`)
  console.log(`Sans RLS    : ${inventaire.sans_rls} table(s)`)

  const suivi = await lireSuivi(client)
  const { aAppliquer, deja } = planDePush(suivi)
  console.log(`Migrations  : ${deja.length}/${FICHIERS_SCHEMA.length} appliquée(s) par ce script`)

  if (inventaire.sans_rls > 0) {
    const { rows: nues } = await client.query(
      `select tablename from pg_tables
        where schemaname = 'public' and not rowsecurity and tablename <> $1
        order by tablename`,
      [TABLE_SUIVI],
    )
    console.log(`  ⚠ ${nues.map((ligne) => ligne.tablename).join(', ')}`)
  }

  if (aAppliquer.length > 0) {
    console.log('À appliquer :')
    for (const fichier of aAppliquer) console.log(`  · ${fichier}`)
    if (FICHIERS_SCHEMA.includes('supabase/seed.sql')) {
      console.log(
        '  (le jeu de démonstration `seed.sql` est inclus : ne pas le pousser sur une base de production)',
      )
    }
  } else {
    console.log('Rien à appliquer : le schéma est à jour selon la table de suivi.')
  }

  return inventaire.sans_rls === 0
}

async function commandePush(client, url, { dryRun, force }) {
  const suivi = await lireSuivi(client)
  const { aAppliquer } = planDePush(suivi)

  if (aAppliquer.length === 0) {
    console.log('Schéma déjà à jour : aucun fichier à appliquer.')
    return true
  }

  // Garde-fou : une base qui contient déjà `orders` sans table de suivi a été
  // initialisée par un autre outil (Supabase CLI, psql…). Rejouer `001` y
  // échouerait au milieu, après avoir peut-être modifié autre chose.
  const { rows } = await client.query("select to_regclass('public.orders') is not null as existe")
  if (rows[0]?.existe && suivi.length === 0 && !force) {
    console.log(
      'Base déjà initialisée (table `orders` présente) sans table de suivi.\n' +
        'Rien n\'est appliqué. Utilisez `npm run db:etat` pour l\'inventaire,\n' +
        'ou `--force` si vous acceptez de rejouer les migrations idempotentes.',
    )
    return false
  }

  if (!dryRun) await creerSuivi(client)

  console.log(`Cible : ${masquerUrl(url)}`)
  for (const fichier of aAppliquer) {
    if (dryRun) {
      console.log(`  · ${fichier} (simulation)`)
      continue
    }
    await appliquerFichier(client, fichier)
    console.log(`  ✓ ${fichier}`)
  }

  if (dryRun) {
    console.log(`Simulation : ${aAppliquer.length} fichier(s) seraient appliqués.`)
  } else {
    console.log(`✓ ${aAppliquer.length} fichier(s) appliqué(s).`)
  }
  return true
}

async function commandeVerifier(client) {
  let controles = 0
  let echecs = 0
  const notices = []
  client.on('notice', (notice) => notices.push(notice.message ?? ''))

  for (const fichier of FICHIERS_TESTS) {
    const avant = notices.length
    try {
      await client.query('begin')
      await client.query(readFileSync(join(RACINE, fichier), 'utf8'))
      await client.query('rollback')
      const nombre = compterControles(notices.slice(avant))
      controles += nombre
      console.log(`  ✓ ${fichier} (${nombre} contrôle(s))`)
    } catch (erreur) {
      await client.query('rollback').catch(() => {})
      echecs += 1
      console.log(`  ✗ ${fichier}`)
      console.log(`    ${erreur.message.split('\n')[0]}`)
    }
  }

  if (echecs > 0) {
    console.log(`✗ ${echecs} fichier(s) de tests en échec.`)
    return false
  }
  console.log(`✓ ${controles} contrôles SQL réussis sur ${FICHIERS_TESTS.length} fichiers.`)
  return true
}

async function principal(argv) {
  const dryRun = argv.includes('--dry-run')
  const force = argv.includes('--force')
  const commande = argv.find((argument) => !argument.startsWith('-')) ?? 'etat'

  const env = chargerEnvironnement()
  const url = exigerUrl(env)

  console.log(`Cible : ${masquerUrl(url)}\n`)

  const client = creerClient(url)
  try {
    await client.connect()
  } catch (erreur) {
    console.error(`✗ Connexion impossible à ${masquerUrl(url)}`)
    console.error(`  ${erreur.message}`)
    console.error('  Vérifiez DATABASE_URL, le réseau et que la base accepte les connexions.')
    return 1
  }

  try {
    switch (commande) {
      case 'etat':
        return (await commandeEtat(client, url)) ? 0 : 1
      case 'push':
        return (await commandePush(client, url, { dryRun, force })) ? 0 : 1
      case 'verifier':
        return (await commandeVerifier(client)) ? 0 : 1
      default:
        console.error(`Commande inconnue : ${commande}. Attendu : etat, push, verifier.`)
        return 1
    }
  } catch (erreur) {
    console.error(`✗ ${erreur.message}`)
    return 1
  } finally {
    await client.end().catch(() => {})
  }
}

// Exécution directe seulement : les tests importent les fonctions pures.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await principal(process.argv.slice(2))
  process.exit(code)
}
