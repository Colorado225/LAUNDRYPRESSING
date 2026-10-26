import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAddOrderItem, useRemoveOrderItem } from '@/db/hooks'
import type { LocalCatalogGarment, LocalCatalogPrice, LocalOrder, LocalOrderItem } from '@/db/localDb'
import { formatFcfa } from '@/lib/formatters'
import { fetchCatalogConfiguration } from '@/services/catalogService'
import { fetchTenantServices, type TenantServiceOffering } from '@/services/tenantServices'
import { articlesParCategorie, indexerPrix, prixConfigure } from '@/lib/catalogue'

interface Props {
  order: LocalOrder
  items: LocalOrderItem[]
}

/**
 * Correction des articles d'une commande déjà déposée.
 *
 * Deux opérations, volontairement limitées au strict nécessaire au comptoir :
 *  - **ajouter** une pièce rapportée (article du catalogue au tarif de
 *    grille quand le catalogue est installé, ligne libre sinon) ;
 *  - **retirer** une ligne saisie par erreur.
 *
 * Les champs tarifaires figés (catalogue, forfaits, mesures) ne sont pas
 * réécrits ici : ils se corrigent par l'éditeur de mesure ou en annulant la
 * commande. Chaque écriture part en file de synchronisation, puis
 * `pushOrder` aligne `order_items` côté serveur (ajout, mise à jour et purge
 * des lignes retirées).
 */
