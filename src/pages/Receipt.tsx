import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Printer } from 'lucide-react'
import { useCashPayments, useLocalOrder } from '@/db/hooks'
import { useTenantStore } from '@/lib/tenantContext'
import { formatDateFr, formatDateTimeFr, formatFcfa, formatPhoneCi } from '@/lib/formatters'
import { libelleUnite } from '@/lib/catalogPricing'
import { computeBalance } from '@/services/cashService'
import { PAYMENT_METHOD_LABELS, ORDER_STATUSES } from '@/constants/orders'
import { formatGarmentComposition } from '@/constants/garmentTypes'

/**
 * Reçu client — impression thermique 80 mm.
 *
 * Le reçu est reconstruit à partir des données LOCALES : il reste imprimable
 * hors ligne, y compris pour un encaissement qui n'est pas encore transmis au
 * serveur (le montant figure alors dans le solde, la transmission suit).
 *
 * Il mentionne explicitement le reste à payer : un reçu qui n'affiche que
 * « payé » est la première cause de litige au comptoir.
 */

const PRINT_ROOT_ID = 'print-root'
const PRINTING_CLASS = 'impression-etiquette'

export default function Receipt() {
  const { orderId } = useParams<{ orderId: string }>()
  const data = useLocalOrder(orderId)
  const paiements = useCashPayments(orderId)
  const tenantName = useTenantStore((state) => state.tenantName)

  const [printRoot, setPrintRoot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let container = document.getElementById(PRINT_ROOT_ID)
    let created = false

    if (!container) {
      container = document.createElement('div')
      container.id = PRINT_ROOT_ID
      document.body.appendChild(container)
      created = true
    }

    setPrintRoot(container)

    return () => {
      if (created) container?.remove()
    }
  }, [])

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        Préparation du reçu…
      </div>
    )
  }

  if (data === null) {
    return (
      <div className="space-y-4">
        <Link
          to="/commandes"
          className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-600"
        >
          <ArrowLeft size={16} aria-hidden />
          Retour aux commandes
        </Link>
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
          <p className="font-semibold text-slate-700">Commande introuvable</p>
          <p className="mt-1 text-sm text-slate-500">
            Elle a peut-être été créée sur un autre appareil.
          </p>
        </div>
      </div>
    )
  }

  const { order, items } = data
  const solde = computeBalance(order.totalAmount, order.paymentStatus, paiements)
  const reference = `CMD-${order.id.replace(/-/g, '').slice(-6).toUpperCase()}`
  const moyenPaiement =
    order.paymentMethod && solde.paid > 0 ? PAYMENT_METHOD_LABELS[order.paymentMethod] : null

  const imprimer = () => {
    document.body.classList.add(PRINTING_CLASS)
    const cleanup = () => {
      document.body.classList.remove(PRINTING_CLASS)
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)

    try {
      window.print()
    } finally {
      window.setTimeout(cleanup, 1500)
    }
  }

  const contenu = (
    <div className="mx-auto w-[80mm] bg-white p-2 font-mono text-[11px] leading-snug text-black">
      <div className="text-center">
        <p className="text-[13px] font-bold uppercase">{tenantName ?? 'Pressing'}</p>
        <p className="mt-1 text-[10px]">Reçu de dépôt — {reference}</p>
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <p>Date : {formatDateTimeFr(order.createdAt)}</p>
      <p>Client : {order.customerName}</p>
      <p>Tél. : {formatPhoneCi(order.customerPhone)}</p>
      {order.dueDate && <p>Livraison promise : {formatDateFr(order.dueDate)}</p>}
      <p>Statut : {ORDER_STATUSES[order.status].label}</p>

      <div className="my-2 border-t border-dashed border-black" />

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th className="w-[68%] font-normal">Article</th>
            <th className="w-[32%] text-right font-normal">Prix</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="pr-1">
                {item.billingUnit === 'KG' ? (item.serviceName ?? item.label) : item.articleName ?? item.label}
                {item.billingUnit !== 'KG' && item.serviceName ? ` — ${item.serviceName}` : ''}
                {item.fabricType ? ` (${item.fabricType})` : ''}
                {formatGarmentComposition(item.garmentDetails) && (
                  <span className="block text-[9px]">Vêtements : {formatGarmentComposition(item.garmentDetails)}</span>
                )}
                <span className="block text-[10px]">
                  {item.familyPackageSnapshot
                    ? `${item.familyPackageSnapshot.pieceCount} pièce(s) · ${item.laundryPriceBreakdownSnapshot ?? 'forfait famille'}`
                    : item.laundryModelId
                    ? `${item.laundryWeightKg} kg · ${item.laundryPriceBreakdownSnapshot ?? 'modèle commercial'}`
                    : item.billingUnit === 'FLAT'
                      ? `Forfait ${formatFcfa(item.unitPrice)}`
                      : `${item.quantity} ${libelleUnite(item.billingUnit)} mesuré · ${item.billedQuantity} facturé × ${formatFcfa(item.unitPrice)}/${libelleUnite(item.billingUnit)}`}
                  {item.priceStatus === 'ESTIMATED' ? ' · ESTIMÉ' : ''}
                </span>
                {item.laundryServicesSnapshot && <span className="block text-[9px]">Prestations : {item.laundryServicesSnapshot}</span>}
                {item.familyPackageSnapshot && <span className="block text-[9px]">Composition : {item.familyPackageSnapshot.contents.map((content) => `${content.quantity} × ${content.articleName}`).join(', ')}</span>}
              </td>
              <td className="text-right whitespace-nowrap">{formatFcfa(item.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="flex justify-between font-bold">
        <span>TOTAL</span>
        <span>{formatFcfa(order.totalAmount)}</span>
      </div>
      <div className="mt-1 flex justify-between">
        <span>Encaissé{moyenPaiement ? ` (${moyenPaiement})` : ''}</span>
        <span>{formatFcfa(solde.paid)}</span>
      </div>
      <div className="flex justify-between font-bold">
        <span>RESTE À PAYER</span>
        <span>{formatFcfa(solde.remaining)}</span>
      </div>

      {paiements.length > 0 && (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <p className="text-[10px] font-bold uppercase">Détail des encaissements</p>
          {paiements.map((paiement) => (
            <p key={paiement.id} className="text-[10px]">
              {formatDateFr(paiement.receivedAt)} — espèces : {formatFcfa(paiement.amount)}
            </p>
          ))}
        </>
      )}

      <div className="my-2 border-t border-dashed border-black" />

      <p className="text-center text-[10px]">
        Conservez ce reçu pour retirer vos vêtements.
      </p>
      <p className="mt-1 text-center text-[10px]">{reference}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          to={`/commandes/${order.id}`}
          className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-600 hover:text-brand-navy"
        >
          <ArrowLeft size={16} aria-hidden />
          Retour à la commande
        </Link>

        <button
          type="button"
          onClick={imprimer}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-bold text-white"
        >
          <Printer size={16} aria-hidden />
          Imprimer le reçu
        </button>
      </div>

      <section className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {contenu}
      </section>

      {printRoot && createPortal(contenu, printRoot)}

      <p className="text-center text-xs text-slate-500 print:hidden">
        Format 80 mm. Le reçu indique toujours le reste à payer, y compris après un acompte.
      </p>
    </div>
  )
}
