import type { ComponentType, ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  CreditCard,
  History,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  PlusCircle,
  ScanLine,
  Settings,
  Shirt,
  Tag,
  Users,
  Wallet,
} from 'lucide-react'
import toast from 'react-hot-toast'
import OfflineBadge from './OfflineBadge'
import ShopSwitcher from './ShopSwitcher'
import SubscriptionBanner from './SubscriptionBanner'
import { TENANT_ROLE_LABELS } from '@/constants/orders'
import { isSupabaseConfigured } from '@/lib/env'
import { useTenantStore } from '@/lib/tenantContext'
import { can } from '@/lib/permissions'
import { signOut } from '@/services/authService'
import type { TenantRole } from '@/types/database'

/**
 * Coquille commune des écrans métier.
 *
 * Deux présentations, une seule liste de destinations :
 *
 *  - **à partir de 1024 px** (bureau, caisse) : barre latérale fixe à gauche,
 *    fond gris clair, cartes blanches au centre. C'est la disposition attendue
 *    d'un logiciel de gestion ;
 *  - **en dessous** (tablette d'atelier, téléphone) : la barre latérale
 *    disparaît au profit des onglets horizontaux, avec des cibles tactiles de
 *    48 px. Un menu caché derrière un bouton coûterait un geste à chaque
 *    changement d'écran, sur un appareil utilisé debout, parfois avec des
 *    gants.
 *
 * Les deux variantes partagent `buildNavigation` : une destination ajoutée
 * apparaît des deux côtés, sans risque d'oubli.
 */

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
  /** Correspondance exacte de l'URL (évite que `/commandes` reste actif sur `/commandes/nouvelle`). */
  end?: boolean
}

