import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  Check,
  Copy,
  FolderOpen,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTenantOnboarding } from '@/lib/tenantOnboarding'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import type {
  TenantServiceBillingUnit,
  TenantServicePricingMode,
} from '@/types/database'
import { LAUNDRY_GRID_SUGGESTION } from '@/constants/laundryCatalogSuggestions'
import { formatFcfa } from '@/lib/formatters'
import {
  completeTenantOnboarding,
  createTenantActivity,
  createTenantCategory,
  createTenantService,
  createWeightTier,
  deleteTenantActivity,
  deleteTenantCategory,
  deleteTenantService,
  deleteWeightTier,
  duplicateTenantService,
  fetchTenantServiceConfiguration,
  importSuggestedCatalog,
  updateTenantActivity,
  updateTenantCategory,
  updateTenantService,
  type TenantActivity,
  type TenantServiceCategory,
  type TenantServiceConfiguration,
  type TenantServiceOffering,
  type WeightTier,
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

const UNITES: Array<{ value: TenantServiceBillingUnit; label: string }> = [
  { value: 'PIECE', label: 'À la pièce' },
  { value: 'PAIR', label: 'À la paire' },
  { value: 'SET', label: 'À l’ensemble / parure' },
  { value: 'KG', label: 'Au kilo (poids total)' },
  { value: 'PACKAGE', label: 'Forfait poids (paliers)' },
  { value: 'FLAT', label: 'Devis (montant global)' },
]

const MODE_LABELS: Record<TenantServicePricingMode, string> = {
  FIXED: 'Prix fixe',
  FROM: 'Prix « à partir de »',
  QUOTE: 'Sur devis',
}

type Onglet = 'activites' | 'categories' | 'prestations'

interface ServiceFormState {
  name: string
  categoryId: string
  unit: TenantServiceBillingUnit
  mode: TenantServicePricingMode
  price: string
  description: string
  durationMinutes: string
}

const emptyServiceForm = (): ServiceFormState => ({
  name: '',
  categoryId: '',
  unit: 'PIECE',
  mode: 'FIXED',
  price: '',
  description: '',
  durationMinutes: '',
})

/** CRUD des activités, catégories et prestations du pressing connecté. */
export default function ServicesPressing() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const navigate = useNavigate()
  const location = useLocation()
  const { markComplete } = useTenantOnboarding()
  const isOnboarding = location.pathname === '/bienvenue'
  const isOwner = can(role, 'tenant.manage')

  const [onglet, setOnglet] = useState<Onglet>('activites')
  const [configuration, setConfiguration] = useState<TenantServiceConfiguration>({
    activities: [],
    categories: [],
    services: [],
    tiers: [],
  })
  const [chargement, setChargement] = useState(true)
  const [enregistrement, setEnregistrement] = useState(false)
  const [importEnCours, setImportEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // Activités
  const [nouvelleActivite, setNouvelleActivite] = useState('')
  const [editionActivite, setEditionActivite] = useState<{ id: string; name: string } | null>(null)

  // Catégories
  const [activiteCategorie, setActiviteCategorie] = useState('')
  const [nouvelleCategorie, setNouvelleCategorie] = useState('')
  const [editionCategorie, setEditionCategorie] = useState<{ id: string; name: string } | null>(null)

  // Prestations
  const [activitePrestation, setActivitePrestation] = useState('')
  const [formulaire, setFormulaire] = useState<ServiceFormState>(emptyServiceForm())
  const [editionPrestation, setEditionPrestation] = useState<string | null>(null)
  const [palierOuvert, setPalierOuvert] = useState<string | null>(null)
  const [nouveauPalier, setNouveauPalier] = useState({ label: '', weightKg: '', priceFcfa: '' })

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
      setActiviteCategorie((current) =>
        result.activities.some((activity) => activity.id === current) ? current : result.activities[0]?.id ?? '',
      )
      setActivitePrestation((current) =>
        result.activities.some((activity) => activity.id === current) ? current : result.activities[0]?.id ?? '',
      )
    } catch {
      setErreur('Impossible de charger la configuration. Vérifiez la connexion et la migration Supabase 027.')
    } finally {
      setChargement(false)
    }
  }, [tenantId])

  useEffect(() => {
    void charger()
  }, [charger])

  const categoriesParActivite = useMemo(() => {
    const groups = new Map<string, TenantServiceCategory[]>()
    for (const category of configuration.categories) {
      const current = groups.get(category.activityId) ?? []
      current.push(category)
      groups.set(category.activityId, current)
    }
    return groups
  }, [configuration.categories])

  const servicesParActivite = useMemo(() => {
    const groups = new Map<string, TenantServiceOffering[]>()
    for (const service of configuration.services) {
      const current = groups.get(service.activityId) ?? []
      current.push(service)
      groups.set(service.activityId, current)
    }
    return groups
  }, [configuration.services])

  const categoriesActives = (categoriesParActivite.get(activitePrestation) ?? []).filter(
    (category) => category.isActive,
  )
  const servicesActifs = (servicesParActivite.get(activitePrestation) ?? []).slice().sort(
    (a, b) => a.sortOrder - b.sortOrder,
  )
  const tiersParService = useMemo(() => {
    const groups = new Map<string, WeightTier[]>()
    for (const tier of configuration.tiers) {
      const current = groups.get(tier.tenantServiceId) ?? []
      current.push(tier)
      groups.set(tier.tenantServiceId, current)
    }
    return groups
  }, [configuration.tiers])

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

  // --- Actions activités ---------------------------------------------------
  const ajouterActivite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId || !nouvelleActivite.trim()) return
    await runAction(async () => {
      await createTenantActivity(tenantId, nouvelleActivite)
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
    const detail = count > 0 ? ` Ses ${count} prestation${count > 1 ? 's' : ''} et ses catégories seront aussi supprimées.` : ''
    if (!window.confirm(`Supprimer l’activité « ${activity.name} » ?${detail}`)) return
    await runAction(() => deleteTenantActivity(tenantId, activity.id), 'Activité supprimée.')
  }

  // --- Actions catégories --------------------------------------------------
  const ajouterCategorie = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId || !activiteCategorie || !nouvelleCategorie.trim()) return
    await runAction(async () => {
      await createTenantCategory(tenantId, activiteCategorie, nouvelleCategorie)
      setNouvelleCategorie('')
    }, 'Catégorie ajoutée.')
  }

  const enregistrerCategorie = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId || !editionCategorie) return
    await runAction(async () => {
      await updateTenantCategory(tenantId, editionCategorie.id, editionCategorie.name)
      setEditionCategorie(null)
    }, 'Catégorie mise à jour.')
  }

  const basculerCategorie = async (category: TenantServiceCategory) => {
    if (!tenantId) return
    await runAction(
      () => updateTenantCategory(tenantId, category.id, category.name, !category.isActive),
      category.isActive ? 'Catégorie désactivée.' : 'Catégorie activée.',
    )
  }

  const supprimerCategorie = async (category: TenantServiceCategory) => {
    if (!tenantId) return
    if (!window.confirm(`Supprimer la catégorie « ${category.name} » ? Ses prestations resteront mais ne seront plus classées.`)) return
    await runAction(() => deleteTenantCategory(tenantId, category.id), 'Catégorie supprimée.')
  }

  // --- Actions prestations -------------------------------------------------
  const changerUnite = (unit: TenantServiceBillingUnit) => {
    setFormulaire((current) => ({
      ...current,
      unit,
      mode: unit === 'FLAT' ? 'QUOTE' : unit === 'PACKAGE' ? 'FIXED' : current.mode === 'QUOTE' ? 'FIXED' : current.mode,
      price: unit === 'FLAT' || unit === 'PACKAGE' ? '' : current.price,
    }))
  }

  const lireFormulaire = (): {
    billingUnit: TenantServiceBillingUnit
    pricingMode: TenantServicePricingMode
    unitPrice: number | null
    options: { categoryId: string | null; description: string | null; durationMinutes: number | null }
  } => {
    const billingUnit = formulaire.unit
    const pricingMode = billingUnit === 'FLAT' ? 'QUOTE' : billingUnit === 'PACKAGE' ? 'FIXED' : formulaire.mode
    const unitPrice =
      billingUnit === 'FLAT' || billingUnit === 'PACKAGE' || formulaire.price.trim() === ''
        ? null
        : Number(formulaire.price)
    const duration = formulaire.durationMinutes.trim() === '' ? null : Number(formulaire.durationMinutes)
    return {
      billingUnit,
      pricingMode,
      unitPrice,
      options: {
        categoryId: formulaire.categoryId || null,
        description: formulaire.description.trim() || null,
        durationMinutes: duration,
      },
    }
  }

  const ajouterPrestation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId || !activitePrestation || !formulaire.name.trim()) return
    const { billingUnit, pricingMode, unitPrice, options } = lireFormulaire()
    await runAction(async () => {
      await createTenantService(
        tenantId,
        activitePrestation,
        formulaire.name,
        billingUnit,
        unitPrice,
        { ...options, pricingMode },
      )
      setFormulaire(emptyServiceForm())
    }, 'Prestation ajoutée à l’activité.')
  }

  const demanderEdition = (service: TenantServiceOffering) => {
    setEditionPrestation(service.id)
    setFormulaire({
      name: service.serviceName,
      categoryId: service.categoryId ?? '',
      unit: service.billingUnit,
      mode: service.pricingMode,
      price: service.unitPrice?.toString() ?? '',
      description: service.description ?? '',
      durationMinutes: service.durationMinutes?.toString() ?? '',
    })
  }

  const annulerEdition = () => {
    setEditionPrestation(null)
    setFormulaire(emptyServiceForm())
  }

  const enregistrerPrestation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId || !editionPrestation || !formulaire.name.trim()) return
    const { billingUnit, pricingMode, unitPrice, options } = lireFormulaire()
    await runAction(async () => {
      await updateTenantService(
        tenantId,
        editionPrestation,
        activitePrestation,
        formulaire.name,
        billingUnit,
        unitPrice,
        { ...options, pricingMode },
      )
      annulerEdition()
    }, 'Prestation mise à jour.')
  }

  const dupliquerPrestation = async (service: TenantServiceOffering) => {
    if (!tenantId) return
    await runAction(
      () => duplicateTenantService(tenantId, service.id),
      'Prestation dupliquée. Pensez à ajuster son nom et ses tarifs.',
    )
  }

  const basculerPrestation = async (service: TenantServiceOffering) => {
    if (!tenantId) return
    await runAction(
      () =>
        updateTenantService(
          tenantId,
          service.id,
          service.activityId,
          service.serviceName,
          service.billingUnit,
          service.unitPrice,
          {
            categoryId: service.categoryId,
            pricingMode: service.pricingMode,
            description: service.description,
            durationMinutes: service.durationMinutes,
            isActive: !service.isActive,
          },
        ),
      service.isActive ? 'Prestation désactivée.' : 'Prestation activée.',
    )
  }

  const supprimerPrestation = async (service: TenantServiceOffering) => {
    if (!tenantId) return
    const tiers = tiersParService.get(service.id)?.length ?? 0
    const detailTiers = tiers > 0 ? ` Ses ${tiers} palier${tiers > 1 ? 's' : ''} sera/seront supprimé(s).` : ''
    if (!window.confirm(`Supprimer la prestation « ${service.serviceName} » ?${detailTiers} Les commandes existantes conservent leurs instantanés.`)) return
    await runAction(() => deleteTenantService(tenantId, service.id), 'Prestation supprimée.')
  }

  const ajouterPalier = async (event: FormEvent<HTMLFormElement>, serviceId: string) => {
    event.preventDefault()
    if (!tenantId) return
    const weightKg = Number(nouveauPalier.weightKg)
    const priceFcfa = Number(nouveauPalier.priceFcfa)
    await runAction(async () => {
      await createWeightTier(
        tenantId,
        serviceId,
        nouveauPalier.label.trim() || `${weightKg} kg`,
        weightKg,
        priceFcfa,
      )
      setNouveauPalier({ label: '', weightKg: '', priceFcfa: '' })
    }, 'Palier ajouté.')
  }

  const supprimerPalier = async (tier: WeightTier) => {
    if (!tenantId || !window.confirm(`Supprimer le palier « ${tier.label} » ?`)) return
    await runAction(() => deleteWeightTier(tenantId, tier.id), 'Palier supprimé.')
  }

  const importerGrille = async () => {
    if (!tenantId) return
    setImportEnCours(true)
    setErreur(null)
    try {
      const summary = await importSuggestedCatalog(tenantId, LAUNDRY_GRID_SUGGESTION)
      await charger()
      const total =
        summary.activitiesCreated + summary.categoriesCreated + summary.servicesCreated + summary.tiersCreated
      if (total === 0) {
        toast('La grille type est déjà importée : aucun élément nouveau.')
      } else {
        toast.success(
          `Import terminé : ${summary.activitiesCreated} activité(s), ${summary.categoriesCreated} catégorie(s), ${summary.servicesCreated} prestation(s), ${summary.tiersCreated} palier(s).`,
          { duration: 6000 },
        )
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Import impossible.'
      setErreur(message)
      toast.error(message)
    } finally {
      setImportEnCours(false)
    }
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
        <p className="mt-2 text-sm">Demandez au propriétaire du pressing de gérer ses activités, catégories et prestations.</p>
      </div>
    )
  }

  const prixReferenceVisible = formulaire.unit !== 'FLAT' && formulaire.unit !== 'PACKAGE'

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <header className="rounded-3xl bg-gradient-to-br from-brand-navy to-slate-800 p-6 text-white shadow-sm sm:p-8">
        <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-white/10 text-teal-200">
          {isOnboarding ? <Sparkles size={22} aria-hidden /> : <Scissors size={22} aria-hidden />}
        </span>
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
          {isOnboarding ? 'Bienvenue dans Pressing Pro' : 'Personnalisation du pressing'}
        </p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Catalogue de prestations</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-200">
          Activités, catégories, prestations et tarifs de référence propres à votre établissement. Le réceptionniste utilise ce catalogue à la création de commande ; les prix des commandes enregistrées restent figés.
        </p>
        <button
          type="button"
          onClick={() => void importerGrille()}
          disabled={importEnCours || chargement}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-bold text-white ring-1 ring-white/30 hover:bg-white/20 disabled:opacity-50"
        >
          {importEnCours ? <Loader2 className="animate-spin" size={17} aria-hidden /> : <Upload size={17} aria-hidden />}
          Importer la grille type (laver-repasser, laver-plier, pièces, forfaits kilo)
        </button>
      </header>

      <div role="tablist" aria-label="Gestion du catalogue" className="grid grid-cols-3 gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        <button type="button" role="tab" aria-selected={onglet === 'activites'} onClick={() => setOnglet('activites')} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-xs font-bold sm:text-sm ${onglet === 'activites' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Activity size={17} aria-hidden /> Activités <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{configuration.activities.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={onglet === 'categories'} onClick={() => setOnglet('categories')} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-xs font-bold sm:text-sm ${onglet === 'categories' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <FolderOpen size={17} aria-hidden /> Catégories <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{configuration.categories.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={onglet === 'prestations'} onClick={() => setOnglet('prestations')} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-xs font-bold sm:text-sm ${onglet === 'prestations' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Layers size={17} aria-hidden /> Prestations <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{configuration.services.length}</span>
        </button>
      </div>

      {chargement ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-14 text-slate-500" role="status">
          <Loader2 className="animate-spin" size={20} aria-hidden /> Chargement du catalogue…
        </div>
      ) : (
        <>
          {onglet === 'activites' && (
            <section role="tabpanel" aria-label="Activités" className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-brand-navy">Activités du pressing</h2>
                <p className="mt-1 text-sm text-slate-500">Activez par exemple « Pressing » et « Blanchisserie ». Chaque activité porte ses propres catégories et prestations.</p>
              </div>

              <form onSubmit={(event) => void ajouterActivite(event)} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
                <input autoFocus={isOnboarding && configuration.activities.length === 0} value={nouvelleActivite} onChange={(event) => setNouvelleActivite(event.target.value)} maxLength={80} placeholder="Ex. Blanchisserie" aria-label="Nom de la nouvelle activité" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
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
                    const categoryCount = categoriesParActivite.get(activity.id)?.length ?? 0
                    const editing = editionActivite?.id === activity.id
                    return (
                      <li key={activity.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        {editing ? (
                          <form onSubmit={(event) => void enregistrerActivite(event)} className="flex flex-col gap-2 sm:flex-row">
                            <input autoFocus value={editionActivite.name} onChange={(event) => setEditionActivite({ ...editionActivite, name: event.target.value })} maxLength={80} aria-label={`Nouveau nom de ${activity.name}`} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                            <button type="submit" disabled={enregistrement || editionActivite.name.trim().length < 2} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white disabled:opacity-50"><Check size={16} aria-hidden /> Enregistrer</button>
                            <button type="button" onClick={() => setEditionActivite(null)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600"><X size={16} aria-hidden /> Annuler</button>
                          </form>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="font-bold text-slate-800">{activity.name}</h3>
                              <p className="mt-1 text-xs text-slate-500">{categoryCount} catégorie(s) · {serviceCount} prestation(s)</p>
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

          {onglet === 'categories' && (
            <section role="tabpanel" aria-label="Catégories" className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-brand-navy">Catégories de prestations</h2>
                <p className="mt-1 text-sm text-slate-500">Les catégories structurent le catalogue d’une activité (ex. « Forfaits au poids », « Linge de maison »). Une catégorie désactivée disparaît de la nouvelle commande.</p>
              </div>

              {configuration.activities.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                  Créez d’abord une activité dans l’onglet Activités.
                </div>
              ) : (
                <>
                  <label className="block space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <span className="text-sm font-bold text-slate-700">Activité concernée</span>
                    <select value={activiteCategorie} onChange={(event) => setActiviteCategorie(event.target.value)} aria-label="Activité des catégories" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal">
                      {configuration.activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                    </select>
                  </label>

                  <form onSubmit={(event) => void ajouterCategorie(event)} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
                    <input value={nouvelleCategorie} onChange={(event) => setNouvelleCategorie(event.target.value)} maxLength={80} placeholder="Ex. Forfaits au poids" aria-label="Nom de la nouvelle catégorie" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                    <button type="submit" disabled={enregistrement || !activiteCategorie || nouvelleCategorie.trim().length < 2} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 font-bold text-white hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-50">
                      <Plus size={17} aria-hidden /> Ajouter la catégorie
                    </button>
                  </form>

                  {(categoriesParActivite.get(activiteCategorie) ?? []).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Aucune catégorie pour cette activité.</div>
                  ) : (
                    <ul className="space-y-3">
                      {(categoriesParActivite.get(activiteCategorie) ?? []).map((category) => {
                        const editing = editionCategorie?.id === category.id
                        const used = (servicesParActivite.get(activiteCategorie) ?? []).filter((service) => service.categoryId === category.id).length
                        return (
                          <li key={category.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            {editing ? (
                              <form onSubmit={(event) => void enregistrerCategorie(event)} className="flex flex-col gap-2 sm:flex-row">
                                <input autoFocus value={editionCategorie.name} onChange={(event) => setEditionCategorie({ ...editionCategorie, name: event.target.value })} maxLength={80} aria-label={`Nouveau nom de la catégorie ${category.name}`} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                                <button type="submit" disabled={enregistrement || editionCategorie.name.trim().length < 2} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white disabled:opacity-50"><Check size={16} aria-hidden /> Enregistrer</button>
                                <button type="button" onClick={() => setEditionCategorie(null)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600"><X size={16} aria-hidden /> Annuler</button>
                              </form>
                            ) : (
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <h3 className="font-bold text-slate-800">
                                    {category.name}
                                    {!category.isActive && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Inactive</span>}
                                  </h3>
                                  <p className="mt-1 text-xs text-slate-500">{used} prestation(s) classée(s)</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button type="button" onClick={() => setEditionCategorie({ id: category.id, name: category.name })} aria-label={`Modifier la catégorie ${category.name}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Pencil size={15} aria-hidden /> Modifier</button>
                                  <button type="button" onClick={() => void basculerCategorie(category)} className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{category.isActive ? 'Désactiver' : 'Activer'}</button>
                                  <button type="button" onClick={() => void supprimerCategorie(category)} aria-label={`Supprimer la catégorie ${category.name}`} disabled={enregistrement} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={15} aria-hidden /> Supprimer</button>
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

          {onglet === 'prestations' && (
            <section role="tabpanel" aria-label="Prestations" className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-brand-navy">Prestations et tarifs de référence</h2>
                <p className="mt-1 text-sm text-slate-500">Le prix de référence est pré-rempli à la commande et reste modifiable au comptoir. Un forfait poids porte ses paliers ; un devis n’a pas de prix à l’avance.</p>
              </div>

              {configuration.activities.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                  Créez d’abord une activité dans l’onglet Activités.
                </div>
              ) : (
                <>
                  <label className="block space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <span className="text-sm font-bold text-slate-700">Activité concernée</span>
                    <select value={activitePrestation} onChange={(event) => { setActivitePrestation(event.target.value); annulerEdition() }} aria-label="Activité des prestations" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal">
                      {configuration.activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                    </select>
                  </label>

                  <form onSubmit={(event) => (editionPrestation ? void enregistrerPrestation(event) : void ajouterPrestation(event))} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
                    <input value={formulaire.name} onChange={(event) => setFormulaire({ ...formulaire, name: event.target.value })} maxLength={80} placeholder="Nom de la prestation (ex. Chemise repassée)" aria-label="Nom de la prestation" className="min-h-12 min-w-0 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Catégorie <span className="font-normal">(facultatif)</span></span>
                      <select value={formulaire.categoryId} onChange={(event) => setFormulaire({ ...formulaire, categoryId: event.target.value })} aria-label="Catégorie de la prestation" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal">
                        <option value="">Sans catégorie</option>
                        {categoriesActives.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Mode de facturation</span>
                      <select value={formulaire.unit} onChange={(event) => changerUnite(event.target.value as TenantServiceBillingUnit)} aria-label="Mode de facturation de la prestation" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal">
                        {UNITES.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Tarification</span>
                      <select value={formulaire.unit === 'FLAT' ? 'QUOTE' : formulaire.unit === 'PACKAGE' ? 'FIXED' : formulaire.mode} onChange={(event) => setFormulaire({ ...formulaire, mode: event.target.value as TenantServicePricingMode })} disabled={formulaire.unit === 'FLAT' || formulaire.unit === 'PACKAGE'} aria-label="Mode de tarification de la prestation" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal disabled:bg-slate-50 disabled:text-slate-400">
                        <option value="FIXED">{MODE_LABELS.FIXED}</option>
                        <option value="FROM">{MODE_LABELS.FROM}</option>
                        {formulaire.unit === 'FLAT' && <option value="QUOTE">{MODE_LABELS.QUOTE}</option>}
                      </select>
                    </label>
                    {prixReferenceVisible && (
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Tarif de référence (FCFA, facultatif)</span>
                        <input type="number" min="1" step="1" value={formulaire.price} onChange={(event) => setFormulaire({ ...formulaire, price: event.target.value })} placeholder="Ex. 500" aria-label="Tarif de référence de la prestation" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                      </label>
                    )}
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Durée indicative (minutes, facultatif)</span>
                      <input type="number" min="1" max="1440" step="1" value={formulaire.durationMinutes} onChange={(event) => setFormulaire({ ...formulaire, durationMinutes: event.target.value })} placeholder="Ex. 480" aria-label="Durée indicative de la prestation" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                      <span className="text-xs font-semibold text-slate-600">Description <span className="font-normal">(facultatif)</span></span>
                      <input value={formulaire.description} onChange={(event) => setFormulaire({ ...formulaire, description: event.target.value })} maxLength={200} placeholder="Ex. Lavage, séchage et pliage du linge courant" aria-label="Description de la prestation" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal" />
                    </label>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      {editionPrestation ? (
                        <>
                          <button type="submit" disabled={enregistrement || formulaire.name.trim().length < 2} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white disabled:opacity-50"><Check size={16} aria-hidden /> Enregistrer</button>
                          <button type="button" onClick={annulerEdition} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600"><X size={16} aria-hidden /> Annuler</button>
                        </>
                      ) : (
                        <button type="submit" disabled={enregistrement || !formulaire.name.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 font-bold text-white hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-50">
                          <Plus size={17} aria-hidden /> Ajouter la prestation
                        </button>
                      )}
                    </div>
                  </form>

                  {servicesActifs.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Aucune prestation pour cette activité. Ajoutez-en une ci-dessus ou importez la grille type.</div>
                  ) : (
                    <ul className="space-y-3">
                      {servicesActifs.map((service) => {
                        const category = configuration.categories.find((entry) => entry.id === service.categoryId)
                        const tiers = (tiersParService.get(service.id) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder)
                        return (
                          <li key={service.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="font-bold text-slate-800">
                                  {service.serviceName}
                                  {!service.isActive && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Inactive</span>}
                                </h3>
                                <p className="mt-1 text-xs text-slate-500">
                                  {category ? `${category.name} · ` : ''}{UNITES.find((unit) => unit.value === service.billingUnit)?.label} · {MODE_LABELS[service.pricingMode]}
                                  {service.unitPrice !== null ? ` · ${service.unitPrice.toLocaleString('fr-FR')} FCFA` : ''}
                                  {service.durationMinutes ? ` · ${service.durationMinutes} min` : ''}
                                </p>
                                {service.description && <p className="mt-1 text-xs italic text-slate-500">{service.description}</p>}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => demanderEdition(service)} aria-label={`Modifier la prestation ${service.serviceName}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Pencil size={15} aria-hidden /> Modifier</button>
                                <button type="button" onClick={() => void dupliquerPrestation(service)} aria-label={`Dupliquer la prestation ${service.serviceName}`} disabled={enregistrement} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Copy size={15} aria-hidden /> Dupliquer</button>
                                <button type="button" onClick={() => void basculerPrestation(service)} className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{service.isActive ? 'Désactiver' : 'Activer'}</button>
                                <button type="button" onClick={() => void supprimerPrestation(service)} aria-label={`Supprimer la prestation ${service.serviceName}`} disabled={enregistrement} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={15} aria-hidden /> Supprimer</button>
                              </div>
                            </div>

                            {service.billingUnit === 'PACKAGE' && (
                              <div className="mt-3 rounded-xl border border-brand-teal/20 bg-teal-50/40 p-3">
                                <button type="button" onClick={() => setPalierOuvert(palierOuvert === service.id ? null : service.id)} aria-expanded={palierOuvert === service.id} className="flex w-full items-center justify-between text-sm font-bold text-brand-navy">
                                  <span>Paliers de poids ({tiers.length})</span>
                                  <span>{palierOuvert === service.id ? 'Réduire' : 'Gérer'}</span>
                                </button>
                                {palierOuvert === service.id && (
                                  <div className="mt-3 space-y-2">
                                    {tiers.length === 0 && <p className="text-xs text-slate-500">Aucun palier. Ajoutez les tranches de poids et leurs forfaits (ex. 10 kg → 15 000 FCFA).</p>}
                                    {tiers.map((tier) => (
                                      <div key={tier.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                                        <span className="font-semibold text-slate-700">{tier.label} · {tier.weightKg} kg · {formatFcfa(tier.priceFcfa)}</span>
                                        <button type="button" onClick={() => void supprimerPalier(tier)} aria-label={`Supprimer le palier ${tier.label}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-rose-200 px-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"><Trash2 size={14} aria-hidden /> Retirer</button>
                                      </div>
                                    ))}
                                    <form onSubmit={(event) => void ajouterPalier(event, service.id)} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_140px_auto]">
                                      <input value={nouveauPalier.label} onChange={(event) => setNouveauPalier({ ...nouveauPalier, label: event.target.value })} maxLength={40} placeholder="Libellé (ex. 10 kg)" aria-label={`Libellé du palier pour ${service.serviceName}`} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                                      <input type="number" min="0.1" step="0.1" value={nouveauPalier.weightKg} onChange={(event) => setNouveauPalier({ ...nouveauPalier, weightKg: event.target.value })} placeholder="Poids kg" aria-label={`Poids du palier pour ${service.serviceName}`} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                                      <input type="number" min="1" step="1" value={nouveauPalier.priceFcfa} onChange={(event) => setNouveauPalier({ ...nouveauPalier, priceFcfa: event.target.value })} placeholder="Prix FCFA" aria-label={`Prix du palier pour ${service.serviceName}`} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                                      <button type="submit" disabled={enregistrement || nouveauPalier.weightKg.trim() === '' || nouveauPalier.priceFcfa.trim() === ''} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-brand-teal px-3 text-sm font-bold text-white disabled:opacity-50"><Plus size={15} aria-hidden /> Ajouter</button>
                                    </form>
                                  </div>
                                )}
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
