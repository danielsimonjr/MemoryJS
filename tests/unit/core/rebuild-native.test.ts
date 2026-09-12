import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

describe('native installation probe', () => {
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
        ['--require', preload, resolve('scripts/rebuild-native.mjs')],
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
