// @ts-check
/**
 * ESLint flat config for MemoryJS.
 *
 * Enforces only the three rules called out in
 * docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md Phase 0 step 1:
 *   - @typescript-eslint/no-explicit-any: error
 *   - no-console: error (with logger-implementation + CLI exceptions)
 *   - @typescript-eslint/no-floating-promises: error
 *
 * Deliberately does NOT enable js.configs.recommended or the @typescript-eslint
 * recommended preset — those surface rules outside the Phase 0 scope and would
 * leak unrelated debt into step 2's logger work. Broader rule sets can land in
 * a later phase.
 */
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'tools/',
      'tests/test-results/',
      'tests/',
      'benchmarks/',
      'docs/',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  // Logger implementations and the CLI legitimately use console.* directly.
  {
    files: [
      'src/cli/**/*.ts',
      'src/utils/logger.ts',
      'src/search/QueryLogger.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
];
