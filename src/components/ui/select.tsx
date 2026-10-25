/**
 * Composants Select — style cohérent avec le reste de l'application.
 * Implémentation légère : un `<select>` natif dont les options sont
 * extraites des enfants `<SelectItem>` (restitués comme `<option>`).
 *
 * Usage contrôlé (la valeur vient du parent) :
 *   <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
 *     <SelectItem value="FIXED">Prix fixe</SelectItem>
 *   </Select>
 *
 * Usage non contrôlé :
 *   <Select defaultValue="fr" onValueChange={...}>
 *     <SelectItem value="fr">France</SelectItem>
 *   </Select>
 *
 * Pourquoi un `<select>` natif et non un widget personnalisé : l'application
 * est conçue pour des tablettes Android parfois hors ligne — le menu système
 * reste utilisable sans JS, gère le clavier et la voix, et son comportement
 * est connu des utilisateurs.
 *
 * Les composants décoratifs `SelectTrigger`, `SelectValue` et `SelectContent`
 * sont conservés pour la compatibilité d'API, mais ne produisent plus aucun
 * nœud DOM : le `<select>` assure seul l'affichage et l'interaction. Un
 * `<select>` ne peut contenir que des `<option>` : y placer des `<div>` (comme
 * dans l'implémentation précédente) rendait le menu vide et la saisie
 * impossible, sans générer d'erreur visible.
 */
import * as React from 'react'
import { ChevronDown } from 'lucide-react'

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

interface SelectProps
  extends Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    'size' | 'defaultValue' | 'value' | 'onChange'
  > {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, defaultValue, value: valueProp, onValueChange, children, ...props }, ref) => {
    const [interne, setInterne] = React.useState(defaultValue ?? '')
    const estControle = valueProp !== undefined
    const valeur = estControle ? (valueProp as string) : interne

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      if (!estControle) setInterne(event.target.value)
      onValueChange?.(event.target.value)
    }

    return (
      <div className="relative">
        <select
          ref={ref}
          value={valeur}
          onChange={handleChange}
          className={cn(
            'min-h-12 w-full appearance-none rounded-xl border border-slate-300 bg-white pl-3 pr-9 text-base text-slate-900 outline-none focus:border-brand-teal disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer',
            className,
          )}
          {...props}
        >
          {optionsDepuis(children)}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
      </div>
    )
  },
)
Select.displayName = 'Select'

/**
 * Extrait les éléments `<option>` d'un arbre d'enfants : les `SelectItem`
 * sont collectés où qu'ils soient dans la hiérarchie, les autres éléments
 * (comme `SelectContent`, conservé pour la compatibilité) sont descendus
 * jusqu'à trouver des `SelectItem`.
 */
function optionsDepuis(children: React.ReactNode): React.ReactNode[] {
  const options: React.ReactNode[] = []
  React.Children.forEach(children, (enfant) => {
    if (!React.isValidElement(enfant)) return
    const props = enfant.props as { value?: string; children?: React.ReactNode }
    if (enfant.type === SelectItem) {
      options.push(enfant)
    } else {
      options.push(...optionsDepuis(props.children))
    }
  })
  return options
}

interface SelectItemProps {
  value: string
  children: React.ReactNode
}

const SelectItem = React.forwardRef<HTMLOptionElement, SelectItemProps>(
  ({ value, children }, ref) => (
    <option ref={ref} value={value}>
      {children}
    </option>
  ),
)
SelectItem.displayName = 'SelectItem'

/** Compatibilité d'API : ne produit plus de nœud DOM. */
const SelectTrigger = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(() => null)
SelectTrigger.displayName = 'SelectTrigger'

const SelectValue = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(() => null)
SelectValue.displayName = 'SelectValue'

const SelectContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(() => null)
SelectContent.displayName = 'SelectContent'

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
