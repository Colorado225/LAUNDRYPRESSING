import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Montage de l'écran « Journal d'audit ».
 *
 * Trois situations, qui correspondent aux trois états réels de l'écran :
 *  - un réceptionniste ouvre l'URL directement → refus, sans appel réseau ;
 *  - le propriétaire ouvre un journal vide → message explicite ;
 *  - le propriétaire voit des événements → phrases françaises, jamais de JSON.
 */

interface LigneFactice {
  id: string
  tenant_id: string
  actor_id: string | null
  actor_email: string | null
  actor_role: string | null
  action: string
  entity: string
  entity_id: string | null
  details: Record<string, unknown>
  created_at: string
}

const etatPage: { lignes: LigneFactice[]; erreur: Error | null; appels: number } = {
  lignes: [],
  erreur: null,
  appels: 0,
}

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))

vi.mock('@/services/auditService', async () => {
  const reel = await vi.importActual<typeof import('@/services/auditService')>(
    '@/services/auditService',
  )
  return {
    ...reel,
    listAuditPage: async () => {
      etatPage.appels += 1
      if (etatPage.erreur) throw etatPage.erreur
      return {
        lignes: etatPage.lignes,
        curseur: null,
        aPlus: false,
      }
    },
  }
})

const { default: Audit } = await import('@/pages/Audit')
const { useTenantStore } = await import('@/lib/tenantContext')

let racine: Root
let hote: HTMLDivElement

async function monter() {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(<Audit />)
  })
}

function demonter() {
  act(() => racine.unmount())
  hote.remove()
}

function texte(): string {
  return (hote.textContent ?? '').replace(/\u202f|\u00a0/g, ' ')
}

function evenement(partiel: Partial<LigneFactice>): LigneFactice {
  return {
    id: 'ligne-1',
    tenant_id: 'tenant-1',
    actor_id: 'user-1',
    actor_email: 'patron@pressing.ci',
    actor_role: 'owner',
    action: 'tenants.update',
    entity: 'tenants',
    entity_id: 'tenant-1',
    details: {},
    created_at: '2026-10-23T09:30:00.000Z',
    ...partiel,
  }
}

beforeEach(() => {
  etatPage.lignes = []
  etatPage.erreur = null
  etatPage.appels = 0
  useTenantStore.setState({ tenantId: 'tenant-1', role: 'owner' })
})

describe('Journal d’audit — accès', () => {
  it('refuse l’écran à un réceptionniste, sans interroger le serveur', async () => {
    useTenantStore.setState({ tenantId: 'tenant-1', role: 'receptionist' })
    await monter()

    expect(texte()).toContain('Journal réservé au propriétaire')
    expect(etatPage.appels).toBe(0)
    demonter()
  })

  it('ouvre l’écran au propriétaire', async () => {
    await monter()

    expect(texte()).toContain('Journal d’audit')
    expect(texte()).not.toContain('Journal réservé')
    demonter()
  })
})

describe('Journal d’audit — contenu', () => {
  it('annonce l’absence d’événement plutôt qu’une page blanche', async () => {
    await monter()

    expect(texte()).toContain('Aucun événement')
    demonter()
  })

  it('affiche un changement de tarif en français', async () => {
    etatPage.lignes = [
      evenement({
        action: 'catalog_entries.update',
        entity: 'catalog_entries',
        details: { price: { avant: 1500, apres: 2000 } },
      }),
    ]
    await monter()

    expect(texte()).toContain('Prestation ou tarif modifié')
    expect(texte()).toContain('tarif : 1 500 FCFA → 2 000 FCFA')
    // Aucun JSON brut ne doit apparaître à l'écran.
    expect(texte()).not.toContain('{"avant"')
    demonter()
  })

  it('nomme l’auteur et son rôle', async () => {
    etatPage.lignes = [evenement({ action: 'payment_refunds.insert', entity: 'payment_refunds' })]
    await monter()

    expect(texte()).toContain('patron@pressing.ci')
    expect(texte()).toContain('propriétaire')
    demonter()
  })

  it('distingue une écriture du serveur d’une action humaine', async () => {
    etatPage.lignes = [evenement({ actor_email: null, actor_role: null })]
    await monter()

    expect(texte()).toContain('Serveur')
    demonter()
  })

  it('affiche une erreur de lecture au lieu de la masquer', async () => {
    etatPage.erreur = new Error('Seul le propriétaire peut consulter le journal d’audit.')
    await monter()

    expect(texte()).toContain('Seul le propriétaire peut consulter le journal d’audit.')
    demonter()
  })
})
