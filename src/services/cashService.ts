import type { CashSessionRow, OrderStatus, PaymentStatus } from '@/types/database'
import { getSupabaseClient } from '@/lib/supabaseClient'

/**
 * Service de caisse (palier 2).
 *
 * Deux responsabilités, volontairement séparées :
 *  - le **calcul du solde**, qui doit rester une fonction pure : il décide de
 *    ce qu'on annonce au client, il doit donc être testable sans réseau ;
 *  - les **appels serveur** de clôture, qui ne calculent jamais le montant
 *    attendu côté client (le serveur refait le calcul).
 */

/** Montant minimal encaissable (FCFA). */
export const MIN_PAYMENT = 100

export interface BalanceLine {
  amount: number
  synced: 0 | 1
  lastError: string | null
}

export interface Balance {
  /** Montant effectivement encaissé (espèces connues + Mobile Money confirmé). */
  paid: number
  /** Reste à payer, jamais négatif. */
  remaining: number
  /** `true` quand la commande est soldée. */
  settled: boolean
}

/**
 * Solde d'une commande.
 *
 * Règle, identique à la vue SQL `order_balances` :
 *  - `payment_status = 'paid'` fait autorité (Mobile Money confirmé par le
 *    webhook, ou solde intégral en espèces) : le solde est nul, même si
 *    l'historique local des espèces est incomplet ;
 *  - sinon, solde = total − somme des espèces encaissées.
 *
 * Un encaissement local refusé par le serveur (`lastError`) reste compté : la
 * tablette a bien reçu l'argent. C'est au comptoir de régulariser, pas au
 * calcul de masquer la recette.
 */
export function computeBalance(
  totalAmount: number,
  paymentStatus: PaymentStatus,
  payments: BalanceLine[],
): Balance {
  const cash = payments.reduce((somme, paiement) => somme + paiement.amount, 0)

  if (paymentStatus === 'paid') {
    return { paid: Math.max(totalAmount, cash), remaining: 0, settled: true }
  }

  const paid = Math.min(cash, totalAmount)
  const remaining = Math.max(totalAmount - cash, 0)

  return { paid, remaining, settled: remaining === 0 }
}

/** Une commande peut-elle encore recevoir un encaissement ? */
export function canAcceptPayment(
  order: { status: OrderStatus; totalAmount: number; paymentStatus: PaymentStatus },
  balance: Balance,
): boolean {
  if (order.status === 'cancelled') return false
  if (order.paymentStatus === 'paid') return false
  return balance.remaining > 0
}

/** Soude le montant saisi dans les bornes autorisées. */
export function clampPaymentAmount(saisie: number, remaining: number): number {
  if (!Number.isFinite(saisie)) return 0
  return Math.max(0, Math.min(Math.floor(saisie), remaining))
}

/** Écart de caisse lisible : « 0 », « +2 000 », « −500 ». */
export function formatDifference(difference: number): string {
  if (difference === 0) return '0'
  const signe = difference > 0 ? '+' : '−'
  return `${signe}${Math.abs(difference).toLocaleString('fr-FR')}`
}

export interface CloseSessionInput {
  businessDate: string
  declaredTotal: number
  notes: string | null
}

/**
 * Clôture une journée de caisse.
 *
 * Le montant attendu est recalculé par le serveur à partir des encaissements
 * enregistrés : un client compromis ne peut pas déclarer ce qui l'arrange.
 */
export async function closeCashSession(input: CloseSessionInput): Promise<CashSessionRow> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('close_cash_session', {
    p_business_date: input.businessDate,
    p_declared_total: input.declaredTotal,
    p_notes: input.notes,
  })

  if (error) throw new Error(traduireErreurCaisse(error.message, error.code))
  return data as CashSessionRow
}

/** Historique des clôtures d'un pressing. */
export async function fetchCashSessions(tenantId: string, limit = 30): Promise<CashSessionRow[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('business_date', { ascending: false })
    .limit(limit)

  if (error) throw new Error(traduireErreurCaisse(error.message, error.code))
  return (data ?? []) as CashSessionRow[]
}

function traduireErreurCaisse(message: string, code?: string): string {
  if (code === '42501' || /row-level security/i.test(message)) {
    return "Votre rôle ne permet pas de clôturer la caisse."
  }
  if (code === '22023') return message
  if (/Failed to fetch|NetworkError/i.test(message)) {
    return 'Réseau indisponible : la clôture de caisse nécessite une connexion.'
  }
  return message
}
