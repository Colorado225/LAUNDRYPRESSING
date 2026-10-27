import { expect, test } from '@playwright/test'
import { creerCommande, entrerEnDemonstration } from '../helpers'

/**
 * Encaissement au comptoir, de bout en bout dans le navigateur.
 *
 * L'écriture est locale d'abord (l'atelier peut être hors ligne) : le reçu
 * s'affiche, le solde se met à jour, et la ligne d'encaissement survit à un
 * rechargement. C'est exactement la chaîne que les tests unitaires ne peuvent
 * pas prouver — ils mockent Dexie, ici c'est le vrai navigateur.
 */

test.describe('Encaissement en espèces', () => {
  test.beforeEach(async ({ page }) => {
    await entrerEnDemonstration(page)
  })

  test('encaisse un acompte, imprime le reçu et met à jour le reste à payer', async ({ page }) => {
    const identifiant = await creerCommande(page, {
      client: 'Awa Koné',
      telephone: '07 07 07 07 07',
      lignes: [{ libelle: 'Chemise', quantite: 4, prixUnitaire: 1500 }],
    })

    // Le panneau d'encaissement est replié : on l'ouvre comme au comptoir.
    await page.getByRole('button', { name: 'Encaisser en espèces' }).click()

    const montant = page.getByLabel('Montant reçu (FCFA)')
    await expect(montant).toBeVisible()
    // Le champ est pré-rempli avec le reste à payer : 6 000 FCFA.
    await expect(montant).toHaveValue('6000')

    // Acompte partiel : le solde doit rester dû après l'encaissement.
    await montant.fill('2000')
    await page.getByLabel('Note (facultatif)').fill('Acompte au comptoir')
    await page.getByRole('button', { name: 'Confirmer l’encaissement' }).click()

    // Redirection vers le reçu : la confirmation n'est affichée qu'après
    // l'écriture locale.
    await expect(page).toHaveURL(new RegExp(`/commandes/${identifiant}/recu$`))
    // `.first()` : la page de reçu existe deux fois dans le DOM, une copie
    // visible et une copie dédiée à l'impression (`#print-root`).
    await expect(page.getByText(/Reçu de dépôt/).first()).toBeVisible()

    // --- Retour sur la fiche : le solde a bougé ---------------------------
    await page.goto(`/commandes/${identifiant}`)
    await expect(page.getByText(/Reste à payer/)).toBeVisible()
    await expect(page.getByText(/4\s?000\s?FCFA/).first()).toBeVisible()
    await expect(page.getByText('Acompte au comptoir')).toBeVisible()

    // --- Rechargement : l'encaissement tient toujours ---------------------
    await page.reload()
    await expect(page.getByText(/4\s?000\s?FCFA/).first()).toBeVisible()
    await expect(page.getByText('Acompte au comptoir')).toBeVisible()

    // Une fois soldée, le bouton d'encaissement disparaît : on ne propose pas
    // d'encaisser deux fois la même chose.
    await page.getByRole('button', { name: 'Encaisser en espèces' }).click()
    await page.getByLabel('Montant reçu (FCFA)').fill('4000')
    await page.getByRole('button', { name: 'Confirmer l’encaissement' }).click()
    await expect(page).toHaveURL(new RegExp(`/commandes/${identifiant}/recu$`))
    await page.goto(`/commandes/${identifiant}`)
    await expect(page.getByRole('button', { name: 'Encaisser en espèces' })).toHaveCount(0)
  })

  test('ouvre le panneau espèces dès la création quand le règlement est immédiat', async ({
    page,
  }) => {
    const identifiant = await creerCommande(page, {
      client: 'Awa Koné',
      telephone: '07 07 07 07 07',
      lignes: [{ libelle: 'Chemise', quantite: 2, prixUnitaire: 1500 }],
      paiement: 'especes',
    })

    // La fiche s'ouvre avec le panneau déplié : le comptoir n'a pas à le chercher.
    await expect(page).toHaveURL(new RegExp(`/commandes/${identifiant}\\?regler=1$`))
    const montant = page.getByLabel('Montant reçu (FCFA)')
    await expect(montant).toBeVisible()
    await expect(montant).toHaveValue('3000')

    await page.getByRole('button', { name: 'Confirmer l’encaissement' }).click()
    await expect(page).toHaveURL(new RegExp(`/commandes/${identifiant}/recu$`))

    // Après le reçu, la fiche ne propose plus d'encaisser le solde : il est nul.
    await page.goto(`/commandes/${identifiant}`)
    await expect(page.getByText(/Reste à payer/)).toBeVisible()
    await expect(page.getByText(/0\s?FCFA/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Encaisser en espèces' })).toHaveCount(0)
  })

  test('n’affiche aucun bouton Mobile Money sans projet Supabase', async ({ page }) => {
    const identifiant = await creerCommande(page, {
      client: 'Koffi Yao',
      telephone: '05 05 05 05 05',
      lignes: [{ libelle: 'Rideau', quantite: 1, prixUnitaire: 4500 }],
    })

    await page.goto(`/commandes/${identifiant}`)

    // Règle produit : aucun paiement fictif. Sans backend ni clés marchandes,
    // la section Mobile Money ne doit pas exister du tout.
    await expect(page.getByText('Paiement Mobile Money')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Payer par Mobile Money' })).toHaveCount(0)
    await expect(page.getByText(/simulé/i)).toHaveCount(0)
  })
})

test.describe('Caisse', () => {
  test('la page de caisse s’ouvre et liste les encaissements du jour', async ({ page }) => {
    await entrerEnDemonstration(page)

    const identifiant = await creerCommande(page, {
      client: 'Awa Koné',
      telephone: '07 07 07 07 07',
      lignes: [{ libelle: 'Chemise', quantite: 1, prixUnitaire: 2000 }],
    })

    await page.goto(`/commandes/${identifiant}`)
    await page.getByRole('button', { name: 'Encaisser en espèces' }).click()
    await page.getByRole('button', { name: 'Confirmer l’encaissement' }).click()
    await expect(page).toHaveURL(/\/recu$/)

    await page.goto('/caisse')
    // L'encaissement du jour doit être visible dans le récapitulatif.
    await expect(page.getByText(/2\s?000\s?FCFA/).first()).toBeVisible()
  })
})
