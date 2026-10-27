import { expect, test } from '@playwright/test'
import { creerCommande, entrerEnDemonstration } from '../helpers'

/**
 * Blanchisserie : le linge se compte **au vêtement**, le kilo reste une option.
 *
 * Deux scénarios, un par facturation :
 *
 *  - au vêtement (défaut) : chaque tuile ajoute une pièce facturée à son prix
 *    d'article, sans aucun poids à inventer ;
 *  - au kilo (bascule explicite) : la composition du lot, le poids et le
 *    tarif/kg sont conservés.
 *
 * Dans les deux cas la commande est relue **après rechargement** pour prouver
 * que la ligne est persistée avec son unité — et non seulement affichée.
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
    // Le comptage des vêtements est le mode par défaut : on demande le pesage.
    await page.getByRole('button', { name: 'Facturer au kilo' }).click()

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

  test('compte les vêtements et facture le prix de chaque article', async ({ page }) => {
    const identifiant = await creerCommande(page, {
      client: 'Hôtel Ivoire',
      telephone: '05 05 05 05 07',
      parcours: 'blanchisserie',
      articles: [
        { libelle: 'Drap', quantite: 2, prixUnitaire: 500 },
        { libelle: 'Serviette', quantite: 1, prixUnitaire: 300 },
      ],
    })

    // 2 × 500 + 1 × 300 = 1 300 FCFA, sans aucun poids saisi.
    await expect(page.getByRole('heading', { name: 'Hôtel Ivoire' })).toBeVisible()
    await expect(page.getByText(/1\s?300\s?FCFA/).first()).toBeVisible()
    await expect(page.getByText(/500\s?FCFA\/pièce/).first()).toBeVisible()
    // Aucune ligne au kilo ne doit subsister dans une commande comptée.
    await expect(page.getByText(/FCFA\/kg/)).toHaveCount(0)

    // --- Rechargement complet : la donnée vient d'IndexedDB ---------------
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/commandes/${identifiant}$`))
    await expect(page.getByText(/1\s?300\s?FCFA/).first()).toBeVisible()
    await expect(page.getByText(/500\s?FCFA\/pièce/).first()).toBeVisible()
  })
})
