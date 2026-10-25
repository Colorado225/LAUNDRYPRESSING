/**
 * Utilitaire de fusion de classes Tailwind — sans dépendance externe.
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
