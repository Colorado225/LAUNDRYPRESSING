/**
 * Label de champ — utilisé par FieldLabel.
 * Style cohérent avec le reste de l'application (texte-slate-600, xs).
 */
import * as React from 'react'

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn('text-xs font-semibold text-slate-600', className)} {...props} />
))
Label.displayName = 'Label'

export { Label }
