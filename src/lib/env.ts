/**
 * Lecture centralisée des variables d'environnement.
 *
 * Choix technique : on ne lève PAS d'exception à l'import du module.
 * Un `throw` au chargement provoquait un écran blanc sans explication quand
 * `.env` était absent (utile en démo, désagréable en développement).
 * À la place, `isSupabaseConfigured` permet à l'UI d'afficher un message clair.
 */

function readEnv(key: keyof ImportMetaEnv): string | undefined {
  const value = import.meta.env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export const SUPABASE_URL = readEnv('VITE_SUPABASE_URL')
/**
 * Identifiant du pressing de démonstration (optionnel).
 * Permet de tester le mode offline-first avant la mise en place de la
 * connexion Supabase (phase 5), sans jamais coder d'UUID en dur.
 */
export const DEMO_TENANT_ID = readEnv('VITE_DEMO_TENANT_ID')
export const SUPABASE_ANON_KEY = readEnv('VITE_SUPABASE_ANON_KEY')

/** Variables obligatoires manquantes (sert à guider l'utilisateur). */
export const missingSupabaseEnvVars: string[] = [
  ...(SUPABASE_URL ? [] : ['VITE_SUPABASE_URL']),
  ...(SUPABASE_ANON_KEY ? [] : ['VITE_SUPABASE_ANON_KEY']),
]

/** `true` si le client Supabase peut être initialisé. */
export const isSupabaseConfigured = missingSupabaseEnvVars.length === 0

/**
 * Masque une URL pour l'affichage (les clés publiques ne doivent pas être
 * recopiées dans les captures d'écran ou les rapports d'erreur).
 */
export function maskSupabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return '—'
  }
}
