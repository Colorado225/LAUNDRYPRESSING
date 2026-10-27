import { expect, type Page } from '@playwright/test'

/**
 * Gestes partagés par les scénarios de bout en bout.
 *
 * Les sélecteurs privilégient le **rôle** et le **libellé accessible** plutôt
 * que les classes CSS : un changement de style ne doit pas casser un test, un
 * changement de libellé visible par l'utilisateur, si.
 */

/** Identifiant du pressing fictif utilisé hors ligne (cf. playwright.config.ts). */
export const TENANT_DEMO = '11111111-1111-4111-8111-111111111111'

/**
 * Entre dans l'application en mode démonstration (aucun projet Supabase
 * configuré). Renvoie quand la liste des commandes est affichée.
 */
export async function entrerEnDemonstration(page: Page, nom = 'Pressing Recette'): Promise<void> {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Choisir le pressing' })).toBeVisible()

  const identifiant = page.getByLabel('Identifiant du pressing (UUID)')
  await identifiant.fill(TENANT_DEMO)
  await page.getByLabel('Nom affiché (optionnel)').fill(nom)

  await page.getByRole('button', { name: 'Continuer' }).click()

  // Le garde d'onboarding ne doit pas renvoyer vers /bienvenue en démonstration.
  await expect(page).toHaveURL(/\/commandes$/)
}

export interface LigneCommande {
  libelle: string
  quantite: number
  prixUnitaire: number
}

/**
 * Crée une commande par l'interface, exactement comme au comptoir :
 * informations client → lignes → confirmation. Renvoie l'identifiant de la
 * commande lu dans l'URL de la fiche.
 */
export async function creerCommande(
  page: Page,
  options: {
    client: string
    telephone: string
    lignes: LigneCommande[]
    /**
     * `plus-tard` (défaut) laisse le solde dû sur la fiche ; `especes` choisit
     * l'encaissement immédiat, et la fiche s'ouvre alors avec le panneau
     * espèces déjà déplié (`?regler=1`).
     */
    paiement?: 'plus-tard' | 'especes'
  },
): Promise<string> {
  await page.getByRole('link', { name: 'Nouvelle commande' }).first().click()
  await expect(page).toHaveURL(/\/commandes\/nouvelle$/)

  // --- Étape 1 : client -----------------------------------------------------
  await page.getByLabel('Nom du client').fill(options.client)
  await page.getByLabel('Téléphone').fill(options.telephone)
  await page.getByRole('button', { name: 'Suivant' }).click()

  // --- Étape 2 : lignes -----------------------------------------------------
  for (const [index, ligne] of options.lignes.entries()) {
    if (index > 0) {
      await page.getByRole('button', { name: 'Ajouter une ligne' }).click()
    }
    await page.getByPlaceholder('Ex. Chemise').nth(index).fill(ligne.libelle)
    await page.getByLabel(`Quantité ligne ${index + 1}`).fill(String(ligne.quantite))
    await page
      .getByLabel(`Prix unitaire ligne ${index + 1} (FCFA)`)
      .fill(String(ligne.prixUnitaire))
  }
  await page.getByRole('button', { name: 'Suivant' }).click()

  // --- Étape 3 : règlement --------------------------------------------------
  const libellePaiement =
    options.paiement === 'especes' ? 'Encaisser des espèces maintenant' : 'Régler plus tard'
  await page.getByRole('button', { name: libellePaiement }).click()

  await page.getByRole('button', { name: 'Enregistrer la commande' }).click()

  await expect(page).toHaveURL(/\/commandes\/[0-9a-f-]{36}/)
  const identifiant = page.url().match(/\/commandes\/([0-9a-f-]{36})/)?.[1]
  if (!identifiant) throw new Error(`Identifiant de commande illisible dans l'URL : ${page.url()}`)
  return identifiant
}

/** Lit un montant en FCFA affiché et le renvoie en entier (3000 depuis « 3 000 FCFA »). */
export function montantAffiche(texte: string | null): number | null {
  const chiffres = (texte ?? '').replace(/[^\d]/g, '')
  return chiffres ? Number(chiffres) : null
}
