import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Activity, Check, Loader2, Pencil, Plus, Scissors, Sparkles, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTenantOnboarding } from '@/lib/tenantOnboarding'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import type { TenantServiceBillingUnit } from '@/types/database'
import {
  completeTenantOnboarding,
  createTenantActivity,
  createTenantService,
  deleteTenantActivity,
  deleteTenantService,
  fetchTenantServiceConfiguration,
  updateTenantActivity,
  updateTenantService,
  type TenantActivity,
  type TenantServiceConfiguration,
  type TenantServiceOffering,
} from '@/services/tenantServices'

const SUGGESTIONS_ACTIVITES = [
  'Pressing',
  'Blanchisserie',
  'Nettoyage à sec',
  'Repassage',
  'Retouches et couture',
  'Collecte et livraison',
  'Tapis et ameublement',
  'Cuir et daim',
]

type Onglet = 'activites' | 'prestations'

/** CRUD des activités et prestations, rattachées au pressing connecté. */
export default function ServicesPressing() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const navigate = useNavigate()
  const location = useLocation()
  const { markComplete } = useTenantOnboarding()
  const isOnboarding = location.pathname === '/bienvenue'
  const isOwner = can(role, 'tenant.manage')

  const [onglet, setOnglet] = useState<Onglet>('activites')
  const [configuration, setConfiguration] = useState<TenantServiceConfiguration>({ activities: [], services: [] })
  const [chargement, setChargement] = useState(true)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [nouvelleActivite, setNouvelleActivite] = useState('')
  const [editionActivite, setEditionActivite] = useState<{ id: string; name: string } | null>(null)
  const [activiteActive, setActiviteActive] = useState('')
  const [nouvellePrestation, setNouvellePrestation] = useState('')
  const [nouvelleUnite, setNouvelleUnite] = useState<TenantServiceBillingUnit>('PIECE')
  // Tarif unitaire de la nouvelle prestation : par pièce ou par kilo selon le
  // mode choisi. Vide = prix saisi au comptoir, ce qui reste permis.
  const [nouveauTarif, setNouveauTarif] = useState('')
  const [editionPrestation, setEditionPrestation] = useState<{
    id: string
    name: string
    activityId: string
    billingUnit: TenantServiceBillingUnit
    unitPrice: string
  } | null>(null)

  const charger = useCallback(async () => {
    if (!tenantId) {
      setErreur('Aucun pressing actif. Reconnectez-vous pour continuer.')
      setChargement(false)
      return
    }
    setChargement(true)
    setErreur(null)
    try {
      const result = await fetchTenantServiceConfiguration(tenantId)
      setConfiguration(result)
      setActiviteActive((current) => result.activities.some((activity) => activity.id === current)
        ? current
        : result.activities[0]?.id ?? '')
    } catch {
      setErreur('Impossible de charger les activités et prestations. Vérifiez la connexion et la migration Supabase 022.')
    } finally {
      setChargement(false)
    }
  }, [tenantId])

  useEffect(() => {
    void charger()
  }, [charger])

  const servicesParActivite = useMemo(() => {
    const groups = new Map<string, TenantServiceOffering[]>()
    for (const service of configuration.services) {
      const current = groups.get(service.activityId) ?? []
      current.push(service)
      groups.set(service.activityId, current)
    }
    return groups
  }, [configuration.services])
  const servicesActifs = configuration.services.filter((service) => service.activityId === activiteActive)

  const runAction = async (action: () => Promise<void>, succes: string) => {
    setEnregistrement(true)
    setErreur(null)
    try {
      await action()
      await charger()
      toast.success(succes)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Enregistrement impossible. Réessayez.'
      setErreur(message)
      toast.error(message)
    } finally {
      setEnregistrement(false)
    }
  }

  const ajouterActivite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId) return
    const name = nouvelleActivite.trim()
    if (!name) return
    await runAction(async () => {
      await createTenantActivity(tenantId, name)
      setNouvelleActivite('')
    }, 'Activité ajoutée.')
  }

  const enregistrerActivite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId || !editionActivite) return
    await runAction(async () => {
      await updateTenantActivity(tenantId, editionActivite.id, editionActivite.name)
      setEditionActivite(null)
    }, 'Activité mise à jour.')
  }

  const supprimerActivite = async (activity: TenantActivity) => {
    if (!tenantId) return
    const count = servicesParActivite.get(activity.id)?.length ?? 0
    const detail = count > 0 ? ` Ses ${count} prestation${count > 1 ? 's' : ''} liée${count > 1 ? 's' : ''} sera/seront aussi supprimée${count > 1 ? 's' : ''}.` : ''
    if (!window.confirm(`Supprimer l’activité « ${activity.name} » ?${detail}`)) return
    await runAction(() => deleteTenantActivity(tenantId, activity.id), 'Activité supprimée.')
  }

  const ajouterPrestation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId || !activiteActive) return
    const name = nouvellePrestation.trim()
    if (!name) return
    const unitPrice = nouveauTarif.trim() ? Number(nouveauTarif) : null
    if (unitPrice !== null && (!Number.isSafeInteger(unitPrice) || unitPrice < 1 || unitPrice > 10_000_000)) {
      setErreur(
        nouvelleUnite === 'KG'
          ? 'Le tarif au kilo doit être un montant entier entre 1 et 10 000 000 FCFA.'
          : 'Le prix par pièce doit être un montant entier entre 1 et 10 000 000 FCFA.',
      )
      return
    }
    await runAction(async () => {
      await createTenantService(tenantId, activiteActive, name, nouvelleUnite, unitPrice)
      setNouvellePrestation('')
      setNouvelleUnite('PIECE')
      setNouveauTarif('')
    }, 'Prestation ajoutée à l’activité.')
  }

  const enregistrerPrestation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId || !editionPrestation) return
    const unitPrice = editionPrestation.unitPrice.trim()
      ? Number(editionPrestation.unitPrice)
      : null
    if (unitPrice !== null && (!Number.isSafeInteger(unitPrice) || unitPrice < 1 || unitPrice > 10_000_000)) {
      setErreur(
        editionPrestation.billingUnit === 'KG'
          ? 'Le tarif au kilo doit être un montant entier entre 1 et 10 000 000 FCFA.'
          : 'Le prix par pièce doit être un montant entier entre 1 et 10 000 000 FCFA.',
      )
      return
    }
    await runAction(async () => {
      await updateTenantService(
        tenantId,
        editionPrestation.id,
        editionPrestation.activityId,
        editionPrestation.name,
        editionPrestation.billingUnit,
        unitPrice,
      )
      setEditionPrestation(null)
    }, 'Prestation mise à jour.')
  }

  const supprimerPrestation = async (service: TenantServiceOffering) => {
    if (!tenantId || !window.confirm(`Supprimer la prestation « ${service.serviceName} » ?`)) return
    await runAction(() => deleteTenantService(tenantId, service.id), 'Prestation supprimée.')
  }

  const terminerOnboarding = async () => {
    if (!tenantId || !isOwner) return
    setEnregistrement(true)
    setErreur(null)
    try {
      await completeTenantOnboarding(tenantId)
      markComplete()
      toast.success('Votre pressing est configuré.')
      navigate('/commandes', { replace: true })
    } catch (caught) {
      setErreur(caught instanceof Error ? caught.message : 'Impossible de terminer la configuration.')
    } finally {
      setEnregistrement(false)
    }
  }

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h1 className="text-xl font-bold">Configuration réservée au propriétaire</h1>
        <p className="mt-2 text-sm">Demandez au propriétaire du pressing de gérer ses activités et prestations.</p>
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
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Services & activités</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-200">
          Créez les activités de votre pressing, puis rattachez-y ses prestations. Chaque modification est enregistrée directement dans la base de données de ce pressing.
        </p>
      </header>

      <div role="tablist" aria-label="Gestion des services et activités" className="grid grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        <button type="button" role="tab" aria-selected={onglet === 'activites'} onClick={() => setOnglet('activites')} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition-colors ${onglet === 'activites' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Activity size={17} aria-hidden /> Activités <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{configuration.activities.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={onglet === 'prestations'} onClick={() => setOnglet('prestations')} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition-colors ${onglet === 'prestations' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Scissors size={17} aria-hidden /> Prestations <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{configuration.services.length}</span>
        </button>
      </div>

      {chargement ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-14 text-slate-500" role="status">
          <Loader2 className="animate-spin" size={20} aria-hidden /> Chargement des données du pressing…
        </div>
      ) : (
        <>
          {onglet === 'activites' && (
            <section role="tabpanel" aria-label="Activités" className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-brand-navy">Activités du pressing</h2>
                <p className="mt-1 text-sm text-slate-500">Ajoutez, renommez ou supprimez les activités proposées par votre établissement.</p>
              </div>

              <form onSubmit={(event) => void ajouterActivite(event)} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
                <input autoFocus={isOnboarding && configuration.activities.length === 0} value={nouvelleActivite} onChange={(event) => setNouvelleActivite(event.target.value)} maxLength={80} placeholder="Ex. Pressing, blanchisserie, couture…" aria-label="Nom de la nouvelle activité" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                <button type="submit" disabled={enregistrement || nouvelleActivite.trim().length < 2} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 font-bold text-white hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-50">
                  <Plus size={17} aria-hidden /> Ajouter l’activité
                </button>
              </form>

              <div className="flex flex-wrap gap-2" aria-label="Suggestions d’activités">
                {SUGGESTIONS_ACTIVITES.filter((name) => !configuration.activities.some((activity) => activity.name.toLocaleLowerCase() === name.toLocaleLowerCase())).map((name) => (
                  <button key={name} type="button" onClick={() => setNouvelleActivite(name)} className="min-h-9 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-brand-teal hover:text-brand-navy">+ {name}</button>
                ))}
              </div>

              {configuration.activities.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                  Aucune activité enregistrée. Ajoutez-en une pour commencer la configuration.
                </div>
              ) : (
                <ul className="space-y-3">
                  {configuration.activities.map((activity) => {
                    const serviceCount = servicesParActivite.get(activity.id)?.length ?? 0
                    const editing = editionActivite?.id === activity.id
                    return (
                      <li key={activity.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        {editing ? (
                          <form onSubmit={(event) => void enregistrerActivite(event)} className="flex flex-col gap-2 sm:flex-row">
                            <input autoFocus value={editionActivite.name} onChange={(event) => setEditionActivite({ ...editionActivite, name: event.target.value })} maxLength={80} aria-label={`Nouveau nom de ${activity.name}`} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                            <button type="submit" disabled={enregistrement || editionActivite.name.trim().length < 2} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white disabled:opacity-50"><Check size={16} aria-hidden /> Enregistrer</button>
                            <button type="button" onClick={() => setEditionActivite(null)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600"><X size={16} aria-hidden /> Annuler</button>
                          </form>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="font-bold text-slate-800">{activity.name}</h3>
                              <p className="mt-1 text-xs text-slate-500">{serviceCount} prestation{serviceCount === 1 ? '' : 's'} associée{serviceCount === 1 ? '' : 's'}</p>
                            </div>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setEditionActivite({ id: activity.id, name: activity.name })} aria-label={`Modifier l’activité ${activity.name}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Pencil size={15} aria-hidden /> Modifier</button>
                              <button type="button" onClick={() => void supprimerActivite(activity)} aria-label={`Supprimer l’activité ${activity.name}`} disabled={enregistrement} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={15} aria-hidden /> Supprimer</button>
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {onglet === 'prestations' && (
            <section role="tabpanel" aria-label="Prestations" className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-brand-navy">Prestations par activité</h2>
                <p className="mt-1 text-sm text-slate-500">Chaque prestation est rattachée à une activité. Les prestations au kilo peuvent recevoir un tarif propre au pressing; il sera proposé puis confirmé à la commande.</p>
              </div>

              {configuration.activities.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                  Créez d’abord une activité dans l’onglet Activités.
                  <button type="button" onClick={() => setOnglet('activites')} className="ml-1 font-bold text-brand-teal underline">Gérer les activités</button>
                </div>
              ) : (
                <>
                  <label className="block space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <span className="text-sm font-bold text-slate-700">Activité concernée</span>
                    <select value={activiteActive} onChange={(event) => { setActiviteActive(event.target.value); setEditionPrestation(null) }} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal">
                      {configuration.activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                    </select>
                  </label>

                  <form onSubmit={(event) => void ajouterPrestation(event)} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
                    <input value={nouvellePrestation} onChange={(event) => setNouvellePrestation(event.target.value)} maxLength={80} placeholder="Ex. Lavage et repassage au kilo" aria-label="Nom de la nouvelle prestation" className="min-h-12 min-w-0 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Mode de facturation</span>
                      <select value={nouvelleUnite} onChange={(event) => setNouvelleUnite(event.target.value as TenantServiceBillingUnit)} aria-label="Mode de facturation de la nouvelle prestation" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal">
                        <option value="PIECE">À la pièce</option>
                        <option value="KG">Au kilo (poids total)</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">
                        {nouvelleUnite === 'KG'
                          ? 'Tarif par kilo (FCFA, facultatif)'
                          : 'Prix par pièce (FCFA, facultatif)'}
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={nouveauTarif}
                        onChange={(event) => setNouveauTarif(event.target.value)}
                        placeholder={nouvelleUnite === 'KG' ? 'Ex. 1 500' : 'Ex. 500'}
                        aria-label={
                          nouvelleUnite === 'KG'
                            ? 'Tarif au kilo de la nouvelle prestation'
                            : 'Prix par pièce de la nouvelle prestation'
                        }
                        className="min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal"
                      />
                      <span className="block text-[11px] text-slate-500">
                        Laisser vide : le prix sera saisi au comptoir, commande par commande.
                      </span>
                    </label>
                    <div className="flex items-end sm:justify-end">
                      <button type="submit" disabled={enregistrement || !activiteActive || nouvellePrestation.trim().length < 2} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 font-bold text-white hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                        <Plus size={17} aria-hidden /> Ajouter la prestation
                      </button>
                    </div>
                  </form>

                  {servicesActifs.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Aucune prestation pour cette activité. Ajoutez-en une ci-dessus.</div>
                  ) : (
                    <ul className="space-y-3">
                      {servicesActifs.map((service) => {
                        const editing = editionPrestation?.id === service.id
                        return (
                          <li key={service.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            {editing ? (
                              <form onSubmit={(event) => void enregistrerPrestation(event)} className="grid gap-3 sm:grid-cols-2">
                                <input autoFocus value={editionPrestation.name} onChange={(event) => setEditionPrestation({ ...editionPrestation, name: event.target.value })} maxLength={80} aria-label={`Modifier ${service.serviceName}`} className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                                <select value={editionPrestation.activityId} onChange={(event) => setEditionPrestation({ ...editionPrestation, activityId: event.target.value })} aria-label="Activité de la prestation" className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal">
                                  {configuration.activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                                </select>
                                <label className="space-y-1">
                                  <span className="text-xs font-semibold text-slate-600">Mode de facturation</span>
                                  <select value={editionPrestation.billingUnit} onChange={(event) => setEditionPrestation({ ...editionPrestation, billingUnit: event.target.value as TenantServiceBillingUnit })} aria-label={`Unité de ${service.serviceName}`} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal">
                                    <option value="PIECE">À la pièce</option>
                                    <option value="KG">Au kilo (poids total)</option>
                                  </select>
                                </label>
                                <label className="space-y-1">
                                  <span className="text-xs font-semibold text-slate-600">
                                    {editionPrestation.billingUnit === 'KG'
                                      ? 'Tarif par kilo (FCFA, facultatif)'
                                      : 'Prix par pièce (FCFA, facultatif)'}
                                  </span>
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={editionPrestation.unitPrice}
                                    onChange={(event) => setEditionPrestation({ ...editionPrestation, unitPrice: event.target.value })}
                                    aria-label={
                                      editionPrestation.billingUnit === 'KG'
                                        ? `Tarif au kilo de ${service.serviceName}`
                                        : `Prix par pièce de ${service.serviceName}`
                                    }
                                    placeholder={editionPrestation.billingUnit === 'KG' ? 'Ex. 1 500' : 'Ex. 500'}
                                    className="min-h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal"
                                  />
                                </label>
                                <div className="flex flex-wrap gap-2 sm:col-span-2">
                                  <button type="submit" disabled={enregistrement || editionPrestation.name.trim().length < 2} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white disabled:opacity-50"><Check size={16} aria-hidden /> Enregistrer</button>
                                  <button type="button" onClick={() => setEditionPrestation(null)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600"><X size={16} aria-hidden /> Annuler</button>
                                </div>
                              </form>
                            ) : (
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <h3 className="font-bold text-slate-800">{service.serviceName}</h3>
                                  <p className="mt-1 text-xs text-slate-500">
                                    Activité : {service.activityName} · {service.billingUnit === 'KG' ? 'Au kilo' : 'À la pièce'}
                                    {service.unitPrice !== null
                                      ? ` · ${service.unitPrice.toLocaleString('fr-FR')} FCFA/${service.billingUnit === 'KG' ? 'kg' : 'pièce'}`
                                      : ' · prix saisi au comptoir'}
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => setEditionPrestation({ id: service.id, name: service.serviceName, activityId: service.activityId, billingUnit: service.billingUnit, unitPrice: service.unitPrice?.toString() ?? '' })} aria-label={`Modifier la prestation ${service.serviceName}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Pencil size={15} aria-hidden /> Modifier</button>
                                  <button type="button" onClick={() => void supprimerPrestation(service)} aria-label={`Supprimer la prestation ${service.serviceName}`} disabled={enregistrement} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={15} aria-hidden /> Supprimer</button>
                                </div>
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}

          {erreur && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{erreur}</p>}

          {isOnboarding && (
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">Pour continuer, créez au moins une activité et une prestation.</p>
              <button type="button" onClick={() => void terminerOnboarding()} disabled={enregistrement || configuration.activities.length === 0 || configuration.services.length === 0} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-navy px-5 font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                {enregistrement ? <Loader2 className="animate-spin" size={17} aria-hidden /> : <Check size={17} aria-hidden />}
                Terminer la configuration
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
