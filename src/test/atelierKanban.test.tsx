import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COLONNES_ATELIER,
  colonneDe,
  repartirParColonne,
  totalAtelier,
} from '@/lib/atelierKanban'
import KanbanBoard from '@/components/workshop/KanbanBoard'
import type { LocalOrder } from '@/db/localDb'
import type { OrderStatus } from '@/types/database'

/**
 * Kanban d'atelier.
 *
 * Le point sensible n'est pas l'apparence mais le **regroupement** : huit
 * statuts réels doivent tenir dans trois colonnes sans qu'aucune commande ne
 * disparaisse, et sans qu'une commande livrée ou annulée ne reste affichée
 * comme « à remettre ».
 */

function commande(id: string, status: OrderStatus, extra: Partial<LocalOrder> = {}): LocalOrder {
  return {
    id,
    tenantId: 'tenant-1',
    customerName: `Client ${id}`,
    customerPhone: '0700000000',
    status,
    qrCode: `CMD-${id}`,
    photoUrl: null,
    totalAmount: 5000,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: '2026-10-26T08:00:00Z',
    updatedAt: '2026-10-26T08:00:00Z',
    synced: 'pending',
    syncedAt: null,
    serverVersion: 0,
    syncError: null,
    ...extra,
  } as LocalOrder
}

describe('répartition en colonnes', () => {
  it('définit trois colonnes, dans l’ordre du flux', () => {
    expect(COLONNES_ATELIER.map((colonne) => colonne.titre)).toEqual(['Reçues', 'En cours', 'Prêtes'])
  })

  it('range chaque statut réel dans une colonne, sans doublon', () => {
    expect(colonneDe('received')).toBe('recues')
    expect(colonneDe('sorting')).toBe('recues')
    expect(colonneDe('washing')).toBe('en_cours')
    expect(colonneDe('drying')).toBe('en_cours')
    expect(colonneDe('ironing')).toBe('en_cours')
    expect(colonneDe('quality_check')).toBe('en_cours')
    expect(colonneDe('ready')).toBe('pretes')
    // Livrée et annulée ne sont plus dans l'atelier.
    expect(colonneDe('delivered')).toBeNull()
    expect(colonneDe('cancelled')).toBeNull()
  })

  it('ne perd aucune commande en cours et écarte celles qui sont sorties', () => {
    const commandes = [
      commande('a', 'received'),
      commande('b', 'sorting'),
      commande('c', 'washing'),
      commande('d', 'ironing'),
      commande('e', 'ready'),
      commande('f', 'delivered'),
      commande('g', 'cancelled'),
    ]

    const repartition = repartirParColonne(commandes)
    const total = repartition.reduce((somme, colonne) => somme + colonne.commandes.length, 0)

    expect(total).toBe(5)
    expect(totalAtelier(commandes)).toBe(5)
    expect(repartition[0]?.commandes.map((c) => c.id)).toEqual(['a', 'b'])
    expect(repartition[1]?.commandes.map((c) => c.id)).toEqual(['c', 'd'])
    expect(repartition[2]?.commandes.map((c) => c.id)).toEqual(['e'])
  })

  it('rend trois colonnes même sans aucune commande', () => {
    const repartition = repartirParColonne([])
    expect(repartition).toHaveLength(3)
    expect(repartition.every((colonne) => colonne.commandes.length === 0)).toBe(true)
  })
})

let racine: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(element: React.ReactElement) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine!.render(<MemoryRouter>{element}</MemoryRouter>)
  })
}

afterEach(() => {
  if (racine) act(() => racine!.unmount())
  hote?.remove()
  racine = null
  hote = null
})

function texte(): string {
  return (hote?.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')
}

describe('KanbanBoard', () => {
  const commandes = [
    commande('a', 'received', { customerName: 'Awa Koné' }),
    commande('b', 'washing', { customerName: 'Koffi Yao', totalAmount: 12_000 }),
    commande('c', 'ready', { customerName: 'Fatou Diarra' }),
  ]

  it('affiche les trois colonnes avec leur compteur', async () => {
    await monter(
      <KanbanBoard
        commandes={commandes}
        piecesParCommande={new Map([['b', 3]])}
        role="owner"
        aujourdhui="2026-10-27"
        transition={null}
        onChangerStatut={vi.fn()}
      />,
    )

    const titres = [...(hote?.querySelectorAll('section[aria-labelledby] h2') ?? [])].map(
      (titre) => titre.textContent,
    )
    expect(titres).toHaveLength(3)
    expect(titres[0]).toContain('Reçues')
    expect(titres[0]).toContain('1')
    expect(titres[1]).toContain('En cours')
    expect(titres[2]).toContain('Prêtes')
  })

  it('affiche la référence, le client, le montant et le nombre de pièces', async () => {
    await monter(
      <KanbanBoard
        commandes={commandes}
        piecesParCommande={new Map([['b', 3]])}
        role="owner"
        aujourdhui="2026-10-27"
        transition={null}
        onChangerStatut={vi.fn()}
      />,
    )

    expect(texte()).toContain('Awa Koné')
    expect(texte()).toContain('Koffi Yao')
    expect(texte()).toContain('12 000 FCFA')
    expect(texte()).toContain('3 pièces')
    // Une commande sans ligne chargée affiche un tiret, pas « 0 pièce ».
    expect(texte()).toContain('—')
  })

  it('explique une colonne vide au lieu de laisser un cadre muet', async () => {
    await monter(
      <KanbanBoard
        commandes={[]}
        piecesParCommande={new Map()}
        role="owner"
        aujourdhui="2026-10-27"
        transition={null}
        onChangerStatut={vi.fn()}
      />,
    )

    expect(texte()).toContain('Aucune commande dans cette étape.')
  })

  it('signale le retard d’une commande sur sa carte', async () => {
    await monter(
      <KanbanBoard
        commandes={[commande('z', 'washing', { customerName: 'Retardataire', dueDate: '2000-01-01' })]}
        piecesParCommande={new Map()}
        role="owner"
        aujourdhui="2026-10-27"
        transition={null}
        onChangerStatut={vi.fn()}
      />,
    )

    expect(texte()).toContain('en retard')
  })
})
