import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatFcfa } from '@/lib/formatters'

/**
 * Courbe du chiffre d'affaires sur sept jours.
 *
 * Recharts est utilisé pour ce seul graphique : c'est la seule visualisation du
 * produit qui demande une échelle, un survol et un rendu correct sur un écran
 * de largeur variable. Les autres indicateurs restent en HTML/CSS (barres,
 * listes), ce qui évite d'embarquer la librairie pour deux rectangles.
 *
 * Accessibilité : le graphique porte un résumé textuel (`aria-label`) et les
 * valeurs sont aussi présentes dans une liste masquée — un lecteur d'écran ne
 * peut pas lire un `<path>` SVG.
 */

export interface PointChiffreAffaires {
  label: string
  montant: number
}

interface RevenueChartProps {
  points: readonly PointChiffreAffaires[]
  /** Variation affichée en haut à droite ; `null` = pas de comparaison. */
  variation?: number | null
  /** Marque visuelle du mode démonstration. */
  demo?: boolean
}

/** Axe vertical compact : 610 000 → « 610 k ». */
function montantCompact(valeur: number): string {
  if (valeur >= 1_000_000) return `${(valeur / 1_000_000).toFixed(1).replace('.0', '')} M`
  if (valeur >= 1_000) return `${Math.round(valeur / 1_000)} k`
  return String(valeur)
}

export default function RevenueChart({ points, variation, demo = false }: RevenueChartProps) {
  const total = points.reduce((somme, point) => somme + point.montant, 0)
  const sommet = Math.max(0, ...points.map((point) => point.montant))
  const enHausse = (variation ?? 0) >= 0

  return (
    <section
      aria-labelledby="titre-courbe-ca"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="titre-courbe-ca" className="text-base font-bold text-brand-navy">
            Évolution du chiffre d’affaires
          </h2>
          <p className="text-sm text-muted-foreground">
            Sept derniers jours · {formatFcfa(total)} encaissés
            {demo && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                démo
              </span>
            )}
          </p>
        </div>

        {variation !== null && variation !== undefined && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
              enHausse ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
            }`}
          >
            {enHausse ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />}
            {enHausse ? '+' : ''}
            {variation} %
          </span>
        )}
      </div>

      <figure className="mt-3">
        <div
          className="h-56 w-full"
          role="img"
          aria-label={`Chiffre d’affaires des sept derniers jours, du ${points[0]?.label ?? '—'} au ${
            points[points.length - 1]?.label ?? '—'
          }. Total ${formatFcfa(total)}, meilleure journée ${formatFcfa(sommet)}.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="remplissage-ca" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0f766e" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: '#64748b' }}
                dy={6}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickFormatter={montantCompact}
              />
              <Tooltip
                cursor={{ stroke: '#0f766e', strokeDasharray: '4 4' }}
                formatter={(valeur) => [formatFcfa(Number(valeur)), 'Encaissé']}
                labelFormatter={(label) => `Journée du ${String(label)}`}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  fontSize: 13,
                  padding: '6px 10px',
                }}
              />
              <Area
                type="monotone"
                dataKey="montant"
                name="Encaissé"
                stroke="#0f766e"
                strokeWidth={2.5}
                fill="url(#remplissage-ca)"
                dot={{ r: 3, fill: '#ffffff', stroke: '#0f766e', strokeWidth: 2 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Équivalent textuel : un lecteur d'écran ne lit pas le SVG. */}
        <figcaption className="sr-only">
          <ul>
            {points.map((point) => (
              <li key={point.label}>
                {point.label} : {formatFcfa(point.montant)}
              </li>
            ))}
          </ul>
        </figcaption>
      </figure>
    </section>
  )
}
