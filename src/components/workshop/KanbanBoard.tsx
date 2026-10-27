import KanbanColumn from '@/components/workshop/KanbanColumn'
import OrderCard from '@/components/workshop/OrderCard'
import { repartirParColonne } from '@/lib/atelierKanban'
import { isOrderLate } from '@/constants/orders'
import type { LocalOrder } from '@/db/localDb'
import type { OrderStatus, TenantRole } from '@/types/database'

/**
 * Tableau Kanban de l'atelier.
 *
 * Reçoit les commandes déjà chargées et filtrées par l'écran (recherche, statut),
 * les répartit en trois colonnes et délègue le changement de statut au parent —
 * qui utilise le même `updateStatus` que le reste de l'application (écriture
 * locale puis synchronisation). Aucun second chemin d'écriture n'est créé.
 */
export default function KanbanBoard({
  commandes,
  piecesParCommande,
  role,
  aujourdhui,
  transition,
  demo = false,
  onChangerStatut,
}: {
  commandes: readonly LocalOrder[]
  piecesParCommande: Map<string, number>
  role: TenantRole | null
  /** Date du jour (AAAA-MM-JJ), injectée pour rendre le rendu déterministe. */
  aujourdhui: string
  /** Commande en cours de changement de statut, s'il y en a une. */
  transition: string | null
  demo?: boolean
  onChangerStatut: (orderId: string, statut: OrderStatus) => Promise<void>
}) {
  const repartition = repartirParColonne(commandes)

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {repartition.map(({ colonne, commandes: liste }) => (
        <KanbanColumn
          key={colonne.id}
          colonne={colonne}
          nombre={liste.length}
          vide={
            demo
              ? 'Aucune commande de démonstration dans cette colonne.'
              : 'Aucune commande dans cette étape.'
          }
        >
          {liste.map((commande) => (
            <li key={commande.id}>
              <OrderCard
                commande={commande}
                pieces={piecesParCommande.get(commande.id) ?? 0}
                role={role}
                retard={isOrderLate(commande, aujourdhui)}
                enCours={transition === commande.id}
                demo={demo}
                onChangerStatut={onChangerStatut}
              />
            </li>
          ))}
        </KanbanColumn>
      ))}
    </div>
  )
}
