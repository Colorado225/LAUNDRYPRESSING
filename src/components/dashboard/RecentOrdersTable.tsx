import { Link } from 'react-router-dom'
import { ArrowRight, ExternalLink, MoreHorizontal, Wallet } from 'lucide-react'
import { ORDER_STATUSES } from '@/constants/orders'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { OrderStatus } from '@/types/database'

/**
 * Tableau des commandes récentes.
 *
 * Le composant reçoit des lignes **déjà normalisées** : il ne sait pas si elles
 * viennent d'IndexedDB ou du jeu de démonstration, et ne fait aucun accès aux
 * données. C'est ce qui permet d'afficher la maquette en mode démonstration
 * sans dupliquer l'écran — et sans qu'une valeur fictive puisse entrer dans un
 * calcul métier.
 *
 * Les actions contextuelles ne sont proposées que sur une vraie commande
 * (`to` renseigné) : en démonstration, il n'y a rien à ouvrir ni à encaisser.
 */

export interface LigneCommandeRecente {
  id: string
  reference: string
  client: string
  articles: string
  montant: number
  statut: OrderStatus
  date: string
  /** Fiche de la commande ; absent en mode démonstration. */
  to?: string
}

export default function RecentOrdersTable({
  lignes,
  demo = false,
}: {
  lignes: readonly LigneCommandeRecente[]
  demo?: boolean
}) {
  return (
    <section
      aria-labelledby="titre-commandes-recentes"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <div>
          <h2 id="titre-commandes-recentes" className="text-base font-bold text-brand-navy">
            Commandes récentes
            {demo && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                démo
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {lignes.length === 0
              ? 'Aucune commande enregistrée.'
              : `${lignes.length} dernière${lignes.length > 1 ? 's' : ''} commande${lignes.length > 1 ? 's' : ''}`}
          </p>
        </div>

        <Link
          to="/commandes"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-accent"
        >
          Voir tout
          <ArrowRight size={15} aria-hidden />
        </Link>
      </div>

      {lignes.length === 0 ? (
        <p className="border-t border-border px-4 py-6 text-sm text-slate-500 sm:px-5">
          La première commande de la journée apparaîtra ici dès son enregistrement au comptoir.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-y border-border bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold sm:px-5">N° commande</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Client</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Articles</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Montant</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Statut</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-4 py-2.5 sm:px-5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lignes.map((ligne) => {
                const meta = ORDER_STATUSES[ligne.statut]
                return (
                  <tr key={ligne.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 sm:px-5">
                      {ligne.to ? (
                        <Link
                          to={ligne.to}
                          className="font-mono text-xs font-bold text-primary hover:underline"
                        >
                          {ligne.reference}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs font-bold text-slate-700">
                          {ligne.reference}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2.5 font-medium text-slate-800">
                      {ligne.client}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{ligne.articles}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold text-brand-navy">
                      {formatFcfa(ligne.montant)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">
                      {formatDateFr(ligne.date)}
                    </td>
                    <td className="px-4 py-2.5 text-right sm:px-5">
                      {ligne.to ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Actions pour ${ligne.reference}`}
                            className="inline-flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <MoreHorizontal size={16} aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel>{ligne.reference}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <Link to={ligne.to}>
                                <ExternalLink size={15} aria-hidden /> Ouvrir la fiche
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to={`${ligne.to}?regler=1`}>
                                <Wallet size={15} aria-hidden /> Encaisser
                              </Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
