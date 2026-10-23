import { useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  LogIn,
  Mail,
  Phone,
  ShieldCheck,
  Shirt,
  Sparkles,
  Timer,
  UserPlus,
  WifiOff,
  Zap,
} from 'lucide-react'
import photoPressing from '@/assets/auth-pressing.jpg'
import {
  DEMO_TENANT_ID,
  missingSupabaseEnvVars,
  supabaseConfigState,
} from '@/lib/env'
import { useTenantStore } from '@/lib/tenantContext'
import {
  MOT_DE_PASSE_MIN,
  aDesErreurs,
  validerInscription,
  type ChampInscription,
  type ErreursInscription,
} from '@/lib/inscription'
import {
  AuthError,
  requestPasswordReset,
  signInWithPassword,
  signUpWithPassword,
} from '@/services/authService'

/**
 * Page d'authentification (phase 5, refonte « écran 1 »).
 *
 * Deux panneaux : la marque à gauche, le formulaire à droite. Sur téléphone et
 * tablette, la marque se réduit à un bandeau et le formulaire occupe toute la
 * largeur — c'est l'usage réel au comptoir.
 *
 * Trois modes, selon la configuration :
 *  - **normal** : *Se connecter* (e-mail + mot de passe) et *Créer un compte*
 *    (nom du pressing + e-mail + mot de passe), dans deux onglets ;
 *  - **démonstration** : ni `VITE_SUPABASE_URL` ni `VITE_SUPABASE_ANON_KEY` —
 *    on entre dans un pressing local pour tester le hors-ligne, avec un
 *    avertissement explicite ;
 *  - **configuration incomplète** : une seule des deux variables. C'est une
 *    erreur d'installation : on affiche la marche à suivre.
 *
 * Cible : tablette Android d'atelier. Champs pleine largeur, hauteur ≥ 48 px,
 * mot de passe masqué par défaut, erreurs annoncées aux lecteurs d'écran, et
 * aucune information ne révélant si une adresse e-mail possède un compte.
 */

interface LoginProps {
  /** Appelé après une connexion réussie (ou l'accès démonstration). */
  onAuthenticated: () => void
  /** Message d'information affiché au-dessus du formulaire (ex. session expirée). */
  notice?: string | null
}

