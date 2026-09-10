/**
 * SQLite driver resolver export (A12).
 *
 * `resolveSQLiteDatabaseCtor` is the public seam a procedural-graph backing
 * uses so it honors `MEMORY_SQLITE_DRIVER` identically to `SQLiteStorage`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveSQLiteDatabaseCtor,
  __resetDatabaseCtorForTests,
} from '../../../src/core/SQLiteStorage.js';
import { isNodeSqliteAvailable } from '../../../src/core/nodeSqliteAdapter.js';

describe('resolveSQLiteDatabaseCtor', () => {
  const tempDirs: string[] = [];
  const previousDriver = process.env.MEMORY_SQLITE_DRIVER;

  afterEach(() => {
    if (previousDriver === undefined) {
      delete process.env.MEMORY_SQLITE_DRIVER;
    } else {
      process.env.MEMORY_SQLITE_DRIVER = previousDriver;
    }
    __resetDatabaseCtorForTests();

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir === undefined) break;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  function makeTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    tempDirs.push(dir);
    return join(dir, 'resolver.db');
  }

  it('resolveSQLiteDatabaseCtor returns a constructor', () => {
    const Ctor = resolveSQLiteDatabaseCtor();
    expect(typeof Ctor).toBe('function');

    const db = new Ctor(makeTempDbPath());
    expect(db).toBeDefined();
    db.close();
  });

  it.skipIf(!isNodeSqliteAvailable())(
    'honors MEMORY_SQLITE_DRIVER=node after __resetDatabaseCtorForTests',
    () => {
      process.env.MEMORY_SQLITE_DRIVER = 'node';
      __resetDatabaseCtorForTests();

      const Ctor = resolveSQLiteDatabaseCtor();
      expect(typeof Ctor).toBe('function');
      expect(Ctor.name).toBe('NodeSqliteDatabase');

      const db = new Ctor(makeTempDbPath());
      expect(db).toBeDefined();
      db.close();
    },
  );
});
