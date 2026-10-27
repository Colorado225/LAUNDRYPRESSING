import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Bouton — implémentation shadcn/ui adaptée à l'identité du produit.
 *
 * Deux écarts assumés par rapport au shadcn d'origine :
 *
 *  1. **`min-h-12` (48 px) par défaut** : les écrans sont utilisés au doigt sur
 *     une tablette d'atelier ; 36 px est une cible trop petite.
 *  2. **`danger` au lieu de `destructive`** : les appelants existants
 *     (`Clients.tsx`) utilisent déjà ce nom, et une variante renommée serait
 *     une régression silencieuse.
 *
 * `asChild` permet de rendre un lien (`<Button asChild><Link …/></Button>`)
 * sans imbriquer un `<button>` dans un `<a>`.
 */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-brand-teal-dark',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-slate-200',
        outline: 'border border-input bg-card text-slate-700 hover:bg-slate-50',
        ghost: 'text-slate-600 hover:bg-slate-100 hover:text-brand-navy',
        danger: 'bg-destructive text-destructive-foreground hover:bg-rose-700',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'min-h-9 px-3 text-xs',
        default: 'min-h-12 px-4',
        lg: 'min-h-14 px-6 text-base',
        icon: 'size-12 shrink-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Composant = asChild ? Slot : 'button'
    return (
      <Composant
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
