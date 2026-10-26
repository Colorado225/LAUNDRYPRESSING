import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ArchiveRestore, Download, Plus, Search, Tags } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  createCatalogGarment,
  fetchCatalogCategories,
  fetchCatalogConfiguration,
  installCatalogReference,
  setCatalogGarmentActive,
  setGarmentPrice,
  type CatalogCategory,
} from '@/services/catalogService'
import { fetchTenantServices, type TenantServiceOffering } from '@/services/tenantServices'
import {
  articlesParCategorie,
  codeDepuisNom,
  indexerPrix,
  prixConfigure,
  progressionGrille,
} from '@/lib/catalogue'
import { formatFcfa } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import type { LocalCatalogGarment, LocalCatalogPrice } from '@/db/localDb'
import type { CatalogBillingUnit } from '@/types/database'

const UNITES: Array<{ value: CatalogBillingUnit; label: string }> = [
  { value: 'PIECE', label: 'Pièce' },
  { value: 'PAIR', label: 'Paire' },
  { value: 'SET', label: 'Ensemble' },
  { value: 'KG', label: 'Kilogramme' },
  { value: 'M2', label: 'Mètre carré' },
  { value: 'METER', label: 'Mètre' },
  { value: 'PACKAGE', label: 'Forfait' },
  { value: 'FLAT', label: 'Forfait fixe' },
]

type Onglet = 'articles' | 'tarifs'

/**
 * Catalogue du pressing (Lot 1) : articles, installation du référentiel
 * système et matrice des tarifs par prestation.
 *
 * Les prestations elles-mêmes se gèrent dans « Services & activités »
 * (`tenant_services`) : cet écran ne fait que les tarifer par article.
 */
