/**
 * Edge Function `cinetpay-status`
 * -----------------------------------------------------------------------------
 * Rôle : dire au navigateur si le paiement Mobile Money est **réellement
 * disponible** sur ce projet, sans jamais exposer un secret.
 *
 * Pourquoi cette fonction existe
 * -----------------------------------------------------------------------------
 * Les clés marchandes vivent dans les secrets de l'Edge Function, que le
 * navigateur ne peut pas lire (et ne doit pas). Sans ce point d'interrogation,
 * le seul moyen de savoir était d'essayer de payer : le bouton restait affiché,
 * l'appel échouait, et l'ancienne version enchaînait sur un paiement *simulé* —
 * un comptoir pressé pouvait croire le client encaissé.
 *
 * Ici, la réponse est purement factuelle : « configuré » ou « non configuré ».
 * Le frontend masque alors le bouton quand les clés sont absentes. Aucune valeur
 * de secret ne sort : uniquement des booléens et les NOMS des variables
 * manquantes.
 *
 * Entrée  : aucune (POST ou GET).
 * Sortie  : { configured: boolean, mode: 'test' | 'production', missing: string[] }
 *
 * Volontairement autonome (aucun import) : la fonction reste déployable seule,
 * sans dépendre des modules `_shared`, et n'ajoute aucune surface d'exécution.
 */

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function repondre(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      // Une réponse de disponibilité ne doit jamais être servie depuis un cache :
      // installer les clés doit se voir au rechargement suivant.
      'Cache-Control': 'no-store',
    },
  })
}

/** Variables indispensables au guichet de paiement. */
const REQUISES = ['CINETPAY_API_KEY', 'CINETPAY_SITE_ID', 'CINETPAY_SECRET_KEY'] as const

Deno.serve((request: Request): Response => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // `corsHeaders` du projet autorise POST/OPTIONS ; on accepte aussi GET pour
  // que la sonde reste utilisable depuis un simple `curl` de diagnostic.
  if (request.method !== 'POST' && request.method !== 'GET') {
    return repondre({ error: { code: 'method_not_allowed', message: 'POST ou GET attendu.' } }, 405)
  }

  const missing = REQUISES.filter((nom) => {
    const valeur = Deno.env.get(nom)
    return !valeur || valeur.trim().length === 0
  })

  // `CINETPAY_MODE` vaut « production » par défaut côté fonction d'init : on
  // renvoie la même convention pour que l'interface puisse l'annoncer.
  const modeBrut = (Deno.env.get('CINETPAY_MODE') ?? 'production').trim().toLowerCase()
  const mode = modeBrut === 'test' ? 'test' : 'production'

  return repondre({
    configured: missing.length === 0,
    mode,
    // Noms seulement : jamais de valeur, même partielle.
    missing: [...missing],
  })
})