export default function OrderItemsEditor({ order, items }: Props) {
  const ajouterLigne = useAddOrderItem()
  const retirerLigne = useRemoveOrderItem()

  const [libelle, setLibelle] = useState('')
  const [quantite, setQuantite] = useState('1')
  const [prix, setPrix] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [ligneEnCours, setLigneEnCours] = useState<string | null>(null)
  const [articles, setArticles] = useState<LocalCatalogGarment[]>([])
  const [grille, setGrille] = useState<LocalCatalogPrice[]>([])
  const [prestations, setPrestations] = useState<TenantServiceOffering[]>([])
  const [articleId, setArticleId] = useState('')
  const [prestationId, setPrestationId] = useState('')

  useEffect(() => {
    let actif = true
    void fetchCatalogConfiguration(order.tenantId)
      .then((cfg) => {
        if (!actif) return
        setArticles(cfg.garments)
        setGrille(cfg.prices)
      })
      .catch(() => undefined)
    void fetchTenantServices(order.tenantId)
      .then((services) => {
        if (actif) setPrestations(services)
      })
      .catch(() => undefined)
    return () => {
      actif = false
    }
  }, [order.tenantId])

  const catalogueActif = articles.some((article) => article.isActive)
  const groupes = useMemo(() => articlesParCategorie(articles), [articles])
  const indexPrix = useMemo(() => indexerPrix(grille), [grille])
  const tarifGrille = prixConfigure(indexPrix, prestationId || null, articleId || null)
  const articleChoisi = articles.find((article) => article.id === articleId)
  const prestationChoisie = prestations.find((service) => service.id === prestationId)

  const montant = Number(prix.replace(/\s/g, ''))
  const quantiteNombre = Number(quantite)

  const ajouter = async () => {
    if (!Number.isInteger(quantiteNombre) || quantiteNombre < 1) {
      toast.error('La quantité doit être un entier supérieur à zéro.')
      return
    }
    if (catalogueActif) {
      if (!articleChoisi) {
        toast.error('Choisissez un article du catalogue.')
        return
      }
      if (!prestationChoisie) {
        toast.error('Choisissez la prestation.')
        return
      }
      if (tarifGrille === null) {
        toast.error(
          `Tarif non configuré : « ${articleChoisi.name} » × « ${prestationChoisie.serviceName} ». Définissez-le dans Catalogue → Tarifs.`,
        )
        return
      }
    } else {
      if (!libelle.trim()) {
        toast.error('Indiquez le libellé de l’article.')
        return
      }
      if (!Number.isInteger(montant) || montant < 0 || prix.trim() === '') {
        toast.error('Indiquez le prix unitaire, en FCFA.')
        return
      }
    }

    setEnvoi(true)
    try {
      await ajouterLigne(
        order.id,
        catalogueActif && articleChoisi && prestationChoisie && tarifGrille !== null
          ? {
              label: articleChoisi.name,
              quantity: quantiteNombre,
              unitPrice: tarifGrille,
              garmentTypeId: articleChoisi.id,
              tenantServiceId: prestationChoisie.id,
              serviceName: prestationChoisie.serviceName,
              activityNameSnapshot: prestationChoisie.activityName,
            }
          : {
              label: libelle,
              quantity: quantiteNombre,
              unitPrice: montant,
            },
      )
      toast.success('Article ajouté à la commande', { icon: '🧺' })
      setLibelle('')
      setQuantite('1')
      setPrix('')
      setArticleId('')
      setPrestationId('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ajout impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const retirer = async (item: LocalOrderItem) => {
    const confirme = window.confirm(
      `Retirer « ${item.label} » de cette commande ? Le total sera recalculé.`,
    )
    if (!confirme) return

    setLigneEnCours(item.id)
    try {
      await retirerLigne(order.id, item.id)
      toast.success('Article retiré', { icon: '🗑️' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Suppression impossible')
    } finally {
      setLigneEnCours(null)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        <Plus size={16} aria-hidden /> Articles
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Une pièce rapportée au dépôt s’ajoute ici ; une ligne erronée se retire. Le total et le
        reçu suivent, la correction se synchronise comme le reste de la commande.
      </p>

      <ul className="mt-3 divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{item.label}</p>
              <p className="text-xs text-slate-500">
                {item.packageLineId
                  ? `${item.quantity} pièce(s) · inclus dans le forfait`
                  : item.commercialPackageId
                    ? item.conditionsSnapshot ?? `${item.quantity} vêtement(s) compté(s) · forfait`
                    : `${item.billedQuantity} × ${formatFcfa(item.unitPrice)}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm font-semibold text-brand-navy">{item.packageLineId ? 'Inclus' : formatFcfa(item.price)}</span>
              <button
                type="button"
                onClick={() => void retirer(item)}
                disabled={ligneEnCours === item.id || items.length <= 1}
                aria-label={`Retirer l’article ${item.label}`}
                title={
                  items.length <= 1
                    ? 'Une commande doit garder au moins un article'
                    : 'Retirer cet article'
                }
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {ligneEnCours === item.id ? (
                  <Loader2 className="animate-spin" size={15} aria-hidden />
                ) : (
                  <Trash2 size={15} aria-hidden />
                )}
                Retirer
              </button>
            </div>
          </li>
        ))}
      </ul>

      {catalogueActif ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_88px_auto]">
          <label className="min-w-0">
            <span className="sr-only">Article du catalogue</span>
            <select
              value={articleId}
              onChange={(event) => setArticleId(event.target.value)}
              aria-label="Article du catalogue à ajouter"
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
            >
              <option value="">Article du catalogue</option>
              {groupes.map((groupe) => (
                <optgroup key={groupe.categoryCode} label={groupe.categoryName}>
                  {groupe.articles.map((article) => (
                    <option key={article.id} value={article.id}>
                      {article.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className="sr-only">Prestation</span>
            <select
              value={prestationId}
              onChange={(event) => setPrestationId(event.target.value)}
              aria-label="Prestation de l’article ajouté"
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
            >
              <option value="">Prestation</option>
              {prestations
                .filter((service) => service.billingUnit === 'PIECE')
                .map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.serviceName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Quantité</span>
            <input
              value={quantite}
              onChange={(event) => setQuantite(event.target.value)}
              inputMode="numeric"
              aria-label="Quantité"
              className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal"
            />
          </label>
          <button
            type="button"
            onClick={() => void ajouter()}
            disabled={envoi}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
          >
            {envoi ? (
              <Loader2 className="animate-spin" size={15} aria-hidden />
            ) : (
              <Plus size={15} aria-hidden />
            )}
            Ajouter
          </button>
          <p className="text-xs text-slate-500 sm:col-span-4">
            {articleChoisi && prestationChoisie
              ? tarifGrille !== null
                ? `Tarif catalogue : ${formatFcfa(tarifGrille)} par pièce.`
                : 'Tarif non configuré pour ce couple article × prestation.'
              : 'Le prix vient automatiquement de la grille du catalogue.'}
          </p>
        </div>
      ) : (
      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px_120px_auto]">
        <label className="min-w-0">
          <span className="sr-only">Libellé de l’article</span>
          <input
            value={libelle}
            onChange={(event) => setLibelle(event.target.value)}
            placeholder="Article ajouté (ex. Chemise blanche)"
            maxLength={120}
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal"
          />
        </label>

        <label>
          <span className="sr-only">Quantité</span>
          <input
            value={quantite}
            onChange={(event) => setQuantite(event.target.value)}
            inputMode="numeric"
            aria-label="Quantité"
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal"
          />
        </label>

        <label>
          <span className="sr-only">Prix unitaire</span>
          <input
            value={prix}
            onChange={(event) => setPrix(event.target.value)}
            inputMode="numeric"
            placeholder="Prix unitaire"
            aria-label="Prix unitaire en FCFA"
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal"
          />
        </label>

        <button
          type="button"
          onClick={() => void ajouter()}
          disabled={envoi}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
        >
          {envoi ? (
            <Loader2 className="animate-spin" size={15} aria-hidden />
          ) : (
            <Plus size={15} aria-hidden />
          )}
          Ajouter
        </button>
      </div>
      )}
    </section>
  )
}
