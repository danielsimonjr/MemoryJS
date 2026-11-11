/**
 * SQLite driver resolver (A12).
 *
 * `resolveSQLiteDatabaseCtor` is the seam `SQLiteStorage` and the
 * procedural-graph backing both go through, so they always run on the same
 * driver. Since Sprint 9 that driver is Node's built-in `node:sqlite`: there is
 * no native addon and no fallback chain, and `MEMORY_SQLITE_DRIVER` no longer
 * selects between two drivers (the value is accepted for compatibility, and the
 * CI step that sets `MEMORY_SQLITE_DRIVER=node` keeps working).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveSQLiteDatabaseCtor,
  __resetDatabaseCtorForTests,
} from '../../../src/core/SQLiteStorage.js';

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

  it.skipIf(typeof Bun !== 'undefined')(
    'resolves the node:sqlite adapter, with or without MEMORY_SQLITE_DRIVER',
    () => {
      for (const driver of [undefined, 'node', 'anything-else']) {
        if (driver === undefined) delete process.env.MEMORY_SQLITE_DRIVER;
        else process.env.MEMORY_SQLITE_DRIVER = driver;
        __resetDatabaseCtorForTests();

        const Ctor = resolveSQLiteDatabaseCtor();
        expect(Ctor.name, `MEMORY_SQLITE_DRIVER=${String(driver)}`).toBe('NodeSqliteDatabase');

        const db = new Ctor(makeTempDbPath());
        expect(db).toBeDefined();
        db.close();
      }
    },
  );

  it.skipIf(typeof Bun !== 'undefined')('caches the constructor until it is reset', () => {
    __resetDatabaseCtorForTests();
    expect(resolveSQLiteDatabaseCtor()).toBe(resolveSQLiteDatabaseCtor());
    const first = resolveSQLiteDatabaseCtor();
    __resetDatabaseCtorForTests();
    expect(resolveSQLiteDatabaseCtor()).not.toBe(first);
  });
});
