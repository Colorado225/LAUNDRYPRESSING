import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  History,
  Keyboard,
  Loader2,
  QrCode,
  LayoutGrid,
  List,
  ScanLine,
  Search,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { formatGarmentComposition } from '@/constants/garmentTypes'
import QrScanner from '@/components/QrScanner'
import KanbanBoard from '@/components/workshop/KanbanBoard'
import { useAllLocalItems } from '@/db/hooks'
import { useDemoStore } from '@/lib/demoMode'
import { useUpdateOrderStatus } from '@/db/hooks'
import { findOrderByQrCode, getOrderWithItems, getWorkshopOrders } from '@/db/ordersRepository'
import type { LocalOrderWithItems } from '@/db/ordersRepository'
import { useTenantStore } from '@/lib/tenantContext'
import {
  ACTIVE_ORDER_STATUSES,
  ORDER_FLOW,
  ORDER_STATUSES,
  PAYMENT_STATUS_LABELS,
  allowedStatusTargets,
  isOrderLate,
  todayIso,
} from '@/constants/orders'
import { formatDateFr, formatDateTimeFr, formatFcfa } from '@/lib/formatters'
import { shortOrderReference } from '@/services/qrService'
import type { OrderStatus } from '@/types/database'

/**
 * Atelier — scan des étiquettes et avancement des commandes (phase 3).
 *
 * Tout fonctionne hors ligne : la recherche se fait dans Dexie et le changement
 * de statut est écrit localement puis synchronisé (phase 2).
 */

