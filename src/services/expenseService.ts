import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'
import { todayIso } from '@/constants/orders'
import type { ExpenseCategory, ExpenseRow } from '@/types/database'

/**
 * Dépenses du pressing (palier 3).
 *
 * Le propriétaire seul y a accès : la RLS refuse la lecture aux autres rôles,
 * et l'interface masque l'écran. Une dépense est un fait comptable daté — elle
 * n'est jamais saisie hors ligne, pour éviter deux vérités dans la trésorerie.
 */

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fournitures: 'Fournitures',
  loyer: 'Loyer',
  salaire: 'Salaires',
  eau_electricite: 'Eau et électricité',
  transport: 'Transport',
  autre: 'Autre',
}

export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]

export function expenseErrorMessage(message: string): string {
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Réseau indisponible : les dépenses nécessitent une connexion.'
  }
  if (message.includes('row-level security')) {
    return 'Seul le propriétaire peut consulter et enregistrer les dépenses.'
  }
  if (message.includes('expenses_amount_check')) {
    return 'Le montant doit être supérieur à zéro.'
  }
  return message
}

function requireClient() {
  if (!isSupabaseConfigured) {
    throw new Error('Les dépenses nécessitent une connexion.')
  }
  return getSupabaseClient()
}

export async function listExpenses(tenantId: string, limit = 60): Promise<ExpenseRow[]> {
  const { data, error } = await requireClient()
    .from('expenses')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(expenseErrorMessage(error.message))
  return data ?? []
}

export interface CreateExpenseInput {
  label: string
  category: ExpenseCategory
  amount: number
  spentOn: string
  supplierId: string | null
  note: string | null
}

export async function createExpense(
  tenantId: string,
  input: CreateExpenseInput,
): Promise<ExpenseRow> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Indiquez un montant entier positif, en FCFA.')
  }

  const { data, error } = await requireClient()
    .from('expenses')
    .insert({
      tenant_id: tenantId,
      label: input.label.trim(),
      category: input.category,
      amount: input.amount,
      spent_on: input.spentOn || todayIso(),
      supplier_id: input.supplierId,
      note: input.note?.trim() ? input.note.trim() : null,
    })
    .select('*')
    .maybeSingle()

  if (error) throw new Error(expenseErrorMessage(error.message))
  if (!data) throw new Error('Dépense non enregistrée : vérifiez vos droits.')
  return data
}

export async function deleteExpense(tenantId: string, expenseId: string): Promise<void> {
  const { error } = await requireClient()
    .from('expenses')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', expenseId)

  if (error) throw new Error(expenseErrorMessage(error.message))
}

/** Total des dépenses depuis une date (incluse), pour le tableau de bord. */
export async function sumExpensesSince(tenantId: string, fromIso: string): Promise<number> {
  if (!isSupabaseConfigured) return 0

  const { data, error } = await getSupabaseClient()
    .from('expenses')
    .select('amount')
    .eq('tenant_id', tenantId)
    .gte('spent_on', fromIso)

  if (error || !data) return 0
  return data.reduce((total, ligne) => total + Number(ligne.amount ?? 0), 0)
}

/**
 * Encaissements Mobile Money confirmés depuis une date.
 *
 * La tablette n'en garde aucune trace locale : le guichet CinetPay est mis à
 * jour côté serveur par la notification. Le tableau de bord interroge donc
 * `payment_transactions` — et affiche « hors ligne » quand la lecture échoue
 * plutôt que d'afficher un zéro trompeur.
 */
export async function sumMobileMoneySince(tenantId: string, fromIso: string): Promise<number | null> {
  if (!isSupabaseConfigured) return null

  const { data, error } = await getSupabaseClient()
    .from('payment_transactions')
    .select('amount')
    .eq('tenant_id', tenantId)
    .eq('status', 'paid')
    .neq('provider', 'cash')
    .gte('paid_at', `${fromIso}T00:00:00`)

  if (error || !data) return null
  return data.reduce((total, ligne) => total + Number(ligne.amount ?? 0), 0)
}
