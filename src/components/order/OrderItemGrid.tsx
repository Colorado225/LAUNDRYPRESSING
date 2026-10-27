import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { OrderGarmentType } from '@/types/database'
import { filtrerArticles, type ArticleGrille } from '@/lib/orderServices'

/**
 * Grille tactile d'articles (écran 2).
 *
 * Reprend le geste de la maquette validée : une tuile par article, l'icône
 * existante de `public/images`, un compteur visible. Un appui ajoute une pièce
 * (une seule action par tuile : les quantités se corrigent dans le panier, ce
 * qui évite deux boutons de 20 px collés l'un à l'autre sur une tablette).
 *
 * Aucune image distante, aucun appel réseau : la grille fonctionne en mode
 * avion, comme le reste du parcours de commande.
 */

interface OrderItemGridProps {
  articles: readonly ArticleGrille[]
  /** Quantité déjà retenue par type d'article. */
  quantites: Partial<Record<OrderGarmentType, number>>
  onAjouter: (type: OrderGarmentType) => void
  /**
   * Texte d'aide affiché sous le titre. En blanchisserie, la tuile n'ajoute pas
   * une ligne facturée mais une pièce à la composition du lot pesé.
   */
  legende?: string
}

export default function OrderItemGrid({
  articles,
  quantites,
  onAjouter,
  legende,
}: OrderItemGridProps) {
  const [recherche, setRecherche] = useState('')

  const filtres = useMemo(() => filtrerArticles(articles, recherche), [articles, recherche])
  const categories = useMemo(() => {
    const ordre = new Map<string, ArticleGrille[]>()
    for (const article of filtres) {
      const liste = ordre.get(article.categorie) ?? []
      liste.push(article)
      ordre.set(article.categorie, liste)
    }
    return [...ordre.entries()]
  }, [filtres])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Articles et prestations</h2>
        <p className="text-sm text-slate-500">
          {legende ?? 'Touchez un article pour l’ajouter. Les quantités se corrigent dans le panier.'}
        </p>
      </div>

      <div className="relative">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="search"
          value={recherche}
          onChange={(evenement) => setRecherche(evenement.target.value)}
          placeholder="Rechercher un article…"
          aria-label="Rechercher un article"
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-base outline-none focus:border-brand-teal"
        />
      </div>

      {categories.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Aucun article ne correspond à « {recherche} ».
        </p>
      ) : (
        categories.map(([categorie, liste]) => (
          <section key={categorie} aria-label={categorie} className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{categorie}</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {liste.map((article) => {
                const quantite = quantites[article.type] ?? 0
                return (
                  <button
                    key={article.type}
                    type="button"
                    onClick={() => onAjouter(article.type)}
                    aria-label={`Ajouter ${article.libelle}`}
                    className={`relative flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 bg-white p-2 transition-colors active:scale-95 ${
                      quantite > 0
                        ? 'border-brand-teal bg-teal-50'
                        : 'border-slate-200 hover:border-brand-teal'
                    }`}
                  >
                    {article.favori && quantite === 0 && (
                      <span aria-hidden className="absolute left-1.5 top-1 text-xs text-amber-500">
                        ★
                      </span>
                    )}
                    {quantite > 0 && (
                      <span
                        aria-live="polite"
                        className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-brand-teal text-xs font-bold text-white"
                      >
                        {quantite}
                      </span>
                    )}
                    <img
                      src={article.image}
                      alt=""
                      aria-hidden
                      width={48}
                      height={48}
                      loading="lazy"
                      decoding="async"
                      className="size-12 object-contain"
                    />
                    <span className="text-center text-xs font-medium leading-tight text-slate-700">
                      {article.libelle}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
