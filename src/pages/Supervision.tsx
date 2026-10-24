import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  UserPlus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTenantStore } from '@/lib/tenantContext'
import { isSupabaseConfigured } from '@/lib/env'
import { formatDateFr, formatDateTimeFr, formatFcfa } from '@/lib/formatters'
import { SUBSCRIPTION_STATE_LABELS, fetchPlans, type PlanChoice } from '@/services/subscriptionService'
import {
  SUPPORT_STATUS_LABELS,
  answerSupport,
  createShop,
  fetchMembers,
  fetchPlatformSupportRequests,
  fetchTenantOverview,
  isPlatformAdmin,
  setMember,
  setSubscription,
  type MemberRow,
} from '@/services/platformService'
import type {
  PlatformSupportRequest,
  SubscriptionState,
  TenantOverviewRow,
  TenantRole,
} from '@/types/database'

/**
 * Console de supervision (palier 4) — réservée à l'éditeur.
 *
 * Le contrôle d'accès est fait deux fois : ici (écran de refus) et dans chaque
 * fonction SQL (`is_platform_admin()`). Un compte de pressing qui forcerait la
 * route n'obtiendrait donc rien de la base.
 *
 * Trois usages : suivre les abonnements, ouvrir une boutique et rattacher un
 * compte, répondre aux demandes de support.
 */
