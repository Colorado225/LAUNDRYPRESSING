import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Keyboard,
  Loader2,
  QrCode,
  ScanLine,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import QrScanner from '@/components/QrScanner'
import { useUpdateOrderStatus } from '@/db/hooks'
import { findOrderByQrCode, getOrderWithItems, getWorkshopOrders } from '@/db/ordersRepository'
import type { LocalOrderWithItems } from '@/db/ordersRepository'
import { useTenantStore } from '@/lib/tenantContext'
import { ORDER_FLOW, ORDER_STATUSES, PAYMENT_STATUS_LABELS } from '@/constants/orders'
import { formatDateTimeFr, formatFcfa } from '@/lib/formatters'
import { shortOrderReference } from '@/services/qrService'
import type { OrderStatus } from '@/types/database'

/**
 * Atelier — scan des étiquettes et avancement des commandes (phase 3).
 *
 * Tout fonctionne hors ligne : la recherche se fait dans Dexie et le changement
 * de statut est écrit localement puis synchronisé (phase 2).
 */

type ScanOutcome =
  | { kind: 'idle' }
  | { kind: 'found'; data: LocalOrderWithItems }
  | { kind: 'not-found'; code: string }
  | { kind: 'foreign-tenant' }
  | { kind: 'searching'; code: string }

