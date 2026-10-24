import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CloudOff, HelpCircle, Loader2, RefreshCw } from 'lucide-react'
import { usePendingSyncCount } from '@/db/hooks'
import { getSavedLastSyncAt, useSyncStore } from '@/stores/syncStore'
import { useTenantStore } from '@/lib/tenantContext'
import { formatDateTimeFr } from '@/lib/formatters'
import { syncPendingOrders } from '@/sync/syncEngine'

/**
 * Indicateur d'état de la synchronisation.
 *
 * Code couleur imposé par le cahier des charges :
 *  - vert  : tout est synchronisé
 *  - orange: hors ligne (les commandes restent enregistrées localement)
 *  - rouge : au moins une synchronisation a échoué
 *
 * Lisible sans couleur (icône + texte) : exigence d'accessibilité, une partie
 * des utilisateurs d'atelier est daltonienne.
 */
export default function OfflineBadge({ compact = false }: { compact?: boolean }) {
  const [online, setOnline] = useState(() => navigator.onLine)
  const tenantId = useTenantStore((store) => store.tenantId)
  const state = useSyncStore((store) => store.state)
  const lastError = useSyncStore((store) => store.lastError)
  const lastSyncedAtInMemory = useSyncStore((store) => store.lastSyncedAt)
  const lastSyncedTenantId = useSyncStore((store) => store.lastSyncedTenantId)
  const pendingCount = usePendingSyncCount()
  const [manualSync, setManualSync] = useState(false)
  const lastSyncedAt = lastSyncedTenantId === tenantId
    ? lastSyncedAtInMemory
    : getSavedLastSyncAt(tenantId)
  const lastSyncDate = lastSyncedAt ? new Date(lastSyncedAt) : null
  const lastSyncLabel = lastSyncDate && Number.isFinite(lastSyncDate.getTime())
    ? `Dernière synchro : ${formatDateTimeFr(lastSyncDate.toISOString())}`
    : 'Aucune synchronisation réussie pour ce pressing'

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const effectiveState = !online
    ? 'offline'
    : state === 'idle' && pendingCount > 0
      ? 'pending'
      : state

  const visuals = {
    idle: {
      icon: <CheckCircle2 size={16} aria-hidden />,
      label: 'Synchronisé',
      classes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    },
    pending: {
      icon: <RefreshCw size={16} aria-hidden />,
      label: 'En attente d’envoi',
      classes: 'bg-amber-50 text-amber-900 border-amber-200',
    },
    syncing: {
      icon: <Loader2 size={16} className="animate-spin" aria-hidden />,
      label: 'Synchronisation…',
      classes: 'bg-sky-50 text-sky-800 border-sky-200',
    },
    offline: {
      icon: <CloudOff size={16} aria-hidden />,
      label: 'Hors ligne',
      classes: 'bg-amber-50 text-amber-900 border-amber-200',
    },
    error: {
      icon: <AlertTriangle size={16} aria-hidden />,
      label: 'Erreur de synchro',
      classes: 'bg-rose-50 text-rose-800 border-rose-200',
    },
  } as const

  const visual = visuals[effectiveState]
  const pendingLabel = pendingCount > 0
    ? `${pendingCount} élément${pendingCount > 1 ? 's' : ''} en attente`
    : compact ? '' : 'Aucune donnée en attente'

  const handleManualSync = async () => {
    setManualSync(true)
    try {
      await syncPendingOrders()
    } finally {
      setManualSync(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${visual.classes}`}
        // Annonce les changements d'état aux lecteurs d'écran
        role="status"
        aria-live="polite"
        title={lastError ?? undefined}
      >
        {visual.icon}
        <span>{visual.label}</span>
        {pendingLabel && <span className="font-normal opacity-80">· {pendingLabel}</span>}
      </span>

      {(pendingCount > 0 || effectiveState === 'error') && online && (
        <button
          type="button"
          onClick={() => void handleManualSync()}
          disabled={manualSync || state === 'syncing'}
          className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={manualSync ? 'animate-spin' : undefined} aria-hidden />
          Synchroniser
        </button>
      )}

      {!online && (
        <Link
          to="/offline"
          className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 active:bg-amber-50"
        >
          <HelpCircle size={14} aria-hidden />
          Aide
        </Link>
      )}

      </div>
      <span className={`text-[11px] ${compact ? 'sr-only' : 'text-slate-500'}`}>
        {lastSyncLabel}
      </span>
      {lastError && (
        <span role="alert" className="max-w-full text-xs text-rose-700">
          Échec : {lastError} {online ? 'Vous pouvez réessayer avec « Synchroniser ».' : 'Le nouvel essai reprendra au retour du réseau.'}
        </span>
      )}
    </div>
  )
}
