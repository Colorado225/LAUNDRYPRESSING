import { Link } from 'react-router-dom'
import { Crown } from 'lucide-react'
import { useSubscriptionStore } from '@/lib/subscriptionContext'
import { useTenantStore } from '@/lib/tenantContext'
import { can } from '@/lib/permissions'
import { isReadOnly, todayIso, daysLeft } from '@/services/subscriptionService'

/**
 * Carte d'abonnement en bas de la barre latérale.
 *
 * La maquette affichait « Formule Pro — Votre abonnement est actif » en dur.
 * Ici, le texte vient de l'état réel de l'abonnement (`useSubscriptionStore`) :
 *
 *  - formule connue → son nom et son échéance ;
 *  - état illisible (hors ligne au premier lancement) → « non renseigné »,
 *    jamais un « actif » inventé ;
 *  - abonnement échu → ton d'alerte, l'écriture étant de toute façon refusée
 *    par le serveur.
 *
 * Aucun chiffre n'est fabriqué : un abonnement inconnu affiche une invite à
 * vérifier, pas une fausse sérénité.
 */
export default function SubscriptionCard() {
  const snapshot = useSubscriptionStore((state) => state.snapshot)
  const role = useTenantStore((state) => state.role)
  const peutVoir = can(role, 'subscription.view')

  const echeance = snapshot?.current_period_end
  const restant = echeance ? daysLeft(echeance, todayIso()) : null
  const bloque = isReadOnly(snapshot)

  const ton = bloque
    ? 'border-rose-200 bg-rose-50'
    : restant !== null && restant <= 7
      ? 'border-amber-200 bg-amber-50'
      : 'border-slate-200 bg-slate-50'

  const titre = snapshot?.plan_name ?? 'Formule non renseignée'
  const sousTitre = bloque
    ? 'Abonnement échu — écriture bloquée'
    : restant === null
      ? snapshot
        ? 'Abonnement actif'
        : 'À vérifier en ligne'
      : restant <= 0
        ? 'Échéance atteinte'
        : `Renouvellement dans ${restant} jour${restant > 1 ? 's' : ''}`

  const contenu = (
    <>
      <span className="flex min-w-0 items-start gap-2">
        <Crown size={16} aria-hidden className={bloque ? 'mt-0.5 text-rose-600' : 'mt-0.5 text-brand-amber'} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-xs font-bold text-brand-navy">{titre}</span>
          <span className="block text-[11px] text-slate-600">{sousTitre}</span>
        </span>
      </span>
      <span
        aria-hidden
        className={`mt-1 size-2 shrink-0 rounded-full ${bloque ? 'bg-rose-500' : 'bg-emerald-500'}`}
      />
    </>
  )

  if (!peutVoir) {
    return (
      <div className={`flex items-start justify-between gap-2 rounded-xl border p-2.5 ${ton}`}>
        {contenu}
      </div>
    )
  }

  return (
    <Link
      to="/abonnement"
      className={`flex items-start justify-between gap-2 rounded-xl border p-2.5 transition-colors hover:bg-white ${ton}`}
      aria-label={`Abonnement : ${titre} — ${sousTitre}`}
    >
      {contenu}
    </Link>
  )
}
