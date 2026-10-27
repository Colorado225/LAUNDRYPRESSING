import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'
import { useDemoStore } from '@/lib/demoMode'
import type { Forfait } from '@/lib/packagePricing'
import toast from 'react-hot-toast'

/**
 * Vente d'un forfait au comptoir : « Pack 10 pièces, 5 000 FCFA ».
 *
 * Ce qui se vérifie ici est ce qui se paie : le forfait s'ajoute à son prix
 * global, chaque vêtement touché alimente sa composition, et le dépassement
 * suit la règle configurée (supplément par pièce ou refus net) — jamais un
 * montant deviné. La commande enregistrée doit porter la référence du forfait
 * et sa composition, pour rester justifiable après coup.
 */

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const catalogue = vi.hoisted(() => ({
  forfaits: [] as Forfait[],
}))

vi.mock('@/services/commercialPackages', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/commercialPackages')>()
  return {
    ...original,
    fetchCommercialPackages: () => Promise.resolve(catalogue.forfaits),
  }
})

vi.mock('@/services/tenantServices', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/tenantServices')>()
  return {
    ...original,
    fetchTenantServiceConfiguration: () =>
      Promise.resolve({ activities: [], services: [] }),
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
  signerSonde: () => Promise.resolve(),
  signalerSonde: () => Promise.resolve(),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'

const OrderForm = (await import('@/pages/OrderForm')).default

const PACK_DIX: Forfait = {
  id: 'f0000000-0000-4000-8000-000000000001',
  tenantId: TENANT,
  code: 'PACK_10',
  name: 'Pack 10 pièces',
  description: null,
  priceXof: 5000,
  garmentsIncluded: 10,
  overflowPolicy: 'PER_EXTRA_ITEM',
  overflowUnitPriceXof: 300,
  isActive: true,
  archivedAt: null,
}

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

function texte(): string {
  return (hote.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')
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

async function ouvrirPressing() {
  await monter()
  await cliquer(boutonAria('Choisir Pressing'))
}

async function saisirClient() {
  await saisir(champ('Nom du client'), 'Awa Koné')
  await saisir(champ('Téléphone'), '07 00 00 00 55')
}

beforeEach(async () => {
  catalogue.forfaits = [PACK_DIX]
  await db.orders.clear()
  await db.orderItems.clear()
  await db.commercialPackages.clear()
  envoi.appels.length = 0
  vi.mocked(toast).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.success).mockClear()
  useDemoStore.setState({ actif: false })
  useTenantStore.setState({ tenantId: TENANT, role: 'owner', tenantName: 'Pressing Test' })
})

describe('forfaits au comptoir', () => {
  it('propose les forfaits configurés avec leur prix et leurs conditions', async () => {
    await ouvrirPressing()

    expect(boutonAria('Ajouter le forfait Pack 10 pièces')).toBeTruthy()
    expect(texte()).toContain('5 000 FCFA')
    expect(texte()).toContain('10 vêtements inclus')
    expect(texte()).toContain('au-delà : 300 FCFA/pièce')

    demonter()
  })

  it('ajoute le forfait au panier à son prix global, sans prix saisissable', async () => {
    await ouvrirPressing()
    await cliquer(boutonAria('Ajouter le forfait Pack 10 pièces'))

    // Une ligne au prix du forfait, sans champ de prix unitaire : le montant
    // dépend du nombre de vêtements comptés, pas d'une saisie libre.
    expect(texte()).toContain('1 forfait')
    expect(hote.querySelector('input[aria-label="Prix unitaire Pack 10 pièces (FCFA)"]')).toBeNull()
    expect(hote.querySelector('input[aria-label="Quantité Pack 10 pièces"]')).toBeNull()

    demonter()
  })

  it('compte les vêtements déposés dans le forfait', async () => {
    await ouvrirPressing()
    await cliquer(boutonAria('Ajouter le forfait Pack 10 pièces'))
    await cliquer(boutonAria('Ajouter Chemise'))
    await cliquer(boutonAria('Ajouter Chemise'))
    await cliquer(boutonAria('Ajouter Pantalon'))

    expect(texte()).toContain('3 / 10 vêtement(s)')
    // La composition suit, sans facturer les pièces en plus du forfait.
    expect(texte()).toContain('2 × Chemise')
    expect(texte()).toContain('5 000 FCFA')

    demonter()
  })

  it('facture la pièce en plus au-delà du nombre inclus', async () => {
    await ouvrirPressing()
    await cliquer(boutonAria('Ajouter le forfait Pack 10 pièces'))
    for (let appui = 0; appui < 11; appui += 1) {
      await cliquer(boutonAria('Ajouter Chemise'))
    }

    expect(texte()).toContain('11 / 10 vêtement(s)')
    // 5 000 + 1 × 300
    expect(texte()).toContain('5 300 FCFA')

    demonter()
  })

  it('refuse le vêtement de trop quand le forfait le stipule', async () => {
    catalogue.forfaits = [
      { ...PACK_DIX, overflowPolicy: 'REJECT_OVER_LIMIT', overflowUnitPriceXof: null },
    ]
    await ouvrirPressing()
    await cliquer(boutonAria('Ajouter le forfait Pack 10 pièces'))
    for (let appui = 0; appui < 10; appui += 1) {
      await cliquer(boutonAria('Ajouter Chemise'))
    }
    expect(texte()).toContain('10 / 10 vêtement(s)')

    await cliquer(boutonAria('Ajouter Chemise'))

    // Rien ne bouge, et le refus est expliqué.
    expect(texte()).toContain('10 / 10 vêtement(s)')
    expect(vi.mocked(toast.error)).toHaveBeenCalled()
    expect(texte()).toContain('5 000 FCFA')

    demonter()
  })

  it('enregistre une ligne de forfait avec sa composition et sa référence', async () => {
    await ouvrirPressing()
    await saisirClient()
    await cliquer(boutonAria('Ajouter le forfait Pack 10 pièces'))
    await cliquer(boutonAria('Ajouter Pantalon'))
    await cliquer(boutonAria('Ajouter Veste'))
    await cliquer(bouton('Terminer la composition'))
    // Après la composition, la grille facture de nouveau à l'article.
    await cliquer(boutonAria('Ajouter Chemise'))
    await saisir(champ('Prix unitaire (FCFA)'), '1500')
    await cliquer(bouton('Suivant'))
    await cliquer(bouton('Enregistrer la commande'))

    const commandes = await db.orders.toArray()
    expect(commandes).toHaveLength(1)
    // 5 000 (forfait) + 1 500 (chemise hors forfait)
    expect(commandes[0]!.totalAmount).toBe(6500)

    const lignes = await db.orderItems.toArray()
    const ligneForfait = lignes.find((ligne) => ligne.commercialPackageId)
    expect(ligneForfait).toBeTruthy()
    expect(ligneForfait!.billingUnit).toBe('PACKAGE')
    expect(ligneForfait!.label).toBe('Pack 10 pièces')
    expect(ligneForfait!.unitPrice).toBe(5000)
    expect(ligneForfait!.commercialPackageId).toBe(PACK_DIX.id)
    expect(ligneForfait!.garmentDetails).toEqual([
      { type: 'PANTALON', quantity: 1 },
      { type: 'VESTE', quantity: 1 },
    ])
    // La chemise ajoutée après la composition reste une ligne à la pièce.
    expect(lignes.find((ligne) => ligne.label === 'Chemise')?.billingUnit).toBe('PIECE')

    demonter()
  })

  it('n’apparaît pas quand aucun forfait n’est configuré', async () => {
    catalogue.forfaits = []
    await ouvrirPressing()

    expect(hote.textContent).not.toContain('Forfaits')

    demonter()
  })
})
