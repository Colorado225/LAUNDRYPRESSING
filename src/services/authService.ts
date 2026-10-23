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
}

/** Contexte mémorisé, reconstruit sans requête réseau. */
function cachedMembership(): TenantMembership | null {
  const { tenantId, tenantName, role, userId } = useTenantStore.getState()
  if (!tenantId || !tenantName || !role) return null
  return { tenantId, tenantName, role, userId }
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

  const membership = await resolveTenantForUser(data.user.id)

  if (!membership) {
    // Compte valide mais non rattaché : on referme la session pour ne pas
    // laisser croire à un accès. Le rattachement se fait côté serveur.
    await supabase.auth.signOut()
    throw new AuthError(
      'no_membership',
      'Ce compte n’est rattaché à aucun pressing. Demandez au propriétaire de vous ajouter à son équipe.',
    )
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    membership,
    fromCache: false,
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
    }
  }

  try {
    const membership = await resolveTenantForUser(user.id)
    return {
      userId: user.id,
      email: user.email ?? null,
      membership,
      fromCache: false,
    }
  } catch {
    // Serveur injoignable alors que `navigator.onLine` est vrai (Wi-Fi captif,
    // coupure de l'opérateur) : on retombe sur le cache plutôt que de bloquer.
    return {
      userId: user.id,
      email: user.email ?? null,
      membership: cached,
      fromCache: true,
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
