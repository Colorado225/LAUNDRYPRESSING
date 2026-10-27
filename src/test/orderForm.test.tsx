import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'
import { useDemoStore } from '@/lib/demoMode'
import { createOrderSchema, normalizePhoneCi } from '@/schemas/order'
import toast from 'react-hot-toast'

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))

// Le toast est l'un des deux signaux visibles d'un blocage de validation :
// on l'espionne pour vérifier qu'un « Suivant » refusé n'est jamais muet.
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const clientFactice = vi.hoisted(() => {
  const chaine: Record<string, unknown> = {
    select: () => chaine,
    eq: () => chaine,
    order: () => chaine,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resoudre: (valeur: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resoudre),
  }
  return { from: () => chaine, rpc: () => Promise.resolve({ data: null, error: null }) }
})

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => clientFactice }))

// L'envoi immédiat est piloté : ce qui se vérifie ici, c'est la réaction du
// formulaire (message, navigation), pas la requête elle-même.
const envoi = vi.hoisted(() => ({
  resultat: { statut: 'synced', version: 1 } as Record<string, unknown>,
  appels: [] as string[],
  incidents: [] as string[],
}))

vi.mock('@/sync/syncEngine', () => ({
  syncOrderNow: (orderId: string) => {
    envoi.appels.push(orderId)
    return Promise.resolve(envoi.resultat)
  },
  signalerIncidentCommande: (message: string) => {
    envoi.incidents.push(message)
    return Promise.resolve()
  },
  signalerSonde: () => Promise.resolve(),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'

const OrderForm = (await import('@/pages/OrderForm')).default

let racine: Root
let hote: HTMLDivElement

async function monter() {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(
      <MemoryRouter initialEntries={['/commandes/nouvelle']}>
        <OrderForm />
      </MemoryRouter>,
    )
  })
  await act(async () => {
    await new Promise((resoudre) => setTimeout(resoudre, 0))
  })
}

function demonter() {
  act(() => racine.unmount())
  hote.remove()
}

/** Texte rendu, espaces insécables comprises ramenées à un espace normal. */
function texte(): string {
  return (hote.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')
}

function bouton(libelle: string): HTMLButtonElement {
  const trouve = Array.from(hote.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === libelle,
  )
  if (!trouve) throw new Error(`Bouton « ${libelle} » introuvable`)
  return trouve as HTMLButtonElement
}

/** Bouton repéré par son libellé accessible (`aria-label`). */
function boutonAria(libelle: string): HTMLButtonElement {
  const trouve = Array.from(hote.querySelectorAll('button')).find(
    (element) => element.getAttribute('aria-label') === libelle,
  )
  if (!trouve) throw new Error(`Bouton accessible « ${libelle} » introuvable`)
  return trouve as HTMLButtonElement
}

function champ(libelle: string): HTMLInputElement {
  const label = Array.from(hote.querySelectorAll('label')).find((element) =>
    element.textContent?.includes(libelle),
  )
  const input = label?.querySelector('input')
  if (!input) throw new Error(`Champ « ${libelle} » introuvable`)
  return input as HTMLInputElement
}

/** Champ repéré par son libellé accessible (`aria-label`). */
function champAria(libelle: string): HTMLInputElement {
  const trouve = hote.querySelector<HTMLInputElement>(`input[aria-label="${libelle}"]`)
  if (!trouve) throw new Error(`Champ accessible « ${libelle} » introuvable`)
  return trouve
}

async function saisir(input: HTMLInputElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, valeur)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function cliquer(element: HTMLButtonElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resoudre) => setTimeout(resoudre, 0))
  })
}

/** Ouvre le parcours pressing et prépare le strict nécessaire. */
async function ouvrirPressing() {
  await monter()
  await cliquer(boutonAria('Choisir Pressing'))
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  envoi.appels.length = 0
  envoi.incidents.length = 0
  envoi.resultat = { statut: 'synced', version: 1 }
  vi.mocked(toast).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.success).mockClear()
  useTenantStore.setState({ tenantId: TENANT, role: 'owner', tenantName: 'Pressing Test' })
})

