import 'fake-indexeddb/auto'

/**
 * Préparation commune des tests.
 *
 * `fake-indexeddb/auto` installe un IndexedDB en mémoire : les tests du dépôt
 * local et du moteur de synchronisation s'exécutent donc sans navigateur, avec
 * le vrai code Dexie (pas un double).
 *
 * Chaque fichier de test nettoie ses propres tables ; on ne vide pas la base
 * ici pour ne pas interférer avec les imports de module.
 */

// React 19 n'active `act()` que si l'environnement le déclare explicitement.
// Sans ce drapeau, chaque rendu de composant déclenche un avertissement et des
// mises à jour d'état hors `act` ne sont pas vidées avant les assertions.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom n'implémente pas `matchMedia` (utilisé par les composants responsives).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}
