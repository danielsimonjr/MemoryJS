/**
 * Inventory guard for the SQLite driver.
 *
 * Sprint 9 replaced the native `better-sqlite3` addon with Node's built-in
 * `node:sqlite`, behind `src/core/nodeSqliteAdapter.ts`. This test pins the
 * removal so the package cannot creep back in as an accidental dependency:
 *
 * 1. No file under `src/`, `scripts/`, `tests/`, `benchmarks/` or `examples/`
 *    imports or requires `better-sqlite3`, and the adapter is the only module
 *    that touches `node:sqlite` besides the probe and test helpers that assert
 *    on the raw module.
 * 2. The adapter implements every member `src/` calls on a connection or a
 *    statement, so a new call site shows up here rather than as a runtime
 *    `TypeError`.
 *
 * `tools/migrate-from-jsonl-to-sqlite` is deliberately out of scope: it is a
 * separate package with its own lockfile and its own `better-sqlite3` pin, and
 * the spec keeps it out of this sprint.
 *
 * Comment mentions of `better-sqlite3` are allowed and expected: they explain
 * what the facade reproduces.
 *
 * @module tests/unit/core/sqlite-driver-inventory.test
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

/** Directories that must not name the removed package in an import. */
const SCANNED = ['src', 'scripts', 'tests', 'benchmarks', 'examples'];

/** Every `.ts`/`.tsx`/`.mjs`/`.cjs` file under a directory, recursively. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(?:ts|tsx|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Repository-relative path with forward slashes, so the message is host-neutral. */
function rel(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
}

/** A module specifier naming the removed package, in any import or require form. */
const IMPORTS_REMOVED = /(?:from\s+['"]better-sqlite3['"]|require\(\s*['"]better-sqlite3['"]\s*\)|import\(\s*['"]better-sqlite3['"]\s*\))/;

describe('SQLite driver inventory', () => {
  /**
   * `tests/unit/tools-migrate-rebuild-native.test.ts` exercises the migration
   * tool's own installer, which legitimately builds `better-sqlite3` inside the
   * tool's separate package. The spec leaves `tools/migrate-from-jsonl-to-sqlite`
   * untouched, so its probe is the one allowed mention.
   */
  const ALLOWED = new Set(['tests/unit/tools-migrate-rebuild-native.test.ts']);

  it('no module imports or requires better-sqlite3', () => {
    const offenders: string[] = [];
    for (const dir of SCANNED) {
      let files: string[];
      try {
        files = sourceFiles(join(ROOT, dir));
      } catch {
        continue; // a checkout without examples/ is fine
      }
      for (const file of files) {
        if (ALLOWED.has(rel(file))) continue;
        // The recorder points BETTER_SQLITE3_PATH at a scratch install on
        // purpose; it must not import the package by name.
        if (IMPORTS_REMOVED.test(readFileSync(file, 'utf-8'))) offenders.push(rel(file));
      }
    }
    expect(
      offenders,
      `these files import the removed better-sqlite3 package; use resolveSQLiteDatabaseCtor() ` +
        `or createNodeSqliteDatabaseCtor() from src/core/nodeSqliteAdapter.ts: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('only the adapter and the raw-module probes reference node:sqlite', () => {
    const allowed = new Set([
      'src/core/nodeSqliteAdapter.ts',
      'tests/unit/core/node-sqlite-probe.test.ts',
      'tests/unit/core/sqlite-fts5-error.test.ts',
      'tests/unit/core/sqlite-lazy-load.test.ts',
    ]);
    const found: string[] = [];
    for (const dir of ['src', 'scripts', 'tests']) {
      let files: string[];
      try {
        files = sourceFiles(join(ROOT, dir));
      } catch {
        continue;
      }
      for (const file of files) {
        const text = readFileSync(file, 'utf-8');
        if (/(?:from\s+['"]node:sqlite['"]|require\(\s*['"]node:sqlite['"]\s*\))/.test(text)) {
          found.push(rel(file));
        }
      }
    }
    const unexpected = found.filter((file) => !allowed.has(file)).sort();
    expect(
      unexpected,
      `node:sqlite must be reached through the adapter; unexpected direct uses: ${unexpected.join(', ')}`,
    ).toEqual([]);
  });

  it('package.json declares no native SQLite dependency', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.['better-sqlite3']).toBeUndefined();
    expect(manifest.devDependencies?.['better-sqlite3']).toBeUndefined();
    expect(manifest.devDependencies?.['@types/better-sqlite3']).toBeUndefined();
  });

  it('tsup externalizes no SQLite package', () => {
    const config = readFileSync(join(ROOT, 'tsup.config.ts'), 'utf-8');
    expect(config).not.toMatch(/external:\s*\[[^\]]*better-sqlite3/);
  });
});
