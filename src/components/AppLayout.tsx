import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  CreditCard,
  History,
  LayoutDashboard,
  Layers3,
  LifeBuoy,
  LogOut,
  Menu,
  PlusCircle,
  ScanLine,
  Settings,
  Shirt,
  Tag,
  Users,
  Wallet,
  X,
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
 *  - **en dessous** (tablette d'atelier, téléphone) : **menu hamburger** —
 *    un bouton ouvre un tiroir (sidebar) glissant contenant les mêmes
 *    onglets. Les onglets ne sont jamais étalés horizontalement : sur un
 *    petit écran, une liste horizontale scrollable masque les destinations
 *    et empiète sur le contenu.
 *
 * Les deux variantes partagent `buildNavigation` et `ContenuBarre` : une
 * destination ajoutée apparaît des deux côtés, sans risque d'oubli.
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
    items.push({ to: '/catalogue', label: 'Catalogue', icon: Tag })
    items.push({ to: '/modeles-commerciaux', label: 'Modèles commerciaux', icon: Layers3 })
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

  if (role) items.push({ to: '/parametres', label: 'Paramètres', icon: Settings })

  return items
}

/**
 * Contenu de la barre de navigation, partagé par la barre latérale (bureau)
 * et le tiroir (mobile) : marque, onglets, contexte du pressing et déconnexion.
 */
function ContenuBarre({
  navigation,
  libelleRole,
  onSignOut,
}: {
  navigation: NavItem[]
  libelleRole: string
  onSignOut: () => void
}) {
  const tenantName = useTenantStore((state) => state.tenantName)
  const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
    `app-nav-link flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
      isActive
        ? 'bg-brand-teal/10 text-brand-navy shadow-[inset_3px_0_0_0_var(--color-brand-teal)]'
        : 'text-slate-600 hover:bg-slate-100 hover:text-brand-navy'
    }`

  return (
    <>
      <Link to="/" className="flex items-center gap-2.5 px-4 py-4">
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
          {libelleRole}
        </p>
        <div className="mt-2">
          <OfflineBadge />
        </div>
        {isSupabaseConfigured && (
          <button
            type="button"
            onClick={onSignOut}
            className="mt-2 inline-flex min-h-12 w-full items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100"
          >
            <LogOut size={16} aria-hidden />
            Quitter
          </button>
        )}
      </div>
    </>
  )
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const prefersReducedMotion = useReducedMotion()
  const tenantName = useTenantStore((state) => state.tenantName)
  const role = useTenantStore((state) => state.role)
  const isPlatformAdmin = useTenantStore((state) => state.isPlatformAdmin)
  const libelleRole = role
    ? TENANT_ROLE_LABELS[role]
    : isPlatformAdmin
      ? 'Administrateur de la plateforme'
      : 'Rôle inconnu'
  const navigation = buildNavigation(role, isPlatformAdmin)
  /**
   * État du tiroir : il ne peut rester ouvert que sur la route où on l'a
   * ouvert. La comparaison avec l'itinéraire courant se fait pendant le
   * rendu (motif React « adjusting state when a prop changes ») : un
   * changement de page ferme le tiroir immédiatement, sans effet ni ref.
   */
  const [menu, setMenu] = useState<{ ouvert: boolean; chemin: string }>({
    ouvert: false,
    chemin: location.pathname,
  })

  if (menu.ouvert && menu.chemin !== location.pathname) {
    setMenu({ ouvert: false, chemin: location.pathname })
  }

  const ouvrirMenu = () => setMenu({ ouvert: true, chemin: location.pathname })
  const fermerMenu = () => setMenu((etat) => ({ ...etat, ouvert: false }))

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

  // Échappement ferme le tiroir (clavier ou écran tactile).
  useEffect(() => {
    if (!menu.ouvert) return
    const quitter = (event: KeyboardEvent) => {
      if (event.key === 'Escape') fermerMenu()
    }
    window.addEventListener('keydown', quitter)
    return () => window.removeEventListener('keydown', quitter)
  }, [menu.ouvert])

  return (
    <div className="app-shell min-h-screen bg-slate-50 lg:flex">
      {/* ---------------------------- Barre latérale (bureau) ---------------- */}
      <aside className="app-sidebar sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <ContenuBarre
          navigation={navigation}
          libelleRole={libelleRole}
          onSignOut={() => void handleSignOut()}
        />
      </aside>

      {/* ---------------------------- Contenu -------------------------------- */}
      <div className="min-w-0 flex-1">
        <header className="app-topbar sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            {/* Mobile : bouton menu + identité. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={ouvrirMenu}
                aria-label="Ouvrir le menu"
                aria-expanded={menu.ouvert}
                className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-slate-300 text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
              >
                <Menu size={20} aria-hidden />
              </button>
              <Link to="/" className="flex items-center gap-2.5 lg:hidden">
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-navy text-brand-teal">
                  <Shirt size={22} aria-hidden />
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-bold text-brand-navy">Pressing Pro</span>
                  <span className="block text-xs text-slate-500">
                    {tenantName ?? 'Pressing non sélectionné'}
                    {(role || isPlatformAdmin) && ` · ${libelleRole}`}
                  </span>
                </span>
              </Link>
            </div>

            {/* Rappel du contexte en bureau : le nom du pressing et le rôle
                restent visibles même quand on fait défiler. */}
            <p className="hidden text-sm font-semibold text-slate-600 lg:block">
              {tenantName ?? 'Pressing non sélectionné'}
              {(role || isPlatformAdmin) && (
                <span className="ml-2 text-xs font-medium text-slate-400">{libelleRole}</span>
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
                  title={`Se déconnecter (${libelleRole})`}
                  className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-600 transition-colors active:bg-slate-100 lg:hidden"
                >
                  <LogOut size={16} aria-hidden />
                  <span className="hidden sm:inline">Quitter</span>
                </button>
              )}
            </div>
          </div>

          <SubscriptionBanner />
        </header>

        {/* ---------------------------- Tiroir mobile -------------------------- */}
        <AnimatePresence>
          {menu.ouvert && (
            <>
              <motion.div
                className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
                onClick={fermerMenu}
                aria-hidden
              />
              <motion.aside
                className="fixed left-0 top-0 z-50 flex h-screen w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white shadow-xl lg:hidden"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{
                  duration: prefersReducedMotion ? 0 : 0.22,
                  ease: [0.22, 1, 0.36, 1],
                }}
                role="dialog"
                aria-modal="true"
                aria-label="Menu de navigation"
              >
                <button
                  type="button"
                  onClick={fermerMenu}
                  aria-label="Fermer le menu"
                  className="absolute right-2 top-3 z-10 inline-flex size-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X size={18} aria-hidden />
                </button>
                <ContenuBarre
                  navigation={navigation}
                  libelleRole={libelleRole}
                  onSignOut={() => void handleSignOut()}
                />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={location.pathname}
            className="app-main mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  )
}
