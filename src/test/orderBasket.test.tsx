import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrderBasket, { type LignePanier } from '@/components/order/OrderBasket'
import OrderItemGrid from '@/components/order/OrderItemGrid'
import type { ArticleGrille } from '@/lib/orderServices'
import type { OrderGarmentType } from '@/types/database'

/**
 * Tests isolés des deux composants du parcours de commande.
 *
 * `orderForm.test.tsx` les couvre déjà à travers l'orchestrateur, mais un test
 * d'intégration ne dit pas *pourquoi* un écran se comporte mal : ici chaque
 * composant est monté seul, avec des props explicites, pour verrouiller son
 * contrat (unité affichée, valeur transmise à l'appelant, état vide).
 *
 * Ce que ces tests ne font pas : écrire en base. `OrderBasket` et
 * `OrderItemGrid` ne touchent ni à Dexie ni au réseau — c'est justement ce qui
 * les rend testables ainsi.
 */

let racine: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(element: React.ReactElement) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine!.render(element)
  })
}

afterEach(() => {
  if (racine) act(() => racine!.unmount())
  hote?.remove()
  racine = null
  hote = null
})

/** Texte rendu, espaces insécables et fines ramenées à un espace normal. */
function texte(): string {
  return (hote?.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')
}

function parLabel(label: string): HTMLElement {
  const element = hote?.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!element) throw new Error(`Élément « ${label} » introuvable.`)
  return element
}

