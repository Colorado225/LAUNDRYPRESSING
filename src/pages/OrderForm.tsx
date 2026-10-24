import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Lock,
  PenLine,
  Plus,
  Package,
  Scale,
  Trash2,
  UserRound,
  Shirt,
  Wallet,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useCreateOrder, useLocalOrders } from '@/db/hooks'
import { suggestCustomersByPhone } from '@/lib/customerSuggestions'
import { createOrderSchema, zodMessages, type OrderItemInput } from '@/schemas/order'
import { formatFcfa } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import {
  getCachedCatalog,
  refreshCatalog,
  servicesForArticle,
  uniqueArticles,
} from '@/db/catalogRepository'
import type { LocalCatalogEntry, LocalLaundryModel } from '@/db/localDb'
import { getCachedLaundryModels, refreshLaundryModels } from '@/db/laundryModelsRepository'
import type {
  CatalogBillingUnit,
  CatalogPricingMode,
  OrderItemPriceStatus,
} from '@/types/database'
import { calculerTarif, libelleUnite } from '@/lib/catalogPricing'
import { calculateLaundryModelPrice } from '@/lib/laundryModelPricing'

/**
 * Création de commande — 100 % locale, en trois étapes.
 *
 * Aucun appel réseau n'est effectué pour enregistrer la commande : elle est
 * écrite dans IndexedDB puis envoyée par le moteur de synchronisation dès que
 * la connexion revient. C'est le cœur du fonctionnement en mode avion.
 *
 * Découpage **Client → Vêtements → Paiement** : sur une tablette de comptoir,
 * un formulaire unique oblige à faire défiler pour retrouver un champ oublié.
 * Chaque étape est validée séparément, ce qui permet de signaler une erreur de
 * téléphone sans perdre les vêtements déjà saisis.
 *
 * Palier 2 : les lignes peuvent venir du **catalogue** (prix proposé,
 * corrigeable) ou être saisies **librement**. Dans les deux cas, le libellé et
 * le prix sont recopiés sur la ligne : une modification ultérieure du catalogue
 * ne change jamais une commande déjà enregistrée.
 */

const EMPTY_ITEM: OrderItemDraft = {
  mode: 'catalog',
  label: '',
  fabricType: '',
  specialInstructions: '',
  price: 0,
  quantity: 1,
  billedQuantity: 1,
  billingUnit: 'PIECE',
  unitPrice: 0,
  pricingMode: 'FIXED',
  priceStatus: 'CONFIRMED',
  catalogEntryId: undefined,
  articleName: undefined,
  serviceName: undefined,
  familyNameSnapshot: null,
  catalogUnitPriceSnapshot: null,
  minimumQuantitySnapshot: null,
  billingIncrementSnapshot: null,
  minimumChargeSnapshot: null,
  conditionsSnapshot: null,
  priceReason: undefined,
  laundryModelId: null,
  laundryModelNameSnapshot: null,
  laundryModelTypeSnapshot: null,
  laundryWeightKg: null,
  laundryPriceBreakdownSnapshot: null,
  laundryServicesSnapshot: null,
  laundryPricePerKgSnapshot: null,
  laundryPackagePriceSnapshot: null,
  laundryIncludedWeightKgSnapshot: null,
  laundryOveragePricePerKgSnapshot: null,
  laundryMinimumWeightKgSnapshot: null,
  laundryBillingIncrementKgSnapshot: null,
  laundryMinimumChargeSnapshot: null,
  familyPackageSnapshot: null,
}

interface OrderItemDraft extends OrderItemInput {
  mode: 'catalog' | 'free' | 'laundry'
  quantity: number
  billedQuantity: number
  billingUnit: CatalogBillingUnit
  unitPrice: number
  pricingMode: CatalogPricingMode
  priceStatus: OrderItemPriceStatus
  familyNameSnapshot: string | null
  catalogUnitPriceSnapshot: number | null
  minimumQuantitySnapshot: number | null
  billingIncrementSnapshot: number | null
  minimumChargeSnapshot: number | null
  conditionsSnapshot: string | null
}

/** Règlement choisi à l'étape 3 ; aucun argent ne circule ici. */
type Paiement = 'plus-tard' | 'especes'

const ETAPES = [
  { titre: 'Client', icon: UserRound },
  { titre: 'Lignes', icon: Shirt },
  { titre: 'Paiement', icon: Wallet },
] as const

function etiquetteTarif(entree: LocalCatalogEntry): string {
  if (entree.pricingMode === 'QUOTE') return 'Sur devis'
  const prix = formatFcfa(entree.price)
  const prefixe = entree.pricingMode === 'FROM' ? 'À partir de ' : ''
  return `${prefixe}${prix} / ${libelleUnite(entree.billingUnit)}`
}

const clientSchema = createOrderSchema.pick({ customerName: true, customerPhone: true, dueDate: true })
const articlesSchema = createOrderSchema.pick({ items: true })

