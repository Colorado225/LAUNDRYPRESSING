import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CloudOff,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Save,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Field, FieldLabel, Input } from '@/components/ui'
import { useLocalOrders } from '@/db/hooks'
import { isSupabaseConfigured } from '@/lib/env'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { formatDateFr, formatFcfa, formatPhoneCi } from '@/lib/formatters'
import { ORDER_STATUSES } from '@/constants/orders'
import {
  createCustomer,
  deleteCustomer,
  filterClients,
  listCustomerCards,
  mergeCustomerCards,
  normalisePhone,
  ordersForClient,
  updateCustomer,
} from '@/services/customerService'
import type { CustomerRow } from '@/types/database'

/**
 * Clients et historique (palier 3, CRUD complet depuis la migration 025).
 *
 * La liste et l'historique sont calculés à partir des commandes déjà présentes
 * sur la tablette : l'écran fonctionne donc hors ligne. Les fiches serveur, elles,
 * apportent deux choses : un client **créé avant toute commande** apparaît dans
 * la liste, et les informations de contact (e-mail, adresse, préférences) sont
 * partagées entre les appareils.
 *
 * Écritures :
 *  - création et modification : propriétaire et réceptionniste ;
 *  - suppression : propriétaire seul (la fiche disparaît, les commandes restent).
 */
interface CustomerFormState {
  name: string
  phone: string
  email: string
  address: string
  notes: string
}

const FORM_VIDE: CustomerFormState = { name: '', phone: '', email: '', address: '', notes: '' }

