import { getSupabaseClient } from '@/lib/supabaseClient'
import {
  resolveTenantForUser,
  useTenantStore,
  type TenantMembership,
} from '@/lib/tenantContext'

/**
 * Authentification et résolution du pressing (phase 5).
 *
 * Deux contraintes structurent ce fichier :
 *
 * 1. **Le `tenant_id` n'est jamais saisi par l'utilisateur.** Il est déduit de
 *    la ligne `tenant_users` rattachée au compte Supabase. La RLS PostgreSQL
 *    reste l'ultime rempart : ce service ne fait que refléter côté client ce
 *    que le serveur autorise déjà.
 *
 * 2. **Le mode avion doit rester utilisable.** Une tablette d'atelier qui perd
 *    le réseau ne doit pas être déconnectée : `restoreSession()` s'appuie sur la
 *    session persistée par supabase-js (localStorage) et sur le pressing mémorisé,
 *    sans aucun appel réseau. Un rafraîchissement de jeton hors ligne échoue
 *    silencieusement — ce n'est pas une raison pour effacer le contexte local.
 */

export class AuthError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

export interface RestoredSession {
  userId: string
  email: string | null
  /** `null` si aucun pressing n'est rattaché au compte. */
  membership: TenantMembership | null
  /** `true` quand le contexte vient du cache local (démarrage hors ligne). */
  fromCache: boolean
  /** `true` si le compte éditeur est autorisé sans appartenance à un pressing. */
  isPlatformAdmin: boolean
}

/** Contexte mémorisé, reconstruit sans requête réseau. */
function cachedMembership(): TenantMembership | null {
  const { tenantId, tenantName, role, userId } = useTenantStore.getState()
  if (!tenantId || !tenantName || !role) return null
  return { tenantId, tenantName, role, userId }
}

/** Vérifie côté serveur l'accès éditeur indépendant d'un pressing. */
async function compteEditeurAutorise(supabase: ReturnType<typeof getSupabaseClient>): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_platform_admin')
    return !error && data === true
  } catch {
    return false
  }
}

/**
 * Connecte un utilisateur par e-mail / mot de passe.
 *
 * @throws {AuthError} message déjà traduit en français, prêt à afficher.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<RestoredSession> {
  if (!navigator.onLine) {
    throw new AuthError(
      'offline',
      'La connexion nécessite internet. Si vous vous êtes déjà connecté sur cet appareil, l’application reste utilisable hors ligne.',
    )
  }

  const supabase = getSupabaseClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })

  if (error) {
    throw new AuthError('sign_in_failed', translateAuthError(error.message, error.status))
  }
  if (!data.user) {
    throw new AuthError('sign_in_failed', 'Connexion impossible : aucun compte retourné.')
  }

  let membership = await resolveTenantForUser(data.user.id)
  let isPlatformAdmin = false

  if (!membership) {
    // Le compte éditeur est le seul à pouvoir ouvrir la console sans être membre
    // d'un pressing. La décision vient du RPC sécurisé, jamais du profil local.
    isPlatformAdmin = await compteEditeurAutorise(supabase)
  }

  // Compte confirmé mais pressing jamais créé : on termine l'inscription ici,
  // sauf pour l'éditeur, qui ne doit pas recevoir un pressing artificiel.
  if (!membership && !isPlatformAdmin) {
    const cree = await finaliserInscriptionEnAttente(data.user.user_metadata).catch(() => null)
    if (cree) membership = await resolveTenantForUser(data.user.id)
  }

  if (!membership && !isPlatformAdmin) {
    // Compte valide mais non rattaché ni autorisé comme éditeur : la session
    // est fermée, et le rôle ne peut pas être demandé depuis le navigateur.
    await supabase.auth.signOut()
    throw new AuthError(
      'no_membership',
      'Ce compte n’est rattaché à aucun pressing et n’est pas autorisé à superviser la plateforme.',
    )
  }

  useTenantStore.getState().setPlatformAdmin(isPlatformAdmin)

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    membership,
    fromCache: false,
    isPlatformAdmin,
  }
}

/**
 * Restaure la session au démarrage.
 *
 * `getSession()` lit le stockage local : il fonctionne donc **hors ligne**.
 * On ne rafraîchit le rattachement depuis la base que si le réseau est présent.
 */
