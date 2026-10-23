/**
 * Utilitaires HTTP partagés par les Edge Functions.
 *
 * Supabase Edge Functions tournent sous Deno : les imports utilisent donc le
 * préfixe `npm:` et les types `Deno.*` (pas de `package.json` associé).
 */

/** Origines autorisées. `*` est acceptable ici : l'authentification repose sur le JWT. */
export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** Réponse JSON standardisée, en UTF-8. */
export function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Erreur métier renvoyée au client.
 * `message` est toujours rédigé en français : il est affiché tel quel.
 */
export function apiError(
  code: string,
  message: string,
  status = 400,
  origin: string | null = null,
): Response {
  return json({ error: { code, message } }, status, origin)
}
