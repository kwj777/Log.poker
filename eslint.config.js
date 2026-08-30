// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*'],
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
    files: ['public/sw.js'],
    languageOptions: {
      // A service worker has neither DOM nor React Native globals.
      globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', Request: 'readonly', Response: 'readonly', URL: 'readonly' },
    },
  },
]);
