import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Configuration des tests.
 *
 * Volontairement séparée de `vite.config.ts` : celui-ci charge le plugin PWA
 * (génération du service worker) et le proxy de développement, inutiles — et
 * coûteux — pour des tests unitaires. Seuls l'alias `@` et le plugin React
 * sont repris, pour que les tests importent les mêmes chemins que l'application.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    clearMocks: true,
    restoreMocks: true,
  },
})
