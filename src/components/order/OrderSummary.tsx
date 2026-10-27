import { AlertTriangle } from 'lucide-react'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import { PRESENTATION_PARCOURS, type ParcoursService } from '@/lib/orderServices'
import type { LignePanier } from './OrderBasket'

/**
 * Récapitulatif avant enregistrement (écran 3).
 *
 * Écran en lecture seule : il ne permet que de revenir en arrière pour
 * corriger. Il affiche exactement ce qui sera écrit — service, client, dates,
 * lignes et total recalculé — et les erreurs bloquantes connues **avant** le
 * clic, pour qu'un refus ne soit jamais découvert après coup.
 */

interface OrderSummaryProps {
  parcours: ParcoursService
  clientName: string
  clientPhone: string
  dueDate: string
  lignes: readonly LignePanier[]
  total: number
  erreurs: readonly string[]
}

export default function OrderSummary({
  parcours,
  clientName,
  clientPhone,
  dueDate,
  lignes,
  total,
  erreurs,
}: OrderSummaryProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Récapitulatif</h2>
        <p className="text-sm text-slate-500">
          Vérifiez avec le client avant d’enregistrer. La commande sera créée sur cet appareil
          puis envoyée au serveur.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-800">
            {PRESENTATION_PARCOURS[parcours].titre}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-800">{clientName || '—'}</dd>
          <dd className="text-xs text-slate-500">{clientPhone || '—'}</dd>
        </div>
        <div className="rounded-xl border border-slate-200 p-3 sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Livraison promise
          </dt>
          <dd className="mt-1 text-sm font-semibold text-slate-800">
            {dueDate ? formatDateFr(dueDate) : 'Non précisée'}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="recap-articles" className="rounded-xl border border-slate-200">
        <h3
          id="recap-articles"
          className="border-b border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
        >
          Articles ({lignes.length})
        </h3>
        {lignes.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">Aucun article dans la commande.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lignes.map((ligne) => (
              <li key={ligne.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{ligne.libelle}</p>
                  <p className="text-xs text-slate-500">
                    {ligne.unite === 'KG'
                      ? `${ligne.quantite} kg × ${formatFcfa(ligne.prixUnitaire)}/kg`
                      : `${ligne.quantite} × ${formatFcfa(ligne.prixUnitaire)}`}
                    {ligne.detail ? ` · ${ligne.detail}` : ''}
                  </p>
                </div>
                <span className="whitespace-nowrap text-sm font-semibold text-slate-800">
                  {formatFcfa(ligne.total)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-3">
          <span className="text-sm font-semibold text-slate-600">Montant total</span>
          <span className="text-xl font-bold text-brand-navy">{formatFcfa(total)}</span>
        </div>
      </section>

      {erreurs.length > 0 && (
        <div role="alert" className="space-y-1 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} aria-hidden /> À corriger avant d’enregistrer
          </p>
          {erreurs.map((erreur, index) => (
            <p key={`${index}-${erreur}`}>{erreur}</p>
          ))}
        </div>
      )}
    </div>
  )
}
