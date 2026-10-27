import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Search, Trash2 } from 'lucide-react'
import { GARMENT_GRID, getGarmentImage } from '@/constants/garmentImages'
import type { OrderGarmentType } from '@/types/database'

/**
 * Grille tactile de sélection des vêtements pour une commande au comptoir.
 *
 * Conçue pour une tablette Android : grandes cibles (`min-h-12`), pas de
 * dépendance au survol, et **aucun appel réseau**. L'écran précédent lisait
 * les tables `type_vetement` et `forfait_pieces`, supprimées par la migration
 * destructrice écartée : il affichait donc une erreur au lieu de la grille.
 * Les types et les icônes viennent désormais de constantes embarquées, ce qui
 * rend l'écran utilisable hors ligne comme les autres écrans de commande.
 *
 * Le comptage se fait par appui (+) et par appui long / clic droit (−) : c'est
 * le geste le plus rapide en atelier, sans clavier.
 */

type Selection = Partial<Record<OrderGarmentType, number>>

/** Référence d'un vêtement tel qu'affiché dans la grille. */
interface LigneGrille {
  type: OrderGarmentType
  libelle: string
  favori: boolean
  image: string
}

const LIGNES: LigneGrille[] = GARMENT_GRID.map(({ type, label, favori }) => ({
  type,
  libelle: label,
  favori: Boolean(favori),
  image: getGarmentImage(type),
}))

export default function BlanchisserieGrid() {
  const navigate = useNavigate()
  const [selection, setSelection] = useState<Selection>({})
  const [recherche, setRecherche] = useState('')

  const filtrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    if (!terme) return LIGNES
    return LIGNES.filter((ligne) => ligne.libelle.toLowerCase().includes(terme))
  }, [recherche])

  const total = Object.values(selection).reduce((somme, quantite) => somme + (quantite ?? 0), 0)

  const ajouter = (type: OrderGarmentType) =>
    setSelection((actuelle) => ({ ...actuelle, [type]: (actuelle[type] ?? 0) + 1 }))

  const retirer = (type: OrderGarmentType) =>
    setSelection((actuelle) => {
      const suivant = { ...actuelle }
      const quantite = suivant[type] ?? 0
      if (quantite > 1) suivant[type] = quantite - 1
      else delete suivant[type]
      return suivant
    })

  /**
   * La commande est préparée sur l'écran de création, qui porte déjà la
   * validation (client, tarif, ligne libre). On y transmet le décompte par
   * type plutôt que de dupliquer ici la logique d'enregistrement.
   */
  const preparerCommande = () => {
    const detail = LIGNES.filter((ligne) => (selection[ligne.type] ?? 0) > 0)
      .map((ligne) => `${selection[ligne.type]} × ${ligne.libelle}`)
      .join(', ')
    navigate('/commandes/nouvelle', { state: { composition: detail } })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Revenir en arrière"
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-slate-300 text-slate-600 active:bg-slate-100"
            >
              <ArrowLeft size={20} aria-hidden />
            </button>
            <div>
              <h1 className="text-base font-bold text-brand-navy">Vêtements à traiter</h1>
              <p className="text-xs text-slate-500">{total} pièce(s) sélectionnée(s)</p>
            </div>
          </div>

          <button
            type="button"
            onClick={preparerCommande}
            disabled={total === 0}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={18} aria-hidden />
            Continuer ({total})
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        <div className="relative mb-4">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Rechercher un vêtement…"
            aria-label="Rechercher un vêtement"
            className="min-h-12 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-base"
          />
        </div>

        {filtrees.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Aucun vêtement ne correspond à « {recherche} ».
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {filtrees.map((ligne) => {
              const quantite = selection[ligne.type] ?? 0
              return (
                <button
                  key={ligne.type}
                  type="button"
                  onClick={() => ajouter(ligne.type)}
                  onContextMenu={(evenement) => {
                    evenement.preventDefault()
                    retirer(ligne.type)
                  }}
                  aria-label={`${ligne.libelle}${quantite > 0 ? `, ${quantite} sélectionné(s)` : ''}`}
                  aria-pressed={quantite > 0}
                  className={`relative flex min-h-24 flex-col items-center justify-center rounded-2xl border-2 bg-white p-2 transition-colors active:scale-95 ${quantite > 0
                    ? 'border-brand-teal bg-teal-50'
                    : 'border-slate-200 active:border-brand-teal'
                    }`}
                >
                  {ligne.favori && (
                    <span
                      aria-hidden
                      className="absolute left-1.5 top-1.5 text-xs text-amber-500"
                    >
                      ★
                    </span>
                  )}
                  {quantite > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-brand-teal text-xs font-bold text-white">
                      {quantite}
                    </span>
                  )}
                  <img
                    src={ligne.image}
                    alt=""
                    aria-hidden
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
                    className="mb-1 size-14 object-contain"
                  />
                  <span className="text-center text-xs font-medium leading-tight text-slate-700">
                    {ligne.libelle}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {total > 0 && (
          <div className="sticky bottom-3 mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <span className="text-sm font-semibold text-slate-700">{total} pièce(s)</span>
            <button
              type="button"
              onClick={() => setSelection({})}
              className="inline-flex min-h-12 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-rose-600 active:bg-rose-50"
            >
              <Trash2 size={16} aria-hidden />
              Tout vider
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
