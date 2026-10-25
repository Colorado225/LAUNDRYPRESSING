import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  BookOpen,
  CloudOff,
  FolderTree,
  Layers,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  Tag,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Tooltip from '@/components/Tooltip'
import CatalogGuide from '@/components/CatalogGuide'
import {
  createCatalogEntry,
  deactivateCatalogEntry,
  deleteCatalogEntry,
  getCachedCatalog,
  refreshCatalog,
  seedDefaultCatalog,
  updateCatalogEntry,
} from '@/db/catalogRepository'
import CatalogStructureManager, { type CatalogStructureTab } from '@/components/CatalogStructureManager'
import type { CatalogStructure } from '@/db/catalogStructureRepository'
import { Button, Field, FieldLabel, Input, Select, SelectItem } from '@/components/ui'
import type { LocalCatalogEntry } from '@/db/localDb'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { formatFcfa } from '@/lib/formatters'
import { libelleUnite } from '@/lib/catalogPricing'
import type { CatalogBillingUnit, CatalogPricingMode } from '@/types/database'
import { getCategoryColor, getServiceColor } from '@/lib/catalogColor'

function afficherTarif(entree: LocalCatalogEntry): string {
  if (entree.pricingMode === 'QUOTE') return 'Sur devis'
  if (entree.pricingMode === 'UNCONFIGURED') return 'À configurer'
  const prix = formatFcfa(entree.price)
  const prefixe = entree.pricingMode === 'FROM' ? 'À partir de ' : ''
  return `${prefixe}${prix} / ${libelleUnite(entree.billingUnit)}`
}

/**
 * Catalogue des prestations (palier 2).
 *
 * Le référentiel est côté serveur ; cet écran l'écrit puis rafraîchit la copie
 * locale utilisée par la prise de commande. Les modifications exigent une
 * connexion (c'est une décision tarifaire, pas une opération de comptoir), mais
 * la consultation reste possible hors ligne.
 */
