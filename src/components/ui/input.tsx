/**
 * Input de saisie — style cohérent avec le reste de l'application
 * (min-h-12, border-slate-300, focus:border-brand-teal).
 *
 * Usage :
 *   <Input id="nom" type="text" placeholder="Chemise" />
 */
import * as React from 'react'

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>
const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-brand-teal disabled:bg-slate-100',
        className,
      )}
      {...props}
    />
  )
})
Input.displayName = 'Input'

export { Input }
