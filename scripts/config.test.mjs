import { describe, expect, it } from 'vitest'
import {
  buildConfig,
  extractProjectRef,
  isAbsoluteUrl,
  isPlaceholder,
  parseEnvFile,
  redact,
  validateConfig,
} from './lib/config.mjs'

/**
 * Tests du module de configuration (scripts/lib/config.mjs).
 *
 * Ce module décide si l'installation peut démarrer : une erreur de lecture du
 * `.env` se traduirait par un « tout est configuré » mensonger, ou par un échec
 * incompréhensible au milieu du déploiement. Il est donc testé séparément.
 */

const VALID_ENV = {
  VITE_SUPABASE_URL: 'https://rzqvmklpwtxyzabc.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiJ9.cle_publicaire_anon',
  SUPABASE_ACCESS_TOKEN: 'sbp_0123456789abcdef',
  SUPABASE_DB_PASSWORD: 'mot-de-passe-base',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.cle_service_role_x',
  APP_URL: 'https://pressing-pro.vercel.app',
  CINETPAY_API_KEY: 'cle-cinetpay',
  CINETPAY_SITE_ID: '123456',
  CINETPAY_SECRET_KEY: 'secret-cinetpay',
  SEED_OWNER_EMAIL: 'patron@pressing.ci',
  SEED_OWNER_PASSWORD: 'motdepasse123',
  SEED_TENANT_NAME: 'Pressing Cocody',
}

describe('parseEnvFile', () => {
  it('lit les paires clé/valeur', () => {
    expect(parseEnvFile('A=1\nB=deux')).toEqual({ A: '1', B: 'deux' })
  })

  it('ignore les commentaires et les lignes vides', () => {
    const values = parseEnvFile('# commentaire\n\nA=1\n   \n# autre\nB=2')

    expect(values).toEqual({ A: '1', B: '2' })
  })

  it('accepte les guillemets simples et doubles', () => {
    expect(parseEnvFile('A="valeur avec espaces"\nB=\'autre\'').A).toBe('valeur avec espaces')
    expect(parseEnvFile('A="valeur avec espaces"\nB=\'autre\'').B).toBe('autre')
  })

  it('supporte la syntaxe `export`', () => {
    expect(parseEnvFile('export A=1')).toEqual({ A: '1' })
  })

  it('conserve les caractères spéciaux des clés API', () => {
    // Les clés CinetPay contiennent parfois des points et des tirets.
    const values = parseEnvFile('CINETPAY_API_KEY=1743236617.abc-def_ghi')

    expect(values.CINETPAY_API_KEY).toBe('1743236617.abc-def_ghi')
  })

  it('ne fait jamais d’interpolation', () => {
    // Un `$` doit rester littéral : sinon un mot de passe serait corrompu.
    expect(parseEnvFile('PASS=a$b${c}').PASS).toBe('a$b${c}')
  })

  it('gère les valeurs contenant un signe égal', () => {
    expect(parseEnvFile('TOKEN=abc=def=').TOKEN).toBe('abc=def=')
  })
})

describe('extractProjectRef', () => {
  it('extrait la référence d’une URL Supabase', () => {
    expect(extractProjectRef('https://rzqvmklpwtxyzabc.supabase.co')).toBe('rzqvmklpwtxyzabc')
    expect(extractProjectRef('https://rzqvmklpwtxyzabc.supabase.co/')).toBe('rzqvmklpwtxyzabc')
  })

  it('rejette tout ce qui n’est pas une URL Supabase', () => {
    expect(extractProjectRef('https://supabase.com/dashboard/project/abc')).toBeNull()
    expect(extractProjectRef('http://localhost:54321')).toBeNull()
    expect(extractProjectRef('')).toBeNull()
    expect(extractProjectRef(undefined)).toBeNull()
  })
})

describe('isAbsoluteUrl', () => {
  it('reconnaît http et https', () => {
    expect(isAbsoluteUrl('https://exemple.ci')).toBe(true)
    expect(isAbsoluteUrl('http://localhost:5173')).toBe(true)
  })

  it('rejette le reste', () => {
    expect(isAbsoluteUrl('exemple.ci')).toBe(false)
    expect(isAbsoluteUrl('ftp://exemple.ci')).toBe(false)
    expect(isAbsoluteUrl('')).toBe(false)
  })
})

