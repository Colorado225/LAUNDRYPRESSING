import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, Check, Lock, PenLine, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCreateOrder } from '@/db/hooks'
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
import type { LocalCatalogEntry } from '@/db/localDb'

/**
 * Création de commande — 100 % locale.
 *
 * Aucun appel réseau n'est effectué pour enregistrer la commande : elle est
 * écrite dans IndexedDB puis envoyée par le moteur de synchronisation dès que
 * la connexion revient. C'est le cœur du fonctionnement en mode avion.
 *
 * Palier 2 : les lignes peuvent venir du **catalogue** (prix proposé, corrigeable)
 * ou être saisies **librement**. Dans les deux cas, le libellé et le prix sont
 * recopiés sur la ligne : une modification ultérieure du catalogue ne change
 * jamais une commande déjà enregistrée.
 */

const EMPTY_ITEM: OrderItemDraft = {
  mode: 'catalog',
  label: '',
  fabricType: '',
  specialInstructions: '',
  price: 0,
  catalogEntryId: undefined,
  articleName: undefined,
  serviceName: undefined,
  priceReason: undefined,
}

interface OrderItemDraft extends OrderItemInput {
  mode: 'catalog' | 'free'
}

export default function OrderForm() {
  const navigate = useNavigate()
  const createOrder = useCreateOrder()
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const canCreate = can(role, 'orders.create')

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [items, setItems] = useState<OrderItemDraft[]>([{ ...EMPTY_ITEM }])
  const [catalog, setCatalog] = useState<LocalCatalogEntry[]>([])
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

  const articles = uniqueArticles(catalog)
  const catalogueDisponible = articles.length > 0

  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.price) ? item.price : 0), 0)

  const updateItem = (index: number, patch: Partial<OrderItemDraft>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const addItem = () =>
    setItems((current) => [
      ...current,
      { ...EMPTY_ITEM, mode: catalogueDisponible ? 'catalog' : 'free' },
    ])

  const removeItem = (index: number) => {
    setItems((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)))
  }

  const choisirArticle = (index: number, article: string) => {
    const prestations = servicesForArticle(catalog, article)
    const premiere = prestations[0]

    updateItem(index, {
      articleName: article,
      serviceName: premiere?.service,
      catalogEntryId: premiere?.id,
      price: premiere?.price ?? 0,
      label: premiere ? `${article} — ${premiere.service}` : article,
    })
  }

  const choisirPrestation = (index: number, entryId: string) => {
    const entree = catalog.find((candidate) => candidate.id === entryId)
    if (!entree) return

    updateItem(index, {
      catalogEntryId: entree.id,
      articleName: entree.article,
      serviceName: entree.service,
      price: entree.price,
      label: `${entree.article} — ${entree.service}`,
    })
  }

  const basculerMode = (index: number, mode: 'catalog' | 'free') => {
    if (mode === 'free') {
      updateItem(index, {
        mode,
        catalogEntryId: undefined,
        articleName: undefined,
        serviceName: undefined,
      })
      return
    }

    const article = items[index]?.articleName ?? articles[0]
    if (!article) return
    choisirArticle(index, article)
    updateItem(index, { mode })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrors([])

    const lignes: OrderItemInput[] = items.map(({ mode: _mode, ...item }) => item)

    // Tarif dérogatoire : le serveur refuse un prix différent du catalogue sans
    // motif (22023). On bloque ici pour éviter un aller-retour inutile.
    const derogeSansMotif = items.some((item) => {
      const prixCatalogue = catalog.find((entree) => entree.id === item.catalogEntryId)?.price
      return (
        item.mode === 'catalog' &&
        item.catalogEntryId !== undefined &&
        prixCatalogue !== undefined &&
        item.price !== prixCatalogue &&
        (item.priceReason ?? '').trim().length < 10
      )
    })

    if (derogeSansMotif) {
      setErrors([
        'Un prix différent du catalogue exige un motif de 10 caractères minimum (geste commercial, tache, retouche…).',
      ])
      return
    }

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
        </section>

        {/* Vêtements */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
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

          {!catalogueDisponible && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              Aucune prestation au catalogue pour l’instant : les lignes sont saisies
              librement. Le propriétaire peut installer une grille de départ depuis
              l’onglet « Prestations ».
            </p>
          )}

          <ul className="mt-3 space-y-3">
            {items.map((item, index) => (
              <li key={index} className="rounded-xl bg-slate-50 p-3">
                {catalogueDisponible && (
                  <div className="mb-3 flex gap-2">
                    <ModeButton
                      actif={item.mode === 'catalog'}
                      onClick={() => basculerMode(index, 'catalog')}
                      icon={<BookOpen size={14} aria-hidden />}
                      label="Catalogue"
                    />
                    <ModeButton
                      actif={item.mode === 'free'}
                      onClick={() => basculerMode(index, 'free')}
                      icon={<PenLine size={14} aria-hidden />}
                      label="Saisie libre"
                    />
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  {item.mode === 'catalog' && catalogueDisponible ? (
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
                              {entree.service} — {formatFcfa(entree.price)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </>
                  ) : (
                    <Field label="Vêtement" htmlFor={`item-label-${index}`}>
                      <input
                        id={`item-label-${index}`}
                        value={item.label}
                        onChange={(event) => updateItem(index, { label: event.target.value })}
                        placeholder="Costume 3 pièces"
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
                      label="Prix (FCFA)"
                      htmlFor={`item-price-${index}`}
                      hint={
                        item.mode === 'catalog' && item.catalogEntryId
                          ? 'Prix du catalogue — corrigeable au comptoir'
                          : undefined
                      }
                    >
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

                  {(() => {
                    const prixCatalogue = catalog.find(
                      (entree) => entree.id === item.catalogEntryId,
                    )?.price
                    const deroge =
                      item.mode === 'catalog' &&
                      prixCatalogue !== undefined &&
                      item.price !== prixCatalogue

                    if (!deroge) return null

                    return (
                      <Field
                        label="Motif du tarif dérogatoire"
                        htmlFor={`item-reason-${index}`}
                        hint={`Prix du catalogue : ${formatFcfa(prixCatalogue)}. Un motif est exigé et journalisé.`}
                      >
                        <input
                          id={`item-reason-${index}`}
                          value={item.priceReason ?? ''}
                          onChange={(event) =>
                            updateItem(index, { priceReason: event.target.value })
                          }
                          maxLength={300}
                          placeholder="Geste commercial : tache ancienne signalée par le client"
                          className="min-h-12 w-full rounded-xl border border-amber-300 bg-amber-50 px-3 text-base outline-none focus:border-amber-500"
                        />
                      </Field>
                    )
                  })()}
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
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
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
