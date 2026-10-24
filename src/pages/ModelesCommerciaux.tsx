import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Calculator,
  Check,
  Clock3,
  Layers3,
  Loader2,
  Lock,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Truck,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getCachedLaundryModels,
  refreshLaundryModels,
  saveLaundryModel,
  type LaundryModelDraft,
  type LaundryModelServiceInput,
} from '@/db/laundryModelsRepository'
import { loadCatalogStructure, type CatalogStructure } from '@/db/catalogStructureRepository'
import type { LocalLaundryModel } from '@/db/localDb'
import { calculateLaundryModelPrice } from '@/lib/laundryModelPricing'
import { can } from '@/lib/permissions'
import { formatFcfa } from '@/lib/formatters'
import { useTenantStore } from '@/lib/tenantContext'
import type { LaundryModelAudience, LaundryModelServiceMode, LaundryModelType } from '@/types/database'

interface FormulaireModele {
  name: string
  description: string
  modelType: LaundryModelType
  audience: LaundryModelAudience
  pricePerKg: string
  packagePrice: string
  includedWeightKg: string
  includedPieces: string
  overagePricePerPiece: string
  packageScope: string[]
  overagePricePerKg: string
  minimumWeightKg: string
  billingIncrementKg: string
  minimumCharge: string
  conditions: string
  exclusions: string
  pickupDeliveryTerms: string
  turnaroundDays: string
  isActive: boolean
  services: Record<string, LaundryModelServiceMode>
}

const FORMULAIRE_INITIAL: FormulaireModele = {
  name: '',
  description: '',
  modelType: 'PER_KG',
  audience: 'ALL',
  pricePerKg: '',
  packagePrice: '',
  includedWeightKg: '',
  includedPieces: '',
  overagePricePerPiece: '',
  packageScope: [],
  overagePricePerKg: '',
  minimumWeightKg: '',
  billingIncrementKg: '0.1',
  minimumCharge: '',
  conditions: '',
  exclusions: '',
  pickupDeliveryTerms: '',
  turnaroundDays: '',
  isActive: true,
  services: {},
}

function lireNombre(value: string): number | null {
  if (!value.trim()) return null
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return Number.NaN
  return Number(normalized)
}

function validerPoids(value: number | null, label: string, obligatoire = false): string | null {
  if (value === null) return obligatoire ? `${label} est obligatoire.` : null
  if (!Number.isFinite(value) || value <= 0 || Number(value.toFixed(3)) !== value) {
    return `${label} doit être positif, avec trois décimales maximum.`
  }
  return null
}

function formDepuisModele(model: LocalLaundryModel): FormulaireModele {
  return {
    name: model.name,
    description: model.description ?? '',
    modelType: model.modelType,
    audience: model.audience,
    pricePerKg: model.pricePerKg === null ? '' : String(model.pricePerKg),
    packagePrice: model.packagePrice === null ? '' : String(model.packagePrice),
    includedWeightKg: model.includedWeightKg === null ? '' : String(model.includedWeightKg),
    includedPieces: model.includedPieces == null ? '' : String(model.includedPieces),
    overagePricePerPiece: model.overagePricePerPiece == null ? '' : String(model.overagePricePerPiece),
    packageScope: (model.familyPackageScope ?? []).map((scope) => scope.familyId ? `family:${scope.familyId}` : `article:${scope.articleId}`),
    overagePricePerKg: model.overagePricePerKg === null ? '' : String(model.overagePricePerKg),
    minimumWeightKg: model.minimumWeightKg === null ? '' : String(model.minimumWeightKg),
    billingIncrementKg: model.billingIncrementKg === null ? '' : String(model.billingIncrementKg),
    minimumCharge: model.minimumCharge === null ? '' : String(model.minimumCharge),
    conditions: model.conditions ?? '',
    exclusions: model.exclusions ?? '',
    pickupDeliveryTerms: model.pickupDeliveryTerms ?? '',
    turnaroundDays: model.turnaroundDays === null ? '' : String(model.turnaroundDays),
    isActive: model.isActive,
    services: Object.fromEntries(model.services.map((service) => [service.serviceId, service.inclusionMode])),
  }
}

function typeLabel(modelType: LaundryModelType): string {
  if (modelType === 'PER_KG') return 'Au kilo'
  if (modelType === 'FAMILY_PACKAGE') return 'Forfait famille'
  return 'Forfait de poids'
}

