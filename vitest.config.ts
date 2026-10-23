import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/**
 * Configuration Vitest (phase 6).
 *
 * Volontairement séparée de `vite.config.ts` et non fusionnée avec elle :
 * `VitePWA` génère un service worker au démarrage, ce qui n'a aucun sens dans
 * une suite de tests et ralentirait chaque exécution. Seuls les éléments
 * strictement nécessaires sont repris (JSX, alias `@`).
 *
 * L'alias doit rester identique à celui de `vite.config.ts` : sinon les tests
 * passeraient sur une résolution de modules différente de celle du build.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // IndexedDB et DOM réalistes : les modules critiques (Dexie, hooks) en
    // dépendent directement.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
  },
})
