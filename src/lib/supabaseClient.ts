import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './env'

/**
 * Client Supabase unique (singleton paresseux).
 *
 * Pourquoi paresseux ? Pour éviter qu'un `.env` manquant fasse planter
 * l'application entière dès l'import : seule la fonctionnalité qui a réellement
 * besoin du réseau échoue, avec un message explicite en français.
 */
let cachedClient: SupabaseClient<Database> | null = null

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!isSupabaseConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase n'est pas configuré : renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans le fichier .env",
    )
  }

  if (!cachedClient) {
    cachedClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Stockage par défaut : localStorage. La session survit à la fermeture
        // de l'onglet, indispensable sur une tablette d'atelier partagée.
        storageKey: 'pressing-pro-auth',
      },
      global: {
        headers: {
          'x-application-name': 'pressing-pro-mvp',
        },
      },
    })
  }

  return cachedClient
}

/**
 * Accès non bloquant : renvoie `null` si Supabase n'est pas configuré.
 * Utilisé par les écrans de diagnostic et par le futur écran de connexion.
 */
export function maybeSupabaseClient(): SupabaseClient<Database> | null {
  return isSupabaseConfigured ? getSupabaseClient() : null
}

/** Réinitialise le singleton (utile pour les tests). */
export function resetSupabaseClient(): void {
  cachedClient = null
}
