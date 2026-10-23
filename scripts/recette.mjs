#!/usr/bin/env node
/**
 * Recette technique — Pressing Pro
 * =============================================================================
 * Vérifie, sur un projet Supabase **réel et configuré**, que l'installation est
 * conforme : schéma complet, RLS réellement active, formules présentes,
 * supervision verrouillée, Edge Functions déployées.
 *
 *   npm run recette
 *
 * Ce script ne remplace PAS la recette fonctionnelle (parcours client dans le
 * navigateur) : il contrôle ce qu'une machine peut contrôler sans navigateur.
 * La marche à suivre complète est dans `docs/RECETTE-SUPABASE.md`.
 *
 * Caractère **strictement en lecture** : aucune écriture, aucun INSERT, aucun
 * UPDATE. Il peut donc être lancé sur le projet d'un client sans risque.
 *
 * Sortie : un bilan en français, code 0 si tout passe, 1 sinon.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig, parseEnvFile, validateConfig } from './lib/config.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE = resolve(ICI, '..')
const ENV_FILE = join(RACINE, '.env')

/** Tables attendues après application des migrations `001` à `007`. */
export const TABLES_ATTENDUES = [
  'tenants',
  'tenant_users',
  'orders',
  'order_items',
  'order_status_history',
  'payment_transactions',
  'catalog_entries',
  'cash_sessions',
  'order_price_history',
  'order_issues',
  'payment_refunds',
  'customers',
  'suppliers',
  'stock_items',
  'stock_movements',
  'expenses',
  'plans',
  'subscriptions',
  'platform_admins',
  'support_requests',
]

/** Nombre de formules attendues au premier lancement de `007`. */
export const FORMULES_ATTENDUES = 3

function entetes(config, cle) {
  const jeton = cle === 'service' ? config.serviceRoleKey : config.anonKey
  return { apikey: jeton, Authorization: `Bearer ${jeton}` }
}

async function lireJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/** Tableau de contrôles, construit à partir de la configuration. */
export function construireControles(config) {
  const base = config.supabaseUrl

  return [
    {
      id: 'api',
      libelle: 'API REST joignable',
      indice: 'Vérifiez VITE_SUPABASE_URL et l’état du projet.',
      async executer(fetchImpl) {
        const reponse = await fetchImpl(`${base}/rest/v1/`, { headers: entetes(config, 'anon') })
        return {
          ok: reponse.status === 200,
          detail: `HTTP ${reponse.status}`,
        }
      },
    },
    {
      id: 'rls-orders',
      libelle: 'Table « orders » : accès anonyme refusé (RLS)',
      indice:
        'Si la table répond 200 avec des lignes, la RLS est désactivée : arrêtez la mise en production.',
      async executer(fetchImpl) {
        const reponse = await fetchImpl(`${base}/rest/v1/orders?select=id&limit=1`, {
          headers: entetes(config, 'anon'),
        })
        const corps = await lireJson(reponse)
        const code = corps?.code ?? ''
        const refuse = reponse.status === 401 || reponse.status === 403 || code === '42501'
        return {
          ok: refuse,
          detail: `HTTP ${reponse.status}${code ? ` · ${code}` : ''}`,
        }
      },
    },
    {
      id: 'tables',
      libelle: 'Schéma complet (20 tables, migrations 001 → 007)',
      indice: 'Appliquez les migrations manquantes : « npx supabase db push ».',
      async executer(fetchImpl) {
        const manquantes = []

        for (const table of TABLES_ATTENDUES) {
          const reponse = await fetchImpl(`${base}/rest/v1/${table}?select=*&limit=1`, {
            headers: entetes(config, 'service'),
          })
          const corps = await lireJson(reponse)
          const code = corps?.code ?? ''

          // 42P01 = relation inexistante. Toute autre réponse prouve que la
          // table existe (les droits, eux, sont vérifiés par d'autres contrôles).
          if (reponse.status === 404 || code === '42P01') manquantes.push(table)
        }

        return {
          ok: manquantes.length === 0,
          detail:
            manquantes.length === 0
              ? `${TABLES_ATTENDUES.length} tables présentes`
              : `manquantes : ${manquantes.join(', ')}`,
        }
      },
    },
    {
      id: 'plans',
      libelle: `Formules commerciales (${FORMULES_ATTENDUES} attendues)`,
      indice: 'La migration 007_palier4.sql n’a pas été appliquée, ou ses données ont été purgées.',
      async executer(fetchImpl) {
        const reponse = await fetchImpl(`${base}/rest/v1/plans?select=code&is_active=eq.true`, {
          headers: entetes(config, 'service'),
        })
        const corps = await lireJson(reponse)
        const lignes = Array.isArray(corps) ? corps : []
        return {
          ok: lignes.length >= FORMULES_ATTENDUES,
          detail: `${lignes.length} formule(s) active(s)`,
        }
      },
    },
    {
      id: 'rpc-abonnement',
      libelle: 'Fonction « my_subscription » déployée',
      indice: 'La fonction est absente (HTTP 404) : vérifiez l’application de la migration 007.',
      async executer(fetchImpl) {
        const reponse = await fetchImpl(`${base}/rest/v1/rpc/my_subscription`, {
          method: 'POST',
          headers: { ...entetes(config, 'anon'), 'Content-Type': 'application/json' },
          body: '{}',
        })
        // Sans session, l'appel doit être refusé : ce qui compte ici est
        // l'absence de 404 (fonction inconnue).
        return {
          ok: reponse.status !== 404,
          detail: `HTTP ${reponse.status}`,
        }
      },
    },
    {
      id: 'supervision-verrouillee',
      libelle: 'Table « platform_admins » inaccessible au public',
      indice:
        'Une lecture réussie avec la clé publique signifie que la liste des éditeurs est exposée : à corriger immédiatement.',
      async executer(fetchImpl) {
        const reponse = await fetchImpl(`${base}/rest/v1/platform_admins?select=user_id&limit=1`, {
          headers: entetes(config, 'anon'),
        })
        const corps = await lireJson(reponse)
        const code = corps?.code ?? ''
        const refuse = reponse.status === 401 || reponse.status === 403 || code === '42501'
        return {
          ok: refuse,
          detail: `HTTP ${reponse.status}${code ? ` · ${code}` : ''}`,
        }
      },
    },
    {
      id: 'webhook',
      libelle: 'Webhook CinetPay déployé',
      indice: 'Déployez les Edge Functions : « npm run setup --skip-db --skip-account ».',
      async executer(fetchImpl) {
        const reponse = await fetchImpl(`${base}/functions/v1/cinetpay-webhook`, { method: 'GET' })
        return {
          ok: reponse.status !== 404,
          detail: `HTTP ${reponse.status}`,
        }
      },
    },
  ]
}

