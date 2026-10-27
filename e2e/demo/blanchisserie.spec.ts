import { expect, test } from '@playwright/test'
import { creerCommande, entrerEnDemonstration } from '../helpers'

/**
 * Blanchisserie : linge pesé, facturé au kilo.
 *
 * Le scénario vérifie la chaîne complète du second parcours : composition du lot
 * saisie à la grille (drap, serviette), poids et tarif au kilo, enregistrement,
 * puis relecture **après rechargement** pour prouver que la ligne est bien
 * persistée avec son unité et sa composition — et non seulement affichée.
 */

test.describe('Commandes — parcours blanchisserie', () => {
  test.beforeEach(async ({ page }) => {
    await entrerEnDemonstration(page)
  })

  test('enregistre un lot au kilo avec sa composition et le retrouve', async ({ page }) => {
    const identifiant = await creerCommande(page, {
      client: 'Hôtel Ivoire',
      telephone: '05 05 05 05 06',
      parcours: 'blanchisserie',
      articles: [
        { libelle: 'Drap', quantite: 2, prixUnitaire: 0 },
        { libelle: 'Serviette', quantite: 1, prixUnitaire: 0 },
      ],
      poidsKg: 3,
      tarifKilo: 2000,
    })

    // 3 kg × 2 000 FCFA = 6 000 FCFA.
    await expect(page.getByRole('heading', { name: 'Hôtel Ivoire' })).toBeVisible()
    await expect(page.getByText(/6\s?000\s?FCFA/).first()).toBeVisible()

    // La ligne est bien facturée au kilo, avec la composition du lot.
    await expect(page.getByText(/2\s?000\s?FCFA\/kg/)).toBeVisible()
    await expect(page.getByText(/Vêtements\s?:\s?2 × Drap/)).toBeVisible()

    // --- Rechargement complet : la donnée vient d'IndexedDB ---------------
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/commandes/${identifiant}$`))
    await expect(page.getByRole('heading', { name: 'Hôtel Ivoire' })).toBeVisible()
    await expect(page.getByText(/6\s?000\s?FCFA/).first()).toBeVisible()
    await expect(page.getByText(/Vêtements\s?:\s?2 × Drap/)).toBeVisible()
  })

  test('le poids saisi fait varier le total au kilo', async ({ page }) => {
    await page.getByRole('link', { name: 'Nouvelle commande' }).first().click()
    await page.getByRole('button', { name: 'Choisir Blanchisserie' }).click()

    await page.getByRole('button', { name: 'Ajouter Drap' }).click()
    await page.getByLabel('Tarif au kilo Lavage au kilo (FCFA)').fill('2500')

    // 1 kg par défaut.
    await expect(page.getByText(/2\s?500\s?FCFA/).first()).toBeVisible()

    await page.getByLabel('Quantité Lavage au kilo').fill('4')
    await expect(page.getByText(/10\s?000\s?FCFA/).first()).toBeVisible()

    // Le tarif à zéro reste refusé, comme pour une ligne à la pièce.
    await page.getByLabel('Nom du client').fill('Hôtel Ivoire')
    await page.getByLabel('Téléphone').fill('05 05 05 05 06')
    await page.getByLabel('Tarif au kilo Lavage au kilo (FCFA)').fill('0')
    await page.getByRole('button', { name: 'Suivant' }).click()
    await page.getByRole('button', { name: 'Enregistrer la commande' }).click()

    await expect(page).toHaveURL(/\/commandes\/nouvelle$/)
    // Un lot au kilo n'a pas de « prix unitaire » : le refus parle en kilos.
    await expect(page.getByRole('alert')).toContainText('tarif au kilo')
  })
})
