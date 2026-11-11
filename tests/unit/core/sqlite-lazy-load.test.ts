import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * Regression test for the lazy SQLite driver load (S9 follow-up).
 *
 * Importing the SQLiteStorage module (transitively, via the core barrel / root
 * package entry) must NOT load the SQLite driver — `node:sqlite` is required only
 * on first SQLiteStorage instantiation. This keeps JSONL-only consumers off
 * SQLite entirely, including its experimental-feature cost and, before Sprint 9,
 * the native addon's ABI-mismatch failure mode.
 *
 * `node:sqlite` is a builtin, so it never appears in `require.cache`. The child
 * therefore counts loads by wrapping `Module._load`, which is what a builtin
 * require goes through, and records whether the module asked for it before or
 * after the first instantiation.
 *
 * Run against the source through a child process with the tsx loader, where the
 * hook is meaningful. It probes the source module directly (not dist) so the
 * test tracks the source contract regardless of build state.
 */
describe('SQLiteStorage lazy driver load', () => {
  it('does not load node:sqlite merely by importing the module, but does on instantiation', () => {
    const script = `
      const Module = require('node:module');
      const original = Module._load;
      let loads = 0;
      Module._load = function (request, ...rest) {
        if (request === 'node:sqlite') loads++;
        return original.call(this, request, ...rest);
      };
      (async () => {
        // Import the source module via tsx's loader. Absolute paths must be
        // file:// URLs for the ESM loader — a bare Windows path ('C:\\\\...')
        // fails with ERR_UNSUPPORTED_ESM_URL_SCHEME ("Received protocol 'c:'"),
        // while a POSIX '/abs/path' happens to work. pathToFileURL is correct
        // on both.
        const { pathToFileURL } = require('node:url');
        const mod = await import(
          pathToFileURL(process.cwd() + '/src/core/SQLiteStorage.ts').href
        );
        const afterImport = loads;
        const os = require('os');
        const path = require('path');
        const file = path.join(os.tmpdir(), 'lazy-probe-' + Date.now() + '.db');
        const store = new mod.SQLiteStorage(file);
        try {
          await store.saveGraph({ entities: [], relations: [] });
          const afterUse = loads;
          process.stdout.write(JSON.stringify({ afterImport, afterUse }));
        } finally {
          store.close();
          const fs = require('node:fs');
          for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
        }
      })().catch((e) => { process.stderr.write(String(e)); process.exit(1); });
    `;
    // Node's import hook runs the same loader without the tsx CLI's IPC
    // listener, which is unnecessary here and unavailable in restricted CI.
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', '-e', script],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 },
    );
    const result = JSON.parse(out.trim().split('\n').pop() as string);
    expect(result.afterImport).toBe(0);
    expect(result.afterUse).toBeGreaterThan(0);
  }, 70000);
});
