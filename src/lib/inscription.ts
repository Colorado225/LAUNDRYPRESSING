import { validerNomPressing, validerTelephonePressing } from '@/lib/parametres'

/**
 * Validation du formulaire d'inscription.
 *
 * Fonction **pure**, testée séparément de l'écran : une inscription qui échoue
 * côté serveur après avoir laissé saisir dix champs est la première cause
 * d'abandon. On signale donc tout ce qui peut l'être avant l'envoi.
 *
 * La force du mot de passe est volontairement au-delà du minimum de Supabase
 * (six caractères) : un compte de pressing donne accès à la trésorerie et aux
 * coordonnées des clients.
 */

export const MOT_DE_PASSE_MIN = 8

export interface InscriptionSaisie {
  nomPressing: string
  telephone: string
  email: string
  motDePasse: string
  confirmation: string
  conditions: boolean
}

export type ChampInscription =
  | 'nomPressing'
  | 'telephone'
  | 'email'
  | 'motDePasse'
  | 'confirmation'
  | 'conditions'

export type ErreursInscription = Partial<Record<ChampInscription, string>>

/** Adresse e-mail : contrôle volontairement simple, le serveur tranche. */
export function estEmailValide(valeur: string): boolean {
  const propre = valeur.trim()
  if (propre.length < 5 || propre.length > 254) return false
  if (/\s/.test(propre)) return false
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(propre)
}

/**
 * Mot de passe : longueur, une lettre et un chiffre.
 *
 * Pas de règle exotique (majuscule, symbole) : elles poussent à noter le mot de
 * passe sur un papier collé à la caisse, ce qui est pire que le risque couvert.
 */
export function motDePasseValide(valeur: string): boolean {
  return (
    valeur.length >= MOT_DE_PASSE_MIN && /[a-zA-Z]/.test(valeur) && /[0-9]/.test(valeur)
  )
}

/** Valide l'ensemble du formulaire ; renvoie `{}` quand tout est bon. */
export function validerInscription(saisie: InscriptionSaisie): ErreursInscription {
  const erreurs: ErreursInscription = {}

  const nom = validerNomPressing(saisie.nomPressing)
  if (!nom.ok) erreurs.nomPressing = nom.erreur

  const telephone = validerTelephonePressing(saisie.telephone)
  if (!telephone.ok) erreurs.telephone = telephone.erreur

  if (!estEmailValide(saisie.email)) {
    erreurs.email = 'Indiquez une adresse e-mail valide (exemple : pressing@exemple.ci).'
  }

  if (!motDePasseValide(saisie.motDePasse)) {
    erreurs.motDePasse = `Au moins ${MOT_DE_PASSE_MIN} caractères, avec une lettre et un chiffre.`
  }

  if (saisie.confirmation !== saisie.motDePasse) {
    erreurs.confirmation = 'Les deux mots de passe ne correspondent pas.'
  }

  if (!saisie.conditions) {
    erreurs.conditions = 'Vous devez accepter les conditions d’utilisation.'
  }

  return erreurs
}

export function aDesErreurs(erreurs: ErreursInscription): boolean {
  return Object.keys(erreurs).length > 0
}
