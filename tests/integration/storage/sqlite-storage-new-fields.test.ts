import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import type { Entity } from '../../../src/types/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SQLiteStorage persists new v1.8.0 fields', () => {
  let tmpDir: string;
  let dbPath: string;
  let storage: SQLiteStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-sqlite-test-'));
    dbPath = path.join(tmpDir, 'memory.db');
    storage = new SQLiteStorage(dbPath);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips projectId', async () => {
    const entity: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: ['fact'],
      projectId: 'proj-1',
    };
    await storage.saveGraph({ entities: [entity], relations: [] });
    const g = await storage.loadGraph();
    expect(g.entities[0].projectId).toBe('proj-1');
  });

  it('round-trips version chain', async () => {
    const entity: Entity = {
      name: 'alice-v2',
      entityType: 'person',
      observations: ['fact'],
      version: 2,
      parentEntityName: 'alice',
      rootEntityName: 'alice',
      isLatest: true,
    };
    await storage.saveGraph({ entities: [entity], relations: [] });
    const g = await storage.loadGraph();
    expect(g.entities[0].version).toBe(2);
    expect(g.entities[0].parentEntityName).toBe('alice');
    expect(g.entities[0].rootEntityName).toBe('alice');
    expect(g.entities[0].isLatest).toBe(true);
  });

  it('creates indexes on projectId and isLatest', async () => {
    await storage.ensureLoaded();
    const db = (storage as any).db;
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entities'")
      .all()
      .map((r: any) => r.name);
    expect(rows).toContain('idx_entities_projectId');
    expect(rows).toContain('idx_entities_isLatest');
  });
});
