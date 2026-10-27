/**
 * Mémoire de session du garde de première configuration.
 *
 * Séparé du composant pour deux raisons :
 *  - **Fast Refresh** : un fichier qui exporte un composant ET une fonction
 *    utilitaire force React à recharger tout le sous-arbre à chaque édition ;
 *  - **testabilité** : les tests peuvent réinitialiser cette mémoire sans
 *    remonter le routeur.
 *
 * La mémoire n'est **jamais persistée** (pas de `localStorage`) : la source de
 * vérité reste `tenants.onboarding_completed_at`. Une configuration modifiée
 * depuis une autre tablette doit être reprise à la prochaine connexion.
 */

/** Pressings dont la configuration a été confirmée pendant cette session. */
const onboardingTermineEnSession = new Set<string>()

/** Vrai si la configuration de ce pressing a déjà été confirmée en session. */
export function estTermineEnSession(tenantId: string): boolean {
  return onboardingTermineEnSession.has(tenantId)
}

/** Mémorise qu'un pressing vient de terminer sa configuration. */
export function marquerTermineEnSession(tenantId: string): void {
  onboardingTermineEnSession.add(tenantId)
}

/**
 * Oublie la mémoire de session (déconnexion, changement de pressing).
 *
 * Sans cela, un utilisateur qui se reconnecte sur un pressing remis à zéro ne
 * verrait jamais l'étape de configuration, et les tests ne seraient pas isolés.
 */
export function oublierOnboardingEnSession(tenantId?: string): void {
  if (tenantId) onboardingTermineEnSession.delete(tenantId)
  else onboardingTermineEnSession.clear()
}
