import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CloudOff, Loader2, PlusCircle, Search } from 'lucide-react'
import { useLocalOrders } from '@/db/hooks'
import { ORDER_STATUSES, ORDER_FLOW } from '@/constants/orders'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import type { OrderStatus } from '@/types/database'

/**
 * Liste des commandes — lue dans IndexedDB, jamais sur le réseau.
 * L'écran reste donc pleinement utilisable en mode avion.
 */
export default function Orders() {
  const orders = useLocalOrders()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')

  const filtered = useMemo(() => {
    if (!orders) return []
    const term = search.trim().toLowerCase()
    return orders.filter((order) => {
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter
      const matchesSearch =
        term.length === 0 ||
        order.customerName.toLowerCase().includes(term) ||
        order.customerPhone.includes(term)
      return matchesStatus && matchesSearch
    })
  }, [orders, search, statusFilter])

  if (orders === undefined) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        Chargement des commandes…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-navy sm:text-2xl">Commandes</h1>
          <p className="text-sm text-slate-500">
            {orders.length === 0
              ? 'Aucune commande enregistrée sur cet appareil.'
              : `${orders.length} commande${orders.length > 1 ? 's' : ''} enregistrée${orders.length > 1 ? 's' : ''} localement`}
          </p>
        </div>

        <Link
          to="/commandes/nouvelle"
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white transition-colors hover:bg-brand-teal-dark"
        >
          <PlusCircle size={18} aria-hidden />
          Nouvelle commande
        </Link>
      </div>

      {/* Recherche */}
      <div className="relative">
        <Search
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher un client ou un téléphone…"
          aria-label="Rechercher une commande"
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-brand-teal"
        />
      </div>

      {/* Filtres par statut */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
          Toutes
        </FilterChip>
        {ORDER_FLOW.map((status) => (
          <FilterChip
            key={status}
            active={statusFilter === status}
            onClick={() => setStatusFilter(status)}
          >
            {ORDER_STATUSES[status].shortLabel}
          </FilterChip>
        ))}
        <FilterChip
          active={statusFilter === 'cancelled'}
          onClick={() => setStatusFilter('cancelled')}
        >
          {ORDER_STATUSES.cancelled.shortLabel}
        </FilterChip>
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
          <p className="font-semibold text-slate-600">Aucune commande à afficher</p>
          <p className="mt-1 text-sm text-slate-500">
            {orders.length === 0
              ? 'Créez votre première commande : elle sera enregistrée même sans internet.'
              : 'Aucun résultat pour cette recherche.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((order) => {
            const meta = ORDER_STATUSES[order.status]
            return (
              <li key={order.id}>
                <Link
                  to={`/commandes/${order.id}`}
                  className="flex min-h-16 flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-brand-teal active:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-brand-navy">{order.customerName}</p>
                    <p className="text-sm text-slate-500">
                      {order.customerPhone} · {formatDateFr(order.createdAt)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {order.synced === 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
                        title={
                          order.syncError ??
                          'Enregistrée sur cet appareil, en attente de synchronisation'
                        }
                      >
                        {order.syncError ? (
                          <CloudOff size={14} aria-hidden />
                        ) : (
                          <Loader2 size={14} aria-hidden />
                        )}
                        {order.syncError ? 'Non synchronisée' : 'En attente'}
                      </span>
                    )}

                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${meta.badgeClass}`}
                    >
                      {meta.label}
                    </span>

                    <span className="w-24 text-right font-semibold text-brand-navy">
                      {formatFcfa(order.totalAmount)}
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-12 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
        active
          ? 'border-brand-navy bg-brand-navy text-white'
          : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 active:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}
