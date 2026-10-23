import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCreateOrder } from '@/db/hooks'
import { createOrderSchema, zodMessages, type OrderItemInput } from '@/schemas/order'
import { formatFcfa } from '@/lib/formatters'

/**
 * Création de commande — 100 % locale.
 *
 * Aucun appel réseau n'est effectué : la commande est écrite dans IndexedDB
 * puis envoyée par le moteur de synchronisation dès que la connexion revient.
 * C'est le cœur du fonctionnement en mode avion.
 */

const EMPTY_ITEM: OrderItemInput = {
  label: '',
  fabricType: '',
  specialInstructions: '',
  price: 0,
}

export default function OrderForm() {
  const navigate = useNavigate()
  const createOrder = useCreateOrder()

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [items, setItems] = useState<OrderItemInput[]>([{ ...EMPTY_ITEM }])
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.price) ? item.price : 0), 0)

  const updateItem = (index: number, patch: Partial<OrderItemInput>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const addItem = () => setItems((current) => [...current, { ...EMPTY_ITEM }])

  const removeItem = (index: number) => {
    setItems((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrors([])

    const parsed = createOrderSchema.safeParse({ customerName, customerPhone, items })
    if (!parsed.success) {
      setErrors(zodMessages(parsed.error))
      return
    }

    setSubmitting(true)
    try {
      const { order } = await createOrder(parsed.data)
      toast.success('Commande enregistrée sur cet appareil', { icon: '✅' })
      navigate(`/commandes/${order.id}`)
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

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Client */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Client</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Nom du client" htmlFor="customer-name">
              <input
                id="customer-name"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                autoComplete="name"
                placeholder="Aya Koné"
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
              />
            </Field>

            <Field label="Téléphone" htmlFor="customer-phone" hint="10 chiffres, ex. 07 00 00 00 00">
              <input
                id="customer-phone"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="07 00 00 00 00"
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
              />
            </Field>
          </div>
        </section>

        {/* Vêtements */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Vêtements</h2>
            <button
              type="button"
              onClick={addItem}
              className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:border-brand-teal active:bg-slate-50"
            >
              <Plus size={16} aria-hidden />
              Ajouter
            </button>
          </div>

          <ul className="mt-3 space-y-3">
            {items.map((item, index) => (
              <li key={index} className="rounded-xl bg-slate-50 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <Field label="Vêtement" htmlFor={`item-label-${index}`}>
                    <input
                      id={`item-label-${index}`}
                      value={item.label}
                      onChange={(event) => updateItem(index, { label: event.target.value })}
                      placeholder="Costume 3 pièces"
                      className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
                    />
                  </Field>

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
                    <Field label="Prix (FCFA)" htmlFor={`item-price-${index}`}>
                      <input
                        id={`item-price-${index}`}
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={item.price === 0 ? '' : item.price}
                        onChange={(event) =>
                          updateItem(index, {
                            price: event.target.value === '' ? 0 : Number(event.target.value),
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
                      aria-label={`Supprimer le vêtement ${index + 1}`}
                      className="mb-0 inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-40"
                    >
                      <Trash2 size={18} aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

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
            <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
            <p className="text-xl font-bold text-brand-navy">{formatFcfa(total)}</p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-5 text-base font-bold text-white transition-colors hover:bg-brand-teal-dark active:bg-brand-teal-dark disabled:opacity-60"
          >
            <Check size={18} aria-hidden />
            Enregistrer la commande
          </button>
        </div>
      </form>
    </div>
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
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}
