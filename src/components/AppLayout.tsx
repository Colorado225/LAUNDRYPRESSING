import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ClipboardList, LogOut, PlusCircle, ScanLine, Shirt } from 'lucide-react'
import toast from 'react-hot-toast'
import OfflineBadge from './OfflineBadge'
import { TENANT_ROLE_LABELS } from '@/constants/orders'
import { isSupabaseConfigured } from '@/lib/env'
import { useTenantStore } from '@/lib/tenantContext'
import { signOut } from '@/services/authService'

/**
 * Coquille commune des écrans métier.
 *
 * Cible : tablette d'atelier. Barre supérieure compacte, navigation par
 * onglets avec des cibles tactiles d'au moins 48 px de haut.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const tenantName = useTenantStore((state) => state.tenantName)
  const role = useTenantStore((state) => state.role)

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

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-12 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${
      isActive
        ? 'bg-brand-teal text-white'
        : 'text-slate-600 hover:bg-slate-100 hover:text-brand-navy'
    }`

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/commandes" className="flex items-center gap-2.5">
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

          <div className="flex items-center gap-2">
            <OfflineBadge />

            {isSupabaseConfigured && (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                title={
                  role
                    ? `Se déconnecter (${TENANT_ROLE_LABELS[role]})`
                    : 'Se déconnecter'
                }
                className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-600 transition-colors active:bg-slate-100"
              >
                <LogOut size={16} aria-hidden />
                <span className="hidden sm:inline">Quitter</span>
              </button>
            )}
          </div>
        </div>

        <nav className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
          <NavLink to="/commandes" end className={navLinkClass}>
            <ClipboardList size={18} aria-hidden />
            Commandes
          </NavLink>
          <NavLink to="/commandes/nouvelle" className={navLinkClass}>
            <PlusCircle size={18} aria-hidden />
            Nouvelle commande
          </NavLink>
          <NavLink to="/atelier" className={navLinkClass}>
            <ScanLine size={18} aria-hidden />
            Atelier
          </NavLink>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">{children}</main>
    </div>
  )
}
