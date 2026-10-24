import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
  RefreshCw,
  Wallet,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import type { CashSessionRow } from '@/types/database'
import { getCashPaymentsForDay } from '@/db/cashRepository'
import { isSupabaseConfigured } from '@/lib/env'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { closeCashSession, fetchCashSessions, formatDifference } from '@/services/cashService'
import { syncPendingOrders } from '@/sync/syncEngine'
import { todayIso } from '@/constants/orders'

/**
 * Caisse journalière (palier 2).
 *
 * Le montant attendu est TOUJOURS recalculé par le serveur à partir des
 * encaissements enregistrés : la caisse ne fait que comparer avec les espèces
 * comptées dans le tiroir. Une différence n'est pas une erreur technique,
 * c'est une information comptable — elle est conservée, pas corrigée.
 */
export default function Caisse() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const peutGerer = can(role, 'cash.manage')

  const [jour, setJour] = useState(todayIso())
  const [declare, setDeclare] = useState('')
  const [note, setNote] = useState('')
  const [session, setSession] = useState<CashSessionRow | null>(null)
  const [historique, setHistorique] = useState<CashSessionRow[]>([])
  const [envoi, setEnvoi] = useState(false)
  const [synchronisation, setSynchronisation] = useState(false)

  const paiements =
    useLiveQuery(
      async () => (tenantId ? getCashPaymentsForDay(tenantId, jour) : []),
      [tenantId, jour],
    ) ?? []

  const transmis = paiements.filter((paiement) => paiement.synced === 1 && !paiement.lastError)
  const enAttente = paiements.filter((paiement) => paiement.synced === 0)
  const refuses = paiements.filter((paiement) => paiement.lastError)
  const totalTransmis = transmis.reduce((somme, paiement) => somme + paiement.amount, 0)
  const totalEnAttente = enAttente.reduce((somme, paiement) => somme + paiement.amount, 0)
  const totalCoffre = totalTransmis + totalEnAttente

  useEffect(() => {
    if (!tenantId || !isSupabaseConfigured) return
    let actif = true

    void fetchCashSessions(tenantId)
      .then((sessions) => {
        if (!actif) return
        setHistorique(sessions)
        setSession(sessions.find((candidate) => candidate.business_date === jour) ?? null)
      })
      .catch(() => {
        // Historique indisponible (hors ligne) : la saisie reste possible.
      })

    return () => {
      actif = false
    }
  }, [tenantId, jour])

  if (!peutGerer) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <Wallet className="mx-auto text-slate-400" size={28} aria-hidden />
        <h1 className="mt-3 text-lg font-bold text-brand-navy">Caisse réservée au comptoir</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          L’encaissement et la clôture sont réservés au propriétaire et au réceptionniste.
        </p>
      </div>
    )
  }

  const cloturer = async () => {
    const montant = Number(declare.replace(/\s/g, ''))

    if (!Number.isInteger(montant) || montant < 0) {
      toast.error('Indiquez le montant compté, en FCFA.')
      return
    }

    setEnvoi(true)
    try {
      const resultat = await closeCashSession({
        businessDate: jour,
        declaredTotal: montant,
        notes: note.trim() || null,
      })
      setSession(resultat)
      setHistorique((current) => [
        resultat,
        ...current.filter((candidate) => candidate.business_date !== resultat.business_date),
      ])
      toast.success('Caisse clôturée', { icon: '🔒' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clôture impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const synchroniser = async () => {
    setSynchronisation(true)
    try {
      const resultat = await syncPendingOrders()
      if (resultat.cashSucceeded > 0) {
        toast.success(`${resultat.cashSucceeded} encaissement(s) transmis`)
      } else if (resultat.skipped) {
        toast.error('Hors ligne : la synchronisation reprendra automatiquement.')
      } else {
        toast('Rien à transmettre.')
      }
    } finally {
      setSynchronisation(false)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
          <Wallet size={22} aria-hidden />
          Caisse
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Encaissements en espèces de la journée. Le montant attendu est calculé par le
          serveur, jamais saisi.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Journée</span>
            <input
              type="date"
              value={jour}
              max={todayIso()}
              onChange={(event) => setJour(event.target.value || todayIso())}
              className="min-h-12 rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
            />
          </label>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">Espèces du jour</p>
            <p className="text-2xl font-bold text-brand-navy">{formatFcfa(totalCoffre)}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-xs uppercase tracking-wide text-emerald-700">Transmis</p>
            <p className="text-base font-bold text-emerald-900">{formatFcfa(totalTransmis)}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="text-xs uppercase tracking-wide text-amber-700">En attente d’envoi</p>
            <p className="text-base font-bold text-amber-900">{formatFcfa(totalEnAttente)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Opérations</p>
            <p className="text-base font-bold text-slate-800">{paiements.length}</p>
          </div>
        </div>

        {enAttente.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <CloudOff size={16} aria-hidden />
              {enAttente.length} encaissement(s) pas encore transmis
            </p>
            <p className="mt-1 text-xs text-amber-800">
              La clôture doit attendre leur transmission : le serveur ne peut pas compter ce
              qu’il ne connaît pas.
            </p>
            <button
              type="button"
              onClick={() => void synchroniser()}
              disabled={synchronisation}
              className="mt-2 inline-flex min-h-12 items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 disabled:opacity-60"
            >
              {synchronisation ? (
                <Loader2 className="animate-spin" size={14} aria-hidden />
              ) : (
                <RefreshCw size={14} aria-hidden />
              )}
              Synchroniser maintenant
            </button>
          </div>
        )}

        {refuses.length > 0 && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-rose-900">
              <AlertTriangle size={16} aria-hidden />
              {refuses.length} encaissement(s) refusé(s) par le serveur
            </p>
            <ul className="mt-1 space-y-1 text-xs text-rose-800">
              {refuses.map((paiement) => (
                <li key={paiement.id}>
                  {formatFcfa(paiement.amount)} — {paiement.lastError}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Détail des encaissements
        </h2>

        {paiements.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Aucun encaissement en espèces ce jour-là.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {paiements.map((paiement) => (
              <li key={paiement.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {formatFcfa(paiement.amount)} ·{' '}
                    <Link
                      to={`/commandes/${paiement.orderId}`}
                      className="font-mono text-xs text-brand-teal underline-offset-2 hover:underline"
                    >
                      CMD-{paiement.orderId.replace(/-/g, '').slice(-6).toUpperCase()}
                    </Link>
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Intl.DateTimeFormat('fr-CI', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Africa/Abidjan',
                    }).format(new Date(paiement.receivedAt))}
                    {paiement.note ? ` · ${paiement.note}` : ''}
                  </p>
                </div>

                {paiement.lastError ? (
                  <span className="text-xs font-semibold text-rose-700">Refusé</span>
                ) : paiement.synced === 0 ? (
                  <span className="text-xs font-semibold text-amber-700">En attente</span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 size={13} aria-hidden />
                    Transmis
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Clôture du {formatDateFr(`${jour}T00:00:00Z`)}
        </h2>

        {session ? (
          <div className="mt-3 space-y-2">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Attendu (serveur)</p>
                <p className="text-base font-bold text-brand-navy">
                  {formatFcfa(session.expected_total)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Déclaré</p>
                <p className="text-base font-bold text-brand-navy">
                  {formatFcfa(session.declared_total)}
                </p>
              </div>
              <div
                className={`rounded-xl p-3 ${
                  session.difference === 0 ? 'bg-emerald-50' : 'bg-rose-50'
                }`}
              >
                <p
                  className={`text-xs uppercase tracking-wide ${
                    session.difference === 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  Écart
                </p>
                <p
                  className={`text-base font-bold ${
                    session.difference === 0 ? 'text-emerald-900' : 'text-rose-900'
                  }`}
                >
                  {formatDifference(session.difference)} FCFA
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Clôturée le {formatDateFr(session.closed_at)}
              {session.notes ? ` · ${session.notes}` : ''}
            </p>

            <button
              type="button"
              onClick={() => setSession(null)}
              className="inline-flex min-h-12 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700"
            >
              Corriger la clôture
            </button>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Espèces comptées dans le tiroir
              </span>
              <input
                type="number"
                min={0}
                step={25}
                inputMode="numeric"
                value={declare}
                onChange={(event) => setDeclare(event.target.value)}
                placeholder={String(totalCoffre)}
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Note (facultatif)
              </span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Manque, erreur de rendu…"
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
              />
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void cloturer()}
                disabled={envoi || enAttente.length > 0 || !navigator.onLine || !isSupabaseConfigured}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {envoi ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}
                Clôturer
              </button>
            </div>
          </div>
        )}

        {!navigator.onLine && (
          <p className="mt-3 text-xs font-semibold text-amber-800">
            Hors ligne : la clôture de caisse nécessite une connexion.
          </p>
        )}
      </section>

      {historique.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Clôtures précédentes
          </h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {historique.slice(0, 10).map((entree) => (
              <li key={entree.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm font-semibold text-slate-800">
                  {formatDateFr(`${entree.business_date}T00:00:00Z`)}
                </span>
                <span className="text-sm text-slate-600">
                  Attendu {formatFcfa(entree.expected_total)} · déclaré{' '}
                  {formatFcfa(entree.declared_total)}
                  {entree.refunded_total > 0 && (
                    <span className="text-rose-700">
                      {' '}· dont −{formatFcfa(entree.refunded_total)} remboursés
                    </span>
                  )}
                </span>
                <span
                  className={`text-sm font-bold ${
                    entree.difference === 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {formatDifference(entree.difference)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
