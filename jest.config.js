/**
 * Two suites, because they are two different costs.
 *
 * **node** is the domain and the data layer: pure TypeScript with no React
 * Native imports, on plain ts-jest in Node. It is the bulk of the suite and it
 * runs in about fifteen seconds, which is what makes it worth running on every
 * save. Nothing here is allowed to slow that down.
 *
 * **ui** is everything that renders, on the `jest-expo` preset, which is the
 * much heavier one: a React Native environment, the whole module graph, and a
 * transform over `node_modules`. Kept as its own project so it cannot leak its
 * setup or its startup cost into the suite above.
 *
 * The split is by extension rather than by folder. A test that renders is a
 * `.tsx` file and a test that does not is a `.ts` file, which is a rule nobody
 * has to remember, because it is already true of the thing being tested.
 */

/** @type {import('jest').Config} */
const node = {
  displayName: 'node',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};

/** @type {import('jest').Config} */
const ui = {
  displayName: 'ui',
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.tsx'],
  setupFiles: ['<rootDir>/jest.setup.ui.js'],
};

module.exports = {
  projects: [node, ui],
  collectCoverageFrom: [
    'src/domain/**/*.ts',
    'src/data/**/*.ts',
    'src/auth/**/*.ts',
    // Both exclusions are native modules with nothing to run in Node.
    '!src/data/**/expoSqliteDriver.ts',
    '!src/auth/tokenStore.ts',
  ],
};