type Onglet = 'connexion' | 'inscription'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function Login({ onAuthenticated, notice = null }: LoginProps) {
  const mode = supabaseConfigState
  const [onglet, setOnglet] = useState<Onglet>('connexion')

  return (
    <div className="auth-backdrop relative min-h-screen overflow-hidden px-3 py-6 sm:px-6 lg:px-8">
      {/* Halos flous : deux taches de couleur qui respirent derrière la carte.
          Purement décoratifs, `aria-hidden`, et figés si l'utilisateur a
          demandé moins d'animation. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="auth-glow absolute -left-24 -top-28 size-[34rem] rounded-full bg-brand-teal/40 blur-3xl" />
        <div
          className="auth-glow absolute -bottom-32 -right-20 size-[30rem] rounded-full bg-brand-amber/25 blur-3xl"
          style={{ animationDelay: '-7s' }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(2,6,23,0.55)_100%)]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center">
        {/* La hauteur est bornée à l'écran : sur un portable de 768 px de haut,
            le formulaire d'inscription défile DANS la carte au lieu de pousser
            la page. Le défilement interne est cantonné (`overscroll-contain`)
            pour ne pas entraîner la page derrière. */}
        <div className="auth-rise grid max-h-[calc(100dvh-3rem)] w-full overflow-hidden rounded-[2rem] lg:max-h-none bg-white/10 shadow-[0_30px_80px_-30px_rgba(2,6,23,0.9)] ring-1 ring-white/15 backdrop-blur-2xl lg:grid-cols-[minmax(0,29rem)_1fr]">
          {/* ------------------------------------------------ Formulaire */}
          <section className="relative flex min-h-0 flex-col overflow-y-auto overscroll-contain bg-white/92 px-5 py-7 backdrop-blur-xl sm:px-9 sm:py-9 lg:bg-white/95">
            {/* Liseré d'accent : deux pixels de couleur, la seule fantaisie de
                l'écran. Il marque le haut de la zone de saisie sans peser. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-brand-teal/0 via-brand-teal/70 to-brand-amber/60"
            />
            <EnteteMobile />

            {/* `my-auto` plutôt que `justify-center` sur la section : dans un
                conteneur qui défile, le centrage flex rogne le haut du contenu
                quand il devient plus haut que la carte. */}
            <div className="my-auto mt-6 lg:mt-0">
              {notice && (
                <p
                  role="status"
                  className="auth-rise auth-delay-1 mb-4 flex items-start gap-2 rounded-2xl bg-amber-50/90 p-3 text-sm text-amber-900 ring-1 ring-amber-200/70"
                >
                  <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
                  {notice}
                </p>
              )}

              {mode === 'demo' && <DemoAccess onAuthenticated={onAuthenticated} />}
              {mode === 'incomplete' && <ConfigWarning />}

              {mode === 'ok' && (
                <div>
                  <Onglets value={onglet} onChange={setOnglet} />

                  {/* La clé force le remontage : c'est ce qui rejoue
                      l'animation d'entrée à chaque changement d'onglet. */}
                  <div key={onglet} className="auth-panel">
                    {onglet === 'connexion' ? (
                      <CredentialsForm
                        onAuthenticated={onAuthenticated}
                        onCreerCompte={() => setOnglet('inscription')}
                      />
                    ) : (
                      <SignupForm
                        onAuthenticated={onAuthenticated}
                        onSeConnecter={() => setOnglet('connexion')}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-500">
              Connexion sécurisée Supabase. Les commandes restent consultables hors ligne sur cet
              appareil.
            </p>
          </section>

          {/* ------------------------------------------------ Photo + argument */}
          <BrandPanel />
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* En-tête compact (téléphone et tablette)                                     */
/* -------------------------------------------------------------------------- */

function EnteteMobile() {
  return (
    <div className="flex items-center gap-3 lg:hidden">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-white">
        <Shirt size={22} aria-hidden />
      </span>
      <div>
        <p className="text-base font-bold text-brand-navy">Pressing Pro</p>
        <p className="text-xs text-slate-500">Gestion de pressing — Abidjan</p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Panneau photo                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Panneau droit : la photo du pressing, un voile dégradé et trois repères.
 *
 * Masqué en dessous de 1024 px : sur une tablette d'atelier, le formulaire doit
 * occuper toute la largeur. La photo n'est donc **pas** téléchargée en priorité
 * sur petit écran — elle reste dans le bundle, mais l'écran n'en dépend jamais.
 *
 * La carte de texte est en verre dépoli (`backdrop-blur`) posée sur la photo :
 * c'est le seul endroit de l'application où ce traitement est utilisé, pour ne
 * pas transformer un outil de comptoir en démonstration de style.
 */
function BrandPanel() {
  const atouts = [
    { icon: Zap, titre: 'Commande en 1 min', texte: 'Même sans réseau.' },
    { icon: ShieldCheck, titre: 'Données isolées', texte: 'Un pressing = un espace.' },
    { icon: Timer, titre: 'Rien de perdu', texte: 'Tout se synchronise.' },
  ]

  return (
    <aside className="relative hidden min-h-[36rem] overflow-hidden lg:block">
      <img
        src={photoPressing}
        alt=""
        aria-hidden
        className="auth-zoom absolute inset-0 size-full object-cover"
        loading="eager"
        decoding="async"
      />
      {/* Voile : garantit le contraste du texte blanc sur la photo, quelle que
          soit la zone de l'image affichée selon la taille de l'écran. */}
      <div className="absolute inset-0 bg-gradient-to-t from-brand-navy via-brand-navy/55 to-brand-navy/10" />

      {/* Pastille flottante : le repère de marque en haut du panneau. */}
      <div className="absolute left-6 top-6 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 backdrop-blur-md">
        <Sparkles size={13} aria-hidden />
        Nouveau : inscription en ligne
      </div>

      <div className="relative flex h-full flex-col justify-between p-7">
        <div className="flex items-center gap-3 self-end rounded-2xl bg-white/10 px-3 py-2 ring-1 ring-white/20 backdrop-blur-md">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand-teal text-white">
            <Shirt size={18} aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold text-white">Pressing Pro</p>
            <p className="text-[11px] text-slate-300">Abidjan · Côte d’Ivoire</p>
          </div>
        </div>

        <div className="auth-rise auth-delay-2">
          <h2 className="max-w-sm text-3xl font-bold leading-tight text-white">
            Le pressing sous contrôle, du comptoir à l’atelier.
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-200">
            Commandes, encaissements, atelier et rapports — sur une tablette qui continue de
            travailler quand le réseau s’arrête.
          </p>

          <ul className="mt-6 space-y-3">
            {atouts.map(({ icon: Icone, titre, texte }, index) => (
              <li
                key={titre}
                className={`auth-rise flex items-center gap-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur-md ${
                  index === 0 ? 'auth-delay-1' : index === 1 ? 'auth-delay-2' : 'auth-delay-3'
                }`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-brand-teal">
                  <Icone size={17} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{titre}</p>
                  <p className="text-xs text-slate-300">{texte}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-5 text-[11px] text-slate-400">
            Données hébergées dans l’Union européenne · aucun paiement stocké sur la tablette
          </p>
        </div>
      </div>
    </aside>
  )
}

/* -------------------------------------------------------------------------- */
/* Onglets Connexion / Inscription                                             */
/* -------------------------------------------------------------------------- */

function Onglets({ value, onChange }: { value: Onglet; onChange: (valeur: Onglet) => void }) {
  const options: Array<{ id: Onglet; label: string; icone: ReactNode }> = [
    { id: 'connexion', label: 'Se connecter', icone: <LogIn size={16} aria-hidden /> },
    { id: 'inscription', label: 'Créer un compte', icone: <UserPlus size={16} aria-hidden /> },
  ]

  return (
    <div
      role="tablist"
      aria-label="Connexion ou création de compte"
      className="mb-6 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100/80 p-1 ring-1 ring-slate-200/70"
    >
      {options.map((option) => {
        const actif = option.id === value
        return (
          <button
            key={option.id}
            role="tab"
            type="button"
            aria-selected={actif}
            onClick={() => onChange(option.id)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all duration-300 ${
              actif
                ? 'bg-white text-brand-navy shadow-[0_6px_18px_-8px_rgba(15,23,42,0.55)]'
                : 'text-slate-500 hover:bg-white/60 hover:text-brand-navy'
            }`}
          >
            {option.icone}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Mode normal : connexion                                                     */
/* -------------------------------------------------------------------------- */

function CredentialsForm({
  onAuthenticated,
  onCreerCompte,
}: {
  onAuthenticated: () => void
  onCreerCompte: () => void
}) {
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
    <div role="tabpanel" aria-label="Connexion">
      <h1 className="text-xl font-bold text-brand-navy">Connexion</h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Utilisez le compte fourni par le propriétaire du pressing.
      </p>

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 space-y-4" noValidate>
        <Champ
          id="email"
          label="Adresse e-mail"
          icone={<Mail size={18} aria-hidden />}
        >
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="pressing@exemple.ci"
            disabled={submitting}
            className={CHAMP_CLASSE}
          />
        </Champ>

        <Champ
          id="password"
          label="Mot de passe"
          icone={<Lock size={18} aria-hidden />}
          apres={
            <BoutonVisibilite
              visible={visible}
              onToggle={() => setVisible((value) => !value)}
            />
          }
        >
          <input
            id="password"
            type={visible ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            disabled={submitting}
            className={CHAMP_CLASSE}
          />
        </Champ>

        {error && <MessageErreur>{error}</MessageErreur>}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-navy to-brand-slate px-4 text-base font-bold text-white shadow-[0_14px_30px_-14px_rgba(15,23,42,0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-14px_rgba(15,23,42,0.95)] focus-visible:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0"
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

      <p className="mt-4 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
        Vous ouvrez un nouveau pressing ?{' '}
        <button
          type="button"
          onClick={onCreerCompte}
          className="font-semibold text-brand-teal underline underline-offset-2"
        >
          Créer un compte
        </button>
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Inscription                                                                 */
/* -------------------------------------------------------------------------- */

type EtatInscription = 'saisie' | 'confirmation'

function SignupForm({
  onAuthenticated,
  onSeConnecter,
}: {
  onAuthenticated: () => void
  onSeConnecter: () => void
}) {
  const [nomPressing, setNomPressing] = useState('')
  const [telephone, setTelephone] = useState('')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [conditions, setConditions] = useState(false)
  const [visible, setVisible] = useState(false)
  const [erreurs, setErreurs] = useState<ErreursInscription>({})
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [etat, setEtat] = useState<EtatInscription>('saisie')

  const effacerErreur = (champ: ChampInscription) =>
    setErreurs((actuelles) => {
      if (!actuelles[champ]) return actuelles
      const suivantes = { ...actuelles }
      delete suivantes[champ]
      return suivantes
    })

  const envoyer = async (event: FormEvent) => {
    event.preventDefault()
    setErreurGlobale(null)

    const trouvees = validerInscription({
      nomPressing,
      telephone,
      email,
      motDePasse,
      confirmation,
      conditions,
    })
    setErreurs(trouvees)

    if (aDesErreurs(trouvees)) {
      setErreurGlobale('Corrigez les champs signalés pour continuer.')
      return
    }

    setEnvoi(true)
    try {
      const resultat = await signUpWithPassword({
        email,
        motDePasse,
        nomPressing,
        telephone,
      })

      if (resultat.confirmationRequise) {
        setEtat('confirmation')
        return
      }

      onAuthenticated()
    } catch (caught) {
      setErreurGlobale(
        caught instanceof AuthError
          ? caught.message
          : 'Création du compte impossible. Réessayez dans quelques instants.',
      )
    } finally {
      setEnvoi(false)
    }
  }

  if (etat === 'confirmation') {
    return (
      <div role="tabpanel" aria-label="Création de compte" className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Mail size={26} aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-bold text-brand-navy">Vérifiez votre messagerie</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Un lien de confirmation vient d’être envoyé à <strong>{email.trim()}</strong>. Ouvrez-le
          pour activer le compte : votre pressing sera créé automatiquement à la première connexion.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Rien reçu ? Regardez dans les indésirables, puis réessayez la connexion : un nouveau lien
          est proposé si l’adresse n’est pas encore confirmée.
        </p>
        <button
          type="button"
          onClick={onSeConnecter}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy px-4 text-base font-bold text-white"
        >
          <LogIn size={18} aria-hidden /> Aller à la connexion
        </button>
      </div>
    )
  }

  return (
    <div role="tabpanel" aria-label="Création de compte">
      <h1 className="text-xl font-bold text-brand-navy">Créer un compte</h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Ouvrez le compte de votre pressing. Vous en serez le propriétaire, avec accès à la caisse,
        aux rapports et aux paramètres.
      </p>

      <form onSubmit={(event) => void envoyer(event)} className="mt-5 space-y-4" noValidate>
        <Champ
          id="pressing-name"
          label="Nom du pressing"
          icone={<Building2 size={18} aria-hidden />}
          erreur={erreurs.nomPressing}
        >
          <input
            id="pressing-name"
            value={nomPressing}
            onChange={(event) => {
              setNomPressing(event.target.value)
              effacerErreur('nomPressing')
            }}
            placeholder="Pressing Cocody"
            autoComplete="organization"
            maxLength={80}
            disabled={envoi}
            aria-invalid={Boolean(erreurs.nomPressing)}
            className={CHAMP_CLASSE}
          />
        </Champ>

        <Champ
          id="pressing-phone"
          label="Téléphone du pressing (facultatif)"
          icone={<Phone size={18} aria-hidden />}
          erreur={erreurs.telephone}
        >
          <input
            id="pressing-phone"
            inputMode="tel"
            value={telephone}
            onChange={(event) => {
              setTelephone(event.target.value)
              effacerErreur('telephone')
            }}
            placeholder="07 07 07 07 07"
            autoComplete="tel"
            disabled={envoi}
            aria-invalid={Boolean(erreurs.telephone)}
            className={CHAMP_CLASSE}
          />
        </Champ>

        <Champ
          id="signup-email"
          label="Adresse e-mail"
          icone={<Mail size={18} aria-hidden />}
          erreur={erreurs.email}
        >
          <input
            id="signup-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              effacerErreur('email')
            }}
            placeholder="pressing@exemple.ci"
            disabled={envoi}
            aria-invalid={Boolean(erreurs.email)}
            className={CHAMP_CLASSE}
          />
        </Champ>

        <Champ
          id="signup-password"
          label="Mot de passe"
          icone={<Lock size={18} aria-hidden />}
          erreur={erreurs.motDePasse}
          aide={`Au moins ${MOT_DE_PASSE_MIN} caractères, avec une lettre et un chiffre.`}
          apres={
            <BoutonVisibilite
              visible={visible}
              onToggle={() => setVisible((value) => !value)}
            />
          }
        >
          <input
            id="signup-password"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            value={motDePasse}
            onChange={(event) => {
              setMotDePasse(event.target.value)
              effacerErreur('motDePasse')
            }}
            placeholder="••••••••"
            disabled={envoi}
            aria-invalid={Boolean(erreurs.motDePasse)}
            className={CHAMP_CLASSE}
          />
        </Champ>

        <Champ
          id="signup-confirmation"
          label="Confirmer le mot de passe"
          icone={<Lock size={18} aria-hidden />}
          erreur={erreurs.confirmation}
        >
          <input
            id="signup-confirmation"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value)
              effacerErreur('confirmation')
            }}
            placeholder="••••••••"
            disabled={envoi}
            aria-invalid={Boolean(erreurs.confirmation)}
            className={CHAMP_CLASSE}
          />
        </Champ>

        <div>
          <label className="flex items-start gap-2 text-sm leading-relaxed text-slate-600">
            <input
              type="checkbox"
              checked={conditions}
              onChange={(event) => {
                setConditions(event.target.checked)
                effacerErreur('conditions')
              }}
              disabled={envoi}
              className="mt-0.5 size-5 shrink-0 rounded border-slate-300 text-brand-teal focus:ring-brand-teal"
            />
            <span>
              J’accepte les conditions d’utilisation et la politique de confidentialité : mes
              données de pressing ne sont visibles que par mon équipe.
            </span>
          </label>
          {erreurs.conditions && (
            <p role="alert" className="mt-1 text-xs font-medium text-rose-700">
              {erreurs.conditions}
            </p>
          )}
        </div>

        {erreurGlobale && <MessageErreur>{erreurGlobale}</MessageErreur>}

        <button
          type="submit"
          disabled={envoi}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-teal to-brand-teal-dark px-4 text-base font-bold text-white shadow-[0_14px_30px_-14px_rgba(15,118,110,0.9)] transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {envoi ? (
            <>
              <Loader2 className="animate-spin" size={18} aria-hidden />
              Création du compte…
            </>
          ) : (
            <>
              <UserPlus size={18} aria-hidden />
              Créer mon compte
            </>
          )}
        </button>
      </form>

      <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-brand-teal" aria-hidden />
        Le compte créé ouvre un essai de 14 jours, sans carte bancaire. Vous pourrez ensuite
        renouveler depuis l’onglet Abonnement.
      </p>

      <p className="mt-4 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
        Vous avez déjà un compte ?{' '}
        <button
          type="button"
          onClick={onSeConnecter}
          className="font-semibold text-brand-teal underline underline-offset-2"
        >
          Se connecter
        </button>
      </p>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
        <CheckCircle2 size={13} className="text-emerald-600" aria-hidden />
        Vous serez propriétaire : seul vous pourrez gérer l’équipe et les tarifs.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Petits composants partagés                                                  */
/* -------------------------------------------------------------------------- */

const CHAMP_CLASSE =
  'min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-3 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-teal focus:bg-white focus:ring-4 focus:ring-brand-teal/10 disabled:bg-slate-100'

function Champ({
  id,
  label,
  icone,
  erreur,
  aide,
  apres,
  children,
}: {
  id: string
  label: string
  icone: ReactNode
  erreur?: string
  aide?: string
  apres?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        {label}
      </label>
      <div className="relative mt-1.5">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden
        >
          {icone}
        </span>
        {children}
        {apres}
      </div>
      {aide && !erreur && (
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{aide}</p>
      )}
      {erreur && (
        <p role="alert" className="mt-1 flex items-start gap-1 text-xs font-medium text-rose-700">
          <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
          {erreur}
        </p>
      )}
    </div>
  )
}

function BoutonVisibilite({
  visible,
  onToggle,
}: {
  visible: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      // Cible tactile de 48 px de haut : utilisable avec des doigts humides ou
      // gantés, en atelier.
      className="absolute right-1 top-1/2 inline-flex min-h-12 -translate-y-1/2 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 active:bg-slate-100"
      aria-pressed={visible}
    >
      {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      {visible ? 'Masquer' : 'Afficher'}
    </button>
  )
}

function MessageErreur({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
      {children}
    </p>
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
      <label
        htmlFor="reset-email"
        className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
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

      {erreur && <MessageErreur>{erreur}</MessageErreur>}

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
          désactivée tant que le projet Supabase n’est pas entièrement renseigné.
        </p>
      </div>

      <h1 className="mt-5 text-xl font-bold text-brand-navy">Variables manquantes</h1>
      <ul className="mt-3 space-y-1 text-sm text-slate-700">
        {missingSupabaseEnvVars.map((variable) => (
          <li key={variable}>
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
          n’est configuré : ni connexion ni création de compte par e-mail. Définissez{' '}
          {missingSupabaseEnvVars.map((variable) => (
            <code key={variable} className="font-mono">
              {variable}{' '}
            </code>
          ))}
          dans <code className="font-mono">.env</code> pour les activer.
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
