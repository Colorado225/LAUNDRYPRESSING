import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Minus, Plus, Trash2, UserRound, Shirt, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCreateOrder, useLocalOrders } from '@/db/hooks'
import { suggestCustomersByPhone } from '@/lib/customerSuggestions'
import { signalerIncidentCommande, signalerSonde, syncOrderNow } from '@/sync/syncEngine'
import { createOrderBaseSchema, createOrderSchema, zodMessages, type OrderItemInput } from '@/schemas/order'
import { problemeTarifaire } from '@/lib/orderPricing'
import { formatFcfa } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import {
  fetchTenantServiceConfiguration,
  type TenantActivity,
  type TenantServiceOffering,
} from '@/services/tenantServices'
import { GARMENT_TYPES, formatGarmentComposition } from '@/constants/garmentTypes'
import { fetchCatalogConfiguration } from '@/services/catalogService'
import { fetchPricingRules } from '@/services/pricingRulesService'
import { fetchForfaits, type ForfaitCommercial } from '@/services/modelesForfaitsService'
import { calculerPrixKilo, formaterDetailKilo } from '@/lib/prixKilo'
import { calculerPrixForfait, formaterDetailForfait, problemeForfait } from '@/lib/prixForfait'
import { newId } from '@/lib/ids'
import type { LocalPricingRule } from '@/db/localDb'
import {
  articlesParCategorie,
  indexerPrix,
  prixConfigure,
  problemeLigneCatalogue,
} from '@/lib/catalogue'
import type { LocalCatalogGarment, LocalCatalogPrice } from '@/db/localDb'
import type { OrderGarmentDetail, OrderGarmentType } from '@/types/database'

/** Formulaire local-first de création d'une commande en trois étapes. */
interface OrderItemDraft extends Omit<OrderItemInput, 'garmentDetails'> {
  quantity: number
  unitPrice: number
  selectedActivityId: string
  selectedOfferingId: string
  garmentDetails: Array<{ type: OrderGarmentType | ''; quantity: number }>
}

const formatDraftComposition = (details: OrderItemDraft['garmentDetails']) =>
  formatGarmentComposition(details.filter((detail): detail is OrderGarmentDetail => detail.type !== ''))

const createEmptyItem = (): OrderItemDraft => ({
  label: '',
  fabricType: '',
  specialInstructions: '',
  price: 0,
  quantity: 1,
  unitPrice: 0,
  billingUnit: 'PIECE',
  pricingMode: 'FIXED',
  priceStatus: 'CONFIRMED',
  serviceName: '',
  tenantServiceId: null,
  garmentTypeId: null,
  activityNameSnapshot: null,
  selectedActivityId: '',
  selectedOfferingId: '',
  garmentDetails: [],
})

type Paiement = 'plus-tard' | 'especes'

const ETAPES = [
  { titre: 'Client', icon: UserRound },
  { titre: 'Vêtements', icon: Shirt },
  { titre: 'Paiement', icon: Wallet },
] as const

