import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'

/**
 * Deux clients Supabase dans les Edge Functions :
 *
 *  - `adminClient`  : clé `service_role`, contourne la RLS. Utilisé pour
 *    écrire dans `payment_transactions` et pour relire la commande côté serveur.
 *    ⚠️ Ne jamais renvoyer ses données brutes au client.
 *  - `userClient(jwt)` : clé `anon` + JWT de l'utilisateur. Respecte la RLS ;
 *    sert à vérifier que l'appelant a bien accès à la commande demandée.
 */

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Secret Supabase manquant : ${name}`)
  return value
}

export function createAdminClient(): SupabaseClient {
  const url = requireEnv('SUPABASE_URL')
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createUserClient(accessToken: string): SupabaseClient {
  const url = requireEnv('SUPABASE_URL')
  const anonKey = requireEnv('SUPABASE_ANON_KEY')

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

/** Extrait le JWT de l'en-tête `Authorization: Bearer …`. */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? null
}
