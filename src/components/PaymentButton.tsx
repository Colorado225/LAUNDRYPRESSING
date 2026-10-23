import { useState } from 'react'
import { Banknote, Loader2, Smartphone, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'
import type { LocalOrder } from '@/db/localDb'
import {
  PaymentError,
  canInitiatePayment,
  chargeableAmount,
  initiatePayment,
  redirectToPayment,
} from '@/services/paymentService'
import { formatFcfa } from '@/lib/formatters'
import { useCashPayments } from '@/db/hooks'
import { computeBalance } from '@/services/cashService'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'

/**
 * Bouton « Payer par Mobile Money » (phase 4).
 *
 * Le guichet CinetPay hébergé affiche ensuite Wave, Orange Money, MTN MoMo et
 * Moov Money : l'application n'a pas à gérer chaque opérateur séparément.
 */

const OPERATORS = [
  { name: 'Wave', className: 'bg-sky-100 text-sky-800' },
  { name: 'Orange Money', className: 'bg-orange-100 text-orange-800' },
  { name: 'MTN MoMo', className: 'bg-yellow-100 text-yellow-900' },
  { name: 'Moov Money', className: 'bg-indigo-100 text-indigo-800' },
]

export default function PaymentButton({ order }: { order: LocalOrder }) {
  const role = useTenantStore((state) => state.role)
  const [submitting, setSubmitting] = useState(false)
  // Défense en profondeur : l'écran parent masque déjà le bouton, mais un
  // composant monté directement ne doit pas contourner la matrice.
  const allowed = can(role, 'payments.initiate')
  const paiementsEspeces = useCashPayments(order.id)
  const guard = canInitiatePayment()
  // On ne demande que le RESTE À PAYER : un acompte en espèces déjà encaissé
  // au comptoir ne doit pas être facturé une seconde fois par Mobile Money.
  const solde = computeBalance(order.totalAmount, order.paymentStatus, paiementsEspeces)
  const charged = chargeableAmount(solde.remaining)
  const isRounded = charged !== solde.remaining
  const alreadyPaid = order.paymentStatus === 'paid' || solde.remaining <= 0
  const blocked = alreadyPaid || order.status === 'cancelled' || !guard.ok

  if (!allowed) return null

  const handlePay = async () => {
    setSubmitting(true)
    try {
      const result = await initiatePayment(order, {
        name: order.customerName,
        phone: order.customerPhone,
      })

      if (result.chargedAmount !== result.orderAmount) {
        toast(
          `Montant arrondi à ${formatFcfa(result.chargedAmount)} (CinetPay exige un multiple de 5).`,
          { icon: 'ℹ️', duration: 5000 },
        )
      }

      // Redirection vers le guichet hébergé : le paiement se poursuit chez CinetPay.
      redirectToPayment(result.paymentUrl)
    } catch (error) {
      const message =
        error instanceof PaymentError
          ? error.message
          : 'Le paiement n’a pas pu être initié. Réessayez.'
      toast.error(message, { duration: 6000 })
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <Smartphone size={16} aria-hidden />
            Paiement Mobile Money
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Le client règle sur le guichet sécurisé CinetPay, puis la commande est marquée
            payée automatiquement.
          </p>
        </div>

        {alreadyPaid ? (
          <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            <Banknote size={16} aria-hidden />
            Commande réglée
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void handlePay()}
            disabled={submitting || blocked}
            title={guard.reason ?? undefined}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white transition-colors hover:bg-brand-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" size={18} aria-hidden />
                Ouverture du guichet…
              </>
            ) : (
              <>
                <Smartphone size={18} aria-hidden />
                Payer par Mobile Money
              </>
            )}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {OPERATORS.map((operator) => (
          <span
            key={operator.name}
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${operator.className}`}
          >
            {operator.name}
          </span>
        ))}
        <span className="text-xs text-slate-500">
          · Montant à régler : <strong className="text-slate-700">{formatFcfa(charged)}</strong>
          {isRounded && ` (arrondi depuis ${formatFcfa(solde.remaining)})`}
        </span>
      </div>

      {!alreadyPaid && order.status === 'cancelled' && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
          <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden />
          Cette commande est annulée : aucun paiement ne peut être initié.
        </p>
      )}

      {!guard.ok && !alreadyPaid && order.status !== 'cancelled' && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden />
          {guard.reason}
        </p>
      )}
    </section>
  )
}