export default function Clients() {
  const orders = useLocalOrders()
  const role = useTenantStore((state) => state.role)
  const tenantId = useTenantStore((state) => state.tenantId)
  const peutEnrichir = can(role, 'customers.manage')
  const peutSupprimer = can(role, 'customers.delete')
  // Sans projet Supabase, la liste et l'historique restent utilisables (mode
  // démonstration local) mais aucune fiche ne peut être écrite.
  const peutEcrireFiche = peutEnrichir && isSupabaseConfigured

  const [recherche, setRecherche] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const [cartes, setCartes] = useState<CustomerRow[]>([])
  const [chargementCartes, setChargementCartes] = useState(false)
  const [cartesIndisponibles, setCartesIndisponibles] = useState(false)

  const [creation, setCreation] = useState<CustomerFormState | null>(null)
  const [edition, setEdition] = useState<CustomerFormState | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)

  const chargerCartes = useCallback(async () => {
    if (!tenantId) {
      setCartes([])
      return
    }

    if (!isSupabaseConfigured || !navigator.onLine) {
      // Aucun appel réseau inutile : la liste locale suffit, et le bandeau
      // explique que les fiches détaillées demandent une connexion.
      setCartes([])
      setCartesIndisponibles(isSupabaseConfigured)
      setChargementCartes(false)
      return
    }

    setChargementCartes(true)
    try {
      const liste = await listCustomerCards(tenantId)
      setCartes(liste)
      setCartesIndisponibles(false)
    } catch {
      // Panne réseau : l'historique local reste affiché, les écritures de
      // fiche seront refusées avec un message explicite.
      setCartes([])
      setCartesIndisponibles(true)
    } finally {
      setChargementCartes(false)
    }
  }, [tenantId])

  useEffect(() => {
    void chargerCartes()
  }, [chargerCartes])

  const liste = useMemo(() => mergeCustomerCards(orders ?? [], cartes), [orders, cartes])
  const filtres = useMemo(() => filterClients(liste, recherche), [liste, recherche])

  const client = liste.find((entree) => entree.key === selection) ?? null
  const carte = useMemo(
    () =>
      cartes.find(
        (entree) =>
          (entree.phone_key || normalisePhone(entree.phone)) === selection,
      ) ?? null,
    [cartes, selection],
  )
  const historique = useMemo(
    () => (selection ? ordersForClient(orders ?? [], selection) : []),
    [orders, selection],
  )

  // Le formulaire reprend la fiche serveur quand elle existe ; sinon il est
  // prérempli avec ce que les commandes de la tablette connaissent déjà.
  // Dépendances primitives : une saisie en cours n'est jamais écrasée par un
  // simple rendu, seulement par un changement de sélection ou de fiche.
  const nomClient = client?.name
  const telephoneClient = client?.phone
  const carteNom = carte?.name
  const carteTelephone = carte?.phone
  const carteEmail = carte?.email
  const carteAdresse = carte?.address
  const carteNotes = carte?.notes

  useEffect(() => {
    if (!nomClient || !telephoneClient) {
      setEdition(null)
      return
    }
    setEdition({
      name: carteNom ?? nomClient,
      phone: carteTelephone ?? telephoneClient,
      email: carteEmail ?? '',
      address: carteAdresse ?? '',
      notes: carteNotes ?? '',
    })
  }, [
    nomClient,
    telephoneClient,
    carteNom,
    carteTelephone,
    carteEmail,
    carteAdresse,
    carteNotes,
  ])

  const selectionner = (cle: string) => {
    setSelection(cle)
    setCreation(null)
  }

  const enregistrerNouveau = async () => {
    if (!tenantId || !creation) return
    setEnvoi(true)
    try {
      const fiche = await createCustomer(tenantId, creation)
      toast.success('Client ajouté', { icon: '👤' })
      setCreation(null)
      await chargerCartes()
      setSelection(fiche.phone_key || normalisePhone(fiche.phone))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Création impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const enregistrerFiche = async () => {
    if (!tenantId || !edition) return
    setEnvoi(true)
    try {
      if (carte) {
        await updateCustomer(tenantId, carte.id, edition)
        toast.success('Fiche client enregistrée', { icon: '📇' })
      } else {
        const fiche = await createCustomer(tenantId, edition)
        toast.success('Fiche client créée', { icon: '📇' })
        setSelection(fiche.phone_key || normalisePhone(fiche.phone))
      }
      await chargerCartes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const supprimer = async () => {
    if (!tenantId || !carte) return
    const confirme = window.confirm(
      `Supprimer la fiche de ${carte.name} ? Les commandes et leur historique sont conservés.`,
    )
    if (!confirme) return

    setSuppressionEnCours(true)
    try {
      await deleteCustomer(tenantId, carte.id)
      toast.success('Fiche client supprimée')
      setSelection(null)
      await chargerCartes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Suppression impossible')
    } finally {
      setSuppressionEnCours(false)
    }
  }

  if (orders === undefined) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        Chargement des clients…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
            <UserRound size={22} aria-hidden /> Clients
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {liste.length} client{liste.length > 1 ? 's' : ''} connu{liste.length > 1 ? 's' : ''} ·
            historique calculé sur cet appareil
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Rechercher un client</span>
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Field>
              <Input
                value={recherche}
                onChange={(event) => setRecherche(event.target.value)}
                placeholder="Nom, téléphone ou e-mail"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-teal"
              />
            </Field>
          </label>

          {peutEcrireFiche && (
            <button
              type="button"
              onClick={() => {
                setCreation((actuel) => (actuel ? null : { ...FORM_VIDE }))
                setSelection(null)
              }}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark"
            >
              {creation ? <X size={18} aria-hidden /> : <Plus size={18} aria-hidden />}
              {creation ? 'Fermer' : 'Nouveau client'}
            </button>
          )}
        </div>
      </header>

      {cartesIndisponibles && (
        <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <CloudOff size={16} className="mt-0.5 shrink-0" aria-hidden />
          Fiches détaillées indisponibles hors ligne. L’historique des commandes reste
          consultable ; les modifications de fiche nécessitent une connexion.
        </p>
      )}

      {creation && peutEcrireFiche && (
        <section className="rounded-2xl border border-brand-teal/30 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <Plus size={16} aria-hidden /> Nouveau client
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Pour un client qui n’a pas encore de commande : dépôt à venir, renseignement au
            comptoir.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Nom *</span>
              <input
                value={creation.name}
                onChange={(event) => setCreation({ ...creation, name: event.target.value })}
                maxLength={120}
                autoFocus
                placeholder="Mme Awa Koné"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Téléphone *
              </span>
              <input
                value={creation.phone}
                onChange={(event) => setCreation({ ...creation, phone: event.target.value })}
                inputMode="tel"
                maxLength={30}
                placeholder="07 00 00 00 21"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                E-mail (facultatif)
              </span>
              <input
                type="email"
                value={creation.email}
                onChange={(event) => setCreation({ ...creation, email: event.target.value })}
                maxLength={160}
                placeholder="awa@exemple.ci"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Adresse / quartier (facultatif)
              </span>
              <input
                value={creation.address}
                onChange={(event) => setCreation({ ...creation, address: event.target.value })}
                maxLength={300}
                placeholder="Cocody, près de la pharmacie"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Préférences et remarques (facultatif)
              </span>
              <textarea
                value={creation.notes}
                onChange={(event) => setCreation({ ...creation, notes: event.target.value })}
                rows={2}
                maxLength={1000}
                placeholder="Repassage léger, prévient avant de venir…"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void enregistrerNouveau()} disabled={envoi}>
              {envoi ? (
                <Loader2 className="animate-spin" size={16} aria-hidden />
              ) : (
                <Save size={16} aria-hidden />
              )}
              Enregistrer le client
            </Button>
            <button
              type="button"
              onClick={() => setCreation(null)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
            >
              Annuler
            </button>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-2 sm:p-3">
          {filtres.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-slate-500">
              Aucun client ne correspond à cette recherche.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {filtres.map((entree) => (
                <li key={entree.key}>
                  <button
                    type="button"
                    onClick={() => selectionner(entree.key)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                      entree.key === selection ? 'bg-brand-teal/10' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-800">
                        {entree.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {formatPhoneCi(entree.phone)} · {entree.orderCount} commande
                        {entree.orderCount > 1 ? 's' : ''}
                        {entree.orderCount === 0 ? ' · fiche sans commande' : ''}
                      </span>
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold text-brand-navy">
                        {formatFcfa(entree.totalSpent)}
                      </span>
                      {entree.lateCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
                          <AlertTriangle size={12} aria-hidden />
                          {entree.lateCount} en retard
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          {!client ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Sélectionnez un client pour voir son historique.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-brand-navy">{client.name}</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Phone size={14} aria-hidden /> {formatPhoneCi(client.phone)}
                    </span>
                    {client.email && (
                      <span className="truncate text-slate-500">{client.email}</span>
                    )}
                    <span className="text-slate-400">
                      dernière visite : {formatDateFr(client.lastOrderAt.slice(0, 10))}
                    </span>
                  </p>
                </div>

                {client.hasCard && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                    Fiche enregistrée
                  </span>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2">
                  <dt className="text-xs text-slate-500">Commandes</dt>
                  <dd className="text-base font-bold text-slate-800">{client.orderCount}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <dt className="text-xs text-slate-500">Facturé</dt>
                  <dd className="text-base font-bold text-slate-800">
                    {formatFcfa(client.totalSpent)}
                  </dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <dt className="text-xs text-slate-500">Reste dû</dt>
                  <dd className="text-base font-bold text-slate-800">
                    {formatFcfa(client.outstanding)}
                  </dd>
                </div>
              </dl>

              <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">
                Historique
              </h3>
              {historique.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  Aucune commande sur cet appareil pour ce client.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {historique.map((commande) => (
                    <li key={commande.id}>
                      <Link
                        to={`/commandes/${commande.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:text-brand-teal"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-800">
                            {formatDateFr(commande.createdAt.slice(0, 10))} ·{' '}
                            {ORDER_STATUSES[commande.status].label}
                          </span>
                          <span className="block font-mono text-xs text-slate-400">
                            {commande.id.slice(0, 8).toUpperCase()}
                          </span>
                        </span>
                        <span className="text-sm font-semibold text-brand-navy">
                          {formatFcfa(commande.totalAmount)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {peutEnrichir && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {carte ? <Pencil size={14} aria-hidden /> : <MapPin size={14} aria-hidden />}
                    {carte ? 'Fiche détaillée' : 'Créer la fiche détaillée'}
                  </h3>

                  {!isSupabaseConfigured ? (
                    <p className="mt-2 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                      <CloudOff size={16} className="mt-0.5 shrink-0" aria-hidden />
                      Mode démonstration : les fiches détaillées nécessitent un projet Supabase
                      configuré. L’historique ci-dessus reste consultable.
                    </p>
                  ) : chargementCartes && !edition ? (
                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="animate-spin" size={14} aria-hidden />
                      Chargement de la fiche…
                    </p>
                  ) : !edition ? (
                    <p className="mt-2 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                      <CloudOff size={16} className="mt-0.5 shrink-0" aria-hidden />
                      Fiche détaillée indisponible hors ligne. L’historique ci-dessus reste
                      consultable.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="client-nom">Nom</FieldLabel>
                          <Input
                            id="client-nom"
                            value={edition.name}
                            onChange={(event) =>
                              setEdition({ ...edition, name: event.target.value })
                            }
                            maxLength={120}
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="client-telephone">Téléphone</FieldLabel>
                          <Input
                            id="client-telephone"
                            value={edition.phone}
                            inputMode="tel"
                            onChange={(event) =>
                              setEdition({ ...edition, phone: event.target.value })
                            }
                            maxLength={30}
                          />
                        </Field>
                      </div>

                      <Field>
                        <FieldLabel htmlFor="client-email">E-mail (facultatif)</FieldLabel>
                        <Input
                          id="client-email"
                          type="email"
                          value={edition.email}
                          onChange={(event) =>
                            setEdition({ ...edition, email: event.target.value })
                          }
                          maxLength={160}
                          placeholder="awa@exemple.ci"
                        />
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="client-adresse">Adresse / quartier</FieldLabel>
                        <Input
                          id="client-adresse"
                          value={edition.address}
                          onChange={(event) =>
                            setEdition({ ...edition, address: event.target.value })
                          }
                          maxLength={300}
                          placeholder="Cocody, près de la pharmacie"
                        />
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="client-notes">Préférences et remarques</FieldLabel>
                        <textarea
                          id="client-notes"
                          value={edition.notes}
                          onChange={(event) =>
                            setEdition({ ...edition, notes: event.target.value })
                          }
                          rows={2}
                          maxLength={1000}
                          placeholder="Repassage léger, prévient avant de venir…"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal"
                        />
                      </Field>

                      <p className="text-xs text-slate-500">
                        {carte
                          ? 'Le numéro sert de clé de rapprochement : les commandes déjà passées gardent l’ancien numéro et restent visibles séparément.'
                          : 'La fiche sera créée dans le pressing. Les commandes déjà présentes sur la tablette s’y rattacheront à la synchronisation.'}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => void enregistrerFiche()}
                          disabled={envoi || suppressionEnCours}
                        >
                          {envoi ? (
                            <Loader2 className="animate-spin" size={16} aria-hidden />
                          ) : (
                            <Save size={16} aria-hidden />
                          )}
                          {carte ? 'Enregistrer la fiche' : 'Créer la fiche'}
                        </Button>

                        {carte && peutSupprimer && (
                          <button
                            type="button"
                            onClick={() => void supprimer()}
                            disabled={suppressionEnCours}
                            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                          >
                            {suppressionEnCours ? (
                              <Loader2 className="animate-spin" size={16} aria-hidden />
                            ) : (
                              <Trash2 size={16} aria-hidden />
                            )}
                            Supprimer la fiche
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
