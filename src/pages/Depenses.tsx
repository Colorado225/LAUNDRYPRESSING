import { useCallback, useEffect, useMemo, useState } from 'react'
import { CloudOff, Loader2, Lock, Receipt, Trash2, Wallet } from 'lucide-react'
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
  listExpenses,
} from '@/services/expenseService'
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
  const [erreur, setErreur] = useState<string | null>(null)

  const [libelle, setLibelle] = useState('')
  const [categorie, setCategorie] = useState<ExpenseCategory>('fournitures')
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(todayIso())
  const [fournisseurId, setFournisseurId] = useState('')
  const [note, setNote] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const charger = useCallback(async () => {
    if (!tenantId || !autorise) {
      setChargement(false)
      return
    }
    setErreur(null)

    try {
      const [liste, listeFournisseurs] = await Promise.all([
        listExpenses(tenantId),
        listSuppliers(tenantId),
      ])
      setDepenses(liste)
      setFournisseurs(listeFournisseurs)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Chargement impossible.')
    } finally {
      setChargement(false)
    }
  }, [tenantId, autorise])

  useEffect(() => {
    void charger()
  }, [charger])

  const totalMois = useMemo(() => {
    const mois = todayIso().slice(0, 7)
    return depenses
      .filter((depense) => depense.spent_on.startsWith(mois))
      .reduce((total, depense) => total + depense.amount, 0)
  }, [depenses])

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
      await createExpense(tenantId, {
        label: libelle,
        category: categorie,
        amount: valeur,
        spentOn: date,
        supplierId: fournisseurId || null,
        note: note || null,
      })
      toast.success('Dépense enregistrée', { icon: '🧾' })
      setLibelle('')
      setMontant('')
      setNote('')
      setFournisseurId('')
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
          <p className="text-lg font-bold text-rose-700">{formatFcfa(totalMois)}</p>
        </div>
      </header>

      {erreur && (
        <p className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <CloudOff size={18} className="mt-0.5 shrink-0" aria-hidden />
          {erreur}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Nouvelle dépense
        </h2>

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
          Enregistrer la dépense
        </button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <h2 className="px-4 pt-4 text-sm font-bold uppercase tracking-wide text-slate-500">
          Dernières dépenses
        </h2>

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
                    onClick={() => void supprimer(depense)}
                    aria-label={`Supprimer la dépense ${depense.label}`}
                    className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
