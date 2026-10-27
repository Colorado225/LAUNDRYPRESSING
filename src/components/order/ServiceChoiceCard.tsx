import { Check, Droplets, Sparkles } from 'lucide-react'
import type { ParcoursService } from '@/lib/orderServices'
import { PRESENTATION_PARCOURS } from '@/lib/orderServices'

/**
 * Carte de choix du type de service (écran 1).
 *
 * Un vrai `<button>` : activable au clavier (Entrée / Espace), annoncé comme
 * sélectionnable via `aria-pressed`, cible tactile de 12 rem minimum. Aucun
 * prix n'est affiché ici : seul le nombre de prestations réellement
 * configurées l'est, pour que le comptoir sache à quoi s'attendre.
 */

interface ServiceChoiceCardProps {
  parcours: ParcoursService
  actif: boolean
  nombrePrestations: number
  onChoisir: (parcours: ParcoursService) => void
}

const STYLES = {
  pressing: {
    icone: Sparkles,
    bordure: 'border-brand-navy',
    fond: 'bg-brand-navy/5',
    puce: 'bg-brand-navy',
    texte: 'text-brand-navy',
  },
  blanchisserie: {
    icone: Droplets,
    bordure: 'border-brand-teal',
    fond: 'bg-brand-teal/5',
    puce: 'bg-brand-teal',
    texte: 'text-brand-teal-dark',
  },
} as const

export default function ServiceChoiceCard({
  parcours,
  actif,
  nombrePrestations,
  onChoisir,
}: ServiceChoiceCardProps) {
  const presentation = PRESENTATION_PARCOURS[parcours]
  const style = STYLES[parcours]
  const Icone = style.icone

  return (
    <button
      type="button"
      onClick={() => onChoisir(parcours)}
      aria-pressed={actif}
      aria-label={`Choisir ${presentation.titre}`}
      className={`group flex h-full flex-col gap-3 rounded-2xl border-2 p-4 text-left transition-colors sm:p-5 ${
        actif
          ? `${style.bordure} ${style.fond}`
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex size-11 items-center justify-center rounded-xl ${
            actif ? `${style.puce} text-white` : 'bg-slate-100 text-slate-600'
          }`}
        >
          <Icone size={22} aria-hidden />
        </span>
        {actif && (
          <span className={`inline-flex items-center gap-1 text-xs font-bold ${style.texte}`}>
            <Check size={16} aria-hidden /> Choisi
          </span>
        )}
      </div>

      <div>
        <h3 className={`text-lg font-bold ${actif ? style.texte : 'text-slate-800'}`}>
          {presentation.titre}
        </h3>
        <p className="mt-1 text-sm text-slate-600">{presentation.resume}</p>
      </div>

      <ul className="mt-auto space-y-1 text-sm text-slate-600">
        {presentation.exemples.map((exemple) => (
          <li key={exemple} className="flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${style.puce}`} aria-hidden />
            {exemple}
          </li>
        ))}
      </ul>

      <p className="text-xs font-semibold text-slate-500">
        {nombrePrestations > 0
          ? `${nombrePrestations} prestation${nombrePrestations > 1 ? 's' : ''} configurée${nombrePrestations > 1 ? 's' : ''}`
          : 'Aucune prestation configurée — le prix se saisit au comptoir'}
      </p>
    </button>
  )
}
