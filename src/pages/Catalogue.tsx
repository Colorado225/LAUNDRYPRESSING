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
import type { CatalogBillingUnit, OverflowPolicy } from '@/types/database'
import { calculerPrixForfait, formaterDetailForfait, problemeForfait } from '@/lib/prixForfait'
import {
  disablePricingRule,
  fetchPricingRules,
  savePricingRule,
} from '@/services/pricingRulesService'
import {
  calculerPrixKilo,
  problemeTranches,
  type ArrondiKilo,
  type ModeRegleKilo,
  type TrancheKilo,
} from '@/lib/prixKilo'
import type { LocalPricingRule } from '@/db/localDb'
import {
  creerForfait,
  creerModele,
  dupliquerModele,
  fetchForfaits,
  fetchModeles,
  setForfaitActif,
  setModeleActif,
  type ForfaitCommercial,
  type ModeleBlanchisserie,
} from '@/services/modelesForfaitsService'

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

type Onglet = 'articles' | 'tarifs' | 'kilo' | 'modeles' | 'forfaits'

const POLITIQUES_DEPASSEMENT: Array<{ value: OverflowPolicy; label: string }> = [
  { value: 'PER_EXTRA_ITEM', label: 'Prix par vêtement supplémentaire' },
  { value: 'REPEAT_PACKAGE', label: 'Répéter le forfait entier' },
  { value: 'REJECT_OVER_LIMIT', label: 'Refuser au-delà du nombre inclus' },
  { value: 'MANUAL_QUOTE', label: 'Montant validé au comptoir si dépassement' },
]

