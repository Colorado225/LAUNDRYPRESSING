import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Pastille de statut.
 *
 * Les variantes correspondent aux tons réellement utilisés dans l'application
 * (statuts de commande, alertes de stock, états de synchronisation). Les
 * couleurs sont volontairement pâles : un badge ne doit pas capter le regard
 * qu'un montant ou qu'une action.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-brand-navy text-white',
        secondary: 'border-slate-200 bg-slate-100 text-slate-700',
        outline: 'border-slate-300 bg-transparent text-slate-600',
        success: 'border-emerald-200 bg-emerald-100 text-emerald-800',
        warning: 'border-amber-200 bg-amber-100 text-amber-800',
        danger: 'border-rose-200 bg-rose-100 text-rose-800',
        info: 'border-sky-200 bg-sky-100 text-sky-800',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
