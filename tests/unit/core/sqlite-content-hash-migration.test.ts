import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('SQLiteStorage contentHash migration', () => {
  let dbPath: string;
  let storage: SQLiteStorage | null = null;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `memoryjs-migration-${Date.now()}.db`);
    storage = null;
  });

  afterEach(() => {
    if (storage) {
      storage.close();
      storage = null;
    }
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  });

  it('adds contentHash column on first open', async () => {
    storage = new SQLiteStorage(dbPath);
    await storage.loadGraph();

    const db = (storage as unknown as { db: { pragma: (q: string) => Array<{ name: string }> } }).db;
    const columns = db.pragma('table_info(entities)');
    const names = columns.map((c) => c.name);

    expect(names).toContain('contentHash');
  });

  it('migration is idempotent on second open', async () => {
    const storage1 = new SQLiteStorage(dbPath);
    await storage1.loadGraph();
    storage1.close();

    await expect(async () => {
      storage = new SQLiteStorage(dbPath);
      await storage.loadGraph();
    }).not.toThrow();
  });

  it('creates idx_entities_content_hash index', async () => {
    storage = new SQLiteStorage(dbPath);
    await storage.loadGraph();

    const db = (storage as unknown as { db: { prepare: (sql: string) => { all: () => Array<{ name: string }> } } }).db;
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entities'").all();
    const names = indexes.map((i) => i.name);

    expect(names).toContain('idx_entities_content_hash');
  });
});
