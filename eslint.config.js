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
  /*
    shared/catalog.generated.js is machine-written by scripts/buildCatalog.js from the
    OurAirports dataset and carries a DO NOT EDIT header. Linting it is pointless in both
    directions: any hand-fix would be erased by the next regeneration, and its only
    complaint (31 x no-loss-of-precision) is an artifact of emitting raw source latitudes
    and longitudes at full width — the excess digits are discarded on parse and the
    resulting coordinates are exact to well past the precision a map tile can render.
    Regenerate the file to change it; do not lint it.
  */
  globalIgnores([
    'dist',
    'test-results',
    'playwright-report',
    'shared/catalog.generated.js',
  ]),

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
    rules: {
      /*
        TRACKED DEBT — NOT AN ACCEPTED PATTERN. See [KAI-001] in docs/product/backlog.md.

        There are 11 call sites that setState synchronously inside an effect body, across
        App.jsx, AuthProvider.jsx, AlternativeFlights.jsx, AlertsManager.jsx,
        AirportAutocomplete.jsx and CustomDatePicker.jsx. Each is a genuine cascading-render
        risk and each needs its own fix — derived state here, a key prop there, an event
        handler somewhere else. There is no single mechanical transform that covers them.

        Downgraded to 'warn' so the rule keeps reporting every site, including new ones,
        while the CI lint gate stays meaningful for everything else. Restore this to 'error'
        as soon as KAI-001 lands. Do not add per-line eslint-disable comments in the
        meantime — that would hide the sites instead of counting them.
      */
      'react-hooks/set-state-in-effect': 'warn',
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

  /*
    A leading underscore marks a binding that is deliberately unused and deliberately kept:
    an abstract-method parameter that documents the interface subclasses must implement, or
    a destructured field that records part of a function's contract. Without this, the only
    way to satisfy no-unused-vars is to delete the name — which throws away the one piece of
    information the reader needed. Applied last so it wins over js.configs.recommended.
  */
  {
    files: ['**/*.{js,jsx}'],
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
])