/** Destinations visibles selon le rôle et les droits de supervision. */
function buildNavigation(role: TenantRole | null, isPlatformAdmin: boolean): NavItem[] {
  const items: NavItem[] = [
    { to: '/commandes', label: 'Commandes', icon: ClipboardList, end: true },
  ]

  if (can(role, 'orders.create')) {
    items.push({ to: '/commandes/nouvelle', label: 'Nouvelle commande', icon: PlusCircle })
  }

  items.push({ to: '/atelier', label: 'Atelier', icon: ScanLine })

  if (can(role, 'cash.manage')) {
    items.push({ to: '/caisse', label: 'Caisse', icon: Wallet })
  }

  if (can(role, 'dashboard.view')) {
    items.push({ to: '/tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard })
    items.push({ to: '/rapports', label: 'Rapports', icon: BarChart3 })
  }

  if (can(role, 'customers.manage')) {
    items.push({ to: '/clients', label: 'Clients', icon: Users })
  }

  if (can(role, 'stock.move')) {
    items.push({ to: '/stock', label: 'Stock', icon: Boxes })
  }

  if (can(role, 'expenses.manage')) {
    items.push({ to: '/depenses', label: 'Dépenses', icon: Wallet })
  }

  if (can(role, 'catalog.manage')) {
    items.push({ to: '/catalogue', label: 'Prestations', icon: Tag })
  }

  if (can(role, 'subscription.view')) {
    items.push({ to: '/abonnement', label: 'Abonnement', icon: CreditCard })
  }

  if (can(role, 'audit.view')) {
    items.push({ to: '/audit', label: 'Journal d’audit', icon: History })
  }

  if (can(role, 'support.contact')) {
    items.push({ to: '/support', label: 'Support', icon: LifeBuoy })
  }

  if (isPlatformAdmin) {
    items.push({ to: '/supervision', label: 'Supervision', icon: Building2 })
  }

  items.push({ to: '/parametres', label: 'Paramètres', icon: Settings })

  return items
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const tenantName = useTenantStore((state) => state.tenantName)
  const role = useTenantStore((state) => state.role)
  const isPlatformAdmin = useTenantStore((state) => state.isPlatformAdmin)
  const navigation = buildNavigation(role, isPlatformAdmin)

  const handleSignOut = async () => {
    // Confirmation obligatoire : sur une tablette partagée, une déconnexion
    // accidentelle coupe l'accès de tout l'atelier.
    const confirmed = window.confirm(
      'Se déconnecter ? Les commandes non synchronisées resteront sur cette tablette.',
    )
    if (!confirmed) return

    try {
      await signOut()
    } catch {
      toast.error('Déconnexion impossible : vérifiez votre connexion.')
    }
  }

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-12 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${
      isActive
        ? 'bg-brand-teal text-white'
        : 'text-slate-600 hover:bg-slate-100 hover:text-brand-navy'
    }`

  const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
      isActive
        ? 'bg-brand-teal/10 text-brand-navy shadow-[inset_3px_0_0_0_var(--color-brand-teal)]'
        : 'text-slate-600 hover:bg-slate-100 hover:text-brand-navy'
    }`

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* ---------------------------- Barre latérale (bureau) ---------------- */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <Link to="/commandes" className="flex items-center gap-2.5 px-4 py-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-navy text-brand-teal">
            <Shirt size={22} aria-hidden />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold text-brand-navy">Pressing Pro</span>
            <span className="block text-xs text-slate-500">
              {tenantName ?? 'Pressing non sélectionné'}
            </span>
          </span>
        </Link>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {navigation.map(({ to, label, icon: Icone, end }) => (
            <NavLink key={to} to={to} end={end} className={sidebarLinkClass}>
              <Icone size={18} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <ShopSwitcher />
          <p className="mt-2 px-1 text-xs text-slate-500">
            {role ? TENANT_ROLE_LABELS[role] : 'Rôle inconnu'}
          </p>
          <div className="mt-2">
            <OfflineBadge />
          </div>
          {isSupabaseConfigured && (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="mt-2 inline-flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              <LogOut size={16} aria-hidden />
              Quitter
            </button>
          )}
        </div>
      </aside>

      {/* ---------------------------- Contenu -------------------------------- */}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            {/* Identité : masquée sur bureau, la barre latérale la porte déjà. */}
            <Link to="/commandes" className="flex items-center gap-2.5 lg:hidden">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-navy text-brand-teal">
                <Shirt size={22} aria-hidden />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-bold text-brand-navy">Pressing Pro</span>
                <span className="block text-xs text-slate-500">
                  {tenantName ?? 'Pressing non sélectionné'}
                  {role && ` · ${TENANT_ROLE_LABELS[role]}`}
                </span>
              </span>
            </Link>

            {/* Rappel du contexte en bureau : le nom du pressing et le rôle
                restent visibles même quand on fait défiler. */}
            <p className="hidden text-sm font-semibold text-slate-600 lg:block">
              {tenantName ?? 'Pressing non sélectionné'}
              {role && (
                <span className="ml-2 text-xs font-medium text-slate-400">
                  {TENANT_ROLE_LABELS[role]}
                </span>
              )}
            </p>

            <div className="flex items-center gap-2">
              <span className="lg:hidden">
                <ShopSwitcher />
              </span>
              <span className="lg:hidden">
                <OfflineBadge />
              </span>

              {isSupabaseConfigured && (
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  title={
                    role ? `Se déconnecter (${TENANT_ROLE_LABELS[role]})` : 'Se déconnecter'
                  }
                  className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-600 transition-colors active:bg-slate-100 lg:hidden"
                >
                  <LogOut size={16} aria-hidden />
                  <span className="hidden sm:inline">Quitter</span>
                </button>
              )}
            </div>
          </div>

          {/* Onglets : uniquement sous 1024 px. */}
          <nav className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 pb-3 sm:px-6 lg:hidden">
            {navigation.map(({ to, label, icon: Icone, end }) => (
              <NavLink key={to} to={to} end={end} className={mobileLinkClass}>
                <Icone size={18} aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>

          <SubscriptionBanner />
        </header>

        <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  )
}
