import { useCallback, useEffect, useState } from 'react'
import { Archive, BookOpen, FolderTree, Loader2, Pencil, Plus, RotateCcw, Scissors, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  createCatalogArticle,
  createCatalogFamily,
  createCatalogService,
  deleteCatalogArticle,
  deleteCatalogFamily,
  deleteCatalogService,
  loadCatalogStructure,
  setCatalogArticleActive,
  setCatalogServiceActive,
  updateCatalogArticle,
  updateCatalogFamily,
  updateCatalogService,
  type CatalogStructure,
} from '@/db/catalogStructureRepository'
import { refreshCatalog } from '@/db/catalogRepository'
import type {
  CatalogArticleRow,
  CatalogBillingUnit,
  CatalogFamilyRow,
  CatalogServiceRow,
  CatalogServiceType,
  CatalogApplicationScope,
} from '@/types/database'

type Tab = 'families' | 'articles' | 'services'

interface FormState {
  id: string | null
  name: string
  description: string
  sortOrder: string
  familyId: string
  careInstructions: string
  defaultUnit: CatalogBillingUnit
  serviceType: CatalogServiceType
  applicationScope: CatalogApplicationScope
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  description: '',
  sortOrder: '0',
  familyId: '',
  careInstructions: '',
  defaultUnit: 'PIECE',
  serviceType: 'treatment',
  applicationScope: 'article',
}

const TABS: Array<{ id: Tab; label: string; icon: typeof FolderTree }> = [
  { id: 'families', label: 'Catégories', icon: FolderTree },
  { id: 'articles', label: 'Articles', icon: BookOpen },
  { id: 'services', label: 'Prestations', icon: Scissors },
]

interface Props {
  tenantId: string
  onCatalogChanged: () => Promise<void>
}

function texteErreur(error: unknown): string {
  return error instanceof Error ? error.message : 'Opération impossible pour le moment.'
}

