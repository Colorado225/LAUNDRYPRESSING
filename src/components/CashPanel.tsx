import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Banknote, CloudOff, FileText, Loader2, Printer, ReceiptText, Undo2, Wifi } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCashPayments, useOrderRefunds, useQueueCashPayment } from '@/db/hooks'
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
import { MIN_REFUND_REASON, RefundError, recordRefund } from '@/services/refundService'

/**
 * Encaissement au comptoir (palier 2).
 *
 * L'écriture est LOCALE d'abord : le client tend ses billets, la tablette peut
 * être hors ligne. Le moteur de synchronisation transmet ensuite
 * l'encaissement au serveur, de façon idempotente (l'identifiant est généré
 * ici). Le solde affiché reste donc juste dans les deux cas.
 */

/**
 * @param autoOpen Déplie le panneau dès l'arrivée sur la fiche (création d'une
 *   commande avec règlement immédiat : `/commandes/:id?regler=1`).
 */
export default function CashPanel({
  order,
  autoOpen = false,
}: {
  order: LocalOrder
  autoOpen?: boolean
}) {
  const navigate = useNavigate()
  const role = useTenantStore((state) => state.role)
  const paiements = useCashPayments(order.id)
  const remboursements = useOrderRefunds(order.id)
  const encaisser = useQueueCashPayment()

  // Le solde est calculé avant les états : le montant proposé à l'ouverture
  // automatique doit être le reste à payer, pas zéro.
  const solde = computeBalance(order.totalAmount, order.paymentStatus, paiements)

  const [ouvert, setOuvert] = useState(autoOpen)
  const [montant, setMontant] = useState(autoOpen ? String(solde.remaining) : '')
  const [note, setNote] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [rembourser, setRembourser] = useState(false)
  const [montantRembourse, setMontantRembourse] = useState('')
  const [motif, setMotif] = useState('')
  const [envoiRemboursement, setEnvoiRemboursement] = useState(false)

  const peutEncaisser = can(role, 'cash.manage') && canAcceptPayment(order, solde)

  // Un remboursement ne change pas le « reste à payer » : il constate une
  // sortie d'argent. Seul le propriétaire peut le décider.
  const dejaRembourse = remboursements.reduce((total, ligne) => total + ligne.amount, 0)
  const remboursable = Math.max(solde.paid - dejaRembourse, 0)
  const peutRembourser = role === 'owner' && remboursable > 0

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
      toast.success(`Encaissement de ${formatFcfa(valeur)} enregistré · reçu prêt à imprimer`, { icon: '💵' })
      setOuvert(false)
      setMontant('')
      setNote('')
      navigate(`/commandes/${order.id}/recu`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer le paiement")
    } finally {
      setEnvoi(false)
    }
  }

  const ouvrirRemboursement = () => {
    setMontantRembourse(String(remboursable))
    setMotif('')
    setRembourser(true)
  }

  const confirmerRemboursement = async () => {
    const valeur = Math.floor(Number(montantRembourse.replace(/\s/g, '')))

    if (!Number.isFinite(valeur) || valeur <= 0) {
      toast.error('Indiquez un montant valide.')
      return
    }

    setEnvoiRemboursement(true)
    try {
      await recordRefund({
        orderId: order.id,
        tenantId: order.tenantId,
        amount: valeur,
        reason: motif,
      })
      toast.success(`Remboursement de ${formatFcfa(valeur)} enregistré`, { icon: '↩️' })
      setRembourser(false)
      setMontantRembourse('')
      setMotif('')
    } catch (error) {
      toast.error(
        error instanceof RefundError ? error.message : 'Remboursement impossible. Réessayez.',
      )
    } finally {
      setEnvoiRemboursement(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Encaissement</h2>

        <div className="flex flex-wrap gap-2">
          <Link
            to={`/commandes/${order.id}/recu`}
            className="inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:border-brand-teal"
          >
            <Printer size={14} aria-hidden />
            Reçu
          </Link>
          <Link
            to={`/commandes/${order.id}/facture`}
            className="inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:border-brand-teal"
          >
            <FileText size={14} aria-hidden />
            Facture
          </Link>
        </div>
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

      {/* Remboursements : propriétaire seulement, connexion exigée. */}
      {(peutRembourser || remboursements.length > 0) && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <Undo2 size={14} aria-hidden /> Remboursements
            </h3>

            {peutRembourser && !rembourser && (
              <button
                type="button"
                onClick={ouvrirRemboursement}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                Rembourser jusqu’à {formatFcfa(remboursable)}
              </button>
            )}
          </div>

          {remboursements.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100">
              {remboursements.map((ligne) => (
                <li key={ligne.id} className="py-2">
                  <p className="text-sm font-semibold text-rose-800">
                    −{formatFcfa(ligne.amount)} · {ligne.channel === 'cash' ? 'espèces' : 'Mobile Money'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTimeFr(ligne.refundedAt)} · {ligne.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {rembourser && (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-900">
                <Wifi size={13} aria-hidden />
                Le remboursement est transmis immédiatement au serveur.
              </p>

              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Montant remboursé (FCFA)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={remboursable}
                  value={montantRembourse}
                  onChange={(event) => setMontantRembourse(event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-rose-400"
                />
              </label>

              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Motif ({MIN_REFUND_REASON} caractères minimum)
                </span>
                <textarea
                  value={motif}
                  onChange={(event) => setMotif(event.target.value)}
                  rows={2}
                  placeholder="Ex. : tache non retirée sur la chemise, geste commercial accordé au client"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-400"
                />
              </label>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void confirmerRemboursement()}
                  disabled={envoiRemboursement}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-60"
                >
                  {envoiRemboursement ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}
                  Confirmer le remboursement
                </button>

                <button
                  type="button"
                  onClick={() => setRembourser(false)}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
