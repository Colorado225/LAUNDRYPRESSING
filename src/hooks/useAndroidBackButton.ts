import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

/**
 * Gestion du bouton « Retour » Android (phase 5).
 *
 * Problème visé : en PWA installée (`display: standalone`), Android ne ferme
 * pas l'application comme un site ; sans historique, il la quitte d'un coup, ce
 * qui est brutal au milieu d'une saisie. À l'inverse, un historique qui ne se
 * vide jamais piège l'utilisateur.
 *
 * Solution : une **sentinelle** est poussée dans l'historique au démarrage.
 *  - un appui « Retour » depuis un écran interne remonte normalement ;
 *  - arrivé à la sentinelle, on affiche « Appuyez à nouveau… » et on ré-arme ;
 *  - un second appui en moins de 2 s laisse Android fermer l'application.
 *
 * On passe par `navigate()` (et non `history.pushState` brut) : react-router
 * maintient ainsi ses propres index (`idx`) et le bouton « précédent » du
 * navigateur continue de fonctionner.
 */

/** Délai pendant lequel un second appui quitte réellement l'application. */
const EXIT_HINT_MS = 2000

/** Écran racine auquel on revient toujours. */
const ROOT_PATH = '/commandes'

type RouterHistoryState = { usr?: { backGuard?: boolean } & Record<string, unknown> } | null

function hasGuard(): boolean {
  const state = window.history.state as RouterHistoryState
  return state?.usr?.backGuard === true
}

function isRoot(pathname: string): boolean {
  return pathname === ROOT_PATH || pathname === '/'
}

export function useAndroidBackButton(): void {
  const navigate = useNavigate()
  const location = useLocation()

  const lastPressRef = useRef(0)
  const armedRef = useRef(false)
  // La position courante est lue dans un ref : le gestionnaire `popstate`
  // s'exécute avant que React n'ait re-rendu avec la nouvelle route.
  const locationRef = useRef(location)

  useEffect(() => {
    locationRef.current = location
  }, [location])

  const arm = useCallback(() => {
    const { pathname, search } = locationRef.current
    navigate(`${pathname}${search}`, { replace: false, state: { backGuard: true } })
  }, [navigate])

  // 1. Sentinelle posée une seule fois, au premier affichage.
  useEffect(() => {
    if (armedRef.current) return
    armedRef.current = true
    if (hasGuard()) return
    arm()
  }, [arm])

  // 2. Interception du retour matériel / gestuel.
  useEffect(() => {
    const handlePopState = () => {
      // Navigation interne normale : chaque écran poussé par l'application
      // porte sa propre entrée, rien à faire.
      if (hasGuard()) return

      const now = Date.now()
      const withinExitWindow = now - lastPressRef.current < EXIT_HINT_MS
      lastPressRef.current = now

      const { pathname } = locationRef.current

      // Lien profond (ouverture directe sur une fiche) : on remonte à la liste
      // plutôt que de laisser l'utilisateur devant un écran sans parent.
      if (!isRoot(pathname)) {
        // `replace` : l'entrée courante devient la liste, déjà protégée par la
        // sentinelle, au lieu d'empiler deux navigations successives.
        navigate(ROOT_PATH, { replace: true, state: { backGuard: true } })
        return
      }

      if (withinExitWindow) {
        // Second appui : plus de sentinelle, Android peut fermer l'application.
        lastPressRef.current = 0
        window.history.back()
        return
      }

      toast('Appuyez à nouveau sur « Retour » pour quitter l’application.', {
        id: 'android-back-exit',
        duration: EXIT_HINT_MS,
        icon: '👋',
      })
      arm()
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [arm, navigate])
}

export default useAndroidBackButton
