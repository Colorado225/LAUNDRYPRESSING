import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Bike,
  ClipboardList,
  CloudOff,
  Loader2,
  Lock,
  PackageSearch,
  Smartphone,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useAllCashPayments, useAllLocalItems, useLocalOrders } from '@/db/hooks'
import { useTenantStore } from '@/lib/tenantContext'
import { can } from '@/lib/permissions'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import { isSupabaseConfigured } from '@/lib/env'
import {
  computeDashboard,
  recentOrders,
  shortDayLabel,
  startOfMonth,
  type DashboardSnapshot,
} from '@/services/dashboardService'
import { ORDER_STATUSES } from '@/constants/orders'
import { shortOrderReference } from '@/services/qrService'
import { isLowStock, listStockItems, STOCK_UNIT_LABELS } from '@/services/stockService'
import { sumExpensesSince, sumMobileMoneySince } from '@/services/expenseService'
import type { StockItemRow } from '@/types/database'

/**
 * Tableau de bord du propriétaire (palier 3).
 *
 * Les indicateurs d'activité sont calculés localement (IndexedDB) : l'écran
 * s'ouvre donc même sans réseau. Deux compléments viennent du serveur — les
 * dépenses et les encaissements Mobile Money — et sont marqués « hors ligne »
 * quand la lecture échoue, plutôt que d'afficher un zéro trompeur.
 */
