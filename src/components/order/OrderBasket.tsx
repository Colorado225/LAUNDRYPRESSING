import { Trash2 } from 'lucide-react'
import { formatFcfa } from '@/lib/formatters'

/**
 * Panier du comptoir (écran 2, colonne de droite sur grand écran).
 *
 * Chaque ligne reste modifiable : quantité et prix unitaire sont les deux
 * seules valeurs que le réceptionniste ajuste devant le client. Le total de la
 * ligne est recalculé par le parent, jamais affiché tel quel depuis un état
 * intermédiaire — un total affiché qui ne correspond pas à la quantité
 * enregistrée est exactement le défaut qu'on veut éviter.
 */

export interface LignePanier {
  id: string
  libelle: string
  /** Précision affichée sous le libellé (composition du lot, prestation…). */
  detail?: string | null
  quantite: number
  unite: 'PIECE' | 'KG'
  prixUnitaire: number
  total: number
}

interface OrderBasketProps {
  lignes: readonly LignePanier[]
  total: number
  onQuantite: (id: string, valeur: number) => void
  onPrix: (id: string, valeur: number) => void
  onSupprimer: (id: string) => void
  onVider?: () => void
}

export default function OrderBasket({
  lignes,
  total,
  onQuantite,
  onPrix,
  onSupprimer,
  onVider,
}: OrderBasketProps) {
  const pieces = lignes.reduce(
    (somme, ligne) => somme + (ligne.unite === 'PIECE' ? ligne.quantite : 0),
    0,
  )

  return (
    <aside
      aria-labelledby="titre-panier"
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="titre-panier" className="text-base font-bold text-slate-800">
            Panier
          </h2>
          <p className="text-xs text-slate-500">
            {lignes.length === 0
              ? 'Aucun article pour le moment.'
              : `${pieces} pièce${pieces > 1 ? 's' : ''} · ${lignes.length} ligne${lignes.length > 1 ? 's' : ''}`}
          </p>
        </div>
        {lignes.length > 0 && onVider && (
          <button
            type="button"
            onClick={onVider}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
          >
            <Trash2 size={15} aria-hidden />
            Vider
          </button>
        )}
      </div>

      {lignes.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
          Touchez un article dans la grille pour commencer la commande.
        </p>
      ) : (
        <ul className="space-y-3">
          {lignes.map((ligne) => (
            <li key={ligne.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{ligne.libelle}</p>
                  {ligne.detail && <p className="text-xs text-slate-500">{ligne.detail}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => onSupprimer(ligne.id)}
                  aria-label={`Supprimer ${ligne.libelle}`}
                  className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold text-slate-600">
                    {ligne.unite === 'KG' ? 'Poids (kg)' : 'Quantité'}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={ligne.unite === 'KG' ? 0.001 : 1}
                    step={ligne.unite === 'KG' ? 0.001 : 1}
                    value={ligne.quantite || ''}
                    onChange={(evenement) => onQuantite(ligne.id, Number(evenement.target.value))}
                    aria-label={`Quantité ${ligne.libelle}`}
                    className="min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold text-slate-600">
                    {ligne.unite === 'KG' ? 'Tarif/kg (FCFA)' : 'Prix unitaire (FCFA)'}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={ligne.prixUnitaire || ''}
                    onChange={(evenement) => onPrix(ligne.id, Number(evenement.target.value))}
                    aria-label={
                      ligne.unite === 'KG'
                        ? `Tarif au kilo ${ligne.libelle} (FCFA)`
                        : `Prix unitaire ${ligne.libelle} (FCFA)`
                    }
                    className="min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal"
                  />
                </label>
              </div>

              <p className="mt-2 text-right text-sm font-semibold text-slate-700">
                {formatFcfa(ligne.total)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
        <span className="text-sm font-semibold text-slate-600">Total</span>
        <span className="text-xl font-bold text-brand-navy">{formatFcfa(total)}</span>
      </div>
    </aside>
  )
}
