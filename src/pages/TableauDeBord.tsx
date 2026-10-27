import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarDays,
  ClipboardList,
  CloudOff,
  Hourglass,
  Loader2,
  Lock,
  PackageCheck,
  PlusCircle,
  Smartphone,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  useAllCashPayments,
  useAllLocalItems,
  useLocalOrders,
  useRecentNotifications,
} from '@/db/hooks'
import MetricCard from '@/components/dashboard/MetricCard'
import RevenueChart from '@/components/dashboard/RevenueChart'
import RecentOrdersTable, {
  type LigneCommandeRecente,
} from '@/components/dashboard/RecentOrdersTable'
import DemoSwitch from '@/components/dashboard/DemoSwitch'
import {
  COMMANDES_RÉCENTES_DÉMO,
  INDICATEURS_DÉMO,
  SÉRIE_DÉMO,
  instantanéDémo,
} from '@/data/demo-data'
import { useDemoStore } from '@/lib/demoMode'
import { useTenantStore } from '@/lib/tenantContext'
import { can } from '@/lib/permissions'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import { isSupabaseConfigured } from '@/lib/env'
import {
  computeDashboard,
  recentOrders,
  startOfMonth,
  variationPourcent,
  type DashboardSnapshot,
} from '@/services/dashboardService'
import { shortOrderReference } from '@/services/qrService'
import { MOTIFS, clientsAPrevenir } from '@/lib/notifications'
import { isLowStock, listStockItems, STOCK_UNIT_LABELS } from '@/services/stockService'
import { sumExpensesSince, sumMobileMoneySince } from '@/services/expenseService'
import type { StockItemRow } from '@/types/database'

/**
 * Tableau de bord (palier 3, remis en page par la refonte).
 *
 * Les indicateurs d'activité sont calculés **localement** (IndexedDB) :
 * l'écran s'ouvre donc même sans réseau. Deux compléments viennent du
 * serveur — les dépenses et les encaissements Mobile Money — et sont marqués
 * « hors ligne » quand la lecture échoue, plutôt que d'afficher un zéro
 * trompeur.
 *
 * Le mode démonstration affiche les chiffres de la maquette (bandeau rappelé
 * en haut de l'application). Dans ce mode, les sections calculées sur
 * l'activité réelle sont **masquées** : on ne mélange jamais, dans un même
 * écran, un montant fictif et un montant réel.
 */
