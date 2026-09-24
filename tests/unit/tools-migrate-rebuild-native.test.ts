import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// This repo's OWN scripts/rebuild-native.mjs already has the functional check (see
// tests/unit/core/rebuild-native.test.ts). Its sibling copy at
// tools/migrate-from-jsonl-to-sqlite/scripts/rebuild-native.mjs is the OLD, pre-fix version: that
// tool has its own package.json (own postinstall/rebuild:native scripts, own better-sqlite3
// dependency, own node_modules), so it is not dead code and needed the same fix ported in place
// rather than deleted. Its `loads(pkg)` only did `require('better-sqlite3')`, which detects a
// MISSING module but not one that is PRESENT and broken: ABI-mismatched to the running Node, or
// failing at lazy load. better-sqlite3 compiles its native binding lazily, in the Database
// constructor - requiring the JS wrapper alone never touches it. This test proves the functional
// check (`:memory:` open + `SELECT 1` + close) catches exactly that failure mode.
describe('migrate-from-jsonl-to-sqlite native installation probe', () => {
  it('detects lazy constructor failure and verifies after rebuilding', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'native-probe-'));
    const preload = join(dir, 'preload.cjs');
    try {
      // Exercise the real postinstall script, isolating the addon and npm command.
      await writeFile(preload, `
        const Module = require('node:module');
        const cp = require('node:child_process');
        const load = Module._load;
        let rebuilt = false;
        Module._load = function(name, ...args) {
          if (name !== 'better-sqlite3') return load.call(this, name, ...args);
          return class Database {
            constructor() { if (!rebuilt) throw new Error('Missing native binding'); }
            prepare() { return { get() { console.log('probe-query'); } }; }
            close() { console.log('probe-close'); }
          };
        };
        cp.spawnSync = () => { rebuilt = true; console.log('probe-rebuild'); return { status: 0 }; };
        Module.syncBuiltinESMExports();
      `);
      const out = execFileSync(process.execPath,
        ['--require', preload, resolve('tools/migrate-from-jsonl-to-sqlite/scripts/rebuild-native.mjs')],
        { encoding: 'utf8', timeout: 10000 });
      expect(out).toContain('Missing native binding');
      expect(out).toContain('probe-rebuild');
      expect(out).toContain('probe-query');
      expect(out).toContain('probe-close');
      expect(out).toContain('OK - loads after rebuild');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