export default function Supervision() {
  const isAdmin = useTenantStore((state) => state.isPlatformAdmin)

  const [verification, setVerification] = useState(true)
  const [pressings, setPressings] = useState<TenantOverviewRow[]>([])
  const [membres, setMembres] = useState<MemberRow[]>([])
  const [demandes, setDemandes] = useState<PlatformSupportRequest[]>([])
  const [plans, setPlans] = useState<PlanChoice[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  // Formulaire « nouvelle boutique ».
  const [nomBoutique, setNomBoutique] = useState('')
  const [telBoutique, setTelBoutique] = useState('')
  const [proprietaire, setProprietaire] = useState('')
  const [planBoutique, setPlanBoutique] = useState('pro')
  const [creation, setCreation] = useState(false)

  // Formulaire « rattacher un compte ».
  const [tenantCible, setTenantCible] = useState('')
  const [compteCible, setCompteCible] = useState('')
  const [roleCible, setRoleCible] = useState<TenantRole>('receptionist')
  const [ajout, setAjout] = useState(false)

  // Réponse au support.
  const [reponsePour, setReponsePour] = useState<string | null>(null)
  const [reponse, setReponse] = useState('')

  const charger = useCallback(async () => {
    try {
      const [liste, comptes, support] = await Promise.all([
        fetchTenantOverview(),
        fetchMembers(),
        fetchPlatformSupportRequests(),
      ])
      setPressings(liste)
      setMembres(comptes)
      setDemandes(support)
      setErreur(null)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Chargement impossible.')
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => {
    let actif = true

    void (async () => {
      const admin = await isPlatformAdmin()
      if (!actif) return
      useTenantStore.getState().setPlatformAdmin(admin)
      setVerification(false)
      if (!admin) {
        setChargement(false)
        return
      }

      void fetchPlans()
        .then((liste) => {
          if (actif) setPlans(liste)
        })
        .catch(() => undefined)
      await charger()
    })()

    return () => {
      actif = false
    }
  }, [charger])

  const appliquer = async (
    tenantId: string,
    plan: string,
    statut: SubscriptionState,
    jours: number,
  ) => {
    try {
      await setSubscription({ tenantId, plan, status: statut, days: jours })
      toast.success('Abonnement mis à jour')
      await charger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise à jour impossible.')
    }
  }

  const ouvrirBoutique = async () => {
    if (nomBoutique.trim().length < 2) {
      toast.error('Donnez un nom à la boutique.')
      return
    }

    setCreation(true)
    try {
      await createShop({
        name: nomBoutique,
        phone: telBoutique || null,
        ownerId: proprietaire.trim() || null,
        plan: planBoutique,
      })
      toast.success('Boutique ouverte', { icon: '🏪' })
      setNomBoutique('')
      setTelBoutique('')
      setProprietaire('')
      await charger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Création impossible.')
    } finally {
      setCreation(false)
    }
  }

  const rattacher = async () => {
    if (!tenantCible || compteCible.trim().length < 10) {
      toast.error('Choisissez une boutique et un identifiant de compte.')
      return
    }

    setAjout(true)
    try {
      await setMember({
        tenantId: tenantCible,
        userId: compteCible.trim(),
        role: roleCible,
      })
      toast.success('Compte rattaché')
      setCompteCible('')
      await charger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rattachement impossible.')
    } finally {
      setAjout(false)
    }
  }

  const repondre = async (id: string) => {
    if (reponse.trim().length < 2) {
      toast.error('Écrivez une réponse.')
      return
    }

    try {
      await answerSupport(id, reponse, 'closed')
      toast.success('Demande clôturée')
      setReponsePour(null)
      setReponse('')
      await charger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Réponse impossible.')
    }
  }

  if (verification) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 className="animate-spin" size={16} aria-hidden /> Vérification des droits…
      </p>
    )
  }

  if (!isAdmin || !isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <ShieldAlert className="mx-auto text-slate-400" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-slate-800">Console réservée à l’éditeur</p>
        <p className="mt-1 text-sm text-slate-500">
          Cette page pilote les abonnements de tous les pressings. Elle est protégée côté serveur :
          aucun compte de pressing ne peut l’ouvrir.
        </p>
      </div>
    )
  }

  if (chargement) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 className="animate-spin" size={16} aria-hidden /> Chargement de la supervision…
      </p>
    )
  }

  const ouvertes = demandes.filter((demande) => demande.status !== 'closed')

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
            <Building2 size={22} aria-hidden /> Supervision
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {pressings.length} pressing{pressings.length > 1 ? 's' : ''} ·{' '}
            {ouvertes.length} demande{ouvertes.length > 1 ? 's' : ''} de support ouverte
            {ouvertes.length > 1 ? 's' : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void charger()}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw size={16} aria-hidden /> Rafraîchir
        </button>
      </header>

      {erreur && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{erreur}</p>
      )}

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Pressing</th>
              <th className="px-3 py-2 font-semibold">Formule</th>
              <th className="px-3 py-2 font-semibold">État</th>
              <th className="px-3 py-2 font-semibold">Échéance</th>
              <th className="px-3 py-2 font-semibold">Comptes</th>
              <th className="px-3 py-2 font-semibold">Commandes</th>
              <th className="px-3 py-2 font-semibold">Dernière</th>
              <th className="px-3 py-2 font-semibold">Renouveler</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pressings.map((pressing) => (
              <tr key={pressing.tenant_id}>
                <td className="px-3 py-2 font-semibold text-slate-800">{pressing.tenant_name}</td>
                <td className="px-3 py-2 text-slate-600">
                  {pressing.plan_name ?? '—'}
                  {pressing.price_fcfa !== null && (
                    <span className="block text-xs text-slate-400">
                      {formatFcfa(pressing.price_fcfa)} / mois
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      pressing.state === 'active' || pressing.state === 'trial'
                        ? 'bg-emerald-100 text-emerald-800'
                        : pressing.state === 'grace'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {SUBSCRIPTION_STATE_LABELS[pressing.state]}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {pressing.current_period_end
                    ? formatDateFr(pressing.current_period_end)
                    : '—'}
                </td>
                <td className="px-3 py-2 text-slate-600">{pressing.users_count}</td>
                <td className="px-3 py-2 text-slate-600">{pressing.orders_count}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {pressing.last_order_at ? formatDateTimeFr(pressing.last_order_at) : 'jamais'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      defaultValue={pressing.plan_code ?? 'pro'}
                      onChange={(event) =>
                        void appliquer(pressing.tenant_id, event.target.value, 'active', 30)
                      }
                      aria-label={`Formule de ${pressing.tenant_name}`}
                      className="min-h-12 rounded-lg border border-slate-300 bg-white px-2 text-xs"
                    >
                      {plans.map((plan) => (
                        <option key={plan.code} value={plan.code}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        void appliquer(pressing.tenant_id, pressing.plan_code ?? 'pro', 'active', 30)
                      }
                      className="min-h-12 rounded-lg bg-brand-teal px-2.5 text-xs font-bold text-white"
                    >
                      +30 j
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void appliquer(pressing.tenant_id, pressing.plan_code ?? 'pro', 'suspended', 0)
                      }
                      className="min-h-12 rounded-lg border border-rose-300 px-2.5 text-xs font-bold text-rose-700"
                    >
                      Suspendre
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <Plus size={16} aria-hidden /> Ouvrir une boutique
          </h2>

          <div className="mt-3 space-y-2">
            <input
              value={nomBoutique}
              onChange={(event) => setNomBoutique(event.target.value)}
              placeholder="Nom de la boutique"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm"
            />
            <input
              value={telBoutique}
              onChange={(event) => setTelBoutique(event.target.value)}
              placeholder="Téléphone (facultatif)"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm"
            />
            <input
              value={proprietaire}
              onChange={(event) => setProprietaire(event.target.value)}
              placeholder="Identifiant Supabase du propriétaire (facultatif)"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-xs"
            />
            <select
              value={planBoutique}
              onChange={(event) => setPlanBoutique(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-2 text-sm"
            >
              {plans.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.name} — {formatFcfa(plan.price_fcfa)} / mois
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void ouvrirBoutique()}
              disabled={creation}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-bold text-white disabled:opacity-60"
            >
              {creation ? <Loader2 className="animate-spin" size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
              Ouvrir la boutique
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <UserPlus size={16} aria-hidden /> Rattacher un compte
          </h2>

          <div className="mt-3 space-y-2">
            <select
              value={tenantCible}
              onChange={(event) => setTenantCible(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="">Choisir une boutique…</option>
              {pressings.map((pressing) => (
                <option key={pressing.tenant_id} value={pressing.tenant_id}>
                  {pressing.tenant_name}
                </option>
              ))}
            </select>
            <input
              value={compteCible}
              onChange={(event) => setCompteCible(event.target.value)}
              placeholder="Identifiant Supabase du compte"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-xs"
            />
            <select
              value={roleCible}
              onChange={(event) => setRoleCible(event.target.value as TenantRole)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="owner">Propriétaire</option>
              <option value="receptionist">Réceptionniste</option>
              <option value="artisan">Artisan</option>
            </select>
            <button
              type="button"
              onClick={() => void rattacher()}
              disabled={ajout}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white disabled:opacity-60"
            >
              {ajout ? <Loader2 className="animate-spin" size={16} aria-hidden /> : <UserPlus size={16} aria-hidden />}
              Rattacher
            </button>
          </div>

          <ul className="mt-4 max-h-52 space-y-1 overflow-y-auto text-xs text-slate-600">
            {membres.map((membre) => (
              <li key={`${membre.tenant_id}-${membre.user_id}`} className="flex justify-between gap-2">
                <span className="truncate">
                  {membre.tenant_name} · {membre.email ?? membre.user_id.slice(0, 8)}
                </span>
                <span className="shrink-0 font-semibold text-slate-500">{membre.role}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Demandes de support
        </h2>

        {demandes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Aucune demande.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {demandes.map((demande) => (
              <li key={demande.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-800">{demande.subject}</p>
                    <p className="text-xs text-slate-500">
                      {demande.tenant_name} · {demande.author_name ?? 'compte inconnu'} ·{' '}
                      {formatDateTimeFr(demande.created_at)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                      demande.status === 'closed'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {SUPPORT_STATUS_LABELS[demande.status]}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{demande.message}</p>

                {demande.response ? (
                  <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                    <span className="font-semibold">Réponse : </span>
                    {demande.response}
                  </p>
                ) : reponsePour === demande.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={reponse}
                      onChange={(event) => setReponse(event.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Réponse envoyée au pressing…"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void repondre(demande.id)}
                        className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-3 text-sm font-bold text-white"
                      >
                        <CheckCircle2 size={16} aria-hidden /> Répondre et clôturer
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReponsePour(null)
                          setReponse('')
                        }}
                        className="min-h-12 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-600"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReponsePour(demande.id)}
                    className="mt-2 min-h-12 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-600"
                  >
                    Répondre
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