describe('buildConfig', () => {
  it('déduit la référence du projet depuis l’URL publique', () => {
    const config = buildConfig({ VITE_SUPABASE_URL: 'https://rzqvmklpwtxyzabc.supabase.co' })

    expect(config.projectRef).toBe('rzqvmklpwtxyzabc')
  })

  it('déduit l’URL de notification CinetPay', () => {
    const config = buildConfig(VALID_ENV)

    expect(config.cinetpay.notifyUrl).toBe(
      'https://rzqvmklpwtxyzabc.supabase.co/functions/v1/cinetpay-webhook',
    )
  })

  it('respecte une URL de notification explicite', () => {
    const config = buildConfig({ ...VALID_ENV, CINETPAY_NOTIFY_URL: 'https://exemple.ci/hook' })

    expect(config.cinetpay.notifyUrl).toBe('https://exemple.ci/hook')
  })

  it('retire les barres finales des URL', () => {
    const config = buildConfig({ ...VALID_ENV, APP_URL: 'https://exemple.ci/' })

    expect(config.appUrl).toBe('https://exemple.ci')
  })

  it('transforme les valeurs vides en null', () => {
    const config = buildConfig({ ...VALID_ENV, CINETPAY_SECRET_KEY: '   ' })

    expect(config.cinetpay.secretKey).toBeNull()
  })
})

describe('validateConfig — configuration complète', () => {
  it('n’émet aucune erreur', () => {
    expect(validateConfig(buildConfig(VALID_ENV)).errors).toEqual([])
  })

  it('n’émet aucun avertissement quand tout est renseigné', () => {
    const { warnings } = validateConfig(buildConfig(VALID_ENV))

    expect(warnings).toEqual([])
  })
})

