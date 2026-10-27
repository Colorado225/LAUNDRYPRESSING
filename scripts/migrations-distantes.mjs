#!/usr/bin/env node
/**
 * Récupération des migrations appliquées à distance — Pressing Pro
 * =============================================================================
 * Objectif : rendre au dépôt les migrations qui existent **seulement** dans
 * `supabase_migrations.schema_migrations` du projet Supabase.
 *
 *   npm run migrations:recuperer             écrit les fichiers manquants
 *   npm run migrations:recuperer -- --check  liste seulement ce qui manque
 *   npm run migrations:recuperer -- --force  réécrit un fichier déjà présent
 *
 * Pourquoi ce script plutôt qu'une copie manuelle ? Le SQL d'une migration peut
 * peser 20 Ko. Le recopier à la main (ou le faire transiter par un outil qui
 * tronque les longues réponses) casse silencieusement le contenu. Ici, chaque
 * fichier écrit est comparé à l'empreinte SHA-256 calculée **par la base** :
 * une différence de contenu est détectée et signalée, jamais ignorée.
 *
 * Le contenu écrit est le texte exact de `statements` (les instructions
 * jointes par un saut de ligne), sans en-tête ajouté — sinon l'empreinte ne
 * correspondrait plus. La traçabilité est assurée par la sortie du script et
 * par `docs/AUDIT-COURANT.md`.
 *
 * Connexion : `DATABASE_URL` (`.env` ou environnement), comme `npm run db:*`.
 * Le mot de passe n'est jamais affiché.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { chargerEnvironnement, estLocale, masquerUrl, urlPourPg } from './db.mjs'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOSSIER = join(RACINE, 'supabase', 'migrations')

const ARGS = new Set(process.argv.slice(2))
const CHECK = ARGS.has('--check') || ARGS.has('--dry-run')
const FORCE = ARGS.has('--force')
const HELP = ARGS.has('--help') || ARGS.has('-h')

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code) => (texte) => (COLOR ? `\u001b[${code}m${texte}\u001b[0m` : texte)
const bold = paint('1')
const vert = paint('32')
const jaune = paint('33')
const rouge = paint('31')
const gris = paint('2')
const cyan = paint('36')

function entete(texte) {
  console.log(`\n${bold(cyan(`▸ ${texte}`))}`)
}
const ok = (texte) => console.log(`  ${vert('✓')} ${texte}`)
const attention = (texte) => console.log(`  ${jaune('!')} ${texte}`)
const echec = (texte) => console.log(`  ${rouge('✗')} ${texte}`)
const info = (texte) => console.log(`  ${gris(texte)}`)

/**
 * Version d'une migration, telle que l'outil Supabase la nomme : tout ce qui
 * précède le premier `_` (`20261026193632_catalogue_lot1.sql` → `20261026193632`,
 * `026_client_sync_events.sql` → `026`).
 */
export function versionDuFichier(nom) {
  return nom.split('_')[0]
}

/** Versions déjà présentes dans le dépôt. */
export function versionsLocales(fichiers) {
  return new Set(fichiers.filter((nom) => nom.endsWith('.sql')).map(versionDuFichier))
}

/**
 * Nom de fichier pour une migration distante. Le nom fourni par Supabase est
 * déjà un identifiant ; on le nettoie quand même pour éviter tout caractère
 * inattendu dans un chemin de fichier.
 */
export function nomDeFichier(version, nom) {
  const propre = String(nom ?? 'migration')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return `${version}_${propre || 'migration'}.sql`
}

/** Empreinte SHA-256 d'un texte UTF-8. */
export function empreinte(texte) {
  return createHash('sha256').update(texte, 'utf8').digest('hex')
}

function usage() {
  console.log(`
${bold('Pressing Pro — récupération des migrations distantes')}

  ${bold('npm run migrations:recuperer')}            écrit les fichiers manquants
  ${bold('npm run migrations:recuperer -- --check')} liste sans écrire
  ${bold('npm run migrations:recuperer -- --force')} réécrit un fichier existant

  Lit la chaîne de connexion dans DATABASE_URL (voir .env.example).
  Chaque fichier écrit est vérifié par SHA-256 contre la base.
`)
}