describe('validation des données de commande', () => {
  it('accepte un nom et un numéro ivoirien à 10 chiffres', () => {
    const resultat = createOrderSchema
      .pick({ customerName: true, customerPhone: true, dueDate: true })
      .safeParse({ customerName: 'Awa Koné', customerPhone: '07 00 00 00 00', dueDate: undefined })

    expect(resultat.success).toBe(true)
  })

  it('nettoie un numéro collé depuis un carnet de contacts', () => {
    // Espace insécable, espace fine insécable, espace de largeur nulle, tirets.
    expect(normalizePhoneCi('+225 07\u00a000\u202f00\u200b00\u00a000')).toBe('0700000000')
    expect(normalizePhoneCi('00225-07-00-00-00-00')).toBe('0700000000')
    expect(normalizePhoneCi('07.00.00.00.00')).toBe('0700000000')
    expect(normalizePhoneCi('0700000000')).toBe('0700000000')
  })

  it('refuse toujours un numéro trop court', () => {
    const resultat = createOrderSchema
      .pick({ customerName: true, customerPhone: true, dueDate: true })
      .safeParse({ customerName: 'Awa Koné', customerPhone: '0700', dueDate: undefined })

    expect(resultat.success).toBe(false)
  })
})

describe('écran 1 — choix du service', () => {
  it('propose les deux parcours dès l’ouverture', async () => {
    await monter()

    expect(boutonAria('Choisir Pressing')).toBeTruthy()
    expect(boutonAria('Choisir Blanchisserie')).toBeTruthy()
    // Aucun catalogue configuré : l'écran doit le dire, sans bloquer.
    expect(hote.textContent).toContain('Aucune prestation n’est configurée')

    demonter()
  })

  it('ouvre la grille d’articles du parcours pressing', async () => {
    await ouvrirPressing()

    expect(hote.textContent).toContain('Pressing — client et articles')
    expect(boutonAria('Ajouter Chemise')).toBeTruthy()
    // Le linge de lit n'appartient pas au parcours pressing.
    expect(hote.querySelector('button[aria-label="Ajouter Drap"]')).toBeNull()

    demonter()
  })

  it('ouvre le parcours blanchisserie sur le comptage des vêtements', async () => {
    await monter()
    await cliquer(boutonAria('Choisir Blanchisserie'))

    expect(hote.textContent).toContain('Blanchisserie — client et articles')
    // Aucun catalogue : le comptage reste possible, chaque prix se saisissant
    // au panier. Le lot pesé n'apparaît que si le comptoir le demande.
    expect(boutonAria('Facturer au vêtement').getAttribute('aria-pressed')).toBe('true')
    expect(hote.querySelector('input[aria-label="Quantité Lavage au kilo"]')).toBeNull()
    expect(hote.querySelector('button[aria-label="Ajouter Drap"]')).toBeTruthy()

    // Le kilo reste à un clic, avec son lot prêt à saisir.
    await cliquer(boutonAria('Facturer au kilo'))
    expect(champAria('Quantité Lavage au kilo')).toBeTruthy()
    expect(champAria('Tarif au kilo Lavage au kilo (FCFA)')).toBeTruthy()

    demonter()
  })
})

describe('écran 2 — grille et panier', () => {
  it('ajoute un article, puis incrémente la quantité au second appui', async () => {
    await ouvrirPressing()

    await cliquer(boutonAria('Ajouter Chemise'))
    expect(champAria('Quantité Chemise').value).toBe('1')

    await cliquer(boutonAria('Ajouter Chemise'))
    expect(champAria('Quantité Chemise').value).toBe('2')

    demonter()
  })

  it('recalcule le total depuis la quantité et le prix saisis', async () => {
    await ouvrirPressing()
    await cliquer(boutonAria('Ajouter Chemise'))
    await cliquer(boutonAria('Ajouter Chemise'))

    await saisir(champAria('Prix unitaire Chemise (FCFA)'), '1500')
    expect(texte()).toContain('3 000 FCFA')

    await saisir(champAria('Quantité Chemise'), '3')
    expect(texte()).toContain('4 500 FCFA')

    demonter()
  })

  it('supprime une ligne du panier', async () => {
    await ouvrirPressing()
    await cliquer(boutonAria('Ajouter Pantalon'))
    expect(champAria('Quantité Pantalon')).toBeTruthy()

    await cliquer(boutonAria('Supprimer Pantalon'))
    expect(hote.textContent).toContain('Aucun article pour le moment.')

    demonter()
  })

  it('ajoute un article libre, hors grille', async () => {
    await ouvrirPressing()

    await saisir(champAria('Libellé de l’article libre'), 'Rideau')
    await cliquer(bouton('Ajouter'))

    expect(champAria('Quantité Rideau')).toBeTruthy()

    demonter()
  })

  it('retrouve un client déjà venu par la recherche', async () => {
    await db.orders.add({
      id: 'commande-ancienne',
      tenantId: TENANT,
      customerName: 'Koffi Yao',
      customerPhone: '05 05 05 05 05',
      status: 'received',
      totalAmount: 2000,
      paidAmount: 0,
      dueDate: null,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
      synced: true,
      serverVersion: 1,
      syncConflict: false,
      lastError: null,
      notes: null,
    } as never)

    await ouvrirPressing()
    await saisir(champAria('Rechercher un client'), 'Koffi')
    await cliquer(boutonAria('Choisir le client Koffi Yao'))

    expect(champ('Nom du client').value).toBe('Koffi Yao')
    expect(champ('Téléphone').value).toBe('05 05 05 05 05')

    demonter()
  })
})

