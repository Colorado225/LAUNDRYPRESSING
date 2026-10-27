import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, Trash2 } from 'lucide-react'
import { GARMENT_GRID, getGarmentImage } from '@/constants/garmentImages'
import type { OrderGarmentCondition, OrderGarmentType } from '@/types/database'

type EtatPiece = OrderGarmentCondition

type Selection = Partial<Record<OrderGarmentType, { quantity: number; condition: EtatPiece }>>

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

/** Libellé court de l'état pour l'accessibilité. */
function libelleEtat(condition: EtatPiece): string {
  return condition === 'TACHE' ? 'Tache' : 'Bon état'
}

export default function BlanchisserieGrid() {
  const navigate = useNavigate()
  const location = useLocation()
  const [selection, setSelection] = useState<Selection>({})
  const [recherche, setRecherche] = useState('')

  // Restaure une sélection transmise depuis l'écran de création (re-ouverture).
  const state = location.state as {
    garmentDetails?: Array<{
      type: OrderGarmentType
      quantity: number
      condition?: EtatPiece
    }>
  } | undefined

  const filtrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    if (!terme) return LIGNES
    return LIGNES.filter((ligne) =>
      ligne.libelle.toLowerCase().includes(terme)
    )
  }, [recherche])

  const total = Object.values(selection).reduce(
    (somme, ligne) => somme + (ligne?.quantity ?? 0),
    0
  )

  const ajouter = (type: OrderGarmentType) =>
    setSelection((actuelle) => {
      const existe = actuelle[type]
      return {
        ...actuelle,
        [type]: existe
          ? { ...existe, quantity: existe.quantity + 1 }
          : { quantity: 1, condition: 'BON' },
      }
    })

  const retirer = (type: OrderGarmentType) =>
    setSelection((actuelle) => {
      const existe = actuelle[type]
      if (!existe) return actuelle
      if (existe.quantity > 1)
        return {
          ...actuelle,
          [type]: { ...existe, quantity: existe.quantity - 1 },
        }
      const suivant = { ...actuelle }
      delete suivant[type]
      return suivant
    })

  const basculerEtat = (type: OrderGarmentType) =>
    setSelection((actuelle) => {
      const existe = actuelle[type]
      if (!existe) return actuelle
      return {
        ...actuelle,
        [type]: {
          ...existe,
          condition: existe.condition === 'BON' ? 'TACHE' : 'BON',
        },
      }
    })

  /** Transmet le décompte structuré à l'écran de création de commande. */
  const preparerCommande = () => {
    const garmentDetails = LIGNES.filter(
      (ligne) => (selection[ligne.type]?.quantity ?? 0) > 0
    ).map((ligne) => ({
      type: ligne.type,
      quantity: selection[ligne.type]!.quantity,
      condition: selection[ligne.type]!.condition,
    }))

    navigate('/commandes/nouvelle', { state: { garmentDetails } })
  }

  // Restaure la sélection transmise en état de navigation, une seule fois.
  useMemo(() => {
    if (!state?.garmentDetails?.length) return
    const suivante: Selection = {}
    for (const detail of state.garmentDetails) {
      suivante[detail.type] = {
        quantity: detail.quantity,
        condition: detail.condition ?? 'BON',
      }
    }
    setSelection(suivante)
  }, [state])
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
              <h1 className="text-base font-semibold text-slate-800">Vêtements</h1>
              <p className="text-xs text-slate-500">
                Sélectionnez les pièces et leur état
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={preparerCommande}
            disabled={total === 0}
            className={`min-h-12 rounded-xl px-5 font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${total === 0 ? 'bg-slate-300 text-slate-500' : 'bg-brand-teal hover:bg-brand-teal-dark'}`}
          >
            {total} pièce(s) — Continuer
          </button>
        </div>
      </header>

<main className="mx-auto max-w-5xl px-4 py-5">
        <div className="flex items-center gap-3 mb-4">
          <input
            type="search"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Rechercher un vêtement…"
            aria-label="Rechercher un vêtement"
            className="min-h-12 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-base"
          />
          {total > 0 && (
            <button
              type="button"
              onClick={() => {
          if (window.confirm('Êtes-vous sûr de vouloir tout vider ?')) {
            setSelection({})
          }
        }}
              className="inline-flex min-h-12 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-rose-600 active:bg-rose-50"
            >
              <Trash2 size={16} aria-hidden />
              Tout vider
            </button>
          )}
        </div>

        {filtrees.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Aucun vêtement ne correspond à « {recherche} ».
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {filtrees.map((ligne) => {
              const existe = selection[ligne.type]
              const quantite = existe?.quantity ?? 0
              const condition = existe?.condition ?? 'BON'
              const selectionnee = quantite > 0

              return (
                <button
                  key={ligne.type}
                  type="button"
                  onClick={() => ajouter(ligne.type)}
                  onContextMenu={(evenement) => {
                    evenement.preventDefault()
                    retirer(ligne.type)
                  }}
                  aria-label={`${ligne.libelle}, ${quantite} pièce${quantite > 1 ? 's' : ''}, état ${libelleEtat(condition)}`}
                  aria-pressed={selectionnee}
                  className={`relative flex min-h-24 flex-col items-center justify-center rounded-2xl border-2 bg-white p-2 transition-colors active:scale-95 ${selectionnee ? condition === 'TACHE' ? 'border-rose-500 bg-rose-50' : 'border-brand-teal bg-teal-50' : 'border-slate-200 active:border-brand-teal'}`}
                >
                  {ligne.favori && (
                    <span aria-hidden className="absolute left-1.5 top-1.5 text-xs text-amber-500">
                      ★
                    </span>
                  )}

                  {quantite > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-brand-teal text-xs font-bold text-white">
                      {quantite}
                    </span>
                  )}

                  {selectionnee && (
                    <span
                      className={`absolute right-1 top-1 flex size-5 items-center justify-center rounded-full text-xs font-bold ${condition === 'TACHE' ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-white'}`}
                      title={`État : ${libelleEtat(condition)}`}
                      aria-label={`État : ${libelleEtat(condition)}`}
                    >
                      {condition === 'TACHE' ? '🟡' : '🟢'}
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
                    className={`mb-1 size-14 object-contain ${condition === 'TACHE' ? 'opacity-60 grayscale-40' : ''}`}
                  />

                  {selectionnee && (
                    <button
                      type="button"
                      onClick={(evenement) => {
                        evenement.stopPropagation()
                        basculerEtat(ligne.type)
                      }}
                      aria-label={`Passer en ${libelleEtat(condition === 'BON' ? 'TACHE' : 'BON')}`}
                      className="absolute bottom-1 left-1/2 -translate-x-1/2 flex size-6 items-center justify-center rounded-full bg-white shadow-sm text-sm transition-colors hover:bg-slate-100"
                    >
                      {condition === 'TACHE' ? '🟢' : '🟡'}
                    </button>
                  )}

                  <span className="text-center text-xs font-medium leading-tight text-slate-700">
                    {ligne.libelle}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {total > 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                Total : {total} pièce{total > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                onClick={preparerCommande}
                className="min-h-10 rounded-xl px-3 text-sm font-semibold text-brand-teal hover:bg-teal-50"
              >
                Confirmer la sélection
              </button>
            </div>
            {Object.values(selection).some((l) => l?.condition === 'TACHE') && (
              <p className="mt-2 text-xs text-rose-600">
                Certaines pièces sont marquées « Tache ».
              </p>
            )}
          </div>
        )}
      </main>
    )
}
