import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

/**
 * Configuration Vite — socle technique du MVP pressing.
 *
 * Points d'attention :
 * - L'alias `@` est aligné avec `tsconfig.json` (sinon les imports typés cassent au build).
 * - Le manifeste PWA déclare de vraies icônes PNG 192/512 : Chrome refuse l'installation
 *   si les icônes sont absentes ou au format SVG uniquement.
 * - `server.host = 0.0.0.0` + `allowedHosts` permet l'accès depuis la tablette du pressing
 *   et depuis l'URL de prévisualisation distante.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pressing Pro — Gestion de pressing',
        short_name: 'Pressing Pro',
        description:
          'Gestion de pressing : commandes, étiquettes QR, atelier hors ligne et paiement Mobile Money.',
        lang: 'fr',
        dir: 'ltr',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        // Une tablette d'atelier peut être posée en paysage comme en portrait.
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Toutes les routes SPA retombent sur index.html, sauf les appels API.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Auth et données Supabase : jamais de cache (source de vérité = Dexie + réseau).
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Autorise l'accès via l'URL de prévisualisation (proxy) et le réseau local du pressing.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
