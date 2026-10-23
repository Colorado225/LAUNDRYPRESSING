import { Link } from 'react-router-dom'
import { AlertTriangle, Info, Lock } from 'lucide-react'
import { useSubscriptionStore } from '@/lib/subscriptionContext'
import { subscriptionNotice } from '@/services/subscriptionService'
import { useTenantStore } from '@/lib/tenantContext'
import { can } from '@/lib/permissions'

/** Date du jour au format `AAAA-MM-JJ`, en heure locale. */
function aujourdHui(): string {
  const maintenant = new Date()
  const mois = `${maintenant.getMonth() + 1}`.padStart(2, '0')
  const jour = `${maintenant.getDate()}`.padStart(2, '0')
  return `${maintenant.getFullYear()}-${mois}-${jour}`
}

/**
 * Bandeau d'abonnement (palier 4).
 *
 * Trois tons : information (essai, échéance proche), alerte (période de grâce)
 * et blocage (échu, suspendu). En blocage, l'application reste utilisable en
 * lecture : c'est le serveur qui refuse les écritures, ce bandeau explique
 * simplement pourquoi.
 */
export default function SubscriptionBanner() {
  const snapshot = useSubscriptionStore((state) => state.snapshot)
  const role = useTenantStore((state) => state.role)
  const notice = subscriptionNotice(snapshot, aujourdHui())

  if (!notice) return null

  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    alerte: 'border-amber-300 bg-amber-50 text-amber-900',
    blocage: 'border-rose-300 bg-rose-50 text-rose-900',
  }[notice.tone]

  const Icone = notice.tone === 'blocage' ? Lock : notice.tone === 'alerte' ? AlertTriangle : Info

  return (
    <div className={`border-b ${styles}`} role="status">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2 text-sm sm:px-6">
        <Icone size={16} className="shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">{notice.text}</p>
        {can(role, 'subscription.view') && (
          <Link
            to="/abonnement"
            className="shrink-0 rounded-lg border border-current px-2.5 py-1 text-xs font-bold"
          >
            Voir l’abonnement
          </Link>
        )}
      </div>
    </div>
  )
}
