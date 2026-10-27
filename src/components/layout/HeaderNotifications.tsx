import { useState } from 'react'
import { Bell, MessageCircle, Phone } from 'lucide-react'
import { useRecentNotifications } from '@/db/hooks'
import { formatDateTimeFr } from '@/lib/formatters'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Cloche de notifications de l'en-tête.
 *
 * La source est le journal local des sollicitations clients
 * (`notifications` dans Dexie, écrit par `NotifyPanel`) : chaque entrée
 * correspond à un message WhatsApp ou à un appel **réellement passé** depuis
 * l'application, pas à une intention.
 *
 * Le compteur ne compte que les dernières 24 h : une pastille qui ne descend
 * jamais ne veut plus rien dire au bout d'une semaine.
 */
export default function HeaderNotifications() {
  const notifications = useRecentNotifications(40)
  // Seuil figé à l'ouverture de l'écran : recalculer `Date.now()` à chaque
  // rendu ferait clignoter le compteur sans qu'aucune notification n'arrive.
  const [limite] = useState(() => Date.now() - 24 * 60 * 60 * 1000)
  const recentes = notifications.filter((entree) => new Date(entree.createdAt).getTime() >= limite)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={
          recentes.length > 0
            ? `Notifications, ${recentes.length} sur les dernières 24 heures`
            : 'Notifications'
        }
        className="relative inline-flex size-12 items-center justify-center rounded-xl border border-input bg-card text-slate-600 transition-colors hover:bg-slate-50"
      >
        <Bell size={18} aria-hidden />
        {recentes.length > 0 && (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white"
          >
            {recentes.length > 9 ? '9+' : recentes.length}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Activité des dernières 24 h</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recentes.length === 0 ? (
          <p className="px-2.5 py-3 text-sm text-slate-500">
            Aucun client prévenu depuis hier. Les relances apparaissent ici dès qu’un message
            WhatsApp est ouvert depuis une fiche de commande.
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto">
            {recentes.slice(0, 8).map((entree) => (
              <li key={entree.id} className="flex items-start gap-2 px-2.5 py-2 text-sm">
                <span aria-hidden className="mt-0.5 text-slate-400">
                  {entree.channel === 'whatsapp' ? <MessageCircle size={15} /> : <Phone size={15} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-800">
                    {entree.customerName}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {entree.channel === 'whatsapp' ? 'WhatsApp' : 'Appel'} ·{' '}
                    {formatDateTimeFr(entree.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
