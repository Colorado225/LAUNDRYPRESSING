import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { LocalOrder } from '@/db/localDb'
import { ConflictResolutionError, keepLocalVersion, takeServerVersion } from '@/services/orderConflictService'
import { syncPendingOrders } from '@/sync/syncEngine'

/**
 * Bandeau d'arbitrage d'un conflit de synchronisation.
 *
 * Affiché uniquement quand `order.syncConflict` est renseigné, c'est-à-dire
 * quand le verrou optimiste a refusé une mise à jour parce que la commande
 * avait changé sur un autre appareil. Aucune résolution n'est automatique :
 * les deux issues possibles effacent du travail, l'utilisateur doit choisir.
 */
export default function ConflictBanner({ order }: { order: LocalOrder }) {
  const [busy, setBusy] = useState<'local' | 'serveur' | null>(null)

  if (!order.syncConflict) return null

  const run = async (choice: 'local' | 'serveur') => {
    setBusy(choice)
    try {
      if (choice === 'local') {
        await keepLocalVersion(order)
        toast.success('Vos modifications seront renvoyées au serveur.')
        void syncPendingOrders()
      } else {
        await takeServerVersion(order)
        toast.success('La version du serveur a été appliquée sur cette tablette.')
      }
    } catch (error) {
      toast.error(
        error instanceof ConflictResolutionError
          ? error.message
          : 'Arbitrage impossible : vérifiez votre connexion.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      role="alert"
      className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-900"
    >
      <p className="flex items-start gap-2 text-sm font-bold">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
        Cette commande a été modifiée sur un autre appareil
      </p>

      <p className="mt-2 text-sm leading-relaxed">
        Vos changements n’ont pas été appliqués pour ne pas écraser ceux de l’autre tablette.
        Choisissez la version à conserver :
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run('local')}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white transition-colors active:bg-rose-800 disabled:opacity-60"
        >
          {busy === 'local' && <Loader2 size={16} className="animate-spin" aria-hidden />}
          Garder mes modifications
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run('serveur')}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-bold text-rose-900 transition-colors active:bg-rose-100 disabled:opacity-60"
        >
          {busy === 'serveur' && <Loader2 size={16} className="animate-spin" aria-hidden />}
          Prendre la version du serveur
        </button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-rose-800">
        « Garder mes modifications » écrasera l’autre tablette. « Prendre la version du serveur »
        remplacera la commande sur cet appareil.
      </p>
    </section>
  )
}
