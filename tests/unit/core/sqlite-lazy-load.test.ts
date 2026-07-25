import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Regression test for the lazy better-sqlite3 load (S9 follow-up).
 *
 * Importing the SQLiteStorage module (transitively, via the core barrel /
 * root package entry) must NOT load the native `better-sqlite3` addon — the
 * addon is loaded only on first SQLiteStorage instantiation. This keeps
 * JSONL-only consumers off the native binding entirely, including its
 * ABI-mismatch failure mode.
 *
 * Run against the source through a child `tsx`/`node --import` process where
 * `require.cache` is meaningful, using the CJS resolution of the module tree.
 * We probe the source module directly (not dist) so the test tracks the
 * source contract regardless of build state.
 */
describe('SQLiteStorage lazy native-addon load', () => {
  it('does not load better-sqlite3 merely by importing the module, but does on instantiation', () => {
    const script = `
      const { createRequire } = require('node:module');
      const req = createRequire(process.cwd() + '/package.json');
      // Register a probe: check whether better-sqlite3 is resolved in cache.
      function loaded() {
        return Object.keys(require.cache).some((k) => k.includes('better-sqlite3'));
      }
      (async () => {
        // Import the source module via tsx's loader. Absolute paths must be
        // file:// URLs for the ESM loader — a bare Windows path ('C:\\...')
        // fails with ERR_UNSUPPORTED_ESM_URL_SCHEME ("Received protocol 'c:'"),
        // while a POSIX '/abs/path' happens to work. pathToFileURL is correct
        // on both.
        const { pathToFileURL } = require('node:url');
        const mod = await import(
          pathToFileURL(process.cwd() + '/src/core/SQLiteStorage.ts').href
        );
        const afterImport = loaded();
        // Instantiate against a temp file and force initialize via a write path.
        const os = require('os');
        const path = require('path');
        const file = path.join(os.tmpdir(), 'lazy-probe-' + Date.now() + '.db');
        const store = new mod.SQLiteStorage(file);
        await store.saveGraph({ entities: [], relations: [] });
        const afterUse = loaded();
        process.stdout.write(JSON.stringify({ afterImport, afterUse }));
      })().catch((e) => { process.stderr.write(String(e)); process.exit(1); });
    `;
    // Invoke the locally-installed tsx CLI through `process.execPath` rather
    // than `npx tsx`. `execFileSync` does not spawn a shell, and on Windows
    // `npx` is `npx.cmd` — resolvable only via PATHEXT — so the npx form died
    // with `spawnSync npx ENOENT` on Windows while passing on POSIX. Running
    // the CLI directly is also deterministic (uses the pinned devDependency,
    // never a network fetch) and skips npx's resolution overhead.
    const require = createRequire(import.meta.url);
    const tsxCli = require.resolve('tsx/cli');
    const out = execFileSync(
      process.execPath,
      [tsxCli, '-e', script],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 },
    );
    const result = JSON.parse(out.trim().split('\n').pop() as string);
    expect(result.afterImport).toBe(false);
    expect(result.afterUse).toBe(true);
  }, 70000);
});
