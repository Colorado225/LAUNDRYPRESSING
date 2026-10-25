/**
 * Bulle d'aide (tooltip) légère — sans dépendance externe.
 *
 * Usage :
 *   <Tooltip contenu="Description de la catégorie">
 *     <span>Nom de la catégorie</span>
 *   </Tooltip>
 *
 * Le contenu de la bulle s'affiche au survol (souris) et reste accessible
 * via l'attribut `aria-describedby` pour les lecteurs d'écran.
 */
import { useId } from 'react'

export function Tooltip({
  contenu,
  children,
  position = 'dessus',
}: {
  contenu: string
  children: React.ReactNode
  position?: 'dessus' | 'dessous' | 'gauche' | 'droite'
}) {
  const id = useId()
  const decalage = {
    dessus: '-bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 mb-1',
    dessous: 'top-[calc(100%+8px)] left-1/2 -translate-x-1/2 mt-1',
    gauche: '-right-[calc(100%+8px)] top-1/2 -translate-y-1/2 mr-1',
    droite: 'left-[calc(100%+8px)] top-1/2 -translate-y-1/2 ml-1',
  }[position]

  return (
    <span className="relative inline-block" aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={`absolute z-50 ${decalage} rounded-xl border border-slate-200 bg-slate-900 px-2 py-1.5 text-xs text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap`}
      >
        {contenu}
      </span>
    </span>
  )
}

export default Tooltip
