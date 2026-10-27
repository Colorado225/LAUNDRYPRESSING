import { expect, test } from '@playwright/test'
import { creerCommande, entrerEnDemonstration } from '../helpers'

/**
 * Chaîne complète vérifiable sans backend : interface → IndexedDB → retour à
 * l'écran après rechargement.
 *
 * Ce que ces scénarios prouvent réellement : le bouton fait son travail, la
 * donnée est écrite là où l'architecture le prévoit (Dexie, hors ligne) et elle
 * réapparaît après un rechargement complet de l'application. Ce qu'ils ne
 * prouvent pas : l'envoi vers Supabase, qui dépend du projet réellement
 * configuré et des politiques RLS (voir `e2e/reel/`).
 */

test.describe('Commandes — parcours comptoir hors ligne', () => {
  test.beforeEach(async ({ page }) => {
    await entrerEnDemonstration(page)
  })

  test('crée une commande, la retrouve après rechargement et la recherche', async ({ page }) => {
    const identifiant = await creerCommande(page, {
      client: 'Awa Koné',
      telephone: '07 07 07 07 07',
      lignes: [
        { libelle: 'Chemise', quantite: 2, prixUnitaire: 1500 },
        { libelle: 'Pantalon', quantite: 1, prixUnitaire: 2000 },
      ],
    })

    // --- La fiche affiche ce qui vient d'être saisi -------------------------
    await expect(page.getByRole('heading', { name: 'Awa Koné' })).toBeVisible()
    // 2 × 1 500 + 1 × 2 000 = 5 000 FCFA : le total est calculé, pas recopié.
    await expect(page.getByText(/5\s?000\s?FCFA/).first()).toBeVisible()

    // --- Rechargement complet : la donnée vient d'IndexedDB ---------------
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/commandes/${identifiant}$`))
    await expect(page.getByRole('heading', { name: 'Awa Koné' })).toBeVisible()
    await expect(page.getByText(/5\s?000\s?FCFA/).first()).toBeVisible()

    // --- La liste retrouve la commande par recherche ----------------------
    await page.goto('/commandes')
    await page.getByLabel('Rechercher une commande').fill('Awa')
    await expect(page.getByText('Awa Koné').first()).toBeVisible()

    // Une recherche sans correspondance ne doit pas laisser la ligne affichée.
    await page.getByLabel('Rechercher une commande').fill('Zzzz-introuvable')
    await expect(page.getByText('Awa Koné')).toHaveCount(0)
  })

  test('refuse une commande sans nom de client et reste sur l’étape fautive', async ({ page }) => {
    await page.getByRole('link', { name: 'Nouvelle commande' }).first().click()
    await expect(page).toHaveURL(/\/commandes\/nouvelle$/)

    // Téléphone valide, nom vide : l'enregistrement ne doit pas aboutir.
    await page.getByLabel('Téléphone').fill('07 07 07 07 07')
    await page.getByRole('button', { name: 'Suivant' }).click()
    await page.getByRole('button', { name: 'Suivant' }).click()
    await page.getByRole('button', { name: 'Enregistrer la commande' }).click()

    // Une alerte explicite, et toujours sur le formulaire (aucune navigation).
    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(page).toHaveURL(/\/commandes\/nouvelle$/)
  })

  test('conserve deux commandes distinctes sans les confondre', async ({ page }) => {
    await creerCommande(page, {
      client: 'Awa Koné',
      telephone: '07 07 07 07 07',
      lignes: [{ libelle: 'Chemise', quantite: 1, prixUnitaire: 1000 }],
    })

    await page.goto('/commandes')
    const second = await creerCommande(page, {
      client: 'Koffi Yao',
      telephone: '05 05 05 05 05',
      lignes: [{ libelle: 'Rideau', quantite: 1, prixUnitaire: 4500 }],
    })

    await page.goto('/commandes')
    await expect(page.getByText('Awa Koné').first()).toBeVisible()
    await expect(page.getByText('Koffi Yao').first()).toBeVisible()

    // Chaque fiche garde ses propres lignes : le second total ne doit pas
    // contaminer la première commande.
    await page.goto(`/commandes/${second}`)
    await expect(page.getByText(/4\s?500\s?FCFA/).first()).toBeVisible()
  })
})
