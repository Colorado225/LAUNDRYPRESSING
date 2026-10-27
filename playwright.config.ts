import { defineConfig, devices } from '@playwright/test'

/**
 * Tests de bout en bout — Pressing Pro
 * =============================================================================
 * Deux projets, volontairement séparés :
 *
 *  1. `demo` / `demo-mobile` : l'application tourne **sans backend**, avec un
 *     projet Supabase volontairement vide. On y exerce la chaîne complète
 *     réellement vérifiable hors ligne : connexion, création de commande,
 *     persistance après rechargement, encaissement en espèces.
 *     Ces tests passent partout (poste, CI), sans secret ni réseau.
 *
 *  2. `reel` : la même chaîne contre un **vrai projet Supabase** (variables
 *     `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`). Les scénarios sont ignorés
 *     tant que ces variables manquent : un test qui ne peut pas s'exécuter doit
 *     être visiblement ignoré, jamais silencieusement vert.
 *
 * Ce que ces tests ne remplacent pas : les règles RLS et les contraintes SQL
 * restent vérifiées par `supabase/tests/` et `npm run sql:verify`. Un navigateur
 * qui cliquerait juste ne prouverait rien sur l'autorisation serveur.
 */

/** Port du serveur de test en mode démonstration (distinct du serveur de dev). */
export const PORT_DEMO = 3100
const BASE_DEMO = `http://127.0.0.1:${PORT_DEMO}`

/** Identifiant de pressing fictif utilisé par les scénarios hors ligne. */
export const TENANT_DEMO = '11111111-1111-4111-8111-111111111111'

/**
 * En mode `reel`, l'application cible est celle de `E2E_BASE_URL` : inutile de
 * démarrer un serveur local. La configuration n'en déclare donc aucun.
 */
const baseUrlReelle = process.env['E2E_BASE_URL']?.trim()

export default defineConfig({
  testDir: './e2e',
  // Un scénario qui dépend d'une vraie base ne doit pas tourner en parallèle
  // avec lui-même sur le même pressing : on reste séquentiel.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    /**
     * Animations réduites — un profil utilisateur réel, supporté par
     * l'application, et le seul sur lequel ces tests sont fiables.
     *
     * `src/index.css` contient déjà un bloc `prefers-reduced-motion: reduce`
     * qui coupe les transformations de survol des cartes et des boutons. Sans
     * lui, un clic souris lancé pendant que la carte se soulève
     * (`perspective() rotateX() scale()` sur l'ancêtre) **et** que le bouton se
     * soulève à son tour n'atteint pas le bouton dans le Chromium sans GPU de
     * cet environnement : le navigateur remet l'événement au conteneur parent
     * et le clic est perdu (`elementFromPoint` désigne pourtant le bouton).
     * Mesuré ici, reproductible, indépendant du viewport et du point cliqué.
     *
     * Conséquence assumée : le profil « animations activées » n'est pas couvert
     * par ces scénarios. C'est signalé dans `docs/RECETTE-BOUTONS.md`.
     */
    reducedMotion: 'reduce',
    // Pas de vidéo : elle exige un binaire ffmpeg supplémentaire, et la trace
    // (ci-dessous) suffit à rejouer un échec pas à pas.
    video: 'off',
    locale: 'fr-FR',
    timezoneId: 'Africa/Abidjan',
    // Le service worker de la PWA mettrait en cache des réponses entre deux
    // scénarios et masquerait justement ce qu'on veut mesurer (le réseau, la
    // synchronisation). On le neutralise.
    serviceWorkers: 'block',
    /**
     * Navigateur fourni par l'environnement.
     *
     * Sur un poste ou dans la CI GitHub, `npm run e2e:install` télécharge le
     * Chromium de Playwright et cette variable reste vide. Dans un conteneur
     * où le téléchargement est impossible (pare-feu, image figée), on peut
     * pointer vers un binaire déjà présent : aucun chemin n'est codé en dur,
     * et rien ne change pour les autres.
     */
    launchOptions: process.env['PLAYWRIGHT_CHROMIUM_PATH']
      ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] }
      : undefined,
  },

  projects: [
    {
      name: 'demo',
      testDir: './e2e/demo',
      use: { ...devices['Desktop Chrome'], baseURL: BASE_DEMO, viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'demo-mobile',
      testDir: './e2e/demo',
      // Même parcours sur un format téléphone : c'est l'usage réel au comptoir,
      // et un bouton hors écran ne doit pas passer inaperçu.
      use: { ...devices['Pixel 7'], baseURL: BASE_DEMO },
    },
    {
      name: 'reel',
      testDir: './e2e/reel',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: baseUrlReelle,
      },
    },
  ],

  /**
   * Serveur de démonstration : Vite avec les deux variables Supabase **vides**.
   * `src/lib/env.ts` en déduit le mode démonstration (ni connexion e-mail, ni
   * synchronisation) : c'est ce qui rend le parcours exécutable sans rien
   * installer côté base.
   */
  webServer: baseUrlReelle
    ? undefined
    : {
        command: `npx vite --host 127.0.0.1 --port ${PORT_DEMO} --strictPort`,
        url: BASE_DEMO,
        reuseExistingServer: !process.env['CI'],
        timeout: 120_000,
        env: {
          VITE_SUPABASE_URL: '',
          VITE_SUPABASE_ANON_KEY: '',
          VITE_DEMO_TENANT_ID: TENANT_DEMO,
        },
      },
})
