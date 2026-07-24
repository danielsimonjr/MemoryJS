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
  // S10: the types layer must stay a leaf — it may not import from
  // implementation directories (type-only imports included: they still create
  // tsc/IDE recompile fan-out and dependency-graph cycles). Shared types get
  // moved INTO src/types and re-exported from the implementation module.
  {
    files: ['src/types/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/agent/**',
                '**/core/**',
                '**/utils/**',
                '**/search/**',
                '**/features/**',
                '**/adapters/**',
                '**/security/**',
                '**/cli/**',
                '**/workers/**',
              ],
              message:
                'src/types must remain a leaf layer. Move the shared type into src/types ' +
                'and re-export it from the implementation module instead (see S10 in ' +
                'docs/development/OPTIMIZATION_OPPORTUNITIES.md).',
            },
          ],
        },
      ],
      // no-restricted-imports does not see inline `import('...')` type
      // annotations — the historical escape hatch that created all 37+
      // type-only cycles. Catch those too.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSImportType Literal[value=/\\.\\.\\u002F(agent|core|utils|search|features|adapters|security|cli|workers)\\u002F/]",
          message:
            'src/types must remain a leaf layer: inline import() types from implementation ' +
            'directories are forbidden. Move the shared type into src/types and re-export ' +
            'it from the implementation module instead (S10).',
        },
      ],
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
