#!/usr/bin/env node
// Node runtime smoke for the shipped artifact.
//
// 1. Load ./dist/index.cjs and ./dist/sqlite.cjs under Node.
// 2. Open an in-memory SQLite database through the package's own
//    better-sqlite3 dependency and execute real statements. Requiring the JS
//    wrapper alone does not load the native binding; `new Database()` does.
//
// Every step has a deadline. A deadline that expires is a FAILURE (exit 1):
// a hung import is a defect, never a pass.
//
// Test seam: SMOKE_SIMULATE_HANG=1 replaces the import with a promise that
// never settles, to prove that the deadline fails the job.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
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
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare('INSERT INTO smoke (name) VALUES (?)').run('alpha');
    const row = db.prepare('SELECT COUNT(*) AS n, MAX(name) AS name FROM smoke').get();
    if (row?.n !== 1 || row?.name !== 'alpha') {
      throw new Error(`unexpected query result ${JSON.stringify(row)}`);
    }
    console.log(`ok: in-memory SQLite executed statements (sqlite ${db.prepare('SELECT sqlite_version() AS v').get().v})`);
  } finally {
    db.close();
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
