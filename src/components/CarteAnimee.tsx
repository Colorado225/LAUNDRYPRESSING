import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/**
 * Carte qui apparaît en montant, une seule fois, quand elle entre à l'écran.
 *
 * Remplace `motion.div` + `initial`/`animate` de `framer-motion`. L'animation
 * est entièrement en CSS (`carte-apparition`) : le JavaScript ne fait que
 * basculer une classe quand l'élément devient visible.
 *
 * Pourquoi `IntersectionObserver` et non une animation au montage : les cartes
 * métriques sont rendues sous le contenu principal ; sur une tablette, une
 * animation lancée hors écran est terminée avant d'être vue, et le mouvement
 * devient un simple « saut » au défilement.
 *
 * Si l'utilisateur demande la réduction des animations, ou si l'API n'existe
 * pas (environnement de test), le contenu est rendu immédiatement dans son
 * état final : jamais de carte invisible.
 */
export function CarteAnimee({
  children,
  className,
  delai = 0,
}: {
  children: ReactNode
  className?: string
  /** Décalage en millisecondes, pour une apparition en cascade. */
  delai?: number
}) {
  const reduire = usePrefersReducedMotion()
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (reduire) {
      setVisible(true)
      return
    }

    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observateur = new IntersectionObserver(
      (entrees) => {
        for (const entree of entrees) {
          if (entree.isIntersecting) {
            setVisible(true)
            // Une carte n'apparaît qu'une fois : on cesse d'observer.
            observateur.disconnect()
          }
        }
      },
      // Déclenche dès que 12 % de la carte est visible : plus réactif qu'un
      // seuil élevé quand la hauteur de la carte est inconnue à l'avance.
      { threshold: 0.12 },
    )

    observateur.observe(element)
    return () => observateur.disconnect()
  }, [reduire])

  const classes = [
    'carte-animee',
    visible || reduire ? 'carte-animee-visible' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={ref}
      className={classes}
      style={delai > 0 && !reduire ? { animationDelay: `${delai}ms` } : undefined}
    >
      {children}
    </div>
  )
}

export default CarteAnimee
