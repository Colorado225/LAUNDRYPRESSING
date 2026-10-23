import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './env'
import { readSelectedTenant } from './tenantSelection'

/**
 * En-tête `x-tenant-id` ajouté à chaque requête (palier 4).
 *
 * Pourquoi un `fetch` maison plutôt que `global.headers` ? Le client est créé
 * une seule fois, alors que la boutique active peut changer en cours de
 * session. Lire le stockage à chaque requête évite de recréer le client — et
 * donc de perdre les abonnements d'authentification en cours.
 *
 * Côté serveur, `current_tenant_id()` ne retient cet en-tête que si le compte
 * est réellement rattaché au pressing (fonction `is_tenant_member`).
 */
const fetchAvecBoutique: typeof fetch = (input, init) => {
  const boutique = readSelectedTenant()
  if (!boutique) return fetch(input, init)

  const entetes = new Headers(init?.headers)
  if (!entetes.has('x-tenant-id')) entetes.set('x-tenant-id', boutique)

  return fetch(input, { ...init, headers: entetes })
}

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
        fetch: fetchAvecBoutique,
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