/**
 * Exécute les contrôles dans l'ordre et renvoie les résultats.
 *
 * `fetchImpl` est injectable pour les tests : la recette elle-même ne doit
 * toucher aucun réseau dans la suite automatisée.
 */
export async function executerRecette(config, fetchImpl = fetch) {
  const resultats = []

  for (const controle of construireControles(config)) {
    try {
      const { ok, detail } = await controle.executer(fetchImpl)
      resultats.push({ id: controle.id, libelle: controle.libelle, ok, detail, indice: controle.indice })
    } catch (erreur) {
      resultats.push({
        id: controle.id,
        libelle: controle.libelle,
        ok: false,
        detail: `erreur réseau : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        indice: controle.indice,
      })
    }
  }

  return resultats
}

/** Phrase de bilan, sans dépendre de la console. */
export function resume(resultats) {
  const reussis = resultats.filter((resultat) => resultat.ok).length
  return `${reussis}/${resultats.length} contrôle(s) réussi(s)`
}

/* -------------------------------------------------------------------------- */
/* Programme principal                                                         */
/* -------------------------------------------------------------------------- */

function chargerConfig() {
  if (!existsSync(ENV_FILE)) {
    console.error('✗ Fichier .env introuvable. Copiez .env.example puis renseignez-le.')
    process.exit(1)
  }

  const config = buildConfig(parseEnvFile(readFileSync(ENV_FILE, 'utf8')))
  const { errors } = validateConfig(config)

  if (errors.length > 0) {
    console.error('✗ Configuration incomplète :')
    for (const erreur of errors) console.error(`  - ${erreur}`)
    process.exit(1)
  }

  return config
}

async function principal() {
  const config = chargerConfig()

  console.log('Recette technique — Pressing Pro')
  console.log(`Projet : ${config.supabaseUrl}`)
  console.log('Contrôles en lecture seule (aucune écriture).\n')

  const resultats = await executerRecette(config)

  for (const resultat of resultats) {
    const marque = resultat.ok ? '✓' : '✗'
    console.log(`${marque} ${resultat.libelle} — ${resultat.detail}`)
    if (!resultat.ok) console.log(`  → ${resultat.indice}`)
  }

  console.log(`\n${resume(resultats)}`)
  console.log('La recette fonctionnelle (parcours navigateur) reste à faire : docs/RECETTE-SUPABASE.md')

  process.exit(resultats.every((resultat) => resultat.ok) ? 0 : 1)
}

// Exécution directe uniquement : les tests importent le module.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await principal()
}
