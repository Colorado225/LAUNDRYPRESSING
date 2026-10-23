import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, CreditCard, Loader2, ShieldAlert, Sparkles } from 'lucide-react'
import { useSubscriptionStore } from '@/lib/subscriptionContext'
import { useTenantStore } from '@/lib/tenantContext'
import { can } from '@/lib/permissions'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import { isSupabaseConfigured } from '@/lib/env'
import {
  SUBSCRIPTION_STATE_LABELS,
  fetchPlans,
  formatPlan,
  isReadOnly,
  subscriptionNotice,
  type PlanChoice,
} from '@/services/subscriptionService'

/**
 * Abonnement du pressing (palier 4).
 *
 * Aucun paiement en ligne : le règlement se fait auprès de l'éditeur, qui
 * enregistre ensuite la période réglée. Cet écran sert donc à **comprendre** sa
 * situation (formule, échéance, droits) et à contacter le support — pas à
 * acheter.
 */
export default function Abonnement() {
  const role = useTenantStore((state) => state.role)
  const tenantName = useTenantStore((state) => state.tenantName)
  const snapshot = useSubscriptionStore((state) => state.snapshot)
  const loading = useSubscriptionStore((state) => state.loading)
  const refresh = useSubscriptionStore((state) => state.refresh)
  const [plans, setPlans] = useState<PlanChoice[]>([])
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let actif = true
    void refresh()

    void fetchPlans()
      .then((liste) => {
        if (actif) setPlans(liste)
      })
      .catch(() => {
        if (actif) setErreur('Formules indisponibles : vérifiez votre connexion.')
      })

    return () => {
      actif = false
    }
  }, [refresh])

  if (!can(role, 'subscription.view')) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <ShieldAlert className="mx-auto text-slate-400" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-slate-800">Accès réservé</p>
        <p className="mt-1 text-sm text-slate-500">
          Seul le propriétaire consulte l’abonnement du pressing.
        </p>
      </div>
    )
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <CreditCard className="mx-auto text-slate-400" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-slate-800">Mode démonstration</p>
        <p className="mt-1 text-sm text-slate-500">
          L’abonnement est géré par l’éditeur et nécessite un projet Supabase configuré.
        </p>
      </div>
    )
  }

  const notice = subscriptionNotice(snapshot, new Date().toISOString().slice(0, 10))

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
          <CreditCard size={22} aria-hidden /> Abonnement
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {tenantName ?? 'Pressing'} · formule, échéance et droits d’écriture
        </p>
      </header>

      {loading && !snapshot && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} aria-hidden /> Lecture de l’abonnement…
        </p>
      )}

      {notice && (
        <p
          className={`rounded-xl border p-3 text-sm ${
            notice.tone === 'blocage'
              ? 'border-rose-300 bg-rose-50 text-rose-900'
              : notice.tone === 'alerte'
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-sky-200 bg-sky-50 text-sky-900'
          }`}
        >
          {notice.text}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        {snapshot ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Formule actuelle
                </p>
                <p className="mt-1 text-lg font-bold text-brand-navy">{formatPlan(snapshot)}</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  isReadOnly(snapshot)
                    ? 'bg-rose-100 text-rose-800'
                    : snapshot.state === 'grace'
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {SUBSCRIPTION_STATE_LABELS[snapshot.state]}
              </span>
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                  <CalendarClock size={14} aria-hidden /> Fin de période
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {snapshot.current_period_end
                    ? formatDateFr(snapshot.current_period_end)
                    : 'Non communiquée'}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Comptes autorisés</dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {snapshot.max_users === null || snapshot.max_users === undefined
                    ? 'Illimités'
                    : snapshot.max_users}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Boutiques couvertes</dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {snapshot.max_shops ?? 1}
                </dd>
              </div>
            </dl>

            {isReadOnly(snapshot) && (
              <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">
                Le pressing est en lecture seule : les commandes, encaissements et mouvements de
                stock sont refusés tant que la formule n’est pas réglée. Vos données restent
                consultables et exportables.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Aucun abonnement enregistré sur cette boutique. Elle fonctionne sans limite ; contactez
            l’éditeur pour formaliser une formule.
          </p>
        )}
      </section>

      <section>
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <Sparkles size={16} aria-hidden /> Formules proposées
        </h2>

        {erreur && <p className="mt-2 text-sm text-rose-700">{erreur}</p>}

        <ul className="mt-2 grid gap-3 sm:grid-cols-3">
          {plans.map((plan) => (
            <li
              key={plan.code}
              className={`rounded-2xl border bg-white p-4 ${
                plan.code === snapshot?.plan_code
                  ? 'border-brand-teal ring-2 ring-brand-teal/30'
                  : 'border-slate-200'
              }`}
            >
              <p className="font-bold text-brand-navy">{plan.name}</p>
              <p className="mt-0.5 text-lg font-bold text-slate-800">
                {formatFcfa(plan.price_fcfa)}
                <span className="text-xs font-medium text-slate-500"> / mois</span>
              </p>
              <p className="mt-1 text-sm text-slate-600">{plan.description}</p>
              <p className="mt-2 text-xs text-slate-500">
                {plan.max_users === null ? 'Comptes illimités' : `${plan.max_users} comptes`} ·{' '}
                {plan.max_shops} boutique{plan.max_shops > 1 ? 's' : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Le règlement se fait auprès de l’éditeur (Mobile Money ou espèces) ; aucun paiement n’est
        prélevé depuis cette application. Une question sur votre formule ?{' '}
        <Link to="/support" className="font-semibold text-brand-teal underline">
          Écrire au support
        </Link>
        .
      </p>
    </div>
  )
}
