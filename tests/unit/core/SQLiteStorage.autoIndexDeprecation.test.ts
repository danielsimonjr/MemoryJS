/**
 * MEMORY_SQLITE_AUTO_INDEX deprecation (DES-9).
 *
 * The flag is kept for compatibility but has no effect on query plans:
 * - one warning per storage instance when it is set,
 * - no idx_advisor_* index is ever created,
 * - legacy idx_advisor_* indexes from older versions are dropped on close.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNodeSqliteDatabaseCtor } from '../../../src/core/nodeSqliteAdapter.js';

/** Raw connection on the driver under test, for tests that inspect stored rows. */
const Database = createNodeSqliteDatabaseCtor();
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { logger } from '../../../src/utils/logger.js';

const ENV = 'MEMORY_SQLITE_AUTO_INDEX';

function advisorIndexNames(dbPath: string): string[] {
  const raw = new Database(dbPath, { readonly: true });
  try {
    return (raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_advisor\\_%' ESCAPE '\\'")
      .all() as Array<{ name: string }>).map((r) => r.name);
  } finally {
    raw.close();
  }
}

describe('SQLiteStorage MEMORY_SQLITE_AUTO_INDEX deprecation', () => {
  const ORIGINAL = process.env[ENV];
  let testDir: string;
  let dbPath: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    delete process.env[ENV];
    testDir = join(tmpdir(), `sqlite-autoindex-dep-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    dbPath = join(testDir, 'graph.db');
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    if (ORIGINAL === undefined) delete process.env[ENV];
    else process.env[ENV] = ORIGINAL;
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const deprecationCalls = () =>
    warnSpy.mock.calls.filter((c) => String(c[0]).includes(ENV));

  it('logs no deprecation warning when the flag is unset', () => {
    const storage = new SQLiteStorage(dbPath);
    try {
      expect(deprecationCalls()).toHaveLength(0);
    } finally {
      storage.close();
    }
  });

  it('logs exactly one warning per instance when the flag is set, naming the variable', () => {
    process.env[ENV] = 'true';
    const a = new SQLiteStorage(dbPath);
    const b = new SQLiteStorage(join(testDir, 'other.db'));
    try {
      expect(deprecationCalls()).toHaveLength(2);
      expect(String(deprecationCalls()[0]![0])).toContain('deprecated');
    } finally {
      a.close();
      b.close();
    }
  });

  it('creates no idx_advisor_* index even under a heavy filter workload', async () => {
    process.env[ENV] = 'true';
    const storage = new SQLiteStorage(dbPath);
    try {
      await storage.ensureLoaded();
      for (let i = 0; i < 250; i++) storage.recordFilter({ entityType: 'person' });
      for (let i = 0; i < 250; i++) storage.recordFilter({ projectId: 'proj-A' });
      // Let any deferred work (the old setImmediate apply path) run.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(storage.partialIndexAdvisorSnapshot().liveIndexes).toEqual([]);
      expect(advisorIndexNames(dbPath)).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it('drops a legacy idx_advisor_* index on close even when the flag is now unset', async () => {
    const storage = new SQLiteStorage(dbPath);
    await storage.ensureLoaded();
    const raw = new Database(dbPath);
    raw.exec(
      "CREATE INDEX idx_advisor_type_person ON entities(entityType) WHERE entityType = 'person'",
    );
    raw.close();
    expect(advisorIndexNames(dbPath)).toEqual(['idx_advisor_type_person']);

    storage.close();

    expect(advisorIndexNames(dbPath)).toEqual([]);
  });
});
