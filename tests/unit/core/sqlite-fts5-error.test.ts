/**
 * A SQLite build with no FTS5 module.
 *
 * `SQLiteStorage` keeps its full-text index in an FTS5 virtual table. The SQLite inside
 * `node:sqlite` has FTS5 from Node 22.16.0 (nodejs/node#57621). On an older Node the
 * `CREATE VIRTUAL TABLE` fails with the bare message "no such module: fts5", which names
 * neither the cause nor the way out. These tests pin the message that replaces it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  SQLiteStorage,
  explainMissingFts5,
  __resetDatabaseCtorForTests,
} from '../../../src/core/SQLiteStorage.js';
import { isNodeSqliteAvailable } from '../../../src/core/nodeSqliteAdapter.js';

// Connections that the fake driver opened and closed.
const connections = vi.hoisted(() => ({ opened: 0, closed: 0 }));

// A driver whose SQLite has no FTS5: it refuses the FTS5 table the way SQLite does.
vi.mock('../../../src/core/nodeSqliteAdapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/nodeSqliteAdapter.js')>();
  return {
    ...actual,
    createNodeSqliteDatabaseCtor: () => {
      const Real = actual.createNodeSqliteDatabaseCtor();
      return class NoFts5Database extends Real {
        constructor(path: string) {
          super(path);
          connections.opened++;
        }

        override close(): void {
          connections.closed++;
          super.close();
        }

        override exec(sql: string): void {
          if (/USING\s+fts5/i.test(sql)) {
            throw Object.assign(new Error('no such module: fts5'), { code: 'ERR_SQLITE_ERROR' });
          }
          super.exec(sql);
        }
      };
    },
  };
});

describe('explainMissingFts5', () => {
  it('returns an unrelated error unchanged', () => {
    const error = new Error('database is locked');
    expect(explainMissingFts5(error)).toBe(error);
  });

  it('returns a value that is not an Error unchanged', () => {
    expect(explainMissingFts5('no such module: fts5')).toBe('no such module: fts5');
  });

  it('does not rewrite a missing module that is not FTS5', () => {
    const error = new Error('no such module: rtree');
    expect(explainMissingFts5(error)).toBe(error);
  });

  it('names the cause, the Node version that fixes it and the other way out', () => {
    const original = new Error('no such module: fts5');
    const explained = explainMissingFts5(original);
    expect(explained).toBeInstanceOf(Error);
    const message = (explained as Error).message;
    expect(message).toContain('FTS5');
    expect(message).toContain('22.16.0');
    expect(message).toContain(process.version);
    expect(message).toContain('better-sqlite3');
    expect((explained as Error).cause).toBe(original);
  });
});

describe.skipIf(!isNodeSqliteAvailable())('the format of the error that node:sqlite raises', () => {
  it('is "no such module: <name>", the text that explainMissingFts5 matches', () => {
    // The real driver, not the mock above: this pins the text that SQLite raises.
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
      DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
    };
    const db = new DatabaseSync(':memory:');
    try {
      expect(() => db.exec('CREATE VIRTUAL TABLE t USING nosuchmodule(x)')).toThrow(
        /no such module: nosuchmodule/,
      );
    } finally {
      db.close();
    }
  });
});

describe.skipIf(!isNodeSqliteAvailable())('SQLiteStorage on a SQLite build with no FTS5', () => {
  const previousDriver = process.env.MEMORY_SQLITE_DRIVER;
  const folders: string[] = [];

  afterEach(() => {
    connections.opened = 0;
    connections.closed = 0;
    if (previousDriver === undefined) delete process.env.MEMORY_SQLITE_DRIVER;
    else process.env.MEMORY_SQLITE_DRIVER = previousDriver;
    __resetDatabaseCtorForTests();
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('fails with the explained error, not the bare SQLite text', async () => {
    process.env.MEMORY_SQLITE_DRIVER = 'node';
    __resetDatabaseCtorForTests();
    const folder = mkdtempSync(join(tmpdir(), 'memoryjs-nofts5-'));
    folders.push(folder);

    const storage = new SQLiteStorage(join(folder, 'memory.db'));
    const failure = await storage.loadGraph().then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain('22.16.0');
    expect(failure?.message).not.toBe('no such module: fts5');
    expect((failure?.cause as Error | undefined)?.message).toBe('no such module: fts5');
  });

  it('leaves no connection open after the failed start, and fails the same way again', async () => {
    process.env.MEMORY_SQLITE_DRIVER = 'node';
    __resetDatabaseCtorForTests();
    const folder = mkdtempSync(join(tmpdir(), 'memoryjs-nofts5-'));
    folders.push(folder);

    const storage = new SQLiteStorage(join(folder, 'memory.db'));
    for (let attempt = 1; attempt <= 2; attempt++) {
      const failure = await storage.loadGraph().then(
        () => undefined,
        (error: unknown) => error as Error,
      );
      expect(failure?.message, `attempt ${attempt}`).toContain('22.16.0');
      expect(connections.opened, `attempt ${attempt}`).toBeGreaterThan(0);
      expect(connections.closed, `attempt ${attempt}`).toBe(connections.opened);
    }
  });
});
