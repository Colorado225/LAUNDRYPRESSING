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
  ShieldCheck,
  Shirt,
  Timer,
  WifiOff,
  Zap,
} from 'lucide-react'
import {
  DEMO_TENANT_ID,
  missingSupabaseEnvVars,
  supabaseConfigState,
} from '@/lib/env'
import { useTenantStore } from '@/lib/tenantContext'
import { AuthError, requestPasswordReset, signInWithPassword } from '@/services/authService'

/**
 * Écran de connexion (phase 5).
 *
 * Trois modes dans le même écran :
 *  - **normal** : e-mail + mot de passe via Supabase Auth, puis résolution du
 *    pressing dans `tenant_users` (jamais saisi par l'utilisateur) ;
 *  - **démonstration** : quand ni `VITE_SUPABASE_URL` ni `VITE_SUPABASE_ANON_KEY`
 *    ne sont renseignés, aucune authentification n'est possible. On laisse
 *    alors entrer dans un pressing local pour continuer à tester
 *    l'offline-first, avec un avertissement explicite — plutôt qu'un écran mort ;
 *  - **configuration incomplète** : une seule des deux variables est présente.
 *    C'est une erreur d'installation : on affiche la marche à suivre au lieu de
 *    la masquer derrière le mode démonstration.
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
  const mode = supabaseConfigState

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-navy px-4 py-8">
      <div className="grid w-full max-w-4xl items-center gap-8 lg:grid-cols-[1fr_minmax(0,26rem)]">
      <div className="w-full">
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
          {mode === 'demo' && <DemoAccess onAuthenticated={onAuthenticated} />}
          {mode === 'incomplete' && <ConfigWarning />}
          {mode === 'ok' && <CredentialsForm onAuthenticated={onAuthenticated} />}

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

        <SalesArguments />
      </div>
    </div>
  )
}

/**
 * Arguments de vente affichés à côté du formulaire (grands écrans seulement).
 *
 * Sur une tablette en atelier, la colonne disparaît : le formulaire garde toute
 * la largeur, ce qui reste l'usage principal.
 */
function SalesArguments() {
  const atouts = [
    {
      icon: Zap,
      titre: 'Rapide',
      texte: 'Commande enregistrée en moins d’une minute, même sans réseau.',
    },
    {
      icon: ShieldCheck,
      titre: 'Sécurisé',
      texte: 'Chaque pressing ne voit que ses données, garanties par la base.',
    },
    {
      icon: Timer,
      titre: 'Fiable',
      texte: 'Aucune commande perdue : tout reste sur la tablette puis se synchronise.',
    },
  ]

  return (
    <aside className="hidden lg:block">
      <h2 className="text-2xl font-bold leading-snug text-white">
        Le pressing sous contrôle,
        <br />
        du comptoir à l’atelier.
      </h2>
      <ul className="mt-6 space-y-4">
        {atouts.map(({ icon: Icone, titre, texte }) => (
          <li key={titre} className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-teal">
              <Icone size={20} aria-hidden />
            </span>
            <div>
              <p className="font-semibold text-white">{titre}</p>
              <p className="text-sm leading-relaxed text-slate-300">{texte}</p>
            </div>
          </li>
        ))}
      </ul>
    </aside>
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
  // Panneau « mot de passe oublié » : un simple remplacement du formulaire
  // évite une page de plus sur une tablette où chaque écran coûte un geste.
  const [resetOpen, setResetOpen] = useState(false)

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

      {resetOpen ? (
        <ResetPanel email={email} onClose={() => setResetOpen(false)} />
      ) : (
        <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
          Mot de passe oublié ?{' '}
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            className="font-semibold text-brand-teal underline underline-offset-2"
          >
            Recevoir un lien de réinitialisation
          </button>
        </p>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Mot de passe oublié                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Demande d'un lien de réinitialisation.
 *
 * Le message de confirmation est neutre (« si un compte existe… ») : il ne
 * permet pas de savoir si une adresse est enregistrée. Le lien reçu ouvre
 * `/reinitialisation`, qui écrit le nouveau mot de passe.
 */
function ResetPanel({ email, onClose }: { email: string; onClose: () => void }) {
  const [adresse, setAdresse] = useState(email)
  const [envoi, setEnvoi] = useState(false)
  const [envoye, setEnvoye] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const envoyer = async (event: FormEvent) => {
    event.preventDefault()
    setErreur(null)

    if (!adresse.trim()) {
      setErreur('Indiquez l’adresse e-mail de votre compte.')
      return
    }

    setEnvoi(true)
    try {
      await requestPasswordReset(adresse)
      setEnvoye(true)
    } catch (caught) {
      setErreur(
        caught instanceof AuthError
          ? caught.message
          : 'Envoi impossible. Vérifiez votre connexion et réessayez.',
      )
    } finally {
      setEnvoi(false)
    }
  }

  if (envoye) {
    return (
      <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
        <p className="font-semibold">Lien envoyé.</p>
        <p className="mt-1 leading-relaxed">
          Si un compte existe pour {adresse.trim()}, un e-mail contenant un lien de
          réinitialisation vient d’être envoyé. Pensez à regarder les indésirables.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 min-h-10 font-semibold text-emerald-900 underline underline-offset-2"
        >
          Revenir à la connexion
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={(event) => void envoyer(event)} className="mt-4 space-y-2" noValidate>
      <label htmlFor="reset-email" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Adresse e-mail du compte
      </label>
      <input
        id="reset-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={adresse}
        onChange={(event) => setAdresse(event.target.value)}
        disabled={envoi}
        className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand-teal disabled:bg-slate-50"
      />

      {erreur && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {erreur}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={envoi}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white disabled:opacity-60"
        >
          {envoi ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}
          Envoyer le lien
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={envoi}
          className="min-h-12 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600"
        >
          Annuler
        </button>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Configuration incomplète : une seule des deux variables publiques           */
/* -------------------------------------------------------------------------- */

function ConfigWarning() {
  return (
    <>
      <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
        <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
        <p>
          <strong className="font-semibold">Configuration incomplète.</strong> La connexion est
          désactivée tant que les deux variables ne sont pas renseignées dans{' '}
          <code className="font-mono">.env</code> :
        </p>
      </div>

      <ul className="mt-3 space-y-1 text-sm text-slate-700">
        {missingSupabaseEnvVars.map((variable) => (
          <li key={variable} className="flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
            <code className="font-mono">{variable}</code>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm leading-relaxed text-slate-600">
        Renseignez-les puis relancez l’installation : <br />
        <code className="mt-1 inline-block rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs">
          npm run setup:check
        </code>
      </p>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Aucun projet Supabase ne doit rester à moitié configuré en production : les commandes
        enregistrées sur cette tablette ne pourraient pas être synchronisées.
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
      userId: null,
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