const REQUETE = `
  select version,
         name,
         array_to_string(statements, E'\\n')                          as sql,
         encode(sha256(convert_to(array_to_string(statements, E'\\n'),
                                  'UTF8')), 'hex')                    as sha256
    from supabase_migrations.schema_migrations
   order by version
`

function creerClient(url) {
  return new pg.Client({
    connectionString: urlPourPg(url),
    ssl: estLocale(url) ? false : { rejectUnauthorized: true },
    application_name: 'pressing-pro-migrations',
  })
}

async function principal() {
  if (HELP) {
    usage()
    return 0
  }

  const env = chargerEnvironnement(RACINE)
  const url = (env.DATABASE_URL ?? '').trim()
  if (!url) {
    echec('DATABASE_URL est absente.')
    info('Renseignez-la dans `.env` : DATABASE_URL=postgresql://utilisateur:motdepasse@hote/base?sslmode=require')
    info('Sur un projet Supabase : Project Settings → Database → Connection string.')
    return 1
  }

  entete('Comparaison dépôt ↔ base distante')
  info(`Base : ${masquerUrl(url)}`)

  if (!existsSync(DOSSIER)) {
    echec(`Dossier introuvable : ${DOSSIER}`)
    return 1
  }

  const fichiers = readdirSync(DOSSIER)
  const locales = versionsLocales(fichiers)

  const client = creerClient(url)
  try {
    await client.connect()
  } catch {
    echec('Connexion impossible.')
    info('Vérifiez DATABASE_URL, le réseau et que la base accepte les connexions.')
    return 1
  }

  let distantes
  try {
    const { rows } = await client.query(REQUETE)
    distantes = rows
  } finally {
    await client.end()
  }

  const manquantes = distantes.filter((m) => !locales.has(m.version))
  ok(`${distantes.length} migrations en base, ${locales.size} fichiers dans le dépôt`)

  if (manquantes.length === 0) {
    entete('Aucune dérive')
    console.log('  Le dépôt contient toutes les migrations appliquées.\n')
    return 0
  }

  entete(`${CHECK ? 'Migrations manquantes' : 'Récupération'} (${manquantes.length})`)

  let ecrites = 0
  let erreurs = 0

  for (const migration of manquantes) {
    const nom = nomDeFichier(migration.version, migration.name)
    const chemin = join(DOSSIER, nom)
    const existe = existsSync(chemin)
    const taille = Buffer.byteLength(migration.sql ?? '', 'utf8')

    if (existe && !FORCE) {
      attention(`${nom} — déjà présent, conservé (--force pour réécrire)`)
      continue
    }

    if (CHECK) {
      console.log(`  ${gris('·')} ${nom} — ${taille} octets, sha256 ${migration.sha256.slice(0, 16)}…`)
      continue
    }

    writeFileSync(chemin, migration.sql ?? '', 'utf8')
    const ecrit = readFileSync(chemin, 'utf8')
    const shaEcrit = empreinte(ecrit)

    if (shaEcrit !== migration.sha256) {
      echec(`${nom} — empreinte différente (attendu ${migration.sha256}, obtenu ${shaEcrit})`)
      erreurs += 1
      continue
    }

    ok(`${nom} — ${taille} octets, sha256 vérifié`)
    ecrites += 1
  }

  if (CHECK) {
    info('Aucun fichier écrit (--check). Relancez sans option pour les créer.')
    console.log()
    return 0
  }

  entete('Bilan')
  if (erreurs === 0) {
    console.log(`  ${ecrites} fichier(s) écrit(s) et vérifié(s).\n`)
    console.log('  Contrôlez le contenu avant de committer : le dépôt et la base')
    console.log('  redeviennent alors alignés.\n')
    return 0
  }

  echec(`${erreurs} fichier(s) non conformes — relisez-les avant de committer.`)
  console.log()
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal()
    .then((code) => {
      process.exitCode = code
    })
    .catch((erreur) => {
      echec(erreur instanceof Error ? erreur.message : String(erreur))
      process.exitCode = 1
    })
}
