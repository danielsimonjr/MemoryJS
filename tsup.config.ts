import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library bundle
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    target: 'node18',
    shims: true,
    external: ['better-sqlite3'],
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
