import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // `tests/performance/**` is excluded from the default PARALLEL run; it has its
    // own single-threaded script, `npm run test:perf`.
    //
    // Those tests assert wall-clock budgets, which are meaningless while ~300 test
    // files compete for the same cores. `write-path-benchmarks` completes in 2.7s
    // alone and 35-58s in-suite, and its verdict flips on machine load rather than
    // on code: the `batch` term alone moved 37ms -> 1129ms between runs, swinging the
    // measured ratio from 71x (which PASSED) to 30x (which FAILED), because the
    // 10-second slack term dominates at small absolute times. An assertion decided by
    // the scheduler cannot detect a regression, and leaving it in the default gate
    // only teaches readers to ignore a red suite.
    //
    // `test:ci` already excluded this directory for the same reason. The default run
    // now matches it, and `test:perf` makes the measurement usable rather than merely
    // absent — previously a real perf regression was invisible in CI (excluded) and
    // unattributable locally (flaky), so nothing could catch one.
    // RUN_PERF=true opts back in — set by `npm run test:perf`, which also passes
    // --no-file-parallelism so the timings mean something.
    exclude: [
      '**/node_modules/**',
      ...(process.env.SKIP_BENCHMARKS ? ['**/benchmarks/**'] : []),
      ...(process.env.RUN_PERF === 'true' ? [] : ['**/tests/performance/**']),
    ],
    reporters: [
      'default',
      './tests/test-results/per-file-reporter.js',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/tests/**',
        'src/**/index.ts',
      ],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    // TODO(memoryjs): pre-existing Windows-specific cleanup race in
    // agent-memory tests — afterEach deletes temp dirs while in-flight
    // GraphStorage.durableWriteFile() promises are still resolving,
    // producing ENOENT unhandled rejections AFTER all tests pass.
    // Scoped enable via env var so default `npm test` still surfaces
    // the rejections for visibility, but `npm run test:ci` (used by
    // prepublishOnly) doesn't fail the publish gate on this known
    // latent issue. Real fix: track pending writes per-test and await
    // them in afterEach.
    dangerouslyIgnoreUnhandledErrors:
      process.env.IGNORE_UNHANDLED_REJECTIONS === 'true',
  },
});