function resumeForfaitCommercial(forfait: ForfaitCommercial, prestation?: TenantServiceOffering): string {
  const service = prestation
    ? `Prestation : ${prestation.serviceName} — ${prestation.activityName}`
    : 'Prestation choisie au dépôt'
  if (forfait.garmentsIncluded === null) {
    return `${service} · forfait global, sans tarif au nombre de vêtements`
  }

  const base = `${service} · ${forfait.garmentsIncluded} vêtement(s) inclus`
  switch (forfait.overflowPolicy) {
    case 'PER_EXTRA_ITEM':
      return `${base} · ${formatFcfa(forfait.overflowUnitPriceXof ?? 0)} par vêtement supplémentaire`
    case 'REPEAT_PACKAGE':
      return `${base} · le forfait se répète au-delà`
    case 'REJECT_OVER_LIMIT':
      return `${base} · aucun dépassement accepté`
    case 'MANUAL_QUOTE':
      return `${base} · montant à valider au comptoir en cas de dépassement`
  }
}

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
  const [regles, setRegles] = useState<LocalPricingRule[]>([])
  const [modeles, setModeles] = useState<ModeleBlanchisserie[]>([])
  const [forfaits, setForfaits] = useState<ForfaitCommercial[]>([])
  const [kiloServiceId, setKiloServiceId] = useState('')
  const [kiloNom, setKiloNom] = useState('Règle au kilo')
  const [kiloMode, setKiloMode] = useState<ModeRegleKilo>('progressive_tiers')
  const [kiloMin, setKiloMin] = useState('0')
  const [kiloPas, setKiloPas] = useState('0.1')
  const [kiloArrondi, setKiloArrondi] = useState<ArrondiKilo>('ceil')
  const [kiloTranches, setKiloTranches] = useState(
    [{ min: '0', max: '', prix: '' }] as Array<{ min: string; max: string; prix: string }>,
  )
  const [simPoids, setSimPoids] = useState('12')
  const [nouveauModeleNom, setNouveauModeleNom] = useState('')
  const [nouveauModeleDesc, setNouveauModeleDesc] = useState('')
  const [forfaitNom, setForfaitNom] = useState('')
  const [forfaitPrix, setForfaitPrix] = useState('')
  const [forfaitDesc, setForfaitDesc] = useState('')
  const [forfaitItems, setForfaitItems] = useState(
    [] as Array<{ garmentTypeId: string; quantity: string }>,
  )
  const [forfaitServiceId, setForfaitServiceId] = useState('')
  const [forfaitInclus, setForfaitInclus] = useState('')
  const [forfaitPolitique, setForfaitPolitique] = useState<OverflowPolicy>('PER_EXTRA_ITEM')
  const [forfaitSupplement, setForfaitSupplement] = useState('')
  const [forfaitSimVetements, setForfaitSimVetements] = useState('25')
  const [forfaitSimManuel, setForfaitSimManuel] = useState('')

  const recharger = useCallback(async () => {
    if (!tenantId) return
    setChargement(true)
    try {
      const [configuration, cats, services, reglesChargees, modelesCharges, forfaitsCharges] =
        await Promise.all([
          fetchCatalogConfiguration(tenantId),
          fetchCatalogCategories(tenantId).catch(() => [] as CatalogCategory[]),
          fetchTenantServices(tenantId).catch(() => [] as TenantServiceOffering[]),
          fetchPricingRules(tenantId).catch(() => [] as LocalPricingRule[]),
          fetchModeles().catch(() => [] as ModeleBlanchisserie[]),
          fetchForfaits(tenantId).catch(() => [] as ForfaitCommercial[]),
        ])
      setArticles(configuration.garments)
      setPrix(configuration.prices)
      setCategories(cats)
      setPrestations(services)
      setRegles(reglesChargees)
      setModeles(modelesCharges)
      setForfaits(forfaitsCharges)
      setKiloServiceId(
        (courante) => courante || services.find((s) => s.billingUnit === 'KG')?.id || '',
      )
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

  const prestationsKilo = prestations.filter((service) => service.billingUnit === 'KG')
  const regleActiveKilo = regles.find(
    (regle) => regle.tenantServiceId === kiloServiceId && regle.isActive,
  )

  const chargerRegleDansEditeur = (serviceId: string, source: LocalPricingRule[]) => {
    const regle = source.find((r) => r.tenantServiceId === serviceId && r.isActive)
    if (!regle) {
      setKiloNom('Règle au kilo')
      setKiloMode('progressive_tiers')
      setKiloMin('0')
      setKiloPas('0.1')
      setKiloArrondi('ceil')
      setKiloTranches([{ min: '0', max: '', prix: '' }])
      return
    }
    setKiloNom(regle.ruleName)
    setKiloMode(regle.ruleMode)
    setKiloMin(String(regle.minBillableKg))
    setKiloPas(String(regle.stepKg))
    setKiloArrondi(regle.roundingMode)
    setKiloTranches(
      regle.tiers.length > 0
        ? regle.tiers.map((t) => ({
            min: String(t.minKg),
            max: t.maxKg === null ? '' : String(t.maxKg),
            prix: String(t.pricePerKgXof),
          }))
        : [{ min: '0', max: '', prix: '' }],
    )
  }

  const tranchesSaisies = (): TrancheKilo[] =>
    kiloTranches.map((t) => ({
      minKg: Number(t.min) || 0,
      maxKg: t.max.trim() === '' ? null : Number(t.max),
      prixParKg: Math.floor(Number(t.prix) || 0),
    }))

  const devisSimule = calculerPrixKilo(
    {
      mode: kiloMode,
      minBillableKg: Number(kiloMin) || 0,
      stepKg: Number(kiloPas) || 0.1,
      rounding: kiloArrondi,
    },
    tranchesSaisies(),
    Number(simPoids) || 0,
  )

  const enregistrerRegle = async () => {
    if (!tenantId || !kiloServiceId) return
    const probleme = problemeTranches(tranchesSaisies())
    if (probleme) {
      toast.error(probleme)
      return
    }
    try {
      await savePricingRule(tenantId, {
        tenantServiceId: kiloServiceId,
        ruleName: kiloNom.trim() || 'Règle au kilo',
        ruleMode: kiloMode,
        minBillableKg: Number(kiloMin) || 0,
        stepKg: Number(kiloPas) || 0.1,
        roundingMode: kiloArrondi,
        tiers: tranchesSaisies(),
      })
      toast.success('Règle au kilo enregistrée : le serveur appliquera ces tranches.')
      await recharger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.')
    }
  }

  const actionModele = async (fn: () => Promise<void>, message: string) => {
    try {
      await fn()
      toast.success(message)
      await recharger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Opération impossible.')
    }
  }

  const forfaitQuantiteSaisi = {
    prixXof: Math.floor(Number(forfaitPrix) || 0),
    inclus: forfaitInclus.trim() === '' ? null : Math.floor(Number(forfaitInclus) || 0),
    politique: forfaitPolitique,
    prixSupplementXof:
      forfaitSupplement.trim() === '' ? null : Math.floor(Number(forfaitSupplement) || 0),
  } as const
  const problemeConfigForfait = problemeForfait(forfaitQuantiteSaisi)
  const devisForfaitSimule = calculerPrixForfait(
    forfaitQuantiteSaisi,
    Math.floor(Number(forfaitSimVetements) || 0),
    forfaitSimManuel.trim() === '' ? null : Math.floor(Number(forfaitSimManuel) || 0),
  )

  const enregistrerForfait = async () => {
    if (!tenantId) return
    const nom = forfaitNom.trim()
    const montant = forfaitQuantiteSaisi.prixXof
    if (nom.length < 2) {
      toast.error('Donnez un nom au forfait.')
      return
    }
    if (problemeConfigForfait) {
      toast.error(problemeConfigForfait)
      return
    }
    try {
      await creerForfait(tenantId, {
        name: nom,
        description: forfaitDesc,
        priceXof: montant,
        tenantServiceId: forfaitServiceId || null,
        garmentsIncluded: forfaitQuantiteSaisi.inclus,
        overflowPolicy: forfaitQuantiteSaisi.politique,
        overflowUnitPriceXof: forfaitQuantiteSaisi.prixSupplementXof,
        items: forfaitItems
          .filter((item) => item.garmentTypeId)
          .map((item) => ({
            garmentTypeId: item.garmentTypeId,
            garmentName: articles.find((a) => a.id === item.garmentTypeId)?.name ?? 'Article',
            quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
          })),
      })
      setForfaitNom('')
      setForfaitPrix('')
      setForfaitDesc('')
      setForfaitItems([])
      setForfaitServiceId('')
      setForfaitInclus('')
      setForfaitPolitique('PER_EXTRA_ITEM')
      setForfaitSupplement('')
      setForfaitSimManuel('')
      toast.success(`Forfait « ${nom} » créé.`)
      await recharger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Création du forfait impossible.')
    }
  }

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
                { id: 'kilo', label: 'Au kilo' },
                { id: 'modeles', label: 'Modèles' },
                { id: 'forfaits', label: 'Forfaits' },
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

          {onglet === 'kilo' && (
            <div className="space-y-4">
              {prestationsKilo.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                  Aucune prestation au kilo n’est configurée. Créez-en une (unité « KG ») dans{' '}
                  <Link to="/prestations" className="font-semibold text-brand-teal hover:underline">
                    Services &amp; activités
                  </Link>
                  , puis définissez ici ses tranches de poids.
                </p>
              ) : (
                <>
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-slate-600">Prestation au kilo</span>
                    <select
                      value={kiloServiceId}
                      onChange={(event) => {
                        setKiloServiceId(event.target.value)
                        chargerRegleDansEditeur(event.target.value, regles)
                      }}
                      aria-label="Prestation au kilo"
                      className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal sm:max-w-md"
                    >
                      {prestationsKilo.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.serviceName} — {service.activityName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                      Règle de tarification {regleActiveKilo ? '(active)' : '(aucune — tarif/kg libre)'}
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Nom</span>
                        <input value={kiloNom} onChange={(e) => setKiloNom(e.target.value)} disabled={!peutGerer} className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal disabled:bg-slate-50" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Mode de calcul</span>
                        <select value={kiloMode} onChange={(e) => setKiloMode(e.target.value as ModeRegleKilo)} disabled={!peutGerer} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-teal disabled:bg-slate-50">
                          <option value="progressive_tiers">Progressif (chaque tranche à son tarif)</option>
                          <option value="flat_rate">Par palier (la tranche du poids total)</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Minimum facturable (kg)</span>
                        <input type="number" min="0" step="0.1" value={kiloMin} onChange={(e) => setKiloMin(e.target.value)} disabled={!peutGerer} className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal disabled:bg-slate-50" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Pas de pesée (kg)</span>
                        <input type="number" min="0.001" step="0.1" value={kiloPas} onChange={(e) => setKiloPas(e.target.value)} disabled={!peutGerer} className="min-h-11 w-full rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal disabled:bg-slate-50" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Arrondi du poids</span>
                        <select value={kiloArrondi} onChange={(e) => setKiloArrondi(e.target.value as ArrondiKilo)} disabled={!peutGerer} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-teal disabled:bg-slate-50">
                          <option value="ceil">Au pas supérieur</option>
                          <option value="nearest">Au pas le plus proche</option>
                          <option value="exact">Poids exact</option>
                        </select>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-600">
                        Tranches [de, à) — laissez « à » vide pour la dernière (sans limite)
                      </p>
                      {kiloTranches.map((tranche, i) => (
                        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                          <input type="number" min="0" step="0.1" value={tranche.min} disabled={!peutGerer} placeholder="De (kg)" aria-label={`Début tranche ${i + 1}`} onChange={(e) => setKiloTranches((c) => c.map((t, j) => (j === i ? { ...t, min: e.target.value } : t)))} className="min-h-10 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal disabled:bg-slate-50" />
                          <input type="number" min="0" step="0.1" value={tranche.max} disabled={!peutGerer} placeholder="À (kg)" aria-label={`Fin tranche ${i + 1}`} onChange={(e) => setKiloTranches((c) => c.map((t, j) => (j === i ? { ...t, max: e.target.value } : t)))} className="min-h-10 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal disabled:bg-slate-50" />
                          <input type="number" min="1" step="1" value={tranche.prix} disabled={!peutGerer} placeholder="FCFA/kg" aria-label={`Tarif tranche ${i + 1}`} onChange={(e) => setKiloTranches((c) => c.map((t, j) => (j === i ? { ...t, prix: e.target.value } : t)))} className="min-h-10 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal disabled:bg-slate-50" />
                          <button type="button" disabled={!peutGerer || kiloTranches.length === 1} onClick={() => setKiloTranches((c) => c.filter((_, j) => j !== i))} aria-label={`Retirer la tranche ${i + 1}`} className="min-h-10 rounded-lg px-2 text-xs font-bold text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30">Retirer</button>
                        </div>
                      ))}
                      {peutGerer && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button type="button" onClick={() => setKiloTranches((c) => [...c, { min: '', max: '', prix: '' }])} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold hover:bg-slate-50">+ Tranche</button>
                          <button type="button" onClick={() => void enregistrerRegle()} className="min-h-10 rounded-lg bg-brand-teal px-3 text-xs font-bold text-white hover:bg-brand-teal/90">Enregistrer la règle</button>
                          {regleActiveKilo && tenantId && (
                            <button type="button" onClick={() => void disablePricingRule(tenantId, regleActiveKilo.id).then(() => recharger()).catch((e) => toast.error(e instanceof Error ? e.message : 'Désactivation impossible.'))} className="min-h-10 rounded-lg border border-amber-300 px-3 text-xs font-bold text-amber-700 hover:bg-amber-50">Désactiver la règle</button>
                          )}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="space-y-2 rounded-2xl border border-brand-teal/20 bg-teal-50/40 p-4">
                    <h2 className="text-sm font-bold text-slate-800">Simulateur</h2>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-600">Poids pesé (kg)</span>
                        <input type="number" min="0" step="0.1" value={simPoids} onChange={(e) => setSimPoids(e.target.value)} aria-label="Poids à simuler en kilogrammes" className="min-h-11 w-36 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-teal" />
                      </label>
                      {devisSimule ? (
                        <div className="text-sm text-slate-700">
                          <p>
                            <strong>{formatFcfa(devisSimule.montant)}</strong> pour{' '}
                            {devisSimule.poidsFactureKg} kg facturés
                          </p>
                          <p className="text-xs text-slate-500">
                            {devisSimule.detail.map((d) => `${d.kg} kg × ${d.prixParKg}`).join(' + ')} FCFA/kg
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-amber-700">
                          Aucun devis : vérifiez le poids et la couverture des tranches.
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      Le serveur recalcule chaque ligne avec la même règle : le simulateur et la caisse ne peuvent pas diverger.
                    </p>
                  </section>
                </>
              )}
            </div>
          )}

          {onglet === 'modeles' && (
            <div className="space-y-5">
              <p className="text-sm text-slate-600">
                Un modèle regroupe des articles types pour présenter votre offre (pressing
                classique, au kilo, premium…). Il ne porte <strong>aucun prix</strong> : les tarifs
                restent dans la grille et les règles au kilo.
              </p>
              {peutGerer && (
                <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Nouveau modèle</h2>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <input value={nouveauModeleNom} onChange={(e) => setNouveauModeleNom(e.target.value)} placeholder="Ex. Offre étudiants" aria-label="Nom du nouveau modèle" className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                    <input value={nouveauModeleDesc} onChange={(e) => setNouveauModeleDesc(e.target.value)} placeholder="Description (facultatif)" aria-label="Description du nouveau modèle" className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                    <button type="button" onClick={() => { if (tenantId) void actionModele(() => creerModele(tenantId, nouveauModeleNom, nouveauModeleDesc), 'Modèle créé.'); setNouveauModeleNom(''); setNouveauModeleDesc('') }} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-teal px-4 text-sm font-semibold text-white hover:bg-brand-teal/90">
                      <Plus size={16} aria-hidden /> Créer
                    </button>
                  </div>
                </section>
              )}
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {modeles.map((modele) => (
                  <li key={modele.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">
                        {modele.name}{' '}
                        <span className={modele.kind === 'system_template' ? 'ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600' : 'ml-1 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-bold text-teal-700'}>
                          {modele.kind === 'system_template' ? 'Bibliothèque' : 'Mon pressing'}
                        </span>
                        {!modele.isActive && <span className="ml-1 text-[11px] font-bold text-amber-700">Archivé</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {modele.description ?? 'Sans description'} · {modele.nbArticles} article(s) type(s)
                      </p>
                    </div>
                    {peutGerer && (
                      <>
                        <button type="button" onClick={() => void actionModele(() => dupliquerModele(modele.id), `Modèle « ${modele.name} » copié pour votre pressing.`)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold hover:bg-slate-50">
                          {modele.kind === 'system_template' ? 'Installer une copie' : 'Dupliquer'}
                        </button>
                        {modele.kind === 'custom' && tenantId && (
                          <button type="button" onClick={() => void actionModele(() => setModeleActif(modele.id, tenantId, !modele.isActive), modele.isActive ? 'Modèle archivé.' : 'Modèle réactivé.')} className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-amber-50 hover:text-amber-700">
                            {modele.isActive ? <><Archive size={15} aria-hidden /> Archiver</> : <><ArchiveRestore size={15} aria-hidden /> Réactiver</>}
                          </button>
                        )}
                      </>
                    )}
                  </li>
                ))}
                {modeles.length === 0 && (
                  <li className="px-4 py-3 text-sm text-slate-500">
                    Aucun modèle visible (connexion requise pour la bibliothèque).
                  </li>
                )}
              </ul>
            </div>
          )}

          {onglet === 'forfaits' && (
            <div className="space-y-5">
              <p className="text-sm text-slate-600">
                Forfaits vendables au dépôt : prix global ou tarif au nombre de vêtements.
                Au comptage, <strong>tous les articles actifs</strong> peuvent être comptés ; la
                composition ci-dessous reste indicative et ne limite pas les articles admissibles.
              </p>
              {peutGerer && (
                <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Nouveau forfait</h2>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
                    <input value={forfaitNom} onChange={(e) => setForfaitNom(e.target.value)} placeholder="Ex. Pack famille hebdo" aria-label="Nom du forfait" className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                    <input type="number" min="1" step="1" value={forfaitPrix} onChange={(e) => setForfaitPrix(e.target.value)} placeholder="Prix (FCFA)" aria-label="Prix du forfait en FCFA" className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                    <input value={forfaitDesc} onChange={(e) => setForfaitDesc(e.target.value)} placeholder="Description (facultatif)" aria-label="Description du forfait" className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-600">Prestation associée (facultatif)</span>
                      <select value={forfaitServiceId} onChange={(e) => setForfaitServiceId(e.target.value)} aria-label="Prestation associée au forfait" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal">
                        <option value="">Choisie au dépôt</option>
                        {prestationsPiece.map((service) => (
                          <option key={service.id} value={service.id}>{service.serviceName} — {service.activityName}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-600">Vêtements inclus</span>
                      <input type="number" min="1" max="10000" step="1" value={forfaitInclus} onChange={(e) => setForfaitInclus(e.target.value)} placeholder="Vide = forfait global" aria-label="Nombre de vêtements inclus dans le forfait" className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-600">Au-delà du nombre inclus</span>
                      <select value={forfaitPolitique} onChange={(e) => setForfaitPolitique(e.target.value as OverflowPolicy)} aria-label="Politique de dépassement du forfait" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal">
                        {POLITIQUES_DEPASSEMENT.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    {forfaitPolitique === 'PER_EXTRA_ITEM' ? (
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600">Prix par vêtement supplémentaire</span>
                        <input type="number" min="1" step="1" value={forfaitSupplement} onChange={(e) => setForfaitSupplement(e.target.value)} placeholder="FCFA" aria-label="Prix par vêtement supplémentaire" className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal" />
                      </label>
                    ) : (
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        Aucun prix unitaire de dépassement à saisir pour ce choix.
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Simulateur de comptage</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600">Vêtements comptés</span>
                        <input type="number" min="1" step="1" value={forfaitSimVetements} onChange={(e) => setForfaitSimVetements(e.target.value)} aria-label="Nombre de vêtements à simuler" className="min-h-10 w-36 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal" />
                      </label>
                      {forfaitPolitique === 'MANUAL_QUOTE' && forfaitQuantiteSaisi.inclus !== null && (
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-slate-600">Montant validé si dépassement</span>
                          <input type="number" min="1" step="1" value={forfaitSimManuel} onChange={(e) => setForfaitSimManuel(e.target.value)} placeholder="FCFA" aria-label="Montant manuel simulé" className="min-h-10 w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal" />
                        </label>
                      )}
                    </div>
                    {problemeConfigForfait ? (
                      <p className="text-sm font-medium text-amber-700">{problemeConfigForfait}</p>
                    ) : devisForfaitSimule ? (
                      devisForfaitSimule.manuelRequis ? (
                        <p className="text-sm font-medium text-amber-700">Dépassement : saisissez le montant total qui serait validé au comptoir.</p>
                      ) : (
                        <p className="text-sm font-semibold text-slate-800">
                          {formaterDetailForfait(devisForfaitSimule)} → {formatFcfa(devisForfaitSimule.montant ?? 0)}
                        </p>
                      )
                    ) : (
                      <p className="text-sm font-medium text-amber-700">Ce comptage serait refusé avec la règle choisie.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600">Composition indicative (facultative, ne limite pas le comptage)</p>
                    {forfaitItems.map((item, i) => (
                      <div key={i} className="grid grid-cols-[minmax(0,1fr)_90px_auto] gap-2">
                        <select value={item.garmentTypeId} onChange={(e) => setForfaitItems((c) => c.map((x, j) => (j === i ? { ...x, garmentTypeId: e.target.value } : x)))} aria-label={`Article du forfait ${i + 1}`} className="min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-teal">
                          <option value="">Choisir un article</option>
                          {groupes.map((groupe) => (
                            <optgroup key={groupe.categoryCode} label={groupe.categoryName}>
                              {groupe.articles.map((article) => (
                                <option key={article.id} value={article.id}>{article.name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <input type="number" min="1" step="1" value={item.quantity} onChange={(e) => setForfaitItems((c) => c.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label={`Quantité article ${i + 1}`} className="min-h-10 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal" />
                        <button type="button" onClick={() => setForfaitItems((c) => c.filter((_, j) => j !== i))} aria-label={`Retirer l’article ${i + 1} du forfait`} className="min-h-10 rounded-lg px-2 text-xs font-bold text-slate-500 hover:bg-rose-50 hover:text-rose-700">Retirer</button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button type="button" onClick={() => setForfaitItems((c) => [...c, { garmentTypeId: '', quantity: '1' }])} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold hover:bg-slate-50">+ Article inclus</button>
                      <button type="button" onClick={() => void enregistrerForfait()} className="min-h-10 rounded-lg bg-brand-teal px-3 text-xs font-bold text-white hover:bg-brand-teal/90">Créer le forfait</button>
                    </div>
                  </div>
                </section>
              )}
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {forfaits.map((forfait) => (
                  <li key={forfait.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">
                        {forfait.name} · <span className="text-emerald-700">{formatFcfa(forfait.priceXof)}</span>
                        {!forfait.isActive && <span className="ml-1 text-[11px] font-bold text-amber-700">Archivé</span>}
                      </p>
                      <p className="text-xs text-slate-500">{forfait.description ?? 'Sans description'}</p>
                      <p className="text-xs text-slate-500">
                        {resumeForfaitCommercial(
                          forfait,
                          prestations.find((service) => service.id === forfait.tenantServiceId),
                        )}
                        {forfait.items.length > 0 &&
                          ` · Composition indicative : ${forfait.items.map((item) => `${item.quantity} × ${item.label ?? articles.find((a) => a.id === item.garmentTypeId)?.name ?? 'article'}`).join(', ')}`}
                      </p>
                    </div>
                    {peutGerer && tenantId && (
                      <button type="button" onClick={() => void actionModele(() => setForfaitActif(forfait.id, tenantId, !forfait.isActive), forfait.isActive ? 'Forfait archivé.' : 'Forfait réactivé.')} className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-amber-50 hover:text-amber-700">
                        {forfait.isActive ? <><Archive size={15} aria-hidden /> Archiver</> : <><ArchiveRestore size={15} aria-hidden /> Réactiver</>}
                      </button>
                    )}
                  </li>
                ))}
                {forfaits.length === 0 && (
                  <li className="px-4 py-3 text-sm text-slate-500">Aucun forfait pour le moment.</li>
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
