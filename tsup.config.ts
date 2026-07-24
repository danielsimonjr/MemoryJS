import { defineConfig } from 'tsup';

/**
 * Library entries (S7): the root plus one entry per module barrel, matching
 * the package.json `exports` subpaths (`./core`, `./search`, …, `./sqlite`).
 * Subpath consumers only load the module family they ask for — e.g.
 * `@danielsimonjr/memoryjs/search` never evaluates the SQLite backend, so the
 * better-sqlite3 native addon is never required.
 */
const libraryEntry = {
  index: 'src/index.ts',
  sqlite: 'src/sqlite.ts',
  'core/index': 'src/core/index.ts',
  'search/index': 'src/search/index.ts',
  'agent/index': 'src/agent/index.ts',
  'features/index': 'src/features/index.ts',
  'utils/index': 'src/utils/index.ts',
  'types/index': 'src/types/index.ts',
  'adapters/index': 'src/adapters/index.ts',
  'security/index': 'src/security/index.ts',
};

const libraryShared = {
  sourcemap: true,
  outDir: 'dist',
  target: 'node18' as const,
  shims: true,
  external: ['better-sqlite3'],
};

export default defineConfig([
  // Main library — ESM with code splitting: the subpath entries share chunks,
  // so module-level state (event emitters, caches, the StorageFactory
  // registry) is a single instance no matter which entries are imported.
  {
    entry: libraryEntry,
    format: ['esm'],
    dts: true,
    splitting: true,
    clean: true,
    ...libraryShared,
  },
  // Main library — CJS. esbuild/tsup does not split CJS output, so each entry
  // is a self-contained bundle. Correct in isolation; callers should avoid
  // mixing root and subpath require()s in one process (duplicate module state
  // / class identities). ESM consumers are unaffected (chunks are shared).
  {
    entry: libraryEntry,
    format: ['cjs'],
    dts: true,
    splitting: false,
    clean: false,
    ...libraryShared,
  },
  // CLI bundle
  {
    entry: ['src/cli/index.ts'],
    format: ['esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    outDir: 'dist/cli',
    target: 'node18',
    shims: true,
    external: ['better-sqlite3'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Worker files (must be separate for dynamic loading)
  {
    entry: ['src/workers/levenshteinWorker.ts'],
    format: ['esm', 'cjs'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    outDir: 'dist/workers',
    target: 'node18',
    shims: true,
  },
]);
