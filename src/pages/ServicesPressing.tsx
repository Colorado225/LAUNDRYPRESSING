import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Scissors, Sparkles, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTenantOnboarding } from '@/lib/tenantOnboarding'
import { can } from '@/lib/permissions'
import { TENANT_ACTIVITIES } from '@/lib/tenantActivities'
import { useTenantStore } from '@/lib/tenantContext'
import { fetchTenantServices, saveTenantServices } from '@/services/tenantServices'
import type { TenantActivityCode } from '@/types/database'

type ServicesByActivity = Partial<Record<TenantActivityCode, string[]>>

/** Personnalisation initiale et édition des activités et prestations d'un pressing. */
export default function ServicesPressing() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const navigate = useNavigate()
  const location = useLocation()
  const { markComplete } = useTenantOnboarding()
  const isOnboarding = location.pathname === '/bienvenue'
  const isOwner = can(role, 'tenant.manage')

  const [etape, setEtape] = useState<0 | 1>(isOnboarding ? 0 : 1)
  const [services, setServices] = useState<ServicesByActivity>({})
  const [nouveauService, setNouveauService] = useState<Partial<Record<TenantActivityCode, string>>>({})
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enregistrement, setEnregistrement] = useState(false)

  useEffect(() => {
    if (!tenantId) {
      setErreur('Aucun pressing actif. Reconnectez-vous pour continuer.')
      setChargement(false)
      return
    }

    let active = true
    setChargement(true)
    setErreur(null)
    void fetchTenantServices(tenantId)
      .then((rows) => {
        if (!active) return
        const config: ServicesByActivity = {}
        for (const row of rows) {
          const current = config[row.activityCode] ?? []
          if (!current.includes(row.serviceName)) config[row.activityCode] = [...current, row.serviceName]
        }
        setServices(config)
      })
      .catch(() => {
        if (active) setErreur('Impossible de charger vos prestations. Vérifiez votre connexion et la migration Supabase 021.')
      })
      .finally(() => {
        if (active) setChargement(false)
      })

    return () => {
      active = false
    }
  }, [tenantId])

  const activitesSelectionnees = useMemo(
    () => TENANT_ACTIVITIES.filter((activity) => Object.hasOwn(services, activity.code)),
    [services],
  )
  const nombrePrestations = useMemo(
    () => Object.values(services).reduce((sum, names) => sum + (names?.length ?? 0), 0),
    [services],
  )

  const toggleActivity = (code: TenantActivityCode) => {
    const activity = TENANT_ACTIVITIES.find((entry) => entry.code === code)
    if (!activity) return
    setServices((current) => {
      if (Object.hasOwn(current, code)) {
        const next = { ...current }
        delete next[code]
        return next
      }
      return { ...current, [code]: [...activity.suggestions] }
    })
  }

  const toggleService = (code: TenantActivityCode, name: string) => {
    setServices((current) => {
      const selected = current[code] ?? []
      const next = selected.includes(name)
        ? selected.filter((entry) => entry !== name)
        : [...selected, name]
      return { ...current, [code]: next }
    })
  }

  const addCustomService = (code: TenantActivityCode) => {
    const value = (nouveauService[code] ?? '').trim()
    if (value.length < 2) {
      toast.error('Le nom de la prestation doit contenir au moins 2 caractères.')
      return
    }
    if (value.length > 80) {
      toast.error('Le nom de la prestation ne doit pas dépasser 80 caractères.')
      return
    }
    const existing = services[code] ?? []
    if (existing.some((entry) => entry.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      toast.error('Cette prestation est déjà dans la liste.')
      return
    }
    setServices((current) => ({ ...current, [code]: [...(current[code] ?? []), value] }))
    setNouveauService((current) => ({ ...current, [code]: '' }))
  }

  const enregistrer = async () => {
    if (!tenantId || !isOwner) return
    const payload = TENANT_ACTIVITIES.flatMap((activity) =>
      (services[activity.code] ?? []).map((serviceName) => ({
        activityCode: activity.code,
        serviceName,
      })),
    )
    if (payload.length === 0) {
      setErreur('Sélectionnez au moins une prestation avant de continuer.')
      setEtape(1)
      return
    }

    setEnregistrement(true)
    setErreur(null)
    try {
      await saveTenantServices(tenantId, payload)
      markComplete()
      toast.success(isOnboarding ? 'Votre pressing est configuré.' : 'Les prestations ont été mises à jour.')
      if (isOnboarding) navigate('/commandes', { replace: true })
    } catch (caught) {
      setErreur(caught instanceof Error ? caught.message : 'Enregistrement impossible. Réessayez.')
    } finally {
      setEnregistrement(false)
    }
  }

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h1 className="text-xl font-bold">Configuration réservée au propriétaire</h1>
        <p className="mt-2 text-sm">Demandez au propriétaire du pressing de choisir les activités et prestations proposées.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <header className="rounded-3xl bg-gradient-to-br from-brand-navy to-slate-800 p-6 text-white shadow-sm sm:p-8">
        <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-white/10 text-teal-200">
          {isOnboarding ? <Sparkles size={22} aria-hidden /> : <Scissors size={22} aria-hidden />}
        </span>
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
          {isOnboarding ? 'Bienvenue dans Pressing Pro' : 'Personnalisation du pressing'}
        </p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
          {isOnboarding ? 'Quelles activités proposez-vous ?' : 'Services et activités'}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-200">
          Choisissez les activités de votre établissement, puis gardez, retirez ou ajoutez les prestations qui correspondent à votre façon de travailler. Les tarifs restent libres et seront saisis à la commande.
        </p>
        {isOnboarding && (
          <div className="mt-6 flex items-center gap-3" aria-label={`Étape ${etape + 1} sur 2`}>
            <span className={`flex size-8 items-center justify-center rounded-full text-sm font-bold ${etape === 0 ? 'bg-teal-300 text-brand-navy' : 'bg-white text-brand-navy'}`}>{etape > 0 ? <Check size={17} aria-hidden /> : '1'}</span>
            <span className="h-px w-10 bg-white/30" />
            <span className={`flex size-8 items-center justify-center rounded-full text-sm font-bold ${etape === 1 ? 'bg-teal-300 text-brand-navy' : 'bg-white/15 text-white'}`}>2</span>
            <span className="text-xs font-semibold text-slate-200">{etape === 0 ? 'Activités' : 'Prestations'}</span>
          </div>
        )}
      </header>

      {chargement ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-14 text-slate-500" role="status">
          <Loader2 className="animate-spin" size={20} aria-hidden /> Chargement de la configuration…
        </div>
      ) : (
        <>
          {(!isOnboarding || etape === 0) && (
            <section className="space-y-4" aria-labelledby="activities-heading">
              <div>
                <h2 id="activities-heading" className="text-lg font-bold text-brand-navy">1. Sélectionnez vos activités</h2>
                <p className="mt-1 text-sm text-slate-500">Touchez chaque activité pratiquée. Vous pourrez ensuite adapter les prestations proposées.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {TENANT_ACTIVITIES.map((activity) => {
                  const selected = Object.hasOwn(services, activity.code)
                  return (
                    <button
                      key={activity.code}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleActivity(activity.code)}
                      className={`min-h-28 rounded-2xl border p-4 text-left transition-colors ${selected ? 'border-brand-teal bg-teal-50 ring-1 ring-brand-teal' : 'border-slate-200 bg-white hover:border-slate-400'}`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block font-bold text-slate-800">{activity.label}</span>
                          <span className="mt-1 block text-sm leading-relaxed text-slate-500">{activity.description}</span>
                        </span>
                        <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-transparent'}`}>
                          <Check size={15} aria-hidden />
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {(!isOnboarding || etape === 1) && (
            <section className="space-y-4" aria-labelledby="services-heading">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="services-heading" className="text-lg font-bold text-brand-navy">{isOnboarding ? '2. Personnalisez vos prestations' : 'Prestations proposées'}</h2>
                  <p className="mt-1 text-sm text-slate-500">Cochez les prestations à garder, ou ajoutez vos propres intitulés.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{nombrePrestations} sélectionnée{nombrePrestations > 1 ? 's' : ''}</span>
              </div>

              {activitesSelectionnees.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                  Aucune activité sélectionnée. Revenez à l’étape précédente pour choisir vos activités.
                </div>
              ) : activitesSelectionnees.map((activity) => (
                <article key={activity.code} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-brand-navy">{activity.label}</h3>
                      <p className="mt-1 text-xs text-slate-500">Prestations associées à cette activité</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleActivity(activity.code)}
                      aria-label={`Retirer l’activité ${activity.label}`}
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    ><X size={18} aria-hidden /></button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {Array.from(new Set([...activity.suggestions, ...(services[activity.code] ?? [])])).map((name) => {
                      const checked = services[activity.code]?.includes(name) ?? false
                      return (
                        <label key={name} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm font-medium ${checked ? 'border-teal-300 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-500'}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleService(activity.code, name)} className="accent-teal-700" />
                          {name}
                        </label>
                      )
                    })}
                  </div>

                  <form
                    className="mt-4 flex flex-col gap-2 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault()
                      addCustomService(activity.code)
                    }}
                  >
                    <input
                      value={nouveauService[activity.code] ?? ''}
                      onChange={(event) => setNouveauService((current) => ({ ...current, [activity.code]: event.target.value }))}
                      maxLength={80}
                      placeholder={`Ajouter une prestation pour ${activity.label.toLowerCase()}`}
                      aria-label={`Nouvelle prestation pour ${activity.label}`}
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal"
                    />
                    <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      <Plus size={16} aria-hidden /> Ajouter
                    </button>
                  </form>
                </article>
              ))}
            </section>
          )}

          {erreur && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{erreur}</p>}

          {!chargement && (
            <div className="flex flex-col-reverse justify-between gap-3 border-t border-slate-200 pt-4 sm:flex-row">
              {isOnboarding && etape === 1 ? (
                <button type="button" onClick={() => { setErreur(null); setEtape(0) }} disabled={enregistrement} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 font-semibold text-slate-700 disabled:opacity-50">
                  <ArrowLeft size={17} aria-hidden /> Retour aux activités
                </button>
              ) : (
                <span />
              )}
              {isOnboarding && etape === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (activitesSelectionnees.length === 0) {
                      setErreur('Choisissez au moins une activité pour continuer.')
                      return
                    }
                    setErreur(null)
                    setEtape(1)
                  }}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 font-bold text-white hover:bg-brand-teal/90"
                >Continuer vers les prestations <ArrowRight size={17} aria-hidden /></button>
              ) : (
                <button
                  type="button"
                  onClick={() => void enregistrer()}
                  disabled={enregistrement || nombrePrestations === 0}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-navy px-5 font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enregistrement ? <Loader2 className="animate-spin" size={17} aria-hidden /> : <Check size={17} aria-hidden />}
                  {enregistrement ? 'Enregistrement…' : isOnboarding ? 'Terminer la configuration' : 'Enregistrer les prestations'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
