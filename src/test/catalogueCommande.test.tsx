import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'
import type { TenantServiceConfiguration } from '@/services/tenantServices'

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

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

const catalogue = vi.hoisted(() => ({
  configuration: null as TenantServiceConfiguration | null,
}))

vi.mock('@/services/tenantServices', () => ({
  fetchTenantServiceConfiguration: () => Promise.resolve(catalogue.configuration),
}))

const TENANT = '22222222-2222-4222-8222-222222222222'
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

function select(ariaLabel: string): HTMLSelectElement {
  const trouve = hote.querySelector(`select[aria-label="${ariaLabel}"]`)
  if (!trouve) throw new Error(`Sélecteur « ${ariaLabel} » introuvable`)
  return trouve as HTMLSelectElement
}

async function saisir(input: HTMLInputElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, valeur)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function choisir(selecteur: HTMLSelectElement, valeur: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(selecteur, valeur)
    selecteur.dispatchEvent(new Event('change', { bubbles: true }))
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
  useTenantStore.setState({ tenantId: TENANT, role: 'owner', tenantName: 'Blanchisserie Test' })
  catalogue.configuration = {
    activities: [
      { id: '11111111-0000-4000-8000-000000000001', tenantId: TENANT, name: 'Blanchisserie', sortOrder: 0 },
      { id: '11111111-0000-4000-8000-000000000002', tenantId: TENANT, name: 'Pressing', sortOrder: 1 },
    ],
    categories: [
      {
        id: '22222222-0000-4000-8000-000000000001',
        tenantId: TENANT,
        activityId: '11111111-0000-4000-8000-000000000001',
        name: 'Forfaits au poids',
        sortOrder: 0,
        isActive: true,
      },
      {
        id: '22222222-0000-4000-8000-000000000002',
        tenantId: TENANT,
        activityId: '11111111-0000-4000-8000-000000000002',
        name: 'Pièces',
        sortOrder: 0,
        isActive: true,
      },
    ],
    services: [
      {
        id: '33333333-0000-4000-8000-000000000001',
        tenantId: TENANT,
        activityId: '11111111-0000-4000-8000-000000000001',
        activityName: 'Blanchisserie',
        categoryId: '22222222-0000-4000-8000-000000000001',
        serviceName: 'Laver repasser (forfait poids)',
        billingUnit: 'PACKAGE',
        pricingMode: 'FIXED',
        unitPrice: null,
        description: null,
        durationMinutes: null,
        isActive: true,
        sortOrder: 0,
      },
      {
        id: '33333333-0000-4000-8000-000000000002',
        tenantId: TENANT,
        activityId: '11111111-0000-4000-8000-000000000002',
        activityName: 'Pressing',
        categoryId: '22222222-0000-4000-8000-000000000002',
        serviceName: 'Chemise repassée',
        billingUnit: 'PIECE',
        pricingMode: 'FIXED',
        unitPrice: 500,
        description: null,
        durationMinutes: null,
        isActive: true,
        sortOrder: 0,
      },
    ],
    tiers: [
      {
        id: '44444444-0000-4000-8000-000000000001',
        tenantId: TENANT,
        tenantServiceId: '33333333-0000-4000-8000-000000000001',
        label: '10 kg',
        weightKg: 10,
        priceFcfa: 15000,
        isActive: true,
        sortOrder: 0,
      },
      {
        id: '44444444-0000-4000-8000-000000000002',
        tenantId: TENANT,
        tenantServiceId: '33333333-0000-4000-8000-000000000001',
        label: '15 kg',
        weightKg: 15,
        priceFcfa: 22000,
        isActive: true,
        sortOrder: 1,
      },
    ],
  }
})

describe('formulaire de commande connecté au catalogue', () => {
  it('crée une commande forfait poids avec le palier figé', async () => {
    await monter()

    await saisir(champ('Nom du client'), 'Awa Koné')
    await saisir(champ('Téléphone'), '0700000000')
    await cliquer(bouton('Suivant'))

    // Une seule activité ne s'affiche pas en sélecteur : ici deux, donc le
    // sélecteur d'activité de commande est présent et positionné sur Blanchisserie.
    const activite = select('Activité de la commande')
    expect(activite.value).toBe('11111111-0000-4000-8000-000000000001')

    // La prestation forfait apparaît bien groupée sous sa catégorie.
    const prestation = select('Prestation de la ligne 1')
    const groupe = prestation.querySelector('optgroup')
    expect(groupe?.getAttribute('label')).toBe('Forfaits au poids')
    expect(prestation.textContent).toContain('Laver repasser (forfait poids)')
    await choisir(prestation, '33333333-0000-4000-8000-000000000001')

    const palier = select('Palier de poids ligne 1')
    await choisir(palier, '44444444-0000-4000-8000-000000000002')

    const texteNormalise = (hote.textContent ?? '').replace(/[\s\u202F\u00A0]/g, ' ')
    expect(texteNormalise).toContain('22 000 FCFA')

    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    const lignes = await db.orderItems.toArray()
    expect(lignes).toHaveLength(1)
    const ligne = lignes[0]!
    expect(ligne.billingUnit).toBe('PACKAGE')
    expect(ligne.price).toBe(22000)
    expect(ligne.packageSnapshot).toMatchObject({
      tierId: '44444444-0000-4000-8000-000000000002',
      weightKg: 15,
      priceFcfa: 22000,
    })
    expect(ligne.activityNameSnapshot).toBe('Blanchisserie')
    expect(ligne.categoryNameSnapshot).toBe('Forfaits au poids')

    const commandes = await db.orders.toArray()
    expect(commandes[0]!.totalAmount).toBe(22000)
    expect(envoi.appels).toEqual([commandes[0]!.id])

    demonter()
  })

  it('pré-remplit le prix de référence d’une prestation à la pièce', async () => {
    await monter()
    await saisir(champ('Nom du client'), 'Ibrahim Touré')
    await saisir(champ('Téléphone'), '0700000001')
    await cliquer(bouton('Suivant'))

    await choisir(select('Activité de la commande'), '11111111-0000-4000-8000-000000000002')
    const prestation = select('Prestation de la ligne 1')
    await choisir(prestation, '33333333-0000-4000-8000-000000000002')

    const prix = champ('Prix unitaire (FCFA)')
    expect(prix.value).toBe('500')
    const article = champ('Article / vêtement')
    await saisir(article, 'Chemise blanche')

    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    const lignes = await db.orderItems.toArray()
    expect(lignes[0]).toMatchObject({
      billingUnit: 'PIECE',
      unitPrice: 500,
      price: 500,
      tenantServiceId: '33333333-0000-4000-8000-000000000002',
    })
    demonter()
  })
})
