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

  it('transaction() nests with SAVEPOINT: an inner rollback keeps the outer work', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (n INTEGER)');
    const ins = db.prepare('INSERT INTO t (n) VALUES (?)');

    const outer = db.transaction(() => {
      ins.run(1);
      try {
        db.transaction(() => {
          ins.run(2);
          throw new Error('inner');
        })();
      } catch {
        // swallowed on purpose
      }
      ins.run(3);
    });
    outer();

    const rows = (db.prepare('SELECT n FROM t ORDER BY n').all() as Array<{ n: number }>).map((r) => r.n);
    expect(rows).toEqual([1, 3]);
    db.close();
  });

  it('transaction() exposes deferred / immediate / exclusive and refuses a promise', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (n INTEGER)');
    const ins = db.prepare('INSERT INTO t (n) VALUES (?)');
    const tx = db.transaction(() => ins.run(1));

    expect(tx.deferred).toBeTypeOf('function');
    expect(tx.immediate).toBeTypeOf('function');
    expect(tx.exclusive).toBeTypeOf('function');
    tx.deferred!();
    tx.immediate!();
    tx.exclusive!();
    const count = db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number };
    expect(count.c).toBe(3);

    const asyncTx = db.transaction(async () => 1);
    expect(() => asyncTx()).toThrow('Transaction function cannot return a promise');
    expect((db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c).toBe(3);
    db.close();
  });

  it('binds parameters with better-sqlite3 rules: null, undefined, arity, named', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b TEXT)');
    const ins = db.prepare('INSERT INTO t (a, b) VALUES (?, ?)');

    // undefined is NULL
    ins.run(undefined, 'x');
    expect(db.prepare('SELECT a FROM t WHERE id = 1').get()).toEqual({ a: null });
    // named binding reads a single plain-object argument
    db.prepare('INSERT INTO t (a, b) VALUES (@a, @b)').run({ a: 'p', b: 'q', extra: 'ignored' });
    expect(db.prepare('SELECT a, b FROM t WHERE id = 2').get()).toEqual({ a: 'p', b: 'q' });
    // wrong counts raise better-sqlite3's RangeError texts
    expect(() => ins.run('only-one')).toThrow(new RangeError('Too few parameter values were provided'));
    expect(() => ins.run('a', 'b', 'c')).toThrow(new RangeError('Too many parameter values were provided'));
    expect(() => db.prepare('INSERT INTO t (a, b) VALUES (@a, @b)').run({ a: 1 }))
      .toThrow(new RangeError('Missing named parameter "b"'));
    // an unbindable value raises better-sqlite3's TypeError text
    expect(() => ins.run(true, 'x')).toThrow(
      new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null'),
    );
    db.close();
  });

  it('reads rows as plain objects, with numbers and Buffers like better-sqlite3', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER, blob BLOB)');
    db.prepare('INSERT INTO t (n, blob) VALUES (?, ?)').run(9007199254740993n, Buffer.from([1, 2, 3]));

    const row = db.prepare('SELECT * FROM t').get() as Record<string, unknown>;
    // better-sqlite3 returns a plain object, not a null-prototype one.
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    // An INTEGER above 2^53 comes back as the same lossy number, not a bigint and not a throw.
    expect(row.n).toBe(9007199254740992);
    expect(typeof row.n).toBe('number');
    expect(Buffer.isBuffer(row.blob)).toBe(true);
    expect(Array.from(row.blob as Uint8Array)).toEqual([1, 2, 3]);
    db.close();
  });

  it('reports changes and lastInsertRowid as numbers', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const info = db.prepare('INSERT INTO t (v) VALUES (?)').run('x');
    expect(info.changes).toBe(1);
    expect(typeof info.lastInsertRowid).toBe('number');
    expect(info.lastInsertRowid).toBe(1);
    db.close();
  });

  it('raises SqliteError with better-sqlite3 codes and texts', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE p (name TEXT PRIMARY KEY);
      CREATE TABLE c (name TEXT PRIMARY KEY, pid TEXT REFERENCES p(name), v INTEGER NOT NULL);
    `);
    db.prepare('INSERT INTO p (name) VALUES (?)').run('a');

    const captured = (fn: () => unknown): Error => {
      try {
        fn();
      } catch (error) {
        return error as Error;
      }
      throw new Error('expected a throw');
    };

    const unique = captured(() => db.prepare('INSERT INTO p (name) VALUES (?)').run('a'));
    expect(unique.name).toBe('SqliteError');
    expect((unique as { code?: string }).code).toBe('SQLITE_CONSTRAINT_PRIMARYKEY');
    expect(unique.message).toBe('UNIQUE constraint failed: p.name');

    const foreignKey = captured(() => db.prepare('INSERT INTO c VALUES (?, ?, ?)').run('x', 'missing', 1));
    expect((foreignKey as { code?: string }).code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
    expect(foreignKey.message).toBe('FOREIGN KEY constraint failed');

    const notNull = captured(() => db.prepare('INSERT INTO c VALUES (?, ?, ?)').run('y', 'a', null));
    expect((notNull as { code?: string }).code).toBe('SQLITE_CONSTRAINT_NOTNULL');

    const noTable = captured(() => db.prepare('SELECT * FROM nope').all());
    expect((noTable as { code?: string }).code).toBe('SQLITE_ERROR');
    expect(noTable.message).toBe('no such table: nope');
    db.close();
  });

  it('raises better-sqlite3 TypeError texts on a closed connection', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (a)');
    db.close();
    expect(() => db.prepare('SELECT 1')).toThrow(new TypeError('The database connection is not open'));
    expect(() => db.exec('SELECT 1')).toThrow(new TypeError('The database connection is not open'));
  });

  it('honours the better-sqlite3 spelling of the read-only option', () => {
    const Database = createNodeSqliteDatabaseCtor();
    const writer = new Database(dbPath);
    writer.exec('CREATE TABLE t (a)');
    writer.prepare('INSERT INTO t VALUES (?)').run(1);
    writer.close();

    const reader = new Database(dbPath, { readonly: true });
    try {
      expect(reader.prepare('SELECT a FROM t').get()).toEqual({ a: 1 });
      const error = (() => {
        try {
          reader.exec('INSERT INTO t VALUES (2)');
        } catch (failure) {
          return failure as Error & { code?: string };
        }
        throw new Error('expected a throw');
      })();
      expect(error.code).toBe('SQLITE_READONLY');
    } finally {
      reader.close();
    }
  });
});
