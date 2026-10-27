import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Champ de saisie.
 *
 * `text-base` (16 px) est volontaire : en dessous, Safari sur iPhone zoome
 * automatiquement dès qu'un champ reçoit le focus. Le contour de focus est
 * géré globalement (`:focus-visible` dans `index.css`) et la bordure passe au
 * teal pour rester lisible sur un écran d'atelier.
 */
type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      'min-h-12 w-full rounded-xl border border-input bg-card px-3 py-2 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-teal disabled:bg-slate-100 disabled:text-slate-500',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
