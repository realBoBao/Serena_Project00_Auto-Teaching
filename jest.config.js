/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^node:sqlite$': '<rootDir>/lib/sqlite_shim.js',
  },

  testMatch: ['**/tests/**/*.test.js'],
  // Skip tests that need API keys in CI environment
  testPathIgnorePatterns: process.env.CI === 'true' ? [
    'tests/PlannerAgent.test.js',
    'tests/manim_agent.test.js',
    'tests/embedding_cache.test.js',
    'tests/code_sandbox.test.js',
    'tests/sandbox_security.test.js',
    'tests/discord_bot.test.js',
    'tests/interaction_agent.test.js',
    'tests/orchestrator.test.js',
    'tests/rag_agent.test.js',
    'tests/self_evolution.test.js',
    'tests/knowledge_graph.test.js',
    'tests/lsm_tree.test.js',
    'tests/raft.test.js',
    'tests/work_stealer.test.js',
    'tests/coder_agent.test.js',
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
