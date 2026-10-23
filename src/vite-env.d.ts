/// <reference types="vite/client" />

/**
 * Variables d'environnement exposées au navigateur.
 * Seules les variables préfixées `VITE_` sont injectées par Vite — elles sont
 * donc publiques et ne doivent jamais contenir de secret.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_DEMO_TENANT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