export async function restoreSession(): Promise<RestoredSession | null> {
  const supabase = getSupabaseClient()

  const { data } = await supabase.auth.getSession()

  // ⚠️ `getSession()` peut renvoyer une session **avec** une erreur : c'est le
  // cas d'un jeton expiré dont le rafraîchissement échoue faute de réseau.
  // La session en cache reste parfaitement exploitable en mode avion (les
  // requêtes échoueront de toute façon et Dexie fournit les données) ; seule
  // l'absence de session doit ramener à l'écran de connexion.
  if (!data.session) return null

  const user = data.session.user
  const cached = cachedMembership()

  // Hors ligne : aucune requête. Le pressing mémorisé suffit pour ouvrir
  // l'application ; Dexie fournit les commandes déjà présentes sur l'appareil.
  if (!navigator.onLine) {
    return {
      userId: user.id,
      email: user.email ?? null,
      membership: cached,
      fromCache: true,
      // Ce drapeau mémorisé n'ouvre que l'interface ; toutes les actions restent
      // protégées par les RPC serveur quand la connexion revient.
      isPlatformAdmin: useTenantStore.getState().isPlatformAdmin,
    }
  }

  try {
    const membership = await resolveTenantForUser(user.id)
    const isPlatformAdmin = membership ? false : await compteEditeurAutorise(supabase)
    if (isPlatformAdmin) useTenantStore.getState().setPlatformAdmin(true)
    return {
      userId: user.id,
      email: user.email ?? null,
      membership,
      fromCache: false,
      isPlatformAdmin,
    }
  } catch {
    // Serveur injoignable alors que `navigator.onLine` est vrai (Wi-Fi captif,
    // coupure de l'opérateur) : on retombe sur le cache plutôt que de bloquer.
    return {
      userId: user.id,
      email: user.email ?? null,
      membership: cached,
      fromCache: true,
      isPlatformAdmin: useTenantStore.getState().isPlatformAdmin,
    }
  }
}

/**
 * Déconnexion.
 *
 * Les données IndexedDB du pressing ne sont **pas** supprimées : elles peuvent
 * contenir des commandes pas encore synchronisées. Les écrans filtrent de toute
 * façon par `tenantId`, donc aucun autre pressing ne les voit.
 */
export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient()
  await supabase.auth.signOut()
  useTenantStore.getState().clear()
}

/**
 * Envoie un lien de réinitialisation (palier « MVP » : parcours de connexion).
 *
 * Le lien renvoie sur `/reinitialisation` ; supabase-js y ouvre une session de
 * récupération à partir du fragment d'URL (`detectSessionInUrl`). Aucun mot de
 * passe n'est choisi ici : le service ne fait que demander l'e-mail.
 *
 * Le message de retour est **volontairement neutre** : révéler qu'une adresse
 * est inconnue permettrait d'énumérer les comptes du pressing.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!navigator.onLine) {
    throw new AuthError(
      'offline',
      'L’envoi du lien nécessite internet. Demandez au propriétaire de réinitialiser votre mot de passe.',
    )
  }

  const supabase = getSupabaseClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reinitialisation`,
  })

  if (error) {
    throw new AuthError('reset_failed', translateAuthError(error.message, error.status))
  }
}

/**
 * Définit un nouveau mot de passe pour la session courante.
 *
 * Utilisé par l'écran `/reinitialisation`, ouvert depuis le lien reçu par
 * e-mail : la session de récupération existe déjà, il ne reste qu'à écrire le
 * mot de passe.
 */
