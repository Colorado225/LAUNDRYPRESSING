import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Plus, Trash2, UserRound, Shirt, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCreateOrder, useLocalOrders } from '@/db/hooks'
import { suggestCustomersByPhone } from '@/lib/customerSuggestions'
import { createOrderSchema, zodMessages, type OrderItemInput } from '@/schemas/order'
import { formatFcfa } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import {
  fetchTenantServiceConfiguration,
  type TenantActivity,
  type TenantServiceOffering,
} from '@/services/tenantServices'
import { GARMENT_TYPES, formatGarmentComposition } from '@/constants/garmentTypes'
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
  const canCreate = can(role, 'orders.create')

  const [activites, setActivites] = useState<TenantActivity[]>([])
  const [prestations, setPrestations] = useState<TenantServiceOffering[]>([])
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

  const activitesDisponibles = [...activites].sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  const total = items.reduce((sum, item) => sum + item.price, 0)

  const updateItem = (index: number, patch: Partial<OrderItemDraft>) => {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item
      const updated = { ...item, ...patch }
      updated.price = Math.round(updated.quantity * updated.unitPrice)
      return updated
    }))
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
    updateItem(index, {
      selectedOfferingId: offering.id,
      serviceName: offering.serviceName,
      tenantServiceId: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(offering.id)
        ? offering.id
        : null,
      activityNameSnapshot: offering.activityName,
      label,
      billingUnit: offering.billingUnit,
      quantity: 1,
      unitPrice: offering.unitPrice ?? 0,
      garmentDetails: auKilo ? [{ type: '', quantity: 1 }] : [],
    })
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
  const controlerEtape = (step: number): boolean => {
    const parsed = step === 0
      ? createOrderSchema.pick({ customerName: true, customerPhone: true, dueDate: true }).safeParse({
          customerName,
          customerPhone,
          dueDate: dueDate || undefined,
        })
      : createOrderSchema.pick({ items: true }).safeParse({ items })

    if (parsed.success) {
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
    if (!canCreate) {
      setErrors(["Vous n'avez pas le droit de créer une commande."])
      return
    }

    setErrors([])
    setSubmitting(true)
    try {
      const parsed = createOrderSchema.safeParse({
        customerName,
        customerPhone,
        items,
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
        return
      }

      const { order } = await createOrder(parsed.data)
      toast.success('Commande enregistrée sur cet appareil.')
      navigate(paiement === 'especes'
        ? `/commandes/${order.id}?regler=1`
        : '/commandes')
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "Impossible d'enregistrer la commande.",
      ])
    } finally {
      setSubmitting(false)
    }
  }

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
                <p className="text-sm text-slate-500">Pour une prestation au kilo, énumérez les vêtements, pesez le lot et confirmez le tarif par kilo.</p>
              </div>
              <button type="button" onClick={() => setItems((current) => [...current, createEmptyItem()])} disabled={submitting} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"><Plus size={17} aria-hidden /> Ajouter une ligne</button>
            </div>

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
                        <span className="text-xs font-semibold text-slate-600">Article / vêtement</span>
                        <input value={item.label} onChange={(event) => updateItem(index, { label: event.target.value })} placeholder="Ex. Chemise" className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                      </label>
                    )}
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">{item.billingUnit === 'KG' ? 'Poids total (kg)' : 'Quantité'}</span>
                      <input type="number" min={item.billingUnit === 'KG' ? '0.001' : '1'} step={item.billingUnit === 'KG' ? '0.001' : '1'} value={item.quantity || ''} onChange={(event) => updateItem(index, { quantity: item.billingUnit === 'KG' ? Math.max(0, Number(event.target.value) || 0) : Math.max(1, Number(event.target.value) || 1) })} aria-label={item.billingUnit === 'KG' ? `Poids total (kg) ligne ${index + 1}` : `Quantité ligne ${index + 1}`} className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">{item.billingUnit === 'KG' ? 'Tarif/kg (FCFA)' : 'Prix unitaire (FCFA)'}</span>
                      <input type="number" min="1" step="1" value={item.unitPrice || ''} onChange={(event) => updateItem(index, { unitPrice: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} aria-label={item.billingUnit === 'KG' ? `Tarif au kilo ligne ${index + 1} (FCFA)` : `Prix unitaire ligne ${index + 1} (FCFA)`} className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
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
                      <span className="text-xs font-semibold text-slate-600">Prestation <span className="font-normal">(facultatif)</span></span>
                      <select value={item.selectedOfferingId} onChange={(event) => choisirPrestation(index, event.target.value)} aria-label={`Prestation de la ligne ${index + 1}`} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal">
                        <option value="">Choisir une prestation</option>
                        <option value="__free__">Saisir une prestation libre</option>
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
                  <p className="mt-3 text-right text-sm font-semibold text-slate-700">Total de la ligne : {formatFcfa(item.price)}</p>
                </fieldset>
              ))}
            </div>
            {prestations.length === 0 && (
              <p className="text-xs text-slate-500">Aucune prestation n’est encore configurée. Vous pouvez laisser la ligne sans prestation ou en saisir une librement.</p>
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
              <button type="button" onClick={submit} disabled={submitting || !canCreate} className="min-h-12 rounded-xl bg-brand-teal px-5 font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50">{submitting ? 'Enregistrement…' : 'Enregistrer la commande'}</button>
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
