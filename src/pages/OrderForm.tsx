import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Plus, Trash2, UserRound, Shirt, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCreateOrder, useLocalOrders } from '@/db/hooks'
import { suggestCustomersByPhone } from '@/lib/customerSuggestions'
import { createOrderSchema, zodMessages, type OrderItemInput } from '@/schemas/order'
import { formatFcfa } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'

/** Formulaire local-first de création d'une commande en trois étapes. */
interface OrderItemDraft extends OrderItemInput {
  quantity: number
  unitPrice: number
}

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
  const canCreate = can(role, 'orders.create')

  const [etape, setEtape] = useState(0)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [items, setItems] = useState<OrderItemDraft[]>([createEmptyItem()])
  const [paiement, setPaiement] = useState<Paiement>('plus-tard')
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const total = items.reduce((sum, item) => sum + item.price, 0)

  const updateItem = (index: number, patch: Partial<OrderItemDraft>) => {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item
      const updated = { ...item, ...patch }
      updated.price = Math.round(updated.quantity * updated.unitPrice)
      return updated
    }))
  }

  const validateStep = (step: number): boolean => {
    setErrors([])
    const parsed = step === 0
      ? createOrderSchema.pick({ customerName: true, customerPhone: true, dueDate: true }).safeParse({
          customerName,
          customerPhone,
          dueDate: dueDate || undefined,
        })
      : createOrderSchema.pick({ items: true }).safeParse({ items })

    if (!parsed.success) {
      setErrors(zodMessages(parsed.error))
      return false
    }
    return true
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
        setErrors(zodMessages(parsed.error))
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
              <div className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-2 text-sm font-semibold ${active ? 'border-brand-teal bg-brand-teal/5 text-brand-navy' : complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500'}`}>
                {complete ? <Check size={17} aria-hidden /> : <Icon size={17} aria-hidden />}
                <span>{index + 1}. {titre}</span>
              </div>
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
              <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Ex. Mme Awa Koné" autoComplete="name" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">Téléphone</span>
              <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="07 00 00 00 00" inputMode="tel" autoComplete="tel" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal" />
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
              <button type="button" onClick={() => { if (validateStep(0)) setEtape(1) }} disabled={submitting} className="min-h-12 rounded-xl bg-brand-teal px-5 font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50">Suivant</button>
            </div>
          </div>
        )}

        {etape === 1 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Vêtements et prestations</h2>
                <p className="text-sm text-slate-500">Saisissez le prix convenu pour chaque ligne.</p>
              </div>
              <button type="button" onClick={() => setItems((current) => [...current, createEmptyItem()])} disabled={submitting} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"><Plus size={17} aria-hidden /> Ajouter une ligne</button>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <fieldset key={index} className="rounded-xl border border-slate-200 p-3 sm:p-4">
                  <legend className="px-1 text-sm font-semibold text-slate-600">Ligne {index + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_150px_44px]">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Article / vêtement</span>
                      <input value={item.label} onChange={(event) => updateItem(index, { label: event.target.value })} placeholder="Ex. Chemise" className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Quantité</span>
                      <input type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(index, { quantity: Math.max(1, Number(event.target.value) || 1) })} className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Prix unitaire (FCFA)</span>
                      <input type="number" min="1" step="1" value={item.unitPrice || ''} onChange={(event) => updateItem(index, { unitPrice: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                    </label>
                    <button type="button" onClick={() => setItems((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))} disabled={items.length === 1 || submitting} aria-label={`Supprimer la ligne ${index + 1}`} className="mt-5 flex min-h-11 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"><Trash2 size={18} aria-hidden /></button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Type de tissu <span className="font-normal">(facultatif)</span></span>
                      <input value={item.fabricType ?? ''} onChange={(event) => updateItem(index, { fabricType: event.target.value })} placeholder="Ex. Bazin, Wax" className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">Instructions <span className="font-normal">(facultatif)</span></span>
                      <input value={item.specialInstructions ?? ''} onChange={(event) => updateItem(index, { specialInstructions: event.target.value })} placeholder="Ex. Empèsage fort" className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-base outline-none focus:border-brand-teal" />
                    </label>
                  </div>
                  <p className="mt-3 text-right text-sm font-semibold text-slate-700">Total de la ligne : {formatFcfa(item.price)}</p>
                </fieldset>
              ))}
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-600">Total de la commande</p>
              <p className="text-xl font-bold text-brand-navy">{formatFcfa(total)}</p>
            </div>
            <StepErrors errors={errors} />
            <div className="flex justify-between gap-3 pt-2">
              <button type="button" onClick={() => setEtape(0)} disabled={submitting} className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Précédent</button>
              <button type="button" onClick={() => { if (validateStep(1)) setEtape(2) }} disabled={submitting} className="min-h-12 rounded-xl bg-brand-teal px-5 font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50">Suivant</button>
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
              <button type="button" onClick={() => setEtape(1)} disabled={submitting} className="min-h-12 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Précédent</button>
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
