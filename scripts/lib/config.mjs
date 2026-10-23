/**
 * Lecture et validation du fichier `.env` — logique pure, sans effet de bord.
 *
 * Séparée du script d'installation pour être testable : `scripts/setup.mjs`
 * ne contient que l'orchestration (CLI Supabase, appels HTTP).
 *
 * Pourquoi un analyseur maison plutôt que `dotenv` ? Le projet n'a que
 * quinze dépendances d'exécution et aucune ne sert au build : ajouter un paquet
 * pour lire quinze lignes de `clé=valeur` n'est pas justifié, d'autant que
 * `dotenv` charge `.env` dans `process.env` alors qu'ici on veut seulement
 * *lire* les valeurs, en distinguant ce qui est public de ce qui est secret.
 */

/** Préfixe des variables embarquées dans le bundle du navigateur. */
export const PUBLIC_PREFIX = 'VITE_'

/**
 * Analyse un contenu `.env`.
 *
 * Gère : commentaires, lignes vides, guillemets simples ou doubles, et
 * `export` en début de ligne (habitude des shells). Les valeurs ne sont jamais
 * interpolées : un `$` dans une clé CinetPay doit rester littéral.
 */
export function parseEnvFile(content) {
  const values = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).replace(/^export\s+/, '').trim()
    let value = line.slice(separator + 1).trim()

    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)

    if (quoted) value = value.slice(1, -1)

    if (key) values[key] = value
  }

  return values
}

/**
 * Extrait la référence de projet d'une URL Supabase.
 * `https://abcdefghij.supabase.co` → `abcdefghij`
 */
export function extractProjectRef(url) {
  const match = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i.exec((url ?? '').trim())
  return match ? (match[1] ?? '').toLowerCase() : null
}

/**
 * Valeurs d'exemple de `.env.example`.
 *
 * Sans ce garde-fou, recopier le fichier sans le modifier produit une
 * configuration qui *paraît* valide (jeton `sbp_…`, clé assez longue) et
 * n'échoue qu'au milieu du déploiement, avec un message d'API incompréhensible.
 */
const PLACEHOLDER_PATTERN = /remplacez[-_ ]?moi|exemple|votre[-_]projet|abcdefghijklmnop/i

/** `true` si la valeur n'a pas été personnalisée. */
export function isPlaceholder(value) {
  return PLACEHOLDER_PATTERN.test(value ?? '')
}

/** `true` si la valeur ressemble à une URL absolue. */
export function isAbsoluteUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Construit la configuration complète à partir des valeurs brutes.
 *
 * Rien n'est validé ici : `validateConfig` s'en charge, ce qui permet de
 * présenter **toutes** les erreurs d'un coup plutôt qu'une par exécution.
 */
export function buildConfig(values) {
  const read = (key) => (values[key] ?? '').trim()
  const optional = (key) => {
    const value = read(key)
    return value.length > 0 ? value : null
  }

  const projectRef = read('SUPABASE_PROJECT_REF') || extractProjectRef(read('VITE_SUPABASE_URL'))
  const supabaseUrl =
    read('VITE_SUPABASE_URL') || (projectRef ? `https://${projectRef}.supabase.co` : '')

  const notifyUrl =
    optional('CINETPAY_NOTIFY_URL') ||
    (projectRef ? `https://${projectRef}.supabase.co/functions/v1/cinetpay-webhook` : null)

  return {
    projectRef,
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    anonKey: read('VITE_SUPABASE_ANON_KEY'),

    accessToken: read('SUPABASE_ACCESS_TOKEN'),
    dbPassword: read('SUPABASE_DB_PASSWORD'),
    serviceRoleKey: read('SUPABASE_SERVICE_ROLE_KEY'),

    appUrl: read('APP_URL').replace(/\/+$/, ''),

    /**
     * Environnement des Edge Functions. `production` par défaut : en cas
     * d'oubli, le webhook refuse les notifications non signées au lieu de les
     * accepter silencieusement.
     */
    appEnv: (read('APP_ENV') || 'production').toLowerCase(),

    cinetpay: {
      apiKey: optional('CINETPAY_API_KEY'),
      siteId: optional('CINETPAY_SITE_ID'),
      secretKey: optional('CINETPAY_SECRET_KEY'),
      baseUrl: optional('CINETPAY_BASE_URL'),
      notifyUrl,
    },

    owner: {
      email: optional('SEED_OWNER_EMAIL'),
      password: optional('SEED_OWNER_PASSWORD'),
    },
    tenant: {
      name: optional('SEED_TENANT_NAME') || 'Mon pressing',
      phone: optional('SEED_TENANT_PHONE'),
    },

    /** Valeurs brutes conservées pour les diagnostics. */
    raw: values,
  }
}

