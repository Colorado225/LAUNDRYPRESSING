import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'

/**
 * Disponibilité réelle du paiement Mobile Money.
 *
 * Pourquoi interroger le serveur ?
 * -----------------------------------------------------------------------------
 * Les clés marchandes CinetPay vivent dans les **secrets** de l'Edge Function :
 * le navigateur ne peut ni les lire, ni en déduire la présence. Sans cette
 * sonde, la seule façon de savoir était d'essayer de payer — donc après avoir
 * proposé le bouton, et l'ancienne version enchaînait alors sur un paiement
 * *simulé*. Un comptoir pressé pouvait en conclure que le client avait payé.
 *
 * La fonction `cinetpay-status` répond uniquement par des booléens et par les
 * NOMS des variables manquantes : aucun secret ne transite.
 *
 * Trois états, volontairement distincts :
 *   • `null`                     → inconnu (sonde indisponible, hors ligne,
 *                                  fonction pas encore déployée) : on ne cache
 *                                  rien et on laisse le bouton visible, car
 *                                  masquer un paiement qui fonctionne serait
 *                                  une régression ;
 *   • `{ configured: true }`     → le guichet est utilisable ;
 *   • `{ configured: false }`    → clés absentes : le bouton est masqué.
 */

export type ModePaiement = 'test' | 'production'

export interface DisponibilitePaiement {
  /** `true` si les trois secrets CinetPay sont présents côté serveur. */
  configured: boolean
  /** Mode déclaré par le serveur (`production` par défaut). */
  mode: ModePaiement
  /** Noms des variables absentes — jamais leur valeur. */
  missing: string[]
}

/** Clé de session : la réponse est partagée par tous les écrans de l'onglet. */
export const CLE_CACHE_PAIEMENT = 'pressing-pro-cinetpay-status'

/**
 * Durée de validité du cache. Assez courte pour qu'installer les clés se voie
 * sans redémarrer, assez longue pour ne pas sonder le serveur à chaque écran.
 */
export const DUREE_CACHE_MS = 10 * 60 * 1000

interface EntreeCache extends DisponibilitePaiement {
  /** Horodatage de la réponse serveur (ms). */
  at: number
}

function stockage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // Navigation privée ou stockage refusé : la sonde reste utilisable en
    // mémoire, seul le partage entre onglets est perdu.
    return null
  }
}

/** Normalise la réponse serveur ; `null` si elle n'a pas la forme attendue. */
export function lireReponse(brut: unknown): DisponibilitePaiement | null {
  if (!brut || typeof brut !== 'object') return null
  const objet = brut as Record<string, unknown>
  const configure = objet['configured']
  if (typeof configure !== 'boolean') return null

  const mode = objet['mode'] === 'test' ? 'test' : 'production'
  const brutManquants = objet['missing']
  const missing = Array.isArray(brutManquants)
    ? brutManquants.filter((nom): nom is string => typeof nom === 'string')
    : []

  return { configured: configure, mode, missing }
}

/**
 * Disponibilité connue, sans appel réseau. Sert au premier rendu : un écran
 * déjà visité n'affiche pas fugitivement un bouton qui va disparaître.
 */
export function lireDisponibiliteMemoisee(maintenant: number = Date.now()): DisponibilitePaiement | null {
  const cache = stockage()
  if (!cache) return null

  try {
    const brut = cache.getItem(CLE_CACHE_PAIEMENT)
    if (!brut) return null
    const entree = JSON.parse(brut) as EntreeCache
    if (typeof entree?.at !== 'number') return null
    if (maintenant - entree.at > DUREE_CACHE_MS) {
      cache.removeItem(CLE_CACHE_PAIEMENT)
      return null
    }
    return lireReponse(entree)
  } catch {
    return null
  }
}

/** Mémorise une réponse serveur pour la session en cours. */
export function memoriserDisponibilite(
  disponibilite: DisponibilitePaiement,
  maintenant: number = Date.now(),
): void {
  const cache = stockage()
  if (!cache) return
  try {
    const entree: EntreeCache = { ...disponibilite, at: maintenant }
    cache.setItem(CLE_CACHE_PAIEMENT, JSON.stringify(entree))
  } catch {
    // Quota ou stockage interdit : sans cache, la sonde repartira du serveur.
  }
}

/** Oublie la réponse (tests, ou après installation des clés). */
export function oublierDisponibilite(): void {
  const cache = stockage()
  try {
    cache?.removeItem(CLE_CACHE_PAIEMENT)
  } catch {
    // rien à faire : il n'y avait rien à oublier
  }
}

/**
 * `true` seulement quand le serveur a **explicitement** dit que le guichet
 * n'est pas installé. Un état inconnu ne doit pas masquer le bouton.
 */
export function paiementIndisponible(disponibilite: DisponibilitePaiement | null): boolean {
  return disponibilite?.configured === false
}

/**
 * Interroge le serveur. Ne lève jamais : une sonde en échec renvoie `null`
 * (état inconnu) plutôt que de bloquer l'écran de commande.
 */
export async function chargerDisponibilitePaiement(options?: {
  /** Ignore le cache (après une erreur `provider_not_configured`, par exemple). */
  forcer?: boolean
}): Promise<DisponibilitePaiement | null> {
  if (!options?.forcer) {
    const memoisee = lireDisponibiliteMemoisee()
    if (memoisee) return memoisee
  }

  // Sans configuration Supabase il n'y a ni session ni fonction à interroger :
  // le composant masque de toute façon le bouton dans ce mode.
  if (!isSupabaseConfigured) return null

  try {
    const { data, error } = await getSupabaseClient().functions.invoke('cinetpay-status', {
      method: 'POST',
      body: {},
    })
    if (error) return null

    const disponibilite = lireReponse(data)
    if (disponibilite) memoriserDisponibilite(disponibilite)
    return disponibilite
  } catch {
    return null
  }
}
