import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, CloudOff, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { usePendingOrderCount } from '@/db/hooks'

/**
 * Écran de repli hors ligne (phase 5).
 *
 * Le service worker précache la coquille de l'application : en mode avion, les
 * écrans s'ouvrent normalement. Cette page sert de point de repère explicite
 * quand une action **nécessite** le réseau (paiement Mobile Money, connexion
 * d'un nouveau compte) : elle explique ce qui reste possible et ce qui attend
 * le retour de la connexion.
 *
 * Elle affiche aussi la file d'attente locale, pour que le réceptionniste sache
 * que rien n'est perdu.
 */

const AVAILABLE_OFFLINE = [
  'Consulter, créer et faire avancer les commandes déjà présentes sur la tablette',
  'Scanner les étiquettes QR en atelier',
  'Imprimer une étiquette de commande',
]

const NEEDS_NETWORK = [
  'Payer par Mobile Money (guichet CinetPay)',
  'Envoyer les commandes en attente vers le serveur',
  'Se connecter avec un nouveau compte',
]

export default function Offline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const pendingCount = usePendingOrderCount()

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const handleRetry = () => {
    // Un rechargement est volontaire : il rejoue les requêtes de démarrage
    // (restauration de session, synchronisation) que la page en cours a pu
    // abandonner au moment de la coupure.
    window.location.reload()
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <span
          className={`inline-flex size-12 items-center justify-center rounded-2xl ${
            online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {online ? <Wifi size={24} aria-hidden /> : <CloudOff size={24} aria-hidden />}
        </span>

        <h1 className="mt-4 text-xl font-bold text-brand-navy">
          {online ? 'La connexion est revenue' : 'Vous êtes hors ligne'}
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {online
            ? 'Vous pouvez reprendre le travail normalement. Les commandes en attente sont envoyées automatiquement.'
            : 'Le pressing continue de fonctionner : les commandes saisies maintenant sont enregistrées sur cette tablette et partiront dès le retour du réseau.'}
        </p>

        {pendingCount > 0 && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">
            <RefreshCw size={16} className="mt-0.5 shrink-0" aria-hidden />
            {pendingCount} commande{pendingCount > 1 ? 's' : ''} en attente d’envoi. Rien n’est
            perdu : la synchronisation est automatique.
          </p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section>
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
              <CheckCircle2 size={15} aria-hidden />
              Disponible hors ligne
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              {AVAILABLE_OFFLINE.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-rose-700">
              <WifiOff size={15} aria-hidden />
              Nécessite internet
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              {NEEDS_NETWORK.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-rose-400" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/commandes"
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-navy px-4 text-base font-bold text-white transition-colors active:bg-brand-slate"
          >
            <ArrowLeft size={18} aria-hidden />
            Retour aux commandes
          </Link>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-base font-semibold text-slate-700 transition-colors active:bg-slate-100"
          >
            <RefreshCw size={18} aria-hidden />
            Réessayer
          </button>
        </div>
      </div>
    </div>
  )
}
