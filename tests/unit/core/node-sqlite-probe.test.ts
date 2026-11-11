/**
 * `node:sqlite` stability probe (Sprint 9, Task 19).
 *
 * Sprint 9 replaced the native `better-sqlite3` addon with Node's built-in
 * `node:sqlite`, and `engines.node` moved to `>=22.16.0` with it. This file is
 * the acceptance gate for that move: it fails, not skips, when the runtime
 * cannot do what `SQLiteStorage` needs. On Node it covers, against a real temp
 * file:
 *
 * - the module loads and exports `DatabaseSync`;
 * - `PRAGMA journal_mode = WAL` takes effect on disk (a WAL sidecar is created);
 * - FTS5 tables can be created, populated through a prepared statement and
 *   queried with `MATCH` and `bm25()` — the module `SQLiteStorage` depends on
 *   and the one Node only ships from 22.16.0;
 * - a prepared statement round-trips a value and reports `changes`;
 * - a reader pragma (`table_info`) returns rows;
 * - a transaction rolls back on throw, leaving no partial write.
 *
 * `node:sqlite` does not exist in Bun, so the file skips ONLY when Vitest is
 * hosted by Bun (`typeof Bun !== 'undefined'`). The Node lane — `bun run test:ci`,
 * which starts `node` — must never skip it. The skip message names that command.
 *
 * @module tests/unit/core/node-sqlite-probe.test
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

describe.skipIf(typeof Bun !== 'undefined')('node:sqlite stability probe', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memoryjs-node-sqlite-probe-'));
    dbPath = join(dir, 'probe.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads node:sqlite and exports DatabaseSync', () => {
    const mod = require('node:sqlite') as { DatabaseSync?: unknown };
    expect(typeof mod.DatabaseSync).toBe('function');
  });

  it('sets journal_mode = WAL on a real file, creating a WAL sidecar', () => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; run(...p: unknown[]): { changes: number | bigint } };
        close(): void;
      };
    };
    const db = new DatabaseSync(dbPath);
    try {
      // Switch first, then write: SQLite creates the WAL sidecar on the first
      // write after the mode change.
      const rows = db.prepare('PRAGMA journal_mode = WAL').all() as Array<{ journal_mode: string }>;
      expect(rows[0]?.journal_mode).toBe('wal');
      db.exec('CREATE TABLE t (a INTEGER)');
      db.exec('INSERT INTO t VALUES (1)');
      // The setting is on the file, not just in memory: while the connection is
      // open (and has not checkpointed) SQLite keeps the WAL sidecar next to it.
      expect(existsSync(`${dbPath}-wal`)).toBe(true);
      expect(readdirSync(dir).some((name) => name.endsWith('-wal'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('creates an FTS5 table, inserts through a prepared statement, matches and ranks', () => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...p: unknown[]): { changes: number | bigint };
          all(...p: unknown[]): unknown[];
        };
        close(): void;
      };
    };
    const db = new DatabaseSync(dbPath);
    try {
      // FTS5 is the module Node 22.13-22.15 lacks; this is the assertion that
      // pins the engines floor.
      db.exec('CREATE VIRTUAL TABLE fts USING fts5(name, body)');
      const insert = db.prepare('INSERT INTO fts (name, body) VALUES (?, ?)');
      expect(insert.run('Needle', 'singular zephyr').changes).toBe(1);
      expect(insert.run('Haystack', 'ordinary content zephyr zephyr').changes).toBe(1);

      const ranked = db
        .prepare('SELECT name, bm25(fts) AS score FROM fts WHERE fts MATCH ? ORDER BY score')
        .all('zephyr') as Array<{ name: string; score: number }>;
      expect(ranked.map((r) => r.name)).toEqual(['Haystack', 'Needle']);
      expect(ranked[0].score).toBeLessThan(ranked[1].score);
    } finally {
      db.close();
    }
  });

  it('round-trips a prepared statement and reports changes', () => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
          get(...p: unknown[]): unknown;
        };
        close(): void;
      };
    };
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
      const info = db.prepare('INSERT INTO t (v) VALUES (?)').run('alpha');
      expect(Number(info.changes)).toBe(1);
      expect(Number(info.lastInsertRowid)).toBe(1);
      expect(db.prepare('SELECT v FROM t WHERE id = ?').get(1)).toMatchObject({ v: 'alpha' });
    } finally {
      db.close();
    }
  });

  it('returns rows for a reader pragma', () => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): { all(...p: unknown[]): unknown[] };
        close(): void;
      };
    };
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('CREATE TABLE t (id INTEGER, NAME TEXT)');
      const columns = db.prepare('PRAGMA table_info(t)').all() as Array<{ name: string }>;
      expect(columns.map((c) => c.name)).toEqual(['id', 'NAME']);
    } finally {
      db.close();
    }
  });

  it('rolls a transaction back on throw, leaving no partial write', () => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...p: unknown[]): unknown;
          get(...p: unknown[]): unknown;
        };
        close(): void;
      };
    };
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('CREATE TABLE t (n INTEGER)');
      const insert = db.prepare('INSERT INTO t (n) VALUES (?)');
      const fail = (): void => {
        db.exec('BEGIN');
        try {
          insert.run(1);
          throw new Error('boom');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      };
      expect(fail).toThrow('boom');
      expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toMatchObject({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('runs on the Node lane', () => {
    // Record the runtime in the failure output if the floor ever moves.
    const [major, minor] = process.versions.node.split('.').map(Number);
    expect(
      major > 22 || (major === 22 && minor >= 16),
      `the Node lane must be >= 22.16.0 (this is ${process.versions.node}); ` +
        'the Node lane is `bun run test:ci`',
    ).toBe(true);
  });
});
