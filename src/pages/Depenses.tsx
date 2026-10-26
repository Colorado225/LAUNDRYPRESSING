import { useCallback, useEffect, useState } from 'react'
import { CloudOff, Loader2, Lock, Pencil, Receipt, Trash2, Wallet, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import { todayIso } from '@/constants/orders'
import { isSupabaseConfigured } from '@/lib/env'
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  createExpense,
  deleteExpense,
  listExpensesPage,
  sumExpensesSince,
  updateExpense,
} from '@/services/expenseService'
import { startOfMonth } from '@/services/dashboardService'
import type { Curseur } from '@/lib/pagination'
import { listSuppliers } from '@/services/stockService'
import type { ExpenseCategory, ExpenseRow, SupplierRow } from '@/types/database'

/**
 * Dépenses du pressing (palier 3).
 *
 * Écran réservé au propriétaire : la RLS refuse la lecture aux autres rôles.
 * Les dépenses vont par paire avec le tableau de bord, qui calcule le résultat
 * du mois.
 */
export default function Depenses() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const autorise = can(role, 'expenses.manage')

  const [depenses, setDepenses] = useState<ExpenseRow[]>([])
  const [fournisseurs, setFournisseurs] = useState<SupplierRow[]>([])
  const [chargement, setChargement] = useState(true)
  const [chargementSuite, setChargementSuite] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  /** Curseur de la dernière ligne reçue ; `null` = pas de suite. */
  const [curseur, setCurseur] = useState<Curseur | null>(null)
  const [aPlus, setAPlus] = useState(false)
  /** Total du mois calculé par le serveur, `null` si la lecture échoue. */
  const [totalMois, setTotalMois] = useState<number | null>(null)

  const [libelle, setLibelle] = useState('')
  const [categorie, setCategorie] = useState<ExpenseCategory>('fournitures')
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(todayIso())
  const [fournisseurId, setFournisseurId] = useState('')
  const [note, setNote] = useState('')
  const [envoi, setEnvoi] = useState(false)
  /** Dépense en cours de correction ; `null` = formulaire de création. */
  const [editionId, setEditionId] = useState<string | null>(null)

  /**
   * Première page. Le total du mois vient d'une agrégation **serveur** : il
   * doit rester juste même quand la page affichée ne couvre pas tout le mois
   * (une page fait 25 lignes, un mois chargé en compte davantage).
   */
  const charger = useCallback(async () => {
    if (!tenantId || !autorise) {
      setChargement(false)
      return
    }
    setErreur(null)

    try {
      const [page, listeFournisseurs, total] = await Promise.all([
        listExpensesPage(tenantId),
        listSuppliers(tenantId),
        sumExpensesSince(tenantId, startOfMonth()).catch(() => null),
      ])
      setDepenses(page.lignes)
      setCurseur(page.curseur)
      setAPlus(page.aPlus)
      setFournisseurs(listeFournisseurs)
      setTotalMois(total)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Chargement impossible.')
    } finally {
      setChargement(false)
    }
  }, [tenantId, autorise])

  /** Page suivante, ajoutée à la suite de la liste déjà affichée. */
  const chargerSuite = async () => {
    if (!tenantId || !curseur || chargementSuite) return
    setChargementSuite(true)
    setErreur(null)

    try {
      const page = await listExpensesPage(tenantId, { curseur })
      setDepenses((actuelles) => [...actuelles, ...page.lignes])
      setCurseur(page.curseur)
      setAPlus(page.aPlus)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Chargement impossible.')
    } finally {
      setChargementSuite(false)
    }
  }

  useEffect(() => {
    void charger()
  }, [charger])

  const reinitialiserFormulaire = () => {
    setEditionId(null)
    setLibelle('')
    setMontant('')
    setNote('')
    setFournisseurId('')
    setCategorie('fournitures')
    setDate(todayIso())
  }

  const commencerEdition = (depense: ExpenseRow) => {
    setEditionId(depense.id)
    setLibelle(depense.label)
    setCategorie(depense.category)
    setMontant(String(depense.amount))
    setDate(depense.spent_on)
    setFournisseurId(depense.supplier_id ?? '')
    setNote(depense.note ?? '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const ajouter = async () => {
    if (!tenantId) return

    const valeur = Number(montant.replace(/\s/g, ''))
    if (libelle.trim().length < 2) {
      toast.error('Donnez un libellé à la dépense.')
      return
    }
    if (!Number.isInteger(valeur) || valeur <= 0) {
      toast.error('Indiquez un montant entier positif, en FCFA.')
      return
    }

    setEnvoi(true)
    try {
      const valeurs = {
        label: libelle,
        category: categorie,
        amount: valeur,
        spentOn: date,
        supplierId: fournisseurId || null,
        note: note || null,
      }

      if (editionId) {
        await updateExpense(tenantId, editionId, valeurs)
        toast.success('Dépense mise à jour', { icon: '✏️' })
      } else {
        await createExpense(tenantId, valeurs)
        toast.success('Dépense enregistrée', { icon: '🧾' })
      }

      reinitialiserFormulaire()
      await charger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const supprimer = async (depense: ExpenseRow) => {
    if (!tenantId) return
    const confirme = window.confirm(`Supprimer la dépense « ${depense.label} » ?`)
    if (!confirme) return

    try {
      await deleteExpense(tenantId, depense.id)
      toast.success('Dépense supprimée')
      if (editionId === depense.id) reinitialiserFormulaire()
      await charger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Suppression impossible')
    }
  }

  if (!autorise) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <Lock className="mx-auto text-slate-400" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-slate-800">Accès réservé</p>
        <p className="mt-1 text-sm text-slate-500">
          Seul le propriétaire consulte et enregistre les dépenses du pressing.
        </p>
      </div>
    )
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
        <CloudOff className="mx-auto text-amber-700" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-amber-900">Module indisponible</p>
        <p className="mt-1 text-sm text-amber-900">
          Les dépenses nécessitent un projet Supabase configuré.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
            <Wallet size={22} aria-hidden /> Dépenses
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Enregistrées au bureau, jamais depuis le comptoir
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-right">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total du mois</p>
          <p className="text-lg font-bold text-rose-700">
            {totalMois === null ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-700">
                <CloudOff size={14} aria-hidden /> Hors ligne
              </span>
            ) : (
              formatFcfa(totalMois)
            )}
          </p>
        </div>
      </header>

      {erreur && (
        <p className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <CloudOff size={18} className="mt-0.5 shrink-0" aria-hidden />
          {erreur}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            {editionId ? <Pencil size={16} aria-hidden /> : null}
            {editionId ? 'Modifier la dépense' : 'Nouvelle dépense'}
          </h2>
          {editionId && (
            <button
              type="button"
              onClick={reinitialiserFormulaire}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <X size={14} aria-hidden /> Annuler la modification
            </button>
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Libellé</span>
            <input
              value={libelle}
              onChange={(event) => setLibelle(event.target.value)}
              placeholder="Loyer du mois, lessive, réparation machine…"
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Catégorie</span>
            <select
              value={categorie}
              onChange={(event) => setCategorie(event.target.value as ExpenseCategory)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
            >
              {EXPENSE_CATEGORIES.map((valeur) => (
                <option key={valeur} value={valeur}>
                  {EXPENSE_CATEGORY_LABELS[valeur]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Montant (FCFA)</span>
            <input
              type="number"
              min={1}
              value={montant}
              onChange={(event) => setMontant(event.target.value)}
              placeholder="150000"
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Date</span>
            <input
              type="date"
              value={date}
              max={todayIso()}
              onChange={(event) => setDate(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
            />
          </label>

          <label className="block">
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

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              Note (facultatif)
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Payé en espèces, reçu n° 42"
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => void ajouter()}
          disabled={envoi}
          className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
        >
          {envoi ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}
          {editionId ? 'Enregistrer les modifications' : 'Enregistrer la dépense'}
        </button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Dernières dépenses
          </h2>
          {depenses.length > 0 && (
            <p className="text-xs text-slate-500">
              {depenses.length} affichée{depenses.length > 1 ? 's' : ''}
              {aPlus ? ', plus anciennes disponibles' : ' — début du registre atteint'}
            </p>
          )}
        </div>

        {chargement ? (
          <p className="flex items-center gap-2 p-4 text-sm text-slate-500">
            <Loader2 className="animate-spin" size={14} aria-hidden />
            Chargement…
          </p>
        ) : depenses.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Aucune dépense enregistrée.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {depenses.map((depense) => (
              <li key={depense.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                    <Receipt size={14} className="text-slate-400" aria-hidden />
                    {depense.label}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {EXPENSE_CATEGORY_LABELS[depense.category]}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateFr(depense.spent_on)}
                    {depense.note ? ` · ${depense.note}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-bold text-rose-700">
                    −{formatFcfa(depense.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => commencerEdition(depense)}
                    aria-label={`Modifier la dépense ${depense.label}`}
                    className="inline-flex size-12 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:border-brand-teal hover:text-brand-navy"
                  >
                    <Pencil size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void supprimer(depense)}
                    aria-label={`Supprimer la dépense ${depense.label}`}
                    className="inline-flex size-12 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Pagination par curseur : le bouton demande « ce qui vient après la
            dernière ligne vue », jamais un décalage. Une dépense ajoutée
            entre-temps ne fait donc ni doublon ni trou. */}
        {aPlus && !chargement && (
          <div className="border-t border-slate-100 p-3">
            <button
              type="button"
              onClick={() => void chargerSuite()}
              disabled={chargementSuite}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-60"
            >
              {chargementSuite ? (
                <Loader2 className="animate-spin" size={16} aria-hidden />
              ) : null}
              Charger les dépenses plus anciennes
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
