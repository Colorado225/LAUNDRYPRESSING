import { FlaskConical } from 'lucide-react'
import { useDemoStore } from '@/lib/demoMode'

/**
 * Interrupteur du mode démonstration.
 *
 * Il vit sur le tableau de bord, à côté du titre : c'est là qu'on présente
 * l'application. Une fois actif, le bandeau global rappelle en permanence que
 * les chiffres sont fictifs, et les actions d'écriture sont désactivées.
 *
 * Le contrôle est un vrai `role="switch"` : état annoncé aux lecteurs d'écran,
 * activable au clavier (Espace / Entrée) comme au doigt.
 */
export default function DemoSwitch() {
  const actif = useDemoStore((state) => state.actif)
  const setActif = useDemoStore((state) => state.setActif)

  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label="Mode démonstration — afficher des chiffres fictifs"
      onClick={() => setActif(!actif)}
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${
        actif
          ? 'border-amber-400 bg-amber-100 text-amber-900'
          : 'border-input bg-card text-slate-600 hover:bg-slate-50'
      }`}
    >
      <FlaskConical size={16} aria-hidden />
      <span className="hidden sm:inline">Mode démo</span>
      <span
        aria-hidden
        className={`relative h-5 w-9 rounded-full transition-colors ${actif ? 'bg-amber-500' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${
            actif ? 'left-4.5' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}