/** Administration des référentiels normalisés déjà présents en base. */
export default function CatalogStructureManager({ tenantId, onCatalogChanged }: Props) {
  const [tab, setTab] = useState<Tab>('families')
  const [structure, setStructure] = useState<CatalogStructure>({ families: [], articles: [], services: [] })
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [chargement, setChargement] = useState(true)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const recharger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      setStructure(await loadCatalogStructure(tenantId))
    } catch (cause) {
      setErreur(texteErreur(cause))
    } finally {
      setChargement(false)
    }
  }, [tenantId])

  useEffect(() => {
    void recharger()
  }, [recharger])

  const reinitialiser = () => setForm(EMPTY_FORM)
  const changerTab = (prochaine: Tab) => {
    setTab(prochaine)
    reinitialiser()
  }

  const modifierFamille = (item: CatalogFamilyRow) => {
    setForm({ ...EMPTY_FORM, id: item.id, name: item.name, description: item.description ?? '', sortOrder: String(item.sort_order) })
  }

  const modifierArticle = (item: CatalogArticleRow) => {
    setForm({
      ...EMPTY_FORM,
      id: item.id,
      name: item.name,
      description: item.description ?? '',
      sortOrder: String(item.sort_order),
      familyId: item.family_id,
      careInstructions: item.care_instructions ?? '',
      defaultUnit: item.default_unit,
    })
  }

  const modifierPrestation = (item: CatalogServiceRow) => {
    setForm({
      ...EMPTY_FORM,
      id: item.id,
      name: item.name,
      description: item.description ?? '',
      sortOrder: String(item.sort_order),
      serviceType: item.service_type,
      applicationScope: item.application_scope,
    })
  }

  const enregistrer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nom = form.name.trim()
    const ordre = Number(form.sortOrder)
    const longueurMax = tab === 'families' ? 80 : 60
    if (nom.length < 2 || nom.length > longueurMax) {
      toast.error(`Le nom doit contenir entre 2 et ${longueurMax} caractères.`)
      return
    }
    if (!Number.isInteger(ordre)) {
      toast.error('L’ordre d’affichage doit être un nombre entier.')
      return
    }
    if (tab === 'articles' && !form.familyId) {
      toast.error('Choisissez une catégorie pour cet article.')
      return
    }
    if (tab === 'articles' && !structure.families.some((family) => family.id === form.familyId && (family.is_active || family.id === structure.articles.find((item) => item.id === form.id)?.family_id))) {
      toast.error('Choisissez une catégorie active pour cet article.')
      return
    }

    setEnvoi(true)
    try {
      if (tab === 'families') {
        const input = { name: nom, description: form.description, sort_order: ordre }
        if (form.id) await updateCatalogFamily(tenantId, form.id, input)
        else await createCatalogFamily(tenantId, input)
      } else if (tab === 'articles') {
        const input = {
          name: nom,
          family_id: form.familyId,
          description: form.description,
          care_instructions: form.careInstructions,
          default_unit: form.defaultUnit,
          sort_order: ordre,
        }
        if (form.id) await updateCatalogArticle(tenantId, form.id, input)
        else await createCatalogArticle(tenantId, input)
      } else {
        const input = {
          name: nom,
          description: form.description,
          service_type: form.serviceType,
          application_scope: form.applicationScope,
          sort_order: ordre,
        }
        if (form.id) await updateCatalogService(tenantId, form.id, input)
        else await createCatalogService(tenantId, input)
      }
      reinitialiser()
      await refreshCatalog(tenantId)
      await Promise.all([recharger(), onCatalogChanged()])
      toast.success(form.id ? 'Modification enregistrée.' : 'Élément ajouté au catalogue.')
    } catch (cause) {
      toast.error(texteErreur(cause))
    } finally {
      setEnvoi(false)
    }
  }

  const changerActivation = async (item: CatalogFamilyRow | CatalogArticleRow | CatalogServiceRow) => {
    setEnvoi(true)
    try {
      if (tab === 'families') {
        await updateCatalogFamily(tenantId, item.id, { is_active: !item.is_active })
      } else if (tab === 'articles') {
        await setCatalogArticleActive(tenantId, item.id, !item.is_active)
      } else {
        await setCatalogServiceActive(tenantId, item.id, !item.is_active)
      }
      await refreshCatalog(tenantId)
      await Promise.all([recharger(), onCatalogChanged()])
      toast.success(item.is_active ? 'Élément archivé.' : 'Élément réactivé.')
    } catch (cause) {
      toast.error(texteErreur(cause))
    } finally {
      setEnvoi(false)
    }
  }

  const supprimer = async (item: CatalogFamilyRow | CatalogArticleRow | CatalogServiceRow) => {
    const confirmation = window.confirm(`Supprimer « ${item.name} » ? Cette action est définitive.`)
    if (!confirmation) return
    setEnvoi(true)
    try {
      if (tab === 'families') await deleteCatalogFamily(tenantId, item.id)
      else if (tab === 'articles') await deleteCatalogArticle(tenantId, item.id)
      else await deleteCatalogService(tenantId, item.id)
      await recharger()
      toast.success('Élément supprimé.')
    } catch (cause) {
      toast.error(texteErreur(cause))
    } finally {
      setEnvoi(false)
    }
  }

  const liste: Array<CatalogFamilyRow | CatalogArticleRow | CatalogServiceRow> =
    tab === 'families' ? structure.families : tab === 'articles' ? structure.articles : structure.services
  const libelleType = (type: CatalogServiceType) => ({
    treatment: 'Traitement', option: 'Option', logistics: 'Logistique', other: 'Autre',
  })[type]
  const libellePortee = (scope: CatalogApplicationScope) => scope === 'article' ? 'Par article' : 'Commande entière'

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <header>
        <h2 className="text-base font-bold text-brand-navy">Structure du catalogue</h2>
        <p className="mt-1 text-sm text-slate-600">
          Gérez séparément les catégories, les articles et les prestations de ce pressing. Les tarifs restent dans la grille ci-dessous.
        </p>
      </header>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Sections du catalogue">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => changerTab(id)}
            className={`inline-flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${tab === id ? 'border-brand-teal bg-brand-teal/10 text-brand-navy' : 'border-slate-300 text-slate-600'}`}
          >
            <Icon size={16} aria-hidden /> {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form onSubmit={(event) => void enregistrer(event)} className="space-y-3 rounded-xl bg-slate-50 p-3">
          <h3 className="text-sm font-bold text-slate-700">
            {form.id ? `Modifier ${tab === 'families' ? 'une catégorie' : tab === 'articles' ? 'un article' : 'une prestation'}` : `Ajouter ${tab === 'families' ? 'une catégorie' : tab === 'articles' ? 'un article' : 'une prestation'}`}
          </h3>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Nom</span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
              minLength={2}
              maxLength={tab === 'families' ? 80 : 60}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
            />
          </label>

          {tab === 'articles' && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Catégorie</span>
                <select
                  value={form.familyId}
                  onChange={(event) => setForm((current) => ({ ...current, familyId: event.target.value }))}
                  required
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
                >
                  <option value="">Choisir une catégorie…</option>
                  {structure.families.map((family) => (
                    <option key={family.id} value={family.id} disabled={!family.is_active && family.id !== form.familyId}>
                      {family.name}{family.is_active ? '' : ' — archivée'}
                    </option>
                  ))}
                </select>
                {structure.families.filter((family) => family.is_active).length === 0 && (
                  <span className="mt-1 block text-xs text-amber-800">Créez ou réactivez une catégorie avant d’ajouter un article.</span>
                )}
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Unité par défaut</span>
                <select
                  value={form.defaultUnit}
                  onChange={(event) => setForm((current) => ({ ...current, defaultUnit: event.target.value as CatalogBillingUnit }))}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
                >
                  <option value="PIECE">Pièce</option><option value="PAIR">Paire</option><option value="SET">Ensemble</option>
                  <option value="KG">Kilogramme</option><option value="M2">Mètre carré</option><option value="METER">Mètre</option>
                  <option value="PACKAGE">Paquet</option><option value="FLAT">Forfait</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Consignes d’entretien</span>
                <textarea
                  value={form.careInstructions}
                  onChange={(event) => setForm((current) => ({ ...current, careInstructions: event.target.value }))}
                  maxLength={500}
                  rows={2}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base"
                />
              </label>
            </>
          )}

          {tab === 'services' && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Type de prestation</span>
                <select
                  value={form.serviceType}
                  onChange={(event) => setForm((current) => ({ ...current, serviceType: event.target.value as CatalogServiceType }))}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
                >
                  <option value="treatment">Traitement</option><option value="option">Option</option>
                  <option value="logistics">Logistique</option><option value="other">Autre</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Application</span>
                <select
                  value={form.applicationScope}
                  onChange={(event) => setForm((current) => ({ ...current, applicationScope: event.target.value as CatalogApplicationScope }))}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
                >
                  <option value="article">Par article</option><option value="order">Commande entière</option>
                </select>
              </label>
            </>
          )}

          {tab !== 'articles' && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Description (facultative)</span>
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                maxLength={500}
                rows={2}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base"
              />
            </label>
          )}
          {tab === 'articles' && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Description (facultative)</span>
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                maxLength={500}
                rows={2}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base"
              />
            </label>
          )}

          <label className="block max-w-40">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Ordre d’affichage</span>
            <input
              type="number"
              step={1}
              value={form.sortOrder}
              onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={envoi || chargement} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white disabled:opacity-50">
              {envoi ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
              {form.id ? 'Enregistrer' : 'Ajouter'}
            </button>
            {form.id && <button type="button" onClick={reinitialiser} disabled={envoi} className="min-h-12 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700">Annuler</button>}
          </div>
        </form>

        <div className="space-y-2">
          {erreur && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{erreur} La grille tarifaire en cache reste consultable, mais la structure ne peut pas être modifiée hors ligne.</p>}
          {chargement ? (
            <p className="flex min-h-20 items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" aria-hidden /> Chargement de la structure…</p>
          ) : liste.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Aucun élément dans cette section. Vous pouvez en ajouter un ici.</p>
          ) : liste.map((item) => {
            const detail = tab === 'articles'
              ? structure.families.find((family) => family.id === (item as CatalogArticleRow).family_id)?.name ?? 'Catégorie introuvable'
              : tab === 'services'
                ? `${libelleType((item as CatalogServiceRow).service_type)} · ${libellePortee((item as CatalogServiceRow).application_scope)}`
                : `${structure.articles.filter((article) => article.family_id === item.id).length} article(s)`
            return (
              <article key={item.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${item.is_active ? 'border-slate-200' : 'border-amber-200 bg-amber-50/60'}`}>
                <div className="min-w-0">
                  <h4 className="font-semibold text-slate-800">{item.name}{!item.is_active && <span className="ml-2 text-xs font-semibold text-amber-800">Archivé</span>}</h4>
                  <p className="text-xs text-slate-500">{detail} · ordre {item.sort_order}</p>
                  {item.description && <p className="mt-1 text-xs text-slate-600">{item.description}</p>}
                  {tab === 'articles' && (item as CatalogArticleRow).care_instructions && <p className="mt-1 text-xs text-slate-600">Entretien : {(item as CatalogArticleRow).care_instructions}</p>}
                  {tab === 'articles' && <p className="text-xs text-slate-500">Unité par défaut : {(item as CatalogArticleRow).default_unit}</p>}
                </div>
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => tab === 'families' ? modifierFamille(item as CatalogFamilyRow) : tab === 'articles' ? modifierArticle(item as CatalogArticleRow) : modifierPrestation(item as CatalogServiceRow)} disabled={envoi} aria-label={`Modifier ${item.name}`} className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"><Pencil size={16} aria-hidden /></button>
                  <button type="button" onClick={() => void changerActivation(item)} disabled={envoi} aria-label={`${item.is_active ? 'Archiver' : 'Réactiver'} ${item.name}`} className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">{item.is_active ? <Archive size={16} aria-hidden /> : <RotateCcw size={16} aria-hidden />}</button>
                  <button type="button" onClick={() => void supprimer(item)} disabled={envoi} aria-label={`Supprimer ${item.name}`} className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"><Trash2 size={16} aria-hidden /></button>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
