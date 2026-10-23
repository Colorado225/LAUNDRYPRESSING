import { describe, expect, it } from 'vitest'
import {
  SUBSCRIPTION_STATE_LABELS,
  daysBetween,
  daysLeft,
  formatPlan,
  isReadOnly,
  subscriptionNotice,
  todayIso,
} from '@/services/subscriptionService'
import { SUPPORT_STATUS_LABELS } from '@/services/platformService'
import type { SubscriptionSnapshot } from '@/types/database'

/**
 * Palier 4 — abonnements, multi-boutiques et support.
 *
 * Les règles testées ici sont celles qui décident de ce que l'utilisateur
 * **voit** (bandeau, lecture seule). Elles doublent volontairement le calcul
 * SQL : `subscription_state()` reste l'arbitre, mais une divergence entre les
 * deux produirait un bandeau mensonger.
 */

function abonnement(patch: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    tenant_id: '11111111-1111-4111-8111-111111111111',
    state: 'active',
    writable: true,
    plan_code: 'pro',
    plan_name: 'Pro',
    price_fcfa: 35_000,
    duration_days: 30,
    max_users: 10,
    max_shops: 3,
    current_period_end: '2026-11-20',
    trial_ends_on: null,
    grace_days: 7,
    ...patch,
  }
}

describe('dates d’abonnement', () => {
  it('produit la date locale du jour, complétée à deux chiffres', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(todayIso(new Date(2026, 9, 23))).toBe('2026-10-23')
  })

  it('compte les jours calendaires entre deux dates', () => {
    expect(daysBetween('2026-10-23', '2026-11-20')).toBe(28)
    expect(daysBetween('2026-10-23', '2026-10-23')).toBe(0)
  })

  it('ne renvoie jamais un nombre négatif', () => {
    expect(daysBetween('2026-10-23', '2026-10-01')).toBe(0)
  })

  it('tolère un horodatage complet en coupant l’heure', () => {
    expect(daysBetween('2026-10-23T18:45:00.000Z', '2026-10-30T02:00:00.000Z')).toBe(7)
  })

  it('renvoie zéro sans échéance connue', () => {
    expect(daysLeft(null, '2026-10-23')).toBe(0)
    expect(daysLeft(undefined, '2026-10-23')).toBe(0)
  })

  it('compte les jours restants', () => {
    expect(daysLeft('2026-10-30', '2026-10-23')).toBe(7)
  })
})

describe('lecture seule', () => {
  it('un pressing sans abonnement n’est jamais bloqué', () => {
    expect(isReadOnly(null)).toBe(false)
  })

  it('suit le drapeau `writable` renvoyé par le serveur', () => {
    expect(isReadOnly(abonnement({ writable: true }))).toBe(false)
    expect(isReadOnly(abonnement({ writable: false }))).toBe(true)
  })

  it('retombe sur l’état quand `writable` manque', () => {
    // Le serveur peut omettre `writable` : l'état seul doit alors trancher.
    const sansDrapeau = abonnement({ state: 'expired' }) as unknown as SubscriptionSnapshot
    delete (sansDrapeau as { writable?: boolean }).writable
    expect(isReadOnly(sansDrapeau)).toBe(true)

    const essaiSansDrapeau = abonnement({ state: 'trial' }) as unknown as SubscriptionSnapshot
    delete (essaiSansDrapeau as { writable?: boolean }).writable
    expect(isReadOnly(essaiSansDrapeau)).toBe(false)
  })

  it('la période de grâce reste inscriptible', () => {
    expect(isReadOnly(abonnement({ state: 'grace', writable: true }))).toBe(false)
  })
})

describe('bandeau d’abonnement', () => {
  it('n’affiche rien pour un abonnement actif et lointain', () => {
    expect(subscriptionNotice(abonnement(), '2026-10-23')).toBeNull()
  })

  it('prévient sept jours avant l’échéance', () => {
    const notice = subscriptionNotice(abonnement({ current_period_end: '2026-10-28' }), '2026-10-23')
    expect(notice?.tone).toBe('info')
    expect(notice?.text).toContain('5 jours')
  })

  it('explique une suspension avec son motif', () => {
    const notice = subscriptionNotice(
      abonnement({ state: 'suspended', writable: false, suspended_reason: 'Impayé' }),
      '2026-10-23',
    )
    expect(notice?.tone).toBe('blocage')
    expect(notice?.text).toContain('Impayé')
    expect(notice?.text).toContain('lecture seule')
  })

  it('signale la lecture seule quand l’abonnement est échu', () => {
    const notice = subscriptionNotice(abonnement({ state: 'expired', writable: false }), '2026-10-23')
    expect(notice?.tone).toBe('blocage')
    expect(notice?.text).toContain('Abonnement échu')
  })

  it('compte les jours de grâce écoulés', () => {
    const notice = subscriptionNotice(
      abonnement({ state: 'grace', current_period_end: '2026-10-20' }),
      '2026-10-23',
    )
    expect(notice?.tone).toBe('alerte')
    expect(notice?.text).toContain('3 jours')
  })

  it('affiche les jours d’essai restants', () => {
    const notice = subscriptionNotice(
      abonnement({ state: 'trial', trial_ends_on: '2026-10-30' }),
      '2026-10-23',
    )
    expect(notice?.tone).toBe('info')
    expect(notice?.text).toContain('7 jours')
  })
})

describe('présentation de la formule', () => {
  it('assemble nom et prix', () => {
    expect(formatPlan(abonnement())).toContain('Pro')
    expect(formatPlan(abonnement())).toContain('FCFA')
  })

  it('annonce l’absence de formule', () => {
    expect(formatPlan(null)).toBe('Aucune formule')
  })

  it('couvre les cinq états et trois états de support', () => {
    expect(Object.keys(SUBSCRIPTION_STATE_LABELS)).toHaveLength(5)
    expect(Object.keys(SUPPORT_STATUS_LABELS)).toHaveLength(3)
    expect(SUBSCRIPTION_STATE_LABELS.grace).toBe('Période de grâce')
  })
})
