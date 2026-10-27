import { useEffect, useState } from 'react'

/** Requête média standardisée : « animations réduites » (accessibilité). */
const REQUETE = '(prefers-reduced-motion: reduce)'

/**
 * Indique si l'utilisateur demande à réduire les animations.
 *
 * Remplace `useReducedMotion()` de `framer-motion`, retiré du projet : le cahier
 * des charges interdit cette librairie (bundle lourd pour des tablettes Android
 * d'entrée de gamme) alors que le besoin réel — une animation CSS déclenchée par
 * une classe — ne justifie aucune dépendance.
 *
 * Le comportement reproduit celui de framer-motion :
 *  - la valeur est lue **au premier rendu** (pas de flash animé au chargement) ;
 *  - les changements de préférence système sont écoutés à chaud, avec repli sur
 *    l'ancienne API `addListener` pour les navigateurs Android anciens — c'est
 *    précisément le parc visé par le pressing.
 *
 * `true` signifie « ne pas animer » : les composants doivent alors rendre
 * l'état final directement, sans transition.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduit, setReduit] = useState(() => {
    // `matchMedia` est absent du contexte `jsdom` de certains tests : on
    // conserve l'animation plutôt que de faire échouer le rendu.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(REQUETE).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const requete = window.matchMedia(REQUETE)
    const surChangement = (evenement: MediaQueryListEvent) => setReduit(evenement.matches)

    setReduit(requete.matches)

    if (typeof requete.addEventListener === 'function') {
      requete.addEventListener('change', surChangement)
      return () => requete.removeEventListener('change', surChangement)
    }

    // Android WebView < 14 ne connaît que l'API obsolète.
    requete.addListener(surChangement)
    return () => requete.removeListener(surChangement)
  }, [])

  return reduit
}

export default usePrefersReducedMotion
