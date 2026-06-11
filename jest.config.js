/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/tests/**/*.test.js'],
  // Skip tests that need API keys in CI environment
  testPathIgnorePatterns: process.env.CI === 'true' ? [
    'tests/PlannerAgent.test.js',
    'tests/manim_agent.test.js',
    'tests/embedding_cache.test.js',
    'tests/code_sandbox.test.js',
  ] : [],
  collectCoverageFrom: [
    'lib/**/*.js',
    'agents/**/*.js',
    '!lib/vector_store_qdrant.js',
  ],
  // Exclude directories that cause Haste naming collisions
  modulePathIgnorePatterns: [
    '<rootDir>/artifacts/',
    '<rootDir>/backups/',
    '<rootDir>/node_modules/',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],

  detectOpenHandles: true,
};