export default function Catalogue() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const peutGerer = can(role, 'catalog.manage')

  const [entrees, setEntrees] = useState<LocalCatalogEntry[]>([])
  const [chargement, setChargement] = useState(true)
  const [article, setArticle] = useState('')
  const [service, setService] = useState('')
  const [prix, setPrix] = useState('')
  const [modeTarif, setModeTarif] = useState<CatalogPricingMode>('FIXED')
  const [unite, setUnite] = useState<CatalogBillingUnit>('PIECE')
  const [quantiteMinimum, setQuantiteMinimum] = useState('')
  const [increment, setIncrement] = useState('')
  const [minimumFacturable, setMinimumFacturable] = useState('')
  const [conditions, setConditions] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [afficherArchives, setAfficherArchives] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [structureData, setStructureData] = useState<CatalogStructure | null>(null)
  const [vue, setVue] = useState<'tout' | 'tarifs' | 'families' | 'articles' | 'services'>('tout')
  const [modalSuppressionTarif, setModalSuppressionTarif] = useState<LocalCatalogEntry | null>(null)

  /** Guide contextuel : visible si le catalogue est vide et n'a pas été terminé. */
  const [guideTermine, setGuideTermine] = useState(() => {
    try {
      return localStorage.getItem('catalogue-guide-termine') === '1'
    } catch {
      // localStorage indisponible : on ignore silencieusement
      return false
    }
  })
  const [recherche, setRecherche] = useState('')
  const [filtreCategorie, setFiltreCategorie] = useState('')

  // Le guide ne s'affiche qu'après le premier chargement : sinon, `entrees`
  // étant encore vide pendant `chargement`, il apparaîtrait en flash à chaque
  // ouverture de l'écran, même pour un catalogue déjà complet.
  const guideVisible = !guideTermine && !chargement && entrees.length === 0

  useEffect(() => {
    // Si des entrées apparaissent (chargement ou création), on ferme le guide.
    if (entrees.length > 0 && !guideTermine) {
      setGuideTermine(true)
      try {
        localStorage.setItem('catalogue-guide-termine', '1')
      } catch {
        // localStorage indisponible : on ignore silencieusement
      }
    }
  }, [entrees, guideTermine])

  const recharger = useMemo(
    () => async () => {
      if (!tenantId) return
      const locales = await getCachedCatalog(tenantId, { includeInactive: true })
      setEntrees(locales)
      setChargement(false)
    },
    [tenantId],
  )

  useEffect(() => {
    void recharger()
    if (!tenantId) return
    void refreshCatalog(tenantId).then((ok) => {
      if (ok) void recharger()
    })
  }, [recharger, tenantId])

  const groupes = useMemo(() => {
    const critere = recherche.trim().toLowerCase()
    const map = new Map<string, LocalCatalogEntry[]>()
    entrees
      .filter((entree) => afficherArchives || entree.isActive)
      .filter(
        (entree) =>
          !filtreCategorie ||
          (entree.familyName && entree.familyName.toLowerCase() === filtreCategorie.toLowerCase()),
      )
      .filter(
        (entree) =>
          critere === '' ||
          entree.article.toLowerCase().includes(critere) ||
          entree.service.toLowerCase().includes(critere) ||
          (entree.familyName && entree.familyName.toLowerCase().includes(critere)),
      )
      .forEach((entree) => {
        const liste = map.get(entree.article) ?? []
        liste.push(entree)
        map.set(entree.article, liste)
      })
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }, [entrees, afficherArchives, recherche, filtreCategorie])

  const totalPrestationsFiltrees = useMemo(() => {
    return groupes.reduce((acc, [, items]) => acc + items.length, 0)
  }, [groupes])

  const categoriesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const entree of entrees) {
      if (entree.familyName) set.add(entree.familyName)
    }
    if (structureData?.families) {
      for (const fam of structureData.families) {
        if (fam.is_active) set.add(fam.name)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'))
  }, [entrees, structureData])

  const remettreFormulaire = () => {
    setEditingId(null)
    setArticle('')
    setService('')
    setPrix('')
    setModeTarif('FIXED')
    setUnite('PIECE')
    setQuantiteMinimum('')
    setIncrement('')
    setMinimumFacturable('')
    setConditions('')
  }

  const enregistrer = async () => {
    if (!tenantId) return
    const montant = modeTarif === 'QUOTE' || modeTarif === 'UNCONFIGURED'
      ? 0
      : Number(prix.replace(/\s/g, ''))
    const lireDecimal = (valeur: string): number | null =>
      valeur.trim() === '' ? null : Number(valeur.replace(',', '.'))
    const minimum = lireDecimal(quantiteMinimum)
    const pas = lireDecimal(increment)
    const minimumFcfa = lireDecimal(minimumFacturable)
    const discretes = ['PIECE', 'PAIR', 'SET', 'PACKAGE'].includes(unite)

    if (article.trim().length < 2 || service.trim().length < 2) {
      toast.error('Renseignez un article et une prestation.')
      return
    }
    if (modeTarif !== 'QUOTE' && modeTarif !== 'UNCONFIGURED' && (!Number.isInteger(montant) || montant <= 0)) {
      toast.error('Indiquez un prix unitaire entier, supérieur à zéro, en FCFA.')
      return
    }
    if (minimum !== null && (!Number.isFinite(minimum) || minimum <= 0 || Number(minimum.toFixed(3)) !== minimum)) {
      toast.error('La quantité minimum doit être positive, avec trois décimales maximum.')
      return
    }
    if (pas !== null && (!Number.isFinite(pas) || pas <= 0 || Number(pas.toFixed(3)) !== pas)) {
      toast.error('L’incrément doit être positif, avec trois décimales maximum.')
      return
    }
    if (discretes && ((minimum !== null && !Number.isInteger(minimum)) || (pas !== null && !Number.isInteger(pas)))) {
      toast.error('Les minimums et incréments de pièces, paires et ensembles doivent être entiers.')
      return
    }
    if (minimumFcfa !== null && (!Number.isInteger(minimumFcfa) || minimumFcfa < 0)) {
      toast.error('Le minimum facturable doit être un montant entier positif ou nul.')
      return
    }
    if (conditions.trim().length > 1000) {
      toast.error('Les conditions ne peuvent pas dépasser 1 000 caractères.')
      return
    }

    setEnvoi(true)
    try {
      const tarif = {
        article: article.trim(),
        service: service.trim(),
        price: montant,
        pricingMode: modeTarif,
        billingUnit: unite,
        minimumQuantity: unite === 'FLAT' || modeTarif === 'QUOTE' ? null : minimum,
        billingIncrement: unite === 'FLAT' || modeTarif === 'QUOTE' ? null : pas,
        minimumCharge: modeTarif === 'QUOTE' ? null : minimumFcfa,
        conditions: conditions.trim() || null,
      }
      if (editingId) {
        // Enregistrer constitue une confirmation explicite d'un tarif hérité.
        await updateCatalogEntry(tenantId, editingId, { ...tarif, requiresReview: false })
      } else {
        await createCatalogEntry(tenantId, tarif)
      }
      await refreshCatalog(tenantId)
      await recharger()
      remettreFormulaire()
      toast.success(editingId ? 'Tarif modifié' : 'Prestation ajoutée', { icon: '✅' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const modifier = (entree: LocalCatalogEntry) => {
    setEditingId(entree.id)
    setArticle(entree.article)
    setService(entree.service)
    setPrix(String(entree.price))
    setModeTarif(entree.pricingMode)
    setUnite(entree.pricingMode === 'QUOTE' ? 'FLAT' : entree.billingUnit)
    setQuantiteMinimum(entree.minimumQuantity?.toString() ?? '')
    setIncrement(entree.billingIncrement?.toString() ?? '')
    setMinimumFacturable(entree.minimumCharge?.toString() ?? '')
    setConditions(entree.conditions ?? '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const annulerModification = () => remettreFormulaire()

  const retirer = async (entree: LocalCatalogEntry) => {
    if (!tenantId) return
    setEnvoi(true)
    try {
      await deactivateCatalogEntry(tenantId, entree.id)
      await refreshCatalog(tenantId)
      await recharger()
      toast.success('Prestation retirée du catalogue')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Suppression impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const reactiver = async (entree: LocalCatalogEntry) => {
    if (!tenantId) return
    setEnvoi(true)
    try {
      await updateCatalogEntry(tenantId, entree.id, { isActive: true })
      await refreshCatalog(tenantId)
      await recharger()
      toast.success('Prestation réactivée')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Réactivation impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const executerSuppressionTarif = async (entree: LocalCatalogEntry) => {
    if (!tenantId) return
    setEnvoi(true)
    try {
      await deleteCatalogEntry(tenantId, entree.id)
      await refreshCatalog(tenantId)
      await recharger()
      setModalSuppressionTarif(null)
      toast.success(`Tarif « ${entree.article} — ${entree.service} » supprimé du catalogue.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Suppression impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const supprimerTarif = async (entree: LocalCatalogEntry) => {
    let confirmationTest = false
    try {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        confirmationTest = window.confirm(`Supprimer définitivement le tarif « ${entree.article} — ${entree.service} » ?`)
      }
    } catch {
      confirmationTest = false
    }

    if (confirmationTest) {
      await executerSuppressionTarif(entree)
      return
    }

    setModalSuppressionTarif(entree)
  }

  const installerGrille = async () => {
    if (!tenantId) return
    setEnvoi(true)
    try {
      const nombre = await seedDefaultCatalog(tenantId)
      await refreshCatalog(tenantId)
      await recharger()
      toast.success(
        nombre > 0
          ? `${nombre} prestations de la grille de départ ajoutées`
          : 'Grille de départ déjà présente',
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Installation impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const nombreArchives = entrees.filter((entree) => !entree.isActive).length
  // Seuls les tarifs actifs doivent être confirmés : un tarif archivé n'est
  // plus proposé aux nouvelles commandes, sa vérification ne sert plus rien.
  const nombreAConfirmer = entrees.filter(
    (entree) => entree.isActive && entree.requiresReview,
  ).length

  if (!peutGerer) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <Lock className="mx-auto text-slate-400" size={28} aria-hidden />
        <h1 className="mt-3 text-lg font-bold text-brand-navy">Prestations réservées au propriétaire</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Les tarifs sont fixés par le propriétaire du pressing. Votre rôle permet de
          prendre les commandes aux prix du catalogue, pas de les modifier.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
            <Tag size={22} aria-hidden />
            Catalogue
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Les prix appliqués à une commande sont recopiés sur chaque ligne : modifier le
            catalogue ne change jamais une commande déjà enregistrée.
          </p>
          {nombreAConfirmer > 0 && (
            <p className="mt-2 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              {nombreAConfirmer} tarif{nombreAConfirmer > 1 ? 's sont' : ' est'} à vérifier par le
              propriétaire avant utilisation. Ouvrez « Modifier » puis enregistrez après avoir
              confirmé le montant.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {nombreArchives > 0 && (
            <button
              type="button"
              onClick={() => setAfficherArchives((visible) => !visible)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
            >
              <Archive size={16} aria-hidden />
              {afficherArchives ? 'Masquer les archives' : `Voir les archives (${nombreArchives})`}
            </button>
          )}
        </div>
      </header>

      {/* Barre de recherche instantanée en haut de la page */}
      {entrees.length > 0 && (
        <section
          aria-label="Recherche et filtres du catalogue"
          className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs sm:p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Champ de recherche instantanée */}
            <div className="relative flex-1">
              <Search
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                value={recherche}
                onChange={(event) => setRecherche(event.target.value)}
                placeholder="Rechercher par article, prestation ou catégorie (ex: Chemise, Lavage, Linge)…"
                aria-label="Rechercher dans le catalogue"
                className="w-full pl-10 pr-9 text-sm"
              />
              {recherche && (
                <button
                  type="button"
                  onClick={() => setRecherche('')}
                  aria-label="Effacer la recherche"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Compteur de résultats & bouton réinitialiser */}
            <div className="flex items-center justify-between gap-3 text-xs text-slate-500 sm:justify-end">
              <span>
                {recherche || filtreCategorie ? (
                  <>
                    <strong className="font-semibold text-brand-navy">{totalPrestationsFiltrees}</strong> prestation{totalPrestationsFiltrees > 1 ? 's' : ''} trouvée{totalPrestationsFiltrees > 1 ? 's' : ''}
                    {recherche && <span className="text-slate-500"> pour «&nbsp;{recherche}&nbsp;»</span>}
                  </>
                ) : (
                  <>
                    <strong className="font-semibold text-slate-700">{entrees.length}</strong> prestation{entrees.length > 1 ? 's' : ''} au catalogue
                  </>
                )}
              </span>

              {(recherche || filtreCategorie) && (
                <button
                  type="button"
                  onClick={() => {
                    setRecherche('')
                    setFiltreCategorie('')
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                >
                  <X size={13} aria-hidden /> Réinitialiser
                </button>
              )}
            </div>
          </div>

          {/* Filtres par catégorie avec pastilles de couleur */}
          {categoriesDisponibles.length > 0 && (
            <div
              className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3"
              role="group"
              aria-label="Filtrer par catégorie"
            >
              <span className="mr-1 text-xs font-semibold text-slate-500">Catégories :</span>
              <button
                type="button"
                onClick={() => setFiltreCategorie('')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  !filtreCategorie
                    ? 'bg-brand-navy text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Toutes ({entrees.length})
              </button>
              {categoriesDisponibles.map((nomCat) => {
                const catColor = getCategoryColor(nomCat)
                const estActif = filtreCategorie.toLowerCase() === nomCat.toLowerCase()
                return (
                  <button
                    key={nomCat}
                    type="button"
                    onClick={() => setFiltreCategorie(estActif ? '' : nomCat)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      estActif
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`inline-block size-2 rounded-full shrink-0 ${catColor.dot}`} aria-hidden />
                    <span>{nomCat}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Repères visuels des types de prestations */}
          <div
            className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600"
            aria-label="Légende des types de prestations"
          >
            <span className="font-semibold text-slate-500">Repères :</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-blue-500" aria-hidden /> Lavage
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-emerald-500" aria-hidden /> Repassage
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-purple-500" aria-hidden /> Nettoyage à sec
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-amber-500" aria-hidden /> Détachage
            </span>
          </div>
        </section>
      )}

      {/* Navigation entre les vues du catalogue */}
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-slate-100/90 p-1.5 ring-1 ring-slate-200/70"
        role="tablist"
        aria-label="Navigation du catalogue"
      >
        <button
          type="button"
          role="tab"
          aria-selected={vue === 'tout'}
          onClick={() => setVue('tout')}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition ${
            vue === 'tout'
              ? 'bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers size={15} aria-hidden /> Vue d’ensemble
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={vue === 'tarifs'}
          onClick={() => setVue('tarifs')}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition ${
            vue === 'tarifs'
              ? 'bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Tag size={15} aria-hidden /> Grille des tarifs ({entrees.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={vue === 'families'}
          onClick={() => setVue('families')}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition ${
            vue === 'families'
              ? 'bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FolderTree size={15} aria-hidden /> Catégories ({structureData?.families.length ?? 0})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={vue === 'articles'}
          onClick={() => setVue('articles')}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition ${
            vue === 'articles'
              ? 'bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <BookOpen size={15} aria-hidden /> Articles ({structureData?.articles.length ?? 0})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={vue === 'services'}
          onClick={() => setVue('services')}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition ${
            vue === 'services'
              ? 'bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Scissors size={15} aria-hidden /> Prestations ({structureData?.services.length ?? 0})
        </button>
      </div>

      {tenantId && (vue === 'tout' || vue === 'families' || vue === 'articles' || vue === 'services') && (
        <CatalogStructureManager
          tenantId={tenantId}
          canManage={peutGerer}
          onCatalogChanged={recharger}
          initialTab={vue === 'tout' ? 'families' : (vue as CatalogStructureTab)}
          onStructureLoaded={setStructureData}
        />
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            {editingId ? 'Modifier un tarif' : 'Ajouter un tarif'}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={annulerModification}
              disabled={envoi}
              className="min-h-12 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Annuler
            </button>
          )}
        </div>

        {editingId && entrees.find((entree) => entree.id === editingId)?.requiresReview && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            Confirmez d’abord le tarif réel de votre pressing. L’enregistrement lèvera le blocage
            des nouvelles commandes pour cette ligne.
          </p>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="catalog-article">Article</FieldLabel>
            <Input
              id="catalog-article"
              value={article}
              maxLength={60}
              onChange={(event) => setArticle(event.target.value)}
              placeholder="Chemise"
              list="articles-disponibles"
            />
            <datalist id="articles-disponibles">
              {structureData?.articles.map((art) => (
                <option key={art.id} value={art.name} />
              ))}
            </datalist>
          </Field>

          <Field>
            <FieldLabel htmlFor="catalog-service">Prestation</FieldLabel>
            <Input
              id="catalog-service"
              value={service}
              maxLength={60}
              onChange={(event) => setService(event.target.value)}
              placeholder="Lavage"
              list="prestations-disponibles"
            />
            <datalist id="prestations-disponibles">
              {structureData?.services.map((srv) => (
                <option key={srv.id} value={srv.name} />
              ))}
            </datalist>
          </Field>

          <Field>
            <FieldLabel htmlFor="catalog-mode">Mode de tarification</FieldLabel>
            <Select
              id="catalog-mode"
              value={modeTarif}
              onValueChange={(value) => {
                const mode = value as CatalogPricingMode
                setModeTarif(mode)
                if (mode === 'QUOTE') {
                  setUnite('FLAT')
                  setPrix('0')
                  setQuantiteMinimum('')
                  setIncrement('')
                  setMinimumFacturable('')
                } else if (mode === 'UNCONFIGURED') {
                  setPrix('0')
                } else if (modeTarif === 'QUOTE' || modeTarif === 'UNCONFIGURED') {
                  setPrix('')
                }
              }}
            >
              <SelectItem value="FIXED">Prix fixe</SelectItem>
              <SelectItem value="FROM">À partir de</SelectItem>
              <SelectItem value="QUOTE">Sur devis</SelectItem>
              <SelectItem value="UNCONFIGURED">Non configuré (non facturable)</SelectItem>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="catalog-unit">Unité facturable</FieldLabel>
            <Select
              id="catalog-unit"
              value={unite}
              disabled={modeTarif === 'QUOTE'}
              onValueChange={(value) => {
                const next = value as CatalogBillingUnit
                setUnite(next)
                if (next === 'FLAT') {
                  setQuantiteMinimum('')
                  setIncrement('')
                }
              }}
            >
              <SelectItem value="PIECE">Pièce</SelectItem>
              <SelectItem value="PAIR">Paire</SelectItem>
              <SelectItem value="SET">Ensemble</SelectItem>
              <SelectItem value="KG">Kilogramme</SelectItem>
              <SelectItem value="M2">Mètre carré</SelectItem>
              <SelectItem value="METER">Mètre linéaire</SelectItem>
              <SelectItem value="PACKAGE">Paquet</SelectItem>
              <SelectItem value="FLAT">Forfait</SelectItem>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="catalog-price">
              {modeTarif === 'FROM' ? 'Prix de départ (FCFA / unité)' : 'Prix unitaire (FCFA / unité)'}
            </FieldLabel>
            <Input
              id="catalog-price"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={modeTarif === 'QUOTE' || modeTarif === 'UNCONFIGURED' ? '0' : prix}
              onChange={(event) => setPrix(event.target.value)}
              disabled={modeTarif === 'QUOTE' || modeTarif === 'UNCONFIGURED'}
              placeholder="1500"
            />
          </Field>

          {unite !== 'FLAT' && modeTarif !== 'QUOTE' && (
            <>
              <Field>
                <FieldLabel htmlFor="catalog-min-qty">Quantité minimum</FieldLabel>
                <Input
                  id="catalog-min-qty"
                  type="number"
                  min={0.001}
                  step={['PIECE', 'PAIR', 'SET', 'PACKAGE'].includes(unite) ? 1 : 0.001}
                  value={quantiteMinimum}
                  onChange={(event) => setQuantiteMinimum(event.target.value)}
                  placeholder="Aucun minimum"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-increment">Incrément de facturation</FieldLabel>
                <Input
                  id="catalog-increment"
                  type="number"
                  min={0.001}
                  step={['PIECE', 'PAIR', 'SET', 'PACKAGE'].includes(unite) ? 1 : 0.001}
                  value={increment}
                  onChange={(event) => setIncrement(event.target.value)}
                  placeholder="Aucun arrondi"
                />
              </Field>
            </>
          )}

          {modeTarif !== 'QUOTE' && (
            <Field>
              <FieldLabel htmlFor="catalog-min-charge">Minimum facturable (FCFA)</FieldLabel>
              <Input
                id="catalog-min-charge"
                type="number"
                min={0}
                step={1}
                value={minimumFacturable}
                onChange={(event) => setMinimumFacturable(event.target.value)}
                placeholder="Aucun minimum"
              />
            </Field>
          )}

          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="catalog-conditions">Conditions tarifaires (facultatif)</FieldLabel>
            <textarea
              id="catalog-conditions"
              value={conditions}
              maxLength={1000}
              rows={2}
              onChange={(event) => setConditions(event.target.value)}
              placeholder="Ex. : poids final confirmé à la réception"
              className="w-full min-h-12 rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand-teal"
            />
          </Field>

          <div className="flex items-end lg:col-span-4">
            <Button
              type="button"
              onClick={() => void enregistrer()}
              disabled={envoi}
              className="w-full"
            >
              {envoi ? (
                <Loader2 className="animate-spin" size={16} aria-hidden />
              ) : editingId ? (
                <Pencil size={16} aria-hidden />
              ) : (
                <Plus size={16} aria-hidden />
              )}
              {editingId ? 'Enregistrer le tarif' : 'Ajouter le tarif'}
            </Button>
          </div>
        </div>

        {typeof navigator !== 'undefined' && !navigator.onLine && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            <CloudOff size={14} aria-hidden />
            Hors ligne : la consultation reste possible, l’ajout d’une prestation attendra le
            retour du réseau.
          </p>
        )}
      </section>

      {chargement ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} aria-hidden />
          Chargement du catalogue…
        </p>
      ) : groupes.length === 0 ? (
        recherche.trim() || filtreCategorie ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-12 text-center">
            <p className="font-semibold text-slate-700">Aucune prestation trouvée</p>
            <p className="mt-1 text-sm text-slate-500">
              {recherche.trim() && filtreCategorie ? (
                <>« {recherche.trim()} » dans la catégorie « {filtreCategorie} » ne correspond à aucun élément.</>
              ) : recherche.trim() ? (
                <>« {recherche.trim()} » ne correspond à aucun article, prestation ou catégorie.</>
              ) : (
                <>Aucune prestation active dans la catégorie « {filtreCategorie} ».</>
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                setRecherche('')
                setFiltreCategorie('')
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw size={13} aria-hidden /> Réinitialiser les filtres
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-12 text-center">
            <p className="font-semibold text-slate-700">Catalogue vide</p>
            <p className="mt-1 text-sm text-slate-500">
              Ajoutez vos prestations ci-dessus, ou installez la grille de départ.
            </p>
            <button
              type="button"
              onClick={() => void installerGrille()}
              disabled={envoi}
              className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-brand-navy hover:bg-slate-50 disabled:opacity-50"
            >
              {envoi ? (
                <Loader2 className="animate-spin" size={16} aria-hidden />
              ) : (
                <Zap size={16} aria-hidden />
              )}
              Installer la grille de départ
            </button>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {groupes.map(([nomArticle, prestations]) => (
            <section key={nomArticle} className="group rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-brand-navy">
                  <Tooltip contenu={`${prestations.length} prestation${prestations.length > 1 ? 's' : ''} dans cette catégorie`}>{nomArticle}</Tooltip>
                </h2>
                {prestations[0]?.familyName && (() => {
                  const catColor = getCategoryColor(prestations[0].familyName)
                  return (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                      <span className={`inline-block size-2 rounded-full shrink-0 ${catColor.dot}`} aria-hidden />
                      <span>{prestations[0].familyName}</span>
                    </span>
                  )
                })()}
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {prestations.map((prestation) => (
                  <li
                    key={prestation.id}
                    className={`group inline-flex items-center gap-2 rounded-xl border py-1.5 pl-3 pr-1.5 text-sm ${
                      prestation.isActive
                        ? 'border-slate-200 bg-slate-50'
                        : 'border-amber-200 bg-amber-50 opacity-75'
                    }`}
                  >
                    {(() => {
                      const srvColor = getServiceColor(prestation.service)
                      return (
                        <Tooltip contenu={afficherTarif(prestation) + (prestation.conditions ? ` — ${prestation.conditions}` : '')}>
                          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                            <span
                              className={`inline-block size-2.5 rounded-full shrink-0 ${srvColor.dot}`}
                              title={`Type : ${srvColor.name}`}
                              aria-hidden
                            />
                            <span>{prestation.service}</span>
                          </span>
                        </Tooltip>
                      )
                    })()}
                    <span className="font-bold text-brand-navy">{afficherTarif(prestation)}</span>
                    {prestation.minimumQuantity != null && (
                      <span className="text-xs text-slate-500">min. {prestation.minimumQuantity} {libelleUnite(prestation.billingUnit)}</span>
                    )}
                    {prestation.billingIncrement != null && (
                      <span className="text-xs text-slate-500">pas de {prestation.billingIncrement}</span>
                    )}
                    {prestation.minimumCharge !== null && prestation.minimumCharge > 0 && (
                      <span className="text-xs text-slate-500">minimum {formatFcfa(prestation.minimumCharge)}</span>
                    )}
                    {prestation.referencesActive === false && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        Article ou prestation archivé
                      </span>
                    )}
                    {prestation.isActive && prestation.requiresReview && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        À vérifier
                      </span>
                    )}
                    {!prestation.isActive && (
                      <span className="text-xs font-semibold text-amber-800">Archivée</span>
                    )}
                    <button
                      type="button"
                      onClick={() => modifier(prestation)}
                      disabled={envoi}
                      aria-label={`Modifier ${nomArticle} — ${prestation.service}`}
                      className="inline-flex size-12 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-brand-navy disabled:opacity-40"
                    >
                      <Pencil size={14} aria-hidden />
                    </button>
                    {prestation.isActive ? (
                      <button
                        type="button"
                        onClick={() => void retirer(prestation)}
                        disabled={envoi}
                        aria-label={`Désactiver ${nomArticle} — ${prestation.service}`}
                        className="inline-flex size-12 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                      >
                        <Archive size={14} aria-hidden />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void reactiver(prestation)}
                        disabled={envoi}
                        aria-label={`Réactiver ${nomArticle} — ${prestation.service}`}
                        className="inline-flex size-12 items-center justify-center rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
                      >
                        <RotateCcw size={14} aria-hidden />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void supprimerTarif(prestation)}
                      disabled={envoi}
                      aria-label={`Supprimer ${nomArticle} — ${prestation.service}`}
                      className="inline-flex size-12 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                      title="Supprimer définitivement ce tarif"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {modalSuppressionTarif && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titre-modal-suppression-tarif"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/10">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                <AlertTriangle size={20} aria-hidden />
              </span>
              <div>
                <h3 id="titre-modal-suppression-tarif" className="text-base font-bold text-slate-900">
                  Supprimer ce tarif ?
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Voulez-vous retirer définitivement «{' '}
                  <strong className="text-slate-800">
                    {modalSuppressionTarif.article} — {modalSuppressionTarif.service}
                  </strong>{' '}
                  » du catalogue ?
                </p>
                <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                  Cette action est immédiate et synchronisée. Les commandes déjà enregistrées conservent leur tarif historique.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalSuppressionTarif(null)}
                disabled={envoi}
                className="min-h-12 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={() => void executerSuppressionTarif(modalSuppressionTarif)}
                disabled={envoi}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-rose-700 active:bg-rose-800 disabled:opacity-50"
              >
                {envoi ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Trash2 size={16} aria-hidden />}
                Supprimer le tarif
              </button>
            </div>
          </div>
        </div>
      )}

      {guideVisible && (
        <CatalogGuide
          onPremiereCreation={() => {
            setGuideTermine(true)
            try {
              localStorage.setItem('catalogue-guide-termine', '1')
            } catch {
              // localStorage indisponible : on ignore silencieusement
            }
          }}
        />
      )}
    </div>
  )
}