export default function TableauDeBord() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const autorise = can(role, 'dashboard.view')

  const orders = useLocalOrders()
  const items = useAllLocalItems()
  const cashPayments = useAllCashPayments()

  const [stock, setStock] = useState<StockItemRow[]>([])
  const [depensesMois, setDepensesMois] = useState<number | null>(null)
  const [mobileMoneyJour, setMobileMoneyJour] = useState<number | null>(null)

  const chargement = orders === undefined

  const snapshot: DashboardSnapshot | null = useMemo(() => {
    if (orders === undefined) return null
    return computeDashboard(orders, items, cashPayments)
  }, [orders, items, cashPayments])

  useEffect(() => {
    let vivant = true
    if (!tenantId || !autorise || !isSupabaseConfigured) return

    const debutMois = startOfMonth()
    void (async () => {
      // Les trois lectures sont indépendantes : un échec (réseau, droits) ne
      // doit pas effacer les autres indicateurs.
      const [articles, depenses, mobileMoney] = await Promise.all([
        listStockItems(tenantId).catch(() => [] as StockItemRow[]),
        sumExpensesSince(tenantId, debutMois).catch(() => null),
        sumMobileMoneySince(tenantId, snapshot?.today ?? debutMois).catch(() => null),
      ])
      if (!vivant) return
      setStock(articles)
      setDepensesMois(depenses)
      setMobileMoneyJour(mobileMoney)
    })()

    return () => {
      vivant = false
    }
  }, [tenantId, autorise, snapshot?.today])

  if (!autorise) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <Lock className="mx-auto text-slate-400" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-slate-800">Accès réservé</p>
        <p className="mt-1 text-sm text-slate-500">
          Le tableau de bord expose la trésorerie : seul le propriétaire le consulte.
        </p>
      </div>
    )
  }

  if (chargement || !snapshot) {
    return (
      <p className="flex items-center justify-center gap-2 py-24 text-slate-500" role="status">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        Chargement du tableau de bord…
      </p>
    )
  }

  const alertes = stock.filter(isLowStock)
  const dernieres = recentOrders(orders ?? [], 5)
  const maximumSerie = Math.max(1, ...snapshot.series.map((point) => point.cash))

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
            <Sparkles size={22} aria-hidden /> Tableau de bord
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Aujourd’hui, {snapshot.today}
            {snapshot.lateOrders > 0 && (
              <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                {snapshot.lateOrders} en retard
              </span>
            )}
          </p>
        </div>

        <Link
          to="/depenses"
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-semibold text-white hover:bg-brand-slate"
        >
          <Wallet size={18} aria-hidden /> Dépenses
        </Link>
      </header>

      <section aria-label="Activité du jour" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Carte
          libelle="Commandes du jour"
          valeur={String(snapshot.ordersToday)}
          detail={`${snapshot.activeOrders} en atelier`}
          icone={<ClipboardList size={18} aria-hidden />}
        />
        <Carte
          libelle="Prêtes"
          valeur={String(snapshot.readyOrders)}
          detail={`${snapshot.lateOrders} en retard`}
          icone={<PackageSearch size={18} aria-hidden />}
          ton={snapshot.lateOrders > 0 ? 'alerte' : 'neutre'}
        />
        <Carte
          libelle="Encaissé aujourd’hui"
          valeur={formatFcfa(snapshot.cashToday)}
          detail="Espèces"
          icone={<Banknote size={18} aria-hidden />}
          ton="positif"
        />
        <Carte
          libelle="Reste à encaisser"
          valeur={formatFcfa(snapshot.outstanding)}
          detail="Commandes actives"
          icone={<TrendingUp size={18} aria-hidden />}
        />
      </section>

      {/* Cinq dernières commandes : l'accueil du propriétaire doit permettre
          de reprendre la main sur la dernière prise de commande sans passer
          par la liste complète. */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Dernières commandes
          </h2>
          <Link
            to="/commandes"
            className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-brand-teal hover:underline"
          >
            Toutes les commandes
            <ArrowRight size={15} aria-hidden />
          </Link>
        </div>

        {dernieres.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 sm:px-5">
            Aucune commande enregistrée sur cet appareil.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="border-y border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold sm:px-5">N°</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Client</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Statut</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Montant</th>
                  <th scope="col" className="px-4 py-2 font-semibold sm:px-5">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dernieres.map((commande) => {
                  const meta = ORDER_STATUSES[commande.status]
                  return (
                    <tr key={commande.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 sm:px-5">
                        <Link
                          to={`/commandes/${commande.id}`}
                          className="font-mono text-xs font-semibold text-brand-teal hover:underline"
                        >
                          {shortOrderReference(commande.id)}
                        </Link>
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-2.5 font-medium text-slate-800">
                        {commande.customerName}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-brand-navy">
                        {formatFcfa(commande.totalAmount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500 sm:px-5">
                        {formatDateFr(commande.createdAt.slice(0, 10))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Chiffre d’affaires
          </h2>

          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-slate-500">Espèces, 7 derniers jours</dt>
              <dd className="text-lg font-bold text-brand-navy">{formatFcfa(snapshot.cashWeek)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Panier moyen</dt>
              <dd className="text-lg font-bold text-brand-navy">
                {formatFcfa(snapshot.averageBasket)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Mobile Money aujourd’hui</dt>
              <dd className="text-lg font-bold text-brand-navy">
                {mobileMoneyJour === null ? (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-700">
                    <CloudOff size={14} aria-hidden /> Hors ligne
                  </span>
                ) : (
                  formatFcfa(mobileMoneyJour)
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Dépenses du mois</dt>
              <dd className="text-lg font-bold text-rose-700">
                {depensesMois === null ? (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-700">
                    <CloudOff size={14} aria-hidden /> Hors ligne
                  </span>
                ) : (
                  formatFcfa(depensesMois)
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex h-28 items-end gap-1.5" role="img" aria-label="Espèces encaissées sur sept jours">
            {snapshot.series.map((point) => (
              <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-brand-teal/80"
                  style={{ height: `${Math.max(4, (point.cash / maximumSerie) * 80)}px` }}
                  title={`${shortDayLabel(point.date)} : ${formatFcfa(point.cash)}`}
                />
                <span className="truncate text-[10px] text-slate-500">{point.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Espèces par jour, du plus ancien au plus récent.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Alertes de stock</h2>

          {!isSupabaseConfigured ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-amber-800">
              <CloudOff size={16} aria-hidden /> Module indisponible sans Supabase.
            </p>
          ) : alertes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Aucun article sous le seuil d’alerte.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {alertes.slice(0, 6).map((article) => (
                <li
                  key={article.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-amber-900">
                    <AlertTriangle size={15} className="shrink-0" aria-hidden />
                    <span className="truncate">{article.name}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-amber-900">
                    {Number(article.quantity)} / {Number(article.min_quantity)}{' '}
                    {STOCK_UNIT_LABELS[article.unit]}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link
            to="/stock"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-teal hover:underline"
          >
            <Bike size={16} aria-hidden /> Ouvrir le stock
          </Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Répartition des commandes
          </h2>
          <ul className="mt-3 space-y-1.5">
            {snapshot.byStatus.map((ligne) => (
              <li key={ligne.status} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-slate-600">{ligne.label}</span>
                <span className="font-semibold text-brand-navy">{ligne.count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Prestations les plus demandées
          </h2>
          {snapshot.topServices.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Aucune prestation enregistrée.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {snapshot.topServices.map((ligne) => (
                <li
                  key={ligne.label}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-800">
                      {ligne.label}
                    </span>
                    <span className="text-xs text-slate-500">{ligne.count} pièce(s)</span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-brand-navy">
                    {formatFcfa(ligne.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
        <Smartphone size={16} className="mt-0.5 shrink-0" aria-hidden />
        Les encaissements Mobile Money et les dépenses sont lus au serveur : hors connexion,
        ils apparaissent « hors ligne » au lieu d’être estimés. Le reste des indicateurs est
        calculé sur la tablette.
      </p>
    </div>
  )
}

function Carte({
  libelle,
  valeur,
  detail,
  icone,
  ton = 'neutre',
}: {
  libelle: string
  valeur: string
  detail: string
  icone: React.ReactNode
  ton?: 'neutre' | 'positif' | 'alerte'
}) {
  const couleurs =
    ton === 'positif'
      ? 'text-brand-teal'
      : ton === 'alerte'
        ? 'text-rose-700'
        : 'text-brand-navy'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icone}
        {libelle}
      </p>
      <p className={`mt-2 text-xl font-bold ${couleurs}`}>{valeur}</p>
      <p className="text-xs text-slate-500">{detail}</p>
    </div>
  )
}
