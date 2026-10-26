import { useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { LocalOrderItem } from '@/db/localDb'
import { useUpdateOrderItemMeasurement } from '@/db/hooks'
import { calculerTarif, libelleUnite } from '@/lib/catalogPricing'
import { formatFcfa } from '@/lib/formatters'

interface Props {
  orderId: string
  item: LocalOrderItem
  editable: boolean
}

/** Confirmation/correction d'une mesure, en local d'abord et sans réseau requis. */
export default function OrderMeasurementEditor({ orderId, item, editable }: Props) {
  const updateMeasurement = useUpdateOrderItemMeasurement()
  const [ouvert, setOuvert] = useState(false)
  const [quantite, setQuantite] = useState(String(item.quantity))
  const [confirmee, setConfirmee] = useState(item.priceStatus === 'CONFIRMED')
  const [enregistrement, setEnregistrement] = useState(false)
  const estDetailForfait = Boolean(item.packageLineId)
  const estPorteuseForfait = Boolean(item.commercialPackageId)

  if (!editable || item.billingUnit === 'FLAT') return null
  if (estPorteuseForfait) {
    return (
      <p className="mt-2 text-xs font-medium text-slate-500">
        Corrigez le comptage depuis un article inclus : cette ligne de forfait se recalcule
        automatiquement.
      </p>
    )
  }

  const ouvrir = () => {
    setQuantite(String(item.quantity))
    setConfirmee(estDetailForfait ? true : item.priceStatus === 'CONFIRMED')
    setOuvert(true)
  }

  const nombre = quantite === '' ? Number.NaN : Number(quantite)
  let totalPrevu: number | null = null
  let quantiteFacturee: number | null = null
  try {
    if (estDetailForfait) {
      if (Number.isInteger(nombre) && nombre > 0) {
        totalPrevu = 0
        quantiteFacturee = nombre
      }
    } else {
      const calcul = calculerTarif({
        quantite: nombre,
        prixUnitaire: item.unitPrice,
        unite: item.billingUnit,
        quantiteMinimum: item.minimumQuantitySnapshot,
        increment: item.billingIncrementSnapshot,
        minimumFacturable: item.minimumChargeSnapshot,
      })
      totalPrevu = calcul.total
      quantiteFacturee = calcul.quantiteFacturee
    }
  } catch {
    // Le formulaire affiche l'erreur de quantité sans persister de ligne partielle.
  }

  const enregistrer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (totalPrevu === null) {
      toast.error('Vérifiez la quantité et l’unité de cette ligne.')
      return
    }

    setEnregistrement(true)
    try {
      await updateMeasurement(orderId, item.id, {
        quantity: nombre,
        priceStatus: confirmee ? 'CONFIRMED' : 'ESTIMATED',
      })
      toast.success(
        estDetailForfait
          ? 'Comptage corrigé et forfait recalculé.'
          : confirmee
            ? 'Mesure confirmée et commande recalculée.'
            : 'Mesure estimée mise à jour.',
        {
        icon: '✅',
      })
      setOuvert(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'La mesure n’a pas été enregistrée.')
    } finally {
      setEnregistrement(false)
    }
  }

  return (
    <div className="mt-2">
      {!ouvert ? (
        <button
          type="button"
          onClick={ouvrir}
          className="inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-brand-teal/30 px-3 text-xs font-semibold text-brand-navy hover:bg-brand-teal/5"
        >
          {item.priceStatus === 'ESTIMATED' ? (
            <>
              <Check size={14} aria-hidden />
              Confirmer la mesure
            </>
          ) : (
            <>
              <Pencil size={14} aria-hidden />
              {estDetailForfait ? 'Corriger le comptage' : 'Corriger la mesure'}
            </>
          )}
        </button>
      ) : (
        <form
          onSubmit={(event) => void enregistrer(event)}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-3"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              {estDetailForfait
                ? 'Nombre de vêtements comptés'
                : `Mesure réelle (${libelleUnite(item.billingUnit)})`}
            </span>
            <input
              type="number"
              min={0.001}
              step={['PIECE', 'PAIR', 'SET', 'PACKAGE'].includes(item.billingUnit) ? 1 : 0.001}
              inputMode="decimal"
              value={quantite}
              onChange={(event) => setQuantite(event.target.value)}
              className="min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
            />
            {item.minimumQuantitySnapshot !== null || item.billingIncrementSnapshot !== null ? (
              <span className="mt-1 block text-xs text-slate-500">
                Minimum {item.minimumQuantitySnapshot ?? '—'} · incrément {item.billingIncrementSnapshot ?? '—'}
              </span>
            ) : null}
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={confirmee}
              onChange={(event) => setConfirmee(event.target.checked)}
              disabled={estDetailForfait}
              className="mt-0.5 size-4 accent-brand-teal"
            />
            <span>
              {estDetailForfait
                ? 'Comptage confirmé : le forfait sera recalculé.'
                : 'J’ai vérifié cette mesure et je la confirme.'}
            </span>
          </label>

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {quantiteFacturee === null
              ? 'La quantité saisie n’est pas compatible avec l’unité de cette ligne.'
              : estDetailForfait
                ? `${quantiteFacturee} pièce(s) comptée(s) · article inclus à 0 FCFA.`
                : `${quantiteFacturee} ${libelleUnite(item.billingUnit)} facturé${item.billingUnit === 'PIECE' ? 'e' : 's'} · nouveau montant : ${formatFcfa(totalPrevu ?? 0)}.`}
            {' '}
            {estDetailForfait
              ? 'La ligne du forfait et le total de la commande seront recalculés.'
              : 'Le prix unitaire et les valeurs tarifaires de référence restent inchangés.'}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={enregistrement || totalPrevu === null}
              className="inline-flex min-h-12 items-center gap-1.5 rounded-lg bg-brand-teal px-3 text-xs font-bold text-white disabled:opacity-50"
            >
              <Check size={14} aria-hidden />
              {enregistrement
                ? 'Enregistrement…'
                : estDetailForfait
                  ? 'Confirmer le comptage'
                  : confirmee
                    ? 'Confirmer la mesure'
                    : 'Enregistrer l’estimation'}
            </button>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              disabled={enregistrement}
              className="inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600"
            >
              <X size={14} aria-hidden />
              Annuler
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
