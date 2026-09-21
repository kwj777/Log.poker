// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*'],
  },
  {
    /**
     * The three serverless functions, which `eslint .` walked straight past.
     *
     * `eslint-config-expo` names `**` + `/*.ts` and `.tsx`, and Netlify's
     * functions are `.mts`, so the sync endpoint, the sign-in endpoint and the
     * sweep -- the whole of the server, and the most security-sensitive code
     * here -- were linted by nothing. An assignment inside an `if` and an
     * unused binding both passed `npm run lint` with exit 0, and so did the CI
     * job that runs it.
     *
     * The parser and rules come from the block above by borrowing its `files`;
     * this only adds the extension to the set eslint looks at.
     */
    files: ['**/*.mts'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        crypto: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
      },
    },
  },
  {
    // Build-time scripts run in Node, not in the app runtime, so they get Node
    // globals rather than React Native's.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', 'jest.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly', __dirname: 'readonly' },
    },
  },
  {
    files: ['src/data/dexie/**'],
    rules: {
      // Dexie ships both a default and a same-named export; importing the
      // default as `Dexie` is exactly what its own documentation prescribes.
      'import/no-named-as-default': 'off',
    },
  },
  {
    // A Jest setup file runs in Jest, which is neither of the above.
    files: ['jest.setup.ui.js'],
    languageOptions: {
      globals: { jest: 'readonly' },
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      // A service worker has neither DOM nor React Native globals.
      globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', Request: 'readonly', Response: 'readonly', URL: 'readonly' },
    },
  },
]);
