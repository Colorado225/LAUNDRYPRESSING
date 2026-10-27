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

export type ParcoursCommande = 'pressing' | 'blanchisserie'

export interface ArticleCommande {
  /** Nom de la tuile de la grille (Chemise, Drap…) ou libellé libre. */
  libelle: string
  quantite: number
  /** Prix unitaire saisi au panier (FCFA). */
  prixUnitaire: number
}

export interface OptionsCommande {
  client: string
  telephone: string
  articles: ArticleCommande[]
  parcours?: ParcoursCommande
  /**
   * Blanchisserie : facturation **au vêtement** (défaut) ou **au kilo**.
   * Sans valeur explicite, la présence de `poidsKg`/`tarifKilo` choisit le kilo.
   */
  modeBlanchisserie?: 'piece' | 'kilo'
  /** Blanchisserie au kilo : poids pesé et tarif au kilo du lot. */
  poidsKg?: number
  tarifKilo?: number
  /** `especes` ouvre le panneau d'encaissement dès la création (`?regler=1`). */
  paiement?: 'plus-tard' | 'especes'
}

/**
 * Ouvre l'écran 1 et choisit le service.
 *
 * On passe par le vrai bouton de la carte : c'est ce que fait le
 * réceptionniste, et cela vérifie au passage que la carte est actionnable.
 */
export async function choisirParcours(page: Page, parcours: ParcoursCommande): Promise<void> {
  const titre = parcours === 'pressing' ? 'Pressing' : 'Blanchisserie'
  await page.getByRole('button', { name: `Choisir ${titre}` }).click()
  await expect(
    page.getByRole('heading', { name: `${titre} — client et articles` }),
  ).toBeVisible()
}

/** Ajoute un article par la grille (ou par la ligne libre) et fixe son prix. */
async function ajouterArticle(
  page: Page,
  article: ArticleCommande,
  quantite = article.quantite,
): Promise<void> {
  const tuile = page.getByRole('button', { name: `Ajouter ${article.libelle}`, exact: true })

  if ((await tuile.count()) > 0) {
    for (let appui = 0; appui < quantite; appui += 1) {
      await tuile.click()
    }
  } else {
    await page.getByLabel('Libellé de l’article libre').fill(article.libelle)
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
    await page.getByLabel(`Quantité ${article.libelle}`).fill(String(quantite))
  }

  await page.getByLabel(`Prix unitaire ${article.libelle} (FCFA)`).fill(String(article.prixUnitaire))
}

/**
 * Crée une commande par l'interface, exactement comme au comptoir :
 * choix du service → client et articles → récapitulatif → enregistrement.
 * Renvoie l'identifiant de la commande lu dans l'URL de la fiche.
 */
export async function creerCommande(page: Page, options: OptionsCommande): Promise<string> {
  const parcours = options.parcours ?? 'pressing'

  await page.getByRole('link', { name: 'Nouvelle commande' }).first().click()
  await expect(page).toHaveURL(/\/commandes\/nouvelle$/)

  await choisirParcours(page, parcours)

  await page.getByLabel('Nom du client').fill(options.client)
  await page.getByLabel('Téléphone').fill(options.telephone)

  if (parcours === 'blanchisserie') {
    // Deux facturations : au vêtement (défaut) ou au kilo (option explicite).
    // La bascule se fait **avant** d'ajouter des lignes : changer de mode avec
    // un panier garni demande une confirmation au navigateur.
    const auKilo =
      options.modeBlanchisserie === 'kilo' ||
      (options.modeBlanchisserie === undefined &&
        (options.poidsKg !== undefined || options.tarifKilo !== undefined))
    const bascule = page.getByRole('button', {
      name: auKilo ? 'Facturer au kilo' : 'Facturer au vêtement',
    })
    if ((await bascule.count()) > 0) await bascule.click()

    // Chaque tuile ajoute une pièce : au panier (au vêtement) ou à la
    // composition du lot (au kilo).
    for (const article of options.articles) {
      const tuile = page.getByRole('button', { name: `Ajouter ${article.libelle}`, exact: true })
      for (let appui = 0; appui < article.quantite; appui += 1) {
        await tuile.click()
      }
    }

    if (auKilo) {
      const poids = options.poidsKg ?? 1
      const tarif = options.tarifKilo ?? options.articles[0]?.prixUnitaire ?? 0
      await page.getByLabel('Quantité Lavage au kilo').fill(String(poids))
      await page.getByLabel('Tarif au kilo Lavage au kilo (FCFA)').fill(String(tarif))
    } else {
      // Le prix de chaque article se saisit au panier (le forfait configuré
      // fait foi quand il existe, mais il n'y a pas de catalogue en démo).
      for (const article of options.articles) {
        await page
          .getByLabel(`Prix unitaire ${article.libelle} (FCFA)`)
          .fill(String(article.prixUnitaire))
      }
    }
  } else {
    for (const article of options.articles) {
      await ajouterArticle(page, article)
    }
  }

  // --- Récapitulatif ---------------------------------------------------------
  await page.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('heading', { name: 'Récapitulatif' })).toBeVisible()

  if (options.paiement === 'especes') {
    await page.getByRole('button', { name: 'Encaisser des espèces maintenant' }).click()
  }

  await page.getByRole('button', { name: 'Enregistrer la commande' }).click()

  await expect(page).toHaveURL(/\/commandes\/[0-9a-f-]{36}(\?regler=1)?$/)
  const identifiant = page.url().match(/\/commandes\/([0-9a-f-]{36})/)?.[1]
  if (!identifiant) throw new Error(`Identifiant de commande illisible dans l'URL : ${page.url()}`)
  return identifiant
}

/** Lit un montant en FCFA affiché et le renvoie en entier (3000 depuis « 3 000 FCFA »). */
export function montantAffiche(texte: string | null): number | null {
  const chiffres = (texte ?? '').replace(/[^\d]/g, '')
  return chiffres ? Number(chiffres) : null
}
