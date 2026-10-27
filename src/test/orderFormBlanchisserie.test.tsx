import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'
import { useDemoStore } from '@/lib/demoMode'
import toast from 'react-hot-toast'

/**
 * Blanchisserie facturée **au nombre de vêtements**.
 *
 * Le pressing d'Abidjan ne pèse pas le linge : il compte les draps et les
 * serviettes et applique le forfait par article (« Drap 500 FCFA »). Le kilo
 * reste possible, mais seulement quand le comptoir le choisit.
 *
 * Ce fichier isole ce parcours avec un catalogue réellement configuré
 * (`fetchTenantServiceConfiguration` remplacé) : l'autre fichier de tests du
 * formulaire tourne, lui, sans aucune prestation pour vérifier la dégradation
 * propre quand rien n'est configuré.
 */

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

/** Une prestation du catalogue de recette, telle que la renvoie le service. */
interface ServiceCatalogue {
  id: string
  tenantId: string
  activityId: string
  activityName: string
  activityCode: 'blanchisserie'
  serviceName: string
  billingUnit: 'PIECE' | 'KG'
  unitPrice: number | null
  sortOrder: number
}

const catalogueComplet: ServiceCatalogue[] = [
  {
    id: '50000000-0000-4000-8000-00000000d001',
    tenantId: '11111111-1111-4111-8111-111111111111',
    activityId: 'a0000000-0000-4000-8000-00000000b001',
    activityName: 'Blanchisserie',
    activityCode: 'blanchisserie',
    serviceName: 'Drap',
    billingUnit: 'PIECE',
    unitPrice: 500,
    sortOrder: 0,
  },
  {
    id: '50000000-0000-4000-8000-00000000d002',
    tenantId: '11111111-1111-4111-8111-111111111111',
    activityId: 'a0000000-0000-4000-8000-00000000b001',
    activityName: 'Blanchisserie',
    activityCode: 'blanchisserie',
    serviceName: 'Serviette',
    billingUnit: 'PIECE',
    unitPrice: 300,
    sortOrder: 1,
  },
  {
    id: '50000000-0000-4000-8000-00000000d003',
    tenantId: '11111111-1111-4111-8111-111111111111',
    activityId: 'a0000000-0000-4000-8000-00000000b001',
    activityName: 'Blanchisserie',
    activityCode: 'blanchisserie',
    serviceName: 'Lavage au kilo',
    billingUnit: 'KG',
    unitPrice: 1500,
    sortOrder: 2,
  },
]

const catalogue = vi.hoisted(() => ({
  activities: [
    {
      id: 'a0000000-0000-4000-8000-00000000b001',
      tenantId: '11111111-1111-4111-8111-111111111111',
      name: 'Blanchisserie',
      sortOrder: 1,
      legacyCode: 'blanchisserie' as const,
    },
    {
      id: 'a0000000-0000-4000-8000-00000000b002',
      tenantId: '11111111-1111-4111-8111-111111111111',
      name: 'Pressing',
      sortOrder: 0,
      legacyCode: 'pressing' as const,
    },
  ],
  services: [] as ServiceCatalogue[],
}))

vi.mock('@/services/tenantServices', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/tenantServices')>()
  return {
    ...original,
    fetchTenantServiceConfiguration: () => Promise.resolve(catalogue),
  }
})

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

const envoi = vi.hoisted(() => ({
  resultat: { statut: 'synced', version: 1 } as Record<string, unknown>,
  appels: [] as string[],
}))