function audienceLabel(audience: LaundryModelAudience): string {
  if (audience === 'INDIVIDUAL') return 'Particuliers'
  if (audience === 'PROFESSIONAL') return 'Professionnels'
  return 'Tous les clients'
}

function calculerDepuisForm(form: FormulaireModele, poids: number) {
  const pricePerKg = lireNombre(form.pricePerKg)
  const packagePrice = lireNombre(form.packagePrice)
  const includedWeight = lireNombre(form.includedWeightKg)
  const overagePrice = lireNombre(form.overagePricePerKg)
  const minimumWeight = lireNombre(form.minimumWeightKg)
  const increment = lireNombre(form.billingIncrementKg)
  const minimumCharge = lireNombre(form.minimumCharge)
  return calculateLaundryModelPrice(
    {
      model_type: form.modelType,
      price_per_kg: pricePerKg,
      package_price: packagePrice,
      included_weight_kg: includedWeight,
      overage_price_per_kg: overagePrice,
      minimum_weight_kg: minimumWeight,
      billing_increment_kg: form.modelType === 'FAMILY_PACKAGE' ? null : increment,
      minimum_charge: minimumCharge,
    },
    poids,
  )
}

export default function ModelesCommerciaux() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const peutGerer = can(role, 'catalog.manage')
  const [modeles, setModeles] = useState<LocalLaundryModel[]>([])
  const [structure, setStructure] = useState<CatalogStructure | null>(null)
  const [chargement, setChargement] = useState(true)
  const [envoi, setEnvoi] = useState(false)
  const [erreurChargement, setErreurChargement] = useState<string | null>(null)
  const [form, setForm] = useState<FormulaireModele>(FORMULAIRE_INITIAL)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [montrerFormulaire, setMontrerFormulaire] = useState(false)
  const [afficherArchives, setAfficherArchives] = useState(false)
  const [poidsSimulation, setPoidsSimulation] = useState('2')

  const chargerCache = useCallback(async () => {
    if (!tenantId) return
    setModeles(await getCachedLaundryModels(tenantId))
    setChargement(false)
  }, [tenantId])

  const actualiser = useCallback(async () => {
    if (!tenantId) return
    setErreurChargement(null)
    try {
      const [nouveauxModeles, catalogue] = await Promise.all([
        refreshLaundryModels(tenantId),
        loadCatalogStructure(tenantId),
      ])
      setModeles(nouveauxModeles)
      setStructure(catalogue)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Les modèles commerciaux ne sont pas accessibles.'
      setErreurChargement(message)
    } finally {
      setChargement(false)
    }
  }, [tenantId])

  useEffect(() => {
    void chargerCache()
    void actualiser()
  }, [actualiser, chargerCache])

  const choixPrestations = useMemo(() => {
    const servicesActifs = structure?.services.filter((service) => service.is_active) ?? []
    const referencesExistantes = new Map<string, { name: string; active: boolean }>()
    for (const model of modeles) {
      for (const service of model.services) {
        referencesExistantes.set(service.serviceId, {
          name: service.serviceName,
          active: service.serviceActive,
        })
      }
    }
    const idsActifs = new Set(servicesActifs.map((service) => service.id))
    const result = servicesActifs.map((service) => ({
      id: service.id,
      name: service.name,
      active: true,
    }))
    for (const [id, service] of referencesExistantes) {
      if (!idsActifs.has(id)) result.push({ id, name: service.name, active: false })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [modeles, structure])

  const ouvrirCreation = () => {
    setEditingId(null)
    setForm(FORMULAIRE_INITIAL)
    setMontrerFormulaire(true)
  }

  const ouvrirEdition = (model: LocalLaundryModel) => {
    setEditingId(model.id)
    setForm(formDepuisModele(model))
    setMontrerFormulaire(true)
  }

  const fermerFormulaire = () => {
    setMontrerFormulaire(false)
    setEditingId(null)
    setForm(FORMULAIRE_INITIAL)
  }

  const setChamp = <K extends keyof FormulaireModele>(key: K, value: FormulaireModele[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  const enregistrer = async () => {
    if (!tenantId) return
    const nom = form.name.trim()
    if (nom.length < 2 || nom.length > 80) {
      toast.error('Le nom doit contenir entre 2 et 80 caractères.')
      return
    }
    if (form.description.length > 1000 || form.conditions.length > 1000 || form.exclusions.length > 2000 || form.pickupDeliveryTerms.length > 1000) {
      toast.error('Un des textes dépasse sa longueur maximale.')
      return
    }

    const pricePerKg = lireNombre(form.pricePerKg)
    const packagePrice = lireNombre(form.packagePrice)
    const includedWeight = lireNombre(form.includedWeightKg)
    const includedPieces = lireNombre(form.includedPieces)
    const overagePricePerPiece = lireNombre(form.overagePricePerPiece)
    const overagePrice = lireNombre(form.overagePricePerKg)
    const minimumWeight = lireNombre(form.minimumWeightKg)
    const increment = lireNombre(form.billingIncrementKg)
    const minimumCharge = lireNombre(form.minimumCharge)
    const numberErrors = [
      validerPoids(increment, 'L’incrément de facturation'),
      validerPoids(minimumWeight, 'Le poids minimum'),
    ].filter(Boolean)
    if (form.modelType === 'PER_KG') {
      if (pricePerKg === null || !Number.isInteger(pricePerKg) || pricePerKg <= 0 || pricePerKg > 10_000_000) {
        numberErrors.push('Le tarif au kilo doit être un montant entier entre 1 et 10 000 000 FCFA.')
      }
    } else {
      if (packagePrice === null || !Number.isInteger(packagePrice) || packagePrice <= 0 || packagePrice > 10_000_000) {
        numberErrors.push('Le prix du forfait doit être un montant entier entre 1 et 10 000 000 FCFA.')
      }
      if (form.modelType === 'WEIGHT_PACKAGE') {
        const weightError = validerPoids(includedWeight, 'Le poids inclus', true)
        if (weightError) numberErrors.push(weightError)
        if (overagePrice !== null && (!Number.isInteger(overagePrice) || overagePrice < 0 || overagePrice > 10_000_000)) {
          numberErrors.push('Le supplément au kilo doit être un montant entier compris entre 0 et 10 000 000 FCFA.')
        }
      } else {
        if (includedPieces === null || !Number.isInteger(includedPieces) || includedPieces < 1 || includedPieces > 1000) {
          numberErrors.push('Le nombre de pièces incluses doit être un entier entre 1 et 1 000.')
        }
        if (overagePricePerPiece !== null && (!Number.isInteger(overagePricePerPiece) || overagePricePerPiece < 0 || overagePricePerPiece > 10_000_000)) {
          numberErrors.push('Le supplément par pièce doit être un montant entier entre 0 et 10 000 000 FCFA.')
        }
        if (form.packageScope.some((scope) => scope.startsWith('family:') && !structure?.families.some((family) => family.id === scope.slice(7) && family.is_active) || scope.startsWith('article:') && !structure?.articles.some((article) => article.id === scope.slice(8) && article.is_active))) {
          numberErrors.push('Retirez les articles ou familles archivés du périmètre de ce forfait.')
        }
      }
    }
    if (minimumCharge !== null && (!Number.isInteger(minimumCharge) || minimumCharge < 0 || minimumCharge > 10_000_000)) {
      numberErrors.push('Le minimum facturable doit être un montant entier compris entre 0 et 10 000 000 FCFA.')
    }
    if (numberErrors.length > 0) {
      toast.error(numberErrors[0]!)
      return
    }
    const days = lireNombre(form.turnaroundDays)
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) {
      toast.error('Le délai doit être un nombre entier compris entre 0 et 365 jours.')
      return
    }
    const serviceInputs: LaundryModelServiceInput[] = Object.entries(form.services).map(([serviceId, inclusionMode], index) => ({
      service_id: serviceId,
      inclusion_mode: inclusionMode,
      sort_order: index,
    }))
    if (serviceInputs.some((service) => !choixPrestations.find((choice) => choice.id === service.service_id)?.active)) {
      toast.error('Retirez les prestations archivées ou réactivez-les avant d’enregistrer.')
      return
    }

    const draft: LaundryModelDraft = {
      ...(editingId ? { id: editingId } : {}),
      name: nom,
      description: form.description.trim() || null,
      model_type: form.modelType,
      audience: form.audience,
      price_per_kg: form.modelType === 'PER_KG' ? pricePerKg : null,
      package_price: form.modelType !== 'PER_KG' ? packagePrice : null,
      included_pieces: form.modelType === 'FAMILY_PACKAGE' ? includedPieces : null,
      overage_price_per_piece: form.modelType === 'FAMILY_PACKAGE' ? overagePricePerPiece : null,
      scope: form.packageScope.map((scope) => scope.startsWith('family:')
        ? { family_id: scope.slice(7), article_id: null }
        : { family_id: null, article_id: scope.slice(8) }),
      included_weight_kg: form.modelType === 'WEIGHT_PACKAGE' ? includedWeight : null,
      overage_price_per_kg: form.modelType === 'WEIGHT_PACKAGE' ? overagePrice : null,
      minimum_weight_kg: form.modelType === 'PER_KG' ? minimumWeight : null,
      billing_increment_kg: increment,
      minimum_charge: minimumCharge,
      conditions: form.conditions.trim() || null,
      exclusions: form.exclusions.trim() || null,
      pickup_delivery_terms: form.pickupDeliveryTerms.trim() || null,
      turnaround_days: days,
      is_active: form.isActive,
      sort_order: modeles.find((model) => model.id === editingId)?.sortOrder ?? modeles.length,
    }

    setEnvoi(true)
    try {
      await saveLaundryModel(draft, serviceInputs)
      const misesAJour = await refreshLaundryModels(tenantId)
      setModeles(misesAJour)
      fermerFormulaire()
      toast.success(editingId ? 'Modèle commercial mis à jour.' : 'Modèle commercial créé.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.')
    } finally {
      setEnvoi(false)
    }
  }

  const basculerActif = async (model: LocalLaundryModel) => {
    if (!tenantId) return
    const confirmation = model.isActive
      ? `Archiver « ${model.name} » ? Il ne sera plus proposé pour les nouvelles commandes.`
      : `Réactiver « ${model.name} » ?`
    if (!window.confirm(confirmation)) return
    const draft: LaundryModelDraft = {
      id: model.id,
      name: model.name,
      description: model.description,
      model_type: model.modelType,
      audience: model.audience,
      price_per_kg: model.pricePerKg,
      package_price: model.packagePrice,
      included_pieces: model.includedPieces ?? null,
      overage_price_per_piece: model.overagePricePerPiece ?? null,
      scope: (model.familyPackageScope ?? []).map(({ familyId, articleId }) => ({ family_id: familyId, article_id: articleId })),
      included_weight_kg: model.includedWeightKg,
      overage_price_per_kg: model.overagePricePerKg,
      minimum_weight_kg: model.minimumWeightKg,
      billing_increment_kg: model.billingIncrementKg,
      minimum_charge: model.minimumCharge,
      conditions: model.conditions,
      exclusions: model.exclusions,
      pickup_delivery_terms: model.pickupDeliveryTerms,
      turnaround_days: model.turnaroundDays,
      is_active: !model.isActive,
      sort_order: model.sortOrder,
    }
    const services = model.services
      .filter((service) => service.serviceActive)
      .map(({ serviceId: service_id, inclusionMode: inclusion_mode }, sort_order) => ({
        service_id,
        inclusion_mode,
        sort_order,
      }))
    try {
      await saveLaundryModel(draft, services)
      setModeles(await refreshLaundryModels(tenantId))
      toast.success(model.isActive ? 'Modèle archivé.' : 'Modèle réactivé.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Modification impossible.')
    }
  }

  const visibles = modeles.filter((model) => afficherArchives || model.isActive)
  const poids = lireNombre(poidsSimulation)
  let simulation: ReturnType<typeof calculateLaundryModelPrice> | null = null
  let erreurSimulation: string | null = null
  if (poids && Number.isFinite(poids) && poids > 0) {
    try {
      simulation = calculerDepuisForm(form, poids)
    } catch (error) {
      erreurSimulation = error instanceof Error ? error.message : 'Renseignez les tarifs pour afficher le calcul.'
    }
  }

  if (!peutGerer) {
    return (
      <section className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <Lock className="mx-auto mb-3 text-amber-700" size={28} aria-hidden />
          <h1 className="text-xl font-bold text-brand-navy">Accès réservé au propriétaire</h1>
          <p className="mt-2 text-sm text-slate-600">La gestion des modèles commerciaux modifie les règles de tarification du pressing.</p>
        </div>
      </section>
    )
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 pb-12 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-teal">Offres commerciales</p>
          <h1 className="mt-1 text-2xl font-bold text-brand-navy">Modèles au kilo et forfaits</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Définissez les forfaits au kilo ou à la pièce, leur périmètre d’articles, les suppléments et les prestations incluses.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void actualiser()}
            disabled={chargement}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={16} aria-hidden /> Actualiser
          </button>
          <button
            type="button"
            onClick={ouvrirCreation}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-teal-700"
          >
            <Plus size={18} aria-hidden /> Créer un modèle
          </button>
        </div>
      </header>

      {erreurChargement && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {erreurChargement} {modeles.length > 0 && 'Les modèles déjà enregistrés sur cet appareil restent consultables.'}
        </div>
      )}

      {montrerFormulaire && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-bold text-brand-navy">{editingId ? 'Modifier le modèle' : 'Nouveau modèle commercial'}</h2>
              <p className="mt-1 text-sm text-slate-500">Les montants sont saisis en FCFA ; les poids acceptent jusqu’à trois décimales.</p>
            </div>
            <button type="button" onClick={fermerFormulaire} aria-label="Fermer le formulaire" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} aria-hidden /></button>
          </div>

          <div className="space-y-6 p-5 sm:p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                Nom du modèle
                <input value={form.name} onChange={(event) => setChamp('name', event.target.value)} maxLength={80} className="field" placeholder="Ex. Linge de maison au kilo" />
              </label>
              <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                Clientèle concernée
                <select value={form.audience} onChange={(event) => setChamp('audience', event.target.value as LaundryModelAudience)} className="field">
                  <option value="ALL">Tous les clients</option>
                  <option value="INDIVIDUAL">Particuliers</option>
                  <option value="PROFESSIONAL">Professionnels</option>
                </select>
              </label>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">Mode de facturation</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <button type="button" onClick={() => setChamp('modelType', 'PER_KG')} className={`rounded-xl border p-4 text-left transition ${form.modelType === 'PER_KG' ? 'border-brand-teal bg-teal-50 ring-1 ring-brand-teal' : 'border-slate-200 hover:border-slate-300'}`}>
                  <span className="flex items-center gap-2 font-bold text-brand-navy"><Scale size={18} aria-hidden /> Facturation au kilo</span>
                  <span className="mt-1 block text-sm text-slate-600">Tarif par kg, avec minimum et incrément configurables.</span>
                </button>
                <button type="button" onClick={() => setChamp('modelType', 'WEIGHT_PACKAGE')} className={`rounded-xl border p-4 text-left transition ${form.modelType === 'WEIGHT_PACKAGE' ? 'border-brand-teal bg-teal-50 ring-1 ring-brand-teal' : 'border-slate-200 hover:border-slate-300'}`}>
                  <span className="flex items-center gap-2 font-bold text-brand-navy"><Package size={18} aria-hidden /> Forfait de poids</span>
                  <span className="mt-1 block text-sm text-slate-600">Prix fixe pour un poids inclus, puis supplément au kilo facultatif.</span>
                </button>
                <button type="button" onClick={() => setChamp('modelType', 'FAMILY_PACKAGE')} className={`rounded-xl border p-4 text-left transition ${form.modelType === 'FAMILY_PACKAGE' ? 'border-brand-teal bg-teal-50 ring-1 ring-brand-teal' : 'border-slate-200 hover:border-slate-300'}`}>
                  <span className="flex items-center gap-2 font-bold text-brand-navy"><Layers3 size={18} aria-hidden /> Forfait famille</span>
                  <span className="mt-1 block text-sm text-slate-600">Prix global pour un nombre de pièces et un périmètre d’articles définis.</span>
                </button>
              </div>
            </div>

            <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {form.modelType === 'PER_KG' ? (
                <>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Tarif par kilo (FCFA)<input inputMode="numeric" value={form.pricePerKg} onChange={(event) => setChamp('pricePerKg', event.target.value)} className="field" placeholder="Ex. 1 000" /></label>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Poids minimum (kg)<input inputMode="decimal" value={form.minimumWeightKg} onChange={(event) => setChamp('minimumWeightKg', event.target.value)} className="field" placeholder="Facultatif" /></label>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Incrément facturé (kg)<input inputMode="decimal" value={form.billingIncrementKg} onChange={(event) => setChamp('billingIncrementKg', event.target.value)} className="field" placeholder="0,1 (facultatif)" /></label>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Minimum facturable (FCFA)<input inputMode="numeric" value={form.minimumCharge} onChange={(event) => setChamp('minimumCharge', event.target.value)} className="field" placeholder="Facultatif" /></label>
                </>
              ) : form.modelType === 'WEIGHT_PACKAGE' ? (
                <>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Prix du forfait (FCFA)<input inputMode="numeric" value={form.packagePrice} onChange={(event) => setChamp('packagePrice', event.target.value)} className="field" placeholder="Ex. 5 000" /></label>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Poids inclus (kg)<input inputMode="decimal" value={form.includedWeightKg} onChange={(event) => setChamp('includedWeightKg', event.target.value)} className="field" placeholder="Ex. 5" /></label>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Supplément par kg (FCFA)<input inputMode="numeric" value={form.overagePricePerKg} onChange={(event) => setChamp('overagePricePerKg', event.target.value)} className="field" placeholder="Vide = validation manuelle" /></label>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Minimum facturable (FCFA)<input inputMode="numeric" value={form.minimumCharge} onChange={(event) => setChamp('minimumCharge', event.target.value)} className="field" placeholder="Facultatif" /></label>
                </>
              ) : (
                <>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Prix global du forfait (FCFA)<input inputMode="numeric" value={form.packagePrice} onChange={(event) => setChamp('packagePrice', event.target.value)} className="field" placeholder="Ex. 5 000" /></label>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Pièces incluses<input inputMode="numeric" value={form.includedPieces} onChange={(event) => setChamp('includedPieces', event.target.value)} className="field" placeholder="Ex. 5" /></label>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Supplément par pièce (FCFA)<input inputMode="numeric" value={form.overagePricePerPiece} onChange={(event) => setChamp('overagePricePerPiece', event.target.value)} className="field" placeholder="Vide = validation manuelle" /></label>
                  <label className="space-y-1.5 text-sm font-semibold text-slate-700">Minimum facturable (FCFA)<input inputMode="numeric" value={form.minimumCharge} onChange={(event) => setChamp('minimumCharge', event.target.value)} className="field" placeholder="Facultatif" /></label>
                </>
              )}
            </div>

            {form.modelType === 'FAMILY_PACKAGE' && (
              <section className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-bold text-brand-navy">Articles admissibles</h3>
                <p className="mt-1 text-xs text-slate-600">Sans sélection, tous les articles actifs sont admissibles. Vous pouvez limiter le forfait à des familles ou articles spécifiques.</p>
                {!structure ? <p className="mt-3 text-sm text-amber-700">Connectez-vous pour charger le catalogue.</p> : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {structure.families.filter((family) => family.is_active).map((family) => (
                      <label key={`family:${family.id}`} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-sm">
                        <input type="checkbox" checked={form.packageScope.includes(`family:${family.id}`)} onChange={(event) => setChamp('packageScope', event.target.checked ? [...form.packageScope, `family:${family.id}`] : form.packageScope.filter((scope) => scope !== `family:${family.id}`))} />
                        <span><strong>{family.name}</strong><span className="block text-xs text-slate-500">Famille entière</span></span>
                      </label>
                    ))}
                    {structure.articles.filter((article) => article.is_active).map((article) => (
                      <label key={`article:${article.id}`} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-sm">
                        <input type="checkbox" checked={form.packageScope.includes(`article:${article.id}`)} onChange={(event) => setChamp('packageScope', event.target.checked ? [...form.packageScope, `article:${article.id}`] : form.packageScope.filter((scope) => scope !== `article:${article.id}`))} />
                        <span>{article.name}<span className="block text-xs text-slate-500">{structure.families.find((family) => family.id === article.family_id)?.name ?? 'Famille'}</span></span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            )}

            {form.modelType !== 'FAMILY_PACKAGE' && <section className="rounded-xl border border-sky-100 bg-sky-50/70 p-4">
              <div className="flex items-center gap-2 font-bold text-brand-navy"><Calculator size={18} aria-hidden /> Simulateur de prix</div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  Poids de l’exemple (kg)
                  <input inputMode="decimal" value={poidsSimulation} onChange={(event) => setPoidsSimulation(event.target.value)} className="field w-28" />
                </label>
                <div aria-live="polite" className="min-h-11 flex-1 rounded-lg bg-white px-4 py-2 text-sm">
                  {simulation?.status === 'PRICED' ? (
                    <><strong className="text-lg text-brand-navy">{formatFcfa(simulation.amount)}</strong><span className="ml-2 text-slate-600">{simulation.breakdown}</span></>
                  ) : simulation?.status === 'QUOTE' ? <span className="font-semibold text-amber-800">Sur validation : {simulation.breakdown}</span>
                    : <span className="text-slate-500">{erreurSimulation ?? 'Saisissez un poids et les tarifs pour voir le calcul.'}</span>}
                </div>
              </div>
            </section>}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                Description
                <textarea value={form.description} onChange={(event) => setChamp('description', event.target.value)} maxLength={1000} rows={2} className="field" placeholder="Présentez l’offre aux clients…" />
              </label>
              <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                Conditions
                <textarea value={form.conditions} onChange={(event) => setChamp('conditions', event.target.value)} maxLength={1000} rows={2} className="field" placeholder="Ex. linge trié par couleur…" />
              </label>
              <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                Exclusions
                <textarea value={form.exclusions} onChange={(event) => setChamp('exclusions', event.target.value)} maxLength={2000} rows={2} className="field" placeholder="Articles ou traitements non compris…" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                  Délai indicatif (jours)
                  <input inputMode="numeric" value={form.turnaroundDays} onChange={(event) => setChamp('turnaroundDays', event.target.value)} className="field" placeholder="Facultatif" />
                </label>
                <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                  Collecte / livraison
                  <textarea value={form.pickupDeliveryTerms} onChange={(event) => setChamp('pickupDeliveryTerms', event.target.value)} maxLength={1000} rows={2} className="field" placeholder="Modalités et frais éventuels…" />
                </label>
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-brand-navy">Prestations associées</h3>
                  <p className="mt-1 text-xs text-slate-500">Choisissez si chaque prestation est incluse ou facturée en supplément.</p>
                </div>
                {!structure && <p className="text-xs text-amber-700">Connectez-vous pour charger les prestations du catalogue.</p>}
              </div>
              {choixPrestations.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Aucune prestation active. Vous pourrez en ajouter depuis le Catalogue.</p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {choixPrestations.map((service) => {
                    const inclusionMode = form.services[service.id]
                    return (
                      <div key={service.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                        <label className={`flex items-center gap-3 text-sm font-semibold ${service.active ? 'text-slate-700' : 'text-slate-400'}`}>
                          <input type="checkbox" checked={Boolean(inclusionMode)} disabled={!service.active && !inclusionMode} onChange={(event) => {
                            setForm((previous) => {
                              const services = { ...previous.services }
                              if (event.target.checked) services[service.id] = 'INCLUDED'
                              else delete services[service.id]
                              return { ...previous, services }
                            })
                          }} />
                          {service.name}
                          {!service.active && <span className="text-xs font-normal">(archivée : retirez-la)</span>}
                        </label>
                        {inclusionMode && service.active && (
                          <select aria-label={`Facturation de ${service.name}`} value={inclusionMode} onChange={(event) => setForm((previous) => ({
                            ...previous,
                            services: { ...previous.services, [service.id]: event.target.value as LaundryModelServiceMode },
                          }))} className="field min-h-10 w-full max-w-64">
                            <option value="INCLUDED">Incluse dans le prix</option>
                            <option value="EXTRA">Facturée en supplément</option>
                          </select>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <label className="inline-flex min-h-11 items-center gap-3 rounded-xl bg-slate-50 px-4 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setChamp('isActive', event.target.checked)} />
              Modèle actif : disponible pour les nouvelles commandes
            </label>

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
              <button type="button" onClick={fermerFormulaire} className="min-h-12 rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Annuler</button>
              <button type="button" disabled={envoi} onClick={() => void enregistrer()} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {envoi ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Check size={17} aria-hidden />}
                {editingId ? 'Enregistrer les changements' : 'Créer le modèle'}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-brand-navy">Vos modèles commerciaux</h2>
            <p className="text-sm text-slate-500">{modeles.filter((model) => model.isActive).length} actif(s) · {modeles.length} au total</p>
          </div>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-600">
            <input type="checkbox" checked={afficherArchives} onChange={(event) => setAfficherArchives(event.target.checked)} /> Afficher les archives
          </label>
        </div>

        {chargement ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-12 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" aria-hidden /> Chargement…</div>
        ) : visibles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <Layers3 className="mx-auto mb-3 text-slate-400" size={30} aria-hidden />
            <h3 className="font-bold text-brand-navy">Aucun modèle {afficherArchives ? '' : 'actif'}</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">Créez une offre au kilo ou un forfait de poids. Les modèles ne modifient pas vos tarifs à la pièce existants.</p>
            <button type="button" onClick={ouvrirCreation} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white"><Plus size={16} aria-hidden /> Créer un modèle</button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visibles.map((model) => <CarteModele key={model.id} model={model} onEdit={() => ouvrirEdition(model)} onToggle={() => void basculerActif(model)} />)}
          </div>
        )}
      </section>
    </main>
  )
}

function CarteModele({ model, onEdit, onToggle }: { model: LocalLaundryModel; onEdit: () => void; onToggle: () => void }) {
  const priceText = model.modelType === 'PER_KG'
    ? `${formatFcfa(model.pricePerKg ?? 0)} / kg`
    : model.modelType === 'FAMILY_PACKAGE'
      ? `${formatFcfa(model.packagePrice ?? 0)} jusqu’à ${model.includedPieces ?? 0} pièces`
      : `${formatFcfa(model.packagePrice ?? 0)} jusqu’à ${model.includedWeightKg ?? 0} kg`
  const servicesInclus = model.services.filter((service) => service.inclusionMode === 'INCLUDED')
  const servicesExtra = model.services.filter((service) => service.inclusionMode === 'EXTRA')
  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm ${model.isActive ? 'border-slate-200' : 'border-slate-200 opacity-75'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-brand-teal">
            {model.modelType === 'PER_KG' ? <Scale size={21} aria-hidden /> : <Package size={21} aria-hidden />}
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-bold text-brand-navy">{model.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{typeLabel(model.modelType)} · {audienceLabel(model.audience)}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${model.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{model.isActive ? 'Actif' : 'Archivé'}</span>
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3">
        <p className="text-xl font-extrabold text-brand-navy">{priceText}</p>
        {model.modelType === 'FAMILY_PACKAGE' && model.overagePricePerPiece != null && <p className="mt-1 text-sm text-slate-600">Puis {formatFcfa(model.overagePricePerPiece)} / pièce supplémentaire</p>}
        {model.modelType === 'FAMILY_PACKAGE' && model.overagePricePerPiece == null && <p className="mt-1 text-sm text-amber-700">Au-delà : prix à valider manuellement</p>}
        {model.modelType === 'WEIGHT_PACKAGE' && model.overagePricePerKg !== null && <p className="mt-1 text-sm text-slate-600">Puis {formatFcfa(model.overagePricePerKg)} / kg supplémentaire</p>}
        {model.modelType === 'WEIGHT_PACKAGE' && model.overagePricePerKg === null && <p className="mt-1 text-sm text-amber-700">Au-delà : prix à valider manuellement</p>}
        {model.modelType === 'FAMILY_PACKAGE' && <p className="mt-1 text-sm text-slate-600">{(model.familyPackageScope ?? []).length === 0 ? 'Tous les articles actifs' : `${(model.familyPackageArticles ?? []).length} article(s) admissible(s)`}</p>}
        {model.modelType === 'PER_KG' && model.minimumWeightKg !== null && <p className="mt-1 text-sm text-slate-600">Minimum {model.minimumWeightKg} kg</p>}
        {model.minimumCharge !== null && <p className="mt-1 text-sm text-slate-600">Minimum facturable : {formatFcfa(model.minimumCharge)}</p>}
      </div>

      {model.description && <p className="mt-3 text-sm text-slate-600">{model.description}</p>}
      <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        {model.turnaroundDays !== null && <p className="flex items-center gap-2"><Clock3 size={15} aria-hidden /> Délai indicatif : {model.turnaroundDays} j</p>}
        {model.pickupDeliveryTerms && <p className="flex items-start gap-2"><Truck size={15} className="mt-0.5 shrink-0" aria-hidden /> {model.pickupDeliveryTerms}</p>}
      </div>
      {model.conditions && <p className="mt-3 text-sm"><strong className="text-slate-700">Conditions :</strong> <span className="text-slate-600">{model.conditions}</span></p>}
      {model.exclusions && <p className="mt-2 text-sm"><strong className="text-slate-700">Exclusions :</strong> <span className="text-slate-600">{model.exclusions}</span></p>}
      {(servicesInclus.length > 0 || servicesExtra.length > 0) && (
        <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
          {servicesInclus.length > 0 && <p><strong className="text-slate-700">Inclus :</strong> {servicesInclus.map((service) => service.serviceName).join(', ')}</p>}
          {servicesExtra.length > 0 && <p><strong className="text-slate-700">En supplément :</strong> {servicesExtra.map((service) => service.serviceName).join(', ')}</p>}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={onEdit} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Pencil size={15} aria-hidden /> Modifier</button>
        <button type="button" onClick={onToggle} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${model.isActive ? 'border border-amber-200 text-amber-800 hover:bg-amber-50' : 'border border-emerald-200 text-emerald-800 hover:bg-emerald-50'}`}>
          {model.isActive ? <><Archive size={15} aria-hidden /> Archiver</> : <><RefreshCw size={15} aria-hidden /> Réactiver</>}
        </button>
      </div>
    </article>
  )
}
