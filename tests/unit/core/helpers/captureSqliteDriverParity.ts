/**
 * One-time recorder for `tests/unit/core/fixtures/sqliteDriverParity.json`.
 *
 * Sprint 9 replaced the native `better-sqlite3` addon with Node's built-in
 * `node:sqlite`, behind `src/core/nodeSqliteAdapter.ts`. The parity claim is
 * that the adapter behaves like the package it replaced wherever MemoryJS
 * touches SQLite. This recorder captures that behaviour from the real package
 * while it is still installable, and `sqlite-driver-parity.test.ts` replays the
 * same corpus through the adapter.
 *
 * `better-sqlite3` is no longer a dependency, so the recorder cannot import it
 * from this repository. Point `BETTER_SQLITE3_PATH` at a scratch install:
 *
 *   mkdir -p /tmp/bs3 && cd /tmp/bs3 && npm init -y && npm install better-sqlite3@13.0.3
 *   BETTER_SQLITE3_PATH=/tmp/bs3/node_modules/better-sqlite3 \
 *     npx tsx tests/unit/core/helpers/captureSqliteDriverParity.ts
 *
 * The import is dynamic on purpose: this file must not reintroduce a static
 * `better-sqlite3` import into the repository. It is a development aid, so it is
 * not part of the build or the test run.
 *
 * @module tests/unit/core/helpers/captureSqliteDriverParity
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCorpus, type CorpusCtor } from './sqliteDriverCases.js';

const packagePath = process.env.BETTER_SQLITE3_PATH;
if (!packagePath) {
  throw new Error(
    'Set BETTER_SQLITE3_PATH to a better-sqlite3@13.0.3 install path before recording ' +
      '(see the header of this file).',
  );
}

const imported = (() => {
  // `better-sqlite3` is CommonJS. Resolve it the way a caller of that scratch
  // install would, so the recorder works whether the path names the package
  // directory or a file inside it.
  const require = createRequire(join(packagePath, 'package.json'));
  return { default: require(packagePath) as new (path: string, options?: { readonly?: boolean }) => unknown };
})();

const dir = mkdtempSync(join(tmpdir(), 'memoryjs-parity-capture-'));
try {
  const record = runCorpus(imported.default as unknown as CorpusCtor, (name) => join(dir, name));
  const out = process.argv[2] ?? resolve(
    import.meta.dirname,
    '..',
    'fixtures',
    'sqliteDriverParity.json',
  );
  writeFileSync(out, `${JSON.stringify({ betterSqlite3: '13.0.3', record }, null, 2)}\n`);
  console.log(`wrote ${out}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
