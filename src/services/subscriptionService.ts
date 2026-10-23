import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'
import type { SubscriptionSnapshot, SubscriptionState } from '@/types/database'

/**
 * Abonnement du pressing (palier 4).
 *
 * L'application ne vend rien : elle **lit** l'état décidé par l'éditeur et
 * adapte l'interface. Le blocage réel est côté serveur (`tenant_writable`,
 * politiques restrictives et déclencheurs) ; ce module ne fait que l'expliquer
 * à l'utilisateur, avec un message en français.
 */

export const SUBSCRIPTION_STATE_LABELS: Record<SubscriptionState, string> = {
  trial: 'Essai',
  active: 'Actif',
  grace: 'Période de grâce',
  expired: 'Échu',
  suspended: 'Suspendu',
}

/** États pendant lesquels le pressing peut encore écrire. */
const ETATS_INSCRIPTIBLES: SubscriptionState[] = ['trial', 'active', 'grace']

/** Date locale du jour (`AAAA-MM-JJ`), sans décalage de fuseau. */
export function todayIso(maintenant: Date = new Date()): string {
  const mois = `${maintenant.getMonth() + 1}`.padStart(2, '0')
  const jour = `${maintenant.getDate()}`.padStart(2, '0')
  return `${maintenant.getFullYear()}-${mois}-${jour}`
}

/** Nombre de jours calendaires entre deux dates `AAAA-MM-JJ` (jamais négatif). */
export function daysBetween(from: string, to: string): number {
  const debut = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const fin = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(debut) || Number.isNaN(fin)) return 0
  return Math.max(0, Math.round((fin - debut) / 86_400_000))
}

/** Jours restants avant l'échéance de la période en cours (0 si dépassée). */
export function daysLeft(currentPeriodEnd: string | null | undefined, today: string): number {
  if (!currentPeriodEnd) return 0
  return daysBetween(today, currentPeriodEnd)
}

/**
 * Vrai quand le pressing est en lecture seule.
 *
 * Un pressing **sans abonnement** (compte historique) n'est jamais bloqué :
 * c'est la règle appliquée par `subscription_state()` en SQL.
 */
export function isReadOnly(snapshot: SubscriptionSnapshot | null | undefined): boolean {
  if (!snapshot) return false
  if (typeof snapshot.writable === 'boolean') return !snapshot.writable
  return !ETATS_INSCRIPTIBLES.includes(snapshot.state)
}

/** Bandeau à afficher, ou `null` quand tout va bien. */
export function subscriptionNotice(
  snapshot: SubscriptionSnapshot | null | undefined,
  today: string,
): { tone: 'info' | 'alerte' | 'blocage'; text: string } | null {
  if (!snapshot) return null

  if (snapshot.state === 'suspended') {
    return {
      tone: 'blocage',
      text:
        snapshot.suspended_reason?.trim()
          ? `Abonnement suspendu : ${snapshot.suspended_reason.trim()}. Le pressing est en lecture seule.`
          : 'Abonnement suspendu. Le pressing est en lecture seule : contactez l’éditeur.',
    }
  }

  if (snapshot.state === 'expired') {
    return {
      tone: 'blocage',
      text: 'Abonnement échu : le pressing est en lecture seule. Les données restent consultables, aucune écriture n’est acceptée.',
    }
  }

  if (snapshot.state === 'grace') {
    // Jours **écoulés depuis** l'échéance, pas jours restants : la période de
    // grâce court après la fin de la période payée.
    const ecoules = daysBetween(snapshot.current_period_end ?? today, today)
    return {
      tone: 'alerte',
      text:
        ecoules > 0
          ? `Abonnement échu depuis ${ecoules} jour${ecoules > 1 ? 's' : ''} : période de grâce, pensez à régler la formule.`
          : 'Abonnement échu : période de grâce en cours, pensez à régler la formule.',
    }
  }

  if (snapshot.state === 'trial') {
    const restants = daysLeft(snapshot.trial_ends_on ?? snapshot.current_period_end, today)
    return {
      tone: 'info',
      text: `Période d’essai : ${restants} jour${restants > 1 ? 's' : ''} restant${restants > 1 ? 's' : ''}.`,
    }
  }

  const restants = daysLeft(snapshot.current_period_end, today)
  if (restants > 0 && restants <= 7) {
    return {
      tone: 'info',
      text: `Abonnement à renouveler dans ${restants} jour${restants > 1 ? 's' : ''}.`,
    }
  }

  return null
}

/** Résumé lisible : « Pro · 35 000 FCFA / mois ». */
export function formatPlan(snapshot: SubscriptionSnapshot | null | undefined): string {
  if (!snapshot?.plan_name) return 'Aucune formule'
  const prix = snapshot.price_fcfa
  return prix === undefined ? snapshot.plan_name : `${snapshot.plan_name} · ${prix.toLocaleString('fr-FR')} FCFA / mois`
}

export interface PlanChoice {
  code: string
  name: string
  description: string
  price_fcfa: number
  duration_days: number
  max_users: number | null
  max_shops: number
}

/** Formules proposées par l'éditeur (lecture ouverte aux pressings). */
export async function fetchPlans(): Promise<PlanChoice[]> {
  if (!isSupabaseConfigured) return []

  const { data, error } = await getSupabaseClient()
    .from('plans')
    .select('code, name, description, price_fcfa, duration_days, max_users, max_shops')
    .eq('is_active', true)
    .order('sort_order')

  if (error) throw new Error('Formules indisponibles : vérifiez votre connexion.')
  return data ?? []
}

/** État d'abonnement du pressing connecté ; `null` hors ligne ou sans projet. */
export async function fetchSubscription(): Promise<SubscriptionSnapshot | null> {
  if (!isSupabaseConfigured) return null

  const { data, error } = await getSupabaseClient().rpc('my_subscription')
  if (error) return null
  return (data as SubscriptionSnapshot | null) ?? null
}
