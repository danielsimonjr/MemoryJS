#!/usr/bin/env node
// Node runtime smoke for the shipped artifact.
//
// 1. Load ./dist/index.cjs and ./dist/sqlite.cjs under Node.
// 2. Drive the shipped SQLite backend end to end through its own export:
//    create a database, write a graph, read it back, and run an FTS5 query.
//    Since Sprint 9 the driver is Node's built-in `node:sqlite`, so this also
//    proves the runtime's SQLite has FTS5 — the failure that used to appear as
//    "no such module: fts5" on Node 22.13-22.15.
//
// Every step has a deadline. A deadline that expires is a FAILURE (exit 1):
// a hung import is a defect, never a pass.
//
// Test seam: SMOKE_SIMULATE_HANG=1 replaces the import with a promise that
// never settles, to prove that the deadline fails the job.
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEADLINE_MS = Number(process.env.SMOKE_DEADLINE_MS ?? 30000);
const root = resolve(process.argv[2] ?? '.');

const deadline = setTimeout(() => {
  console.error(`FAIL: smoke did not finish within ${DEADLINE_MS} ms (hung import or query)`);
  process.exit(1);
}, DEADLINE_MS);

async function main() {
  for (const entry of ['dist/index.cjs', 'dist/sqlite.cjs']) {
    const url = pathToFileURL(resolve(root, entry)).href;
    if (process.env.SMOKE_SIMULATE_HANG === '1') await new Promise(() => setInterval(() => {}, 1000));
    await import(url);
    console.log(`ok: loaded ${entry} under Node ${process.version}`);
  }

  const require = createRequire(resolve(root, 'dist/index.cjs'));

  // The shipped bundle must not need a native addon. If it resolves one, the
  // dependency removal regressed.
  try {
    require.resolve('better-sqlite3');
    throw new Error('dist/index.cjs still resolves better-sqlite3');
  } catch (error) {
    if (error?.message === 'dist/index.cjs still resolves better-sqlite3') throw error;
    console.log('ok: better-sqlite3 is not resolvable (node:sqlite is the driver)');
  }

  const { SQLiteStorage } = require(resolve(root, 'dist/sqlite.cjs'));
  if (typeof SQLiteStorage !== 'function') {
    throw new Error('dist/sqlite.cjs does not export SQLiteStorage');
  }

  const dir = mkdtempSync(join(tmpdir(), 'memoryjs-smoke-'));
  const dbPath = join(dir, 'smoke.db');
  const storage = new SQLiteStorage(dbPath);
  try {
    await storage.saveGraph({
      entities: [
        { name: 'alpha', entityType: 'note', observations: ['the zephyr blows'] },
        { name: 'beta', entityType: 'note', observations: ['ordinary content'] },
      ],
      relations: [{ from: 'alpha', to: 'beta', relationType: 'references' }],
    });
    const graph = await storage.loadGraph();
    if (graph.entities.length !== 2 || graph.relations.length !== 1) {
      throw new Error(`unexpected graph ${JSON.stringify(graph)}`);
    }
    const hits = storage.fullTextSearch('zephyr');
    if (hits.length !== 1 || hits[0].name !== 'alpha') {
      throw new Error(`unexpected FTS5 result ${JSON.stringify(hits)}`);
    }
    console.log(`ok: shipped SQLite backend wrote, read and searched (FTS5 rank ${hits[0].score.toFixed(6)})`);
  } finally {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().then(
  () => {
    clearTimeout(deadline);
    console.log('PASS: shipped artifact loads and SQLite executes under Node');
    process.exit(0);
  },
  (err) => {
    clearTimeout(deadline);
    console.error(`FAIL: ${err?.stack ?? err}`);
    process.exit(1);
  },
);