vi.mock('@/sync/syncEngine', () => ({
  syncOrderNow: (orderId: string) => {
    envoi.appels.push(orderId)
    return Promise.resolve(envoi.resultat)
  },
  signalerIncidentCommande: () => Promise.resolve(),
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

function champ(libelle: string): HTMLInputElement {
  const label = Array.from(hote.querySelectorAll('label')).find((element) =>
    element.textContent?.includes(libelle),
  )
  const input = label?.querySelector('input')
  if (!input) throw new Error(`Champ « ${libelle} » introuvable`)
  return input as HTMLInputElement
}

function champAria(libelle: string): HTMLInputElement {
  const trouve = hote.querySelector<HTMLInputElement>(`input[aria-label="${libelle}"]`)
  if (!trouve) throw new Error(`Champ accessible « ${libelle} » introuvable`)
  return trouve
}

function boutonAria(libelle: string): HTMLButtonElement {
  const trouve = Array.from(hote.querySelectorAll('button')).find(
    (element) => element.getAttribute('aria-label') === libelle,
  )
  if (!trouve) throw new Error(`Bouton accessible « ${libelle} » introuvable`)
  return trouve as HTMLButtonElement
}

function bouton(libelle: string): HTMLButtonElement {
  const trouve = Array.from(hote.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === libelle,
  )
  if (!trouve) throw new Error(`Bouton « ${libelle} » introuvable`)
  return trouve as HTMLButtonElement
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

async function ouvrirBlanchisserie() {
  await monter()
  await cliquer(boutonAria('Choisir Blanchisserie'))
}

beforeEach(async () => {
  // Catalogue complet par défaut ; un test peut le réduire (boutique au kilo).
  catalogue.services = [...catalogueComplet]
  await db.orders.clear()
  await db.orderItems.clear()
  await db.tenantServices.clear()
  await db.tenantActivities.clear()
  envoi.appels.length = 0
  envoi.resultat = { statut: 'synced', version: 1 }
  vi.mocked(toast).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.success).mockClear()
  useDemoStore.setState({ actif: false })
  useTenantStore.setState({ tenantId: TENANT, role: 'owner', tenantName: 'Pressing Test' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('blanchisserie — facturation au vêtement', () => {
  it('ouvre sur le comptage des vêtements, pas sur un lot pesé', async () => {
    await ouvrirBlanchisserie()

    expect(boutonAria('Facturer au vêtement').getAttribute('aria-pressed')).toBe('true')
    // Le lot pesé n'existe pas tant que le comptoir n'a pas demandé le kilo.
    expect(hote.querySelector('input[aria-label="Quantité Lavage au kilo"]')).toBeNull()
    expect(hote.querySelector('input[aria-label="Tarif au kilo Lavage au kilo (FCFA)"]')).toBeNull()

    demonter()
  })

  it('affiche le forfait par article configuré', async () => {
    await ouvrirBlanchisserie()

    // Les prix viennent du catalogue, jamais de la maquette.
    expect(texte()).toContain('500 FCFA/pièce')
    expect(texte()).toContain('300 FCFA/pièce')
    // Un article sans forfait l'annonce : le prix se saisira au comptoir.
    expect(texte()).toContain('prix au comptoir')

    demonter()
  })

  it('compte chaque vêtement ajouté et applique le prix de son article', async () => {
    await ouvrirBlanchisserie()

    await cliquer(boutonAria('Ajouter Drap'))
    await cliquer(boutonAria('Ajouter Drap'))
    await cliquer(boutonAria('Ajouter Serviette'))

    expect(champAria('Quantité Drap').value).toBe('2')
    expect(champAria('Prix unitaire Drap (FCFA)').value).toBe('500')
    expect(champAria('Prix unitaire Serviette (FCFA)').value).toBe('300')
    // 2 × 500 + 1 × 300
    expect(texte()).toContain('1 300 FCFA')

    demonter()
  })

  it('enregistre une ligne par article, en pièces, sans lot au kilo', async () => {
    await ouvrirBlanchisserie()
    await saisir(champ('Nom du client'), 'Hôtel Ivoire')
    await saisir(champ('Téléphone'), '07 00 00 00 43')
    await cliquer(boutonAria('Ajouter Drap'))
    await cliquer(boutonAria('Ajouter Drap'))
    await cliquer(boutonAria('Ajouter Serviette'))
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    const commandes = await db.orders.toArray()
    expect(commandes).toHaveLength(1)
    expect(commandes[0]!.totalAmount).toBe(1300)

    const lignes = await db.orderItems.toArray()
    expect(lignes.every((ligne) => ligne.billingUnit === 'PIECE')).toBe(true)
    const drap = lignes.find((ligne) => ligne.label === 'Drap')
    expect(drap?.quantity).toBe(2)
    expect(drap?.unitPrice).toBe(500)
    expect(drap?.price).toBe(1000)
    // La prestation d'origine est conservée : le prix reste rattaché au forfait.
    expect(drap?.tenantServiceId).toBe('50000000-0000-4000-8000-00000000d001')
    expect(drap?.serviceName).toBe('Drap')

    demonter()
  })

  it('refuse d’enregistrer un article dont le prix n’a pas été saisi', async () => {
    await ouvrirBlanchisserie()
    await saisir(champ('Nom du client'), 'Hôtel Ivoire')
    await saisir(champ('Téléphone'), '07 00 00 00 44')
    // Aucune prestation « Chemise » : le prix vaut 0 et doit bloquer.
    await cliquer(boutonAria('Ajouter Chemise'))
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    expect(await db.orders.count()).toBe(0)
    expect(envoi.appels).toHaveLength(0)
    const alerte = hote.querySelector('[role="alert"]')
    expect(alerte?.textContent).toContain('Chemise')

    demonter()
  })

  it('le kilo reste disponible en option, et le comptage reprend ensuite', async () => {
    await ouvrirBlanchisserie()

    await cliquer(boutonAria('Facturer au kilo'))
    expect(boutonAria('Facturer au kilo').getAttribute('aria-pressed')).toBe('true')
    expect(champAria('Quantité Lavage au kilo')).toBeTruthy()
    expect(champAria('Tarif au kilo Lavage au kilo (FCFA)').value).toBe('1500')

    await cliquer(boutonAria('Facturer au vêtement'))
    expect(hote.querySelector('input[aria-label="Quantité Lavage au kilo"]')).toBeNull()
    await cliquer(boutonAria('Ajouter Drap'))
    expect(champAria('Quantité Drap').value).toBe('1')

    demonter()
  })

  it('une boutique qui ne travaille qu’au kilo s’ouvre directement sur le pesage', async () => {
    catalogue.services = [catalogueComplet[2]!]

    await ouvrirBlanchisserie()

    expect(boutonAria('Facturer au kilo').getAttribute('aria-pressed')).toBe('true')
    expect(champAria('Quantité Lavage au kilo')).toBeTruthy()
    expect(champAria('Tarif au kilo Lavage au kilo (FCFA)').value).toBe('1500')

    demonter()
  })
})
