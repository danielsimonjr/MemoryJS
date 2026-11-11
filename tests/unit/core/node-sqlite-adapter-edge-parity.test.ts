/**
 * Challenger tests: better-sqlite3 13.0.3 parity on adapter paths the Sprint 9
 * parity corpus does not cover.
 *
 * Every expectation here was verified against the real `better-sqlite3`
 * 13.0.3 addon (installed from npm in a scratch directory) before being
 * written down and replayed against `src/core/nodeSqliteAdapter.ts`.
 *
 * Covered gaps:
 * - `close()` on an already-closed database (better-sqlite3: silent no-op);
 * - a failed open (missing directory) — better-sqlite3 raises a `TypeError`
 *   before SQLite is opened; the adapter used to leak Node's raw
 *   `ERR_SQLITE_ERROR`;
 * - a transaction function invoked after `close()` — better-sqlite3 raises the
 *   same `TypeError` as every other closed-handle call, the adapter leaks the
 *   raw `ERR_INVALID_STATE` error;
 * - transaction state after a failed `COMMIT` — better-sqlite3 keeps nesting
 *   working, the adapter double-decrements its savepoint depth so the next
 *   nested transaction fails with "cannot start a transaction within a
 *   transaction";
 * - statement-kind enforcement — better-sqlite3 refuses `get()`/`all()` on a
 *   statement that returns no data and zeroes `changes`/`lastInsertRowid` for
 *   `run()` on a reader; the adapter silently does whatever `node:sqlite` does;
 * - a bigint outside the int64 range — better-sqlite3 raises a `RangeError`
 *   with its own text, the adapter leaks Node's `TypeError`.
 *
 * `node:sqlite` does not exist in Bun, so the file skips when Vitest is hosted
 * by Bun (`typeof Bun !== 'undefined'`) and never skips on the Node lane
 * (`bun run test:ci`).
 *
 * @module tests/unit/core/node-sqlite-adapter-edge-parity.test
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeSqliteDatabaseCtor, SqliteError } from '../../../src/core/nodeSqliteAdapter.js';
import type { SqliteDatabase } from '../../../src/core/nodeSqliteAdapter.js';

describe.skipIf(typeof Bun !== 'undefined')('node:sqlite adapter edge parity (better-sqlite3 13.0.3)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memoryjs-adapter-edge-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const open = (...args: ConstructorParameters<ReturnType<typeof createNodeSqliteDatabaseCtor>>): SqliteDatabase =>
    new (createNodeSqliteDatabaseCtor())(...args);

  it('treats a second close() as a no-op, like better-sqlite3', () => {
    const db = open(join(dir, 'a.db'));
    db.exec('CREATE TABLE t (v INTEGER)');
    db.close();
    // better-sqlite3 13.0.3: `db.close()` on a closed database does not throw;
    // it returns the database object.
    expect(() => db.close()).not.toThrow();
  });

  it('raises better-sqlite3\'s TypeError when the parent directory is missing', () => {
    // better-sqlite3 13.0.3: TypeError "Cannot open database because the
    // directory does not exist" (no `code` property). node:sqlite instead
    // opens through SQLite and surfaces `ERR_SQLITE_ERROR` / errcode 14.
    let thrown: unknown;
    try {
      open(join(dir, 'missing-dir', 'b.db'));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toBe(
      'Cannot open database because the directory does not exist',
    );
  });

  it('raises the closed-connection TypeError when a transaction function is called after close()', () => {
    const db = open(join(dir, 'c.db'));
    const tx = db.transaction(() => 1);
    db.close();
    let thrown: unknown;
    try {
      tx();
    } catch (error) {
      thrown = error;
    }
    // better-sqlite3: TypeError "The database connection is not open" — the
    // same shape every other closed-handle call raises, and what the adapter
    // promises in its header comment.
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toBe('The database connection is not open');
  });

  it('keeps transaction nesting working after a failed COMMIT (deferred foreign key)', () => {
    // A deferred foreign-key violation fires at COMMIT, so COMMIT itself
    // throws. better-sqlite3 13.0.3 recovers: the failed transaction rolls
    // back, child rows are gone, and a later nested transaction still works.
    // The adapter decrements its savepoint depth both before COMMIT and again
    // in the catch, so the counter goes negative and the next nested
    // transaction issues a bare BEGIN inside the still-open outer
    // transaction: "cannot start a transaction within a transaction".
    const db = open(join(dir, 'd.db'));
    db.pragma('foreign_keys = ON');
    db.exec(
      'CREATE TABLE parent (id INTEGER PRIMARY KEY);'
        + 'CREATE TABLE child (id INTEGER PRIMARY KEY, pid REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)',
    );

    const bad = db.transaction(() => {
      db.prepare('INSERT INTO child VALUES (1, 2)').run();
    });
    expect(() => bad()).toThrow(SqliteError);
    expect(db.prepare('SELECT count(*) AS c FROM child').get()).toEqual({ c: 0 });

    const nested = db.transaction(() => {
      const inner = db.transaction(() => 'inner');
      return inner();
    });
    expect(nested()).toBe('inner');
  });

  it('refuses get()/all() on a statement that returns no data, like better-sqlite3', () => {
    const db = open(join(dir, 'e.db'));
    db.exec('CREATE TABLE t (v INTEGER)');
    // better-sqlite3 13.0.3: TypeError "This statement does not return data.
    // Use run() instead". The adapter silently returns `undefined`, so a
    // mistyped call site loses its write result instead of failing loudly.
    expect(() => db.prepare('INSERT INTO t VALUES (1)').get()).toThrow(TypeError);
    expect(() => db.prepare('INSERT INTO t VALUES (2)').all()).toThrow(TypeError);
  });

  it('reports zero changes and rowid for run() on a reader statement, like better-sqlite3', () => {
    const db = open(join(dir, 'f.db'));
    db.exec('CREATE TABLE t (v INTEGER)');
    db.prepare('INSERT INTO t VALUES (7)').run();
    // better-sqlite3 13.0.3: { changes: 0, lastInsertRowid: 0 }. node:sqlite
    // reports the connection-wide counters, which still carry the INSERT.
    expect(db.prepare('SELECT v FROM t').run()).toEqual({ changes: 0, lastInsertRowid: 0 });
  });

  it('raises better-sqlite3\'s RangeError for a bigint outside the int64 range', () => {
    const db = open(join(dir, 'g.db'));
    db.exec('CREATE TABLE t (v INTEGER)');
    let thrown: unknown;
    try {
      db.prepare('INSERT INTO t VALUES (?)').run(18446744073709551616n);
    } catch (error) {
      thrown = error;
    }
    // better-sqlite3 13.0.3: RangeError "The bound string, buffer, or bigint
    // is too big". The adapter leaks node:sqlite's
    // TypeError "BigInt value is too large to bind." (ERR_INVALID_ARG_VALUE).
    expect(thrown).toBeInstanceOf(RangeError);
    expect((thrown as RangeError).message).toBe('The bound string, buffer, or bigint is too big');
  });
});
