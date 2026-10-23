/**
 * Boutique active, lue sans dépendre de React ni de Supabase.
 *
 * Le client Supabase ajoute l'en-tête `x-tenant-id` à chaque requête ; il ne
 * peut pas importer le store Zustand (cycle d'imports), d'où ce petit module.
 * La source de vérité est l'état persisté du store : `switchTenant` y écrit
 * aussitôt, et la requête suivante part avec la bonne boutique.
 */

const CLE_STORE = 'pressing-pro-tenant'

/** Identifiant de la boutique choisie, `null` avant la première connexion. */
export function readSelectedTenant(): string | null {
  try {
    const brut = localStorage.getItem(CLE_STORE)
    if (!brut) return null

    const parse = JSON.parse(brut) as { state?: { tenantId?: string | null } }
    return parse.state?.tenantId ?? null
  } catch {
    // Stockage indisponible ou corrompu : on retombe sur le claim du JWT,
    // qui désigne la boutique principale du compte.
    return null
  }
}
