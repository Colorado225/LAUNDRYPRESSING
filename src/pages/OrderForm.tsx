import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ClipboardCheck, Plus, Search, Shirt, Sparkles, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCreateOrder, useLocalOrders } from '@/db/hooks'
import {
  countPreviousOrders,
  lastCustomerNameByPhone,
  suggestCustomersByPhone,
} from '@/lib/customerSuggestions'
import { signalerIncidentCommande, signalerSonde, syncOrderNow } from '@/sync/syncEngine'
import {
  createOrderSchema,
  normalizePhoneCi,
  zodMessages,
  type OrderItemInput,
} from '@/schemas/order'
import { problemeTarifaire } from '@/lib/orderPricing'
import { formatFcfa } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import {
  fetchTenantServiceConfiguration,
  type TenantServiceOffering,
} from '@/services/tenantServices'
import { GARMENT_GRID } from '@/constants/garmentImages'
import type { OrderGarmentType } from '@/types/database'
import {
  articlesDuParcours,
  PRESENTATION_PARCOURS,
  servicesALaPiece,
  servicesAuKilo,
  servicesDuParcours,
  type ParcoursService,
} from '@/lib/orderServices'
import ServiceChoiceCard from '@/components/order/ServiceChoiceCard'
import OrderItemGrid from '@/components/order/OrderItemGrid'
import OrderBasket, { type LignePanier } from '@/components/order/OrderBasket'
import OrderSummary from '@/components/order/OrderSummary'

/**
 * Création d'une commande au comptoir — trois écrans.
 *
 *   1. **Service**    : Pressing (à la pièce) ou Blanchisserie (au kilo) ;
 *   2. **Articles**   : client, dates, grille d'articles à icônes et panier ;
 *   3. **Récapitulatif** : relecture, mode de règlement, enregistrement.
 *
 * Rien n'est réinventé ici : la validation (`createOrderSchema`,
 * `problemeTarifaire`), l'écriture locale (`createOrderLocal` via
 * `useCreateOrder`), l'envoi immédiat (`syncOrderNow`) et les règles de
 * permission restent ceux de l'application. Ce fichier n'est qu'une nouvelle
 * façade sur le même moteur de commandes.
 *
 * Règle issue du terrain, conservée : un bouton « Suivant » produit **toujours**
 * quelque chose. Les défauts sont signalés (message, champ marqué, aller-retour
 * sur l'étape fautive au moment d'enregistrer), jamais par un clic muet.
 */

type Etape = 0 | 1 | 2

const ETAPES = [
  { titre: 'Service', icon: Sparkles },
  { titre: 'Articles', icon: Shirt },
  { titre: 'Récapitulatif', icon: ClipboardCheck },
] as const

type Paiement = 'plus-tard' | 'especes'

/**
 * Ligne en cours de saisie.
 *
 * - `piece` : un vêtement identifié, facturé à la pièce (`billingUnit: PIECE`) ;
 * - `lot`   : un lot pesé facturé au kilo (`billingUnit: KG`), dont la
 *   composition (`garmentDetails`) décrit le linge réellement déposé.
 */
interface LigneDraft {
  id: string
  genre: 'piece' | 'lot'
  /** Type de vêtement pour une ligne à la pièce ; `null` pour un libellé libre. */
  type: OrderGarmentType | null
  label: string
  quantity: number
  unitPrice: number
  serviceName: string | null
  tenantServiceId: string | null
  activityNameSnapshot: string | null
  garmentDetails: Array<{ type: OrderGarmentType; quantity: number }>
}

const LIBELLES_ARTICLES = new Map<OrderGarmentType, string>(
  GARMENT_GRID.map(({ type, label }) => [type, label]),
)

