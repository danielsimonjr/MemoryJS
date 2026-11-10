/**
 * Inventory guard for the in-repo worker pool.
 *
 * Sprint 8 replaced `@danielsimonjr/workerpool` 10.2.0 with
 * `src/utils/threadPool.ts`, implementing only the slice MemoryJS uses. This
 * test pins both halves of that claim:
 *
 * 1. Nothing under `src/`, `scripts/`, `tests/`, or `benchmarks/` imports the
 *    removed package, so it cannot creep back in as an accidental dependency.
 * 2. Every pool member `src/` reaches for is implemented. A new
 *    `pool.<member>(...)`, `workerpool.<member>`, or promise-chain method
 *    appears here as an offender rather than as a runtime `TypeError` in
 *    production.
 *
 * Comment mentions of workerpool are allowed and expected: they explain why a
 * call site is shaped the way it is.
 *
 * @module tests/unit/workers/WorkerPool
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

/** Every `.ts`/`.tsx`/`.mjs` file under a directory, recursively. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(?:ts|tsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Pool members `src/` uses.
 *
 * `pool`, `exec`, `stats`, and `terminate` are the calls; `cpus` and `worker`
 * are the module-level helpers; `timeout`, `cancel`, and `pending` are the
 * exec-promise surface `WorkerTaskManager` reads.
 */
const INVENTORY_MEMBERS = new Set([
  'cancel',
  'cpus',
  'exec',
  'pending',
  'pool',
  'stats',
  'terminate',
  'timeout',
  'worker',
]);

/** Strip comments and string literals so prose and fixtures do not count. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Repository-relative path with forward slashes, so comparisons are host-independent. */
function relativePath(file: string): string {
  return relative(ROOT, file).split('\\').join('/');
}

const srcFiles = sourceFiles(join(ROOT, 'src'));

describe('workerpool inventory', () => {
  it('finds the source tree', () => {
    expect(srcFiles.length).toBeGreaterThan(100);
  });

  it('allows exactly one reference to the removed package: the live differential test', () => {
    // `threadPool.live.test.ts` imports the package dynamically, skips itself when
    // it is absent, and exists so a re-record can be checked against the real
    // thing. Every other file must be free of it, and this assertion is an exact
    // set so a second importer fails here rather than silently reinstating the
    // dependency.
    const importers: string[] = [];
    for (const dir of ['src', 'scripts', 'tests', 'benchmarks']) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        // Raw source: a specifier is a string literal, which `codeOf` erases.
        // Comments that name the package stay allowed; only a real import of the
        // specifier counts.
        const source = readFileSync(file, 'utf8');
        const specifierUse =
          /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])@danielsimonjr\/workerpool\1/;
        if (specifierUse.test(source)) importers.push(relativePath(file));
      }
    }
    expect(importers.sort()).toEqual(['tests/unit/utils/threadPool.live.test.ts']);
  });

  it('declares no dependency on the removed package', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(manifest[field]?.['@danielsimonjr/workerpool'], `package.json ${field}`).toBeUndefined();
    }
  });

  it('does not import the pool from a package bare specifier', () => {
    // `threadPool.ts` is the only module that may touch `node:worker_threads`
    // directly; everything else goes through it, so `workerType: 'process'`
    // and the worker message protocol stay in one place.
    const offenders = srcFiles
      .filter((file) => !file.endsWith(join('utils', 'threadPool.ts')))
      .filter((file) => /from\s+['"]node:(?:worker_threads|child_process)['"]/.test(readFileSync(file, 'utf8')))
      .map(relativePath);
    expect(offenders).toEqual([]);
  });

  it('uses only pool members the module implements', () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      if (file.endsWith(join('utils', 'threadPool.ts'))) continue;
      const source = readFileSync(file, 'utf8');
      const code = codeOf(source);
      // Aliases that hold a pool, from any factory that returns one. The
      // PostgreSQL `Pool` lives only in PostgreSQLStorage and is not this pool,
      // so the scan is keyed on the factories rather than on the name `pool`.
      const aliases = new Set<string>(['workerPool']);
      for (const match of code.matchAll(
        /(?:const|let|var|readonly)?\s*([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:this\.)?(?:createThreadPool|getPool|createPool|pool)\s*\(/g,
      )) {
        aliases.add(match[1]!);
      }
      for (const match of code.matchAll(/(?:this\.)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.getPool\(/g)) {
        aliases.add(match[1]!);
      }
      for (const alias of aliases) {
        const escaped = alias.replace(/[$]/g, '\\$');
        for (const match of code.matchAll(
          new RegExp(`\\b${escaped}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g'),
        )) {
          const member = match[1]!;
          if (!INVENTORY_MEMBERS.has(member)) offenders.push(`${relativePath(file)}: ${alias}.${member}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lists exactly the members the call sites need', () => {
    // Guards the guard: the set above must stay in step with the module's surface.
    expect([...INVENTORY_MEMBERS].sort()).toEqual([
      'cancel',
      'cpus',
      'exec',
      'pending',
      'pool',
      'stats',
      'terminate',
      'timeout',
      'worker',
    ]);
  });
});
