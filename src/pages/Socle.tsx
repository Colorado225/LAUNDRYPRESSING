import { useEffect, useState } from 'react'
import {
  BadgeCheck,
  CheckCircle2,
  CircleDashed,
  Database,
  HardDriveDownload,
  Loader2,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import { isSupabaseConfigured, maskSupabaseUrl, missingSupabaseEnvVars, SUPABASE_URL } from '@/lib/env'
import { useTenantStore } from '@/lib/tenantContext'
import { ORDER_STATUSES, ORDER_FLOW } from '@/constants/orders'

/**
 * Page de diagnostic temporaire de la Phase 1.
 *
 * Elle n'a pas vocation à rester : elle sera remplacée par l'écran de
 * connexion (phase 5) puis par le tableau de bord. Elle permet de vérifier
 * d'un coup d'œil que le socle technique est opérationnel.
 */

type ServiceWorkerState = 'vérification' | 'actif' | 'inactif' | 'non-supporté'

const PHASES = [
  { label: 'Phase 0 — Audit du template', done: true },
  { label: 'Phase 1 — Socle technique', done: true },
  { label: 'Phase 2 — Couche offline-first', done: false },
  { label: 'Phase 3 — Module QR Code', done: false },
  { label: 'Phase 4 — Paiement Mobile Money', done: false },
  { label: 'Phase 5 — Finalisation PWA & UX', done: false },
  { label: 'Phase 6 — QA et livraison MVP', done: false },
]

export default function Socle() {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine)
  const [swState, setSwState] = useState<ServiceWorkerState>(() =>
    'serviceWorker' in navigator ? 'vérification' : 'non-supporté',
  )
  const tenantName = useTenantStore((state) => state.tenantName)
  const role = useTenantStore((state) => state.role)

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

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let active = true
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (!active) return
      setSwState(registration?.active ? 'actif' : 'inactif')
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* En-tête */}
      <header className="bg-brand-navy px-5 pb-10 pt-8 text-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-teal">
                MVP · Côte d&apos;Ivoire
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">Pressing Pro</h1>
              <p className="mt-2 max-w-md text-sm text-slate-300">
                Socle technique installé. Les modules métier (commandes, QR Code, atelier hors
                ligne, Mobile Money) arrivent dans les phases suivantes.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium">
              {online ? (
                <>
                  <Wifi size={14} aria-hidden /> En ligne
                </>
              ) : (
                <>
                  <WifiOff size={14} aria-hidden /> Hors ligne
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-6 flex max-w-3xl flex-col gap-4 px-4 sm:px-5">
        {/* Supabase */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-teal/10 text-brand-teal">
              <Database size={20} aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold text-brand-navy">Base de données Supabase</h2>
              <p className="text-sm text-slate-500">
                Client initialisé et migration multi-tenant prête à être appliquée.
              </p>
            </div>
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500">État</dt>
              <dd className="font-medium">
                {isSupabaseConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700">
                    <BadgeCheck size={16} aria-hidden /> Configuré
                  </span>
                ) : (
                  <span className="text-amber-700">Variables manquantes</span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500">URL du projet</dt>
              <dd className="font-mono text-xs text-slate-700">
                {SUPABASE_URL ? maskSupabaseUrl(SUPABASE_URL) : '—'}
              </dd>
            </div>
          </dl>

          {!isSupabaseConfigured && (
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              Renseignez{' '}
              <code className="font-mono font-semibold">{missingSupabaseEnvVars.join(' et ')}</code>{' '}
              dans le fichier <code className="font-mono">.env</code> (modèle disponible dans{' '}
              <code className="font-mono">.env.example</code>), puis redémarrez{' '}
              <code className="font-mono">npm run dev</code>.
            </p>
          )}
        </section>

        {/* PWA + tenant */}
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-navy/5 text-brand-navy">
                <Smartphone size={20} aria-hidden />
              </span>
              <h2 className="text-base font-semibold text-brand-navy">Application installable</h2>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Manifeste, icônes 192/512 et service worker générés au build.
            </p>
            <p className="mt-3 flex items-center gap-2 text-sm font-medium">
              {swState === 'vérification' && <Loader2 className="animate-spin" size={16} />}
              {swState === 'actif' && (
                <>
                  <CheckCircle2 className="text-emerald-600" size={16} aria-hidden />
                  <span className="text-emerald-700">Service worker actif</span>
                </>
              )}
              {swState === 'inactif' && (
                <span className="text-slate-500">
                  Inactif en développement (actif après <code className="font-mono">npm run build</code>)
                </span>
              )}
              {swState === 'non-supporté' && <span className="text-slate-500">Non supporté</span>}
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-navy/5 text-brand-navy">
                <HardDriveDownload size={20} aria-hidden />
              </span>
              <h2 className="text-base font-semibold text-brand-navy">Pressing courant</h2>
            </div>
            {tenantName ? (
              <>
                <p className="mt-3 text-sm font-medium text-slate-800">{tenantName}</p>
                <p className="text-sm capitalize text-slate-500">{role}</p>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Aucun pressing rattaché : la connexion sera branchée en phase 5.
              </p>
            )}
          </section>
        </div>

        {/* Formats CI */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-brand-navy">Formats locaux</h2>
          <p className="mt-1 text-sm text-slate-500">
            Montants en francs CFA entiers, dates au format ivoirien.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[1500, 27500, 120000].map((amount) => (
              <div key={amount} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Montant</p>
                <p className="text-lg font-semibold text-brand-navy">{formatFcfa(amount)}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Aujourd&apos;hui : <span className="font-medium">{formatDateFr(new Date())}</span>
          </p>
        </section>

        {/* Statuts */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-brand-navy">Cycle de vie d&apos;une commande</h2>
          <ol className="mt-4 flex flex-wrap items-center gap-2">
            {ORDER_FLOW.map((status, index) => {
              const meta = ORDER_STATUSES[status]
              return (
                <li key={status} className="flex items-center gap-2">
                  <span
                    className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </span>
                  {index < ORDER_FLOW.length - 1 && (
                    <span className="text-slate-300" aria-hidden>
                      →
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
          <p className="mt-3 text-sm text-slate-500">
            Statut hors parcours : <span className="font-medium">{ORDER_STATUSES.cancelled.label}</span>.
          </p>
        </section>

        {/* Avancement */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-brand-navy">Avancement du projet</h2>
          <ul className="mt-4 space-y-2">
            {PHASES.map((phase) => (
              <li key={phase.label} className="flex items-center gap-2.5 text-sm">
                {phase.done ? (
                  <CheckCircle2 className="shrink-0 text-emerald-600" size={18} aria-hidden />
                ) : (
                  <CircleDashed className="shrink-0 text-slate-300" size={18} aria-hidden />
                )}
                <span className={phase.done ? 'font-medium text-slate-800' : 'text-slate-500'}>
                  {phase.label}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="px-1 text-center text-xs text-slate-400">
          Page de diagnostic temporaire — supprimée en phase 2.
        </p>
      </main>
    </div>
  )
}
