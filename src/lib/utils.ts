import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Fusionne des classes Tailwind en gardant la dernière gagnante.
 *
 * `clsx` assemble les conditions (`actif && 'bg-white'`), `twMerge` arbitre les
 * conflits (`px-2` puis `px-4` → `px-4`). C'est la brique de base des
 * composants d'interface : sans elle, une classe passée par l'appelant ne peut
 * pas corriger un style par défaut, et chaque composant finit par exposer une
 * prop par exception.
 *
 * Aucune dépendance réseau, aucun état : testable et utilisable partout.
 */
export function cn(...entrees: ClassValue[]): string {
  return twMerge(clsx(entrees))
}
