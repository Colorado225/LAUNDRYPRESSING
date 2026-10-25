/**
 * Composants de regroupement et de label de champ — inspiré de shadcn/ui,
 * adapté à l'application Pressing Pro (français, Tailwind v4).
 *
 * Usage :
 *   <Field>
 *     <FieldLabel htmlFor="email">E-mail</FieldLabel>
 *     <Input id="email" type="email" />
 *   </Field>
 *
 *   <FieldGroup>
 *     <Field>…</Field>
 *     <Field>…</Field>
 *   </FieldGroup>
 */
import * as React from 'react'

const Field = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('space-y-1', className)} {...props} />
))
Field.displayName = 'Field'

const FieldGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('grid gap-4 sm:grid-cols-2', className)} {...props} />
))
FieldGroup.displayName = 'FieldGroup'

const FieldLabel = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn('text-xs font-semibold text-slate-600', className)} {...props} />
))
FieldLabel.displayName = 'FieldLabel'

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export { Field, FieldGroup, FieldLabel }