/** Ligne de l'historique des derniers scans de la session. */
interface ScanEntry {
  code: string
  /** Heure du scan, déjà formatée pour l'affichage. */
  at: string
  /** Nom du client, ou `null` quand le code n'a rien donné. */
  client: string | null
  status: string
}

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
  const [workshopSearch, setWorkshopSearch] = useState('')
  const [workshopStatusFilter, setWorkshopStatusFilter] = useState<OrderStatus | 'all'>('all')
  /**
   * Vue par défaut : le Kanban. C'est la vue de pilotage demandée par la
   * maquette ; la liste reste à un clic pour l'usage « je cherche une
   * commande précise dans la file ».
   */
  const [vue, setVue] = useState<'kanban' | 'liste'>('kanban')
  /** Commande dont le statut est en cours d'enregistrement (verrou visuel). */
  const [transition, setTransition] = useState<string | null>(null)
  const demo = useDemoStore((state) => state.actif)
  // Rôle effectif : il décide des transitions proposées sur chaque carte.
  const roleAtelier = useTenantStore((state) => state.role)
  // Historique de session : il n'est pas persisté (l'atelier enchaîne les
  // scans, la tablette redémarre, l'écran « Commandes en atelier » reste la
  // vue durable). Il sert à rattraper un scan raté sans re-scanner.
  const [historique, setHistorique] = useState<ScanEntry[]>([])

  const workshopOrders = useLiveQuery(async () => {
    if (!tenantId) return []
    return getWorkshopOrders(tenantId)
  }, [tenantId])
  const aujourdhui = todayIso()
  const tousLesArticles = useAllLocalItems()

  /** Nombre de pièces par commande, pour les cartes du Kanban. */
  const piecesParCommande = useMemo(() => {
    const compte = new Map<string, number>()
    for (const item of tousLesArticles ?? []) {
      compte.set(item.orderId, (compte.get(item.orderId) ?? 0) + (item.quantity ?? 1))
    }
    return compte
  }, [tousLesArticles])
  const filteredWorkshopOrders = useMemo(() => {
    if (!workshopOrders) return []
    const query = workshopSearch.trim().toLowerCase()
    const phoneQuery = query.replace(/\D/g, '')
    return workshopOrders
      .filter((order) => {
        if (workshopStatusFilter !== 'all' && order.status !== workshopStatusFilter) return false
        if (!query) return true
        return order.customerName.toLowerCase().includes(query) ||
          shortOrderReference(order.id).toLowerCase().includes(query) ||
          (phoneQuery.length > 0 && order.customerPhone.replace(/\D/g, '').includes(phoneQuery))
      })
      .sort((a, b) => {
        const aLate = isOrderLate(a, aujourdhui)
        const bLate = isOrderLate(b, aujourdhui)
        if (aLate !== bLate) return aLate ? -1 : 1
        const dueDateOrder = (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')
        if (dueDateOrder !== 0) return dueDateOrder
        return a.createdAt.localeCompare(b.createdAt)
      })
  }, [workshopOrders, workshopSearch, workshopStatusFilter, aujourdhui])

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
          setHistorique((entrees) => [
            { code: trimmed, at: formatDateTimeFr(new Date().toISOString()), client: null, status: 'Introuvable' },
            ...entrees,
          ].slice(0, 5))
          return
        }
        if ('foreignTenantId' in found) {
          setOutcome({ kind: 'foreign-tenant' })
          return
        }

        setOutcome({ kind: 'found', data: found })
        setHistorique((entrees) => [
          {
            code: trimmed,
            at: formatDateTimeFr(new Date().toISOString()),
            client: found.order.customerName,
            status: ORDER_STATUSES[found.order.status].label,
          },
          ...entrees,
        ].slice(0, 5))
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
    if (demo) {
      // La démonstration ne doit jamais modifier une vraie commande.
      toast.error('Mode démonstration : le changement de statut est désactivé.')
      return
    }
    if (
      status === 'cancelled' &&
      !window.confirm('Annuler cette commande ? Cette action sera synchronisée avec le pressing.')
    ) return

    setTransition(orderId)
    try {
      await updateStatus(orderId, status)
      toast.success(`Statut « ${ORDER_STATUSES[status].label} » enregistré sur la tablette.`, { icon: '✅' })
      // Rafraîchit la fiche affichée à partir de la base locale
      const refreshed = await getOrderWithItems(orderId)
      if (refreshed) {
        setOutcome({ kind: 'found', data: refreshed })
        setHistorique((entrees) =>
          entrees.map((entree) =>
            entree.client === refreshed.order.customerName
              ? { ...entree, status: ORDER_STATUSES[status].label }
              : entree,
          ),
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise à jour impossible')
    } finally {
      setTransition(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-navy sm:text-2xl">
            Suivi des commandes (Atelier)
          </h1>
          <p className="text-sm text-slate-500">
            Gérez le flux de vos commandes, ou scannez une étiquette pour faire avancer sa fiche.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Bascule de vue : le Kanban pour piloter, la liste pour chercher. */}
          <div
            role="group"
            aria-label="Mode d’affichage de la file d’atelier"
            className="inline-flex overflow-hidden rounded-xl border border-input bg-card"
          >
            <button
              type="button"
              onClick={() => setVue('kanban')}
              aria-pressed={vue === 'kanban'}
              className={`inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-semibold ${
                vue === 'kanban' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <LayoutGrid size={15} aria-hidden /> Kanban
            </button>
            <button
              type="button"
              onClick={() => setVue('liste')}
              aria-pressed={vue === 'liste'}
              className={`inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-semibold ${
                vue === 'liste' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <List size={15} aria-hidden /> Liste
            </button>
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
        <p className="mt-2 text-xs text-slate-500">
          Utile si l’étiquette est abîmée ou si la caméra de la tablette ne fonctionne pas.
        </p>
      </section>

      {/* Résultat du scan */}
      <ScanResult
        outcome={outcome}
        onStatusChange={changeStatus}
        onDismiss={() => setOutcome({ kind: 'idle' })}
      />

      {/* Derniers scans de la session */}
      {historique.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <History size={16} aria-hidden /> Derniers scans
          </h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {historique.map((entree, index) => (
              <li
                key={`${entree.code}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-800">
                    {entree.client ?? 'Aucune commande'}
                  </span>
                  <span className="block font-mono text-xs text-slate-400">{entree.code}</span>
                </span>
                <span className="text-right">
                  <span className="block text-xs font-semibold text-slate-600">
                    {entree.status}
                  </span>
                  <span className="block text-xs text-slate-400">{entree.at}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Commandes en atelier */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Commandes en atelier
            {workshopOrders && workshopOrders.length > 0 ? ` (${workshopOrders.length})` : ''}
          </h2>
          {workshopOrders && workshopOrders.length > 0 && (
            <p className="text-xs text-slate-500">Retards et échéances proches affichés en premier.</p>
          )}
        </div>

        {workshopOrders === undefined ? (
          <p className="flex items-center gap-2 py-6 text-sm text-slate-500" role="status">
            <Loader2 className="animate-spin" size={16} aria-hidden />
            Chargement…
          </p>
        ) : workshopOrders.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-500">
            Aucune commande en cours de traitement.
          </p>
        ) : (
          <>
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
              <div className="relative">
                <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  type="search"
                  value={workshopSearch}
                  onChange={(event) => setWorkshopSearch(event.target.value)}
                  placeholder="Client, téléphone ou référence…"
                  aria-label="Rechercher une commande en atelier"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-base outline-none focus:border-brand-teal"
                />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrer les commandes par étape">
                <button
                  type="button"
                  aria-pressed={workshopStatusFilter === 'all'}
                  onClick={() => setWorkshopStatusFilter('all')}
                  className={`min-h-12 shrink-0 rounded-xl border px-3 text-sm font-semibold ${workshopStatusFilter === 'all' ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  Toutes ({workshopOrders.length})
                </button>
                {ACTIVE_ORDER_STATUSES.map((status) => {
                  const count = workshopOrders.filter((order) => order.status === status).length
                  return (
                    <button
                      key={status}
                      type="button"
                      aria-label={`Filtrer : ${ORDER_STATUSES[status].label}, ${count} commande(s)`}
                      aria-pressed={workshopStatusFilter === status}
                      onClick={() => setWorkshopStatusFilter(status)}
                      className={`min-h-12 shrink-0 rounded-xl border px-3 text-sm font-semibold ${workshopStatusFilter === status ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                    >
                      {ORDER_STATUSES[status].shortLabel} ({count})
                    </button>
                  )
                })}
              </div>
            </div>

            {vue === 'kanban' ? (
              <KanbanBoard
                commandes={filteredWorkshopOrders}
                piecesParCommande={piecesParCommande}
                role={roleAtelier}
                aujourdhui={aujourdhui}
                transition={transition}
                demo={demo}
                onChangerStatut={changeStatus}
              />
            ) : filteredWorkshopOrders.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-6 text-center" role="status">
                <p className="font-semibold text-slate-700">Aucune commande ne correspond à ces critères.</p>
                <button
                  type="button"
                  onClick={() => {
                    setWorkshopSearch('')
                    setWorkshopStatusFilter('all')
                  }}
                  className="mt-2 inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-sm font-semibold text-brand-teal underline underline-offset-2"
                >
                  Effacer les filtres
                </button>
              </div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {filteredWorkshopOrders.map((order) => {
                  const meta = ORDER_STATUSES[order.status]
                  const late = isOrderLate(order, aujourdhui)
                  return (
                    <li key={order.id}>
                      <Link
                        to={`/commandes/${order.id}`}
                        className="flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-teal active:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-brand-navy">{order.customerName}</p>
                          <p className="text-xs text-slate-600">
                            <span className="font-mono">{shortOrderReference(order.id)}</span> · {order.customerPhone}
                          </p>
                          <p className="text-xs text-slate-400">Mis à jour {formatDateTimeFr(order.updatedAt)}</p>
                          {order.dueDate && (
                            <p className={`mt-1 text-xs font-semibold ${late ? 'text-rose-700' : 'text-slate-600'}`}>
                              À remettre : {formatDateFr(order.dueDate)}{late ? ' · En retard' : ''}
                            </p>
                          )}
                        </div>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${meta.badgeClass}`}>
                            {meta.label}
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
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
  // Appelé avant tout retour anticipé : les règles des hooks l'exigent.
  const role = useTenantStore((state) => state.role)

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
  const cibles = allowedStatusTargets(order.status, role)
  const nextStatus = ORDER_FLOW.find((status) => ORDER_STATUSES[status].step === (meta.step ?? 0) + 1)
  const primaryNextStatus = nextStatus && cibles.includes(nextStatus) ? nextStatus : null

  return (
    <section className="rounded-2xl border-2 border-brand-teal/40 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-brand-teal">
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

      {meta.step !== null && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Progression</span>
            <span className="font-bold text-brand-navy">Étape {meta.step} sur {ORDER_FLOW.length} · {meta.label}</span>
          </div>
          <div
            className="mt-2 grid grid-cols-8 gap-1"
            role="progressbar"
            aria-label="Avancement de la commande"
            aria-valuemin={0}
            aria-valuemax={ORDER_FLOW.length}
            aria-valuenow={meta.step}
            aria-valuetext={`Étape ${meta.step} sur ${ORDER_FLOW.length} : ${meta.label}`}
          >
            {ORDER_FLOW.map((status) => (
              <span
                key={status}
                aria-hidden="true"
                className={`h-2 rounded-full ${
                  (ORDER_STATUSES[status].step ?? 0) <= meta.step!
                    ? 'bg-brand-teal'
                    : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-600">{meta.description}</p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-1 py-2">
              <span className="font-medium text-slate-800">
                {item.label}
                {item.serviceName && item.serviceName !== item.label && <span className="block text-xs text-slate-600">Prestation : {item.serviceName}</span>}
                {item.activityNameSnapshot && <span className="block text-xs text-slate-600">Activité : {item.activityNameSnapshot}</span>}
                {formatGarmentComposition(item.garmentDetails) && <span className="block text-xs text-slate-600">Vêtements : {formatGarmentComposition(item.garmentDetails)}</span>}
              </span>
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
        {primaryNextStatus && (
          <button
            type="button"
            onClick={() => void onStatusChange(order.id, primaryNextStatus)}
            className="mt-2 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 text-base font-bold text-white hover:bg-brand-teal-dark active:bg-brand-teal-dark"
          >
            <CheckCircle2 size={18} aria-hidden />
            Étape suivante : {ORDER_STATUSES[primaryNextStatus].label}
          </button>
        )}
        {cibles.some((status) => status !== primaryNextStatus) && (
          <p className="mt-3 text-xs font-semibold text-slate-500">Autres changements possibles</p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {cibles.filter((status) => status !== primaryNextStatus && status !== 'cancelled').map((status) => {
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

          {cibles.includes('cancelled') && (
            <button
              type="button"
              onClick={() => void onStatusChange(order.id, 'cancelled')}
              aria-pressed={order.status === 'cancelled'}
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
            >
              {ORDER_STATUSES.cancelled.label}
            </button>
          )}
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
