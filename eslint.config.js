import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * Configuration ESLint (flat config).
 *
 * Note : `typescript-eslint` ne supporte pas encore TypeScript 7 (voir issue #10940).
 * Le projet est donc épinglé sur TypeScript 6.0.3 pour conserver un lint complet
 * des fichiers .ts/.tsx. Décision documentée dans README.md.
 */
export default defineConfig([
  // `.vite` et `coverage` sont des sorties générées (cache de pré-bundling Vite,
  // rapports de couverture) : les linter produisait des centaines de faux positifs
  // sur des bundles minifiés, alors que `src` est parfaitement propre.
  globalIgnores(['dist', 'dev-dist', '.vite', 'coverage', 'node_modules', 'supabase/functions']),

  /* Fichiers JavaScript de configuration (Node) */
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
    },
  },

  /* Application TypeScript / React */
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Les messages destinés à l'utilisateur doivent rester en français.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
])
