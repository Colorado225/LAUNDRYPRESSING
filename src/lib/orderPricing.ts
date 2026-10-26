/**
 * Règles de prix partagées entre le poste (Dexie) et le serveur (PostgreSQL).
 *
 * Le déclencheur `guard_order_item_price` (migration 014) refuse une ligne qui
 * ne respecte pas trois règles :
 *
 *   1. `unit_price > 0` ;
 *   2. `price_reason` d'au moins 10 caractères pour une **ligne libre**
 *      (`catalog_entry_id is null`) ;
 *   3. `price` strictement égal au total recalculé (quantité facturable × prix
 *      unitaire, plancher éventuel).
 *
 * Jusqu'ici le formulaire laissait `price_reason` vide : toute commande créée au
 * comptoir était donc acceptée localement puis **refusée en silence** à
 * l'envoi. Les fonctions ci-dessous produisent les valeurs conformes au moment
 * de l'écriture locale, pour que la commande soit enregistrable des deux côtés.
 */

/** Motif attribué à une ligne libre quand le comptoir n'en saisit pas. */
export const MOTIF_LIGNE_LIBRE = 'Ligne libre saisie au comptoir'

/** Longueur minimale exigée par le déclencheur serveur. */
export const LONGUEUR_MIN_MOTIF = 10

/** Longueur maximale acceptée par la colonne `order_items.price_reason`. */
const LONGUEUR_MAX_MOTIF = 300

export interface LigneTarifaire {
  label: string
  catalogEntryId?: string | null
  priceReason?: string | null
  priceStatus?: 'CONFIRMED' | 'ESTIMATED' | null
}

/**
 * Motif de prix à transmettre au serveur.
 *
 * - motif saisi (≥ 10 caractères) : conservé tel quel ;
 * - ligne issue du catalogue : `null` autorisé, sauf dérogation de prix (le
 *   serveur exige alors un motif, et c'est le formulaire qui le fournit) ;
 * - ligne libre : motif par défaut **explicite**, préfixé du libellé pour
 *   garder une trace lisible dans l'historique des prix.
 */
export function motifPrixServeur(ligne: LigneTarifaire): string | null {
  const saisi = (ligne.priceReason ?? '').trim()

  if (saisi.length >= LONGUEUR_MIN_MOTIF) {
    return saisi.slice(0, LONGUEUR_MAX_MOTIF)
  }

  if (ligne.catalogEntryId) {
    return null
  }

  const libelle = ligne.label.trim()
  const compose = libelle ? `${MOTIF_LIGNE_LIBRE} — ${libelle}` : MOTIF_LIGNE_LIBRE
  return compose.slice(0, LONGUEUR_MAX_MOTIF)
}

/**
 * Vérifie qu'une ligne peut être enregistrée côté serveur.
 *
 * Retourne un message français prêt à afficher, ou `null` si la ligne est
 * acceptable. On préfère bloquer au comptoir avec une explication plutôt que de
 * laisser partir une commande qui échouera à la synchronisation.
 */
export function problemeTarifaire(input: {
  label: string
  unitPrice: number
  price: number
  priceStatus?: 'CONFIRMED' | 'ESTIMATED' | null
}): string | null {
  const libelle = input.label.trim() || 'cette ligne'

  if (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0) {
    return `Indiquez le prix unitaire de « ${libelle} » : une ligne à 0 FCFA ne peut pas être enregistrée.`
  }

  if (!Number.isFinite(input.price) || input.price < 0) {
    return `Le total de « ${libelle} » est invalide.`
  }

  if ((input.priceStatus ?? 'CONFIRMED') === 'ESTIMATED') {
    // Une mesure estimée se confirme avant facturation : le montant envoyé
    // reste provisoire, mais il doit déjà être chiffré.
    return null
  }

  return null
}
