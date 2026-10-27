import type { ReactNode } from 'react'
import type { ColonneAtelier } from '@/lib/atelierKanban'

/**
 * Colonne du Kanban d'atelier.
 *
 * L'en-tête porte la couleur du groupe (bleu / ambre / vert) et son compteur ;
 * le fond reste très légèrement teinté pour distinguer les trois zones sans
 * transformer l'écran en arc-en-ciel. Sur téléphone, les colonnes s'empilent et
 * restent lisibles — pas de défilement horizontal imposé.
 */
export default function KanbanColumn({
  colonne,
  nombre,
  children,
  vide,
}: {
  colonne: ColonneAtelier
  nombre: number
  children: ReactNode
  /** Message affiché quand la colonne est vide. */
  vide: string
}) {
  const titreId = `colonne-${colonne.id}`

  return (
    <section
      aria-labelledby={titreId}
      className={`flex min-w-0 flex-col gap-2 rounded-2xl border border-border p-2.5 ${colonne.fondClass}`}
    >
      <header className={`rounded-xl border px-3 py-2 ${colonne.enteteClass}`}>
        <h2 id={titreId} className="flex items-center justify-between gap-2 text-sm font-bold">
          {colonne.titre}
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold">{nombre}</span>
        </h2>
        <p className="mt-0.5 text-[11px] opacity-80">{colonne.description}</p>
      </header>

      {nombre === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/60 px-3 py-6 text-center text-xs text-slate-500">
          {vide}
        </p>
      ) : (
        <ul className="space-y-2">{children}</ul>
      )}
    </section>
  )
}
