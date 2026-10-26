import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'
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

function bouton(libelle: string): HTMLButtonElement {
  const trouve = Array.from(hote.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === libelle,
  )
  if (!trouve) throw new Error(`Bouton « ${libelle} » introuvable`)
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

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  envoi.appels.length = 0
  envoi.incidents.length = 0
  envoi.resultat = { statut: 'synced', version: 1 }
  useTenantStore.setState({ tenantId: TENANT, role: 'owner', tenantName: 'Pressing Test' })
})

describe('validation des étapes du formulaire de commande', () => {
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

describe('navigation du formulaire de commande', () => {
  it('« Suivant » fait passer de l’étape client à l’étape vêtements', async () => {
    await monter()

    expect(hote.textContent).toContain('Informations client')

    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '0700000000')
    await cliquer(bouton('Suivant'))

    expect(hote.textContent).toContain('Vêtements et prestations')

    demonter()
  })

  it('avance toujours, même avec un numéro incomplet, et signale le défaut', async () => {
    await monter()

    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '0700')
    await cliquer(bouton('Suivant'))

    // La navigation ne doit jamais paraître cassée…
    expect(hote.textContent).toContain('Vêtements et prestations')
    // … mais le défaut est annoncé et reste rattrapé à l'enregistrement.
    expect(vi.mocked(toast.error)).toHaveBeenCalled()

    await cliquer(bouton('Précédent'))
    expect(hote.textContent).toContain('Informations client')

    demonter()
  })

  it('avance aussi avec des champs vides : aucun clic muet', async () => {
    await monter()

    await cliquer(bouton('Suivant'))
    expect(hote.textContent).toContain('Vêtements et prestations')
    expect(vi.mocked(toast.error)).toHaveBeenCalled()
    expect(hote.querySelector('[aria-invalid="true"]')).toBeNull()

    demonter()
  })

  it('un champ fautif est annoncé, marqué, et reste visible au retour', async () => {
    vi.mocked(toast.error).mockClear()
    await monter()

    // Un clic sur « Suivant » ne bloque plus, mais il parle : toast immédiat.
    await cliquer(bouton('Suivant'))
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe('Le nom du client est obligatoire')

    // De retour sur l'étape client, la liste complète et le marquage sont là.
    await cliquer(bouton('1. Client'))
    expect(hote.querySelector('[role="alert"]')?.textContent).toContain(
      'Le nom du client est obligatoire',
    )

    const telephone = champ('Téléphone')
    expect(telephone.getAttribute('aria-invalid')).toBe('true')

    demonter()
  })

  it('un enregistrement invalide ramène sur l’étape du champ fautif', async () => {
    await monter()

    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Suivant'))
    expect(hote.textContent).toContain('Règlement')

    await cliquer(bouton('Enregistrer la commande'))

    expect(hote.textContent).toContain('Informations client')
    expect(hote.querySelector('[role="alert"]')?.textContent).toContain(
      'Le nom du client est obligatoire',
    )

    demonter()
  })

  it('l’onglet « Vêtements » est cliquable et valide l’étape en cours', async () => {
    await monter()

    // L'onglet répond immédiatement, champs remplis ou non.
    await cliquer(bouton('2. Vêtements'))
    expect(hote.textContent).toContain('Vêtements et prestations')

    await cliquer(bouton('1. Client'))
    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '+225 07 00 00 00 00')
    await cliquer(bouton('2. Vêtements'))
    expect(hote.textContent).toContain('Vêtements et prestations')

    // Retour arrière libre vers l'étape client.
    await cliquer(bouton('1. Client'))
    expect(hote.textContent).toContain('Informations client')

    demonter()
  })
})

describe('compte sans droit de création', () => {
  it('explique le refus au lieu de laisser un bouton inerte', async () => {
    useTenantStore.setState({ tenantId: TENANT, role: 'artisan', tenantName: 'Pressing Test' })

    await monter()

    // Le motif est affiché dès l'ouverture, sans avoir à cliquer.
    expect(hote.textContent).toContain('Ce compte ne peut pas créer de commande')
    expect(hote.textContent).toContain('artisan')

    // Et le clic reste possible : il produit un message, pas un silence.
    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '07 00 00 00 42')
    await cliquer(bouton('Suivant'))
    await saisir(champ('Article / vêtement'), 'Chemise')
    await saisir(champ('Prix unitaire (FCFA)'), '2500')
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
    await cliquer(bouton('Suivant'))

    // Étape vêtements : une ligne libre chiffrée.
    await saisir(champ('Article / vêtement'), 'Chemise')
    await saisir(champ('Prix unitaire (FCFA)'), '2500')

    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))
  }

  it('écrit la commande en local, l’envoie aussitôt et ouvre sa fiche', async () => {
    await monter()
    await remplirEtEnregistrer()

    const commandes = await db.orders.toArray()
    expect(commandes).toHaveLength(1)

    const commande = commandes[0]!
    expect(commande.customerName).toBe('Awa Koné')
    expect(commande.totalAmount).toBe(2500)

    // L'envoi immédiat a bien été déclenché pour CETTE commande.
    expect(envoi.appels).toEqual([commande.id])

    // La fiche s'ouvre (l'URL n'est pas rendue ici, mais le formulaire disparaît
    // de l'écran d'après l'état de navigation).
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Commande enregistrée et synchronisée.',
      expect.anything(),
    )
  })

  it('refuse une ligne à 0 FCFA avant tout envoi', async () => {
    await monter()
    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '07 00 00 00 42')
    await cliquer(bouton('Suivant'))
    await saisir(champ('Article / vêtement'), 'Chemise')
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    expect(await db.orders.count()).toBe(0)
    expect(envoi.appels).toEqual([])
    expect(hote.textContent).toContain('prix unitaire')
    // On revient sur l'étape où le prix se corrige.
    expect(hote.textContent).toContain('Vêtements et prestations')

    demonter()
  })

  it('conserve la commande en local et explique l’échec de synchronisation', async () => {
    envoi.resultat = {
      statut: 'error',
      message: 'Hors ligne : la commande reste sur cet appareil et partira à la reconnexion.',
    }

    await monter()
    await remplirEtEnregistrer()

    // La commande reste enregistrée sur l'appareil…
    expect(await db.orders.count()).toBe(1)
    // … et le comptoir voit pourquoi elle n'est pas encore en base.
    const messages = vi.mocked(toast).mock.calls.map((appel) => String(appel[0]))
    expect(messages.some((message) => message.includes('reste sur cet appareil'))).toBe(true)
  })
})