export default function OrderForm() {
  const navigate = useNavigate()
  const createOrder = useCreateOrder()
  const localOrders = useLocalOrders()
  const role = useTenantStore((state) => state.role)
  const tenantId = useTenantStore((state) => state.tenantId)
  const businessModel = useTenantStore((state) => state.businessModel)
  // Le rôle peut manquer alors que la boutique est connue (session restaurée
  // depuis le cache, ancien stockage local). On retombe sur le rôle mémorisé
  // pour la boutique active : sinon le bouton restait grisé sans explication.
  const roleBoutique = useTenantStore(
    (state) => state.shops.find((shop) => shop.tenantId === state.tenantId)?.role ?? null,
  )
  const roleEffectif = role ?? roleBoutique
  const canCreate = can(roleEffectif, 'orders.create')

  const [activites, setActivites] = useState<TenantActivity[]>([])
  const [prestations, setPrestations] = useState<TenantServiceOffering[]>([])
  const [articlesCatalogue, setArticlesCatalogue] = useState<LocalCatalogGarment[]>([])
  const [prixCatalogue, setPrixCatalogue] = useState<LocalCatalogPrice[]>([])
  const [reglesKilo, setReglesKilo] = useState<LocalPricingRule[]>([])
  const [forfaits, setForfaits] = useState<ForfaitCommercial[]>([])
  // Modèle « doux » : la blanchisserie ouvre sur le comptage, sans interdire
  // de revenir aux lignes classiques à la pièce ou au kilo.
  const [modeSaisie, setModeSaisie] = useState<'lignes' | 'forfait'>(() =>
    businessModel === 'BLANCHISSERIE' ? 'forfait' : 'lignes',
  )
  const [forfaitId, setForfaitId] = useState('')
  const [forfaitServiceId, setForfaitServiceId] = useState('')
  const [comptagesForfait, setComptagesForfait] = useState<Record<string, number>>({})
  const [montantManuelForfait, setMontantManuelForfait] = useState('')
  const [forfaitGroupeId] = useState(() => newId())
  const [etape, setEtape] = useState(0)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [items, setItems] = useState<OrderItemDraft[]>([createEmptyItem()])
  const [paiement, setPaiement] = useState<Paiement>('plus-tard')
  const [errors, setErrors] = useState<string[]>([])
  // Chemins Zod des champs refusés : sert à marquer les champs en rouge et à
  // placer le focus, pour qu'un « Suivant » sans effet ne soit jamais muet.
  const [champsInvalides, setChampsInvalides] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  // Étape d'enregistrement affichée pendant que la commande part au serveur :
  // le comptoir doit voir que le travail continue après le clic.
  const [enregistrement, setEnregistrement] = useState<'local' | 'serveur' | null>(null)

  useEffect(() => {
    if (!tenantId) return
    let active = true
    void fetchTenantServiceConfiguration(tenantId)
      .then((configuration) => {
        if (!active) return
        setActivites(configuration.activities)
        setPrestations(configuration.services)
      })
      .catch(() => undefined)
    void fetchCatalogConfiguration(tenantId)
      .then((configuration) => {
        if (!active) return
        setArticlesCatalogue(configuration.garments)
        setPrixCatalogue(configuration.prices)
      })
      .catch(() => undefined)
    void fetchPricingRules(tenantId)
      .then((regles) => {
        if (active) setReglesKilo(regles)
      })
      .catch(() => undefined)
    void fetchForfaits(tenantId)
      .then((liste) => {
        if (!active) return
        setForfaits(liste)
        const premier = liste.find(
          (forfait) =>
            forfait.isActive &&
            forfait.garmentsIncluded !== null &&
            problemeForfait({
              prixXof: forfait.priceXof,
              inclus: forfait.garmentsIncluded,
              politique: forfait.overflowPolicy,
              prixSupplementXof: forfait.overflowUnitPriceXof,
            }) === null,
        )
        if (!premier) return
        setForfaitId((courant) => courant || premier.id)
        setForfaitServiceId((courant) => courant || premier.tenantServiceId || '')
        setComptagesForfait((courants) =>
          Object.keys(courants).length > 0
            ? courants
            : Object.fromEntries(
                premier.items.flatMap((item) =>
                  item.garmentTypeId ? [[item.garmentTypeId, item.quantity] as const] : [],
                ),
              ),
        )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [tenantId])

  // Sonde d'ouverture : si l'enregistrement ne produit AUCUN événement, c'est
  // que le poste n'exécute pas cette version du formulaire. La sonde, elle,
  // laisse une trace à chaque ouverture.
  useEffect(() => {
    void signalerSonde({
      role: roleEffectif,
      role_brut: role,
      role_boutique: roleBoutique,
      boutique: tenantId,
      peut_creer: canCreate,
      en_ligne: typeof navigator !== 'undefined' ? navigator.onLine : null,
    })
  }, [role, roleEffectif, roleBoutique, tenantId, canCreate])

  const activitesDisponibles = [...activites].sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  // Catalogue (Lot 1) : dès que le pressing a des articles actifs, chaque
  // ligne à la pièce part d'un article et d'un tarif de la grille — le prix
  // n'est plus tapé à la main. Avant installation, l'ancien flux libre reste
  // disponible pour ne bloquer aucun pressing le jour du déploiement.
  const indexPrixCatalogue = indexerPrix(prixCatalogue)
  const catalogueActif = articlesCatalogue.some((article) => article.isActive)
  const groupesCatalogue = articlesParCategorie(articlesCatalogue)

  const forfaitsComptables = forfaits.filter(
    (forfait) =>
      forfait.isActive &&
      forfait.garmentsIncluded !== null &&
      problemeForfait({
        prixXof: forfait.priceXof,
        inclus: forfait.garmentsIncluded,
        politique: forfait.overflowPolicy,
        prixSupplementXof: forfait.overflowUnitPriceXof,
      }) === null,
  )
  const forfaitChoisi = forfaitsComptables.find((forfait) => forfait.id === forfaitId)
  const prestationForfait = prestations.find(
    (service) => service.id === (forfaitChoisi?.tenantServiceId ?? forfaitServiceId),
  )
  const totalVetementsForfait = Object.values(comptagesForfait).reduce(
    (totalCompte, quantite) => totalCompte + quantite,
    0,
  )
  const montantManuelForfaitNombre =
    montantManuelForfait.trim() === ''
      ? null
      : Math.floor(Number(montantManuelForfait) || 0)
  const devisForfait = forfaitChoisi
    ? calculerPrixForfait(
        {
          prixXof: forfaitChoisi.priceXof,
          inclus: forfaitChoisi.garmentsIncluded,
          politique: forfaitChoisi.overflowPolicy,
          prixSupplementXof: forfaitChoisi.overflowUnitPriceXof,
        },
        totalVetementsForfait,
        montantManuelForfaitNombre,
      )
    : null

  const construireLignesForfait = (): OrderItemDraft[] => {
    if (!forfaitChoisi) return [createEmptyItem()]

    const champsService: Pick<
      OrderItemDraft,
      'selectedActivityId' | 'selectedOfferingId' | 'serviceName' | 'tenantServiceId' | 'activityNameSnapshot'
    > = prestationForfait
      ? {
          selectedActivityId: prestationForfait.activityId,
          selectedOfferingId: prestationForfait.id,
          serviceName: prestationForfait.serviceName,
          tenantServiceId:
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              prestationForfait.id,
            )
              ? prestationForfait.id
              : null,
          activityNameSnapshot: prestationForfait.activityName,
        }
      : {
          selectedActivityId: '',
          selectedOfferingId: '',
          serviceName: '',
          tenantServiceId: null,
          activityNameSnapshot: null,
        }

    const montant =
      totalVetementsForfait > 0 ? devisForfait?.montant ?? forfaitChoisi.priceXof : 0
    const porteuse: OrderItemDraft = {
      ...createEmptyItem(),
      ...champsService,
      label: forfaitChoisi.name,
      price: montant,
      quantity: Math.max(1, totalVetementsForfait),
      billedQuantity: Math.max(1, totalVetementsForfait),
      unitPrice:
        totalVetementsForfait > 0
          ? Math.max(1, Math.round(montant / totalVetementsForfait))
          : 0,
      totalImpose: montant > 0 ? montant : undefined,
      billingUnit: 'PACKAGE',
      pricingMode: 'FIXED',
      priceStatus: 'CONFIRMED',
      garmentTypeId: null,
      commercialPackageId: forfaitChoisi.id,
      forfaitGroupeId,
      catalogUnitPriceSnapshot: null,
      conditionsSnapshot:
        devisForfait?.montant != null ? formaterDetailForfait(devisForfait) : null,
      garmentDetails: [],
    }

    const details = groupesCatalogue
      .flatMap((groupe) => groupe.articles)
      .flatMap((article) => {
        const quantite = comptagesForfait[article.id] ?? 0
        if (quantite <= 0) return []
        const detail: OrderItemDraft = {
          ...createEmptyItem(),
          ...champsService,
          label: article.name,
          articleName: article.name,
          price: 0,
          quantity: quantite,
          billedQuantity: quantite,
          unitPrice: 0,
          billingUnit: 'PIECE',
          pricingMode: 'FIXED',
          priceStatus: 'CONFIRMED',
          garmentTypeId: article.id,
          forfaitGroupeId,
          catalogUnitPriceSnapshot: null,
          garmentDetails: [],
        }
        return [detail]
      })

    return [porteuse, ...details]
  }

  const lignes = modeSaisie === 'forfait' ? construireLignesForfait() : items
  const total = lignes.reduce((sum, item) => sum + item.price, 0)

  const updateItem = (index: number, patch: Partial<OrderItemDraft>) => {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item
      const updated = { ...item, ...patch }
      // Devis kilo par tranches : le total calculé prime sur le produit
      // quantité × prix unitaire (non linéaire).
      updated.price = updated.totalImpose ?? Math.round(updated.quantity * updated.unitPrice)
      return updated
    }))
  }

  const regleKiloPour = (serviceId: string): LocalPricingRule | undefined =>
    reglesKilo.find((regle) => regle.tenantServiceId === serviceId && regle.isActive)

  /** (Re)calcule le devis d'une ligne au kilo régie par des tranches. */
  const appliquerDevisKilo = (index: number, poids: number, regle: LocalPricingRule) => {
    const devis = calculerPrixKilo(
      {
        mode: regle.ruleMode,
        minBillableKg: regle.minBillableKg,
        stepKg: regle.stepKg,
        rounding: regle.roundingMode,
      },
      regle.tiers.map((t) => ({ minKg: t.minKg, maxKg: t.maxKg, prixParKg: t.pricePerKgXof })),
      poids,
    )
    if (!devis) {
      updateItem(index, { quantity: poids, totalImpose: undefined, unitPrice: 0, conditionsSnapshot: null })
      return
    }
    updateItem(index, {
      quantity: poids,
      totalImpose: devis.montant,
      billedQuantity: devis.poidsFactureKg,
      unitPrice: Math.max(1, Math.round(devis.montant / Math.max(devis.poidsFactureKg, 0.001))),
      conditionsSnapshot: formaterDetailKilo(devis),
    })
  }

  const majQuantite = (index: number, valeur: number) => {
    const item = items[index]
    if (item?.billingUnit === 'KG') {
      const poids = Math.max(0, valeur || 0)
      const regle = item.selectedOfferingId ? regleKiloPour(item.selectedOfferingId) : undefined
      if (regle) {
        appliquerDevisKilo(index, poids, regle)
        return
      }
      updateItem(index, { quantity: poids, totalImpose: undefined, conditionsSnapshot: null })
      return
    }
    updateItem(index, { quantity: Math.max(1, valeur || 1) })
  }

  const choisirActivite = (index: number, activityId: string) => {
    const item = items[index]
    updateItem(index, {
      selectedActivityId: activityId,
      label: item?.billingUnit === 'KG' ? '' : item?.label ?? '',
      selectedOfferingId: '',
      serviceName: '',
      tenantServiceId: null,
      activityNameSnapshot: null,
      billingUnit: 'PIECE',
      quantity: 1,
      unitPrice: 0,
      garmentDetails: [],
    })
  }

  const choisirArticle = (index: number, garmentTypeId: string) => {
    const item = items[index]
    const article = articlesCatalogue.find((garment) => garment.id === garmentTypeId)
    if (!article) {
      updateItem(index, { garmentTypeId: null, unitPrice: 0, catalogUnitPriceSnapshot: null })
      return
    }
    const prix = prixConfigure(indexPrixCatalogue, item?.selectedOfferingId, article.id)
    updateItem(index, {
      garmentTypeId: article.id,
      label: article.name,
      articleName: article.name,
      catalogUnitPriceSnapshot: prix,
      unitPrice: prix ?? 0,
    })
  }

  const choisirPrestation = (index: number, offeringId: string) => {
    const item = items[index]
    const selectedActivity = activitesDisponibles.find((activity) => activity.id === item?.selectedActivityId)
    if (offeringId === '__free__') {
      updateItem(index, {
        selectedOfferingId: offeringId,
        label: item?.billingUnit === 'KG' ? '' : item?.label ?? '',
        serviceName: '',
        tenantServiceId: null,
        activityNameSnapshot: selectedActivity?.name ?? null,
        billingUnit: 'PIECE',
        quantity: 1,
        unitPrice: 0,
        garmentDetails: [],
      })
      return
    }
    const offering = prestations.find((service) => service.id === offeringId && service.activityId === item?.selectedActivityId)
    if (!offering) {
      updateItem(index, {
        selectedOfferingId: '',
        label: item?.billingUnit === 'KG' ? '' : item?.label ?? '',
        serviceName: '',
        tenantServiceId: null,
        activityNameSnapshot: null,
        billingUnit: 'PIECE',
        quantity: 1,
        unitPrice: 0,
        garmentDetails: [],
      })
      return
    }
    const auKilo = offering.billingUnit === 'KG'
    let label = item?.label ?? ''
    if (auKilo) label = offering.serviceName
    else if (item?.billingUnit === 'KG') label = ''
    // À la pièce, le prix vient de la grille catalogue quand un article est
    // déjà choisi ; au kilo, le tarif/kg de la prestation continue de s'appliquer.
    const prixGrille = auKilo ? null : prixConfigure(indexPrixCatalogue, offering.id, item?.garmentTypeId)
    updateItem(index, {
      selectedOfferingId: offering.id,
      serviceName: offering.serviceName,
      tenantServiceId: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(offering.id)
        ? offering.id
        : null,
      activityNameSnapshot: offering.activityName,
      garmentTypeId: auKilo ? null : item?.garmentTypeId ?? null,
      catalogUnitPriceSnapshot: prixGrille,
      totalImpose: undefined,
      conditionsSnapshot: null,
      label,
      billingUnit: offering.billingUnit,
      quantity: 1,
      unitPrice: prixGrille ?? offering.unitPrice ?? 0,
      garmentDetails: auKilo ? [{ type: '', quantity: 1 }] : [],
    })
    if (auKilo) {
      const regle = regleKiloPour(offering.id)
      if (regle) {
        // Ligne fraîchement basculée au kilo : devis initial pour 1 kg,
        // recalculé à chaque pesée via majQuantite.
        setTimeout(() => appliquerDevisKilo(index, 1, regle), 0)
      }
    }
  }

  const choisirForfait = (packageId: string) => {
    const forfait = forfaitsComptables.find((candidate) => candidate.id === packageId)
    setForfaitId(packageId)
    setForfaitServiceId(forfait?.tenantServiceId ?? '')
    setMontantManuelForfait('')
    setComptagesForfait(
      Object.fromEntries(
        (forfait?.items ?? []).flatMap((item) =>
          item.garmentTypeId ? [[item.garmentTypeId, item.quantity] as const] : [],
        ),
      ),
    )
  }

  const majComptageForfait = (garmentTypeId: string, quantite: number) => {
    const valeur = Math.min(10_000, Math.max(0, Math.floor(quantite || 0)))
    setComptagesForfait((courants) => ({ ...courants, [garmentTypeId]: valeur }))
  }

  const problemeSaisieForfait = (): string[] => {
    if (forfaitsComptables.length === 0) {
      return ['Aucun forfait au nombre de vêtements actif : créez-en un dans Catalogue & tarifs → Forfaits.']
    }
    if (!forfaitChoisi) return ['Choisissez le forfait vendu au client.']
    if (!catalogueActif) {
      return ['Installez le catalogue pour compter les articles déposés dans le forfait.']
    }
    if (!prestationForfait) return ['Choisissez la prestation appliquée aux vêtements du forfait.']
    if (totalVetementsForfait <= 0) return ['Comptez au moins un vêtement dans le forfait.']

    const probleme = problemeForfait({
      prixXof: forfaitChoisi.priceXof,
      inclus: forfaitChoisi.garmentsIncluded,
      politique: forfaitChoisi.overflowPolicy,
      prixSupplementXof: forfaitChoisi.overflowUnitPriceXof,
    })
    if (probleme) return [probleme]
    if (!devisForfait) {
      return [
        forfaitChoisi.overflowPolicy === 'REJECT_OVER_LIMIT'
          ? `Ce forfait accepte au maximum ${forfaitChoisi.garmentsIncluded} vêtement(s).`
          : 'Le montant de ce forfait ne peut pas être calculé pour ce comptage.',
      ]
    }
    if (devisForfait.manuelRequis) {
      return ['Saisissez le montant total validé au comptoir pour les vêtements supplémentaires.']
    }
    return []
  }

  /**
   * Contrôle l'étape en cours **sans jamais bloquer la navigation**.
   *
   * Choix assumé après un retour de terrain : le bouton « Suivant » d'un
   * formulaire en trois étapes doit toujours produire quelque chose. Une
   * validation qui refuse d'avancer laisse l'écran identique, ce qui se
   * confond avec un bouton cassé. On signale donc les champs à corriger
   * (message, toast, champ surligné) et on laisse l'utilisateur circuler ;
   * l'enregistrement, lui, reste strict et ramène sur l'étape fautive.
   */
  /**
   * Motifs de refus tarifaires (prix unitaire à zéro, total incohérent).
   *
   * PostgreSQL rejette ces lignes avec `guard_order_item_price` : on les arrête
   * ici pour que le comptoir corrige au lieu de découvrir l'échec à l'envoi.
   */
  const problemesTarifaires = (): string[] =>
    modeSaisie === 'forfait' ? problemeSaisieForfait() : items.flatMap((item) => {
      if (catalogueActif && item.billingUnit !== 'KG') {
        const problemeCatalogue = problemeLigneCatalogue({
          garmentTypeId: item.garmentTypeId,
          garmentName: item.label,
          tenantServiceId:
            item.selectedOfferingId && item.selectedOfferingId !== '__free__'
              ? item.selectedOfferingId
              : item.tenantServiceId,
          serviceName: item.serviceName,
          prix: prixConfigure(indexPrixCatalogue, item.selectedOfferingId, item.garmentTypeId),
        })
        if (problemeCatalogue) return [problemeCatalogue]
      }
      const probleme = problemeTarifaire({
        label: item.label,
        unitPrice: item.unitPrice,
        price: item.price,
        priceStatus: item.priceStatus,
      })
      return probleme ? [probleme] : []
    })

  const controlerEtape = (step: number): boolean => {
    const parsed = step === 0
      ? createOrderBaseSchema.pick({ customerName: true, customerPhone: true, dueDate: true }).safeParse({
          customerName,
          customerPhone,
          dueDate: dueDate || undefined,
        })
      : createOrderBaseSchema.pick({ items: true }).safeParse({ items: lignes })

    if (parsed.success) {
      if (step === 1) {
        const tarifs = problemesTarifaires()
        if (tarifs.length > 0) {
          setErrors(tarifs)
          toast.error(tarifs[0]!)
          return false
        }
      }
      return true
    }

    const messages = zodMessages(parsed.error)
    setErrors(messages)
    setChampsInvalides(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))
    toast.error(messages[0] ?? 'Vérifiez les informations saisies.')
    return false
  }

  /**
   * Amène l'utilisateur sur le premier champ fautif, sinon sur le bloc d'erreurs.
   * Chaque étape rend son propre `StepErrors` (`role="alert"`) : la recherche se
   * fait donc dans le document, sans référence liée à une étape précise.
   */
  const signalerBlocage = () => {
    window.requestAnimationFrame(() => {
      const premierChamp = document.querySelector<HTMLElement>('[aria-invalid="true"]')
      const cible = premierChamp ?? document.querySelector<HTMLElement>('[role="alert"]')
      if (!cible) return

      if (premierChamp) premierChamp.focus()
      cible.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    })
  }

  /**
   * Change d'étape. Les onglets d'étape, « Suivant » et « Précédent » passent
   * tous par ici : la navigation est **toujours** possible, dans les deux sens.
   * Avancer déclenche seulement un contrôle d'affichage des champs de l'étape
   * quittée (sans jamais retenir l'utilisateur). Un défaut réellement bloquant
   * est arrêté au moment d'enregistrer.
   */
  const changerEtape = (cible: number) => {
    if (submitting || cible === etape || cible < 0 || cible >= ETAPES.length) return

    // En avant : on contrôle les étapes traversées. En arrière : on ne touche à
    // rien, pour que le champ fautif reste surligné et son motif lisible.
    if (cible > etape) {
      let toutValide = true
      for (let index = etape; index < cible; index += 1) {
        if (!controlerEtape(index)) {
          toutValide = false
          break
        }
      }
      if (toutValide) {
        setErrors([])
        setChampsInvalides([])
      }
    }

    setEtape(cible)
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  const submit = async () => {
    // Trace d'entrée : si aucun événement `clic_enregistrer` n'arrive alors que
    // le comptoir clique, c'est que le clic n'atteint jamais ce gestionnaire
    // (bouton inerte, élément superposé) — et non que le serveur refuse.
    void signalerSonde({
      evenement: 'clic_enregistrer',
      etape,
      lignes: lignes.length,
      total,
      peut_creer: canCreate,
      en_ligne: typeof navigator !== 'undefined' ? navigator.onLine : null,
    })

    if (!canCreate) {
      const message = `Création refusée : votre rôle (${roleEffectif ?? 'inconnu'}) n'a pas le droit de créer une commande.`
      setErrors([message])
      toast.error(message)
      void signalerIncidentCommande(message, { etape: 'droit', role: roleEffectif })
      window.scrollTo?.({ top: 0, behavior: 'smooth' })
      return
    }

    setErrors([])
    setSubmitting(true)
    try {
      const parsed = createOrderSchema.safeParse({
        customerName,
        customerPhone,
        items: lignes,
        dueDate: dueDate || undefined,
      })
      if (!parsed.success) {
        const messages = zodMessages(parsed.error)
        setErrors(messages)
        setChampsInvalides(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))
        toast.error(messages[0] ?? 'Vérifiez les informations saisies.')

        // Retour sur l'étape qui contient la première erreur : au comptoir, un
        // message affiché sur une autre étape n'est jamais lu.
        const premiere = String(parsed.error.issues[0]?.path[0] ?? '')
        setEtape(premiere === 'items' ? 1 : 0)
        window.setTimeout(signalerBlocage, 0)
        // Un refus de validation bloque l'enregistrement : il doit laisser une
        // trace consultable, comme un refus du serveur.
        void signalerIncidentCommande(messages[0] ?? 'Validation refusée.', {
          etape: 'validation',
          erreurs: messages,
        })
        return
      }

      // 1. Écriture locale immédiate (le comptoir ne dépend pas du réseau).
      setEnregistrement('local')
      // Le serveur refuse une ligne à 0 FCFA : autant le dire avant l'envoi.
      const tarifs = problemesTarifaires()
      if (tarifs.length > 0) {
        setErrors(tarifs)
        setEtape(1)
        toast.error(tarifs[0]!)
        window.setTimeout(signalerBlocage, 0)
        void signalerIncidentCommande(tarifs[0]!, { etape: 'tarif' })
        return
      }

      // Garde-fou : une écriture locale bloquée (stockage saturé, transaction
      // bloquée par un autre onglet) laisserait sinon le bouton tourner
      // indéfiniment sans jamais rien dire.
      void signalerSonde({ evenement: 'creation_locale_demarree', etape })
      const { order } = await Promise.race([
        createOrder(parsed.data),
        new Promise<never>((_, rejeter) =>
          window.setTimeout(
            () =>
              rejeter(
                new Error(
                  "L'enregistrement local prend trop de temps : rechargez la page, puis réessayez. Aucune commande n'a été perdue.",
                ),
              ),
            25_000,
          ),
        ),
      ])

      // 2. Envoi immédiat vers Supabase, sans attendre la boucle de fond :
      //    la commande et ses lignes arrivent en base dans la seconde, et un
      //    échec est signalé tout de suite avec son motif.
      void signalerSonde({ evenement: 'commande_creee_localement', commande: order.id })
      setEnregistrement('serveur')
      // L'envoi ne doit jamais interrompre le parcours : quoi qu'il arrive, la
      // commande existe sur l'appareil et le comptoir repart avec un message.
      let envoi: { statut: string; message?: string }
      try {
        envoi = await syncOrderNow(order.id)
      } catch (erreurEnvoi) {
        envoi = {
          statut: 'error',
          message:
            erreurEnvoi instanceof Error
              ? erreurEnvoi.message
              : "L'envoi au serveur a échoué.",
        }
        void signalerIncidentCommande(String(envoi.message ?? "L'envoi au serveur a échoué."), {
          etape: 'envoi_immediat',
          commande: order.id,
        })
      }

      void signalerSonde({ evenement: 'envoi_termine', commande: order.id, statut: envoi.statut })
      if (envoi.statut === 'synced') {
        toast.success('Commande enregistrée et synchronisée.', { icon: '✅' })
      } else {
        toast(
          `Commande enregistrée sur cet appareil. ${envoi.message ?? ''}`.trim(),
          { icon: '📥', duration: 6000 },
        )
      }

      // La fiche s'ouvre toujours : elle montre l'état de synchronisation et
      // permet de relancer l'envoi si besoin.
      navigate(paiement === 'especes'
        ? `/commandes/${order.id}?regler=1`
        : `/commandes/${order.id}`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Impossible d'enregistrer la commande."
      setErrors([message])
      toast.error(message)
      // Trace côté serveur : un blocage au clic ne doit pas rester invisible.
      void signalerIncidentCommande(message, { etape: 'creation_locale' })
      window.scrollTo?.({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
      setEnregistrement(null)
    }
  }

  const problemeForfaitActuel =
    modeSaisie === 'forfait' ? problemeSaisieForfait()[0] : undefined

  const saisieForfait = (
    <section className="space-y-4 rounded-xl border border-slate-200 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-600">Forfait vendu</span>
          <select
            value={forfaitId}
            onChange={(event) => choisirForfait(event.target.value)}
            aria-label="Forfait vendu"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal"
          >
            <option value="">Choisir un forfait</option>
            {forfaitsComptables.map((forfait) => (
              <option key={forfait.id} value={forfait.id}>
                {forfait.name} — {forfait.garmentsIncluded} inclus · {formatFcfa(forfait.priceXof)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-600">Prestation appliquée</span>
          <select
            value={prestationForfait?.id ?? forfaitServiceId}
            onChange={(event) => setForfaitServiceId(event.target.value)}
            disabled={Boolean(forfaitChoisi?.tenantServiceId)}
            aria-label="Prestation appliquée au forfait"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal disabled:bg-slate-50"
          >
            <option value="">Choisir une prestation</option>
            {prestations
              .filter((service) => service.billingUnit === 'PIECE')
              .map((service) => (
                <option key={service.id} value={service.id}>
                  {service.serviceName} — {service.activityName}
                </option>
              ))}
          </select>
        </label>
      </div>

      {forfaitsComptables.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Aucun forfait au nombre de vêtements actif. Le propriétaire peut en créer un dans
          Catalogue &amp; tarifs → Forfaits.
        </p>
      )}
      {forfaitChoisi && (
        <p className="text-sm text-slate-600">
          {formatFcfa(forfaitChoisi.priceXof)} pour {forfaitChoisi.garmentsIncluded} vêtement(s)
          inclus.
          {forfaitChoisi.overflowPolicy === 'PER_EXTRA_ITEM' &&
            ` Au-delà : ${formatFcfa(forfaitChoisi.overflowUnitPriceXof ?? 0)} par vêtement supplémentaire.`}
          {forfaitChoisi.overflowPolicy === 'REPEAT_PACKAGE' &&
            ' Au-delà, le forfait entier se répète.'}
          {forfaitChoisi.overflowPolicy === 'REJECT_OVER_LIMIT' &&
            ' Aucun dépassement n’est accepté.'}
          {forfaitChoisi.overflowPolicy === 'MANUAL_QUOTE' &&
            ' En cas de dépassement, le montant total est validé au comptoir.'}
        </p>
      )}
      {!catalogueActif && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Le catalogue doit être installé pour énumérer les articles comptés dans le forfait.
        </p>
      )}

      {groupesCatalogue.map((groupe) => (
        <fieldset key={groupe.categoryCode} className="rounded-xl border border-slate-100 px-3 py-2">
          <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">
            {groupe.categoryName}
          </legend>
          <div className="divide-y divide-slate-100">
            {groupe.articles.map((article) => {
              const quantite = comptagesForfait[article.id] ?? 0
              return (
                <div key={article.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2">
                  <span className="min-w-0 truncate text-sm font-medium text-slate-800">{article.name}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => majComptageForfait(article.id, quantite - 1)}
                      disabled={submitting || quantite <= 0}
                      aria-label={`Retirer un ${article.name} du forfait`}
                      className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-600 disabled:opacity-40"
                    >
                      <Minus size={16} aria-hidden />
                    </button>
                    <input
                      type="number"
                      min="0"
                      max="10000"
                      step="1"
                      value={quantite}
                      onChange={(event) => majComptageForfait(article.id, Number(event.target.value))}
                      aria-label={`Nombre de ${article.name} dans le forfait`}
                      className="min-h-10 w-20 rounded-lg border border-slate-300 px-2 text-center text-base outline-none focus:border-brand-teal"
                    />
                    <button
                      type="button"
                      onClick={() => majComptageForfait(article.id, quantite + 1)}
                      disabled={submitting}
                      aria-label={`Ajouter un ${article.name} au forfait`}
                      className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-700 disabled:opacity-40"
                    >
                      <Plus size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </fieldset>
      ))}

      {forfaitChoisi?.overflowPolicy === 'MANUAL_QUOTE' &&
        forfaitChoisi.garmentsIncluded !== null &&
        totalVetementsForfait > forfaitChoisi.garmentsIncluded && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-600">
              Montant total validé au comptoir (FCFA)
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={montantManuelForfait}
              onChange={(event) => setMontantManuelForfait(event.target.value)}
              aria-label="Montant total validé au comptoir pour le forfait"
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
            />
          </label>
        )}

      <div className="rounded-xl bg-teal-50/60 p-3">
        <p className="text-sm font-semibold text-slate-800">
          {totalVetementsForfait} vêtement(s) compté(s)
        </p>
        {problemeForfaitActuel ? (
          <p className="mt-1 text-sm font-medium text-amber-800">{problemeForfaitActuel}</p>
        ) : devisForfait?.montant != null ? (
          <p className="mt-1 text-sm font-semibold text-brand-navy">
            {formaterDetailForfait(devisForfait)} → {formatFcfa(devisForfait.montant)}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-slate-500">
          Tous les articles actifs comptent ; seule la somme change le prix, pas leur répartition.
          Les articles resteront visibles à 0 FCFA, inclus dans la ligne du forfait.
        </p>
      </div>
    </section>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <button
          type="button"
          onClick={() => navigate('/commandes')}
          className="mb-3 min-h-10 text-sm font-semibold text-slate-600 hover:text-brand-navy"
        >
          ← Retour aux commandes
        </button>
        <h1 className="text-2xl font-bold text-brand-navy">Nouvelle commande</h1>
        <p className="mt-1 text-sm text-slate-500">Les informations sont enregistrées localement avant synchronisation.</p>
      </header>

      <ol className="grid grid-cols-3 gap-2" aria-label="Étapes de création de commande">
        {ETAPES.map(({ titre, icon: Icon }, index) => {
          const active = index === etape
          const complete = index < etape
          return (
            <li key={titre}>
              <button
                type="button"
                onClick={() => changerEtape(index)}
                aria-current={active ? 'step' : undefined}
                aria-label={`Étape ${index + 1} : ${titre}`}
                disabled={submitting}
                className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border px-2 text-sm font-semibold transition-colors disabled:opacity-60 ${active ? 'border-brand-teal bg-brand-teal/5 text-brand-navy' : complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'border-slate-200 bg-white text-slate-500 hover:border-brand-teal hover:text-brand-navy'}`}
              >
                {complete ? <Check size={17} aria-hidden /> : <Icon size={17} aria-hidden />}
                <span>{index + 1}. {titre}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {!canCreate && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">Ce compte ne peut pas créer de commande.</p>
          <p className="mt-1">
            Rôle détecté : <strong>{roleEffectif ?? 'aucun'}</strong>. Le propriétaire et le
            réceptionniste en ont le droit, l’artisan non. Demandez au propriétaire de vérifier
            votre rôle dans Paramètres → Équipe.
          </p>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {etape === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">Informations client</h2>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">Nom du client</span>
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Ex. Mme Awa Koné"
                autoComplete="name"
                aria-invalid={champsInvalides.includes('customerName') || undefined}
                className={`min-h-12 w-full rounded-xl border px-3 text-base outline-none focus:border-brand-teal ${champsInvalides.includes('customerName') ? 'border-rose-400 bg-rose-50/40' : 'border-slate-300'}`}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">Téléphone</span>
              <input
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder="07 00 00 00 00"
                inputMode="tel"
                autoComplete="tel"
                aria-invalid={champsInvalides.includes('customerPhone') || undefined}
                className={`min-h-12 w-full rounded-xl border px-3 text-base outline-none focus:border-brand-teal ${champsInvalides.includes('customerPhone') ? 'border-rose-400 bg-rose-50/40' : 'border-slate-300'}`}
              />
              {customerPhone && suggestCustomersByPhone(localOrders ?? [], customerPhone).length > 0 && (
                <span className="block text-xs text-slate-500">Un client connu utilise déjà ce numéro.</span>
              )}
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">Livraison promise <span className="font-normal text-slate-500">(facultatif)</span></span>
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal" />
            </label>
            <StepErrors errors={errors} />
            <div className="flex justify-between gap-3 pt-2">
              <button type="button" onClick={() => navigate('/commandes')} disabled={submitting} className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Annuler</button>
              <button type="button" onClick={() => changerEtape(etape + 1)} disabled={submitting} className="min-h-12 rounded-xl bg-brand-teal px-5 font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50">Suivant</button>
            </div>
          </div>
        )}

        {etape === 1 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Vêtements et prestations</h2>
                <p className="text-sm text-slate-500">
                  {modeSaisie === 'forfait'
                    ? 'Comptez chaque article déposé : le prix du forfait dépend du total, pas de la répartition.'
                    : 'Pour une prestation au kilo, énumérez les vêtements, pesez le lot et confirmez le tarif par kilo.'}
                </p>
              </div>
              {modeSaisie === 'lignes' && (
                <button type="button" onClick={() => setItems((current) => [...current, createEmptyItem()])} disabled={submitting} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"><Plus size={17} aria-hidden /> Ajouter une ligne</button>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Mode de dépôt">
              <button
                type="button"
                onClick={() => setModeSaisie('lignes')}
                aria-pressed={modeSaisie === 'lignes'}
                className={`min-h-12 rounded-xl border px-3 text-sm font-bold ${modeSaisie === 'lignes' ? 'border-brand-teal bg-brand-teal/5 text-brand-navy' : 'border-slate-300 text-slate-600 hover:border-brand-teal'}`}
              >
                À la pièce / au kilo
              </button>
              <button
                type="button"
                onClick={() => setModeSaisie('forfait')}
                aria-pressed={modeSaisie === 'forfait'}
                className={`min-h-12 rounded-xl border px-3 text-sm font-bold ${modeSaisie === 'forfait' ? 'border-brand-teal bg-brand-teal/5 text-brand-navy' : 'border-slate-300 text-slate-600 hover:border-brand-teal'}`}
              >
                Forfait (comptage)
              </button>
            </div>

            {modeSaisie === 'lignes' ? (
            <div className="space-y-3">
              {items.map((item, index) => (
                <fieldset key={index} className="rounded-xl border border-slate-200 p-3 sm:p-4">
                  <legend className="px-1 text-sm font-semibold text-slate-600">Ligne {index + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_170px_44px]">
                    {item.billingUnit === 'KG' ? (
                      <div className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Prestation au kilo</span>
                        <p className="min-h-11 rounded-lg bg-slate-50 px-3 py-2.5 font-semibold text-slate-800">{item.serviceName || 'Lavage au kilo'}</p>
                      </div>
                    ) : (
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Article / vêtement{catalogueActif ? ' (catalogue)' : ''}</span>
                        {catalogueActif ? (
                          <select value={item.garmentTypeId ?? ''} onChange={(event) => choisirArticle(index, event.target.value)} aria-label={`Article de la ligne ${index + 1}`} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal">
                            <option value="">Choisir un article du catalogue</option>
                            {groupesCatalogue.map((groupe) => (
                              <optgroup key={groupe.categoryCode} label={groupe.categoryName}>
                                {groupe.articles.map((article) => (
                                  <option key={article.id} value={article.id}>{article.name}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        ) : (
                          <input value={item.label} onChange={(event) => updateItem(index, { label: event.target.value })} placeholder="Ex. Chemise" className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                        )}
                      </label>
                    )}
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">{item.billingUnit === 'KG' ? 'Poids total (kg)' : 'Quantité'}</span>
                      <input type="number" min={item.billingUnit === 'KG' ? '0.001' : '1'} step={item.billingUnit === 'KG' ? '0.001' : '1'} value={item.quantity || ''} onChange={(event) => majQuantite(index, Number(event.target.value))} aria-label={item.billingUnit === 'KG' ? `Poids total (kg) ligne ${index + 1}` : `Quantité ligne ${index + 1}`} className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">{item.billingUnit === 'KG' ? 'Tarif/kg (FCFA)' : 'Prix unitaire (FCFA)'}</span>
                      <input type="number" min="1" step="1" value={item.unitPrice || ''} onChange={(event) => updateItem(index, { unitPrice: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} readOnly={(catalogueActif && Boolean(item.garmentTypeId)) || item.totalImpose !== undefined} title={item.totalImpose !== undefined ? 'Total calculé par la règle au kilo (Catalogue → Au kilo)' : catalogueActif && item.garmentTypeId ? 'Prix de la grille catalogue (modifiable dans Catalogue → Tarifs)' : undefined} aria-label={item.billingUnit === 'KG' ? `Tarif au kilo ligne ${index + 1} (FCFA)` : `Prix unitaire ligne ${index + 1} (FCFA)`} className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal read-only:bg-slate-50" />
                    </label>
                    <button type="button" onClick={() => setItems((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))} disabled={items.length === 1 || submitting} aria-label={`Supprimer la ligne ${index + 1}`} className="mt-5 flex min-h-11 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"><Trash2 size={18} aria-hidden /></button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Activité <span className="font-normal">(facultatif)</span></span>
                      <select value={item.selectedActivityId} onChange={(event) => choisirActivite(index, event.target.value)} aria-label={`Activité de la ligne ${index + 1}`} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal">
                        <option value="">Choisir une activité</option>
                        {activitesDisponibles.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Prestation {!catalogueActif && <span className="font-normal">(facultatif)</span>}</span>
                      <select value={item.selectedOfferingId} onChange={(event) => choisirPrestation(index, event.target.value)} aria-label={`Prestation de la ligne ${index + 1}`} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal">
                        <option value="">Choisir une prestation</option>
                        {!catalogueActif && <option value="__free__">Saisir une prestation libre</option>}
                        {prestations.filter((service) => service.activityId === item.selectedActivityId).map((service) => <option key={service.id} value={service.id}>{service.serviceName}{service.billingUnit === 'KG' ? ' — au kilo' : ''}</option>)}
                      </select>
                      {item.selectedOfferingId === '__free__' && (
                        <input value={item.serviceName ?? ''} onChange={(event) => updateItem(index, { serviceName: event.target.value })} placeholder="Ex. Lavage et repassage" aria-label={`Libellé de la prestation libre ${index + 1}`} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                      )}
                    </label>
                    {item.billingUnit !== 'KG' && (
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Type de tissu <span className="font-normal">(facultatif)</span></span>
                        <input value={item.fabricType ?? ''} onChange={(event) => updateItem(index, { fabricType: event.target.value })} placeholder="Ex. Bazin, Wax" className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                      </label>
                    )}
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Instructions <span className="font-normal">(facultatif)</span></span>
                      <input value={item.specialInstructions ?? ''} onChange={(event) => updateItem(index, { specialInstructions: event.target.value })} placeholder="Ex. Empèsage fort" className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                    </label>
                  </div>
                  {item.billingUnit === 'KG' && (
                    <div className="mt-4 rounded-xl border border-brand-teal/20 bg-teal-50/40 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-800">Vêtements dans le lot</h3>
                          <p className="text-xs text-slate-500">Le tarif est calculé sur le poids total; ce détail sert au suivi du linge.</p>
                        </div>
                        <button type="button" onClick={() => updateItem(index, { garmentDetails: [...item.garmentDetails, { type: '', quantity: 1 }] })} className="min-h-9 rounded-lg border border-brand-teal/40 px-3 text-xs font-bold text-brand-navy hover:bg-white">+ Ajouter un type</button>
                      </div>
                      {item.garmentDetails.map((garment, garmentIndex) => (
                        <div key={`${index}-garment-${garmentIndex}`} className="mb-2 grid grid-cols-[minmax(0,1fr)_90px_40px] gap-2 last:mb-0">
                          <label className="space-y-1">
                            <span className="sr-only">Type de vêtement {garmentIndex + 1}</span>
                            <select value={garment.type} onChange={(event) => {
                              const garmentDetails = [...item.garmentDetails]
                              garmentDetails[garmentIndex] = { ...garment, type: event.target.value as OrderGarmentType | '' }
                              updateItem(index, { garmentDetails })
                            }} aria-label={`Type de vêtement ${garmentIndex + 1} ligne ${index + 1}`} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-teal">
                              <option value="">Sélectionner un type</option>
                              {GARMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="sr-only">Nombre d’articles {garmentIndex + 1}</span>
                            <input type="number" min="1" max="1000" step="1" value={garment.quantity} onChange={(event) => {
                              const garmentDetails = [...item.garmentDetails]
                              garmentDetails[garmentIndex] = { ...garment, quantity: Math.min(1000, Math.max(1, Math.floor(Number(event.target.value) || 1))) }
                              updateItem(index, { garmentDetails })
                            }} aria-label={`Nombre d’articles ${garmentIndex + 1} ligne ${index + 1}`} className="min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal" />
                          </label>
                          <button type="button" onClick={() => updateItem(index, { garmentDetails: item.garmentDetails.filter((_, detailIndex) => detailIndex !== garmentIndex) })} aria-label={`Supprimer le type de vêtement ${garmentIndex + 1}`} className="flex min-h-10 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 size={16} aria-hidden /></button>
                        </div>
                      ))}
                      {formatDraftComposition(item.garmentDetails) && (
                        <p className="mt-2 text-xs font-medium text-slate-700">Composition : {formatDraftComposition(item.garmentDetails)}</p>
                      )}
                    </div>
                  )}
                  {item.totalImpose !== undefined && item.conditionsSnapshot && (
                    <p className="mt-2 text-right text-xs font-medium text-slate-500">{item.conditionsSnapshot}</p>
                  )}
                  <p className="mt-3 text-right text-sm font-semibold text-slate-700">Total de la ligne : {formatFcfa(item.price)}</p>
                </fieldset>
              ))}
            </div>
            ) : saisieForfait}
            {modeSaisie === 'lignes' && prestations.length === 0 && !catalogueActif && (
              <p className="text-xs text-slate-500">Aucune prestation n’est encore configurée. Vous pouvez laisser la ligne sans prestation ou en saisir une librement.</p>
            )}
            {modeSaisie === 'lignes' && !catalogueActif && (
              <p className="text-xs text-slate-500">
                Catalogue non installé : la saisie libre reste possible. Le propriétaire peut
                installer le catalogue de référence et ses tarifs via le menu « Catalogue &amp; tarifs » ;
                les prix viendront ensuite automatiquement de la grille.
              </p>
            )}
            {modeSaisie === 'lignes' && catalogueActif && (
              <p className="text-xs text-slate-500">
                Prix issus de la grille du catalogue. Un couple article × prestation sans tarif
                (« non configuré ») bloque l’enregistrement : définissez-le dans Catalogue → Tarifs.
              </p>
            )}

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-600">Total de la commande</p>
              <p className="text-xl font-bold text-brand-navy">{formatFcfa(total)}</p>
            </div>
            <StepErrors errors={errors} />
            <div className="flex justify-between gap-3 pt-2">
              <button type="button" onClick={() => changerEtape(etape - 1)} disabled={submitting} className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Précédent</button>
              <button type="button" onClick={() => changerEtape(etape + 1)} disabled={submitting} className="min-h-12 rounded-xl bg-brand-teal px-5 font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50">Suivant</button>
            </div>
          </div>
        )}

        {etape === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Règlement</h2>
              <p className="text-sm text-slate-500">Le paiement immédiat ouvre le panneau d’encaissement après l’enregistrement.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['plus-tard', 'especes'] as const).map((mode) => {
                const selected = paiement === mode
                return (
                  <button key={mode} type="button" onClick={() => setPaiement(mode)} aria-pressed={selected} className={`min-h-24 rounded-xl border p-4 text-left ${selected ? 'border-brand-teal bg-brand-teal/5' : 'border-slate-300 hover:border-brand-teal'}`}>
                    <span className="block font-semibold text-slate-800">{mode === 'plus-tard' ? 'Régler plus tard' : 'Encaisser des espèces maintenant'}</span>
                    <span className="mt-1 block text-sm text-slate-500">{mode === 'plus-tard' ? 'Le solde restera dû sur la fiche.' : 'La commande sera créée, puis le panneau espèces s’ouvrira pour confirmer le montant reçu.'}</span>
                  </button>
                )
              })}
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-600">À régler</p>
              <p className="text-xl font-bold text-brand-navy">{formatFcfa(total)}</p>
            </div>
            <StepErrors errors={errors} />
            <div className="flex justify-between gap-3 pt-2">
              <button type="button" onClick={() => changerEtape(etape - 1)} disabled={submitting} className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Précédent</button>
              <button type="button" onClick={submit} disabled={submitting} className="min-h-12 rounded-xl bg-brand-teal px-5 font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50">{enregistrement === 'serveur'
                  ? 'Envoi au serveur…'
                  : submitting
                    ? 'Enregistrement…'
                    : 'Enregistrer la commande'}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function StepErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null
  return (
    <div role="alert" className="space-y-1 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
      {errors.map((error, index) => <p key={`${index}-${error}`}>{error}</p>)}
    </div>
  )
}