export async function updatePassword(password: string): Promise<void> {
  if (password.length < 6) {
    throw new AuthError('weak_password', 'Le mot de passe doit contenir au moins 6 caractères.')
  }

  const supabase = getSupabaseClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    throw new AuthError('update_failed', translateAuthError(error.message, error.status))
  }
}

/**
 * Déconnecte le compte de **tous** ses appareils (écran Paramètres).
 *
 * Utile quand une tablette du comptoir a été revendue, perdue ou prêtée : la
 * session locale est effacée, et Supabase invalide les jetons de rafraîchissement
 * des autres appareils. Les données IndexedDB restent, comme pour `signOut`.
 */
export async function signOutEverywhere(): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.auth.signOut({ scope: 'global' })
  useTenantStore.getState().clear()

  if (error) {
    throw new AuthError('signout_failed', translateAuthError(error.message, error.status))
  }
}

/** Libellés français des erreurs Supabase Auth les plus fréquentes. */
export function translateAuthError(message: string, status?: number): string {
  const normalized = message.toLowerCase()

  if (normalized.includes('invalid login credentials')) {
    return 'E-mail ou mot de passe incorrect.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Adresse e-mail non confirmée. Contactez le propriétaire du pressing.'
  }
  if (normalized.includes('too many requests') || status === 429) {
    return 'Trop de tentatives. Patientez une minute avant de réessayer.'
  }
  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed')
  ) {
    return 'Serveur injoignable. Vérifiez votre connexion internet.'
  }
  if (normalized.includes('user not found')) {
    return 'Aucun compte ne correspond à cette adresse e-mail.'
  }
  if (normalized.includes('password should be')) {
    return 'Mot de passe trop faible.'
  }

  // Message d'origine conservé pour le diagnostic : il n'expose aucune donnée
  // sensible et évite de masquer une cause inattendue derrière un texte vague.
  return `Connexion impossible : ${message}`
}

/* -------------------------------------------------------------------------- */
/* Inscription libre                                                           */
/* -------------------------------------------------------------------------- */

export interface InscriptionInput {
  email: string
  motDePasse: string
  nomPressing: string
  telephone: string
}

export interface ResultatInscription {
  /**
   * `true` quand Supabase exige la confirmation de l'adresse avant d'ouvrir la
   * session. Aucun pressing n'est alors créé : il le sera à la première
   * connexion, une fois l'adresse confirmée.
   */
  confirmationRequise: boolean
  /** Renseigné quand la session est immédiatement ouverte. */
  session: RestoredSession | null
  /** Identifiant du pressing créé, `null` si confirmation requise. */
  tenantId: string | null
}

/**
 * Crée le pressing du compte connecté.
 *
 * Séparé de `signUpWithPassword` pour être rejouable : si le compte a bien été
 * créé mais que la création du pressing a échoué (réseau coupé entre deux
 * requêtes), l'utilisateur doit pouvoir réessayer sans se retrouver coincé avec
 * un compte sans pressing — état que `signInWithPassword` refuse justement.
 */
export async function createPressingForCurrentUser(
  nomPressing: string,
  telephone: string,
): Promise<string> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc('create_tenant_for_user', {
    p_name: nomPressing,
    p_phone: telephone.trim() ? telephone.trim() : null,
  })

  if (error) {
    if (error.code === '23505') {
      throw new AuthError(
        'deja_rattache',
        'Ce compte est déjà rattaché à un pressing. Connectez-vous plutôt que de créer un compte.',
      )
    }
    if (error.code === '22023') {
      throw new AuthError('saisie_invalide', error.message)
    }
    if (error.code === '42501' || error.code === 'PGRST301') {
      throw new AuthError('session_perdue', 'Votre session a expiré. Reconnectez-vous.')
    }
    throw new AuthError(
      'pressing_refuse',
      `Le pressing n’a pas pu être créé : ${error.message}`,
    )
  }

  // PostgREST renvoie la valeur scalaire de la fonction.
  const tenantId = typeof data === 'string' ? data : null
  if (!tenantId) {
    throw new AuthError('pressing_refuse', 'Le pressing n’a pas pu être créé. Réessayez.')
  }

  return tenantId
}

