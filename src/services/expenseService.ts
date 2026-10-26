import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'
import { todayIso } from '@/constants/orders'
import { decouperPageCurseur, filtreCurseur, type Curseur } from '@/lib/pagination'
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

/** Taille d'une page de dépenses : ce qui tient à l'écran sans faire défiler. */
export const TAILLE_PAGE_DEPENSES = 25

export interface PageDepenses {
  lignes: ExpenseRow[]
  /** Curseur à passer pour obtenir la suite, `null` si la page est vide. */
  curseur: Curseur | null
  /** Existe-t-il au moins une dépense plus ancienne ? */
  aPlus: boolean
}

/**
 * Une page de dépenses, de la plus récente à la plus ancienne.
 *
 * Pagination **par curseur** et non par `offset` : la liste des dépenses est
 * alimentée par le serveur et grandit chaque semaine. Avec un décalage, une
 * dépense saisie entre deux pages ferait réapparaître la dernière ligne de la
 * page précédente et disparaître une autre. Le curseur, lui, repart de la
 * dernière ligne réellement vue.
 *
 * Tri `created_at` décroissant puis `id` : l'horodatage seul n'est pas unique,
 * et un tri non total rendrait la pagination instable.
 */
export async function listExpensesPage(
  tenantId: string,
  options: { curseur?: Curseur | null; limite?: number } = {},
): Promise<PageDepenses> {
  const limite = Math.max(1, Math.floor(options.limite ?? TAILLE_PAGE_DEPENSES))

  let requete = requireClient()
    .from('expenses')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    // Une ligne de plus que la page : elle sert seulement à savoir s'il y a
    // une suite, sans demander un `count(*)` à chaque page.
    .limit(limite + 1)

  if (options.curseur) {
    requete = requete.or(filtreCurseur('created_at', options.curseur))
  }

  const { data, error } = await requete
  if (error) throw new Error(expenseErrorMessage(error.message))

  return decouperPageCurseur((data ?? []) as ExpenseRow[], limite, (ligne) => ligne.created_at)
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

/** Modification d'une dépense : un montant mal saisi se corrige, il ne s'efface pas. */
export async function updateExpense(
  tenantId: string,
  expenseId: string,
  patch: Partial<CreateExpenseInput>,
): Promise<ExpenseRow> {
  const valeurs: Partial<
    Pick<ExpenseRow, 'label' | 'category' | 'amount' | 'spent_on' | 'supplier_id' | 'note'>
  > = {}
  if (patch.label !== undefined) {
    const libelle = patch.label.trim()
    if (libelle.length < 2) throw new Error('Donnez un libellé à la dépense.')
    if (libelle.length > 120) throw new Error('Le libellé ne peut pas dépasser 120 caractères.')
    valeurs.label = libelle
  }
  if (patch.category !== undefined) valeurs.category = patch.category
  if (patch.amount !== undefined) {
    if (!Number.isInteger(patch.amount) || patch.amount <= 0) {
      throw new Error('Indiquez un montant entier positif, en FCFA.')
    }
    valeurs.amount = patch.amount
  }
  if (patch.spentOn !== undefined) valeurs.spent_on = patch.spentOn || todayIso()
  if (patch.supplierId !== undefined) valeurs.supplier_id = patch.supplierId
  if (patch.note !== undefined) valeurs.note = patch.note?.trim() ? patch.note.trim() : null

  if (Object.keys(valeurs).length === 0) throw new Error('Aucune modification à enregistrer.')

  const { data, error } = await requireClient()
    .from('expenses')
    .update(valeurs)
    .eq('tenant_id', tenantId)
    .eq('id', expenseId)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(expenseErrorMessage(error.message))
  if (!data) throw new Error('Dépense introuvable ou non modifiable.')
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
