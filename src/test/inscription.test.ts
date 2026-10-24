import { describe, expect, it } from 'vitest'
import {
  MOT_DE_PASSE_MIN,
  aDesErreurs,
  estEmailValide,
  motDePasseValide,
  validerInscription,
  type InscriptionSaisie,
} from '@/lib/inscription'

/**
 * Validation du formulaire d'inscription.
 *
 * Une inscription refusée par le serveur après six champs saisis est la
 * première cause d'abandon : tout ce qui peut être vérifié localement doit
 * l'être avant l'envoi.
 */

function saisie(partial: Partial<InscriptionSaisie> = {}): InscriptionSaisie {
  return {
    nomPressing: 'Pressing Cocody',
    telephone: '07 07 07 07 07',
    email: 'patron@pressing.ci',
    motDePasse: 'lavage2026',
    confirmation: 'lavage2026',
    conditions: true,
    ...partial,
  }
}

describe('estEmailValide', () => {
  it('accepte une adresse ordinaire', () => {
    expect(estEmailValide('pressing@exemple.ci')).toBe(true)
    expect(estEmailValide('  a.b+test@exemple.co.uk  ')).toBe(true)
  })

  it('refuse ce qui n’est pas une adresse', () => {
    expect(estEmailValide('')).toBe(false)
    expect(estEmailValide('pressing')).toBe(false)
    expect(estEmailValide('pressing@')).toBe(false)
    expect(estEmailValide('pressing@exemple')).toBe(false)
    expect(estEmailValide('pres sing@exemple.ci')).toBe(false)
    expect(estEmailValide('a@b@exemple.ci')).toBe(false)
  })
})

describe('motDePasseValide', () => {
  it('exige la longueur minimale', () => {
    expect(motDePasseValide('lavage2')).toBe(false)
    expect(motDePasseValide('lavage2')).toBe(false)
    expect(motDePasseValide('lavage26')).toBe(true)
  })

  it('exige une lettre et un chiffre', () => {
    expect(motDePasseValide('lavagelavage')).toBe(false)
    expect(motDePasseValide('12345678901')).toBe(false)
  })

  it('accepte un mot de passe correct', () => {
    expect(motDePasseValide('lavage2026')).toBe(true)
    expect(MOT_DE_PASSE_MIN).toBe(8)
  })
})

describe('validerInscription', () => {
  it('ne renvoie aucune erreur sur une saisie complète', () => {
    expect(validerInscription(saisie())).toEqual({})
    expect(aDesErreurs(validerInscription(saisie()))).toBe(false)
  })

  it('signale le nom du pressing', () => {
    const erreurs = validerInscription(saisie({ nomPressing: ' A ' }))
    expect(erreurs.nomPressing).toContain('au moins 2 caractères')
  })

  it('signale un téléphone invalide mais accepte le champ vide', () => {
    expect(validerInscription(saisie({ telephone: '07 07' })).telephone).toContain('10 chiffres')
    expect(validerInscription(saisie({ telephone: '' })).telephone).toBeUndefined()
  })

  it('signale une adresse e-mail invalide', () => {
    expect(validerInscription(saisie({ email: 'patron@' })).email).toContain('adresse e-mail valide')
  })

  it('signale un mot de passe trop faible', () => {
    const erreurs = validerInscription(saisie({ motDePasse: 'abc', confirmation: 'abc' }))
    expect(erreurs.motDePasse).toContain(String(MOT_DE_PASSE_MIN))
  })

  it('signale une confirmation différente', () => {
    const erreurs = validerInscription(saisie({ confirmation: 'lavage2027' }))
    expect(erreurs.confirmation).toContain('ne correspondent pas')
  })

  it('exige l’acceptation des conditions', () => {
    const erreurs = validerInscription(saisie({ conditions: false }))
    expect(erreurs.conditions).toContain('conditions d’utilisation')
  })

  it('cumule les erreurs au lieu de s’arrêter à la première', () => {
    const erreurs = validerInscription(
      saisie({
        nomPressing: 'X',
        telephone: '12',
        email: 'nope',
        motDePasse: 'abc',
        confirmation: 'abcd',
        conditions: false,
      }),
    )
    expect(Object.keys(erreurs).sort()).toEqual([
      'conditions',
      'confirmation',
      'email',
      'motDePasse',
      'nomPressing',
      'telephone',
    ])
    expect(aDesErreurs(erreurs)).toBe(true)
  })
})
