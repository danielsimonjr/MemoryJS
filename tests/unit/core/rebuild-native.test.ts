import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The install-time native guard.
 *
 * `scripts/rebuild-native.mjs` ships in the published tarball and runs from
 * `postinstall`. Since Sprint 9 it has nothing to rebuild: the SQLite backend is
 * Node's built-in `node:sqlite`, so the package declares no native addon. These
 * tests pin the two properties that keep a consumer's install safe — it always
 * exits 0, and it still ships with the dependency list it guards — plus the
 * absence of the native dependency itself.
 */
describe('native installation guard (scripts/rebuild-native.mjs)', () => {
  it('exits 0 and reports that there are no native addons', () => {
    const out = execFileSync(process.execPath, [resolve('scripts/rebuild-native.mjs')], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(out).toContain('no native addons');
    expect(out).toContain('node:sqlite');
  });

  it('is still listed in package.json files and run from postinstall', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      files: string[];
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.files).toContain('scripts/rebuild-native.mjs');
    expect(manifest.scripts.postinstall).toBe('node scripts/rebuild-native.mjs');
    // No native runtime dependency is declared, which is why the guard is a check.
    expect(manifest.dependencies?.['better-sqlite3']).toBeUndefined();
    expect(manifest.devDependencies?.['@types/better-sqlite3']).toBeUndefined();
  });

  it('declares no NATIVE entries, matching the dependency list', () => {
    const script = readFileSync(resolve('scripts/rebuild-native.mjs'), 'utf8');
    expect(script).toMatch(/const NATIVE = \[\];/);
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies });
    for (const native of ['better-sqlite3', 'sharp', 'canvas']) {
      expect(declared).not.toContain(native);
    }
  });
});
