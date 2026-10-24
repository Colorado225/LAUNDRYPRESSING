import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  CloudOff,
  Loader2,
  PackagePlus,
  Plus,
  Truck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { formatDateTimeFr, formatFcfa } from '@/lib/formatters'
import { isSupabaseConfigured } from '@/lib/env'
import {
  STOCK_CATEGORY_LABELS,
  STOCK_UNITS,
  createStockItem,
  createSupplier,
  isLowStock,
  listStockItems,
  listStockMovements,
  listSuppliers,
  recordStockMovement,
  stockErrorMessage,
} from '@/services/stockService'
import type {
  StockCategory,
  StockItemRow,
  StockMovementRow,
  StockUnit,
  SupplierRow,
} from '@/types/database'

/**
 * Stock et fournisseurs (palier 3).
 *
 * La quantité affichée est celle du serveur : elle découle des mouvements
 * enregistrés, jamais d'une saisie directe. Un article sous son seuil déclenche
 * l'alerte en haut de l'écran.
 */
export default function Stock() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const peutGerer = can(role, 'stock.manage')
  const peutMouvoir = can(role, 'stock.move')

  const [articles, setArticles] = useState<StockItemRow[]>([])
  const [mouvements, setMouvements] = useState<StockMovementRow[]>([])
  const [fournisseurs, setFournisseurs] = useState<SupplierRow[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  const [articleOuvert, setArticleOuvert] = useState(false)
  const [nom, setNom] = useState('')
  const [categorie, setCategorie] = useState<StockCategory>('produit')
  const [unite, setUnite] = useState<StockUnit>('pièce')
  const [seuil, setSeuil] = useState('2')
  const [cout, setCout] = useState('')
  const [quantiteInitiale, setQuantiteInitiale] = useState('')

  const [mouvementPour, setMouvementPour] = useState<StockItemRow | null>(null)
  const [sens, setSens] = useState<'in' | 'out'>('out')
  const [quantite, setQuantite] = useState('')
  const [motif, setMotif] = useState('')
  const [fournisseurId, setFournisseurId] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const [fournisseurOuvert, setFournisseurOuvert] = useState(false)
  const [nomFournisseur, setNomFournisseur] = useState('')
  const [telFournisseur, setTelFournisseur] = useState('')

  const charger = useCallback(async () => {
    if (!tenantId) {
      setChargement(false)
      return
    }
    setErreur(null)

    try {
      const [listeArticles, listeMouvements, listeFournisseurs] = await Promise.all([
        listStockItems(tenantId),
        listStockMovements(tenantId),
        listSuppliers(tenantId),
      ])
      setArticles(listeArticles)
      setMouvements(listeMouvements)
      setFournisseurs(listeFournisseurs)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Chargement impossible.')
    } finally {
      setChargement(false)
    }
  }, [tenantId])

  useEffect(() => {
    void charger()
  }, [charger])

  const alertes = useMemo(() => articles.filter((article) => isLowStock(article)), [articles])

  const nomArticle = useCallback(
    (id: string) => articles.find((article) => article.id === id)?.name ?? 'Article supprimé',
    [articles],
  )

  const ajouterArticle = async () => {
    if (!tenantId) return

    const quantiteValeur = Number(quantiteInitiale.replace(/\s/g, '') || 0)
    const coutValeur = cout.trim() ? Number(cout.replace(/\s/g, '')) : null

    if (nom.trim().length < 2) {
      toast.error('Donnez un nom à l’article.')
      return
    }
    if (!Number.isFinite(quantiteValeur) || quantiteValeur < 0) {
      toast.error('Quantité de départ invalide.')
      return
    }
    if (coutValeur !== null && (!Number.isInteger(coutValeur) || coutValeur < 0)) {
      toast.error('Coût unitaire invalide.')
      return
    }

    setEnvoi(true)
    try {
      await createStockItem(tenantId, {
        name: nom,
        category: categorie,
        unit: unite,
        minQuantity: Number(seuil.replace(/\s/g, '') || 0),
        unitCost: coutValeur,
        initialQuantity: quantiteValeur,
      })
      toast.success('Article ajouté au stock', { icon: '📦' })
      setNom('')
      setCout('')
      setQuantiteInitiale('')
      setSeuil('2')
      setArticleOuvert(false)
      await charger()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Création impossible : vérifiez vos droits.',
      )
    } finally {
      setEnvoi(false)
    }
  }

  const enregistrerMouvement = async () => {
    if (!tenantId || !mouvementPour) return

    const valeur = Number(quantite.replace(/\s/g, ''))
    if (!Number.isFinite(valeur) || valeur <= 0) {
      toast.error('Indiquez une quantité supérieure à zéro.')
      return
    }

    setEnvoi(true)
    try {
      await recordStockMovement(tenantId, {
        itemId: mouvementPour.id,
        kind: sens,
        quantity: valeur,
        supplierId: sens === 'in' && fournisseurId ? fournisseurId : null,
        reason: motif || (sens === 'in' ? 'Réapprovisionnement' : 'Sortie atelier'),
      })
      toast.success(sens === 'in' ? 'Entrée enregistrée' : 'Sortie enregistrée', {
        icon: sens === 'in' ? '⬇️' : '⬆️',
      })
      setMouvementPour(null)
      setQuantite('')
      setMotif('')
      setFournisseurId('')
      await charger()
    } catch (error) {
      toast.error(error instanceof Error ? stockErrorMessage(error.message) : 'Mouvement impossible.')
    } finally {
      setEnvoi(false)
    }
  }

  const ajouterFournisseur = async () => {
    if (!tenantId) return
    if (nomFournisseur.trim().length < 2) {
      toast.error('Donnez un nom au fournisseur.')
      return
    }

    setEnvoi(true)
    try {
      await createSupplier(tenantId, {
        name: nomFournisseur,
        phone: telFournisseur || null,
        notes: null,
      })
      toast.success('Fournisseur enregistré', { icon: '🚚' })
      setNomFournisseur('')
      setTelFournisseur('')
      setFournisseurOuvert(false)
      await charger()
    } catch (error) {
      toast.error(
        error instanceof Error ? stockErrorMessage(error.message) : 'Enregistrement impossible.',
      )
    } finally {
      setEnvoi(false)
    }
  }

  if (!peutMouvoir) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <CloudOff className="mx-auto text-slate-400" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-slate-800">Accès réservé</p>
        <p className="mt-1 text-sm text-slate-500">
          Le stock se consulte au comptoir et chez le propriétaire ; l’atelier ne
          mouvemente pas les consommables.
        </p>
      </div>
    )
  }

  if (!isSupabaseConfigured) {
    return (
      <SansConnexion
        message="Le stock est un module de gestion : il nécessite un projet Supabase configuré."
      />
    )
  }

  if (chargement) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        Chargement du stock…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
            <Boxes size={22} aria-hidden /> Stock
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {articles.length} article{articles.length > 1 ? 's' : ''} · quantités tenues par les
            mouvements
          </p>
        </div>

        {peutGerer && (
          <button
            type="button"
            onClick={() => setArticleOuvert((ouvert) => !ouvert)}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark"
          >
            <PackagePlus size={18} aria-hidden />
            Nouvel article
          </button>
        )}
      </header>

      {erreur && (
        <p className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <CloudOff size={18} className="mt-0.5 shrink-0" aria-hidden />
          {erreur}
        </p>
      )}

      {alertes.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-semibold text-amber-900">
            <AlertTriangle size={18} aria-hidden />
            {alertes.length} article{alertes.length > 1 ? 's' : ''} sous le seuil d’alerte
          </p>
          <p className="mt-1 text-sm text-amber-900">
            {alertes.map((article) => article.name).join(' · ')}
          </p>
        </section>
      )}

      {articleOuvert && peutGerer && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Nouvel article
          </h2>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Nom</span>
              <input
                value={nom}
                onChange={(event) => setNom(event.target.value)}
                placeholder="Lessive liquide 5 L"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Catégorie</span>
              <select
                value={categorie}
                onChange={(event) => setCategorie(event.target.value as StockCategory)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              >
                {Object.entries(STOCK_CATEGORY_LABELS).map(([valeur, libelle]) => (
                  <option key={valeur} value={valeur}>
                    {libelle}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Unité</span>
              <select
                value={unite}
                onChange={(event) => setUnite(event.target.value as StockUnit)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              >
                {STOCK_UNITS.map((valeur) => (
                  <option key={valeur} value={valeur}>
                    {valeur}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Seuil d’alerte
              </span>
              <input
                type="number"
                min={0}
                value={seuil}
                onChange={(event) => setSeuil(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Coût unitaire (FCFA)
              </span>
              <input
                type="number"
                min={0}
                value={cout}
                onChange={(event) => setCout(event.target.value)}
                placeholder="4500"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Quantité de départ (facultatif)
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={quantiteInitiale}
                onChange={(event) => setQuantiteInitiale(event.target.value)}
                placeholder="0"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Enregistrée comme une entrée « stock initial », pas comme une quantité écrite à la
                main.
              </span>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void ajouterArticle()}
              disabled={envoi}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
            >
              {envoi ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}
              Créer l’article
            </button>
            <button
              type="button"
              onClick={() => setArticleOuvert(false)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
            >
              Annuler
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white">
        {articles.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            Aucun article pour l’instant. {peutGerer ? 'Créez le premier.' : ''}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {articles.map((article) => {
              const bas = isLowStock(article)
              return (
                <li key={article.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">
                      {article.name}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {STOCK_CATEGORY_LABELS[article.category]}
                      </span>
                      {bas && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                          <AlertTriangle size={11} aria-hidden /> seuil
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      seuil {Number(article.min_quantity)} {article.unit}
                      {article.unit_cost !== null ? ` · ${formatFcfa(article.unit_cost)} l’unité` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`min-w-20 text-right text-lg font-bold ${
                        bas ? 'text-amber-700' : 'text-brand-navy'
                      }`}
                    >
                      {Number(article.quantity)} {article.unit}
                    </span>

                    {peutMouvoir && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setMouvementPour(article)
                            setSens('in')
                          }}
                          aria-label={`Entrée de stock pour ${article.name}`}
                          className="inline-flex size-12 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                        >
                          <ArrowDownToLine size={18} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMouvementPour(article)
                            setSens('out')
                          }}
                          aria-label={`Sortie de stock pour ${article.name}`}
                          className="inline-flex size-12 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                        >
                          <ArrowUpFromLine size={18} aria-hidden />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {mouvementPour && (
        <section className="rounded-2xl border-2 border-brand-teal/40 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            {sens === 'in' ? 'Entrée' : 'Sortie'} · {mouvementPour.name}
          </h2>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Quantité ({mouvementPour.unit})
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={quantite}
                onChange={(event) => setQuantite(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Motif</span>
              <input
                value={motif}
                onChange={(event) => setMotif(event.target.value)}
                placeholder={sens === 'in' ? 'Livraison fournisseur' : 'Service du jour'}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>

            {sens === 'in' && fournisseurs.length > 0 && (
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Fournisseur (facultatif)
                </span>
                <select
                  value={fournisseurId}
                  onChange={(event) => setFournisseurId(event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                >
                  <option value="">Non précisé</option>
                  {fournisseurs.map((fournisseur) => (
                    <option key={fournisseur.id} value={fournisseur.id}>
                      {fournisseur.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void enregistrerMouvement()}
              disabled={envoi}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
            >
              {envoi ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}
              Enregistrer le mouvement
            </button>
            <button
              type="button"
              onClick={() => setMouvementPour(null)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
            >
              Annuler
            </button>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Derniers mouvements
          </h2>

          {mouvements.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Aucun mouvement enregistré.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {mouvements.slice(0, 12).map((mouvement) => (
                <li key={mouvement.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-800">
                      {nomArticle(mouvement.item_id)}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {formatDateTimeFr(mouvement.created_at)}
                      {mouvement.reason ? ` · ${mouvement.reason}` : ''}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-sm font-bold ${
                      mouvement.kind === 'in' ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {mouvement.kind === 'in' ? '+' : '−'}
                    {Number(mouvement.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              <Truck size={16} aria-hidden /> Fournisseurs
            </h2>
            {peutGerer && (
              <button
                type="button"
                onClick={() => setFournisseurOuvert((ouvert) => !ouvert)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-brand-teal"
              >
                <Plus size={15} aria-hidden />
                Ajouter
              </button>
            )}
          </div>

          {fournisseurs.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Aucun fournisseur enregistré.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {fournisseurs.map((fournisseur) => (
                <li key={fournisseur.id} className="py-2">
                  <p className="text-sm font-semibold text-slate-800">{fournisseur.name}</p>
                  {fournisseur.phone && (
                    <p className="text-xs text-slate-500">{fournisseur.phone}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {fournisseurOuvert && peutGerer && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Nom</span>
                <input
                  value={nomFournisseur}
                  onChange={(event) => setNomFournisseur(event.target.value)}
                  placeholder="Sotici"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                />
              </label>
              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Téléphone (facultatif)
                </span>
                <input
                  value={telFournisseur}
                  onChange={(event) => setTelFournisseur(event.target.value)}
                  placeholder="+225 07 00 00 00 30"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                />
              </label>
              <button
                type="button"
                onClick={() => void ajouterFournisseur()}
                disabled={envoi}
                className="mt-2 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
              >
                Enregistrer le fournisseur
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** Message commun aux modules de gestion consultés sans backend configuré. */
function SansConnexion({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
      <CloudOff className="mx-auto text-amber-700" size={28} aria-hidden />
      <p className="mt-2 font-semibold text-amber-900">Module indisponible</p>
      <p className="mt-1 text-sm text-amber-900">{message}</p>
    </div>
  )
}
