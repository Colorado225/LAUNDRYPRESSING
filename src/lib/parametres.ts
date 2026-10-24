import { normalisePhone } from '@/services/customerService'

/**
 * Règles pures de l'écran Paramètres (écran 12).
 *
 * Séparées de la page pour être testables sans DOM ni réseau : une validation
 * de formulaire qui ne se teste qu'à la main finit par accepter n'importe quoi.
 */

/** Bornes du nom du pressing, alignées sur la contrainte serveur. */
export const NOM_MIN = 2
export const NOM_MAX = 80

export type ResultatValidation<T> =
  | { ok: true; valeur: T }
  | { ok: false; erreur: string }

/**
 * Valide le nom du pressing.
 *
 * Les espaces internes sont conservés, les espaces de bord supprimés : un nom
 * saisi au clavier d'une tablette arrive souvent avec une espace parasite, et
 * la contrainte `char_length(btrim(name))` du serveur la refuserait.
 */
export function validerNomPressing(valeur: string): ResultatValidation<string> {
  const propre = valeur.replace(/\s+/g, ' ').trim()

  if (propre.length < NOM_MIN) {
    return { ok: false, erreur: 'Le nom du pressing doit contenir au moins 2 caractères.' }
  }
  if (propre.length > NOM_MAX) {
    return { ok: false, erreur: `Le nom du pressing ne peut pas dépasser ${NOM_MAX} caractères.` }
  }
  return { ok: true, valeur: propre }
}

/**
 * Valide le téléphone du pressing.
 *
 * Un numéro vide est accepté : le champ est facultatif en base. Sinon, on
 * attend exactement 10 chiffres (format ivoirien), l'indicatif `+225` étant
 * toléré. On renvoie le numéro **normalisé**, jamais la saisie brute.
 */
export function validerTelephonePressing(valeur: string): ResultatValidation<string | null> {
  const brut = valeur.trim()
  if (brut.length === 0) return { ok: true, valeur: null }

  const chiffres = normalisePhone(brut)
  if (chiffres.length !== 10) {
    return {
      ok: false,
      erreur: 'Indiquez un numéro ivoirien à 10 chiffres (exemple : 07 07 07 07 07).',
    }
  }
  return { ok: true, valeur: chiffres }
}

/** `1 048 576` → `1 Mo`. Sert à afficher le volume du cache local. */
export function tailleLisible(octets: number | null | undefined): string {
  if (octets === null || octets === undefined || !Number.isFinite(octets) || octets < 0) {
    return 'inconnue'
  }
  if (octets < 1024) return `${Math.round(octets)} o`

  const unites = ['ko', 'Mo', 'Go']
  let valeur = octets / 1024
  let unite = 0
  while (valeur >= 1024 && unite < unites.length - 1) {
    valeur /= 1024
    unite += 1
  }
  // Une décimale suffit : afficher « 1,37 Mo » n'aide personne à décider quoi
  // que ce soit, et le volume varie de toute façon à chaque commande.
  const arrondi = valeur >= 10 ? Math.round(valeur) : Math.round(valeur * 10) / 10
  return `${String(arrondi).replace('.', ',')} ${unites[unite]}`
}

/**
 * Commandes qu'il est possible d'effacer de la tablette sans perte.
 *
 * Seules les commandes **déjà synchronisées** le sont : une commande en attente
 * n'existe nulle part ailleurs, l'effacer la détruirait définitivement. Les
 * conflits sont exclus aussi — ils attendent une décision de l'utilisateur.
 */
export function estPurgeable(commande: {
  synced: number
  syncConflict: string | null
}): boolean {
  return commande.synced === 1 && commande.syncConflict === null
}
