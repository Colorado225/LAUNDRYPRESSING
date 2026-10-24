import { useMemo, useState, type ReactNode } from 'react'
import {
  Banknote,
  BarChart3,
  ClipboardList,
  Download,
  Loader2,
  Lock,
  PieChart,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useAllCashPayments, useAllLocalItems, useLocalOrders } from '@/db/hooks'
import { useTenantStore } from '@/lib/tenantContext'
import { can } from '@/lib/permissions'
import { formatFcfa } from '@/lib/formatters'
import {
  PERIODES,
  PERIODE_LABELS,
  computeRapport,
  rapportCsv,
  type Periode,
  type Rapport,
} from '@/lib/reporting'

/**
 * Rapports et statistiques (écran 11 de la maquette).
 *
 * Le tableau de bord répond à « où en est le pressing maintenant ? ». Cette page
 * répond à « comment se comporte le pressing dans la durée ? » : elle compare
 * une période à la précédente, montre la série quotidienne, la répartition des
 * statuts et les prestations qui tirent le chiffre d'affaires.
 *
 * Tout est calculé depuis IndexedDB (`src/lib/reporting.ts`), donc l'écran
 * s'ouvre hors ligne. Les encaissements Mobile Money, qui viennent du serveur,
 * n'entrent pas dans la courbe : c'est écrit sur l'écran plutôt que de laisser
 * croire à une trésorerie complète.
 *
 * Les graphiques sont faits à la main en SVG : aucune librairie de graphiques
 * n'est ajoutée au bundle, qui doit rester léger sur une tablette d'entrée de
 * gamme en 3G (même raison que le chargement différé des écrans).
 */
