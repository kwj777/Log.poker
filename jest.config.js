/**
 * Tests cover the data layer and the domain math -- pure TypeScript with no
 * React Native imports, so they run on plain ts-jest in Node rather than
 * needing the (much slower) jest-expo native preset.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/data/**/*.ts', '!src/data/**/expoSqliteDriver.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
