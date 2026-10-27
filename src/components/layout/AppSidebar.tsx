import type { ComponentType } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { LogOut, Shirt } from 'lucide-react'
import OfflineBadge from '@/components/OfflineBadge'
import ShopSwitcher from '@/components/ShopSwitcher'
import SubscriptionCard from '@/components/layout/SubscriptionCard'
import { TENANT_ROLE_LABELS } from '@/constants/orders'
import { isSupabaseConfigured } from '@/lib/env'
import { useTenantStore } from '@/lib/tenantContext'
import type { TenantRole } from '@/types/database'

/**
 * Barre latérale de l'application (bureau) et contenu du tiroir (mobile).
 *
 * Un seul composant pour les deux présentations : une destination ajoutée au
 * menu apparaît des deux côtés, sans risque d'oubli. Les entrées restent
 * **pilotées par les permissions** (`buildNavigation` dans `AppLayout`) et non
 * par une liste figée : un artisan ne voit pas la caisse, un réceptionniste ne
 * voit pas le tableau de bord. La maquette montrait neuf entrées fixes ; c'est
 * le seul point où la structure du produit ne peut pas la suivre sans retirer
 * un contrôle d'accès.
 */

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
  end?: boolean
  /** Compteur affiché à droite de l'entrée (ex. commandes en attente). */
  compteur?: number
}

interface AppSidebarProps {
  navigation: NavItem[]
  onSignOut: () => void
  /** Ferme le tiroir mobile après un clic sur une destination. */
  onNavigate?: () => void
}

function initiales(nom: string | null | undefined): string {
  if (!nom) return 'PP'
  const mots = nom.trim().split(/\s+/).slice(0, 2)
  return mots.map((mot) => mot[0]?.toUpperCase() ?? '').join('') || 'PP'
}

export default function AppSidebar({ navigation, onSignOut, onNavigate }: AppSidebarProps) {
  const tenantName = useTenantStore((state) => state.tenantName)
  const role = useTenantStore((state) => state.role)

  const lienClasse = ({ isActive }: { isActive: boolean }) =>
    `app-nav-link flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
      isActive
        ? 'bg-accent text-accent-foreground shadow-[inset_3px_0_0_0_var(--color-brand-teal)]'
        : 'text-slate-600 hover:bg-slate-100 hover:text-brand-navy'
    }`

  return (
    <>
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-navy text-brand-teal">
          <Shirt size={22} aria-hidden />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-bold text-brand-navy">Pressing Pro</span>
          <span className="block text-xs text-slate-500">Pressing &amp; Blanchisserie</span>
        </span>
      </Link>

      <nav aria-label="Navigation principale" className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {navigation.map(({ to, label, icon: Icone, end, compteur }) => (
          <NavLink key={to} to={to} end={end} className={lienClasse} onClick={onNavigate}>
            <Icone size={18} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {compteur !== undefined && compteur > 0 && (
              <span className="rounded-full bg-brand-teal px-1.5 py-0.5 text-[11px] font-bold text-white">
                {compteur}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 border-t border-slate-200 p-3">
        <SubscriptionCard />
        <div className="flex items-center gap-2.5 rounded-xl px-1 py-1">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-amber text-sm font-bold text-white"
          >
            {initiales(tenantName)}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-xs font-semibold text-brand-navy">
              {tenantName ?? 'Pressing non sélectionné'}
            </span>
            <span className="block text-[11px] text-slate-500">
              {role ? TENANT_ROLE_LABELS[role as TenantRole] : 'Rôle inconnu'}
            </span>
          </span>
        </div>
        <ShopSwitcher />
        <OfflineBadge />
        {isSupabaseConfigured && (
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100"
          >
            <LogOut size={16} aria-hidden />
            Quitter
          </button>
        )}
      </div>
    </>
  )
}