export default function Atelier() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const updateStatus = useUpdateOrderStatus()

  const [scannerOpen, setScannerOpen] = useState(false)
  const [outcome, setOutcome] = useState<ScanOutcome>({ kind: 'idle' })
  const [manualCode, setManualCode] = useState('')

  const workshopOrders = useLiveQuery(async () => {
    if (!tenantId) return []
    return getWorkshopOrders(tenantId)
  }, [tenantId])

  const handleCode = useCallback(
    async (code: string) => {
      if (!tenantId) {
        toast.error('Aucun pressing sélectionné.')
        return
      }

      const trimmed = code.trim()
      if (!trimmed) return

      setScannerOpen(false)
      setOutcome({ kind: 'searching', code: trimmed })

      try {
        const found = await findOrderByQrCode(tenantId, trimmed)

        if (found === null) {
          setOutcome({ kind: 'not-found', code: trimmed })
          return
        }
        if ('foreignTenantId' in found) {
          setOutcome({ kind: 'foreign-tenant' })
          return
        }

        setOutcome({ kind: 'found', data: found })
        setManualCode('')
      } catch (error) {
        setOutcome({ kind: 'not-found', code: trimmed })
        toast.error(
          error instanceof Error ? error.message : 'Recherche impossible dans la base locale.',
        )
      }
    },
    [tenantId],
  )

  const changeStatus = async (orderId: string, status: OrderStatus) => {
    try {
      await updateStatus(orderId, status)
      toast.success(`Statut : ${ORDER_STATUSES[status].label}`, { icon: '✅' })
      // Rafraîchit la fiche affichée à partir de la base locale
      const refreshed = await getOrderWithItems(orderId)
      if (refreshed) setOutcome({ kind: 'found', data: refreshed })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise à jour impossible')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-navy sm:text-2xl">Atelier</h1>
          <p className="text-sm text-slate-500">
            Scannez l’étiquette d’un vêtement pour faire avancer sa commande.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          className="inline-flex min-h-14 items-center gap-2 rounded-xl bg-brand-teal px-5 text-base font-bold text-white transition-colors hover:bg-brand-teal-dark"
        >
          <ScanLine size={20} aria-hidden />
          Scanner un vêtement
        </button>
      </div>

      {/* Saisie manuelle : secours si la caméra est indisponible */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          <Keyboard size={16} aria-hidden />
          Saisie manuelle du code
        </h2>
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCode(manualCode)
          }}
        >
          <input
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            placeholder="CMD-7F3A2B ou code complet de l’étiquette"
            aria-label="Code de l’étiquette"
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 font-mono text-sm outline-none focus:border-brand-teal"
          />
          <button
            type="submit"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-brand-teal"
          >
            Rechercher
            <ArrowRight size={16} aria-hidden />
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-400">
          Utile si l’étiquette est abîmée ou si la caméra de la tablette ne fonctionne pas.
        </p>
      </section>

      {/* Résultat du scan */}
      <ScanResult
        outcome={outcome}
        onStatusChange={changeStatus}
        onDismiss={() => setOutcome({ kind: 'idle' })}
      />

      {/* Commandes en atelier */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Commandes en atelier
          {workshopOrders && workshopOrders.length > 0 ? ` (${workshopOrders.length})` : ''}
        </h2>

        {workshopOrders === undefined ? (
          <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="animate-spin" size={16} aria-hidden />
            Chargement…
          </p>
        ) : workshopOrders.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-500">
            Aucune commande en cours de traitement.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {workshopOrders.map((order) => {
              const meta = ORDER_STATUSES[order.status]
              return (
                <li key={order.id}>
                  <Link
                    to={`/commandes/${order.id}`}
                    className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-teal active:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-brand-navy">
                        {order.customerName}
                      </p>
                      <p className="font-mono text-xs text-slate-500">
                        {shortOrderReference(order.id)} · {formatDateTimeFr(order.updatedAt)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-semibold ${meta.badgeClass}`}
                    >
                      {meta.label}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Modale du scanner */}
      {scannerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-brand-navy/70 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Scanner un QR Code"
        >
          <div className="w-full max-w-md rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-6">
            <QrScanner onScanSuccess={(text) => void handleCode(text)} onClose={() => setScannerOpen(false)} />

            <button
              type="button"
              onClick={() => setScannerOpen(false)}
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <X size={18} aria-hidden />
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ScanResult({
  outcome,
  onStatusChange,
  onDismiss,
}: {
  outcome: ScanOutcome
  onStatusChange: (orderId: string, status: OrderStatus) => Promise<void>
  onDismiss: () => void
}) {
  if (outcome.kind === 'idle') return null

  if (outcome.kind === 'searching') {
    return (
      <section className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        Recherche de la commande…
      </section>
    )
  }

  if (outcome.kind === 'not-found') {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <p className="flex items-center gap-2 font-semibold text-rose-900">
          <AlertTriangle size={18} aria-hidden />
          Aucune commande ne correspond à ce code
        </p>
        <p className="mt-1 break-all text-sm text-rose-800">{outcome.code}</p>
        <p className="mt-2 text-sm text-rose-800">
          Vérifiez que l’étiquette appartient bien à ce pressing et que la commande a été créée
          sur cette tablette.
        </p>
        <DismissButton onClick={onDismiss} />
      </section>
    )
  }

  if (outcome.kind === 'foreign-tenant') {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <p className="flex items-center gap-2 font-semibold text-rose-900">
          <AlertTriangle size={18} aria-hidden />
          Étiquette d’un autre pressing
        </p>
        <p className="mt-1 text-sm text-rose-800">
          Cette commande n’appartient pas au pressing actuellement sélectionné.
        </p>
        <DismissButton onClick={onDismiss} />
      </section>
    )
  }

  const { order, items } = outcome.data
  const meta = ORDER_STATUSES[order.status]

  return (
    <section className="rounded-2xl border-2 border-brand-teal/40 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-brand-teal">
            <CheckCircle2 size={14} aria-hidden />
            Commande trouvée
          </p>
          <h2 className="mt-1 text-lg font-bold text-brand-navy">{order.customerName}</h2>
          <p className="font-mono text-xs text-slate-500">
            {shortOrderReference(order.id)} · {order.customerPhone}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold ${meta.badgeClass}`}
        >
          {meta.label}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-2.5">
          <dt className="text-xs text-slate-500">Total</dt>
          <dd className="font-semibold text-brand-navy">{formatFcfa(order.totalAmount)}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <dt className="text-xs text-slate-500">Paiement</dt>
          <dd className="font-semibold text-brand-navy">
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <dt className="text-xs text-slate-500">Vêtements</dt>
          <dd className="font-semibold text-brand-navy">{items.length}</dd>
        </div>
      </dl>

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-1 py-2">
              <span className="font-medium text-slate-800">{item.label}</span>
              <span className="text-xs text-slate-500">
                {[item.fabricType, item.specialInstructions].filter(Boolean).join(' · ') || '—'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Changer le statut
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ORDER_FLOW.map((status) => {
            const statusMeta = ORDER_STATUSES[status]
            const isCurrent = status === order.status
            return (
              <button
                key={status}
                type="button"
                onClick={() => void onStatusChange(order.id, status)}
                aria-pressed={isCurrent}
                className={`inline-flex min-h-12 items-center justify-center rounded-xl border px-3 text-sm font-semibold transition-colors ${
                  isCurrent
                    ? 'border-brand-teal bg-brand-teal text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-brand-teal'
                }`}
              >
                {statusMeta.label}
              </button>
            )
          })}

          <button
            type="button"
            onClick={() => void onStatusChange(order.id, 'cancelled')}
            aria-pressed={order.status === 'cancelled'}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
          >
            {ORDER_STATUSES.cancelled.label}
          </button>
        </div>

        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          <QrCode size={14} aria-hidden />
          {order.synced === 1 ? 'Synchronisée' : 'Modification enregistrée localement, en attente d’envoi'}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/commandes/${order.id}`}
          className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:border-brand-teal active:bg-slate-50"
        >
          Ouvrir la fiche
          <ArrowRight size={16} aria-hidden />
        </Link>
        <DismissButton onClick={onDismiss} inline />
      </div>
    </section>
  )
}

function DismissButton({ onClick, inline = false }: { onClick: () => void; inline?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 ${
        inline ? '' : 'mt-3'
      }`}
    >
      <X size={16} aria-hidden />
      Fermer
    </button>
  )
}
