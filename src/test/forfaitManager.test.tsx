import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Forfait } from '@/lib/packagePricing'
import toast from 'react-hot-toast'

/**
 * Écran « Forfaits » de Services & activités.
 *
 * Ce qui se vérifie : le propriétaire voit ce qui est réellement en vente, une
 * création envoie exactement les valeurs saisies, un refus du serveur s'affiche
 * (jamais un faux succès), et un forfait ne s'efface pas — il se retire, en
 * conservant l'historique des commandes déjà passées.
 */

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const service = vi.hoisted(() => ({
  forfaits: [] as Forfait[],
  creation: null as Record<string, unknown> | null,
  modification: null as Record<string, unknown> | null,
  archive: null as string | null,
  erreurCreation: null as string | null,
}))

vi.mock('@/services/commercialPackages', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/commercialPackages')>()
  return {
    ...original,
    fetchCommercialPackages: () => Promise.resolve(service.forfaits),
    createCommercialPackage: (_tenantId: string, saisie: Record<string, unknown>) => {
      if (service.erreurCreation) return Promise.reject(new Error(service.erreurCreation))
      service.creation = saisie
      return Promise.resolve()
    },
    updateCommercialPackage: (
      _tenantId: string,
      _id: string,
      saisie: Record<string, unknown>,
    ) => {
      service.modification = saisie
      return Promise.resolve()
    },
    archiveCommercialPackage: (_tenantId: string, id: string) => {
      service.archive = id
      return Promise.resolve()
    },
  }
})

const ForfaitManager = (await import('@/components/services/ForfaitManager')).default

const FORFAIT: Forfait = {
  id: 'f0000000-0000-4000-8000-000000000001',
  tenantId: 'tenant-1',
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

async function monter(props: { peutGerer?: boolean } = {}) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(<ForfaitManager tenantId="tenant-1" peutGerer={props.peutGerer ?? true} />)
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

function champAria(libelle: string): HTMLInputElement {
  const trouve = hote.querySelector<HTMLInputElement>(`input[aria-label="${libelle}"]`)
  if (!trouve) throw new Error(`Champ « ${libelle} » introuvable`)
  return trouve
}

function selectAria(libelle: string): HTMLSelectElement {
  const trouve = hote.querySelector<HTMLSelectElement>(`select[aria-label="${libelle}"]`)
  if (!trouve) throw new Error(`Liste « ${libelle} » introuvable`)
  return trouve
}

function bouton(libelle: string): HTMLButtonElement {
  const trouve = Array.from(hote.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === libelle,
  )
  if (!trouve) throw new Error(`Bouton « ${libelle} » introuvable`)
  return trouve as HTMLButtonElement
}

function boutonAria(libelle: string): HTMLButtonElement {
  const trouve = Array.from(hote.querySelectorAll('button')).find(
    (element) => element.getAttribute('aria-label') === libelle,
  )
  if (!trouve) throw new Error(`Bouton accessible « ${libelle} » introuvable`)
  return trouve as HTMLButtonElement
}

async function saisir(input: HTMLInputElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, valeur)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function cliquer(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resoudre) => setTimeout(resoudre, 0))
  })
}

beforeEach(() => {
  service.forfaits = [FORFAIT]
  service.creation = null
  service.modification = null
  service.archive = null
  service.erreurCreation = null
  vi.mocked(toast).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.success).mockClear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('gestion des forfaits', () => {
  it('affiche les forfaits en vente avec leur prix et leurs conditions', async () => {
    await monter()

    expect(texte()).toContain('Pack 10 pièces')
    expect(texte()).toContain('5 000 FCFA')
    expect(texte()).toContain('10 vêtements inclus')
    expect(texte()).toContain('au-delà : 300 FCFA/pièce')

    demonter()
  })

  it('crée un forfait avec les valeurs saisies', async () => {
    await monter()

    await saisir(champAria('Nom du forfait'), 'Pack 20 pièces')
    await saisir(champAria('Prix du forfait (FCFA)'), '9000')
    await saisir(champAria('Vêtements inclus'), '20')
    await saisir(champAria('Prix d’une pièce supplémentaire (FCFA)'), '250')
    await cliquer(bouton('Créer le forfait'))

    expect(service.creation).toEqual({
      name: 'Pack 20 pièces',
      description: null,
      priceXof: 9000,
      garmentsIncluded: 20,
      overflowPolicy: 'PER_EXTRA_ITEM',
      overflowUnitPriceXof: 250,
    })
    // Le formulaire est vidé après création : pas de double saisie involontaire.
    expect(champAria('Nom du forfait').value).toBe('')
    expect(vi.mocked(toast.success)).toHaveBeenCalled()

    demonter()
  })

  it('n’annonce jamais un succès quand le serveur refuse', async () => {
    service.erreurCreation = 'Le prix du forfait doit être un montant entier entre 1 et 10 000 000 FCFA.'
    await monter()

    await saisir(champAria('Nom du forfait'), 'Pack cassé')
    await saisir(champAria('Prix du forfait (FCFA)'), '9000')
    await cliquer(bouton('Créer le forfait'))

    expect(hote.querySelector('[role="alert"]')?.textContent).toContain('montant entier')
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled()
    expect(vi.mocked(toast.error)).toHaveBeenCalled()

    demonter()
  })

  it('masque le prix de dépassement quand le forfait refuse au-delà', async () => {
    await monter()
    const liste = selectAria('Au-delà du nombre inclus')

    expect(champAria('Prix d’une pièce supplémentaire (FCFA)')).toBeTruthy()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(liste, 'REJECT_OVER_LIMIT')
      liste.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(hote.querySelector('input[aria-label="Prix d’une pièce supplémentaire (FCFA)"]')).toBeNull()

    demonter()
  })

  it('retire un forfait de la vente sans l’effacer', async () => {
    await monter()

    await cliquer(boutonAria('Retirer le forfait Pack 10 pièces'))

    expect(service.archive).toBe(FORFAIT.id)
    // Une confirmation explicite : le retrait n'est pas une suppression muette.
    expect(window.confirm).toHaveBeenCalled()

    demonter()
  })

  it('n’offre aucune modification à qui n’est pas propriétaire', async () => {
    await monter({ peutGerer: false })

    expect(texte()).toContain('Seul le propriétaire')
    expect(hote.querySelector('button[aria-label="Retirer le forfait Pack 10 pièces"]')).toBeNull()
    expect(hote.querySelector('input[aria-label="Nom du forfait"]')).toBeNull()

    demonter()
  })
})