export default function Catalogue() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const peutGerer = can(role, 'catalog.manage')

  const [onglet, setOnglet] = useState<Onglet>('articles')
  const [chargement, setChargement] = useState(true)
  const [articles, setArticles] = useState<LocalCatalogGarment[]>([])
  const [prix, setPrix] = useState<LocalCatalogPrice[]>([])
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [prestations, setPrestations] = useState<TenantServiceOffering[]>([])
  const [recherche, setRecherche] = useState('')
  const [installation, setInstallation] = useState(false)
  const [serviceTarifsId, setServiceTarifsId] = useState('')
  const [saisies, setSaisies] = useState<Record<string, string>>({})
  const [nouveauNom, setNouveauNom] = useState('')
  const [nouvelleCategorieId, setNouvelleCategorieId] = useState('')
  const [nouvelleUnite, setNouvelleUnite] = useState<CatalogBillingUnit>('PIECE')
  const [nouveauDelicat, setNouveauDelicat] = useState(false)
  const [creation, setCreation] = useState(false)

  const recharger = useCallback(async () => {
    if (!tenantId) return
    setChargement(true)
    try {
      const [configuration, cats, services] = await Promise.all([
        fetchCatalogConfiguration(tenantId),
        fetchCatalogCategories(tenantId).catch(() => [] as CatalogCategory[]),
        fetchTenantServices(tenantId).catch(() => [] as TenantServiceOffering[]),
      ])
      setArticles(configuration.garments)
      setPrix(configuration.prices)
      setCategories(cats)
      setPrestations(services)
      setNouvelleCategorieId((courante) => courante || cats[0]?.id || '')
      setServiceTarifsId(
        (courante) => courante || services.find((s) => s.billingUnit === 'PIECE')?.id || '',
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Catalogue illisible pour le moment.')
    } finally {
      setChargement(false)
    }
  }, [tenantId])

  useEffect(() => {
    void recharger()
  }, [recharger])

  const indexPrix = useMemo(() => indexerPrix(prix), [prix])
  const prestationsPiece = useMemo(
    () => prestations.filter((service) => service.billingUnit === 'PIECE'),
    [prestations],
  )
  const progression = useMemo(
    () =>
      progressionGrille({
        garments: articles,
        serviceIdsPiece: prestationsPiece.map((service) => service.id),
        index: indexPrix,
      }),
    [articles, prestationsPiece, indexPrix],
  )
  const groupes = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    const filtres = terme
      ? articles.filter(
          (article) =>
            article.name.toLowerCase().includes(terme) || article.code.toLowerCase().includes(terme),
        )
      : articles
    return articlesParCategorie(filtres)
  }, [articles, recherche])
  const articlesArchives = useMemo(
    () => articles.filter((article) => !article.isActive),
    [articles],
  )

  const installer = async () => {
    if (!tenantId || installation) return
    setInstallation(true)
    try {
      const resultat = await installCatalogReference(tenantId)
      toast.success(
        resultat.articlesCrees > 0
          ? `Catalogue installé : ${resultat.articlesCrees} articles (sans prix). Définissez vos tarifs dans l’onglet Tarifs.`
          : 'Le catalogue de référence est déjà installé.',
      )
      await recharger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Installation impossible.')
    } finally {
      setInstallation(false)
    }
  }

  const creerArticle = async () => {
    if (!tenantId || creation) return
    const nom = nouveauNom.trim()
    if (nom.length < 2) {
      toast.error('Donnez un nom d’au moins 2 caractères à l’article.')
      return
    }
    if (!nouvelleCategorieId) {
      toast.error('Choisissez une catégorie (installez d’abord le catalogue de référence).')
      return
    }
    setCreation(true)
    try {
      await createCatalogGarment(tenantId, {
        categoryId: nouvelleCategorieId,
        code: codeDepuisNom(nom),
        name: nom,
        defaultUnit: nouvelleUnite,
        isDelicate: nouveauDelicat,
      })
      setNouveauNom('')
      setNouveauDelicat(false)
      toast.success(`Article « ${nom} » créé. Pensez à définir ses tarifs.`)
      await recharger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Création impossible.')
    } finally {
      setCreation(false)
    }
  }

  const basculerArticle = async (article: LocalCatalogGarment) => {
    if (!tenantId) return
    try {
      await setCatalogGarmentActive(tenantId, article.id, !article.isActive)
      await recharger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise à jour impossible.')
    }
  }

  const enregistrerPrix = async (article: LocalCatalogGarment) => {
    if (!tenantId || !serviceTarifsId) return
    const saisie = (saisies[article.id] ?? '').trim()
    const montant = saisie === '' ? null : Math.floor(Number(saisie))
    if (montant !== null && (!Number.isFinite(montant) || montant <= 0)) {
      toast.error('Indiquez un montant positif en FCFA, ou videz le champ pour retirer le tarif.')
      return
    }
    try {
      await setGarmentPrice(tenantId, serviceTarifsId, article.id, montant)
      toast.success(
        montant === null
          ? `Tarif retiré pour « ${article.name} » (non configuré).`
          : `« ${article.name} » : ${formatFcfa(montant)}.`,
      )
      await recharger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement du tarif impossible.')
    }
  }

  const serviceTarifs = prestationsPiece.find((service) => service.id === serviceTarifsId)

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800">
          <Tags size={22} aria-hidden /> Catalogue &amp; tarifs
        </h1>
        <p className="text-sm text-slate-500">
          Articles du pressing et prix par prestation. Les prestations se créent dans{' '}
          <Link to="/prestations" className="font-semibold text-brand-teal hover:underline">
            Services &amp; activités
          </Link>{' '}
          ; ici, vous décidez combien coûte chaque article pour chaque prestation.
        </p>
        {!peutGerer && (
          <p className="text-sm text-amber-700">
            Consultation seule : seul le propriétaire modifie le catalogue et les tarifs.
          </p>
        )}
      </header>

      {chargement ? (
        <p className="text-sm text-slate-500">Chargement du catalogue…</p>
      ) : articles.length === 0 ? (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-800">Aucun article pour le moment</h2>
          <p className="text-sm text-slate-600">
            Installez le catalogue de référence : 12 catégories et 45 articles courants
            (chemises, costumes, boubous, linge de maison…), copiés pour votre seul pressing,
            <strong> sans aucun prix</strong>. Vous définirez ensuite vos tarifs ; tant qu’un
            prix n’est pas configuré, la ligne correspondante ne peut pas être vendue.
          </p>
          <button
            type="button"
            onClick={() => void installer()}
            disabled={!peutGerer || installation}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50"
          >
            <Download size={17} aria-hidden />
            {installation ? 'Installation…' : 'Installer le catalogue de référence'}
          </button>
          {!peutGerer && (
            <p className="text-xs text-slate-500">
              Demandez au propriétaire d’installer le catalogue.
            </p>
          )}
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Sections du catalogue">
            {(
              [
                { id: 'articles', label: `Articles (${articles.filter((a) => a.isActive).length})` },
                {
                  id: 'tarifs',
                  label: `Tarifs (${progression.configures}/${progression.total})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={onglet === tab.id}
                onClick={() => setOnglet(tab.id)}
                className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${
                  onglet === tab.id
                    ? 'border-brand-teal bg-brand-teal/5 text-brand-navy'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-brand-teal'
                }`}
              >
                {tab.label}
              </button>
            ))}
            <label className="relative ml-auto min-w-52 flex-1 sm:max-w-xs">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={recherche}
                onChange={(event) => setRecherche(event.target.value)}
                placeholder="Rechercher un article…"
                aria-label="Rechercher un article"
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-teal"
              />
            </label>
          </div>

          {onglet === 'articles' && (
            <div className="space-y-5">
              {peutGerer && (
                <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                    Nouvel article
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_150px_auto]">
                    <input
                      value={nouveauNom}
                      onChange={(event) => setNouveauNom(event.target.value)}
                      placeholder="Ex. Grand boubou brodé"
                      aria-label="Nom du nouvel article"
                      className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal"
                    />
                    <select
                      value={nouvelleCategorieId}
                      onChange={(event) => setNouvelleCategorieId(event.target.value)}
                      aria-label="Catégorie du nouvel article"
                      className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-teal"
                    >
                      {categories.map((categorie) => (
                        <option key={categorie.id} value={categorie.id}>
                          {categorie.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={nouvelleUnite}
                      onChange={(event) => setNouvelleUnite(event.target.value as CatalogBillingUnit)}
                      aria-label="Unité par défaut"
                      className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-teal"
                    >
                      {UNITES.map((unite) => (
                        <option key={unite.value} value={unite.value}>
                          {unite.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void creerArticle()}
                      disabled={creation}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-teal px-4 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50"
                    >
                      <Plus size={16} aria-hidden /> Ajouter
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={nouveauDelicat}
                      onChange={(event) => setNouveauDelicat(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Textile délicat
                  </label>
                </section>
              )}

              {groupes.map((groupe) => (
                <section key={groupe.categoryCode} className="space-y-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                    {groupe.categoryName}
                  </h2>
                  <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                    {groupe.articles.map((article) => (
                      <li key={article.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">{article.name}</p>
                          <p className="text-xs text-slate-500">
                            {article.code} · {UNITES.find((u) => u.value === article.defaultUnit)?.label ?? article.defaultUnit}
                            {article.isDelicate ? ' · délicat' : ''}
                          </p>
                        </div>
                        {peutGerer && (
                          <button
                            type="button"
                            onClick={() => void basculerArticle(article)}
                            aria-label={`Archiver ${article.name}`}
                            className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-amber-50 hover:text-amber-700"
                          >
                            <Archive size={15} aria-hidden /> Archiver
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {groupes.length === 0 && (
                <p className="text-sm text-slate-500">Aucun article ne correspond à la recherche.</p>
              )}

              {articlesArchives.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                    Archivés ({articlesArchives.length})
                  </h2>
                  <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-slate-50">
                    {articlesArchives.map((article) => (
                      <li key={article.id} className="flex items-center gap-3 px-4 py-3">
                        <p className="min-w-0 flex-1 truncate text-sm text-slate-500">{article.name}</p>
                        {peutGerer && (
                          <button
                            type="button"
                            onClick={() => void basculerArticle(article)}
                            aria-label={`Réactiver ${article.name}`}
                            className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"
                          >
                            <ArchiveRestore size={15} aria-hidden /> Réactiver
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {onglet === 'tarifs' && (
            <div className="space-y-4">
              {prestationsPiece.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                  Aucune prestation à la pièce n’est configurée. Créez-en dans{' '}
                  <Link to="/prestations" className="font-semibold text-brand-teal hover:underline">
                    Services &amp; activités
                  </Link>
                  , puis revenez définir les prix par article.
                </p>
              ) : (
                <>
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-slate-600">Prestation à tarifer</span>
                    <select
                      value={serviceTarifsId}
                      onChange={(event) => setServiceTarifsId(event.target.value)}
                      aria-label="Prestation à tarifer"
                      className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal sm:max-w-md"
                    >
                      {prestationsPiece.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.serviceName} — {service.activityName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-sm text-slate-600">
                    Grille complète : <strong>{progression.configures}</strong> tarif(s) configuré(s)
                    sur {progression.total}. Un champ vide signifie <em>non configuré</em> : la ligne
                    ne pourra pas être vendue (jamais assimilée à 0 FCFA).
                  </p>
                  {groupes.map((groupe) => (
                    <section key={groupe.categoryCode} className="space-y-2">
                      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                        {groupe.categoryName}
                      </h2>
                      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                        {groupe.articles.map((article) => {
                          const tarif = prixConfigure(indexPrix, serviceTarifsId, article.id)
                          const saisie = saisies[article.id] ?? (tarif !== null ? String(tarif) : '')
                          return (
                            <li key={article.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-800">{article.name}</p>
                                <p className="text-xs">
                                  {tarif !== null ? (
                                    <span className="font-semibold text-emerald-700">{formatFcfa(tarif)}</span>
                                  ) : (
                                    <span className="font-semibold text-amber-700">Non configuré</span>
                                  )}
                                  {serviceTarifs ? ` · ${serviceTarifs.serviceName}` : ''}
                                </p>
                              </div>
                              {peutGerer && (
                                <>
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={saisie}
                                    onChange={(event) =>
                                      setSaisies((courantes) => ({
                                        ...courantes,
                                        [article.id]: event.target.value,
                                      }))
                                    }
                                    placeholder="FCFA"
                                    aria-label={`Tarif ${article.name} en FCFA`}
                                    className="min-h-10 w-32 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void enregistrerPrix(article)}
                                    className="min-h-10 rounded-lg bg-brand-teal px-3 text-xs font-bold text-white hover:bg-brand-teal/90"
                                  >
                                    Enregistrer
                                  </button>
                                </>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
