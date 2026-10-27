import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { CarteAnimee } from '@/components/CarteAnimee'
import { cn } from '@/lib/utils'

/**
 * Carte d'indicateur du tableau de bord.
 *
 * Elle n'invente rien : la valeur, le détail et la variation sont fournis par
 * l'appelant, qui les calcule sur les données réelles (ou sur le jeu de
 * démonstration, signalé par le bandeau). La variation est **facultative** :
 * quand la veille est à zéro, on ne peut pas calculer de pourcentage, et la
 * carte n'affiche alors aucune flèche plutôt qu'un « +100 % » trompeur.
 */

export interface MetricCardProps {
  libelle: string
  valeur: string
  detail?: string
  /** Variation en pourcentage ; `null`/absent = pas de comparaison possible. */
  variation?: number | null
  icone: ReactNode
  ton?: 'neutre' | 'positif' | 'alerte'
  /** Sept dernières valeurs, pour la mini-courbe de tendance. */
  serie?: readonly number[]
  /** Cascade d'apparition, en millisecondes. */
  delai?: number
  /** Marque visuelle du mode démonstration (chiffres fictifs). */
  demo?: boolean
}

const TAILLE_COURBE = { largeur: 88, hauteur: 28 }

/** Trace une polyligne normalisée sur la hauteur disponible. */
function pointsCourbe(serie: readonly number[]): string {
  if (serie.length < 2) return ''
  const max = Math.max(...serie)
  const min = Math.min(...serie)
  const amplitude = max - min || 1

  return serie
    .map((valeur, index) => {
      const x = (index / (serie.length - 1)) * TAILLE_COURBE.largeur
      const y = TAILLE_COURBE.hauteur - ((valeur - min) / amplitude) * TAILLE_COURBE.hauteur
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export default function MetricCard({
  libelle,
  valeur,
  detail,
  variation,
  icone,
  ton = 'neutre',
  serie,
  delai = 0,
  demo = false,
}: MetricCardProps) {
  const couleurValeur =
    ton === 'positif' ? 'text-brand-teal' : ton === 'alerte' ? 'text-rose-700' : 'text-brand-navy'

  const tendance =
    variation === null || variation === undefined || !Number.isFinite(variation)
      ? null
      : variation > 0
        ? 'hausse'
        : variation < 0
          ? 'baisse'
          : 'stable'

  const IconeTendance = tendance === 'hausse' ? ArrowUpRight : tendance === 'baisse' ? ArrowDownRight : Minus

  return (
    <CarteAnimee className="metric-card rounded-2xl border border-border bg-card p-4 shadow-sm" delai={delai}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span aria-hidden className="text-slate-400">
            {icone}
          </span>
          {libelle}
        </p>

        {tendance && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold',
              tendance === 'hausse'
                ? 'bg-emerald-100 text-emerald-800'
                : tendance === 'baisse'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-slate-100 text-slate-600',
            )}
            title={`${variation! > 0 ? '+' : ''}${variation} % par rapport à la veille`}
          >
            <IconeTendance size={12} aria-hidden />
            {variation! > 0 ? '+' : ''}
            {variation} %
          </span>
        )}
        {demo && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
            démo
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p className={cn('text-2xl font-bold leading-tight', couleurValeur)}>{valeur}</p>

        {serie && serie.length > 1 && (
          <svg
            aria-hidden
            width={TAILLE_COURBE.largeur}
            height={TAILLE_COURBE.hauteur}
            viewBox={`0 0 ${TAILLE_COURBE.largeur} ${TAILLE_COURBE.hauteur}`}
            className="shrink-0"
          >
            <polyline
              points={pointsCourbe(serie)}
              fill="none"
              stroke={ton === 'alerte' ? '#e11d48' : '#0f766e'}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {detail && <p className="mt-0.5 text-xs text-slate-500">{detail}</p>}
    </CarteAnimee>
  )
}
