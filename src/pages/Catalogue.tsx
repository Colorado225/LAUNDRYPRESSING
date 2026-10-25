import { useEffect, useMemo, useState } from 'react'
import { Archive, CloudOff, Loader2, Lock, Pencil, Plus, RotateCcw, Tag } from 'lucide-react'
import toast from 'react-hot-toast'
import Tooltip from '@/components/Tooltip'
import CatalogGuide from '@/components/CatalogGuide'
import {
  createCatalogEntry,
  deactivateCatalogEntry,
  getCachedCatalog,
  refreshCatalog,
  updateCatalogEntry,
} from '@/db/catalogRepository'
import CatalogStructureManager from '@/components/CatalogStructureManager'
import { Button, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import type { LocalCatalogEntry } from '@/db/localDb'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { formatFcfa } from '@/lib/formatters'
import { libelleUnite } from '@/lib/catalogPricing'
import type { CatalogBillingUnit, CatalogPricingMode } from '@/types/database'

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

  /** Guide contextuel : visible si le catalogue est vide et n'a pas été terminé. */
  const guideTermine = localStorage.getItem('catalogue-guide-termine') === '1'
  const [guideVisible, setGuideVisible] = useState(
    entrees.length === 0 && !guideTermine,
  )

  useEffect(() => {
    // Si des entrées apparaissent (chargement ou création), on ferme le guide.
    if (entrees.length > 0 && guideVisible) {
      setGuideVisible(false)
      try {
        localStorage.setItem('catalogue-guide-termine', '1')
      } catch {
        // localStorage indisponible : on ignore silencieusement
      }
    }
  }, [entrees, guideVisible])

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

  const nombreArchives = entrees.filter((entree) => !entree.isActive).length
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

      {tenantId && <CatalogStructureManager tenantId={tenantId} canManage={peutGerer} onCatalogChanged={recharger} />}

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
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="catalog-service">Prestation</FieldLabel>
            <Input
              id="catalog-service"
              value={service}
              maxLength={60}
              onChange={(event) => setService(event.target.value)}
              placeholder="Lavage"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="catalog-mode">Mode de tarification</FieldLabel>
            <Select
              id="catalog-mode"
              defaultValue={modeTarif}
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
              <SelectTrigger id="catalog-mode-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FIXED">Prix fixe</SelectItem>
                <SelectItem value="FROM">À partir de</SelectItem>
                <SelectItem value="QUOTE">Sur devis</SelectItem>
                <SelectItem value="UNCONFIGURED">Non configuré (non facturable)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="catalog-unit">Unité facturable</FieldLabel>
            <Select
              id="catalog-unit"
              defaultValue={unite}
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
              <SelectTrigger id="catalog-unit-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PIECE">Pièce</SelectItem>
                <SelectItem value="PAIR">Paire</SelectItem>
                <SelectItem value="SET">Ensemble</SelectItem>
                <SelectItem value="KG">Kilogramme</SelectItem>
                <SelectItem value="M2">Mètre carré</SelectItem>
                <SelectItem value="METER">Mètre linéaire</SelectItem>
                <SelectItem value="PACKAGE">Paquet</SelectItem>
                <SelectItem value="FLAT">Forfait</SelectItem>
              </SelectContent>
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
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand-teal"
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
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-12 text-center">
          <p className="font-semibold text-slate-700">Catalogue vide</p>
          <p className="mt-1 text-sm text-slate-500">
            Ajoutez vos prestations ci-dessus, ou installez la grille de départ.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupes.map(([nomArticle, prestations]) => (
            <section key={nomArticle} className="group rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-bold text-brand-navy">
                <Tooltip contenu={`${prestations.length} prestation${prestations.length > 1 ? 's' : ''} dans cette catégorie`}>{nomArticle}</Tooltip>
              </h2>
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
                    <Tooltip contenu={afficherTarif(prestation) + (prestation.conditions ? ` — ${prestation.conditions}` : '')}>
                      <span className="font-medium text-slate-700">{prestation.service}</span>
                    </Tooltip>
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
                        ×
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
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {guideVisible && (
        <CatalogGuide
          onPremiereCreation={() => {
            setGuideVisible(false)
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
