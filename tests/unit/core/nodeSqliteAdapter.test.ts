/**
 * The `node:sqlite` adapter exists so the SQLite backend keeps working where the
 * `better-sqlite3` native addon cannot be built.
 *
 * That is not hypothetical: the Claude Code plugin installer runs no install
 * scripts, and `better-sqlite3` obtains its binary from an `install` script
 * (`prebuild-install || node-gyp rebuild`) rather than from a prebuilt
 * platform package. So in a deployed plugin the addon is simply absent and every
 * call fails with "Could not locate the bindings file" — verified against the
 * deployed memory-mcp plugin, which was completely unusable because of it.
 *
 * These tests pin the surface `SQLiteStorage` actually uses. That surface is
 * deliberately narrow — exec / prepare / run / get / all / pragma / transaction /
 * close — and it is what the adapter must satisfy to be a drop-in.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeSqliteDatabaseCtor, isNodeSqliteAvailable } from '../../../src/core/nodeSqliteAdapter.js';

describe('node:sqlite adapter', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memoryjs-nodesqlite-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports availability on a runtime that has node:sqlite', () => {
    // Node 22.5+ ships node:sqlite. If this is false the rest is meaningless,
    // so assert it rather than silently skipping.
    expect(isNodeSqliteAvailable()).toBe(true);
  });

  it('constructs like better-sqlite3: new Database(path)', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    expect(db).toBeDefined();
    db.close();
  });

  it('supports exec, prepare, run, get and all with positional params', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);

    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    const insert = db.prepare('INSERT INTO t (name) VALUES (?)');
    const info = insert.run('alpha');
    expect(info.changes).toBe(1);

    insert.run('beta');
    const one = db.prepare('SELECT name FROM t WHERE name = ?').get('alpha') as { name: string };
    expect(one.name).toBe('alpha');

    const rows = db.prepare('SELECT name FROM t ORDER BY name').all() as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta']);
    db.close();
  });

  it('pragma() returns rows for read pragmas and applies setter pragmas', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE entities (id TEXT, name TEXT)');

    // Setter form — SQLiteStorage uses this for journal_mode, foreign_keys, etc.
    db.pragma('foreign_keys = ON');

    // Reader form — SQLiteStorage uses table_info() to drive migrations, so the
    // row shape matters, not just that it does not throw.
    const cols = db.pragma('table_info(entities)') as Array<{ name: string }>;
    expect(Array.isArray(cols)).toBe(true);
    expect(cols.map((c) => c.name).sort()).toEqual(['id', 'name']);
    db.close();
  });

  it('pragma(source, { simple: true }) returns a scalar, not a row array', () => {
    // better-sqlite3 semantics: simple mode yields the first column of the first
    // row. SQLiteStorage does not use this, but its test suite does — and the
    // suite is what caught the adapter ignoring the options argument.
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    db.close();
  });

  it('transaction() returns a callable that commits on success', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (n INTEGER)');
    const ins = db.prepare('INSERT INTO t (n) VALUES (?)');

    const tx = db.transaction(() => {
      ins.run(1);
      ins.run(2);
    });
    tx();

    const count = db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number };
    expect(count.c).toBe(2);
    db.close();
  });

  it('transaction() rolls back on throw, leaving no partial write', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (n INTEGER)');
    const ins = db.prepare('INSERT INTO t (n) VALUES (?)');

    const tx = db.transaction(() => {
      ins.run(1);
      throw new Error('boom');
    });

    expect(() => tx()).toThrow('boom');
    const count = db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number };
    expect(count.c).toBe(0);
    db.close();
  });
});
