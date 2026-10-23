import { describe, expect, it } from 'vitest'
import {
  FICHIERS_SCHEMA,
  FICHIERS_TESTS,
  compterControles,
  estLocale,
  masquerUrl,
  planDePush,
  urlPourPg,
} from './db.mjs'

/**
 * Tests des fonctions pures de `scripts/db.mjs`.
 *
 * Aucune connexion réseau : ce qui se teste ici, c'est le calcul du plan de
 * migration, le masquage des identifiants et la décision TLS. Le
 * comportement contre une vraie base est vérifié à part, par
 * `npm run db:etat` / `db:push` / `db:verifier`.
 */

describe('masquerUrl', () => {
  it('masque le mot de passe', () => {
    expect(masquerUrl('postgresql://neondb_owner:secret@hote.neon.tech/neondb')).toBe(
      'postgresql://neondb_owner:***@hote.neon.tech/neondb',
    )
  })

  it('laisse intacte une URL sans mot de passe', () => {
    expect(masquerUrl('postgresql://postgres@/postgres?host=/tmp')).toBe(
      'postgresql://postgres@/postgres?host=/tmp',
    )
  })

  it('ne plante pas sur une valeur absente', () => {
    expect(masquerUrl(undefined)).toBe('')
  })
})

describe('estLocale', () => {
  it('reconnaît localhost et 127.0.0.1', () => {
    expect(estLocale('postgresql://postgres@localhost:5432/postgres')).toBe(true)
    expect(estLocale('postgresql://postgres@127.0.0.1:5432/postgres')).toBe(true)
  })

  it('traite une URL à socket Unix comme locale', () => {
    expect(estLocale('postgresql://postgres@/postgres?host=/var/run/postgresql')).toBe(true)
  })

  it('considère un hôte distant comme non local', () => {
    expect(
      estLocale('postgresql://user:pass@ep-holy-voice.eu-central-1.aws.neon.tech/neondb'),
    ).toBe(false)
  })
})

describe('urlPourPg', () => {
  it('retire les paramètres propres à libpq', () => {
    const url = urlPourPg(
      'postgresql://user:pass@hote/base?sslmode=require&channel_binding=require&application_name=test',
    )
    expect(url).not.toContain('sslmode')
    expect(url).not.toContain('channel_binding')
    expect(url).toContain('application_name=test')
  })

  it('conserve une URL qui ne se laisse pas analyser', () => {
    expect(urlPourPg('pas une url')).toBe('pas une url')
  })
})

describe('planDePush', () => {
  it('applique tout sur une base vierge', () => {
    const { aAppliquer, deja } = planDePush([])
    expect(aAppliquer).toEqual(FICHIERS_SCHEMA)
    expect(deja).toEqual([])
  })

  it('ne rejoue pas les fichiers déjà enregistrés', () => {
    const { aAppliquer, deja } = planDePush(FICHIERS_SCHEMA.slice(0, 3))
    expect(deja).toHaveLength(3)
    expect(aAppliquer).toEqual(FICHIERS_SCHEMA.slice(3))
  })

  it('ignore un fichier inconnu présent en base', () => {
    const { aAppliquer } = planDePush(['supabase/migrations/999_inconnue.sql'])
    expect(aAppliquer).toEqual(FICHIERS_SCHEMA)
  })

  it('ne considère pas le jeu de démonstration comme un test', () => {
    expect(FICHIERS_SCHEMA).toContain('supabase/seed.sql')
    expect(FICHIERS_TESTS).not.toContain('supabase/seed.sql')
  })
})

describe('compterControles', () => {
  it('compte les NOTICE qui commencent par OK', () => {
    expect(
      compterControles([
        'OK 1.1 — commande avancée.',
        'OK 1.2 — montant protégé.',
        'Attention : information sans verdict',
      ]),
    ).toBe(2)
  })

  it('ne compte pas un OK au milieu d’une phrase', () => {
    expect(compterControles(['le contrôle OK est ailleurs'])).toBe(0)
  })

  it('renvoie zéro sans notice', () => {
    expect(compterControles([])).toBe(0)
  })
})
