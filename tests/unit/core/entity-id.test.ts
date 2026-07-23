/**
 * Entity.id stable-identifier tests (graph-core prerequisite).
 *
 * Covers:
 * - auto-generation of `id` (UUID) in EntityManager.createEntities
 * - caller-supplied ids preserved
 * - id survives updateEntity and save/load roundtrip on BOTH backends
 * - SQLite schema migration for pre-id DBs (column added, rows backfilled)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('Entity.id (stable identifier)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `entity-id-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('JSONL backend (GraphStorage)', () => {
    let filePath: string;
    let storage: GraphStorage;
    let manager: EntityManager;

    beforeEach(() => {
      filePath = join(testDir, 'graph.jsonl');
      storage = new GraphStorage(filePath);
      manager = new EntityManager(storage);
    });

    it('auto-generates a UUID id on create', async () => {
      const [alice] = await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Dev'] },
      ]);
      expect(alice.id).toMatch(UUID_RE);
    });

    it('preserves a caller-supplied id', async () => {
      const [bob] = await manager.createEntities([
        { name: 'Bob', entityType: 'person', observations: [], id: 'caller-id-42' },
      ]);
      expect(bob.id).toBe('caller-id-42');
    });

    it('assigns distinct ids per entity in a batch', async () => {
      const created = await manager.createEntities([
        { name: 'E1', entityType: 't', observations: [] },
        { name: 'E2', entityType: 't', observations: [] },
      ]);
      expect(created[0].id).toBeDefined();
      expect(created[1].id).toBeDefined();
      expect(created[0].id).not.toBe(created[1].id);
    });

    it('id survives updateEntity', async () => {
      const [alice] = await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
      ]);
      const updated = await manager.updateEntity('Alice', { importance: 9 });
      expect(updated.id).toBe(alice.id);

      const fetched = await manager.getEntity('Alice');
      expect(fetched?.id).toBe(alice.id);
    });

    it('id round-trips through save/load (fresh storage instance)', async () => {
      const [alice] = await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Dev'] },
      ]);

      const reloaded = new GraphStorage(filePath);
      const graph = await reloaded.loadGraph();
      const persisted = graph.entities.find((e) => e.name === 'Alice');
      expect(persisted?.id).toBe(alice.id);
    });
  });

  describe('SQLite backend (SQLiteStorage)', () => {
    let dbPath: string;
    let storage: SQLiteStorage | null;
    let manager: EntityManager;

    beforeEach(() => {
      dbPath = join(testDir, 'graph.db');
      storage = new SQLiteStorage(dbPath);
      manager = new EntityManager(storage as unknown as GraphStorage);
    });

    afterEach(() => {
      storage?.close();
      storage = null;
    });

    it('auto-generates a UUID id on create and preserves caller ids', async () => {
      const created = await manager.createEntities([
        { name: 'Auto', entityType: 'person', observations: [] },
        { name: 'Manual', entityType: 'person', observations: [], id: 'my-stable-id' },
      ]);
      expect(created.find((e) => e.name === 'Auto')?.id).toMatch(UUID_RE);
      expect(created.find((e) => e.name === 'Manual')?.id).toBe('my-stable-id');
    });

    it('id survives updateEntity + close/reopen roundtrip', async () => {
      const [alice] = await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Dev'] },
      ]);
      await manager.updateEntity('Alice', { importance: 5 });
      storage!.close();

      storage = new SQLiteStorage(dbPath);
      const graph = await storage.loadGraph();
      const persisted = graph.entities.find((e) => e.name === 'Alice');
      expect(persisted?.id).toBe(alice.id);
      expect(persisted?.importance).toBe(5);
    });

    it('migrates a pre-id DB: no crash, id column added, existing rows backfilled', async () => {
      storage!.close();
      storage = null;
      await fs.rm(dbPath, { force: true });

      // Simulate a DB created before the id column existed (minimal
      // pre-change schema, no id column).
      const raw = new Database(dbPath);
      raw.exec(`
        CREATE TABLE entities (
          name TEXT PRIMARY KEY,
          entityType TEXT NOT NULL,
          observations TEXT NOT NULL,
          tags TEXT,
          importance INTEGER,
          parentId TEXT,
          createdAt TEXT NOT NULL,
          lastModified TEXT NOT NULL
        )
      `);
      raw.exec(`
        CREATE TABLE relations (
          fromEntity TEXT NOT NULL,
          toEntity TEXT NOT NULL,
          relationType TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          lastModified TEXT NOT NULL,
          PRIMARY KEY (fromEntity, toEntity, relationType)
        )
      `);
      raw.prepare(
        `INSERT INTO entities (name, entityType, observations, createdAt, lastModified)
         VALUES (?, ?, ?, ?, ?)`
      ).run('Legacy', 'person', JSON.stringify(['old row']), '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');
      raw.close();

      // Opening via SQLiteStorage must not crash and must add + backfill id.
      storage = new SQLiteStorage(dbPath);
      const graph = await storage.loadGraph();

      const legacy = graph.entities.find((e) => e.name === 'Legacy');
      expect(legacy).toBeDefined();
      expect(legacy?.id).toMatch(UUID_RE);
      expect(legacy?.observations).toEqual(['old row']);

      // Column really exists at the SQL level.
      const db = (storage as unknown as { db: { pragma: (q: string) => Array<{ name: string }> } }).db;
      const names = db.pragma('table_info(entities)').map((c) => c.name);
      expect(names).toContain('id');
    });

    it('migration backfill is stable across reopens (id does not change)', async () => {
      await manager.createEntities([{ name: 'Keep', entityType: 't', observations: [] }]);
      const first = (await storage!.loadGraph()).entities.find((e) => e.name === 'Keep')?.id;
      storage!.close();

      storage = new SQLiteStorage(dbPath);
      const second = (await storage.loadGraph()).entities.find((e) => e.name === 'Keep')?.id;
      expect(second).toBe(first);
    });
  });
});
