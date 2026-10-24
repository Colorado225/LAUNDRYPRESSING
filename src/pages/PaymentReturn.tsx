import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  WifiOff,
} from 'lucide-react'
import { fetchPaymentState, type PaymentState } from '@/services/paymentService'
import { formatDateTimeFr, formatFcfa } from '@/lib/formatters'
import { PAYMENT_STATUS_LABELS } from '@/constants/orders'
import { db, type LocalOrder } from '@/db/localDb'

/**
 * Écran de retour après paiement CinetPay.
 *
 * CinetPay redirige ici avec `transaction_id` (et nous ajoutons `order`).
 * ⚠️ Cet écran ne valide JAMAIS un paiement : il se contente de LIRE l'état
 * enregistré par le webhook. La confirmation officielle vient du serveur
 * (notification + `/v2/payment/check`), conformément à la documentation CinetPay.
 */

type ViewState = 'vérification' | 'payée' | 'en-attente' | 'refusée' | 'erreur' | 'hors-ligne'

const MAX_POLLS = 4
const POLL_DELAY_MS = 3000

export default function PaymentReturn() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const orderId = searchParams.get('order') ?? searchParams.get('orderId') ?? ''
  const transactionId = searchParams.get('transaction_id') ?? searchParams.get('transactionId')

  const [view, setView] = useState<ViewState>('vérification')
  const [state, setState] = useState<PaymentState | null>(null)
  const [order, setOrder] = useState<LocalOrder | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const pollsRef = useRef(0)
  const receiptNavigationStarted = useRef(false)
  // `runId` relance la vérification (sondage automatique ou bouton manuel)
  // sans récursion : chaque passage planifie le suivant via setTimeout.
  const [runId, setRunId] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const run = async () => {
      if (!orderId) {
        setView('erreur')
        setErrorMessage("Référence de commande absente de l'adresse de retour.")
        return
      }

      const local = await db.orders.get(orderId)
      if (cancelled) return
      setOrder(local ?? null)

      if (!navigator.onLine) {
        setView('hors-ligne')
        if (local) {
          setState({
            paymentStatus: local.paymentStatus,
            paymentMethod: local.paymentMethod,
            transactionStatus: null,
            paidAt: null,
            fromServer: false,
          })
        }
        return
      }

      try {
        const result = await fetchPaymentState(orderId)
        if (cancelled) return
        setState(result)

        if (result.paymentStatus === 'paid') {
          setView('payée')
          return
        }
        if (result.transactionStatus === 'refused') {
          setView('refusée')
          return
        }

        // Le webhook CinetPay peut arriver quelques secondes après la
        // redirection : on réessaie avant d'annoncer « en attente ».
        if (pollsRef.current < MAX_POLLS) {
          pollsRef.current += 1
          setView('vérification')
          timer = window.setTimeout(() => {
            if (!cancelled) setRunId((value) => value + 1)
          }, POLL_DELAY_MS)
          return
        }

        setView('en-attente')
      } catch {
        if (cancelled) return
        setView('erreur')
        setErrorMessage(
          'La vérification du paiement a échoué. Le paiement reste enregistré côté serveur : consultez la fiche de la commande dans quelques minutes.',
        )
      }
    }

    void run()

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [orderId, runId])

  // Le reçu ne s'ouvre qu'après confirmation serveur explicite : le navigateur
  // ne peut jamais transformer un retour CinetPay en succès supposé.
  useEffect(() => {
    if (
      view !== 'payée' ||
      !order ||
      state?.paymentStatus !== 'paid' ||
      !state.fromServer
    ) return

    if (receiptNavigationStarted.current) return
    receiptNavigationStarted.current = true
    navigate(`/commandes/${order.id}/recu`, { replace: true })
  }, [view, order, state, navigate])

  const handleManualRefresh = () => {
    pollsRef.current = 0
    setView('vérification')
    setRunId((value) => value + 1)
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <header className="text-center">
        <h1 className="text-xl font-bold text-brand-navy sm:text-2xl">Retour de paiement</h1>
        {transactionId && (
          <p className="mt-1 font-mono text-xs text-slate-500">
            Transaction : {transactionId}
          </p>
        )}
      </header>

      <section className={`rounded-2xl border p-5 text-center ${visualFor(view).classes}`}>
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-white/70">
          {visualFor(view).icon}
        </span>
        <h2 className="mt-3 text-lg font-bold">{visualFor(view).title}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm">{visualFor(view).description}</p>

        {order && (
          <dl className="mx-auto mt-4 grid max-w-sm grid-cols-2 gap-2 text-left text-sm">
            <div className="rounded-xl bg-white/70 p-2.5">
              <dt className="text-xs opacity-80">Commande</dt>
              <dd className="font-semibold">{order.customerName}</dd>
            </div>
            <div className="rounded-xl bg-white/70 p-2.5">
              <dt className="text-xs opacity-80">Montant</dt>
              <dd className="font-semibold">{formatFcfa(order.totalAmount)}</dd>
            </div>
            <div className="rounded-xl bg-white/70 p-2.5">
              <dt className="text-xs opacity-80">Paiement</dt>
              <dd className="font-semibold">
                {PAYMENT_STATUS_LABELS[state?.paymentStatus ?? order.paymentStatus]}
              </dd>
            </div>
            <div className="rounded-xl bg-white/70 p-2.5">
              <dt className="text-xs opacity-80">Confirmé le</dt>
              <dd className="font-semibold">
                {state?.paidAt ? formatDateTimeFr(state.paidAt) : '—'}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {errorMessage && view === 'erreur' && (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{errorMessage}</p>
      )}

      {(view === 'en-attente' || view === 'hors-ligne' || view === 'erreur') && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <p>
            Un paiement Mobile Money est confirmé par la notification serveur de CinetPay, jamais
            par le navigateur. Si le client a bien payé, la commande passera automatiquement en
            « payée » — vous pouvez aussi vérifier plus tard depuis la fiche de la commande.
          </p>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={view === 'vérification'}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-brand-teal disabled:opacity-50"
        >
          <RefreshCw size={18} aria-hidden />
          Vérifier à nouveau
        </button>

        <Link
          to={orderId ? `/commandes/${orderId}` : '/commandes'}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-bold text-white hover:bg-brand-slate"
        >
          <ArrowLeft size={18} aria-hidden />
          {orderId ? 'Ouvrir la commande' : 'Retour aux commandes'}
        </Link>
      </div>
    </div>
  )
}

function visualFor(view: ViewState) {
  const visuals: Record<
    ViewState,
    { title: string; description: string; classes: string; icon: React.ReactNode }
  > = {
    vérification: {
      title: 'Vérification du paiement…',
      description: 'Nous interrogeons le serveur pour connaître le résultat exact de la transaction.',
      classes: 'border-slate-200 bg-slate-50 text-slate-800',
      icon: <Loader2 className="animate-spin" size={26} aria-hidden />,
    },
    payée: {
      title: 'Paiement confirmé',
      description: 'La commande est réglée. Le reçu s’ouvre automatiquement pour être remis au client.',
      classes: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      icon: <CheckCircle2 size={28} aria-hidden />,
    },
    'en-attente': {
      title: 'Paiement en attente de confirmation',
      description:
        'CinetPay n’a pas encore confirmé la transaction. Cela peut prendre quelques minutes.',
      classes: 'border-amber-200 bg-amber-50 text-amber-900',
      icon: <Clock size={26} aria-hidden />,
    },
    refusée: {
      title: 'Paiement refusé',
      description:
        'La transaction a été refusée par l’opérateur. Le client peut réessayer depuis la fiche de la commande.',
      classes: 'border-rose-200 bg-rose-50 text-rose-900',
      icon: <AlertTriangle size={26} aria-hidden />,
    },
    erreur: {
      title: 'Vérification impossible',
      description:
        'Une erreur est survenue lors de la vérification. Aucun paiement n’a été validé par cet écran.',
      classes: 'border-rose-200 bg-rose-50 text-rose-900',
      icon: <AlertTriangle size={26} aria-hidden />,
    },
    'hors-ligne': {
      title: 'Appareil hors ligne',
      description:
        'Impossible de vérifier le paiement sans connexion. Le statut s’actualisera au retour du réseau.',
      classes: 'border-amber-200 bg-amber-50 text-amber-900',
      icon: <WifiOff size={26} aria-hidden />,
    },
  }

  return visuals[view]
}
