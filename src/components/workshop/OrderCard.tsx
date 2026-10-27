import { Link } from 'react-router-dom'
import { ArrowRight, MoreHorizontal, Shirt, Timer } from 'lucide-react'
import { ORDER_STATUSES, allowedStatusTargets, getNextStatus } from '@/constants/orders'
import { formatDateFr, formatDateTimeFr, formatFcfa } from '@/lib/formatters'
import { shortOrderReference } from '@/services/qrService'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { LocalOrder } from '@/db/localDb'
import type { OrderStatus, TenantRole } from '@/types/database'

/**
 * Carte de commande du Kanban d'atelier.
 *
 * Elle affiche l'état réel de la commande et propose les transitions
 * **autorisées par le rôle** (`allowedStatusTargets`, miroir du garde-fou
 * serveur). Deux principes :
 *
 *  - le glisser-déposer n'existe pas : sur une tablette d'atelier, avec des
 *    gants, un geste de glissement est peu fiable — et il serait de toute
 *    façon inutilisable au clavier ;
 *  - le changement de statut passe par un menu explicite, avec le libellé
 *    exact du statut cible. Un comptoir ne doit jamais changer un statut
 *    « à peu près ».
 */
export default function OrderCard({
  commande,
  pieces,
  role,
  retard,
  enCours,
  demo = false,
  onChangerStatut,
}: {
  commande: LocalOrder
  /** Nombre de pièces de la commande (0 si les lignes ne sont pas chargées). */
  pieces: number
  role: TenantRole | null
  retard: boolean
  /** Une transition est déjà en cours d'enregistrement. */
  enCours: boolean
  /** Mode démonstration : aucune écriture possible. */
  demo?: boolean
  onChangerStatut: (orderId: string, statut: OrderStatus) => Promise<void>
}) {
  const meta = ORDER_STATUSES[commande.status]
  const cibles = demo ? [] : allowedStatusTargets(commande.status, role)
  const suivante = getNextStatus(commande.status)

  return (
    <article className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/commandes/${commande.id}`}
            className="font-mono text-xs font-bold text-primary hover:underline"
          >
            {shortOrderReference(commande.id)}
          </Link>
          <p className="truncate text-sm font-semibold text-brand-navy">{commande.customerName}</p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions pour ${shortOrderReference(commande.id)}`}
            disabled={enCours}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <MoreHorizontal size={16} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>{meta.label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to={`/commandes/${commande.id}`}>
                <ArrowRight size={15} aria-hidden /> Ouvrir la fiche
              </Link>
            </DropdownMenuItem>

            {cibles.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-slate-500">
                {demo
                  ? 'Changement de statut désactivé en mode démonstration.'
                  : 'Aucune transition autorisée pour votre rôle.'}
              </p>
            ) : (
              <>
                <DropdownMenuSeparator />
                {suivante && cibles.includes(suivante) && (
                  <DropdownMenuItem onSelect={() => void onChangerStatut(commande.id, suivante)}>
                    <Timer size={15} aria-hidden /> Étape suivante : {ORDER_STATUSES[suivante].label}
                  </DropdownMenuItem>
                )}
                {cibles
                  .filter((cible) => cible !== suivante)
                  .map((cible) => (
                    <DropdownMenuItem
                      key={cible}
                      variant={cible === 'cancelled' ? 'danger' : 'default'}
                      onSelect={() => void onChangerStatut(commande.id, cible)}
                    >
                      {ORDER_STATUSES[cible].label}
                    </DropdownMenuItem>
                  ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <dl className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        <div className="inline-flex items-center gap-1">
          <Shirt size={13} aria-hidden className="text-slate-400" />
          <dt className="sr-only">Articles</dt>
          <dd>{pieces > 0 ? `${pieces} pièce${pieces > 1 ? 's' : ''}` : '—'}</dd>
        </div>
        <div>
          <dt className="sr-only">Montant</dt>
          <dd className="font-bold text-brand-navy">{formatFcfa(commande.totalAmount)}</dd>
        </div>
      </dl>

      <p className="mt-1.5 text-[11px] text-slate-500">
        Reçue le {formatDateTimeFr(commande.createdAt)}
        {commande.dueDate && (
          <>
            {' · '}
            <span className={retard ? 'font-bold text-rose-700' : ''}>
              à remettre le {formatDateFr(commande.dueDate)}
              {retard ? ' (en retard)' : ''}
            </span>
          </>
        )}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}
        >
          {meta.label}
        </span>
        {enCours && <span className="text-[11px] font-semibold text-slate-500">Enregistrement…</span>}
      </div>
    </article>
  )
}