/** Identifiant local de ligne : suffisant pour une clé React, jamais envoyé. */
function idLigne(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ligne-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Une référence de prestation n'est transmise que si c'est un UUID serveur. */
function referenceServeur(id: string | null | undefined): string | null {
  if (!id) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null
}

function totalLigne(ligne: Pick<LigneDraft, 'quantity' | 'unitPrice'>): number {
  return Math.round(ligne.quantity * ligne.unitPrice)
}

export default function OrderForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const createOrder = useCreateOrder()
  const localOrders = useLocalOrders()
  const role = useTenantStore((state) => state.role)
  const tenantId = useTenantStore((state) => state.tenantId)
  // Le rôle peut manquer alors que la boutique est connue (session restaurée
  // depuis le cache, ancien stockage local). On retombe sur le rôle mémorisé
  // pour la boutique active : sinon le bouton resterait grisé sans explication.
  const roleBoutique = useTenantStore(
    (state) => state.shops.find((shop) => shop.tenantId === state.tenantId)?.role ?? null,
  )
  const roleEffectif = role ?? roleBoutique
  const canCreate = can(roleEffectif, 'orders.create')

  // `/commandes/blanchisserie` redirige ici avec `?service=blanchisserie` :
  // le parcours est choisi d'avance et l'écran 1 est sauté.
  const serviceDemande = new URLSearchParams(location.search).get('service')
  const parcoursInitial: ParcoursService | null =
    serviceDemande === 'pressing' || serviceDemande === 'blanchisserie' ? serviceDemande : null

  const [activites, setActivites] = useState<Awaited<ReturnType<typeof fetchTenantServiceConfiguration>>['activities']>([])
  const [prestations, setPrestations] = useState<TenantServiceOffering[]>([])
  const [parcours, setParcours] = useState<ParcoursService | null>(parcoursInitial)
  const [etape, setEtape] = useState<Etape>(parcoursInitial ? 1 : 0)

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [rechercheClient, setRechercheClient] = useState('')
  const [previousOrderCount, setPreviousOrderCount] = useState(0)
  const [suggestedName, setSuggestedName] = useState('')
  const [dueDate, setDueDate] = useState('')

  const [lignes, setLignes] = useState<LigneDraft[]>([])
  const [articleLibre, setArticleLibre] = useState('')
  const [prestationPiece, setPrestationPiece] = useState('')
  const [prestationKilo, setPrestationKilo] = useState('')
  const [paiement, setPaiement] = useState<Paiement>('plus-tard')

  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [enregistrement, setEnregistrement] = useState<'local' | 'serveur' | null>(null)
  const lotInitialise = useRef(false)
  // Verrou d'envoi : `submitting` est un état React, donc pas encore à jour si
  // deux clics arrivent dans le même cycle. Le ref, lui, bloque le second.
  const enregistrementEnCours = useRef(false)

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
    return () => {
      active = false
    }
  }, [tenantId])

  // Sonde d'ouverture : si l'enregistrement ne produit AUCUN événement, c'est
  // que le poste n'exécute pas cette version du formulaire.
  useEffect(() => {
    void signalerSonde({
      role: roleEffectif,
      role_brut: role,
      role_boutique: roleBoutique,
      boutique: tenantId,
      peut_creer: canCreate,
      en_ligne: typeof navigator !== 'undefined' ? navigator.onLine : null,
      parcours,
    })
  }, [role, roleEffectif, roleBoutique, tenantId, canCreate, parcours])

  // Historique client : quand le téléphone est saisi, on compte les commandes
  // précédentes et on retient le nom le plus récent pour le pré-remplir.
  useEffect(() => {
    const query = customerPhone.replace(/\D/g, '')
    if (query.length < 3) {
      setPreviousOrderCount(0)
      setSuggestedName('')
      return
    }
    const orders = localOrders ?? []
    setPreviousOrderCount(countPreviousOrders(orders, customerPhone))
    const nom = lastCustomerNameByPhone(orders, customerPhone)
    setSuggestedName(nom)
    if (nom && !customerName) setCustomerName(nom)
  }, [customerPhone, localOrders, customerName])

  /** Prestations réellement configurées pour le parcours choisi. */
  const prestationsParcours = useMemo(
    () => (parcours ? servicesDuParcours(prestations, parcours) : []),
    [prestations, parcours],
  )
  const prestationsKilo = useMemo(() => servicesAuKilo(prestationsParcours), [prestationsParcours])
  const prestationsPiece = useMemo(
    () => servicesALaPiece(prestationsParcours),
    [prestationsParcours],
  )

  const articles = useMemo(
    () => (parcours ? articlesDuParcours(parcours) : []),
    [parcours],
  )

  /** Clients déjà rencontrés sur cet appareil (aucun appel réseau). */
  const clientsConnus = useMemo(() => {
    const parTelephone = new Map<string, { name: string; phone: string; commandes: number; dernier: string }>()
    for (const commande of localOrders ?? []) {
      const cle = normalizePhoneCi(commande.customerPhone)
      if (!cle) continue
      const connu = parTelephone.get(cle)
      if (!connu) {
        parTelephone.set(cle, {
          name: commande.customerName,
          phone: commande.customerPhone,
          commandes: 1,
          dernier: commande.createdAt,
        })
        continue
      }
      connu.commandes += 1
      if (commande.createdAt > connu.dernier) {
        connu.name = commande.customerName
        connu.phone = commande.customerPhone
        connu.dernier = commande.createdAt
      }
    }
    return [...parTelephone.values()].sort((a, b) => b.dernier.localeCompare(a.dernier))
  }, [localOrders])

  const resultatsClient = useMemo(() => {
    const terme = rechercheClient.trim().toLocaleLowerCase('fr')
    if (terme.length < 2) return []
    return clientsConnus
      .filter(
        (client) =>
          client.name.toLocaleLowerCase('fr').includes(terme) ||
          client.phone.replace(/\D/g, '').includes(terme.replace(/\D/g, '')),
      )
      .slice(0, 5)
  }, [clientsConnus, rechercheClient])

  /** Quantités affichées sur les tuiles de la grille. */
  const quantitesGrille = useMemo(() => {
    const quantites: Partial<Record<OrderGarmentType, number>> = {}
    for (const ligne of lignes) {
      if (ligne.genre === 'piece' && ligne.type) {
        quantites[ligne.type] = (quantites[ligne.type] ?? 0) + ligne.quantity
      }
      for (const detail of ligne.garmentDetails) {
        quantites[detail.type] = (quantites[detail.type] ?? 0) + detail.quantity
      }
    }
    return quantites
  }, [lignes])

  const total = lignes.reduce((somme, ligne) => somme + totalLigne(ligne), 0)

  const lignesPanier: LignePanier[] = lignes.map((ligne) => ({
    id: ligne.id,
    libelle: ligne.label,
    detail:
      ligne.genre === 'lot'
        ? ligne.garmentDetails.length > 0
          ? `${ligne.quantity} kg · ${ligne.garmentDetails
              .map((detail) => `${detail.quantity} × ${LIBELLES_ARTICLES.get(detail.type) ?? detail.type}`)
              .join(', ')}`
          : 'Composition à préciser'
        : ligne.serviceName,
    quantite: ligne.quantity,
    unite: ligne.genre === 'lot' ? 'KG' : 'PIECE',
    prixUnitaire: ligne.unitPrice,
    total: totalLigne(ligne),
  }))

  const prestationKiloCourante = prestationsKilo.find((service) => service.id === prestationKilo)

  /** Crée le lot au kilo s'il n'existe pas encore, et renvoie son identifiant. */
  const assurerLot = (service?: TenantServiceOffering): string => {
    const existant = lignes.find((ligne) => ligne.genre === 'lot')
    if (existant) return existant.id

    const choisi = service ?? prestationKiloCourante ?? prestationsKilo[0]
    const id = idLigne()
    setLignes((current) => [
      ...current,
      {
        id,
        genre: 'lot',
        type: null,
        label: choisi?.serviceName ?? 'Lavage au kilo',
        quantity: 1,
        unitPrice: choisi?.unitPrice ?? 0,
        serviceName: choisi?.serviceName ?? null,
        tenantServiceId: referenceServeur(choisi?.id),
        activityNameSnapshot: choisi?.activityName ?? null,
        garmentDetails: [],
      },
    ])
    return id
  }

  // En blanchisserie, le lot au kilo existe dès l'arrivée sur l'écran des
  // articles : le comptoir voit tout de suite où saisir le poids et le tarif.
  useEffect(() => {
    if (etape !== 1 || parcours !== 'blanchisserie' || lotInitialise.current) return
    lotInitialise.current = true
    assurerLot()
    // `assurerLot` ne dépend que de l'état courant ; l'effet ne doit se
    // déclencher qu'une fois par entrée dans l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etape, parcours])

  // Prix par défaut du lot quand le catalogue arrive après l'écran.
  useEffect(() => {
    if (parcours !== 'blanchisserie' || prestationKilo !== '') return
    const premier = prestationsKilo[0]
    if (!premier) return
    setPrestationKilo(premier.id)
    setLignes((current) =>
      current.map((ligne) =>
        ligne.genre === 'lot' && ligne.unitPrice === 0 && premier.unitPrice
          ? { ...ligne, unitPrice: premier.unitPrice, serviceName: premier.serviceName, tenantServiceId: referenceServeur(premier.id), activityNameSnapshot: premier.activityName }
          : ligne,
      ),
    )
  }, [parcours, prestationKilo, prestationsKilo])

  const ajouterArticle = (type: OrderGarmentType) => {
    if (parcours === 'blanchisserie') {
      assurerLot()
      setLignes((current) =>
        current.map((ligne) => {
          if (ligne.genre !== 'lot') return ligne
          const details = [...ligne.garmentDetails]
          const index = details.findIndex((detail) => detail.type === type)
          if (index >= 0) details[index] = { ...details[index]!, quantity: details[index]!.quantity + 1 }
          else details.push({ type, quantity: 1 })
          return { ...ligne, garmentDetails: details }
        }),
      )
      return
    }

    setLignes((current) => {
      const existante = current.find((ligne) => ligne.genre === 'piece' && ligne.type === type)
      if (existante) {
        return current.map((ligne) =>
          ligne.id === existante.id ? { ...ligne, quantity: ligne.quantity + 1 } : ligne,
        )
      }
      const prestation = prestationsPiece.find((service) => service.id === prestationPiece)
      return [
        ...current,
        {
          id: idLigne(),
          genre: 'piece',
          type,
          label: LIBELLES_ARTICLES.get(type) ?? type,
          quantity: 1,
          unitPrice: 0,
          serviceName: prestation?.serviceName ?? null,
          tenantServiceId: referenceServeur(prestation?.id),
          activityNameSnapshot: prestation?.activityName ?? null,
          garmentDetails: [],
        },
      ]
    })
  }

  const ajouterArticleLibre = () => {
    const libelle = articleLibre.trim()
    if (libelle.length < 2) {
      toast.error('Donnez un nom à l’article (deux caractères minimum).')
      return
    }
    const prestation = prestationsPiece.find((service) => service.id === prestationPiece)
    setLignes((current) => [
      ...current,
      {
        id: idLigne(),
        genre: 'piece',
        type: null,
        label: libelle,
        quantity: 1,
        unitPrice: 0,
        serviceName: prestation?.serviceName ?? null,
        tenantServiceId: referenceServeur(prestation?.id),
        activityNameSnapshot: prestation?.activityName ?? null,
        garmentDetails: [],
      },
    ])
    setArticleLibre('')
  }

  const modifierQuantite = (id: string, valeur: number) => {
    setLignes((current) =>
      current.map((ligne) => {
        if (ligne.id !== id) return ligne
        if (ligne.genre === 'lot') {
          const poids = Number.isFinite(valeur) ? Number(Math.max(0, valeur).toFixed(3)) : 0
          return { ...ligne, quantity: poids }
        }
        const quantite = Number.isFinite(valeur) ? Math.max(1, Math.floor(valeur)) : 1
        return { ...ligne, quantity: quantite }
      }),
    )
  }

  const modifierPrix = (id: string, valeur: number) => {
    setLignes((current) =>
      current.map((ligne) =>
        ligne.id === id
          ? { ...ligne, unitPrice: Number.isFinite(valeur) ? Math.max(0, Math.floor(valeur)) : 0 }
          : ligne,
      ),
    )
  }

  const supprimerLigne = (id: string) => {
    setLignes((current) => current.filter((ligne) => ligne.id !== id))
  }

  const changerPrestationKilo = (serviceId: string) => {
    setPrestationKilo(serviceId)
    const service = prestationsKilo.find((entree) => entree.id === serviceId)
    setLignes((current) =>
      current.map((ligne) => {
        if (ligne.genre !== 'lot') return ligne
        if (!service) {
          return {
            ...ligne,
            label: 'Lavage au kilo',
            serviceName: null,
            tenantServiceId: null,
            activityNameSnapshot: null,
          }
        }
        return {
          ...ligne,
          label: service.serviceName,
          serviceName: service.serviceName,
          tenantServiceId: referenceServeur(service.id),
          activityNameSnapshot: service.activityName,
          unitPrice: service.unitPrice ?? ligne.unitPrice,
        }
      }),
    )
  }

  /** Lignes envoyées au moteur existant, au format `OrderItemInput`. */
  const lignesEnregistrees = (): OrderItemInput[] =>
    lignes.map((ligne) => {
      const price = totalLigne(ligne)
      if (ligne.genre === 'lot') {
        return {
          label: ligne.label,
          price,
          quantity: ligne.quantity,
          unitPrice: ligne.unitPrice,
          billingUnit: 'KG',
          pricingMode: 'FIXED',
          priceStatus: 'CONFIRMED',
          ...(ligne.serviceName ? { serviceName: ligne.serviceName } : {}),
          ...(ligne.tenantServiceId ? { tenantServiceId: ligne.tenantServiceId } : {}),
          ...(ligne.activityNameSnapshot
            ? { activityNameSnapshot: ligne.activityNameSnapshot }
            : {}),
          ...(ligne.garmentDetails.length > 0 ? { garmentDetails: ligne.garmentDetails } : {}),
        } satisfies OrderItemInput
      }
      return {
        label: ligne.label,
        price,
        quantity: ligne.quantity,
        unitPrice: ligne.unitPrice,
        billingUnit: 'PIECE',
        pricingMode: 'FIXED',
        priceStatus: 'CONFIRMED',
        ...(ligne.serviceName ? { serviceName: ligne.serviceName } : {}),
        ...(ligne.tenantServiceId ? { tenantServiceId: ligne.tenantServiceId } : {}),
        ...(ligne.activityNameSnapshot ? { activityNameSnapshot: ligne.activityNameSnapshot } : {}),
      } satisfies OrderItemInput
    })

  /**
   * Motifs de refus tarifaires (prix unitaire à zéro, total incohérent).
   *
   * ⚠️ Il n'existe plus de déclencheur `guard_order_item_price` côté serveur
   * depuis la migration 020 : cette règle est appliquée **par le formulaire**,
   * et la seule contrainte SQL restante est `price >= 0`. Ne pas compter sur la
   * base pour rattraper une ligne à 0 FCFA.
   */
  const problemesTarifaires = (): string[] =>
    lignes.flatMap((ligne) => {
      const probleme = problemeTarifaire({
        label: ligne.label,
        unitPrice: ligne.unitPrice,
        price: totalLigne(ligne),
      })
      return probleme ? [probleme] : []
    })

  const controlerArticles = (): boolean => {
    const parsed = createOrderSchema.safeParse({
      customerName,
      customerPhone,
      items: lignesEnregistrees(),
      dueDate: dueDate || undefined,
    })
    const problemes = [...(parsed.success ? [] : zodMessages(parsed.error)), ...problemesTarifaires()]
    if (problemes.length > 0) {
      setErrors(problemes)
      toast.error(problemes[0] ?? 'Vérifiez les informations saisies.')
      return false
    }
    setErrors([])
    return true
  }

  const changerEtape = (cible: Etape) => {
    if (submitting || cible === etape) return
    if (cible === 2) controlerArticles()
    setEtape(cible)
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  const choisirParcours = (choisi: ParcoursService) => {
    if (submitting) return
    setParcours(choisi)
    setEtape(1)
    lotInitialise.current = false
    setLignes((current) => (choisi === 'pressing' ? current.filter((l) => l.genre === 'piece') : current))
    setErrors([])
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  const aDesDonnees =
    lignes.length > 0 || customerName.trim() !== '' || customerPhone.trim() !== ''

  /**
   * Recharger la page ou fermer l'onglet en pleine saisie effaçait la commande
   * sans un mot (constat D5 de l'audit). Le navigateur ne peut pas afficher un
   * message personnalisé, mais il demande bien confirmation : c'est déjà la
   * différence entre « j'ai perdu la commande » et « j'ai cliqué par erreur ».
   *
   * Le garde ne s'arme que si quelque chose a réellement été saisi, et se
   * libère de lui-même au démontage (enregistrement ou sortie du parcours).
   */
  useEffect(() => {
    if (!aDesDonnees) return undefined

    const prevenir = (evenement: BeforeUnloadEvent) => {
      evenement.preventDefault()
      // Chrome n'affiche sa boîte de dialogue qu'avec `returnValue` renseigné.
      evenement.returnValue = ''
    }

    window.addEventListener('beforeunload', prevenir)
    return () => window.removeEventListener('beforeunload', prevenir)
  }, [aDesDonnees])

  const quitter = () => {
    if (aDesDonnees && !window.confirm('Abandonner cette commande ? Les informations saisies seront perdues.')) {
      return
    }
    navigate('/commandes')
  }

  const submit = async () => {
    if (enregistrementEnCours.current) return
    enregistrementEnCours.current = true

    void signalerSonde({
      evenement: 'clic_enregistrer',
      etape,
      lignes: lignes.length,
      total,
      peut_creer: canCreate,
      en_ligne: typeof navigator !== 'undefined' ? navigator.onLine : null,
      parcours,
    })

    if (!canCreate) {
      const message = `Création refusée : votre rôle (${roleEffectif ?? 'inconnu'}) n'a pas le droit de créer une commande.`
      setErrors([message])
      toast.error(message)
      void signalerIncidentCommande(message, { etape: 'droit', role: roleEffectif })
      window.scrollTo?.({ top: 0, behavior: 'smooth' })
      enregistrementEnCours.current = false
      return
    }

    setErrors([])
    setSubmitting(true)
    try {
      const parsed = createOrderSchema.safeParse({
        customerName,
        customerPhone,
        items: lignesEnregistrees(),
        dueDate: dueDate || undefined,
      })
      if (!parsed.success) {
        const messages = zodMessages(parsed.error)
        setErrors(messages)
        toast.error(messages[0] ?? 'Vérifiez les informations saisies.')
        // Nom, téléphone ou lignes : tout se corrige sur l'écran des articles.
        setEtape(1)
        void signalerIncidentCommande(messages[0] ?? 'Validation refusée.', {
          etape: 'validation',
          erreurs: messages,
        })
        return
      }

      // 1. Écriture locale immédiate (le comptoir ne dépend pas du réseau).
      setEnregistrement('local')
      const tarifs = problemesTarifaires()
      if (tarifs.length > 0) {
        setErrors(tarifs)
        setEtape(1)
        toast.error(tarifs[0]!)
        void signalerIncidentCommande(tarifs[0]!, { etape: 'tarif' })
        return
      }

      void signalerSonde({ evenement: 'creation_locale_demarree', etape, lignes: lignes.length })
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

      // 2. Envoi immédiat vers Supabase, sans attendre la boucle de fond.
      void signalerSonde({ evenement: 'commande_creee_localement', commande: order.id })
      setEnregistrement('serveur')
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
        toast(`Commande enregistrée sur cet appareil. ${envoi.message ?? ''}`.trim(), {
          icon: '📥',
          duration: 6000,
        })
      }

      navigate(
        paiement === 'especes' ? `/commandes/${order.id}?regler=1` : `/commandes/${order.id}`,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Impossible d'enregistrer la commande."
      setErrors([message])
      toast.error(message)
      void signalerIncidentCommande(message, { etape: 'creation_locale' })
      window.scrollTo?.({ top: 0, behavior: 'smooth' })
    } finally {
      enregistrementEnCours.current = false
      setSubmitting(false)
      setEnregistrement(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <button
          type="button"
          onClick={quitter}
          className="mb-3 min-h-10 text-sm font-semibold text-slate-600 hover:text-brand-navy"
        >
          ← Retour aux commandes
        </button>
        <h1 className="text-2xl font-bold text-brand-navy">Nouvelle commande</h1>
        <p className="mt-1 text-sm text-slate-500">
          {parcours
            ? `${PRESENTATION_PARCOURS[parcours].titre} — les informations sont enregistrées localement avant synchronisation.`
            : 'Choisissez le type de service pour commencer la commande.'}
        </p>
      </header>

      <ol className="grid grid-cols-3 gap-2" aria-label="Étapes de création de commande">
        {ETAPES.map(({ titre, icon: Icon }, index) => {
          const active = index === etape
          const complete = index < etape
          return (
            <li key={titre}>
              <button
                type="button"
                onClick={() => changerEtape(index as Etape)}
                aria-current={active ? 'step' : undefined}
                aria-label={`Étape ${index + 1} : ${titre}`}
                disabled={submitting || (index > 0 && !parcours)}
                className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border px-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                  active
                    ? 'border-brand-teal bg-brand-teal/5 text-brand-navy'
                    : complete
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-brand-teal hover:text-brand-navy'
                }`}
              >
                {complete ? <Check size={17} aria-hidden /> : <Icon size={17} aria-hidden />}
                <span className="truncate">
                  {index + 1}. {titre}
                </span>
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

      {/* ---------------------------------------------------------------- */}
      {/* Écran 1 — choix du service                                        */}
      {/* ---------------------------------------------------------------- */}
      {etape === 0 && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Quel type de service ?</h2>
            <p className="text-sm text-slate-500">
              Le choix détermine la grille d’articles et le mode de facturation.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['pressing', 'blanchisserie'] as const).map((choix) => (
              <ServiceChoiceCard
                key={choix}
                parcours={choix}
                actif={parcours === choix}
                nombrePrestations={servicesDuParcours(prestations, choix).length}
                onChoisir={choisirParcours}
              />
            ))}
          </div>
          <p className="text-xs text-slate-500">
            {prestations.length === 0
              ? 'Aucune prestation n’est configurée pour ce pressing : les prix se saisissent au comptoir, article par article (Paramètres → Services & activités pour les configurer).'
              : `${prestations.length} prestation${prestations.length > 1 ? 's' : ''} configurée${prestations.length > 1 ? 's' : ''} pour ce pressing.`}
          </p>
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={quitter}
              className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Annuler
            </button>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Écran 2 — client, articles et panier                              */}
      {/* ---------------------------------------------------------------- */}
      {etape === 1 && parcours && (
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-800">
              {PRESENTATION_PARCOURS[parcours].titre} — client et articles
            </h2>
            <button
              type="button"
              onClick={() => setEtape(0)}
              disabled={submitting}
              className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Changer de service
            </button>
          </div>

          {/* Client */}
          <div className="space-y-3 rounded-xl border border-slate-200 p-3 sm:p-4">
            <h3 className="text-sm font-bold text-slate-700">Client</h3>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600">
                Rechercher un client déjà venu
              </span>
              <span className="relative block">
                <Search
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  value={rechercheClient}
                  onChange={(evenement) => setRechercheClient(evenement.target.value)}
                  placeholder="Nom ou téléphone…"
                  aria-label="Rechercher un client"
                  className="min-h-12 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-base outline-none focus:border-brand-teal"
                />
              </span>
            </label>
            {resultatsClient.length > 0 && (
              <ul className="space-y-1">
                {resultatsClient.map((client) => (
                  <li key={`${client.phone}-${client.name}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerName(client.name)
                        setCustomerPhone(client.phone)
                        setRechercheClient('')
                      }}
                      aria-label={`Choisir le client ${client.name}`}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-brand-teal hover:bg-teal-50"
                    >
                      <span className="font-semibold text-slate-800">{client.name}</span>
                      <span className="text-xs text-slate-500">
                        {client.phone} · {client.commandes} commande{client.commandes > 1 ? 's' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">Nom du client</span>
                <input
                  value={customerName}
                  onChange={(evenement) => setCustomerName(evenement.target.value)}
                  placeholder="Ex. Mme Awa Koné"
                  autoComplete="name"
                  aria-invalid={errors.length > 0 && customerName.trim().length < 2 ? true : undefined}
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">Téléphone</span>
                <input
                  value={customerPhone}
                  onChange={(evenement) => setCustomerPhone(evenement.target.value)}
                  placeholder="07 00 00 00 00"
                  inputMode="tel"
                  autoComplete="tel"
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
                />
                {customerPhone && previousOrderCount > 0 && (
                  <span className="block text-xs text-slate-500">
                    {suggestedName || 'Client connu'} — {previousOrderCount} commande
                    {previousOrderCount > 1 ? 's' : ''} précédente
                    {previousOrderCount > 1 ? 's' : ''}
                  </span>
                )}
                {customerPhone &&
                  previousOrderCount === 0 &&
                  suggestCustomersByPhone(localOrders ?? [], customerPhone).length > 0 && (
                    <span className="block text-xs text-slate-500">
                      Un client connu utilise déjà ce numéro.
                    </span>
                  )}
              </label>
              <label className="block space-y-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">
                  Livraison promise <span className="font-normal text-slate-500">(facultatif)</span>
                </span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(evenement) => setDueDate(evenement.target.value)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
                />
              </label>
            </div>
          </div>

          {/* Prestation appliquée */}
          <div className="grid gap-3 sm:grid-cols-2">
            {parcours === 'blanchisserie' ? (
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">Prestation au kilo</span>
                <select
                  value={prestationKilo}
                  onChange={(evenement) => changerPrestationKilo(evenement.target.value)}
                  aria-label="Prestation au kilo"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                >
                  <option value="">Lavage au kilo (saisie libre)</option>
                  {prestationsKilo.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.serviceName}
                      {service.unitPrice ? ` — ${formatFcfa(service.unitPrice)}/kg` : ''}
                    </option>
                  ))}
                </select>
                <span className="block text-xs text-slate-500">
                  Le tarif configuré est proposé ; celui saisi dans le panier fait foi.
                </span>
              </label>
            ) : (
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">
                  Prestation appliquée <span className="font-normal text-slate-500">(facultatif)</span>
                </span>
                <select
                  value={prestationPiece}
                  onChange={(evenement) => setPrestationPiece(evenement.target.value)}
                  aria-label="Prestation appliquée aux articles"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                >
                  <option value="">Aucune prestation</option>
                  {prestationsPiece.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.serviceName} — {service.activityName}
                    </option>
                  ))}
                </select>
                <span className="block text-xs text-slate-500">
                  S’applique aux articles ajoutés ensuite ; les prix restent saisissables.
                </span>
              </label>
            )}
          </div>

          {/* Grille + panier */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-4">
              <OrderItemGrid
                articles={articles}
                quantites={quantitesGrille}
                onAjouter={ajouterArticle}
                legende={
                  parcours === 'blanchisserie'
                    ? 'Touchez le linge déposé : il s’ajoute à la composition du lot pesé.'
                    : 'Touchez un article pour l’ajouter. Les quantités se corrigent dans le panier.'
                }
              />

              {parcours === 'pressing' && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Article libre
                  </h3>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={articleLibre}
                      onChange={(evenement) => setArticleLibre(evenement.target.value)}
                      onKeyDown={(evenement) => {
                        if (evenement.key === 'Enter') {
                          evenement.preventDefault()
                          ajouterArticleLibre()
                        }
                      }}
                      placeholder="Ex. Rideau, couverture…"
                      aria-label="Libellé de l’article libre"
                      className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal"
                    />
                    <button
                      type="button"
                      onClick={ajouterArticleLibre}
                      className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50"
                    >
                      <Plus size={16} aria-hidden /> Ajouter
                    </button>
                  </div>
                </div>
              )}
            </div>

            <OrderBasket
              lignes={lignesPanier}
              total={total}
              onQuantite={modifierQuantite}
              onPrix={modifierPrix}
              onSupprimer={supprimerLigne}
              onVider={() => setLignes([])}
            />
          </div>

          {errors.length > 0 && (
            <div role="alert" className="space-y-1 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
              {errors.map((erreur, index) => (
                <p key={`${index}-${erreur}`}>{erreur}</p>
              ))}
            </div>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEtape(0)}
              disabled={submitting}
              className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Précédent
            </button>
            <button
              type="button"
              onClick={() => changerEtape(2)}
              disabled={submitting}
              className="min-h-12 rounded-xl bg-brand-teal px-5 font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Écran 3 — récapitulatif et enregistrement                         */}
      {/* ---------------------------------------------------------------- */}
      {etape === 2 && parcours && (
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <OrderSummary
            parcours={parcours}
            clientName={customerName}
            clientPhone={customerPhone}
            dueDate={dueDate}
            lignes={lignesPanier}
            total={total}
            erreurs={errors}
          />

          <div>
            <h3 className="text-sm font-bold text-slate-700">Règlement</h3>
            <p className="text-sm text-slate-500">
              Le paiement immédiat ouvre le panneau d’encaissement après l’enregistrement.
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {(['plus-tard', 'especes'] as const).map((mode) => {
                const selected = paiement === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaiement(mode)}
                    aria-pressed={selected}
                    className={`min-h-20 rounded-xl border p-3 text-left ${
                      selected ? 'border-brand-teal bg-brand-teal/5' : 'border-slate-300 hover:border-brand-teal'
                    }`}
                  >
                    <span className="block font-semibold text-slate-800">
                      {mode === 'plus-tard' ? 'Régler plus tard' : 'Encaisser des espèces maintenant'}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500">
                      {mode === 'plus-tard'
                        ? 'Le solde restera dû sur la fiche.'
                        : 'La commande sera créée, puis le panneau espèces s’ouvrira.'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEtape(1)}
              disabled={submitting}
              className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Modifier les articles
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={quitter}
                disabled={submitting}
                className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submit}
                // Volontairement actif même sans droit : le clic doit produire
                // une explication (et une trace), jamais un silence.
                disabled={submitting}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-5 font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50"
              >
                <Wallet size={18} aria-hidden />
                {enregistrement === 'serveur'
                  ? 'Envoi au serveur…'
                  : submitting
                    ? 'Enregistrement…'
                    : 'Enregistrer la commande'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Rappel du total, utile sur téléphone où le panier est plus bas. */}
      {(etape === 1 || etape === 2) && (
        <p className="text-right text-sm font-semibold text-slate-600">
          Total de la commande : <span className="text-brand-navy">{formatFcfa(total)}</span>
        </p>
      )}

      <p className="sr-only" aria-live="polite">
        {activites.length} activité(s) configurée(s), {lignes.length} ligne(s) au panier.
      </p>
    </div>
  )
}
