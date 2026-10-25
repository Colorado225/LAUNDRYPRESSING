/**
 * Bouton d'action — style cohérent avec le reste de l'application.
 *
 * Variantes :
 *   default   — teal (action principale)
 *   outline   — bordure slate (action secondaire)
 *   danger    — rose (suppression)
 *   ghost     — texte seul (action discrète)
 *
 * Usage :
 *   <Button>Valider</Button>
 *   <Button variant="outline">Annuler</Button>
 *   <Button variant="danger" disabled>Supprimer</Button>
 */
import * as React from 'react'

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

type Variant = 'default' | 'outline' | 'danger' | 'ghost'
type Size = 'default' | 'sm' | 'lg'

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variants: Record<Variant, string> = {
  default: 'bg-brand-teal text-white hover:bg-brand-teal-dark',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  ghost: 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
}

const sizes: Record<Size, string> = {
  default: 'px-4 py-2',
  sm: 'px-3 py-1.5 text-xs',
  lg: 'px-6 py-3 text-base',
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', disabled, ...props }, ref) => {
    const base =
      'inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-sm font-bold outline-none disabled:opacity-50 disabled:pointer-events-none'

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button }
