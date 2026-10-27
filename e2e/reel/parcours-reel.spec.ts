import { expect, test } from '@playwright/test'
import { creerCommande } from '../helpers'

/**
 * Chaîne complète contre un **vrai projet Supabase** : navigateur → services →
 * PostgreSQL/RLS → retour à l'écran, puis second appareil.
 *
 * Ces scénarios ne s'exécutent que si l'environnement fournit une cible et un
 * compte de recette :
 *
 *   E2E_BASE_URL=https://mon-app.example.com \
 *   E2E_EMAIL=recette@exemple.ci \
 *   E2E_PASSWORD='••••••' \
 *   npx playwright test --project=reel
 *
 * Sans ces variables, **chaque test est marqué comme ignoré** : un scénario qui
 * ne peut pas s'exécuter doit être visiblement sauté, jamais silencieusement
 * vert.
 *
 * ⚠️ Ces tests écrivent dans une vraie base. Les commandes créées portent le
 * préfixe « RECETTE E2E » et ne sont **pas** supprimées automatiquement : la
 * suppression d'une commande est une action métier, elle se fait à la main
 * depuis la fiche (et jamais sur des données client).
 */

const EMAIL = process.env['E2E_EMAIL']?.trim()
const MOT_DE_PASSE = process.env['E2E_PASSWORD']?.trim()
const CIBLE = process.env['E2E_BASE_URL']?.trim()

const pret = Boolean(EMAIL && MOT_DE_PASSE && CIBLE)

test.describe('Parcours réel (Supabase)', () => {
  test.skip(
    !pret,
    'Définissez E2E_BASE_URL, E2E_EMAIL et E2E_PASSWORD pour exécuter cette recette.',
  )

  /** Connexion par le formulaire, comme un utilisateur. */
  async function seConnecter(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()

    // `exact` : sans cela, « Mot de passe » désigne aussi « Confirmer le mot
    // de passe » du panneau d'inscription.
    await page.getByLabel('Adresse e-mail', { exact: true }).fill(EMAIL!)
    await page.getByLabel('Mot de passe', { exact: true }).fill(MOT_DE_PASSE!)
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click()

    await expect(page).toHaveURL(/\/commandes/)
  }

  test('connexion, création d’une commande et persistance serveur', async ({ page, browser }) => {
    await seConnecter(page)

    const client = `RECETTE E2E ${Date.now()}`
    const identifiant = await creerCommande(page, {
      client,
      telephone: '07 00 00 00 01',
      lignes: [{ libelle: 'Chemise recette', quantite: 1, prixUnitaire: 1000 }],
    })

    // --- Rechargement : la fiche revient du serveur ------------------------
    await page.reload()
    await expect(page.getByRole('heading', { name: client })).toBeVisible()
    await expect(page.getByText(/1\s?000\s?FCFA/).first()).toBeVisible()

    // --- Second appareil : même compte, navigateur distinct ----------------
    // C'est la preuve qu'il ne s'agit pas d'un affichage local : un autre
    // profil de navigateur (donc un autre IndexedDB) doit retrouver la commande.
    const autreContexte = await browser.newContext()
    const autrePage = await autreContexte.newPage()
    try {
      await seConnecter(autrePage)
      await autrePage.goto('/commandes')
      await autrePage.getByLabel('Rechercher une commande').fill(client)

      // La synchronisation peut demander quelques secondes : on attend sans
      // mentir, et l'échec dit clairement que la donnée n'est pas remontée.
      await expect(
        autrePage.getByText(client).first(),
        `La commande ${identifiant} n'est pas visible sur le second appareil : ` +
          'vérifiez le moteur de synchronisation et les politiques RLS (SELECT sur orders).',
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await autreContexte.close()
    }
  })

  test('aucune mention de paiement simulé sur la fiche', async ({ page }) => {
    await seConnecter(page)
    await page.goto('/commandes')

    const premiere = page.locator('a[href^="/commandes/"]').first()
    test.skip((await premiere.count()) === 0, 'Aucune commande à ouvrir sur ce pressing.')
    await premiere.click()

    await expect(page.getByText(/paiement\s+simulé/i)).toHaveCount(0)
  })
})
