import { useEffect, useState } from 'react'
import { Clock3, Loader2, RefreshCw } from 'lucide-react'
import { formatDateTimeFr, formatFcfa } from '@/lib/formatters'
import { libelleUnite } from '@/lib/catalogPricing'
import { getOrderMeasurementHistory } from '@/services/orderMeasurementHistory'
import type { LocalOrderItem } from '@/db/localDb'
import type { Json, OrderPriceHistoryRow } from '@/types/database'

interface Props {
  tenantId: string
  orderId: string
  items: LocalOrderItem[]
  showAmounts: boolean
}

type Snapshot = Record<string, Json | undefined>

function asSnapshot(value: Json): Snapshot {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Snapshot
  }
  return {}
}

function numberValue(snapshot: Snapshot, key: string): number | null {
  const value = snapshot[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function displayNumber(value: number | null): string {
  return value === null
    ? 'non renseigné'
    : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value)
}

function describeChange(row: OrderPriceHistoryRow, unit: string): string[] {
  const avant = asSnapshot(row.previous_snapshot)
  const apres = asSnapshot(row.new_snapshot)
  const changements: string[] = []
  const ancienneMesure = numberValue(avant, 'quantity')
  const nouvelleMesure = numberValue(apres, 'quantity')
  const ancienneFacturee = numberValue(avant, 'billed_quantity')
  const nouvelleFacturee = numberValue(apres, 'billed_quantity')

  if (ancienneMesure !== nouvelleMesure) {
    changements.push(`Mesure : ${displayNumber(ancienneMesure)} → ${displayNumber(nouvelleMesure)} ${unit}`)
  }
  if (ancienneFacturee !== nouvelleFacturee) {
    changements.push(
      `Quantité facturée : ${displayNumber(ancienneFacturee)} → ${displayNumber(nouvelleFacturee)} ${unit}`,
    )
  }
  if (row.previous_price !== row.new_price) {
    changements.push(
      `Montant : ${formatFcfa(row.previous_price)} → ${formatFcfa(row.new_price)}`,
    )
  }
  if (avant['price_status'] !== apres['price_status']) {
    changements.push(
      `État de la mesure : ${avant['price_status'] === 'CONFIRMED' ? 'confirmée' : 'estimée'} → ${apres['price_status'] === 'CONFIRMED' ? 'confirmée' : 'estimée'}`,
    )
  }

  return changements.length > 0 ? changements : ['Détail de la correction enregistré.']
}

/** Historique serveur des changements de mesure et de tarif d'une commande. */
export default function OrderMeasurementHistory({ tenantId, orderId, items, showAmounts }: Props) {
  const queryKey = `${tenantId}:${orderId}`
  const [resultat, setResultat] = useState<{
    key: string
    rows: OrderPriceHistoryRow[] | null
    erreur: string | null
  }>({ key: '', rows: null, erreur: null })

  useEffect(() => {
    let actif = true

    void getOrderMeasurementHistory(tenantId, orderId)
      .then((rows) => {
        if (actif) setResultat({ key: queryKey, rows, erreur: null })
      })
      .catch((cause: unknown) => {
        if (actif) {
          setResultat({
            key: queryKey,
            rows: null,
            erreur: cause instanceof Error ? cause.message : 'Historique indisponible pour le moment.',
          })
        }
      })

    return () => {
      actif = false
    }
  }, [tenantId, orderId, queryKey])

  const courant = resultat.key === queryKey
  const rows = courant ? resultat.rows : null
  const erreur = courant ? resultat.erreur : null
  const enChargement = !courant || (rows === null && erreur === null)
  const labelParId = new Map(items.map((item) => [item.id, item.label]))

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        <Clock3 size={16} aria-hidden /> Historique des mesures et tarifs
      </h2>

      {enChargement && ( 
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500" role="status">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Chargement de l’historique…
        </p>
      )}

      {erreur && (
        <p className="mt-3 flex items-start gap-2 text-sm text-amber-800" role="status">
          <RefreshCw size={16} className="mt-0.5 shrink-0" aria-hidden /> {erreur}
        </p>
      )}

      {rows && rows.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">
          Aucune correction n’a encore été enregistrée sur le serveur. Les changements en attente
          apparaîtront après synchronisation.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ol className="mt-3 divide-y divide-slate-100">
          {rows.map((row) => {
            const avant = asSnapshot(row.previous_snapshot)
            const unitCodes: LocalOrderItem['billingUnit'][] = [
              'PIECE', 'PAIR', 'SET', 'KG', 'M2', 'METER', 'PACKAGE', 'FLAT',
            ]
            const uniteSnapshot = avant['billing_unit']
            const uniteCode = unitCodes.includes(uniteSnapshot as LocalOrderItem['billingUnit'])
              ? (uniteSnapshot as LocalOrderItem['billingUnit'])
              : 'PIECE'
            const unit = libelleUnite(uniteCode)
            const details = describeChange(row, unit)
            return (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                <p className="font-semibold text-slate-800">
                  {labelParId.get(row.order_item_id) ?? 'Ligne de commande'}
                </p>
                <time dateTime={row.changed_at} className="mt-0.5 block text-xs text-slate-500">
                  {formatDateTimeFr(row.changed_at)}
                </time>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                  {details.map((detail) => (
                    <li key={detail}>
                      {showAmounts || !detail.startsWith('Montant :')
                        ? detail
                        : 'Montant : —'}
                    </li>
                  ))}
                </ul>
                {row.reason && <p className="mt-1 text-xs text-slate-500">Motif : {row.reason}</p>}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
