// @ts-check
/**
 * ESLint flat config for MemoryJS.
 *
 * Enforces the three Phase 0 rules called out in
 * docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md step 1:
 *   - @typescript-eslint/no-explicit-any: error
 *   - no-console: error (with logger-implementation + CLI exceptions)
 *   - @typescript-eslint/no-floating-promises: error
 *
 * Plus one project-local rule:
 *   - memoryjs/no-unused-updateentity-return: error — the boolean returned
 *     by `storage.updateEntity()` signals whether the entity still existed
 *     (false = vanished mid-update). Discarding it is the recurring
 *     silent-failure pattern. See eslint-rules/no-unused-updateentity-return.mjs.
 *
 * Deliberately does NOT enable js.configs.recommended or the @typescript-eslint
 * recommended preset — those surface rules outside the Phase 0 scope and would
 * leak unrelated debt into step 2's logger work. Broader rule sets can land in
 * a later phase.
 */
import tseslint from 'typescript-eslint';
import noUnusedUpdateEntityReturn from './eslint-rules/no-unused-updateentity-return.mjs';

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
      memoryjs: {
        rules: {
          'no-unused-updateentity-return': noUnusedUpdateEntityReturn,
        },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'memoryjs/no-unused-updateentity-return': 'error',
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
