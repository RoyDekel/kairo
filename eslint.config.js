import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

/*
  This repo runs code in three different environments, and a single browser-globals
  config was being applied to all of them. That reported `process` as undefined in every
  server file and `global` as undefined in every test — roughly 25 phantom errors that
  buried the real ones and made `npm run lint` useless as a signal.
*/
export default defineConfig([
  globalIgnores(['dist', 'test-results', 'playwright-report']),

  // Browser: the React application.
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Node: Express backend, isomorphic shared modules, and tooling config.
  // shared/ is imported by both runtimes but touches no environment globals.
  {
    files: [
      'server.js',
      'server/**/*.js',
      'shared/**/*.js',
      'tests/**/*.js',
      '*.config.js',
    ],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Tests: jsdom document plus the Node globals vitest exposes.
  {
    files: ['**/__tests__/**/*.{js,jsx}', '**/*.test.{js,jsx}', 'src/setupTests.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
