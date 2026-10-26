import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  PenLine,
  Plus,
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

/**
 * Création de commande - 100% local, en trois etapes.
 * Etapes : Client -> Vetements -> Paiement.
 * Les lignes sont saisies librement (libelle, quantite, prix).
 */

interface OrderItemDraft extends OrderItemInput {
  quantity: number
  unitPrice: number
}

const EMPTY_ITEM: OrderItemDraft = {
  label: '',
  fabricType: '',
  specialInstructions: '',
  price: 0,
  quantity: 1,
  unitPrice: 0,
}

type Paiement = 'plus-tard' | 'especes'

const ETAPES = [
  { titre: 'Client', icon: UserRound },
  { titre: 'Lignes', icon: Shirt },
  { titre: 'Paiement', icon: Wallet },
] as const

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
  const [dueDate, setDueDate] = useState('')
  const [items, setItems] = useState<OrderItemDraft[]>([EMPTY_ITEM])
  const [paiement, setPaiement] = useState<Paiement>('plus-tard')
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const total = items.reduce((s, item) => s + item.price, 0)

  const updateItem = (index: number, patch: Partial<OrderItemDraft>) => {
    setItems((current) => {
      const copie = [...current]
      copie[index] = { ...copie[index], ...patch }
      return copie
    })
  }

  const ajouterLigne = () => {
    setItems([...items, EMPTY_ITEM])
  }

  const supprimerLigne = (index: number) => {
    if (items.length === 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  const validerEtape = (numero: number): boolean => {
    setErrors([])
    if (numero === 0) {
      const parsed = createOrderSchema.pick({
        customerName: true,
        customerPhone: true,
        dueDate: true,
      }).safeParse({
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
      const parsed = createOrderSchema.pick({ items: true }).safeParse({ items })
      if (!parsed.success) {
        setErrors(zodMessages(parsed.error))
        return false
      }
      return true
    }
    return true
  }

  const soumettre = async () => {
    if (!canCreate) {
      setErrors(["Vous n'avez pas le droit de creer une commande."])
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
      await createOrder(parsed.data)
      const toutesLesCommandes = localOrders ?? []
      if (toutesLesCommandes.length > 0) {
        toast.success("Commande enregistree localement.")
      }
      navigate('/commandes')
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "Impossible d'enregistrer la commande.",
      ])
    } finally {
      setSubmitting(false)
    }
  }

      {etape === 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600">Nom du client</label>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Ex. M. Kouassi"
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600">Telephone</label>
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="07 00 00 00 00"
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
            />
            {suggestCustomersByPhone(customerPhone).length > 0 && (
              <p className="text-xs text-slate-500">
                Client(s) connu(s) trouve(s) pour ce numero.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600">Date de livraison promise (optionnel)</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-teal"
            />
          </div>
          {errors.length > 0 && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="flex items-start gap-2">
                  <span className="flex shrink-0 items-center">Warning</span>{e}
                </p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { if (validerEtape(0)) setEtape(1) }}
              disabled={submitting}
              className="min-h-12 px-4 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => { if (validerEtape(0)) setEtape(1) }}
              disabled={submitting || !customerName || !customerPhone}
              className="min-h-12 px-4 rounded-xl border border-brand-teal bg-brand-teal text-white hover:bg-brand-teal/90 disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {etape === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Vetements et articles</h2>
            <button
              type="button"
              onClick={ajouterLigne}
              disabled={submitting}
              className="min-h-12 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              <Plus size={16} aria-hidden /> Ajouter une ligne
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-600">Article / vetement</label>
                      <input
                        value={item.label}
                        onChange={(e) => updateItem(index, { label: e.target.value })}
                        placeholder="Costume 3 pièces"
                        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-600">Quantite</label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, { quantity: Number(e.target.value) || 1 })}
                          min="1" step="1"
                          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-600">Prix unitaire (FCFA)</label>
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(index, { unitPrice: Number(e.target.value) || 0, price: (Number(e.target.value) || 0) * item.quantity })}
                          min="0" step="1"
                          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-600">Total ligne (FCFA)</label>
                        <input
                          type="number"
                          value={item.price}
                          onChange={(e) => updateItem(index, { price: Number(e.target.value) || 0 })}
                          min="0" step="1"
                          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base outline-none focus:border-brand-teal"
                          readOnly
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => supprimerLigne(index)}
                    className="min-h-11 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-700"
                    aria-label="Supprimer la ligne"
                  >
                    <Trash2 size={18} aria-hidden />
                  </button>
                </div>
                {item.fabricType && <p className="mt-2 text-xs text-slate-500">Tissu : {item.fabricType}</p>}
                {item.specialInstructions && <p className="mt-2 text-xs text-slate-500">Instructions : {item.specialInstructions}</p>}
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-xs font-semibold text-slate-700">Total de la commande</p>
            <p className="mt-1 text-lg font-bold text-brand-navy">{formatFcfa(total)}</p>
          </div>

          {errors.length > 0 && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="flex items-start gap-2">
                  <span className="flex shrink-0 items-center">Warning</span>{e}
                </p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { if (validerEtape(1)) setEtape(0) }}
              disabled={submitting}
              className="min-h-12 px-4 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Precedent
            </button>
            <button
              type="button"
              onClick={() => { if (validerEtape(1)) setEtape(2) }}
              disabled={submitting || items.length === 0}
              className="min-h-12 px-4 rounded-xl border border-brand-teal bg-brand-teal text-white hover:bg-brand-teal/90 disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
        </div>

      {etape === 2 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600">Mode de reglement</label>
            <div className="grid grid-cols-2 gap-3">
              {['plus-tard', 'especes'].map((mode) => {
                const actif = paiement === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaiement(mode)}
                    aria-pressed={actif}
                    className={`min-h-12 flex flex-col items-center gap-1 rounded-xl border p-3 text-left transition-colors ${actif ? 'border-brand-teal bg-brand-teal/5 text-brand-navy' : 'border-slate-300 bg-white text-slate-600 hover:border-brand-teal'}`}
                  >
                    <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${actif ? 'border-brand-teal' : 'border-slate-300'}`} aria-hidden>
                      {actif && <span className="size-2.5 rounded-full bg-brand-teal" />}
                    </span>
                    <span className="text-sm font-medium">{mode === 'plus-tard' ? 'Regler plus tard' : 'Especes'}</span>
                    <span className="text-xs text-slate-500">{mode === 'plus-tard' ? 'Le client paiera a la livraison' : 'Encaissement immediat'}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-xs font-semibold text-slate-700">Montant a collecter</p>
            <p className="mt-1 text-lg font-bold text-brand-navy">{formatFcfa(total)}</p>
          </div>

          {errors.length > 0 && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="flex items-start gap-2">
                  <span className="flex shrink-0 items-center">Warning</span>{e}
                </p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { if (validerEtape(2)) setEtape(1) }}
              disabled={submitting}
              className="min-h-12 px-4 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Precedent
            </button>
            <button
              type="button"
              onClick={soumettre}
              disabled={submitting || !customerName || !customerPhone}
              className="min-h-12 px-4 rounded-xl border border-brand-teal bg-brand-teal text-white hover:bg-brand-teal/90 disabled:opacity-50"
            >
              Enregistrer la commande
            </button>
          </div>
        </div>
      )}
    </div>
  )
}