/**
 * Valide la configuration.
 *
 * `errors` bloque l'installation ; `warnings` laisse continuer en signalant
 * une fonctionnalité dégradée (paiement sans identifiants CinetPay, par
 * exemple).
 */
export function validateConfig(config) {
  const errors = []
  const warnings = []

  // --- Indispensable au navigateur -----------------------------------------
  if (!config.supabaseUrl) {
    errors.push({
      key: 'VITE_SUPABASE_URL',
      message: 'URL du projet Supabase absente (ex. https://abcdefghij.supabase.co).',
    })
  } else if (!isAbsoluteUrl(config.supabaseUrl)) {
    errors.push({
      key: 'VITE_SUPABASE_URL',
      message: `« ${config.supabaseUrl} » n'est pas une URL valide.`,
    })
  } else if (!extractProjectRef(config.supabaseUrl)) {
    warnings.push({
      key: 'VITE_SUPABASE_URL',
      message:
        "L'URL ne ressemble pas à un projet Supabase standard (*.supabase.co) : vérifiez que ce n'est pas l'URL du tableau de bord.",
    })
  }

  if (!config.anonKey) {
    errors.push({ key: 'VITE_SUPABASE_ANON_KEY', message: 'Clé publique (anon) absente.' })
  } else if (config.anonKey.length < 20) {
    errors.push({
      key: 'VITE_SUPABASE_ANON_KEY',
      message: 'Clé publique trop courte : la valeur semble tronquée.',
    })
  }

  // --- Provisioning du serveur ---------------------------------------------
  if (!config.projectRef) {
    errors.push({
      key: 'SUPABASE_PROJECT_REF',
      message:
        "Référence du projet introuvable. Elle se lit dans l'URL du tableau de bord (https://supabase.com/dashboard/project/<ref>) ; elle est normalement déduite de VITE_SUPABASE_URL.",
    })
  }

  if (!config.accessToken) {
    errors.push({
      key: 'SUPABASE_ACCESS_TOKEN',
      message:
        'Jeton personnel Supabase absent (Account → Access Tokens → Generate new token, commence par « sbp_ »).',
    })
  } else if (!config.accessToken.startsWith('sbp_')) {
    warnings.push({
      key: 'SUPABASE_ACCESS_TOKEN',
      message: 'Le jeton ne commence pas par « sbp_ » : vérifiez qu’il s’agit bien d’un access token et non de la clé anon.',
    })
  }

  if (!config.dbPassword) {
    errors.push({
      key: 'SUPABASE_DB_PASSWORD',
      message:
        'Mot de passe de la base absent (Project Settings → Database → Database password).',
    })
  }

  if (!config.serviceRoleKey) {
    errors.push({
      key: 'SUPABASE_SERVICE_ROLE_KEY',
      message:
        'Clé service_role absente : elle sert à créer le compte propriétaire (Project Settings → API).',
    })
  }

  if (!config.appUrl) {
    warnings.push({
      key: 'APP_URL',
      message:
        "URL publique absente : après paiement, le client sera redirigé vers l'URL d'origine de la requête.",
    })
  } else if (!isAbsoluteUrl(config.appUrl)) {
    errors.push({ key: 'APP_URL', message: `« ${config.appUrl} » n'est pas une URL valide.` })
  } else if (!config.appUrl.startsWith('https://') && !config.appUrl.includes('localhost')) {
    warnings.push({
      key: 'APP_URL',
      message: 'Adresse en http:// : CinetPay et les service workers exigent HTTPS en production.',
    })
  }

  // --- Environnement --------------------------------------------------------
  if (!['production', 'development'].includes(config.appEnv)) {
    errors.push({
      key: 'APP_ENV',
      message: 'Valeur attendue : « production » ou « development ».',
    })
  }

  // --- Paiement (facultatif) -----------------------------------------------
  if (!config.cinetpay.apiKey || !config.cinetpay.siteId) {
    warnings.push({
      key: 'CINETPAY_API_KEY',
      message:
        'Identifiants CinetPay absents : les commandes fonctionneront, mais le bouton « Payer par Mobile Money » restera inopérant.',
    })
  }
  if (config.cinetpay.apiKey && !config.cinetpay.secretKey) {
    if (config.appEnv === 'production') {
      // Refus bloquant : le webhook rejetterait de toute façon les
      // notifications (503), donc aucun paiement n'aboutirait.
      errors.push({
        key: 'CINETPAY_SECRET_KEY',
        message:
          'Clé secrète CinetPay requise en production : sans elle, le webhook refuse toutes les notifications (passez APP_ENV=development pour un test local).',
      })
    } else {
      warnings.push({
        key: 'CINETPAY_SECRET_KEY',
        message:
          'Clé secrète absente : en développement, le webhook valide uniquement par l’API CinetPay (aucune vérification HMAC).',
      })
    }
  }

  // --- Compte de départ (facultatif) ---------------------------------------
  const { email, password } = config.owner
  if (!email && !password) {
    warnings.push({
      key: 'SEED_OWNER_EMAIL',
      message:
        'Aucun compte propriétaire à créer : pensez à en créer un dans Supabase, puis à le rattacher à un pressing (voir README §3.4).',
    })
  } else if (!email || !password) {
    errors.push({
      key: 'SEED_OWNER_EMAIL',
      message: 'SEED_OWNER_EMAIL et SEED_OWNER_PASSWORD doivent être renseignés ensemble.',
    })
  } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.push({ key: 'SEED_OWNER_EMAIL', message: `« ${email} » n'est pas une adresse e-mail valide.` })
  } else if (password.length < 6) {
    errors.push({
      key: 'SEED_OWNER_PASSWORD',
      message: 'Mot de passe trop court : Supabase exige au moins 6 caractères.',
    })
  }

  // --- Valeurs d'exemple laissées telles quelles ----------------------------
  for (const [key, value] of [
    ['VITE_SUPABASE_URL', config.supabaseUrl],
    ['VITE_SUPABASE_ANON_KEY', config.anonKey],
    ['SUPABASE_ACCESS_TOKEN', config.accessToken],
    ['SUPABASE_DB_PASSWORD', config.dbPassword],
    ['SUPABASE_SERVICE_ROLE_KEY', config.serviceRoleKey],
  ]) {
    if (isPlaceholder(value)) {
      errors.push({
        key,
        message: 'Valeur d’exemple non modifiée : remplacez-la par celle de votre projet Supabase.',
      })
    }
  }

  // --- Garde-fou : un secret ne doit jamais être public --------------------
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'CINETPAY_SECRET_KEY']) {
    const value = config.raw[key]
    if (value && value.trim().length > 0) {
      if (Object.prototype.hasOwnProperty.call(config.raw, `VITE_${key}`)) {
        errors.push({
          key: `VITE_${key}`,
          message:
            'Ne préfixez jamais un secret par VITE_ : il serait embarqué dans le bundle et visible de tous.',
        })
      }
    }
  }

  return { errors, warnings }
}

/** Masque une valeur sensible pour l'affichage terminal. */
export function redact(value) {
  if (!value) return '—'
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} car.)`
}
