import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { AuthError, updatePassword } from '@/services/authService'

/**
 * Nouveau mot de passe après réception du lien de réinitialisation.
 *
 * Le lien envoyé par Supabase Auth ouvre cette page avec une session de
 * récupération : il n'y a donc rien à authentifier ici, seulement un mot de
 * passe à écrire. Si la session manque (lien expiré, ouvert sur un autre
 * appareil), on le dit clairement au lieu d'afficher un formulaire inutile.
 */
export default function Reinitialisation() {
  const navigate = useNavigate()
  const [sessionPrete, setSessionPrete] = useState<boolean | null>(null)
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [termine, setTermine] = useState(false)

  useEffect(() => {
    let actif = true

    void getSupabaseClient()
      .auth.getSession()
      .then(({ data }) => {
        if (actif) setSessionPrete(Boolean(data.session))
      })
      .catch(() => {
        if (actif) setSessionPrete(false)
      })

    return () => {
      actif = false
    }
  }, [])

  const envoyer = async (event: FormEvent) => {
    event.preventDefault()
    setErreur(null)

    if (motDePasse !== confirmation) {
      setErreur('Les deux mots de passe ne sont pas identiques.')
      return
    }

    setEnvoi(true)
    try {
      await updatePassword(motDePasse)
      setTermine(true)
      // La session est ouverte : on laisse le temps de lire le message, puis
      // on renvoie vers l'application.
      window.setTimeout(() => navigate('/commandes', { replace: true }), 2500)
    } catch (caught) {
      setErreur(
        caught instanceof AuthError ? caught.message : 'Enregistrement impossible. Réessayez.',
      )
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="auth-backdrop relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
      {/* Même fond que la page de connexion : deux halos flous, figés si
          l'utilisateur a demandé moins d'animation (voir `index.css`). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="auth-glow absolute -left-24 -top-28 size-[32rem] rounded-full bg-brand-teal/35 blur-3xl" />
        <div
          className="auth-glow absolute -bottom-32 -right-20 size-[28rem] rounded-full bg-brand-amber/20 blur-3xl"
          style={{ animationDelay: '-6s' }}
        />
      </div>

      <div className="auth-rise relative w-full max-w-md rounded-[1.75rem] bg-white/95 p-6 shadow-[0_30px_80px_-30px_rgba(2,6,23,0.9)] ring-1 ring-white/40 backdrop-blur-2xl sm:p-8">
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy">
          <KeyRound size={22} aria-hidden /> Nouveau mot de passe
        </h1>

        {sessionPrete === null && (
          <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="animate-spin" size={16} aria-hidden /> Vérification du lien…
          </p>
        )}

        {sessionPrete === false && (
          <div className="mt-4 space-y-4">
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
              Ce lien n’est plus valide, ou il a été ouvert sur un autre appareil. Demandez un
              nouveau lien depuis l’écran de connexion.
            </p>
            <Link
              to="/"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-navy px-4 text-base font-bold text-white"
            >
              Revenir à la connexion
            </Link>
          </div>
        )}

        {sessionPrete && !termine && (
          <form onSubmit={(event) => void envoyer(event)} className="mt-4 space-y-4" noValidate>
            <p className="text-sm text-slate-600">
              Choisissez un mot de passe d’au moins 6 caractères. Il remplace l’ancien
              immédiatement.
            </p>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Nouveau mot de passe
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={motDePasse}
                onChange={(event) => setMotDePasse(event.target.value)}
                disabled={envoi}
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal disabled:bg-slate-50"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Confirmation
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={envoi}
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal disabled:bg-slate-50"
              />
            </label>

            {erreur && (
              <p role="alert" className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
                {erreur}
              </p>
            )}

            <button
              type="submit"
              disabled={envoi}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy px-4 text-base font-bold text-white disabled:opacity-60"
            >
              {envoi ? <Loader2 className="animate-spin" size={18} aria-hidden /> : null}
              Enregistrer le mot de passe
            </button>
          </form>
        )}

        {termine && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
            Mot de passe enregistré. Ouverture de l’application…
          </p>
        )}

        {isSupabaseConfigured && (
          <p className="mt-4 text-center text-xs text-slate-400">
            Pressing Pro — réinitialisation sécurisée par Supabase Auth
          </p>
        )}
      </div>
    </div>
  )
}
