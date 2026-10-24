import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalOrder } from '@/db/localDb'

/**
 * Panneau « Prévenir le client ».
 *
 * Ce qui est vérifié ici, et qui ne l'est pas ailleurs :
 *  - le texte partiel visible AVANT l'envoi est bien celui du motif choisi ;
 *  - cliquer « WhatsApp » ouvre le lien du bon numéro et **journalise** la
 *    sollicitation (une trace sans envoi, ou un envoi sans trace, fausserait
 *    la liste « à prévenir ») ;
 *  - un artisan ne peut pas écrire au client, un numéro incomplet n'ouvre rien.
 */

const { db } = await import('@/db/localDb')
const { useTenantStore } = await import('@/lib/tenantContext')
const { default: NotifyPanel } = await import('@/components/NotifyPanel')

let racine: Root
let hote: HTMLDivElement

function commande(surcharge: Partial<LocalOrder> = {}): LocalOrder {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tenantId: '11111111-1111-4111-8111-111111111111',
    customerName: 'Awa Koné',
    customerPhone: '0707070707',
    status: 'ready',
    qrCode: 'CMD-EEEEEE',
    photoUrl: null,
    totalAmount: 15000,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-21T09:00:00.000Z',
    synced: 1,
    syncedAt: '2026-10-21T09:01:00.000Z',
    serverVersion: 1,
    syncError: null,
    syncConflict: null,
    dueDate: '2099-01-01',
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
    ...surcharge,
  }
}

async function monter(order: LocalOrder) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(<NotifyPanel order={order} />)
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
  return (hote.textContent ?? '').replace(/\u202f|\u00a0/g, ' ')
}

function bouton(libelle: string): HTMLButtonElement {
  const trouve = [...hote.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(libelle),
  )
  if (!trouve) throw new Error(`Bouton introuvable : ${libelle}`)
  return trouve as HTMLButtonElement
}

const ouvertures: string[] = []

beforeEach(async () => {
  ouvertures.length = 0
  await db.notifications.clear()
  useTenantStore.setState({
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantName: 'Pressing Cocody',
    role: 'owner',
  })
  vi.spyOn(window, 'open').mockImplementation(((url: string) => {
    ouvertures.push(String(url))
    return null
  }) as typeof window.open)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Panneau « Prévenir le client »', () => {
  it('montre le message pré-rempli avant tout envoi', async () => {
    await monter(commande())

    expect(texte()).toContain('Prévenir le client')
    expect(texte()).toContain('votre linge est prêt chez Pressing Cocody')
    expect(texte()).toContain('CMD-EEEEEE')
    expect(texte()).toContain('Ce client n’a encore jamais été prévenu')

    demonter()
  })

  it('ouvre WhatsApp sur le bon numéro et journalise la sollicitation', async () => {
    const order = commande()
    await monter(order)

    await act(async () => {
      bouton('Envoyer sur WhatsApp').click()
    })
    await act(async () => {
      await new Promise((resoudre) => setTimeout(resoudre, 0))
    })

    expect(ouvertures).toHaveLength(1)
    expect(ouvertures[0]).toContain('https://wa.me/2250707070707?text=')
    expect(decodeURIComponent(ouvertures[0])).toContain('votre linge est prêt')

    const journal = await db.notifications.toArray()
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      orderId: order.id,
      channel: 'whatsapp',
      reason: 'pret',
      customerPhone: '0707070707',
    })
    expect(journal[0].synced).toBe(0)

    demonter()
  })

  it('journalise aussi un appel, avec le canal correspondant', async () => {
    await monter(commande())

    await act(async () => {
      bouton('Appeler').click()
    })

    expect(ouvertures[0]).toMatch(/^tel:\+2250707070707$/)
    const journal = await db.notifications.toArray()
    expect(journal[0].channel).toBe('appel')

    demonter()
  })

  it('propose le motif « linge non retiré » quand l’échéance est dépassée', async () => {
    await monter(commande({ dueDate: '2020-01-01' }))

    expect(texte()).toContain('vous attend chez Pressing Cocody')
    expect((hote.querySelector('select') as HTMLSelectElement).value).toBe('relance')

    demonter()
  })

  it('refuse le panneau à un artisan', async () => {
    useTenantStore.setState({ role: 'artisan' })
    await monter(commande())

    expect(texte()).toContain('Seul le comptoir prévient les clients')
    expect(hote.querySelectorAll('button')).toHaveLength(0)

    demonter()
  })

  it('n’ouvre rien avec un numéro inexploitable', async () => {
    await monter(commande({ customerPhone: '12' }))

    expect(texte()).toContain('Numéro incomplet')
    expect(hote.querySelectorAll('button')).toHaveLength(0)

    demonter()
  })

  it('affiche la date du dernier contact quand elle existe', async () => {
    await db.notifications.add({
      id: 'notif-1',
      tenantId: '11111111-1111-4111-8111-111111111111',
      orderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      channel: 'whatsapp',
      reason: 'pret',
      customerName: 'Awa Koné',
      customerPhone: '0707070707',
      message: 'Bonjour Awa, votre linge est prêt.',
      createdAt: '2026-10-22T10:00:00.000Z',
      synced: 1,
      lastError: null,
    })

    await monter(commande())

    expect(texte()).toContain('Dernier contact : whatsapp le 22/10/2026')

    demonter()
  })
})
