/**
 * Composants Select — style cohérent avec le reste de l'application.
 * Implémentation légère sans dépendance externe (Radix).
 *
 * Usage :
 *   <Select defaultValue="us" onValueChange={(v) => setCountry(v)}>
 *     <SelectTrigger>
 *       <SelectValue />
 *     </SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value="us">États-Unis</SelectItem>
 *       <SelectItem value="fr">France</SelectItem>
 *     </SelectContent>
 *   </Select>
 */
import * as React from 'react'

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'defaultValue'> {
  defaultValue?: string
  onValueChange?: (value: string) => void
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, defaultValue, onValueChange, ...props }, ref) => {
    const [value, setValue] = React.useState(defaultValue ?? '')
    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value
      setValue(next)
      onValueChange?.(next)
    }
    return (
      <select
        ref={ref}
        defaultValue={defaultValue}
        value={value}
        onChange={handleChange}
        className={cn(
          'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-brand-teal disabled:bg-slate-100 cursor-pointer appearance-none',
          className,
        )}
        {...props}
      />
    )
  },
)
Select.displayName = 'Select'

const SelectTrigger = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-brand-teal disabled:bg-slate-100 flex items-center justify-between cursor-pointer',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
)
SelectTrigger.displayName = 'SelectTrigger'

const SelectValue = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, children, ...props }, ref) => (
  <span ref={ref} className={cn(className)} {...props}>
    {children}
  </span>
))
SelectValue.displayName = 'SelectValue'

const SelectContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'z-50 min-w-[200px] rounded-xl border border-slate-200 bg-white py-1 text-base shadow-lg outline-none',
      className,
    )}
    {...props}
  >
    {children}
  </div>
))
SelectContent.displayName = 'SelectContent'

const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value: string }
>(({ className, value, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-slate-100 focus:text-slate-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    data-value={value}
    {...props}
  >
    {children}
  </div>
))
SelectItem.displayName = 'SelectItem'

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