async function saisir(element: HTMLElement, valeur: string) {
  const champ = element as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(champ, valeur)
    champ.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// ---------------------------------------------------------------------------
// Panier
// ---------------------------------------------------------------------------

const CHEMISE: LignePanier = {
  id: 'ligne-1',
  libelle: 'Chemise',
  quantite: 2,
  unite: 'PIECE',
  prixUnitaire: 1500,
  total: 3000,
}

const LOT: LignePanier = {
  id: 'ligne-2',
  libelle: 'Lavage au kilo',
  detail: '2 × Drap · 1 × Serviette',
  quantite: 3,
  unite: 'KG',
  prixUnitaire: 2000,
  total: 6000,
}

function panier(lignes: LignePanier[], total: number, extras: Partial<{
  onQuantite: (id: string, valeur: number) => void
  onPrix: (id: string, valeur: number) => void
  onSupprimer: (id: string) => void
  onVider: () => void
}> = {}) {
  return (
    <OrderBasket
      lignes={lignes}
      total={total}
      onQuantite={extras.onQuantite ?? (() => undefined)}
      onPrix={extras.onPrix ?? (() => undefined)}
      onSupprimer={extras.onSupprimer ?? (() => undefined)}
      onVider={extras.onVider}
    />
  )
}

describe('OrderBasket — panier du comptoir', () => {
  it('affiche un état vide explicite plutôt qu’un panier muet', async () => {
    await monter(panier([], 0))

    expect(texte()).toContain('Aucun article pour le moment.')
    expect(texte()).toContain('Touchez un article dans la grille pour commencer la commande.')
    // Rien à vider, rien à supprimer : aucun bouton ne doit apparaître.
    expect(hote?.querySelector('button')).toBeNull()
    expect(texte()).toContain('0 FCFA')
  })

  it('compte les pièces, pas les kilos, et affiche le total transmis', async () => {
    // Le total vient du parent : le panier ne le recalcule pas, il l'affiche.
    // Un total volontairement faux prouve que c'est bien la prop qui est rendue.
    await monter(panier([CHEMISE, LOT], 9999))

    expect(texte()).toContain('2 pièces · 2 lignes')
    expect(texte()).toContain('9 999 FCFA')
    // Les deux totaux de ligne, eux, viennent des lignes.
    expect(texte()).toContain('3 000 FCFA')
    expect(texte()).toContain('6 000 FCFA')
  })

  it('parle en pièces pour un vêtement et en kilos pour un lot', async () => {
    await monter(panier([CHEMISE, LOT], 9000))

    // Unité PIECE : quantité entière, prix unitaire.
    expect(texte()).toContain('Quantité')
    expect(texte()).toContain('Prix unitaire (FCFA)')
    // Unité KG : poids pesé, tarif au kilo — les mots changent, pas seulement
    // l'unité affichée à côté du nombre.
    expect(texte()).toContain('Poids (kg)')
    expect(texte()).toContain('Tarif/kg (FCFA)')
    // La composition du lot reste visible sous le libellé.
    expect(texte()).toContain('2 × Drap · 1 × Serviette')
  })

  it('transmet la quantité saisie avec l’identifiant de sa ligne', async () => {
    const onQuantite = vi.fn()
    await monter(panier([CHEMISE, LOT], 9000, { onQuantite }))

    await saisir(parLabel('Quantité Chemise'), '5')
    expect(onQuantite).toHaveBeenLastCalledWith('ligne-1', 5)

    await saisir(parLabel('Quantité Lavage au kilo'), '4.5')
    expect(onQuantite).toHaveBeenLastCalledWith('ligne-2', 4.5)
  })

  it('transmet le prix corrigé, au kilo comme à la pièce', async () => {
    const onPrix = vi.fn()
    await monter(panier([CHEMISE, LOT], 9000, { onPrix }))

    await saisir(parLabel('Prix unitaire Chemise (FCFA)'), '1750')
    expect(onPrix).toHaveBeenLastCalledWith('ligne-1', 1750)

    await saisir(parLabel('Tarif au kilo Lavage au kilo (FCFA)'), '2500')
    expect(onPrix).toHaveBeenLastCalledWith('ligne-2', 2500)
  })

  it('supprime la bonne ligne et vide le panier sur demande', async () => {
    const onSupprimer = vi.fn()
    const onVider = vi.fn()
    await monter(panier([CHEMISE, LOT], 9000, { onSupprimer, onVider }))

    // Le nom accessible porte le libellé : deux lignes ne se confondent pas.
    await act(async () => {
      parLabel('Supprimer Lavage au kilo').click()
    })
    expect(onSupprimer).toHaveBeenCalledWith('ligne-2')

    await act(async () => {
      parLabel('Supprimer Chemise').click()
    })
    expect(onSupprimer).toHaveBeenLastCalledWith('ligne-1')

    const vider = [...(hote?.querySelectorAll('button') ?? [])].find((bouton) =>
      bouton.textContent?.includes('Vider'),
    )
    await act(async () => {
      vider?.click()
    })
    expect(onVider).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Grille d'articles
// ---------------------------------------------------------------------------

const ARTICLES: ArticleGrille[] = [
  { type: 'CHEMISE', libelle: 'Chemise', image: '/images/chemise.png', categorie: 'Quotidien', favori: true },
  { type: 'PANTALON', libelle: 'Pantalon', image: '/images/pantalon.png', categorie: 'Quotidien', favori: false },
  { type: 'AUTRE', libelle: 'Écharpe', image: '/images/autre.png', categorie: 'Divers', favori: false },
]

function grille(
  onAjouter: (type: OrderGarmentType) => void,
  quantites: Partial<Record<OrderGarmentType, number>> = {},
  legende?: string,
) {
  return (
    <OrderItemGrid articles={ARTICLES} quantites={quantites} onAjouter={onAjouter} legende={legende} />
  )
}

describe('OrderItemGrid — grille tactile', () => {
  it('groupe les articles par catégorie et nomme chaque tuile', async () => {
    await monter(grille(() => undefined))

    const sections = [...(hote?.querySelectorAll('section[aria-label]') ?? [])].map((section) =>
      section.getAttribute('aria-label'),
    )
    expect(sections).toEqual(['Quotidien', 'Divers'])
    expect(parLabel('Ajouter Chemise')).toBeTruthy()
    expect(parLabel('Ajouter Écharpe')).toBeTruthy()
  })

  it('ajoute l’article touché, avec son type métier', async () => {
    const onAjouter = vi.fn()
    await monter(grille(onAjouter))

    await act(async () => {
      parLabel('Ajouter Pantalon').click()
    })
    expect(onAjouter).toHaveBeenCalledWith('PANTALON')
  })

  it('affiche la quantité déjà retenue et rien quand elle est nulle', async () => {
    await monter(grille(() => undefined, { CHEMISE: 3 }))

    expect(parLabel('Ajouter Chemise').textContent).toContain('3')
    expect(parLabel('Ajouter Pantalon').textContent).not.toMatch(/\d/)
  })

  it('filtre sans tenir compte de la casse ni des accents', async () => {
    await monter(grille(() => undefined))

    await saisir(parLabel('Rechercher un article'), 'ECHARPE')
    expect(parLabel('Ajouter Écharpe')).toBeTruthy()
    expect(hote?.querySelector('[aria-label="Ajouter Chemise"]')).toBeNull()

    // La recherche porte aussi sur la catégorie.
    await saisir(parLabel('Rechercher un article'), 'quotidien')
    expect(parLabel('Ajouter Chemise')).toBeTruthy()
    expect(hote?.querySelector('[aria-label="Ajouter Écharpe"]')).toBeNull()
  })

  it('annonce l’absence de résultat au lieu d’une grille vide', async () => {
    await monter(grille(() => undefined))

    await saisir(parLabel('Rechercher un article'), 'manteau')
    expect(texte()).toContain('Aucun article ne correspond à « manteau ».')
  })

  it('utilise les icônes livrées avec l’application, sans image distante', async () => {
    await monter(grille(() => undefined))

    const images = [...(hote?.querySelectorAll('img') ?? [])]
    expect(images).toHaveLength(ARTICLES.length)
    for (const image of images) {
      expect(image.getAttribute('src')).toMatch(/^\/images\//)
      // Décoratives : le libellé du bouton porte déjà l'information.
      expect(image.getAttribute('alt')).toBe('')
    }
  })

  it('accepte une légende adaptée au parcours blanchisserie', async () => {
    await monter(grille(() => undefined, {}, 'Touchez le linge déposé : il rejoint le lot pesé.'))

    expect(texte()).toContain('Touchez le linge déposé : il rejoint le lot pesé.')
  })
})

describe('OrderItemGrid — filtres et prix indicatifs', () => {
  it('filtre la grille par catégorie avec une pastille active', async () => {
    await monter(grille(() => undefined))

    const pastille = (nom: string) =>
      [...(hote?.querySelectorAll('button') ?? [])].find(
        (bouton) => bouton.textContent?.trim() === nom,
      )

    // « Tous » est actif au départ.
    expect(pastille('Tous')?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => pastille('Divers')?.click())

    expect(pastille('Divers')?.getAttribute('aria-pressed')).toBe('true')
    expect(parLabel('Ajouter Écharpe')).toBeTruthy()
    expect(hote?.querySelector('[aria-label="Ajouter Chemise"]')).toBeNull()

    await act(async () => pastille('Tous')?.click())
    expect(parLabel('Ajouter Chemise')).toBeTruthy()
  })

  it('n’affiche un prix que lorsque l’appelant en fournit un', async () => {
    await monter(grille(() => undefined))
    expect(texte()).not.toContain('FCFA')

    await monter(
      <OrderItemGrid
        articles={ARTICLES}
        quantites={{}}
        onAjouter={() => undefined}
        prix={{ CHEMISE: 2500 }}
      />,
    )

    expect(texte()).toContain('2 500 FCFA')
    // Un seul prix fourni : les autres tuiles restent sans montant.
    expect(texte()).not.toContain('Pantalon2 500')
  })
})