describe('navigation et validation', () => {
  it('« Suivant » mène au récapitulatif, même incomplet, en annonçant le défaut', async () => {
    await ouvrirPressing()

    await cliquer(bouton('Suivant'))

    expect(hote.textContent).toContain('Montant total')
    expect(vi.mocked(toast.error)).toHaveBeenCalled()

    demonter()
  })

  it('les onglets d’étape restent utilisables dans les deux sens', async () => {
    await ouvrirPressing()

    await cliquer(boutonAria('Étape 1 : Service'))
    expect(hote.textContent).toContain('Quel type de service ?')

    await cliquer(boutonAria('Étape 2 : Articles'))
    expect(hote.textContent).toContain('Pressing — client et articles')

    demonter()
  })

  it('un enregistrement invalide ramène sur l’écran des articles', async () => {
    await ouvrirPressing()
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    expect(hote.textContent).toContain('Pressing — client et articles')
    expect(hote.querySelector('[role="alert"]')?.textContent).toContain(
      'Le nom du client est obligatoire',
    )

    demonter()
  })
})

describe('compte sans droit de création', () => {
  it('explique le refus au lieu de laisser un bouton inerte', async () => {
    useTenantStore.setState({ tenantId: TENANT, role: 'artisan', tenantName: 'Pressing Test' })

    await ouvrirPressing()
    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '07 00 00 00 42')
    await cliquer(boutonAria('Ajouter Chemise'))
    await saisir(champAria('Prix unitaire Chemise (FCFA)'), '2500')
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    expect(await db.orders.count()).toBe(0)
    expect(hote.textContent).toContain('Création refusée')
    expect(envoi.incidents.some((message) => message.includes('Création refusée'))).toBe(true)

    demonter()
  })
})

describe('enregistrement d’une nouvelle commande', () => {
  async function remplirEtEnregistrer() {
    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '07 00 00 00 42')
    await cliquer(boutonAria('Ajouter Chemise'))
    await saisir(champAria('Prix unitaire Chemise (FCFA)'), '2500')
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))
  }

  it('écrit la commande en local, l’envoie aussitôt et ouvre sa fiche', async () => {
    await ouvrirPressing()
    await remplirEtEnregistrer()

    const commandes = await db.orders.toArray()
    expect(commandes).toHaveLength(1)

    const commande = commandes[0]!
    expect(commande.customerName).toBe('Awa Koné')
    expect(commande.totalAmount).toBe(2500)

    // L'envoi immédiat a bien été déclenché pour CETTE commande.
    expect(envoi.appels).toEqual([commande.id])
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Commande enregistrée et synchronisée.',
      expect.anything(),
    )

    demonter()
  })

  it('enregistre un lot au kilo avec sa composition', async () => {
    await monter()
    await cliquer(boutonAria('Choisir Blanchisserie'))
    // Le kilo est désormais une option explicite du parcours blanchisserie.
    await cliquer(boutonAria('Facturer au kilo'))
    await saisir(champ('Nom du client'), 'Hôtel Ivoire')
    await saisir(champ('Téléphone'), '07 00 00 00 43')
    await cliquer(boutonAria('Ajouter Drap'))
    await cliquer(boutonAria('Ajouter Serviette'))
    await saisir(champAria('Quantité Lavage au kilo'), '3')
    await saisir(champAria('Tarif au kilo Lavage au kilo (FCFA)'), '2000')
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    const commandes = await db.orders.toArray()
    expect(commandes).toHaveLength(1)
    expect(commandes[0]!.totalAmount).toBe(6000)

    const lignes = await db.orderItems.toArray()
    expect(lignes).toHaveLength(1)
    expect(lignes[0]!.billingUnit).toBe('KG')
    expect(lignes[0]!.quantity).toBe(3)
    expect(lignes[0]!.unitPrice).toBe(2000)
    expect(lignes[0]!.garmentDetails).toEqual([
      { type: 'DRAP', quantity: 1 },
      { type: 'SERVIETTE', quantity: 1 },
    ])

    demonter()
  })

  it('refuse une ligne à 0 FCFA avant tout envoi', async () => {
    await ouvrirPressing()
    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '07 00 00 00 42')
    await cliquer(boutonAria('Ajouter Chemise'))
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    expect(await db.orders.count()).toBe(0)
    expect(envoi.appels).toEqual([])
    expect(hote.textContent).toContain('prix unitaire')
    expect(hote.textContent).toContain('Pressing — client et articles')

    demonter()
  })

  it('conserve la commande en local et explique l’échec de synchronisation', async () => {
    envoi.resultat = {
      statut: 'error',
      message: 'Hors ligne : la commande reste sur cet appareil et partira à la reconnexion.',
    }

    await ouvrirPressing()
    await remplirEtEnregistrer()

    expect(await db.orders.count()).toBe(1)
    const messages = vi.mocked(toast).mock.calls.map((appel) => String(appel[0]))
    expect(messages.some((message) => message.includes('reste sur cet appareil'))).toBe(true)

    demonter()
  })

  it('un double clic sur « Enregistrer » ne crée qu’une commande', async () => {
    await ouvrirPressing()
    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '07 00 00 00 42')
    await cliquer(boutonAria('Ajouter Chemise'))
    await saisir(champAria('Prix unitaire Chemise (FCFA)'), '2500')
    await cliquer(bouton('Suivant'))

    const enregistrer = bouton('Enregistrer la commande')
    await act(async () => {
      enregistrer.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      enregistrer.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await new Promise((resoudre) => setTimeout(resoudre, 10))
    })

    expect(await db.orders.count()).toBe(1)
    expect(envoi.appels).toHaveLength(1)

    demonter()
  })
})