describe('validateConfig — erreurs bloquantes', () => {
  it('exige l’URL Supabase', () => {
    const { errors } = validateConfig(buildConfig({}))

    expect(errors.map((error) => error.key)).toContain('VITE_SUPABASE_URL')
  })

  it('rejette une URL Supabase mal formée', () => {
    const { errors } = validateConfig(buildConfig({ ...VALID_ENV, VITE_SUPABASE_URL: 'pas-une-url' }))

    expect(errors.map((error) => error.key)).toContain('VITE_SUPABASE_URL')
  })

  it('signale une clé publique tronquée', () => {
    const { errors } = validateConfig(buildConfig({ ...VALID_ENV, VITE_SUPABASE_ANON_KEY: 'court' }))

    expect(errors.map((error) => error.key)).toContain('VITE_SUPABASE_ANON_KEY')
  })

  it('exige le jeton personnel, le mot de passe et la clé service_role', () => {
    const keys = validateConfig(
      buildConfig({ VITE_SUPABASE_URL: VALID_ENV.VITE_SUPABASE_URL }),
    ).errors.map((error) => error.key)

    expect(keys).toContain('SUPABASE_ACCESS_TOKEN')
    expect(keys).toContain('SUPABASE_DB_PASSWORD')
    expect(keys).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('refuse un compte à moitié renseigné', () => {
    const { errors } = validateConfig(
      buildConfig({ ...VALID_ENV, SEED_OWNER_PASSWORD: '' }),
    )

    expect(errors.map((error) => error.key)).toContain('SEED_OWNER_EMAIL')
  })

  it('refuse une adresse e-mail invalide', () => {
    const { errors } = validateConfig(
      buildConfig({ ...VALID_ENV, SEED_OWNER_EMAIL: 'pas-un-email' }),
    )

    expect(errors.map((error) => error.key)).toContain('SEED_OWNER_EMAIL')
  })

  it('refuse un mot de passe trop court', () => {
    const { errors } = validateConfig(
      buildConfig({ ...VALID_ENV, SEED_OWNER_PASSWORD: '123' }),
    )

    expect(errors.map((error) => error.key)).toContain('SEED_OWNER_PASSWORD')
  })

  it('bloque un secret préfixé par VITE_', () => {
    // Le cas le plus dangereux : la clé service_role partirait dans le bundle.
    const { errors } = validateConfig(
      buildConfig({ ...VALID_ENV, VITE_SUPABASE_SERVICE_ROLE_KEY: 'fuite' }),
    )

    expect(errors.map((error) => error.key)).toContain('VITE_SUPABASE_SERVICE_ROLE_KEY')
  })
})

describe('validateConfig — environnement et signature CinetPay', () => {
  it('refuse une production sans clé secrète alors que CinetPay est configuré', () => {
    const { errors } = validateConfig(
      buildConfig({ ...VALID_ENV, CINETPAY_SECRET_KEY: '', APP_ENV: 'production' }),
    )

    expect(errors.map((error) => error.key)).toContain('CINETPAY_SECRET_KEY')
  })

  it('accepte la même configuration en développement, avec avertissement', () => {
    const { errors, warnings } = validateConfig(
      buildConfig({ ...VALID_ENV, CINETPAY_SECRET_KEY: '', APP_ENV: 'development' }),
    )

    expect(errors).toEqual([])
    expect(warnings.map((warning) => warning.key)).toContain('CINETPAY_SECRET_KEY')
  })

  it('considère la production comme l’environnement par défaut', () => {
    const config = buildConfig({ ...VALID_ENV, CINETPAY_SECRET_KEY: '' })

    expect(config.appEnv).toBe('production')
  })

  it('refuse une valeur d’environnement inconnue', () => {
    const { errors } = validateConfig(
      buildConfig({ ...VALID_ENV, APP_ENV: 'recette' }),
    )

    expect(errors.map((error) => error.key)).toContain('APP_ENV')
  })
})

describe('validateConfig — avertissements non bloquants', () => {
  it('accepte une application sans paiement, avec avertissement', () => {
    const config = buildConfig({ ...VALID_ENV, CINETPAY_API_KEY: '', CINETPAY_SITE_ID: '' })
    const { errors, warnings } = validateConfig(config)

    expect(errors).toEqual([])
    expect(warnings.map((warning) => warning.key)).toContain('CINETPAY_API_KEY')
  })

  it('accepte l’absence de compte initial', () => {
    const config = buildConfig({
      ...VALID_ENV,
      SEED_OWNER_EMAIL: '',
      SEED_OWNER_PASSWORD: '',
    })
    const { errors, warnings } = validateConfig(config)

    expect(errors).toEqual([])
    expect(warnings.map((warning) => warning.key)).toContain('SEED_OWNER_EMAIL')
  })

  it('avertit sur une adresse http en production', () => {
    const { warnings } = validateConfig(
      buildConfig({ ...VALID_ENV, APP_URL: 'http://pressing.ci' }),
    )

    expect(warnings.map((warning) => warning.key)).toContain('APP_URL')
  })

  it('ne considère pas localhost comme une erreur', () => {
    const { warnings } = validateConfig(
      buildConfig({ ...VALID_ENV, APP_URL: 'http://localhost:5173' }),
    )

    expect(warnings.map((warning) => warning.key)).not.toContain('APP_URL')
  })
})

describe('validateConfig — mode essai CinetPay', () => {
  it('vaut production par défaut', () => {
    expect(buildConfig(VALID_ENV).cinetpay.mode).toBe('production')
  })

  it('accepte test, en avertissant que les paiements sont fictifs', () => {
    const config = buildConfig({ ...VALID_ENV, CINETPAY_MODE: 'test' })
    const { errors, warnings } = validateConfig(config)

    expect(config.cinetpay.mode).toBe('test')
    expect(errors).toEqual([])
    expect(warnings.map((warning) => warning.key)).toContain('CINETPAY_MODE')
  })

  it('accepte la valeur en majuscules', () => {
    expect(buildConfig({ ...VALID_ENV, CINETPAY_MODE: 'TEST' }).cinetpay.mode).toBe('test')
  })

  it('refuse une valeur inconnue', () => {
    const { errors } = validateConfig(buildConfig({ ...VALID_ENV, CINETPAY_MODE: 'recette' }))

    expect(errors.map((error) => error.key)).toContain('CINETPAY_MODE')
  })

  it('refuse une clé d’essai restée en mode production', () => {
    // Le cas qui compte : un `.env` de recette recopié en production
    // encaisserait des paiements fictifs sans que personne ne le voie.
    const { errors } = validateConfig(
      buildConfig({
        ...VALID_ENV,
        CINETPAY_API_KEY: 'simulateur-test-key',
        CINETPAY_SITE_ID: '123456',
      }),
    )

    expect(errors.map((error) => error.key)).toContain('CINETPAY_MODE')
  })

  it('accepte les identifiants du simulateur en mode test', () => {
    const { errors } = validateConfig(
      buildConfig({
        ...VALID_ENV,
        CINETPAY_MODE: 'test',
        CINETPAY_API_KEY: 'simulateur-test-key',
        CINETPAY_SITE_ID: '123456',
      }),
    )

    expect(errors).toEqual([])
  })
})

describe('isPlaceholder', () => {
  it('reconnaît les valeurs du fichier d’exemple', () => {
    expect(isPlaceholder('https://abcdefghijklmnop.supabase.co')).toBe(true)
    expect(isPlaceholder('sbp_remplacez_moi')).toBe(true)
    expect(isPlaceholder('remplacez-moi')).toBe(true)
    expect(isPlaceholder('https://votre-projet.supabase.co')).toBe(true)
  })

  it('accepte une valeur réelle', () => {
    expect(isPlaceholder('https://xyzcompanyprod.supabase.co')).toBe(false)
    expect(isPlaceholder('sbp_9f2c1d4e5a6b7c8d9e0f')).toBe(false)
  })
})

describe('validateConfig — valeurs d’exemple', () => {
  it('refuse un .env.example recopié sans modification', () => {
    const { errors } = validateConfig(
      buildConfig({
        VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiJ9.exemple.exemple',
        SUPABASE_ACCESS_TOKEN: 'sbp_remplacez_moi',
        SUPABASE_DB_PASSWORD: 'remplacez_moi',
        SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.exemple.exemple',
      }),
    )

    expect(errors.map((error) => error.key)).toEqual(
      expect.arrayContaining(['VITE_SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']),
    )
  })
})

describe('redact', () => {
  it('masque le milieu de la valeur', () => {
    expect(redact('sbp_0123456789abcdef')).toBe('sbp_…cdef (20 car.)')
  })

  it('masque entièrement les valeurs courtes', () => {
    expect(redact('court')).toBe('••••')
    expect(redact('')).toBe('—')
  })
})
