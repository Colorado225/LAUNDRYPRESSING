import 'fake-indexeddb/auto'

/**
 * Amorçage commun des tests.
 *
 * `fake-indexeddb/auto` installe un IndexedDB en mémoire avant tout import de
 * Dexie : sans cela, `new Dexie(...)` lève au chargement du module et toute la
 * suite échoue pour une raison sans rapport avec le code testé.
 */

// JSX runtime de React 19 : les tests de hooks passent par `act()`.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
