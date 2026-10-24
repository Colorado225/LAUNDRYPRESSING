import { describe, expect, it } from 'vitest'
import {
  NOM_MAX,
  estPurgeable,
  tailleLisible,
  validerNomPressing,
  validerTelephonePressing,
} from '@/lib/parametres'

/**
 * Règles de l'écran Paramètres (écran 12).
 *
 * Ce qui se joue ici : ne pas laisser partir au serveur une valeur que la
 * contrainte SQL refusera, et ne jamais effacer une donnée par accident.
 */

describe('validerNomPressing', () => {
  it('supprime les espaces de bord', () => {
    const resultat = validerNomPressing('   Pressing Cocody  ')
    expect(resultat).toEqual({ ok: true, valeur: 'Pressing Cocody' })
  })

  it('ramène les espaces multiples à une seule', () => {
    const resultat = validerNomPressing('Pressing    des   Deux Plateaux')
    expect(resultat.ok && resultat.valeur).toBe('Pressing des Deux Plateaux')
  })

  it('refuse un nom trop court', () => {
    const resultat = validerNomPressing(' A ')
    expect(resultat.ok).toBe(false)
    if (!resultat.ok) expect(resultat.erreur).toContain('au moins 2 caractères')
  })

  it('refuse un nom trop long', () => {
    const resultat = validerNomPressing('a'.repeat(NOM_MAX + 1))
    expect(resultat.ok).toBe(false)
    if (!resultat.ok) expect(resultat.erreur).toContain(String(NOM_MAX))
  })

  it('accepte les accents et les apostrophes', () => {
    const resultat = validerNomPressing("Pressing d'Adjamé — Lavage")
    expect(resultat.ok && resultat.valeur).toBe("Pressing d'Adjamé — Lavage")
  })
})

describe('validerTelephonePressing', () => {
  it('accepte un champ vide et renvoie null', () => {
    expect(validerTelephonePressing('   ')).toEqual({ ok: true, valeur: null })
  })

  it('normalise un numéro saisi avec des espaces', () => {
    expect(validerTelephonePressing('07 07 07 07 07')).toEqual({ ok: true, valeur: '0707070707' })
  })

  it('retire l’indicatif ivoirien', () => {
    expect(validerTelephonePressing('+225 07 07 07 07 07')).toEqual({
      ok: true,
      valeur: '0707070707',
    })
  })

  it('refuse un numéro incomplet', () => {
    const resultat = validerTelephonePressing('07 07 07')
    expect(resultat.ok).toBe(false)
    if (!resultat.ok) expect(resultat.erreur).toContain('10 chiffres')
  })

  it('refuse un numéro trop long', () => {
    expect(validerTelephonePressing('070707070707').ok).toBe(false)
  })
})

describe('tailleLisible', () => {
  it('affiche les octets en dessous du kilo', () => {
    expect(tailleLisible(512)).toBe('512 o')
    expect(tailleLisible(0)).toBe('0 o')
  })

  it('passe en kilo-octets puis en méga-octets', () => {
    expect(tailleLisible(2048)).toBe('2 ko')
    expect(tailleLisible(1_048_576)).toBe('1 Mo')
  })

  it('garde une décimale seulement pour les petites valeurs', () => {
    expect(tailleLisible(1_572_864)).toBe('1,5 Mo')
    expect(tailleLisible(20 * 1_048_576)).toBe('20 Mo')
  })

  it('signale une valeur inconnue plutôt que d’inventer un chiffre', () => {
    expect(tailleLisible(null)).toBe('inconnue')
    expect(tailleLisible(Number.NaN)).toBe('inconnue')
    expect(tailleLisible(-1)).toBe('inconnue')
  })
})

describe('estPurgeable', () => {
  it('accepte une commande synchronisée sans conflit', () => {
    expect(estPurgeable({ synced: 1, syncConflict: null })).toBe(true)
  })

  it('refuse une commande jamais envoyée', () => {
    expect(estPurgeable({ synced: 0, syncConflict: null })).toBe(false)
  })

  it('refuse une commande en conflit, même synchronisée', () => {
    expect(estPurgeable({ synced: 1, syncConflict: 'Version distante différente' })).toBe(false)
  })
})