export default function TableauDeBord() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const pressing = useTenantStore((state) => state.tenantName)
  const autorise = can(role, 'dashboard.view')
  const peutCreer = can(role, 'orders.create')
  const demo = useDemoStore((state) => state.actif)

  const orders = useLocalOrders()
  const items = useAllLocalItems()
  const cashPayments = useAllCashPayments()
  const notifications = useRecentNotifications()

  const [stock, setStock] = useState<StockItemRow[]>([])
  const [depensesMois, setDepensesMois] = useState<number | null>(null)
  const [mobileMoneyJour, setMobileMoneyJour] = useState<number | null>(null)

  const chargement = !demo && orders === undefined

  const snapshot: DashboardSnapshot | null = useMemo(() => {
    if (demo) return instantanéDémo()
    if (orders === undefined) return null
    return computeDashboard(orders, items, cashPayments)
  }, [demo, orders, items, cashPayments])

  const aujourdHui = demo ? '26 oct. 2026' : formatDateFr(new Date())

  useEffect(() => {
    let vivant = true
    // En démonstration, aucune lecture serveur : l'écran ne doit rien mélanger
    // et ne pas laisser croire que les chiffres de la maquette sont les nôtres.
    if (!tenantId || !autorise || !isSupabaseConfigured || demo) return

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
  }, [tenantId, autorise, snapshot?.today, demo])

  /** Nombre de pièces par commande, pour la colonne « Articles ». */
  const piecesParCommande = useMemo(() => {
    const compte = new Map<string, number>()
    for (const item of items ?? []) {
      compte.set(item.orderId, (compte.get(item.orderId) ?? 0) + (item.quantity ?? 1))
    }
    return compte
  }, [items])

  if (!autorise) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-8 text-center">
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
  const aPrevenir = demo
    ? []
    : clientsAPrevenir(orders ?? [], notifications, {
        today: snapshot.today,
        pressing: pressing ?? '',
      }).slice(0, 5)

  const dernieres: LigneCommandeRecente[] = demo
    ? COMMANDES_RÉCENTES_DÉMO.map((commande) => ({
        id: commande.reference,
        reference: commande.reference,
        client: commande.client,
        articles: commande.articles,
        montant: commande.montant,
        statut: commande.statut,
        date: commande.date,
      }))
    : recentOrders(orders ?? [], 5).map((commande) => {
        const pieces = piecesParCommande.get(commande.id) ?? 0
        return {
          id: commande.id,
          reference: shortOrderReference(commande.id),
          client: commande.customerName,
          articles: `${pieces} pièce${pieces > 1 ? 's' : ''}`,
          montant: commande.totalAmount,
          statut: commande.status,
          date: commande.createdAt.slice(0, 10),
          to: `/commandes/${commande.id}`,
        }
      })

  const pointsCourbe = demo
    ? SÉRIE_DÉMO.map((point) => ({ label: point.label, montant: point.montant }))
    : snapshot.series.map((point) => ({ label: point.label, montant: point.cash }))

  const variationCa = demo
    ? INDICATEURS_DÉMO[0]?.variation ?? null
    : variationPourcent(snapshot.cashToday, snapshot.cashYesterday)

  // « En cours » exclut les commandes déjà prêtes : additionner les deux
  // donnerait un total supérieur au nombre de commandes actives.
  const enCours = Math.max(0, snapshot.activeOrders - snapshot.readyOrders)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-brand-navy sm:text-2xl">Tableau de bord</h1>
          <p className="mt-1 text-sm text-slate-500">
            Bonjour, voici l’activité de {pressing ?? 'votre pressing'} aujourd’hui.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm font-medium text-slate-700">
            <CalendarDays size={16} aria-hidden className="text-slate-400" />
            Aujourd’hui, {aujourdHui}
          </span>
          <DemoSwitch />
          {peutCreer && (
            <Link
              to="/commandes/nouvelle"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-brand-teal-dark"
            >
              <PlusCircle size={17} aria-hidden />
              Nouvelle commande
            </Link>
          )}
        </div>
      </header>

      <section aria-label="Indicateurs du jour" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {demo ? (
          INDICATEURS_DÉMO.map((indicateur, index) => (
            <MetricCard
              key={indicateur.libelle}
              libelle={indicateur.libelle}
              valeur={indicateur.valeur}
              detail={indicateur.detail}
              variation={indicateur.variation}
              ton={indicateur.ton}
              icone={
                index === 0 ? (
                  <Wallet size={16} />
                ) : index === 1 ? (
                  <ClipboardList size={16} />
                ) : index === 2 ? (
                  <Hourglass size={16} />
                ) : (
                  <PackageCheck size={16} />
                )
              }
              serie={index === 0 ? SÉRIE_DÉMO.map((point) => point.montant) : undefined}
              delai={index * 60}
              demo
            />
          ))
        ) : (
          <>
            <MetricCard
              libelle="Chiffre d’affaires"
              valeur={formatFcfa(snapshot.cashToday)}
              detail="Espèces encaissées aujourd’hui"
              variation={variationCa}
              icone={<Wallet size={16} />}
              ton="positif"
              serie={snapshot.series.map((point) => point.cash)}
              delai={0}
            />
            <MetricCard
              libelle="Commandes"
              valeur={String(snapshot.ordersToday)}
              detail={`${snapshot.activeOrders} en atelier`}
              variation={variationPourcent(snapshot.ordersToday, snapshot.ordersYesterday)}
              icone={<ClipboardList size={16} />}
              delai={60}
            />
            <MetricCard
              libelle="En cours de traitement"
              valeur={String(enCours)}
              detail="Hors commandes prêtes"
              icone={<Hourglass size={16} />}
              delai={120}
            />
            <MetricCard
              libelle="Prêtes à être livrées"
              valeur={String(snapshot.readyOrders)}
              detail={`${snapshot.lateOrders} en retard`}
              icone={<PackageCheck size={16} />}
              ton={snapshot.lateOrders > 0 ? 'alerte' : 'positif'}
              delai={180}
            />
          </>
        )}
      </section>

      <RevenueChart points={pointsCourbe} variation={variationCa} demo={demo} />

      <RecentOrdersTable lignes={dernieres} demo={demo} />

      {demo ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Aperçu de la maquette : les sections calculées sur votre activité réelle (clients à
          prévenir, alertes de stock, dépenses, répartition) sont masquées pendant la démonstration.
          Désactivez le mode démo pour les retrouver.
        </p>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5 lg:col-span-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Trésorerie et dépenses
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                  <dt className="text-xs text-slate-500">Reste à encaisser</dt>
                  <dd className="text-lg font-bold text-brand-navy">
                    {formatFcfa(snapshot.outstanding)}
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
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-sm">
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <Banknote size={15} aria-hidden className="text-brand-teal" />
                  Dépenses du mois :{' '}
                  <strong className="font-bold text-rose-700">
                    {depensesMois === null ? 'hors ligne' : formatFcfa(depensesMois)}
                  </strong>
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <TrendingUp size={15} aria-hidden className="text-brand-teal" />
                  {snapshot.lateOrders} commande{snapshot.lateOrders > 1 ? 's' : ''} en retard
                </span>
                <Link
                  to="/depenses"
                  className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  Gérer les dépenses <ArrowRight size={14} aria-hidden />
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Alertes de stock
              </h2>

              {!isSupabaseConfigured ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-amber-800">
                  <CloudOff size={16} aria-hidden /> Module indisponible sans Supabase.
                </p>
              ) : alertes.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Aucun article sous le seuil d’alerte.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {alertes.slice(0, 5).map((article) => (
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
                className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                Ouvrir le stock <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          </section>

          {/* À prévenir : le geste le plus rentable de la journée. Une commande
              prête que le client ignore immobilise le rayon et l'argent. */}
          <section className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                À prévenir
                {aPrevenir.length > 0 && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    {aPrevenir.length}
                  </span>
                )}
              </h2>
            </div>

            {aPrevenir.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 sm:px-5">
                Personne à prévenir : tous les clients concernés ont été joints depuis le dernier
                changement.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {aPrevenir.map((proposition) => (
                  <li
                    key={proposition.order.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {proposition.order.customerName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {shortOrderReference(proposition.order.id)} ·{' '}
                        {MOTIFS[proposition.motif].label}
                        {proposition.order.dueDate
                          ? ` · prévue le ${formatDateFr(proposition.order.dueDate)}`
                          : ''}
                      </p>
                    </div>
                    <Link
                      to={`/commandes/${proposition.order.id}`}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-input px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Prévenir
                      <ArrowRight size={15} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
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

            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
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
                      className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
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

          <p className="flex items-start gap-2 rounded-2xl border border-border bg-card p-4 text-xs text-slate-500">
            <Smartphone size={16} className="mt-0.5 shrink-0" aria-hidden />
            Les encaissements Mobile Money et les dépenses sont lus au serveur : hors connexion, ils
            apparaissent « hors ligne » au lieu d’être estimés. Le reste des indicateurs est calculé
            sur la tablette.
          </p>
        </>
      )}
    </div>
  )
}
