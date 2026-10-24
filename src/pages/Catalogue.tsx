import { useEffect, useMemo, useState } from 'react'
import { Archive, CloudOff, Loader2, Lock, Pencil, Plus, RotateCcw, Sparkles, Tag } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  createCatalogEntry,
  deactivateCatalogEntry,
  getCachedCatalog,
  refreshCatalog,
  seedDefaultCatalog,
  updateCatalogEntry,
} from '@/db/catalogRepository'
import type { LocalCatalogEntry } from '@/db/localDb'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { formatFcfa } from '@/lib/formatters'

function afficherTarif(entree: LocalCatalogEntry): string {
  if (entree.pricingMode === 'QUOTE') return 'Sur devis'
  if (entree.pricingMode === 'UNCONFIGURED') return 'À configurer'
  const prix = formatFcfa(entree.price)
  if (entree.pricingMode === 'FROM') return `À partir de ${prix}`
  return prix
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [afficherArchives, setAfficherArchives] = useState(false)
  const [envoi, setEnvoi] = useState(false)

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
    const map = new Map<string, LocalCatalogEntry[]>()
    entrees
      .filter((entree) => afficherArchives || entree.isActive)
      .forEach((entree) => {
        const liste = map.get(entree.article) ?? []
        liste.push(entree)
        map.set(entree.article, liste)
      })
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }, [entrees, afficherArchives])

  const enregistrer = async () => {
    if (!tenantId) return
    const montant = Number(prix.replace(/\s/g, ''))

    if (article.trim().length < 2 || service.trim().length < 2) {
      toast.error('Renseignez un article et une prestation.')
      return
    }
    if (!Number.isInteger(montant) || montant < 0) {
      toast.error('Indiquez un prix entier, en FCFA.')
      return
    }

    setEnvoi(true)
    try {
      const tarif = { article: article.trim(), service: service.trim(), price: montant }
      if (editingId) {
        // Enregistrer constitue une confirmation explicite d'un tarif hérité.
        await updateCatalogEntry(tenantId, editingId, { ...tarif, requiresReview: false })
      } else {
        await createCatalogEntry(tenantId, tarif)
      }
      await refreshCatalog(tenantId)
      await recharger()
      setArticle('')
      setService('')
      setPrix('')
      setEditingId(null)
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
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const annulerModification = () => {
    setEditingId(null)
    setArticle('')
    setService('')
    setPrix('')
  }

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

  const installer = async () => {
    if (!tenantId) return
    setEnvoi(true)
    try {
      const ajoutees = await seedDefaultCatalog(tenantId)
      await refreshCatalog(tenantId)
      await recharger()
      toast.success(
        ajoutees > 0 ? `${ajoutees} prestations installées` : 'Le catalogue était déjà complet',
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Installation impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const nombreActives = entrees.filter((entree) => entree.isActive).length
  const nombreArchives = entrees.length - nombreActives
  const nombreAConfirmer = entrees.filter((entree) => entree.requiresReview).length

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
            Prestations
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
          {nombreActives === 0 && entrees.length === 0 && (
            <button
              type="button"
              onClick={() => void installer()}
              disabled={envoi}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-bold text-white disabled:opacity-60"
            >
              <Sparkles size={16} aria-hidden />
              Installer les prestations courantes
            </button>
          )}
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            {editingId ? 'Modifier une prestation' : 'Ajouter une prestation'}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={annulerModification}
              disabled={envoi}
              className="min-h-10 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100"
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

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto]">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Article</span>
            <input
              value={article}
              maxLength={60}
              onChange={(event) => setArticle(event.target.value)}
              placeholder="Chemise"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Prestation</span>
            <input
              value={service}
              maxLength={60}
              onChange={(event) => setService(event.target.value)}
              placeholder="Lavage"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Prix (FCFA)</span>
            <input
              type="number"
              min={0}
              step={50}
              inputMode="numeric"
              value={prix}
              onChange={(event) => setPrix(event.target.value)}
              placeholder="1500"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void enregistrer()}
              disabled={envoi}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
            >
              {envoi ? (
                <Loader2 className="animate-spin" size={16} aria-hidden />
              ) : editingId ? (
                <Pencil size={16} aria-hidden />
              ) : (
                <Plus size={16} aria-hidden />
              )}
              {editingId ? 'Enregistrer' : 'Ajouter'}
            </button>
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
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-12 text-center">
          <p className="font-semibold text-slate-700">Catalogue vide</p>
          <p className="mt-1 text-sm text-slate-500">
            Ajoutez vos prestations ci-dessus, ou installez la grille de départ.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupes.map(([nomArticle, prestations]) => (
            <section key={nomArticle} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-bold text-brand-navy">{nomArticle}</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {prestations.map((prestation) => (
                  <li
                    key={prestation.id}
                    className={`inline-flex items-center gap-2 rounded-xl border py-1.5 pl-3 pr-1.5 text-sm ${
                      prestation.isActive
                        ? 'border-slate-200 bg-slate-50'
                        : 'border-amber-200 bg-amber-50 opacity-75'
                    }`}
                  >
                    <span className="font-medium text-slate-700">{prestation.service}</span>
                    <span className="font-bold text-brand-navy">{afficherTarif(prestation)}</span>
                    {prestation.billingUnit !== 'PIECE' && (
                      <span className="text-xs text-slate-500">/ {prestation.billingUnit}</span>
                    )}
                    {prestation.requiresReview && (
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
                      className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-brand-navy disabled:opacity-40"
                    >
                      <Pencil size={14} aria-hidden />
                    </button>
                    {prestation.isActive ? (
                      <button
                        type="button"
                        onClick={() => void retirer(prestation)}
                        disabled={envoi}
                        aria-label={`Désactiver ${nomArticle} — ${prestation.service}`}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                      >
                        ×
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void reactiver(prestation)}
                        disabled={envoi}
                        aria-label={`Réactiver ${nomArticle} — ${prestation.service}`}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
                      >
                        <RotateCcw size={14} aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
