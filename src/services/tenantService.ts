import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { validerNomPressing, validerTelephonePressing } from '@/lib/parametres'

/**
 * Modification du pressing (écran Paramètres).
 *
 * La politique `tenants_update_owner` réserve l'écriture au propriétaire : un
 * réceptionniste qui forcerait l'appel recevrait `42501`. L'interface masque le
 * formulaire, la base tranche.
 *
 * Ce service ne touche à **rien** d'autre : ni le rôle, ni l'abonnement, ni les
 * tarifs. Un écran « paramètres » qui modifierait la formule ou l'équipe
 * multiplierait les chemins d'écriture pour un gain nul.
 */

export interface PressingModifiable {
  name: string
  phone: string | null
}

export function tenantErrorMessage(message: string): string {
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Réseau indisponible : la modification nécessite une connexion.'
  }
  if (message.includes('row-level security') || message.includes('42501')) {
    return 'Seul le propriétaire peut modifier les informations du pressing.'
  }
  if (message.includes('tenants_name_check')) {
    return 'Le nom du pressing doit contenir entre 2 et 80 caractères.'
  }
  return message
}

/**
 * Fiche courante du pressing (nom et téléphone).
 *
 * Lue au moment d'ouvrir le formulaire, pas au chargement de l'écran : sans
 * cela, enregistrer le nom effacerait le téléphone, absent du contexte local.
 */
export async function fetchTenantPressing(tenantId: string): Promise<PressingModifiable> {
  if (!isSupabaseConfigured) {
    throw new Error('La modification nécessite un projet Supabase configuré.')
  }

  const { data, error } = await getSupabaseClient()
    .from('tenants')
    .select('name, phone')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) throw new Error(tenantErrorMessage(error.message))
  if (!data) throw new Error('Pressing introuvable pour ce compte.')

  return { name: data.name, phone: data.phone ?? null }
}

/** Enregistre le nom et le téléphone du pressing, après validation locale. */
export async function updateTenant(
  tenantId: string,
  valeurs: PressingModifiable,
): Promise<PressingModifiable> {
  const nom = validerNomPressing(valeurs.name)
  if (!nom.ok) throw new Error(nom.erreur)

  const telephone = validerTelephonePressing(valeurs.phone ?? '')
  if (!telephone.ok) throw new Error(telephone.erreur)

  if (!isSupabaseConfigured) {
    throw new Error('La modification nécessite un projet Supabase configuré.')
  }

  const { data, error } = await getSupabaseClient()
    .from('tenants')
    .update({ name: nom.valeur, phone: telephone.valeur })
    .eq('id', tenantId)
    .select('name, phone')
    .maybeSingle()

  if (error) throw new Error(tenantErrorMessage(error.message))
  // Aucun refus explicite mais aucune ligne : la RLS n'a pas laissé passer
  // l'écriture. Mieux vaut le dire que prétendre avoir enregistré.
  if (!data) {
    throw new Error('Modification refusée : seul le propriétaire peut la faire.')
  }

  return { name: data.name, phone: data.phone ?? null }
}