export default function OrderForm() {
  const navigate = useNavigate()
  const createOrder = useCreateOrder()
  const localOrders = useLocalOrders()
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const canCreate = can(role, 'orders.create')

  const [etape, setEtape] = useState(0)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [existingCustomerSelected, setExistingCustomerSelected] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [items, setItems] = useState<OrderItemDraft[]>([{ ...EMPTY_ITEM }])
  const [paiement, setPaiement] = useState<Paiement>('plus-tard')
  const [catalog, setCatalog] = useState<LocalCatalogEntry[]>([])
  const [commercialModels, setCommercialModels] = useState<LocalLaundryModel[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Catalogue : copie locale immédiatement, rafraîchissement en arrière-plan.
  // Hors ligne, la copie existante reste utilisable — c'est tout l'intérêt.
  useEffect(() => {
    if (!tenantId) return

    let actif = true

    void getCachedCatalog(tenantId).then((entrees) => {
      if (actif) setCatalog(entrees)
    })

    void refreshCatalog(tenantId).then((reussi) => {
      if (!reussi || !actif) return
      void getCachedCatalog(tenantId).then((entrees) => {
        if (actif) setCatalog(entrees)
      })
    })

    return () => {
      actif = false
    }
  }, [tenantId])

  // Les modèles sont également lisibles hors ligne ; le serveur vérifiera
  // leur activation et le montant au moment de la synchronisation.
  useEffect(() => {
    if (!tenantId) return
    let actif = true
    void getCachedLaundryModels(tenantId).then((models) => {
      if (actif) setCommercialModels(models)
    })
    void refreshLaundryModels(tenantId).then((models) => {
      if (actif) setCommercialModels(models)
    }).catch(() => undefined)
    return () => { actif = false }
  }, [tenantId])

  const articles = useMemo(() => uniqueArticles(catalog), [catalog])
  const catalogueDisponible = articles.length > 0
  const tarifsActifsExistants = catalog.some((entree) => entree.isActive)

  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.price) ? item.price : 0), 0)
  const hasUnconfirmedPrice = items.some((item) => item.priceStatus === 'ESTIMATED')
  const customerSuggestions = useMemo(
    () => suggestCustomersByPhone(localOrders ?? [], customerPhone),
    [localOrders, customerPhone],
  )

  // L'onglet est masqué pour l'artisan, mais une URL saisie à la main ne doit
  // pas contourner la règle — le serveur la refuserait de toute façon (RLS).
  if (!canCreate) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <Lock className="mx-auto text-slate-400" size={28} aria-hidden />
        <h1 className="mt-3 text-lg font-bold text-brand-navy">Création réservée au comptoir</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Votre rôle ne permet pas d’enregistrer une nouvelle commande. Demandez au
          propriétaire du pressing de modifier votre accès si nécessaire.
        </p>
        <button
          type="button"
          onClick={() => navigate('/commandes')}
          className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-bold text-white"
        >
          <ArrowLeft size={16} aria-hidden />
          Retour aux commandes
        </button>
      </div>
    )
  }

  const updateItem = (index: number, patch: Partial<OrderItemDraft>) => {
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item
        const next = { ...item, ...patch }

        if (next.laundryModelId && next.laundryModelTypeSnapshot === 'FAMILY_PACKAGE') {
          const snapshot = next.familyPackageSnapshot
          if (!snapshot) return next
          const pieceCount = snapshot.contents.reduce((sum, content) => sum + content.quantity, 0)
          const overage = Math.max(0, pieceCount - snapshot.includedPieces)
          const derivedPrice = overage === 0
            ? Math.max(snapshot.packagePrice, snapshot.minimumCharge ?? 0)
            : snapshot.overagePricePerPiece !== null
              ? Math.max(snapshot.packagePrice + overage * snapshot.overagePricePerPiece, snapshot.minimumCharge ?? 0)
              : snapshot.manualTotalPrice ?? 0
          const requiresQuote = overage > 0 && snapshot.overagePricePerPiece === null
          const compositionChanged = patch.familyPackageSnapshot != null &&
            JSON.stringify(patch.familyPackageSnapshot.contents) !== JSON.stringify(snapshot.contents)
          const manualTotalPrice = patch.unitPrice !== undefined
            ? patch.unitPrice
            : compositionChanged
              ? null
              : snapshot.manualTotalPrice
          const updatedSnapshot = { ...snapshot, pieceCount, manualTotalPrice: requiresQuote ? manualTotalPrice : null }
          const amount = requiresQuote ? updatedSnapshot.manualTotalPrice ?? 0 : derivedPrice
          const breakdown = `${pieceCount} pièce(s) · ${snapshot.includedPieces} incluse(s)${overage > 0 ? ` · ${overage} supplémentaire(s)` : ''}`
          return {
            ...next,
            label: snapshot.modelName,
            familyPackageSnapshot: updatedSnapshot,
            quantity: 1,
            billedQuantity: 1,
            billingUnit: 'FLAT',
            unitPrice: amount,
            price: amount,
            pricingMode: requiresQuote ? 'QUOTE' : 'FIXED',
            priceStatus: amount > 0 && amount >= snapshot.packagePrice ? 'CONFIRMED' : 'ESTIMATED',
            laundryWeightKg: null,
            laundryPackagePriceSnapshot: snapshot.packagePrice,
            laundryPriceBreakdownSnapshot: breakdown,
          }
        }

        if (next.laundryModelId && next.laundryModelTypeSnapshot) {
          if (next.laundryModelTypeSnapshot === 'PER_KG') {
            if (patch.quantity !== undefined) next.laundryWeightKg = next.quantity
            if (patch.laundryWeightKg !== undefined) next.quantity = next.laundryWeightKg ?? 0
          }
          if (next.laundryModelTypeSnapshot === 'WEIGHT_PACKAGE') {
            next.quantity = 1
            if (patch.unitPrice !== undefined) {
              return { ...next, price: next.unitPrice, billedQuantity: 1 }
            }
          }
          const poids = next.laundryWeightKg ?? 0
          if (poids <= 0 || !Number.isFinite(poids)) {
            return { ...next, price: 0, billedQuantity: next.laundryModelTypeSnapshot === 'PER_KG' ? 0 : 1 }
          }
          try {
            const result = calculateLaundryModelPrice({
              model_type: next.laundryModelTypeSnapshot,
              price_per_kg: next.laundryPricePerKgSnapshot ?? null,
              package_price: next.laundryPackagePriceSnapshot ?? null,
              included_weight_kg: next.laundryIncludedWeightKgSnapshot ?? null,
              overage_price_per_kg: next.laundryOveragePricePerKgSnapshot ?? null,
              minimum_weight_kg: next.laundryMinimumWeightKgSnapshot ?? null,
              billing_increment_kg: next.laundryBillingIncrementKgSnapshot ?? null,
              minimum_charge: next.laundryMinimumChargeSnapshot ?? null,
            }, poids)
            if (next.laundryModelTypeSnapshot === 'PER_KG') {
              if (result.status === 'PRICED') {
                return {
                  ...next,
                  quantity: poids,
                  unitPrice: next.laundryPricePerKgSnapshot ?? 0,
                  price: result.amount,
                  billedQuantity: result.billedWeightKg,
                  laundryPriceBreakdownSnapshot: result.breakdown,
                }
              }
            } else if (result.status === 'PRICED') {
              return {
                ...next,
                quantity: 1,
                unitPrice: result.amount,
                price: result.amount,
                billedQuantity: 1,
                pricingMode: 'FIXED',
                priceStatus: 'CONFIRMED',
                laundryPriceBreakdownSnapshot: result.breakdown,
              }
            } else {
              return {
                ...next,
                quantity: 1,
                price: next.unitPrice,
                billedQuantity: 1,
                pricingMode: 'QUOTE',
                priceStatus: patch.priceStatus ?? 'ESTIMATED',
                laundryPriceBreakdownSnapshot: result.breakdown,
              }
            }
          } catch {
            return { ...next, price: 0, billedQuantity: Math.max(0, next.quantity) }
          }
        }

        if (next.quantity <= 0 || next.unitPrice <= 0) {
          return { ...next, price: 0, billedQuantity: Math.max(0, next.quantity) }
        }
        try {
          const calculation = calculerTarif({
            quantite: next.quantity,
            prixUnitaire: next.unitPrice,
            unite: next.billingUnit,
            quantiteMinimum: next.minimumQuantitySnapshot,
            increment: next.billingIncrementSnapshot,
            minimumFacturable: next.minimumChargeSnapshot,
          })
          return { ...next, price: calculation.total, billedQuantity: calculation.quantiteFacturee }
        } catch {
          return { ...next, price: 0, billedQuantity: Math.max(0, next.quantity) }
        }
      }),
    )
  }

  const addItem = () =>
    setItems((current) => [
      ...current,
      { ...EMPTY_ITEM, mode: catalogueDisponible ? 'catalog' : 'free' },
    ])

  const removeItem = (index: number) => {
    setItems((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)))
  }

  const appliquerPrestation = (index: number, entree: LocalCatalogEntry) => {
    updateItem(index, {
      mode: 'catalog',
      catalogEntryId: entree.id,
      articleName: entree.article,
      serviceName: entree.service,
      familyNameSnapshot: entree.familyName,
      catalogUnitPriceSnapshot: entree.price,
      minimumQuantitySnapshot: entree.minimumQuantity,
      billingIncrementSnapshot: entree.billingIncrement,
      minimumChargeSnapshot: entree.minimumCharge,
      conditionsSnapshot: entree.conditions,
      pricingMode: entree.pricingMode,
      billingUnit: entree.billingUnit,
      quantity: 1,
      billedQuantity: 1,
      unitPrice: entree.pricingMode === 'QUOTE' ? 0 : entree.price,
      priceStatus: entree.pricingMode === 'QUOTE' ? 'ESTIMATED' : 'CONFIRMED',
      priceReason: undefined,
      laundryModelId: null,
      laundryModelNameSnapshot: null,
      laundryModelTypeSnapshot: null,
      laundryWeightKg: null,
      laundryPriceBreakdownSnapshot: null,
      laundryServicesSnapshot: null,
      laundryPricePerKgSnapshot: null,
      laundryPackagePriceSnapshot: null,
      laundryIncludedWeightKgSnapshot: null,
      laundryOveragePricePerKgSnapshot: null,
      laundryMinimumWeightKgSnapshot: null,
      laundryBillingIncrementKgSnapshot: null,
      laundryMinimumChargeSnapshot: null,
      familyPackageSnapshot: null,
      label: `${entree.article} — ${entree.service}`,
    })
  }

  const choisirArticle = (index: number, article: string) => {
    const premiere = servicesForArticle(catalog, article)[0]
    if (premiere) appliquerPrestation(index, premiere)
  }

  const choisirPrestation = (index: number, entryId: string) => {
    const entree = catalog.find((candidate) => candidate.id === entryId)
    if (entree) appliquerPrestation(index, entree)
  }

  const appliquerModeleCommercial = (index: number, model: LocalLaundryModel, poids = 1) => {
    if (model.modelType === 'FAMILY_PACKAGE') {
      if (!model.packagePrice || !model.includedPieces) {
        toast.error('Ce forfait famille n’a pas de prix ou de nombre de pièces configuré.')
        return
      }
      const snapshot = {
        modelId: model.id,
        modelName: model.name,
        packagePrice: model.packagePrice,
        includedPieces: model.includedPieces,
        overagePricePerPiece: model.overagePricePerPiece ?? null,
        minimumCharge: model.minimumCharge,
        pieceCount: 0,
        manualTotalPrice: null,
        contents: [],
      }
      updateItem(index, {
        mode: 'laundry',
        label: model.name,
        fabricType: '',
        specialInstructions: '',
        price: 0,
        quantity: 1,
        billedQuantity: 1,
        billingUnit: 'FLAT',
        unitPrice: 0,
        pricingMode: 'FIXED',
        priceStatus: 'ESTIMATED',
        catalogEntryId: undefined,
        articleName: undefined,
        serviceName: 'Forfait famille',
        familyNameSnapshot: null,
        catalogUnitPriceSnapshot: null,
        minimumQuantitySnapshot: null,
        billingIncrementSnapshot: null,
        minimumChargeSnapshot: null,
        conditionsSnapshot: model.conditions,
        priceReason: `Forfait famille : ${model.name}`,
        laundryModelId: model.id,
        laundryModelNameSnapshot: model.name,
        laundryModelTypeSnapshot: model.modelType,
        laundryWeightKg: null,
        laundryPriceBreakdownSnapshot: 'Sélectionnez les articles et leurs quantités.',
        laundryServicesSnapshot: model.services.length === 0 ? null : model.services.map((service) => service.serviceName).join(', '),
        laundryPricePerKgSnapshot: null,
        laundryPackagePriceSnapshot: model.packagePrice,
        laundryIncludedWeightKgSnapshot: null,
        laundryOveragePricePerKgSnapshot: null,
        laundryMinimumWeightKgSnapshot: null,
        laundryBillingIncrementKgSnapshot: null,
        laundryMinimumChargeSnapshot: model.minimumCharge,
        familyPackageSnapshot: snapshot,
      })
      return
    }
    const result = calculateLaundryModelPrice({
      model_type: model.modelType,
      price_per_kg: model.pricePerKg,
      package_price: model.packagePrice,
      included_weight_kg: model.includedWeightKg,
      overage_price_per_kg: model.overagePricePerKg,
      minimum_weight_kg: model.minimumWeightKg,
      billing_increment_kg: model.billingIncrementKg,
      minimum_charge: model.minimumCharge,
    }, poids)
    const amount = result.status === 'PRICED' ? result.amount : 0
    const unitPrice = model.modelType === 'PER_KG' ? model.pricePerKg ?? 0 : amount
    const servicesSnapshot = model.services.length === 0
      ? 'Aucune prestation associée'
      : model.services.map((service) => `${service.inclusionMode === 'INCLUDED' ? 'Inclus' : 'Supplément'} : ${service.serviceName}`).join(', ').slice(0, 1000)

    updateItem(index, {
      mode: 'laundry',
      label: model.name,
      fabricType: '',
      specialInstructions: '',
      price: amount,
      quantity: model.modelType === 'PER_KG' ? poids : 1,
      billedQuantity: model.modelType === 'PER_KG' && result.status === 'PRICED' ? result.billedWeightKg : 1,
      billingUnit: model.modelType === 'PER_KG' ? 'KG' : 'FLAT',
      unitPrice,
      pricingMode: result.status === 'QUOTE' ? 'QUOTE' : 'FIXED',
      priceStatus: result.status === 'QUOTE' ? 'ESTIMATED' : 'CONFIRMED',
      catalogEntryId: undefined,
      articleName: undefined,
      serviceName: model.modelType === 'PER_KG' ? 'Prestation au kilo' : 'Forfait de poids',
      familyNameSnapshot: null,
      catalogUnitPriceSnapshot: null,
      minimumQuantitySnapshot: model.modelType === 'PER_KG' ? model.minimumWeightKg : null,
      billingIncrementSnapshot: model.modelType === 'PER_KG' ? model.billingIncrementKg : null,
      minimumChargeSnapshot: model.modelType === 'PER_KG' ? model.minimumCharge : null,
      conditionsSnapshot: model.conditions,
      priceReason: `Modèle commercial : ${model.name}`,
      laundryModelId: model.id,
      laundryModelNameSnapshot: model.name,
      laundryModelTypeSnapshot: model.modelType,
      laundryWeightKg: poids,
      laundryPriceBreakdownSnapshot: result.breakdown,
      laundryServicesSnapshot: servicesSnapshot,
      laundryPricePerKgSnapshot: model.pricePerKg,
      laundryPackagePriceSnapshot: model.packagePrice,
      laundryIncludedWeightKgSnapshot: model.includedWeightKg,
      laundryOveragePricePerKgSnapshot: model.overagePricePerKg,
      laundryMinimumWeightKgSnapshot: model.minimumWeightKg,
      laundryBillingIncrementKgSnapshot: model.billingIncrementKg,
      laundryMinimumChargeSnapshot: model.minimumCharge,
      familyPackageSnapshot: null,
    })
  }

  const choisirModeleCommercial = (index: number, modelId: string) => {
    const model = commercialModels.find((candidate) => candidate.id === modelId && candidate.isActive)
    if (model) appliquerModeleCommercial(index, model)
  }

  const basculerMode = (index: number, mode: 'catalog' | 'free' | 'laundry') => {
    const current = items[index]
    if (!current) return
    if (mode === 'laundry') {
      const firstModel = commercialModels.find((model) => model.isActive)
      if (firstModel) appliquerModeleCommercial(index, firstModel)
      return
    }
    if (mode === 'free') {
      const tarifLibre = current.price > 0 ? current.price : current.unitPrice
      updateItem(index, {
        mode,
        catalogEntryId: undefined,
        articleName: undefined,
        serviceName: undefined,
        familyNameSnapshot: null,
        catalogUnitPriceSnapshot: null,
        minimumQuantitySnapshot: null,
        billingIncrementSnapshot: null,
        minimumChargeSnapshot: null,
        conditionsSnapshot: null,
        pricingMode: 'FIXED',
        billingUnit: 'PIECE',
        quantity: 1,
        billedQuantity: 1,
        unitPrice: tarifLibre,
        priceStatus: 'CONFIRMED',
        priceReason: undefined,
        laundryModelId: null,
        laundryModelNameSnapshot: null,
        laundryModelTypeSnapshot: null,
        laundryWeightKg: null,
        laundryPriceBreakdownSnapshot: null,
        laundryServicesSnapshot: null,
        laundryPricePerKgSnapshot: null,
        laundryPackagePriceSnapshot: null,
        laundryIncludedWeightKgSnapshot: null,
        laundryOveragePricePerKgSnapshot: null,
        laundryMinimumWeightKgSnapshot: null,
        laundryBillingIncrementKgSnapshot: null,
        laundryMinimumChargeSnapshot: null,
        familyPackageSnapshot: null,
      })
      return
    }

    const article = current.articleName ?? articles[0]
    if (!article) return
    choisirArticle(index, article)
  }

  /**
   * Contrôles de l'étape courante, exécutés avant de passer à la suivante.
   *
   * Le serveur revérifie tout (contraintes SQL) ; ces contrôles servent à
   * signaler l'erreur au bon moment, sur le champ concerné.
   */
  const validerEtape = (numero: number): boolean => {
    setErrors([])

    if (numero === 0) {
      const parsed = clientSchema.safeParse({
        customerName,
        customerPhone,
        dueDate: dueDate || undefined,
      })

      if (!parsed.success) {
        setErrors(zodMessages(parsed.error))
        return false
      }
      return true
    }

    if (numero === 1) {
      const lignes: OrderItemInput[] = items.map(({ mode: _mode, ...item }) => item)
      const parsed = articlesSchema.safeParse({ items: lignes })

      if (!parsed.success) {
        setErrors(zodMessages(parsed.error))
        return false
      }

      // Un prix inférieur ou égal à zéro n'a pas de sens au comptoir : il
      // donnerait une commande gratuite par simple oubli de saisie.
      const sansPrix = items.findIndex((item) => item.price <= 0)
      if (sansPrix >= 0) {
        setErrors([`Ligne ${sansPrix + 1} : indiquez un prix supérieur à zéro.`])
        return false
      }

      // Tarif dérogatoire : le serveur refuse un prix différent du catalogue
      // sans motif (22023). On bloque ici pour éviter un aller-retour inutile.
      const derogeSansMotif = items.findIndex((item) =>
        item.mode === 'catalog' &&
        item.pricingMode !== 'QUOTE' &&
        item.catalogUnitPriceSnapshot !== null &&
        item.unitPrice !== item.catalogUnitPriceSnapshot &&
        (item.priceReason ?? '').trim().length < 10,
      )

      if (derogeSansMotif >= 0) {
        setErrors([
          `Ligne ${derogeSansMotif + 1} : un prix différent du catalogue exige un motif de 10 caractères minimum (geste commercial, tache, retouche…).`,
        ])
        return false
      }

      const sousLeMinimum = items.findIndex(
        (item) =>
          item.pricingMode === 'FROM' &&
          item.catalogUnitPriceSnapshot !== null &&
          item.unitPrice < item.catalogUnitPriceSnapshot,
      )
      if (sousLeMinimum >= 0) {
        setErrors([`Ligne ${sousLeMinimum + 1} : le tarif ne peut pas être inférieur au minimum annoncé.`])
        return false
      }

      return true
    }

    return true
  }

  const suivant = () => {
    if (!validerEtape(etape)) return
    setEtape((courante) => Math.min(courante + 1, ETAPES.length - 1))
  }

  const precedent = () => {
    setErrors([])
    setEtape((courante) => Math.max(courante - 1, 0))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    // Les étapes sont revérifiées : un champ vidé après coup ne doit pas
    // passer. On ramène l'utilisateur sur celle qui bloque, sinon le message
    // s'afficherait sans champ visible pour le corriger.
    if (!validerEtape(0)) {
      setEtape(0)
      return
    }

    if (!validerEtape(1)) {
      setEtape(1)
      return
    }

    const lignes: OrderItemInput[] = items.map(({ mode: _mode, ...item }) => item)

    const parsed = createOrderSchema.safeParse({
      customerName,
      customerPhone,
      items: lignes,
      dueDate: dueDate || undefined,
    })

    if (!parsed.success) {
      setErrors(zodMessages(parsed.error))
      return
    }

    setSubmitting(true)
    try {
      const { order } = await createOrder(parsed.data)
      toast.success('Commande enregistrée sur cet appareil', { icon: '✅' })
      // « Espèces » n'encaisse rien ici : la commande doit exister pour porter
      // le paiement. On ouvre donc sa fiche avec le panneau déjà déplié.
      navigate(`/commandes/${order.id}${paiement === 'especes' ? '?regler=1' : ''}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'enregistrer la commande",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate('/commandes')}
        className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-600 hover:text-brand-navy active:text-brand-navy"
      >
        <ArrowLeft size={16} aria-hidden />
        Retour aux commandes
      </button>

      <h1 className="text-xl font-bold text-brand-navy sm:text-2xl">Nouvelle commande</h1>

      <Stepper etape={etape} />

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* -------------------------------------------------- 1. Client ---- */}
        {etape === 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Client</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Nom du client" htmlFor="customer-name">
                <input
                  id="customer-name"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  autoComplete="name"
                  autoFocus
                  placeholder="Aya Koné"
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
                />
              </Field>

              <Field label="Téléphone" htmlFor="customer-phone">
                <input
                  id="customer-phone"
                  value={customerPhone}
                  onChange={(event) => {
                    setCustomerPhone(event.target.value)
                    setExistingCustomerSelected(false)
                  }}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="07 00 00 00 00"
                  aria-describedby="customer-phone-help"
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
                />
                {!existingCustomerSelected && customerSuggestions.length > 0 && (
                  <ul className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Clients déjà rencontrés">
                    {customerSuggestions.map((suggestion) => (
                      <li key={suggestion.normalizedPhone}>
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerName(suggestion.name)
                            setCustomerPhone(suggestion.phone)
                            setExistingCustomerSelected(true)
                            setErrors([])
                          }}
                          className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-teal-50 active:bg-teal-100"
                          aria-label={`Utiliser ${suggestion.name}, ${suggestion.phone}`}
                        >
                          <span className="font-semibold text-slate-800">{suggestion.name}</span>
                          <span className="shrink-0 text-slate-500">{suggestion.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p id="customer-phone-help" className="mt-1 text-xs text-slate-500">
                  10 chiffres, par exemple 07 00 00 00 00. Les suggestions viennent des commandes de cette tablette.
                </p>
              </Field>

              <Field
                label="Livraison promise"
                htmlFor="due-date"
                hint="Facultatif — sert aux alertes de retard"
              >
                <input
                  id="due-date"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
                />
              </Field>
            </div>

            <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              Un numéro déjà utilisé propose les coordonnées des commandes précédentes de cette
              tablette. La nouvelle commande reste indépendante et n’écrase jamais l’historique.
            </p>
          </section>
        )}

        {/* ----------------------------------------------- 2. Vêtements ---- */}
        {etape === 1 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Lignes de commande
              </h2>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:border-brand-teal active:bg-slate-50"
              >
                <Plus size={16} aria-hidden />
                Ajouter une ligne
              </button>
            </div>

            {!catalogueDisponible && (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                {tarifsActifsExistants
                  ? 'Aucun tarif actif n’est encore utilisable : les tarifs hérités doivent être confirmés ou les unités configurées. Une ligne libre reste possible avec un motif obligatoire.'
                  : 'Aucune prestation active au catalogue : une ligne libre peut être saisie, avec un motif obligatoire de 10 caractères minimum.'}
              </p>
            )}

            <ul className="mt-3 space-y-3">
              {items.map((item, index) => (
                <li key={index} className="rounded-xl bg-slate-50 p-3">
                  <div className="mb-3 flex flex-wrap gap-2">
                    {catalogueDisponible && <ModeButton
                      actif={item.mode === 'catalog'}
                      onClick={() => basculerMode(index, 'catalog')}
                      icon={<BookOpen size={14} aria-hidden />}
                      label="Catalogue à la pièce"
                    />}
                    <ModeButton
                      actif={item.mode === 'free' || (item.mode === 'catalog' && !catalogueDisponible)}
                      onClick={() => basculerMode(index, 'free')}
                      icon={<PenLine size={14} aria-hidden />}
                      label="Saisie libre"
                    />
                    {commercialModels.some((model) => model.isActive) && <ModeButton
                      actif={item.mode === 'laundry'}
                      onClick={() => basculerMode(index, 'laundry')}
                      icon={item.laundryModelTypeSnapshot === 'PER_KG' ? <Scale size={14} aria-hidden /> : <Package size={14} aria-hidden />}
                      label="Au kilo / forfait"
                    />}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {item.mode === 'laundry' ? (
                      <>
                        <Field label="Modèle commercial" htmlFor={`item-laundry-model-${index}`}>
                          <select
                            id={`item-laundry-model-${index}`}
                            value={item.laundryModelId ?? ''}
                            onChange={(event) => choisirModeleCommercial(index, event.target.value)}
                            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                          >
                            {commercialModels.filter((model) => model.isActive).map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.name} — {model.modelType === 'PER_KG' ? `${formatFcfa(model.pricePerKg ?? 0)} / kg` : model.modelType === 'FAMILY_PACKAGE' ? `${formatFcfa(model.packagePrice ?? 0)} / forfait · ${model.includedPieces ?? 0} pièces incluses` : `${formatFcfa(model.packagePrice ?? 0)} / forfait`}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {item.laundryModelTypeSnapshot === 'FAMILY_PACKAGE' ? (
                          <div className="space-y-3 sm:col-span-2">
                            <div>
                              <h3 className="text-sm font-bold text-brand-navy">Composition détaillée du forfait</h3>
                              <p className="mt-1 text-xs text-slate-600">Saisissez le nombre de pièces de chaque article. Prix global : {formatFcfa(item.familyPackageSnapshot?.packagePrice ?? 0)} pour {item.familyPackageSnapshot?.includedPieces ?? 0} pièce(s).</p>
                            </div>
                            {(commercialModels.find((model) => model.id === item.laundryModelId)?.familyPackageArticles ?? []).length === 0 ? (
                              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Aucun article actif dans le périmètre de ce forfait. Actualisez le catalogue ou modifiez son périmètre.</p>
                            ) : (
                              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                                {(commercialModels.find((model) => model.id === item.laundryModelId)?.familyPackageArticles ?? []).map((article) => {
                                  const snapshot = item.familyPackageSnapshot
                                  const selected = snapshot?.contents.find((content) => content.articleId === article.articleId)
                                  return (
                                    <div key={article.articleId} className="grid grid-cols-[1fr_92px] items-center gap-3 p-3">
                                      <div>
                                        <p className="text-sm font-semibold text-slate-800">{article.articleName} <span className="font-normal text-slate-500">· {article.familyName}</span></p>
                                        {article.careInstructions && <p className="mt-0.5 text-xs text-slate-500">{article.careInstructions}</p>}
                                      </div>
                                      <label className="text-xs font-semibold text-slate-600">
                                        Quantité
                                        <input id={`item-family-article-${index}-${article.articleId}`} type="number" min={0} max={1000} step={1} value={selected?.quantity ?? 0} onChange={(event) => {
                                          const quantity = event.target.value === '' ? 0 : Number(event.target.value)
                                          const contents = (snapshot?.contents ?? []).filter((content) => content.articleId !== article.articleId)
                                          if (quantity > 0) contents.push({ articleId: article.articleId, articleName: article.articleName, familyName: article.familyName, quantity, careInstructions: article.careInstructions })
                                          updateItem(index, { familyPackageSnapshot: snapshot ? { ...snapshot, contents } : null })
                                        }} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2 text-base" />
                                      </label>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                            <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-brand-navy">{item.familyPackageSnapshot?.pieceCount ?? 0} pièce(s) · Total du forfait : {formatFcfa(item.price)}</p>
                            {item.familyPackageSnapshot && item.familyPackageSnapshot.pieceCount > item.familyPackageSnapshot.includedPieces && item.familyPackageSnapshot.overagePricePerPiece === null && <p className="text-xs text-amber-800">Les pièces supplémentaires n’ont pas de tarif configuré. Saisissez le prix global confirmé avec le client ci-dessous.</p>}
                          </div>
                        ) : (
                          <Field
                            label="Poids mesuré (kg)"
                            htmlFor={`item-laundry-weight-${index}`}
                            hint={item.laundryPriceBreakdownSnapshot ?? 'Le tarif est calculé selon le modèle sélectionné.'}
                          >
                            <input
                              id={`item-laundry-weight-${index}`}
                              type="number"
                              min={0.001}
                              max={10000}
                              step={0.001}
                              inputMode="decimal"
                              value={item.laundryWeightKg ?? ''}
                              onChange={(event) => updateItem(index, { laundryWeightKg: event.target.value === '' ? 0 : Number(event.target.value) })}
                              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                            />
                          </Field>
                        )}
                        {item.laundryServicesSnapshot && (
                          <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 sm:col-span-2">Prestations : {item.laundryServicesSnapshot}</p>
                        )}
                      </>
                    ) : item.mode === 'catalog' && catalogueDisponible ? (
                      <>
                        <Field label="Article" htmlFor={`item-article-${index}`}>
                          <select
                            id={`item-article-${index}`}
                            value={item.articleName ?? ''}
                            onChange={(event) => choisirArticle(index, event.target.value)}
                            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                          >
                            <option value="">Choisir un article…</option>
                            {articles.map((article) => (
                              <option key={article} value={article}>
                                {article}
                              </option>
                            ))}
                          </select>
                        </Field>

                        <Field label="Prestation" htmlFor={`item-service-${index}`}>
                          <select
                            id={`item-service-${index}`}
                            value={item.catalogEntryId ?? ''}
                            onChange={(event) => choisirPrestation(index, event.target.value)}
                            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                          >
                            <option value="">Choisir une prestation…</option>
                            {servicesForArticle(catalog, item.articleName ?? '').map((entree) => (
                              <option key={entree.id} value={entree.id}>
                                {entree.service} — {etiquetteTarif(entree)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </>
                    ) : (
                      <Field label="Article ou prestation" htmlFor={`item-label-${index}`}>
                        <input
                          id={`item-label-${index}`}
                          value={item.label}
                          onChange={(event) => updateItem(index, { label: event.target.value })}
                          placeholder="Costume 3 pièces"
                          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                        />
                      </Field>
                    )}

                    {item.mode !== 'laundry' && item.billingUnit !== 'FLAT' && (
                      <Field
                        label={`Quantité (${libelleUnite(item.billingUnit)})`}
                        htmlFor={`item-quantity-${index}`}
                        hint={
                          item.minimumQuantitySnapshot || item.billingIncrementSnapshot
                            ? `Minimum ${item.minimumQuantitySnapshot ?? '—'} · pas de ${item.billingIncrementSnapshot ?? '—'}`
                            : undefined
                        }
                      >
                        <input
                          id={`item-quantity-${index}`}
                          type="number"
                          min={1 / 1000}
                          step={['PIECE', 'PAIR', 'SET', 'PACKAGE'].includes(item.billingUnit) ? 1 : 0.001}
                          inputMode="decimal"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(index, {
                              quantity: event.target.value === '' ? 0 : Number(event.target.value),
                            })
                          }
                          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                        />
                      </Field>
                    )}

                    <Field label="Tissu" htmlFor={`item-fabric-${index}`}>
                      <input
                        id={`item-fabric-${index}`}
                        value={item.fabricType ?? ''}
                        onChange={(event) => updateItem(index, { fabricType: event.target.value })}
                        placeholder="Bazin, Wax, laine…"
                        className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                      />
                    </Field>

                    <Field
                      label="Instructions particulières"
                      htmlFor={`item-instructions-${index}`}
                      hint="Empèsage, broderie fragile…"
                    >
                      <input
                        id={`item-instructions-${index}`}
                        value={item.specialInstructions ?? ''}
                        onChange={(event) =>
                          updateItem(index, { specialInstructions: event.target.value })
                        }
                        placeholder="Empèsage fort"
                        className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                      />
                    </Field>

                    <div className="flex items-end gap-2">
                      <Field
                        label={
                          item.mode === 'laundry' && item.laundryModelTypeSnapshot === 'PER_KG'
                            ? 'Tarif du modèle (FCFA/kg)'
                            : item.mode === 'laundry' && item.pricingMode === 'QUOTE'
                              ? 'Montant final à valider (FCFA)'
                              : item.mode === 'laundry'
                                ? 'Montant du forfait (FCFA)'
                                : item.pricingMode === 'QUOTE'
                                  ? 'Montant du devis confirmé (FCFA)'
                                  : `Prix unitaire (${libelleUnite(item.billingUnit)}, FCFA)`
                        }
                        htmlFor={`item-price-${index}`}
                        hint={
                          item.mode === 'laundry'
                            ? item.laundryModelTypeSnapshot === 'PER_KG'
                              ? item.laundryPriceBreakdownSnapshot ?? 'Tarif pris dans le modèle commercial.'
                              : item.pricingMode === 'QUOTE'
                                ? item.laundryModelTypeSnapshot === 'FAMILY_PACKAGE'
                                  ? 'Saisissez le montant global confirmé avec le client pour les pièces supplémentaires.'
                                  : 'Le forfait dépasse le poids inclus : confirmez le prix avec le client.'
                                : item.laundryPriceBreakdownSnapshot ?? 'Montant calculé selon le modèle commercial.'
                            : item.pricingMode === 'QUOTE'
                              ? 'Le devis doit être confirmé avant l’enregistrement.'
                              : item.catalogUnitPriceSnapshot !== null
                              ? `Référence catalogue : ${formatFcfa(item.catalogUnitPriceSnapshot)} par ${libelleUnite(item.billingUnit)}.`
                              : 'Une ligne libre nécessite un motif.'
                        }
                      >
                        <input
                          id={`item-price-${index}`}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={item.unitPrice === 0 ? '' : item.unitPrice}
                          disabled={item.mode === 'laundry' && (item.laundryModelTypeSnapshot === 'FAMILY_PACKAGE' ? item.pricingMode !== 'QUOTE' : item.laundryModelTypeSnapshot === 'PER_KG' || item.pricingMode !== 'QUOTE')}
                          aria-label={item.laundryModelTypeSnapshot === 'FAMILY_PACKAGE' ? 'Prix global confirmé du forfait famille' : undefined}
                          onChange={(event) =>
                            updateItem(index, {
                              unitPrice: event.target.value === '' ? 0 : Number(event.target.value),
                            })
                          }
                          placeholder="5000"
                          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                        />
                      </Field>

                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        disabled={items.length === 1}
                        aria-label={`Supprimer la ligne ${index + 1}`}
                        className="mb-0 inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-40"
                      >
                        <Trash2 size={18} aria-hidden />
                      </button>
                    </div>

                    {['KG', 'M2', 'METER'].includes(item.billingUnit) && (
                      <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={item.priceStatus === 'ESTIMATED'}
                          onChange={(event) =>
                            updateItem(index, {
                              priceStatus: event.target.checked ? 'ESTIMATED' : 'CONFIRMED',
                            })
                          }
                          className="size-4 accent-amber-600"
                        />
                        Poids ou mesure estimé : à confirmer avant le traitement
                      </label>
                    )}

                    {item.pricingMode === 'QUOTE' && item.laundryModelTypeSnapshot !== 'FAMILY_PACKAGE' && (
                      <label className="flex items-center gap-2 rounded-xl border border-brand-teal/30 bg-brand-teal/5 px-3 py-2 text-sm text-brand-navy sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={item.priceStatus === 'CONFIRMED'}
                          disabled={item.unitPrice <= 0}
                          onChange={(event) =>
                            updateItem(index, {
                              priceStatus: event.target.checked ? 'CONFIRMED' : 'ESTIMATED',
                            })
                          }
                          className="size-4 accent-brand-teal"
                        />
                        J’ai confirmé ce montant final avec le client
                      </label>
                    )}

                    {item.price > 0 && (
                      <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 sm:col-span-2">
                        {item.laundryModelId
                          ? item.laundryModelTypeSnapshot === 'FAMILY_PACKAGE' ? `${item.familyPackageSnapshot?.pieceCount ?? 0} pièce(s) · ${item.laundryPriceBreakdownSnapshot ?? 'forfait famille'}` : `${item.laundryWeightKg} kg · ${item.laundryPriceBreakdownSnapshot ?? 'calcul selon modèle'}`
                          : item.billingUnit === 'FLAT'
                            ? 'Forfait × 1'
                            : `${item.quantity} ${libelleUnite(item.billingUnit)} mesuré${item.priceStatus === 'ESTIMATED' ? ' (estimé)' : ''} · ${item.billedQuantity} ${libelleUnite(item.billingUnit)} facturé${item.billingUnit === 'PIECE' ? 'e' : 's'}`}
                        {item.minimumChargeSnapshot && item.price === item.minimumChargeSnapshot
                          ? ` · minimum facturable ${formatFcfa(item.minimumChargeSnapshot)}`
                          : ''}
                        {item.conditionsSnapshot ? ` · ${item.conditionsSnapshot}` : ''}
                      </p>
                    )}

                    {item.mode !== 'laundry' && (item.mode === 'free' ||
                      !item.catalogEntryId ||
                      (item.pricingMode !== 'QUOTE' &&
                        item.catalogUnitPriceSnapshot !== null &&
                        item.unitPrice !== item.catalogUnitPriceSnapshot)) && (
                      <Field
                        label={item.catalogEntryId ? 'Motif du tarif dérogatoire' : 'Motif de la ligne libre'}
                        htmlFor={`item-reason-${index}`}
                        hint={
                          item.catalogEntryId && item.catalogUnitPriceSnapshot !== null
                            ? `Référence catalogue : ${formatFcfa(item.catalogUnitPriceSnapshot)} par ${libelleUnite(item.billingUnit)}. Motif de 10 caractères minimum.`
                            : 'Motif obligatoire (10 caractères minimum) : prestation exceptionnelle, demande client…'
                        }
                      >
                        <input
                          id={`item-reason-${index}`}
                          value={item.priceReason ?? ''}
                          onChange={(event) => updateItem(index, { priceReason: event.target.value })}
                          maxLength={300}
                          placeholder="Demande particulière du client, retouche…"
                          className="min-h-12 w-full rounded-xl border border-amber-300 bg-amber-50 px-3 text-base outline-none focus:border-amber-500"
                        />
                      </Field>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ------------------------------------------------- 3. Paiement ---- */}
        {etape === 2 && (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Récapitulatif
              </h2>

              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">Client</dt>
                  <dd className="font-semibold text-slate-800">{customerName.trim() || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Téléphone</dt>
                  <dd className="font-semibold text-slate-800">{customerPhone.trim() || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Livraison promise</dt>
                  <dd className="font-semibold text-slate-800">{dueDate || 'Non précisée'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Lignes de commande</dt>
                  <dd className="font-semibold text-slate-800">{items.length}</dd>
                </div>
              </dl>

              <ul className="mt-3 divide-y divide-slate-100">
                {items.map((item, index) => (
                  <li key={index} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-800">
                        {item.label || `Ligne ${index + 1}`}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {item.laundryModelId
                          ? item.laundryModelTypeSnapshot === 'FAMILY_PACKAGE'
                            ? `${item.familyPackageSnapshot?.pieceCount ?? 0} pièce(s) · ${item.laundryPriceBreakdownSnapshot ?? 'forfait famille'}${item.priceStatus === 'ESTIMATED' ? ' · À confirmer' : ''}`
                            : `${item.laundryWeightKg} kg · ${item.laundryPriceBreakdownSnapshot ?? 'modèle commercial'}${item.priceStatus === 'ESTIMATED' ? ' · À confirmer' : ''}`
                          : item.billingUnit === 'FLAT'
                            ? `Forfait · ${formatFcfa(item.unitPrice)}`
                            : `${item.quantity} ${libelleUnite(item.billingUnit)} mesuré · ${item.billedQuantity} facturé · ${formatFcfa(item.unitPrice)} / ${libelleUnite(item.billingUnit)}`}
                        {item.priceStatus === 'ESTIMATED' ? ' · ESTIMÉ' : ''}
                      </span>
                      {(item.fabricType || item.specialInstructions) && (
                        <span className="block text-xs text-slate-500">
                          {[item.fabricType, item.specialInstructions].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold text-brand-navy">
                      {formatFcfa(item.price)}
                    </span>
                  </li>
                ))}
              </ul>
              {hasUnconfirmedPrice && (
                <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
                  Le total affiché est estimatif. Confirmez le montant avec le client avant d’enregistrer la commande.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Règlement
              </h2>

              <div className="mt-3 space-y-2">
                <ChoixPaiement
                  actif={paiement === 'plus-tard'}
                  onClick={() => setPaiement('plus-tard')}
                  titre="Régler plus tard"
                  description="La commande est enregistrée, le solde reste dû et apparaît en caisse."
                />
                <ChoixPaiement
                  actif={paiement === 'especes'}
                  onClick={() => setPaiement('especes')}
                  titre="Encaisser des espèces maintenant"
                  description="La fiche s’ouvre avec le panneau d’encaissement déplié, montant pré-rempli."
                />
              </div>

              <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                Le Mobile Money se déclenche depuis la fiche de la commande, une fois celle-ci
                enregistrée : CinetPay exige une référence de commande existante.
              </p>
            </section>
          </>
        )}

        {/* Erreurs */}
        {errors.length > 0 && (
          <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm font-semibold text-rose-900">Vérifiez le formulaire :</p>
            <ul className="mt-1 list-inside list-disc text-sm text-rose-800">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Pied de formulaire */}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {hasUnconfirmedPrice ? 'Total estimé' : 'Total'}
            </p>
            <p className="text-xl font-bold text-brand-navy">{formatFcfa(total)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {etape > 0 && (
              <button
                type="button"
                onClick={precedent}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-base font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ArrowLeft size={18} aria-hidden />
                Précédent
              </button>
            )}

            {etape < ETAPES.length - 1 ? (
              <button
                type="button"
                onClick={suivant}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-5 text-base font-bold text-white transition-colors hover:bg-brand-teal-dark active:bg-brand-teal-dark"
              >
                Suivant
                <ArrowRight size={18} aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-5 text-base font-bold text-white transition-colors hover:bg-brand-teal-dark active:bg-brand-teal-dark disabled:opacity-60"
              >
                <Check size={18} aria-hidden />
                Enregistrer la commande
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}

/**
 * Fil d'étapes.
 *
 * Les étapes déjà franchies redeviennent cliquables : revenir corriger un
 * numéro de téléphone ne doit pas obliger à repasser par « Précédent ».
 */
function Stepper({ etape }: { etape: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Étapes de la commande">
      {ETAPES.map(({ titre, icon: Icone }, index) => {
        const courant = index === etape
        const franchi = index < etape

        return (
          <li key={titre} className="flex items-center gap-2">
            <span
              aria-current={courant ? 'step' : undefined}
              className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${
                courant
                  ? 'bg-brand-teal text-white'
                  : franchi
                    ? 'bg-brand-teal/10 text-brand-navy'
                    : 'bg-white text-slate-500 ring-1 ring-slate-200'
              }`}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                {franchi ? <Check size={14} aria-hidden /> : index + 1}
              </span>
              <Icone size={16} aria-hidden />
              {titre}
            </span>
            {index < ETAPES.length - 1 && (
              <span className="h-px w-4 bg-slate-300" aria-hidden />
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Carte de choix d'un mode de règlement. */
function ChoixPaiement({
  actif,
  onClick,
  titre,
  description,
}: {
  actif: boolean
  onClick: () => void
  titre: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        actif
          ? 'border-brand-teal bg-brand-teal/5'
          : 'border-slate-300 bg-white hover:border-brand-teal'
      }`}
    >
      <span
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
          actif ? 'border-brand-teal' : 'border-slate-300'
        }`}
        aria-hidden
      >
        {actif && <span className="size-2.5 rounded-full bg-brand-teal" />}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-slate-800">{titre}</span>
        <span className="block text-xs leading-relaxed text-slate-500">{description}</span>
      </span>
    </button>
  )
}

function ModeButton({
  actif,
  onClick,
  icon,
  label,
}: {
  actif: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={`inline-flex min-h-12 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
        actif
          ? 'border-brand-teal bg-brand-teal/10 text-brand-navy'
          : 'border-slate-300 bg-white text-slate-600 hover:border-brand-teal'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-600">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