/**
 * Inscription d'un nouveau pressing.
 *
 * Le parcours tient en trois temps, et se rejoue sans dommage :
 *  1. `signUp` — crée le compte Supabase ;
 *  2. si la confirmation par e-mail est activée sur le projet, on s'arrête là
 *     (aucune session, donc aucun droit d'écrire) ;
 *  3. sinon, `create_tenant_for_user` crée le pressing et rattache le compte
 *     comme propriétaire, en une seule transaction côté serveur.
 *
 * Si l'étape 3 échoue, la session reste ouverte : un nouvel appel saute
 * `signUp` (le compte existe déjà) et retente uniquement la création.
 */
export async function signUpWithPassword(
  input: InscriptionInput,
): Promise<ResultatInscription> {
  if (!navigator.onLine) {
    throw new AuthError(
      'offline',
      'La création d’un compte nécessite internet. Réessayez une fois connecté.',
    )
  }

  const supabase = getSupabaseClient()
  const email = input.email.trim().toLowerCase()

  // Reprise après un échec de création de pressing : le compte existe déjà et
  // la session est ouverte, il ne reste qu'à créer le pressing.
  const { data: existante } = await supabase.auth.getSession()
  if (existante.session?.user) {
    const tenantId = await createPressingForCurrentUser(input.nomPressing, input.telephone)
    const membership = await resolveTenantForUser(existante.session.user.id)
    return {
      confirmationRequise: false,
      session: {
        userId: existante.session.user.id,
        email: existante.session.user.email ?? email,
        membership,
        fromCache: false,
        isPlatformAdmin: false,
      },
      tenantId,
    }
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.motDePasse,
    options: { data: { pressing_name: input.nomPressing.trim() } },
  })

  if (error) {
    throw new AuthError('signup_failed', translateAuthError(error.message, error.status))
  }

  // Supabase ne révèle pas qu'une adresse est déjà prise : il renvoie un
  // utilisateur sans identité. On le détecte pour éviter un faux succès.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new AuthError(
      'email_deja_utilise',
      'Cette adresse e-mail possède déjà un compte. Connectez-vous plutôt que de créer un compte.',
    )
  }

  if (!data.session) {
    // Confirmation par e-mail activée : rien ne peut être écrit tant que le
    // lien n'a pas été ouvert. Le pressing sera créé à la première connexion.
    return { confirmationRequise: true, session: null, tenantId: null }
  }

  const tenantId = await createPressingForCurrentUser(input.nomPressing, input.telephone)
  const membership = await resolveTenantForUser(data.session.user.id)

  return {
    confirmationRequise: false,
    session: {
      userId: data.session.user.id,
      email: data.session.user.email ?? email,
      membership,
      fromCache: false,
      isPlatformAdmin: false,
    },
    tenantId,
  }
}

/**
 * À appeler après confirmation de l'adresse e-mail, au moment de la connexion.
 *
 * `signInWithPassword` termine l'inscription d'un compte sans pressing, sauf si
 * le RPC confirme qu'il s'agit de l'éditeur de la plateforme. Pour un nouveau
 * client, on réessaie ici la création du pressing avec le nom saisi à
 * l'inscription (conservé dans `user_metadata`).
 */
export async function finaliserInscriptionEnAttente(
  metadata: Record<string, unknown> | undefined,
): Promise<string | null> {
  const nom = typeof metadata?.['pressing_name'] === 'string' ? metadata['pressing_name'] : ''
  if (!nom) return null

  try {
    return await createPressingForCurrentUser(nom, '')
  } catch (erreur) {
    if (erreur instanceof AuthError && erreur.code === 'deja_rattache') return null
    throw erreur
  }
}
