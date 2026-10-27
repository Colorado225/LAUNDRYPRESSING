import { Shirt } from 'lucide-react'
import { GARMENT_IMAGE } from '@/constants/garmentImages'

/**
 * Bandeau secondaire sous la grille d'articles (maquette, écran 2).
 *
 * Volontairement discret : il ne doit ni déplacer la grille ni distraire d'une
 * saisie. L'illustration vient de `public/images` — les mêmes fichiers que les
 * tuiles d'articles — donc aucune dépendance réseau et aucun risque de chemin
 * cassé à la construction.
 */
export default function PromoBanner() {
  return (
    <aside className="flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-accent/60 p-3">
      <img
        src={GARMENT_IMAGE.CHEMISE}
        alt=""
        aria-hidden
        width={56}
        height={56}
        loading="lazy"
        decoding="async"
        className="size-14 shrink-0 object-contain"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-navy">
          Un vêtement bien entretenu, c’est une meilleure image !
        </p>
        <p className="text-xs text-slate-600">
          Précisez les taches et les tissus délicats au dépôt : le traitement part avec la commande.
        </p>
      </div>
      <span className="hidden shrink-0 items-center gap-1.5 rounded-xl bg-brand-navy px-2.5 py-1.5 text-xs font-bold text-white sm:inline-flex">
        <Shirt size={14} aria-hidden />
        Pressing Pro
      </span>
    </aside>
  )
}
