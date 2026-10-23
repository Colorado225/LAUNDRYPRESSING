import { useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  LogIn,
  Mail,
  Shirt,
  WifiOff,
} from 'lucide-react'
import { DEMO_TENANT_ID, isSupabaseConfigured, missingSupabaseEnvVars } from '@/lib/env'
import { useTenantStore } from '@/lib/tenantContext'
import { AuthError, signInWithPassword } from '@/services/authService'

/**
 * Écran de connexion (phase 5).
 *
 * Deux modes dans le même écran :
 *  - **normal** : e-mail + mot de passe via Supabase Auth, puis résolution du
 *    pressing dans `tenant_users` (jamais saisi par l'utilisateur) ;
 *  - **démonstration** : quand `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
 *    sont absents, aucune authentification n'est possible. On laisse alors
 *    entrer dans un pressing local pour continuer à tester l'offline-first,
 *    avec un avertissement explicite — plutôt qu'un écran mort.
 *
 * Cible : tablette Android d'atelier. Champs pleine largeur, hauteur ≥ 48 px,
 * mot de passe masqué par défaut, erreurs annoncées aux lecteurs d'écran.
 */

interface LoginProps {
  /** Appelé après une connexion réussie (ou l'accès démonstration). */
  onAuthenticated: () => void
  /** Message d'information affiché au-dessus du formulaire (ex. session expirée). */
  notice?: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function Login({ onAuthenticated, notice = null }: LoginProps) {
  const demo = !isSupabaseConfigured

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-navy px-4 py-8">
      <div className="w-full max-w-md">
        <header className="mb-6 flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-teal/15 text-brand-teal">
            <Shirt size={26} aria-hidden />
          </span>
          <div>
            <p className="text-lg font-bold text-white">Pressing Pro</p>
            <p className="text-sm text-slate-400">Gestion de pressing — Abidjan</p>
          </div>
        </header>

        <div className="rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
          {demo ? (
            <DemoAccess onAuthenticated={onAuthenticated} />
          ) : (
            <CredentialsForm onAuthenticated={onAuthenticated} />
          )}

          {notice && (
            <p
              role="status"
              className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
            >
              <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
              {notice}
            </p>
          )}
        </div>

        <p className="mt-5 text-center text-xs leading-relaxed text-slate-400">
          Connexion sécurisée Supabase. Les commandes restent consultables hors ligne sur cet
          appareil.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Mode normal : e-mail + mot de passe                                         */
/* -------------------------------------------------------------------------- */

function CredentialsForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()

    if (!email.trim() || !password) {
      setError('Renseignez votre adresse e-mail et votre mot de passe.')
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      await signInWithPassword(email, password)
      onAuthenticated()
    } catch (caught) {
      setError(
        caught instanceof AuthError
          ? caught.message
          : 'Connexion impossible. Réessayez dans quelques instants.',
      )
      setSubmitting(false)
    }
  }

  return (
    <>
      <h1 className="text-xl font-bold text-brand-navy">Connexion</h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Utilisez le compte fourni par le propriétaire du pressing.
      </p>

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 space-y-4" noValidate>
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Adresse e-mail
          </label>
          <div className="relative mt-1.5">
            <Mail
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="pressing@exemple.ci"
              disabled={submitting}
              className="min-h-12 w-full rounded-xl border border-slate-300 pl-10 pr-3 text-base outline-none focus:border-brand-teal disabled:bg-slate-50"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Mot de passe
          </label>
          <div className="relative mt-1.5">
            <Lock
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              id="password"
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              disabled={submitting}
              className="min-h-12 w-full rounded-xl border border-slate-300 pl-10 pr-24 text-base outline-none focus:border-brand-teal disabled:bg-slate-50"
            />
            <button
              type="button"
              onClick={() => setVisible((value) => !value)}
              // Cible tactile de 48 px de haut : utilisable avec des doigts
              // humides ou gantés, en atelier.
              className="absolute right-1 top-1/2 inline-flex min-h-12 -translate-y-1/2 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 active:bg-slate-100"
              aria-pressed={visible}
            >
              {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              {visible ? 'Masquer' : 'Afficher'}
            </button>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy px-4 text-base font-bold text-white transition-colors active:bg-brand-slate disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="animate-spin" size={18} aria-hidden />
              Connexion…
            </>
          ) : (
            <>
              <LogIn size={18} aria-hidden />
              Se connecter
            </>
          )}
        </button>
      </form>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Mot de passe oublié ? Contactez le propriétaire du pressing : la réinitialisation par
        e-mail n’est pas encore automatisée dans cette version.
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Mode démonstration : aucun backend configuré                                */
/* -------------------------------------------------------------------------- */

function DemoAccess({ onAuthenticated }: { onAuthenticated: () => void }) {
  const setMembership = useTenantStore((state) => state.setMembership)

  const [value, setValue] = useState(DEMO_TENANT_ID ?? '')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const id = value.trim()

    if (!id) {
      setError('Renseignez l’identifiant du pressing.')
      return
    }
    if (!UUID_PATTERN.test(id)) {
      setError('Identifiant invalide : un UUID est attendu (voir supabase/seed.sql).')
      return
    }

    setError(null)
    setMembership({
      tenantId: id,
      tenantName: name.trim() || 'Pressing de démonstration',
      role: 'owner',
    })
    onAuthenticated()
  }

  return (
    <>
      <div className="flex items-start gap-2 rounded-xl bg-slate-100 p-3 text-xs leading-relaxed text-slate-700">
        <Building2 size={16} className="mt-0.5 shrink-0" aria-hidden />
        <p>
          <strong className="font-semibold">Mode démonstration.</strong> Aucun projet Supabase
          n’est configuré : la connexion par e-mail est indisponible. Définissez{' '}
          {missingSupabaseEnvVars.map((variable) => (
            <code key={variable} className="font-mono">
              {variable}{' '}
            </code>
          ))}
          dans <code className="font-mono">.env</code> pour l’activer.
        </p>
      </div>

      <h1 className="mt-5 text-xl font-bold text-brand-navy">Choisir le pressing</h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Indiquez l’identifiant du pressing à utiliser sur cette tablette. Les commandes restent
        enregistrées localement et seront synchronisées dès qu’un projet Supabase sera configuré.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor="tenant-id"
            className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Identifiant du pressing (UUID)
          </label>
          <input
            id="tenant-id"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="11111111-1111-4111-8111-111111111111"
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm outline-none focus:border-brand-teal"
          />
        </div>

        <div>
          <label
            htmlFor="tenant-name"
            className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Nom affiché (optionnel)
          </label>
          <input
            id="tenant-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Pressing Cocody"
            className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"
          >
            <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <button
          type="submit"
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy px-4 text-base font-bold text-white transition-colors active:bg-brand-slate"
        >
          Continuer
          <ArrowRight size={18} aria-hidden />
        </button>
      </form>
    </>
  )
}