export default function Rapports() {
  const role = useTenantStore((state) => state.role)
  const autorise = can(role, 'dashboard.view')

  const orders = useLocalOrders()
  const items = useAllLocalItems()
  const cashPayments = useAllCashPayments()

  const [periode, setPeriode] = useState<Periode>(30)
  const [exportEnCours, setExportEnCours] = useState(false)

  const rapport: Rapport | null = useMemo(() => {
    if (orders === undefined) return null
    return computeRapport(orders, items ?? [], cashPayments ?? [], { jours: periode })
  }, [orders, items, cashPayments, periode])

  if (!autorise) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <Lock className="mx-auto text-slate-400" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-slate-800">Accès réservé</p>
        <p className="mt-1 text-sm text-slate-500">
          Les rapports exposent le chiffre d’affaires : seul le propriétaire les consulte.
        </p>
      </div>
    )
  }

  if (!rapport) {
    return (
      <p className="flex items-center justify-center gap-2 py-24 text-slate-500" role="status">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        Calcul des rapports…
      </p>
    )
  }

  const exporterCsv = () => {
    setExportEnCours(true)
    try {
      // BOM UTF-8 : sans lui, Excel affiche « FCFA » et les accents en
      // caractères parasites sur un poste Windows configuré en français.
      const contenu = `\uFEFF${rapportCsv(rapport)}`
      const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const lien = document.createElement('a')
      lien.href = url
      lien.download = `rapport-${rapport.debut}-${rapport.fin}.csv`
      lien.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportEnCours(false)
    }
  }

  const maximumJour = Math.max(1, ...rapport.parJour.map((point) => point.facture))
  const maximumSemaine = Math.max(1, ...rapport.parJourSemaine.map((jour) => jour.facture))

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
            <BarChart3 size={22} aria-hidden /> Rapports
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Du {rapport.debut.split('-').reverse().join('/')} au{' '}
            {rapport.fin.split('-').reverse().join('/')} · {rapport.jours} jours
          </p>
        </div>

        <button
          type="button"
          onClick={exporterCsv}
          disabled={exportEnCours}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-60"
        >
          <Download size={18} aria-hidden /> Exporter en CSV
        </button>
      </header>

      {/* Sélecteur de période : trois boutons plutôt qu'un menu — un seul geste,
          et l'état est lisible d'un coup d'œil sur une tablette. */}
      <div
        role="group"
        aria-label="Période du rapport"
        className="inline-flex rounded-xl border border-slate-200 bg-white p-1"
      >
        {PERIODES.map((valeur) => {
          const actif = valeur === periode
          return (
            <button
              key={valeur}
              type="button"
              aria-pressed={actif}
              onClick={() => setPeriode(valeur)}
              className={`min-h-12 rounded-lg px-4 text-sm font-semibold transition ${
                actif
                  ? 'bg-brand-navy text-white'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-brand-navy'
              }`}
            >
              {PERIODE_LABELS[valeur]}
            </button>
          )
        })}
      </div>

      <section aria-label="Indicateurs de la période" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Carte
          libelle="Facturé"
          valeur={formatFcfa(rapport.facture)}
          detail="Hors commandes annulées"
          variation={rapport.variation.facture}
          icone={<TrendingUp size={18} aria-hidden />}
        />
        <Carte
          libelle="Encaissé"
          valeur={formatFcfa(rapport.encaisse)}
          detail="Espèces uniquement"
          icone={<Banknote size={18} aria-hidden />}
        />
        <Carte
          libelle="Commandes"
          valeur={String(rapport.commandes)}
          detail={rapport.annulees > 0 ? `${rapport.annulees} annulée(s)` : 'Aucune annulation'}
          variation={rapport.variation.commandes}
          icone={<ClipboardList size={18} aria-hidden />}
        />
        <Carte
          libelle="Panier moyen"
          valeur={formatFcfa(rapport.panierMoyen)}
          detail="Par commande facturée"
          variation={rapport.variation.panierMoyen}
          icone={<ShoppingBag size={18} aria-hidden />}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Chiffre d’affaires par jour
          </h2>
          <p className="text-xs text-slate-500">
            Reste à encaisser sur la période :{' '}
            <span className="font-semibold text-brand-navy">
              {formatFcfa(rapport.resteAEncaisser)}
            </span>
          </p>
        </div>

        <GraphiqueJours rapport={rapport} maximum={maximumJour} />

        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-teal" aria-hidden />
          Montant facturé, par jour de création de la commande
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <PieChart size={15} aria-hidden /> Répartition par statut
          </h2>
          <ul className="mt-3 space-y-2.5">
            {rapport.parStatut.map((part) => (
              <li key={part.status}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-700">{part.label}</span>
                  <span className="tabular-nums text-slate-500">
                    {part.count}
                    <span className="ml-1.5 text-xs text-slate-400">
                      {Math.round(part.part * 100)} %
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-navy"
                    style={{ width: `${Math.max(part.part * 100, part.count > 0 ? 3 : 0)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          {rapport.commandes + rapport.annulees === 0 && (
            <p className="mt-3 text-sm text-slate-500">Aucune commande sur la période.</p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Activité par jour de la semaine
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Utile pour placer les lessives : le jour le plus chargé n’est pas toujours le lundi.
          </p>

          <ul className="mt-3 space-y-2">
            {rapport.parJourSemaine.map((jour) => (
              <li key={jour.label} className="flex items-center gap-2 text-sm">
                <span className="w-12 shrink-0 text-slate-600">{jour.label}</span>
                <span className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-brand-teal"
                    style={{ width: `${(jour.facture / maximumSemaine) * 100}%` }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums text-xs text-slate-500">
                  {formatFcfa(jour.facture)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <h2 className="px-4 pt-4 text-sm font-bold uppercase tracking-wide text-slate-500 sm:px-5">
          Prestations les plus demandées
        </h2>

        {rapport.topPrestations.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 sm:px-5">
            Aucune ligne de commande sur la période.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left text-sm">
              <thead className="border-y border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold sm:px-5">Prestation</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Lignes</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold sm:px-5">
                    Montant
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rapport.topPrestations.map((ligne) => (
                  <tr key={ligne.label}>
                    <td className="px-4 py-2.5 font-medium text-slate-800 sm:px-5">
                      {ligne.label}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {ligne.count}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-brand-navy sm:px-5">
                      {formatFcfa(ligne.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <strong>Périmètre des chiffres.</strong> Ce rapport lit les commandes et les
        encaissements enregistrés sur cette tablette. Les paiements Mobile Money, qui
        viennent du serveur, n’y figurent pas : le montant « encaissé » ne compte que
        les espèces. Les commandes créées sur une autre tablette du même pressing
        apparaissent après synchronisation.
      </p>
    </div>
  )
}

/** Graphique en barres de la série quotidienne. */
function GraphiqueJours({ rapport, maximum }: { rapport: Rapport; maximum: number }) {
  const points = rapport.parJour
  const largeur = 720
  const hauteur = 220
  const margeBasse = 24
  const margeHaute = 8
  const zoneHaute = hauteur - margeBasse - margeHaute
  const pas = largeur / Math.max(points.length, 1)
  const largeurBarre = Math.max(2, Math.min(28, pas * 0.62))

  // Sur 90 jours, un libellé par barre serait illisible : on n'affiche qu'un
  // repère sur sept environ, toujours aligné sur une semaine.
  const intervalleLabel = points.length > 45 ? 14 : points.length > 14 ? 7 : 1

  const resume = `Série de ${points.length} jours, maximum ${formatFcfa(maximum)} par jour, total ${formatFcfa(rapport.facture)}.`

  return (
    <figure className="mt-3">
      <svg
        role="img"
        aria-label={resume}
        viewBox={`0 0 ${largeur} ${hauteur}`}
        className="h-56 w-full"
        preserveAspectRatio="none"
      >
        {/* Lignes de repère : quart, moitié, trois quarts du maximum. */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = margeHaute + zoneHaute - zoneHaute * fraction
          return (
            <line
              key={fraction}
              x1={0}
              x2={largeur}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth={1}
              strokeDasharray={fraction === 1 ? undefined : '4 4'}
            />
          )
        })}

        {points.map((point, index) => {
          const hauteurBarre = (point.facture / maximum) * zoneHaute
          const x = index * pas + (pas - largeurBarre) / 2
          const y = margeHaute + zoneHaute - hauteurBarre
          return (
            <g key={point.date}>
              <rect
                x={x}
                y={y}
                width={largeurBarre}
                height={Math.max(hauteurBarre, point.facture > 0 ? 2 : 0)}
                rx={Math.min(3, largeurBarre / 2)}
                fill="#0f766e"
              >
                <title>{`${point.label} : ${formatFcfa(point.facture)} (${point.commandes} commande(s))`}</title>
              </rect>
              {index % intervalleLabel === 0 && (
                <text
                  x={index * pas + pas / 2}
                  y={hauteur - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#64748b"
                >
                  {point.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="sr-only">{resume}</figcaption>
    </figure>
  )
}

/** Carte d'indicateur, avec variation par rapport à la période précédente. */
function Carte({
  libelle,
  valeur,
  detail,
  variation,
  icone,
}: {
  libelle: string
  valeur: string
  detail: string
  variation?: number | null
  icone: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-xs font-semibold uppercase tracking-wide">{libelle}</span>
        {icone}
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums text-brand-navy sm:text-xl">{valeur}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500">{detail}</span>
        {typeof variation === 'number' && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
              variation >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}
            title="Comparaison avec la période précédente, de même durée"
          >
            {variation >= 0 ? (
              <TrendingUp size={11} aria-hidden />
            ) : (
              <TrendingDown size={11} aria-hidden />
            )}
            {variation > 0 ? '+' : ''}
            {variation} %
          </span>
        )}
      </div>
    </div>
  )
}
