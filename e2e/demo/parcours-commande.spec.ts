import { expect, test } from '@playwright/test'
import { choisirParcours, creerCommande, entrerEnDemonstration } from '../helpers'

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
      articles: [
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

  test('le choix du service ouvre bien la grille correspondante', async ({ page }) => {
    await page.getByRole('link', { name: 'Nouvelle commande' }).first().click()
    await expect(page).toHaveURL(/\/commandes\/nouvelle$/)

    // Écran 1 : deux cartes réelles, actionnables au clavier comme à la souris.
    await expect(page.getByRole('button', { name: 'Choisir Pressing' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choisir Blanchisserie' })).toBeVisible()

    await choisirParcours(page, 'pressing')
    await expect(page.getByRole('button', { name: 'Ajouter Chemise' })).toBeVisible()
    // Le linge de lit n'appartient pas au parcours pressing.
    await expect(page.getByRole('button', { name: 'Ajouter Drap', exact: true })).toHaveCount(0)

    // Retour à l'écran 1, puis parcours blanchisserie.
    await page.getByRole('button', { name: 'Précédent' }).click()
    await choisirParcours(page, 'blanchisserie')
    await expect(page.getByRole('button', { name: 'Ajouter Drap' })).toBeVisible()
    // Le lot au kilo existe dès l'arrivée : poids et tarif saisissables.
    await expect(page.getByLabel('Quantité Lavage au kilo')).toBeVisible()
  })

  test('la grille et le panier font le calcul attendu', async ({ page }) => {
    await page.getByRole('link', { name: 'Nouvelle commande' }).first().click()
    await choisirParcours(page, 'pressing')

    await page.getByRole('button', { name: 'Ajouter Chemise' }).click()
    await page.getByRole('button', { name: 'Ajouter Chemise' }).click()
    await page.getByLabel('Prix unitaire Chemise (FCFA)').fill('1500')
    await expect(page.getByText(/3\s?000\s?FCFA/).first()).toBeVisible()

    // Correction de quantité au panier : le total suit.
    await page.getByLabel('Quantité Chemise').fill('3')
    await expect(page.getByText(/4\s?500\s?FCFA/).first()).toBeVisible()

    // Suppression : le panier se vide et le total retombe à zéro.
    await page.getByRole('button', { name: 'Supprimer Chemise' }).click()
    await expect(page.getByText('Aucun article pour le moment.')).toBeVisible()
    await expect(page.getByText(/^0\s?FCFA$/).first()).toBeVisible()

    // Rien n'a été enregistré : on est toujours sur le formulaire.
    await expect(page).toHaveURL(/\/commandes\/nouvelle$/)
  })

  test('refuse une commande sans nom de client et reste sur le formulaire', async ({ page }) => {
    await page.getByRole('link', { name: 'Nouvelle commande' }).first().click()
    await choisirParcours(page, 'pressing')

    // Téléphone valide, nom vide, une ligne chiffrée : l'enregistrement doit
    // échouer explicitement, sans quitter le formulaire.
    await page.getByLabel('Téléphone').fill('07 07 07 07 07')
    await page.getByRole('button', { name: 'Ajouter Chemise' }).click()
    await page.getByLabel('Prix unitaire Chemise (FCFA)').fill('1000')

    await page.getByRole('button', { name: 'Suivant' }).click()
    await expect(page.getByRole('heading', { name: 'Récapitulatif' })).toBeVisible()
    // Le récapitulatif annonce déjà le défaut, avant le clic.
    await expect(page.getByRole('alert')).toContainText('Le nom du client est obligatoire')

    await page.getByRole('button', { name: 'Enregistrer la commande' }).click()

    await expect(page).toHaveURL(/\/commandes\/nouvelle$/)
    await expect(page.getByText('Pressing — client et articles')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Le nom du client est obligatoire')
  })

  test('refuse une ligne à 0 FCFA avant tout envoi', async ({ page }) => {
    await page.getByRole('link', { name: 'Nouvelle commande' }).first().click()
    await choisirParcours(page, 'pressing')

    await page.getByLabel('Nom du client').fill('Awa Koné')
    await page.getByLabel('Téléphone').fill('07 07 07 07 07')
    await page.getByRole('button', { name: 'Ajouter Chemise' }).click()

    await page.getByRole('button', { name: 'Suivant' }).click()
    await page.getByRole('button', { name: 'Enregistrer la commande' }).click()

    // Toujours sur le formulaire, avec le motif exact du refus.
    await expect(page).toHaveURL(/\/commandes\/nouvelle$/)
    await expect(page.getByRole('alert')).toContainText('prix unitaire')
  })

  test('conserve deux commandes distinctes sans les confondre', async ({ page }) => {
    await creerCommande(page, {
      client: 'Awa Koné',
      telephone: '07 07 07 07 07',
      articles: [{ libelle: 'Chemise', quantite: 1, prixUnitaire: 1000 }],
    })

    await page.goto('/commandes')
    const second = await creerCommande(page, {
      client: 'Koffi Yao',
      telephone: '05 05 05 05 05',
      articles: [{ libelle: 'Rideau', quantite: 1, prixUnitaire: 4500 }],
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
