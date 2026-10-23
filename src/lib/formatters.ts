/**
 * Formatage localisé — Côte d'Ivoire.
 *
 * Le franc CFA (XOF) n'a pas de sous-unité : tous les montants sont des
 * entiers. On n'utilise donc jamais `toFixed(2)` ni de décimales.
 */

const fcfaFormatter = new Intl.NumberFormat('fr-CI', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
})

const dateFormatter = new Intl.DateTimeFormat('fr-CI', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat('fr-CI', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Formate un montant entier en FCFA : `1500` → `1 500 FCFA`. */
export function formatFcfa(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  return `${fcfaFormatter.format(Math.round(amount))} FCFA`
}

/** `2026-10-23T08:00:00Z` → `23/10/2026`. */
export function formatDateFr(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return dateFormatter.format(date)
}

/** `2026-10-23T08:00:00Z` → `23/10/2026 08:00`. */
export function formatDateTimeFr(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return dateTimeFormatter.format(date)
}

/** Formate un numéro ivoirien pour l'affichage : `0707070707` → `07 07 07 07 07`. */
export function formatPhoneCi(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length !== 10) return phone
  return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim()
}
