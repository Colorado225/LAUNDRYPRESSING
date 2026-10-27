import { Link } from 'react-router-dom'
import { ChevronDown, LogOut, Menu, Settings, Shirt, Wallet } from 'lucide-react'
import GlobalSearch from '@/components/layout/GlobalSearch'
import HeaderNotifications from '@/components/layout/HeaderNotifications'
import OfflineBadge from '@/components/OfflineBadge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isSupabaseConfigured } from '@/lib/env'

/**
 * En-tête commun aux trois écrans.
 *
 * Trois blocs : la recherche globale (ce qu'on fait le plus souvent au
 * comptoir), l'activité récente, et le compte connecté. Sur téléphone, la
 * recherche reste accessible et les actions secondaires passent dans le menu du
 * profil — l'en-tête ne doit jamais manger la hauteur utile d'un écran
 * d'atelier.
 *
 * Les liens de navigation restent exclusivement dans la barre latérale et dans
 * le tiroir : l'en-tête ne contient aucun `<nav>` (règle vérifiée par
 * `src/test/appLayout.test.tsx`).
 */
export default function AppHeader({
  tenantName,
  libelleRole,
  menuOuvert,
  onOuvrirMenu,
  onSignOut,
}: {
  tenantName: string | null
  libelleRole: string
  menuOuvert: boolean
  onOuvrirMenu: () => void
  onSignOut: () => void
}) {
  const initiales = (tenantName ?? 'PP')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((mot) => mot[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6">
      {/* Mobile : menu + identité */}
      <button
        type="button"
        onClick={onOuvrirMenu}
        aria-label="Ouvrir le menu"
        aria-expanded={menuOuvert}
        className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl border border-input text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
      >
        <Menu size={20} aria-hidden />
      </button>

      <Link to="/" className="flex shrink-0 items-center gap-2 lg:hidden" aria-label="Pressing Pro — accueil">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-navy text-brand-teal">
          <Shirt size={20} aria-hidden />
        </span>
      </Link>

      {/* Recherche globale */}
      <div className="min-w-0 flex-1 max-w-xl">
        <GlobalSearch />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="hidden sm:block">
          <OfflineBadge />
        </span>

        <HeaderNotifications />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Compte : ${tenantName ?? 'pressing non sélectionné'}, ${libelleRole}`}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-input bg-card px-2 pr-2.5 text-left transition-colors hover:bg-slate-50"
          >
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-amber text-xs font-bold text-white"
            >
              {initiales || 'PP'}
            </span>
            <span className="hidden min-w-0 leading-tight sm:block">
              <span className="block max-w-32 truncate text-xs font-bold text-brand-navy">
                {tenantName ?? 'Pressing'}
              </span>
              <span className="block text-[11px] text-slate-500">{libelleRole}</span>
            </span>
            <ChevronDown size={14} aria-hidden className="hidden text-slate-400 sm:block" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>{libelleRole}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/parametres">
                <Settings size={15} aria-hidden /> Paramètres
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/caisse">
                <Wallet size={15} aria-hidden /> Caisse
              </Link>
            </DropdownMenuItem>
            {isSupabaseConfigured && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="danger" onSelect={onSignOut}>
                  <LogOut size={15} aria-hidden /> Se déconnecter
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
