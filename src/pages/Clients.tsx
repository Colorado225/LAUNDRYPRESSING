import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CloudOff, Loader2, MapPin, Phone, Save, Search, UserRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { useLocalOrders } from '@/db/hooks'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { formatDateFr, formatFcfa, formatPhoneCi } from '@/lib/formatters'
import { ORDER_STATUSES } from '@/constants/orders'
import {
  fetchCustomerCard,
  filterClients,
  ordersForClient,
  summariseClients,
  updateCustomerCard,
} from '@/services/customerService'
import type { CustomerRow } from '@/types/database'

/**
 * Clients et historique (palier 3).
 *
 * La liste et l'historique sont calculés à partir des commandes déjà présentes
 * sur la tablette : l'écran fonctionne donc hors ligne. La fiche enrichie
 * (adresse, préférences) est chargée à la demande et modifiable en ligne.
 */
export default function Clients() {
  const orders = useLocalOrders()
  const role = useTenantStore((state) => state.role)
  const tenantId = useTenantStore((state) => state.tenantId)
  const peutEnrichir = can(role, 'customers.manage')

  const [recherche, setRecherche] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const [fiche, setFiche] = useState<CustomerRow | null>(null)
  const [chargementFiche, setChargementFiche] = useState(false)
  const [notes, setNotes] = useState('')
  const [adresse, setAdresse] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const liste = useMemo(() => summariseClients(orders ?? []), [orders])
  const filtres = useMemo(() => filterClients(liste, recherche), [liste, recherche])

  const client = liste.find((entree) => entree.key === selection) ?? null
  const historique = useMemo(
    () => (selection ? ordersForClient(orders ?? [], selection) : []),
    [orders, selection],
  )

  useEffect(() => {
    if (!selection || !tenantId || !peutEnrichir) {
      // Mode démonstration ou rôle sans fiche : on n'attend pas le serveur,
      // sinon l'indicateur de chargement tournerait indéfiniment.
      setChargementFiche(false)
      return
    }

    let actif = true
    setChargementFiche(true)
    void (async () => {
      try {
        const carte = await fetchCustomerCard(tenantId, selection)
        if (!actif) return
        setFiche(carte)
        setNotes(carte?.notes ?? '')
        setAdresse(carte?.address ?? '')
      } catch {
        // Panne réseau : la fiche enrichie bascule en « hors ligne », mais
        // l'historique local reste affiché.
        if (actif) setFiche(null)
      } finally {
        if (actif) setChargementFiche(false)
      }
    })()

    return () => {
      actif = false
    }
  }, [selection, tenantId, peutEnrichir])

  const selectionner = (cle: string) => {
    setSelection(cle)
    setFiche(null)
    setChargementFiche(true)
  }

  const enregistrerFiche = async () => {
    if (!tenantId || !fiche) return
    setEnvoi(true)
    try {
      const miseAJour = await updateCustomerCard(tenantId, fiche.id, {
        notes,
        address: adresse,
      })
      setFiche(miseAJour)
      toast.success('Fiche client enregistrée', { icon: '📇' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible')
    } finally {
      setEnvoi(false)
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

        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Rechercher un client</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            value={recherche}
            onChange={(event) => setRecherche(event.target.value)}
            placeholder="Nom ou téléphone"
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-teal"
          />
        </label>
      </header>

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
              <h2 className="text-lg font-bold text-brand-navy">{client.name}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <Phone size={14} aria-hidden /> {formatPhoneCi(client.phone)}
                </span>
                <span className="text-slate-400">
                  dernière visite : {formatDateFr(client.lastOrderAt.slice(0, 10))}
                </span>
              </p>

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

              {peutEnrichir && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <MapPin size={14} aria-hidden /> Fiche détaillée
                  </h3>

                  {chargementFiche ? (
                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="animate-spin" size={14} aria-hidden />
                      Chargement de la fiche…
                    </p>
                  ) : !fiche ? (
                    <p className="mt-2 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                      <CloudOff size={16} className="mt-0.5 shrink-0" aria-hidden />
                      Fiche détaillée indisponible hors ligne. L’historique ci-dessus reste
                      consultable.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600">
                          Adresse / quartier
                        </span>
                        <input
                          value={adresse}
                          onChange={(event) => setAdresse(event.target.value)}
                          maxLength={300}
                          placeholder="Cocody, près de la pharmacie"
                          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600">
                          Préférences et remarques
                        </span>
                        <textarea
                          value={notes}
                          onChange={(event) => setNotes(event.target.value)}
                          rows={2}
                          maxLength={1000}
                          placeholder="Repassage léger, prévient avant de venir…"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => void enregistrerFiche()}
                        disabled={envoi}
                        className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
                      >
                        {envoi ? (
                          <Loader2 className="animate-spin" size={16} aria-hidden />
                        ) : (
                          <Save size={16} aria-hidden />
                        )}
                        Enregistrer la fiche
                      </button>
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
