import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import PaymentButton from '@/components/PaymentButton'
import QrCodeDisplay from '@/components/QrCodeDisplay'
import { useLocalOrder, useUpdateOrderStatus } from '@/db/hooks'
import { useTenantStore } from '@/lib/tenantContext'
import {
  ORDER_FLOW,
  ORDER_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGE_CLASS,
  PAYMENT_STATUS_LABELS,
  getNextStatus,
  getPreviousStatus,
  isOrderLate,
  todayIso,
} from '@/constants/orders'
import { formatDateFr, formatDateTimeFr, formatFcfa, formatPhoneCi } from '@/lib/formatters'
import { can, canSeeAmounts } from '@/lib/permissions'
import ConflictBanner from '@/components/ConflictBanner'
import CashPanel from '@/components/CashPanel'
import AssignmentPanel from '@/components/AssignmentPanel'
import IssuePanel from '@/components/IssuePanel'
import { useState } from 'react'

/**
 * Fiche commande : détail, avancement du statut et état de synchronisation.
 * Les changements de statut sont appliqués localement (mode avion compris).
 */
export default function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>()
  const data = useLocalOrder(orderId)
  const updateStatus = useUpdateOrderStatus()
  const tenantName = useTenantStore((state) => state.tenantName)
  const role = useTenantStore((state) => state.role)
  const seeAmounts = canSeeAmounts(role)

  // Déclarés AVANT tout retour anticipé : l'ordre des hooks doit rester stable
  // entre le chargement et l'affichage de la fiche.
  const [annulationOuverte, setAnnulationOuverte] = useState(false)
  const [motifAnnulation, setMotifAnnulation] = useState('')

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        Chargement de la commande…
      </div>
    )
  }

  if (data === null) {
    return (
      <div className="space-y-4">
        <BackButton />
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
  const statusMeta = ORDER_STATUSES[order.status]
  const nextStatus = getNextStatus(order.status)
  const previousStatus = getPreviousStatus(order.status)
  const enRetard = isOrderLate(order, todayIso())
  // La marche arrière est réservée au propriétaire par `guard_order_update` :
  // afficher le bouton aux autres rôles ne produirait qu'une erreur serveur.
  const peutReculer = can(role, 'orders.editDetails') && role === 'owner'
  const peutAnnuler = can(role, 'orders.updateStatus') && role !== 'artisan'

  const changeStatus = async (status: typeof order.status, reason: string | null = null) => {
    try {
      await updateStatus(order.id, status, reason)
      toast.success(`Statut mis à jour : ${ORDER_STATUSES[status].label}`, { icon: '✅' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise à jour impossible')
    }
  }

  return (
    <div className="space-y-4">
      <BackButton />

      {/* En-tête */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-navy sm:text-2xl">{order.customerName}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {formatPhoneCi(order.customerPhone)} · créée le {formatDateTimeFr(order.createdAt)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold ${statusMeta.badgeClass}`}
            >
              {statusMeta.label}
            </span>

            {enRetard && (
              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-100 px-3 py-1.5 text-sm font-semibold text-rose-800">
                En retard
              </span>
            )}
          </div>
        </div>

        <p className="mt-3 text-sm text-slate-600">{statusMeta.description}</p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Total</dt>
            <dd className="text-lg font-bold text-brand-navy">
              {seeAmounts ? formatFcfa(order.totalAmount) : '—'}
            </dd>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Livraison promise</dt>
            <dd className={`text-sm font-semibold ${enRetard ? 'text-rose-700' : 'text-slate-800'}`}>
              {order.dueDate ? formatDateFr(order.dueDate) : 'Non précisée'}
            </dd>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Paiement</dt>
            <dd className="mt-0.5">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PAYMENT_STATUS_BADGE_CLASS[order.paymentStatus]}`}
              >
                {PAYMENT_STATUS_LABELS[order.paymentStatus]}
              </span>
              {order.paymentMethod && (
                <span className="ml-2 text-xs text-slate-500">
                  via {PAYMENT_METHOD_LABELS[order.paymentMethod]}
                </span>
              )}
            </dd>
          </div>
        </dl>

        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-mono break-all">{order.qrCode}</span>
        </p>
      </section>

      {/* Conflit de synchronisation : arbitrage explicite obligatoire */}
      <ConflictBanner order={order} />

      {/* Synchronisation */}
      <section
        className={`rounded-2xl border p-4 ${
          order.synced === 1
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-amber-200 bg-amber-50 text-amber-900'
        }`}
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          {order.synced === 1 ? (
            <>
              <CheckCircle2 size={18} aria-hidden />
              Synchronisée avec le serveur
              {order.syncedAt ? ` le ${formatDateTimeFr(order.syncedAt)}` : ''}
            </>
          ) : (
            <>
              <RefreshCw size={18} aria-hidden />
              En attente de synchronisation
            </>
          )}
        </p>
        {order.syncError && <p className="mt-1 text-xs">{order.syncError}</p>}
      </section>

      {/* Vêtements */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Vêtements ({items.length})
        </h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{item.label}</p>
                <p className="text-xs text-slate-500">
                  {[item.fabricType, item.specialInstructions].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <span className="font-semibold text-brand-navy">
                {seeAmounts ? formatFcfa(item.price) : '—'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Prise en charge : attribution à un employé */}
      <AssignmentPanel order={order} />

      {/* Réclamations et vêtements abîmés */}
      <IssuePanel order={order} items={items} />

      {/* Caisse : espèces, acompte, solde et reçu */}
      {seeAmounts && <CashPanel order={order} />}

      {/* Paiement Mobile Money — initiation réservée au comptoir */}
      {can(role, 'payments.initiate') && <PaymentButton order={order} />}

      {/* Étiquette QR — impression 80 mm */}
      <QrCodeDisplay order={order} items={items} tenantName={tenantName} />

      {/* Progression */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Avancement</h2>

        <ol className="mt-3 flex flex-wrap items-center gap-2">
          {ORDER_FLOW.map((status) => {
            const meta = ORDER_STATUSES[status]
            const isCurrent = status === order.status
            return (
              <li key={status}>
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${
                    isCurrent ? meta.badgeClass : 'border-slate-200 bg-white text-slate-500'
                  }`}
                >
                  {meta.label}
                </span>
              </li>
            )
          })}
        </ol>

        <div className="mt-4 flex flex-wrap gap-2">
          {previousStatus && peutReculer && (
            <button
              type="button"
              onClick={() => void changeStatus(previousStatus)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-slate-400"
            >
              <ChevronLeft size={18} aria-hidden />
              Revenir à « {ORDER_STATUSES[previousStatus].shortLabel} »
            </button>
          )}

          {nextStatus && (
            <button
              type="button"
              onClick={() => void changeStatus(nextStatus)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark"
            >
              Passer à « {ORDER_STATUSES[nextStatus].label} »
              <ChevronRight size={18} aria-hidden />
            </button>
          )}

          {peutAnnuler &&
            order.status !== 'cancelled' &&
            order.status !== 'delivered' &&
            !annulationOuverte && (
              <button
                type="button"
                onClick={() => setAnnulationOuverte(true)}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                Annuler la commande
              </button>
            )}
        </div>

        {annulationOuverte && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-rose-900">
                Motif de l’annulation (recommandé, conservé dans l’historique)
              </span>
              <textarea
                value={motifAnnulation}
                onChange={(event) => setMotifAnnulation(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Ex. : client absent depuis trois semaines, vêtements rendus au dépôt"
                className="w-full rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500"
              />
            </label>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void changeStatus('cancelled', motifAnnulation)
                  setAnnulationOuverte(false)
                  setMotifAnnulation('')
                }}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white hover:bg-rose-800"
              >
                Confirmer l’annulation
              </button>

              <button
                type="button"
                onClick={() => {
                  setAnnulationOuverte(false)
                  setMotifAnnulation('')
                }}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
              >
                Retour
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function BackButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate('/commandes')}
      className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-600 hover:text-brand-navy active:text-brand-navy"
    >
      <ArrowLeft size={16} aria-hidden />
      Retour aux commandes
    </button>
  )
}
