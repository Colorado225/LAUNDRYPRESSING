import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import {
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  CreditCard,
  History,
  LayoutDashboard,
  LifeBuoy,
  PlusCircle,
  ScanLine,
  Settings,
  Sparkles,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import AppHeader from '@/components/layout/AppHeader'
import AppSidebar, { type NavItem } from '@/components/layout/AppSidebar'
import DemoBanner from '@/components/layout/DemoBanner'
import SubscriptionBanner from '@/components/SubscriptionBanner'
import { TENANT_ROLE_LABELS } from '@/constants/orders'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { useTenantStore } from '@/lib/tenantContext'
import { can } from '@/lib/permissions'
import { signOut } from '@/services/authService'
import type { TenantRole } from '@/types/database'

/**
 * Coquille commune des écrans métier.
 *
 * Deux présentations, une seule liste de destinations :
 *
 *  - **à partir de 1024 px** (bureau, caisse, tablette paysage) : barre
 *    latérale fixe à gauche, en-tête avec recherche globale, contenu large ;
 *  - **en dessous** (tablette d'atelier, téléphone) : **menu hamburger** — un
 *    bouton ouvre un tiroir glissant contenant les mêmes onglets. Les onglets
 *    ne sont jamais étalés horizontalement : sur un petit écran, une liste
 *    horizontale scrollable masque les destinations et empiète sur le contenu.
 *
 * Les deux variantes partagent `AppSidebar` : une destination ajoutée apparaît
 * des deux côtés, sans risque d'oubli.
 *
 * Les entrées restent **filtrées par les permissions** (`can(role, …)`). La
 * maquette de référence montre neuf entrées fixes ; les afficher toutes
 * reviendrait à proposer des écrans que le serveur refusera. Le libellé
 * « Catalogue & Tarifs » de la maquette correspond à « Services & activités »,
 * seul référentiel de prix encore existant depuis la migration 020.
 */

/** Réexporté pour les écrans qui construisent leur propre menu (tests, docs). */
export type { NavItem }

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

  if (can(role, 'subscription.view')) {
    items.push({ to: '/abonnement', label: 'Abonnement', icon: CreditCard })
  }

  if (can(role, 'audit.view')) {
    items.push({ to: '/audit', label: 'Journal d’audit', icon: History })
  }

  if (can(role, 'support.contact')) {
    items.push({ to: '/support', label: 'Support', icon: LifeBuoy })
  }

  if (can(role, 'tenant.manage')) {
    items.push({ to: '/prestations', label: 'Services & activités', icon: Sparkles })
  }

  if (isPlatformAdmin) {
    items.push({ to: '/supervision', label: 'Supervision', icon: Building2 })
  }

  if (role) items.push({ to: '/parametres', label: 'Paramètres', icon: Settings })

  return items
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const prefersReducedMotion = usePrefersReducedMotion()
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
   * ouvert. La comparaison avec l'itinéraire courant se fait pendant le rendu
   * (motif React « adjusting state when a prop changes ») : un changement de
   * page ferme le tiroir immédiatement, sans effet ni ref.
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
    <div className="app-shell min-h-screen bg-background lg:flex">
      {/* ---------------------------- Barre latérale (bureau) ---------------- */}
      <aside className="app-sidebar sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <AppSidebar navigation={navigation} onSignOut={() => void handleSignOut()} />
      </aside>

      {/* ---------------------------- Contenu -------------------------------- */}
      <div className="min-w-0 flex-1">
        <header className="app-topbar sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
          <AppHeader
            tenantName={tenantName}
            libelleRole={libelleRole}
            menuOuvert={menu.ouvert}
            onOuvrirMenu={ouvrirMenu}
            onSignOut={() => void handleSignOut()}
          />
          <SubscriptionBanner />
        </header>

        <DemoBanner />

        {/* ---------------------------- Tiroir mobile -------------------------- */}
        {/*
          * Montage conditionnel : le tiroir n'existe dans le DOM que lorsqu'il est
          * ouvert. On a perdu l'animation de sortie de framer-motion (le nœud
          * disparaît au démontage), mais l'ouverture reste animée par CSS et
          * `prefers-reduced-motion` la neutralise. Sur une tablette d'atelier,
          * une fermeture instantanée est de toute façon plus sûre.
          */}
        {menu.ouvert && (
          <>
            <div
              className={`fixed inset-0 z-40 bg-slate-900/50 lg:hidden ${
                prefersReducedMotion ? '' : 'tiroir-fond-ouverture'
              }`}
              onClick={fermerMenu}
              aria-hidden
            />
            <aside
              className={`fixed left-0 top-0 z-50 flex h-screen w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-xl lg:hidden ${
                prefersReducedMotion ? '' : 'tiroir-panneau-ouverture'
              }`}
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
              <AppSidebar
                navigation={navigation}
                onSignOut={() => void handleSignOut()}
                onNavigate={fermerMenu}
              />
            </aside>
          </>
        )}

        {/*
          * Transition de page : `key` sur l'itinéraire force React à recréer
          * l'élément, ce qui rejoue l'animation d'entrée CSS à chaque navigation.
          */}
        <main
          key={location.pathname}
          className={`app-main mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 ${
            prefersReducedMotion ? '' : 'page-entree'
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
