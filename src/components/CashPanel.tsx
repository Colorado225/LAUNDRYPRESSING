import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, CloudOff, Loader2, Printer, ReceiptText } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCashPayments, useQueueCashPayment } from '@/db/hooks'
import type { LocalOrder } from '@/db/localDb'
import { formatDateTimeFr, formatFcfa } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import {
  MIN_PAYMENT,
  canAcceptPayment,
  clampPaymentAmount,
  computeBalance,
} from '@/services/cashService'

/**
 * Encaissement au comptoir (palier 2).
 *
 * L'écriture est LOCALE d'abord : le client tend ses billets, la tablette peut
 * être hors ligne. Le moteur de synchronisation transmet ensuite
 * l'encaissement au serveur, de façon idempotente (l'identifiant est généré
 * ici). Le solde affiché reste donc juste dans les deux cas.
 */

export default function CashPanel({ order }: { order: LocalOrder }) {
  const role = useTenantStore((state) => state.role)
  const paiements = useCashPayments(order.id)
  const encaisser = useQueueCashPayment()

  const [ouvert, setOuvert] = useState(false)
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const solde = computeBalance(order.totalAmount, order.paymentStatus, paiements)
  const peutEncaisser = can(role, 'cash.manage') && canAcceptPayment(order, solde)

  const ouvrir = () => {
    setMontant(String(solde.remaining))
    setNote('')
    setOuvert(true)
  }

  const confirmer = async () => {
    const valeur = clampPaymentAmount(Number(montant.replace(/\s/g, '')), solde.remaining)

    if (valeur < MIN_PAYMENT) {
      toast.error(`Le montant minimum est de ${formatFcfa(MIN_PAYMENT)}.`)
      return
    }

    setEnvoi(true)
    try {
      await encaisser(order.id, valeur, note.trim() || null)
      toast.success(`Encaissement de ${formatFcfa(valeur)} enregistré`, { icon: '💵' })
      setOuvert(false)
      setMontant('')
      setNote('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer le paiement")
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Encaissement</h2>

        <Link
          to={`/commandes/${order.id}/recu`}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:border-brand-teal"
        >
          <Printer size={14} aria-hidden />
          Reçu
        </Link>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
          <p className="text-base font-bold text-brand-navy">{formatFcfa(order.totalAmount)}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Encaissé</p>
          <p className="text-base font-bold text-emerald-900">{formatFcfa(solde.paid)}</p>
        </div>
        <div
          className={`rounded-xl p-3 ${solde.settled ? 'bg-emerald-50' : 'bg-amber-50'}`}
        >
          <p
            className={`text-xs uppercase tracking-wide ${
              solde.settled ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            Reste à payer
          </p>
          <p
            className={`text-base font-bold ${
              solde.settled ? 'text-emerald-900' : 'text-amber-900'
            }`}
          >
            {formatFcfa(solde.remaining)}
          </p>
        </div>
      </div>

      {peutEncaisser && !ouvert && (
        <button
          type="button"
          onClick={ouvrir}
          className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark sm:w-auto"
        >
          <Banknote size={18} aria-hidden />
          Encaisser en espèces
        </button>
      )}

      {!peutEncaisser && order.status === 'cancelled' && (
        <p className="mt-3 text-xs text-slate-500">
          Commande annulée : aucun encaissement possible.
        </p>
      )}

      {!peutEncaisser && solde.settled && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
          <ReceiptText size={14} aria-hidden />
          Commande entièrement réglée.
        </p>
      )}

      {ouvert && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Montant reçu (FCFA)
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={MIN_PAYMENT}
                max={solde.remaining}
                step={25}
                value={montant}
                onChange={(event) => setMontant(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Note (facultatif)
              </span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Acompte, billet de 10 000…"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void confirmer()}
              disabled={envoi}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
            >
              {envoi ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}
              Confirmer l’encaissement
            </button>

            <button
              type="button"
              onClick={() => setOuvert(false)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {paiements.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {paiements.map((paiement) => (
            <li key={paiement.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  {formatFcfa(paiement.amount)} · espèces
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTimeFr(paiement.receivedAt)}
                  {paiement.note ? ` · ${paiement.note}` : ''}
                </p>
              </div>

              {paiement.synced === 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  <CloudOff size={12} aria-hidden />
                  En attente d’envoi
                </span>
              )}

              {paiement.lastError && (
                <span className="text-xs font-semibold text-rose-700">{paiement.lastError}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
