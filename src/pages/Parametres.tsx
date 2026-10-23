import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2,
  CheckCircle2,
  Copy,
  CreditCard,
  Database,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { usePendingOrderCount } from '@/db/hooks'
import { TENANT_ROLE_LABELS } from '@/constants/orders'
import { isSupabaseConfigured } from '@/lib/env'
import { formatDateTimeFr } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { useSyncStore } from '@/stores/syncStore'
import { syncPendingOrders } from '@/sync/syncEngine'

/**
 * Paramètres — écran 12 de la maquette, version basique.
 *
 * Volontairement en **lecture seule** : on y vérifie *qui* est connecté, *sur
 * quel pressing*, et *ce qui reste à synchroniser*. Modifier le nom du pressing
 * ou gérer l'équipe se fait déjà ailleurs (`/abonnement` pour la formule,
 * console de supervision pour les comptes) — dupliquer ces actions ici
 * multiplierait les chemins d'écriture pour aucun gain.
 */
export default function Parametres() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const tenantName = useTenantStore((state) => state.tenantName)
  const role = useTenantStore((state) => state.role)
  const userId = useTenantStore((state) => state.userId)
  const shops = useTenantStore((state) => state.shops)

  const syncState = useSyncStore((state) => state.state)
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt)
  const lastError = useSyncStore((state) => state.lastError)
  const pendingCount = usePendingOrderCount()

  const [email, setEmail] = useState<string | null>(null)
  const [enLigne, setEnLigne] = useState(() => navigator.onLine)
  const [synchronisation, setSynchronisation] = useState(false)

  useEffect(() => {
    const goOnline = () => setEnLigne(true)
    const goOffline = () => setEnLigne(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let actif = true
    void getSupabaseClient()
      .auth.getUser()
      .then(({ data }) => {
        if (actif) setEmail(data.user?.email ?? null)
      })
      .catch(() => undefined)

    return () => {
      actif = false
    }
  }, [])

  const copier = async (valeur: string, libelle: string) => {
    try {
      await navigator.clipboard.writeText(valeur)
      toast.success(`${libelle} copié`, { icon: '📋' })
    } catch {
      toast.error('Copie impossible sur cet appareil.')
    }
  }

  const synchroniser = async () => {
    setSynchronisation(true)
    try {
      await syncPendingOrders()
      toast.success('Synchronisation terminée', { icon: '🔄' })
    } catch {
      toast.error('Synchronisation impossible : vérifiez votre connexion.')
    } finally {
      setSynchronisation(false)
    }
  }

  const libelleSync =
    syncState === 'syncing'
      ? 'Envoi en cours'
      : syncState === 'error'
        ? 'Échec de synchronisation'
        : !enLigne
          ? 'Hors ligne'
          : pendingCount > 0
            ? `${pendingCount} commande${pendingCount > 1 ? 's' : ''} en attente`
            : 'Tout est synchronisé'

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
          <ShieldCheck size={22} aria-hidden /> Paramètres
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Compte connecté, pressing, synchronisation et application.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------------------------------------------------------- Pressing */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <Building2 size={16} aria-hidden /> Pressing
          </h2>

          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Nom</dt>
              <dd className="font-semibold text-slate-800">{tenantName ?? 'Non sélectionné'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Identifiant (à communiquer au support)</dt>
              <dd className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700">
                  {tenantId ?? '—'}
                </code>
                {tenantId && (
                  <button
                    type="button"
                    onClick={() => void copier(tenantId, 'Identifiant')}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-600"
                  >
                    <Copy size={14} aria-hidden /> Copier
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Boutiques rattachées à ce compte</dt>
              <dd className="font-semibold text-slate-800">{shops.length || 1}</dd>
            </div>
          </dl>
        </section>

        {/* ----------------------------------------------------------- Compte */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <UserRound size={16} aria-hidden /> Compte
          </h2>

          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Rôle sur ce pressing</dt>
              <dd className="font-semibold text-slate-800">
                {role ? TENANT_ROLE_LABELS[role] : 'Inconnu'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Adresse e-mail</dt>
              <dd className="font-semibold text-slate-800">{email ?? 'Non communiquée'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Identifiant du compte</dt>
              <dd className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700">
                  {userId ?? 'Mode démonstration'}
                </code>
                {userId && (
                  <button
                    type="button"
                    onClick={() => void copier(userId, 'Identifiant du compte')}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-600"
                  >
                    <Copy size={14} aria-hidden /> Copier
                  </button>
                )}
              </dd>
            </div>
          </dl>

          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            Le mot de passe se change depuis le lien reçu par e-mail (écran de connexion →
            « Recevoir un lien de réinitialisation »). L’ajout d’un collègue se fait par le
            propriétaire ou depuis la console de supervision.
          </p>
        </section>

        {/* -------------------------------------------------- Synchronisation */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <Database size={16} aria-hidden /> Synchronisation
          </h2>

          <div className="mt-3 flex items-start gap-3">
            <span
              className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${
                enLigne ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {enLigne ? <Wifi size={18} aria-hidden /> : <WifiOff size={18} aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-slate-800">{libelleSync}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {enLigne ? 'Connexion active' : 'Aucune connexion : tout reste sur la tablette'}
              </p>
              {lastSyncedAt && (
                <p className="mt-1 text-xs text-slate-500">
                  Dernière synchronisation : {formatDateTimeFr(lastSyncedAt)}
                </p>
              )}
              {lastError && (
                <p className="mt-1 text-xs text-rose-700">Dernière erreur : {lastError}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void synchroniser()}
            disabled={synchronisation || !enLigne}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {synchronisation ? (
              <Loader2 className="animate-spin" size={16} aria-hidden />
            ) : (
              <RefreshCw size={16} aria-hidden />
            )}
            Synchroniser maintenant
          </button>
        </section>

        {/* ------------------------------------------------------- Application */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <HardDrive size={16} aria-hidden /> Application
          </h2>

          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
              Les commandes restent consultables hors ligne sur cet appareil.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
              Mode {isSupabaseConfigured ? 'connecté à Supabase' : 'démonstration (Supabase non configuré)'}.
            </li>
          </ul>

          {can(role, 'subscription.view') && (
            <Link
              to="/abonnement"
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-teal px-3 text-sm font-bold text-white"
            >
              <CreditCard size={16} aria-hidden /> Voir l’abonnement
            </Link>
          )}

          <p className="mt-3 text-xs text-slate-400">
            Pressing Pro — application installable (PWA), utilisable hors ligne.
          </p>
        </section>
      </div>
    </div>
  )
}