describe('garde de rechargement (constat D5)', () => {
  /**
   * Simule un F5 ou une fermeture d'onglet. jsdom n'affiche évidemment pas la
   * boîte de dialogue du navigateur : c'est `defaultPrevented` qui dit si elle
   * aurait été demandée — exactement ce qui distingue « rien à perdre » de
   * « commande en cours ».
   */
  function recharger(): boolean {
    const evenement = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(evenement)
    return evenement.defaultPrevented
  }

  it('ne demande rien sur un formulaire vierge', async () => {
    await ouvrirPressing()

    expect(recharger()).toBe(false)

    demonter()
  })

  it('demande confirmation dès qu’un nom est saisi', async () => {
    await ouvrirPressing()
    await saisir(champ('Nom du client'), 'Awa Koné')

    expect(recharger()).toBe(true)

    demonter()
  })

  it('demande confirmation dès qu’une ligne est au panier', async () => {
    await ouvrirPressing()
    await cliquer(boutonAria('Ajouter Chemise'))

    expect(recharger()).toBe(true)

    demonter()
  })

  it('cesse de surveiller quand le parcours est quitté', async () => {
    await ouvrirPressing()
    await saisir(champ('Nom du client'), 'Awa Koné')
    expect(recharger()).toBe(true)

    // Quitter l'écran (navigation interne ou commande enregistrée) démonte le
    // composant : son écouteur doit disparaître, sinon toute l'application
    // demanderait confirmation à chaque rechargement.
    demonter()

    const evenement = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(evenement)
    expect(evenement.defaultPrevented).toBe(false)
  })
})

describe('mode démonstration', () => {
  it('affiche les prix de la maquette sans jamais enregistrer', async () => {
    useDemoStore.setState({ actif: true })
    await ouvrirPressing()

    // Les prix indicatifs de la maquette apparaissent sur les tuiles…
    expect(texte()).toContain('2 500 FCFA')

    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '07 00 00 00 77')
    await cliquer(boutonAria('Ajouter Chemise'))
    await saisir(champAria('Prix unitaire Chemise (FCFA)'), '2500')
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    // …mais rien n'est écrit : la démonstration ne fabrique pas de commande.
    expect(await db.orders.count()).toBe(0)
    expect(envoi.appels).toHaveLength(0)
    expect(texte()).toContain('Mode démonstration')
    // On reste sur le récapitulatif, avec le motif affiché à l'écran.
    expect(texte()).toContain('Récapitulatif')

    useDemoStore.setState({ actif: false })
    demonter()
  })
})
