import { EyeOff, FlaskConical } from 'lucide-react'
import { useDemoStore } from '@/lib/demoMode'

/**
 * Bandeau du mode démonstration.
 *
 * Il ne peut pas être fermé : tant que des chiffres fictifs sont à l'écran, une
 * mention doit rester visible. C'est la contrepartie du droit d'afficher la
 * maquette (`docs/AUDIT-REFONTE-INTERFACE.md`, décision « réel + mode démo ») :
 * un comptoir qui prêterait l'application à un client ne doit jamais laisser
 * croire que 482 500 FCFA sont entrés en caisse.
 */
export default function DemoBanner() {
  const actif = useDemoStore((state) => state.actif)
  const setActif = useDemoStore((state) => state.setActif)

  if (!actif) return null

  return (
    <div role="status" className="border-b border-amber-300 bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-3 py-2 text-sm sm:px-6">
        <FlaskConical size={16} className="shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <strong className="font-bold">Mode démonstration.</strong> Les chiffres affichés sont
          fictifs (maquette) : ils ne proviennent pas de votre pressing. Les enregistrements et
          changements de statut sont désactivés.
        </p>
        <button
          type="button"
          onClick={() => setActif(false)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-2.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
        >
          <EyeOff size={14} aria-hidden />
          Revenir aux données réelles
        </button>
      </div>
    </div>
  )
}
