/**
 * renameEntity primitive tests (graph-core prerequisite).
 *
 * Covers:
 * - happy path on BOTH backends: relations (from/to), children parentId,
 *   version-chain fields rewritten; id/createdAt preserved; lastModified bumped
 * - persistence of the rename across storage reopen
 * - errors: nonexistent oldName, existing newName, invalid newName,
 *   reserved-namespace newName
 * - events: entity:renamed + entity:deleted + entity:created in order
 * - TF-IDF event sync reflects the rename (delete old doc, add new doc)
 * - RefIndex aliases remap to the new name
 * - segment mode (MEMORY_STORAGE_SEGMENT_COUNT=2): rename is routing-aware
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { RefIndex } from '../../../src/core/RefIndex.js';
import { TFIDFIndexManager } from '../../../src/search/TFIDFIndexManager.js';
import { TFIDFEventSync } from '../../../src/search/TFIDFEventSync.js';
import {
  EntityNotFoundError,
  DuplicateEntityError,
  ValidationError,
} from '../../../src/utils/errors.js';
import type { GraphEvent } from '../../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const OLD_TS = '2020-01-01T00:00:00.000Z';

/**
 * Seed a small graph exercising every reference kind:
 * - Target (the entity to rename; supersededBy chain onto NewVersion)
 * - Child (parentId -> Target)
 * - NewVersion (parentEntityName/rootEntityName -> Target)
 * - Peer (relations Target -> Peer and Peer -> Target)
 */
async function seedGraph(manager: EntityManager, relationManager: RelationManager) {
  const [target] = await manager.createEntities([
    {
      name: 'Target',
      entityType: 'person',
      observations: ['zephyrine observation'],
      createdAt: OLD_TS,
      lastModified: OLD_TS,
    },
  ]);
  await manager.createEntities([
    { name: 'Peer', entityType: 'person', observations: ['peer'] },
    { name: 'Child', entityType: 'person', observations: [], parentId: 'Target' },
    {
      name: 'NewVersion',
      entityType: 'person',
      observations: [],
      version: 2,
      parentEntityName: 'Target',
      rootEntityName: 'Target',
    },
  ]);
  await manager.updateEntity('Target', { supersededBy: 'NewVersion', rootEntityName: 'Target' });
  await relationManager.createRelations([
    { from: 'Target', to: 'Peer', relationType: 'knows' },
    { from: 'Peer', to: 'Target', relationType: 'reports_to' },
  ]);
  return target;
}

async function assertRenamedGraph(
  storage: GraphStorage | SQLiteStorage,
  originalId: string | undefined
) {
  const graph = await storage.loadGraph();

  const renamed = graph.entities.find((e) => e.name === 'Renamed');
  expect(renamed).toBeDefined();
  expect(graph.entities.find((e) => e.name === 'Target')).toBeUndefined();

  // id + createdAt preserved, lastModified bumped
  expect(renamed?.id).toBe(originalId);
  expect(renamed?.createdAt).toBe(OLD_TS);
  expect(renamed?.lastModified).not.toBe(OLD_TS);
  expect(renamed?.observations).toEqual(['zephyrine observation']);

  // Relations rewritten in both directions
  const outgoing = graph.relations.find((r) => r.relationType === 'knows');
  const incoming = graph.relations.find((r) => r.relationType === 'reports_to');
  expect(outgoing?.from).toBe('Renamed');
  expect(outgoing?.to).toBe('Peer');
  expect(incoming?.from).toBe('Peer');
  expect(incoming?.to).toBe('Renamed');

  // Children's parentId rewritten
  const child = graph.entities.find((e) => e.name === 'Child');
  expect(child?.parentId).toBe('Renamed');

  // Version-chain fields rewritten (on other entities AND self-references)
  const newVersion = graph.entities.find((e) => e.name === 'NewVersion');
  expect(newVersion?.parentEntityName).toBe('Renamed');
  expect(newVersion?.rootEntityName).toBe('Renamed');
  expect(renamed?.supersededBy).toBe('NewVersion');
  expect(renamed?.rootEntityName).toBe('Renamed');
}

describe('renameEntity', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `rename-entity-test-${Date.now()}-${Math.random()}`);
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
    let relationManager: RelationManager;

    beforeEach(() => {
      filePath = join(testDir, 'graph.jsonl');
      storage = new GraphStorage(filePath);
      manager = new EntityManager(storage);
      relationManager = new RelationManager(storage);
    });

    it('rewrites relations, parentId, and version-chain fields; preserves id/createdAt', async () => {
      const target = await seedGraph(manager, relationManager);

      const renamed = await manager.renameEntity('Target', 'Renamed');
      expect(renamed.name).toBe('Renamed');
      expect(renamed.id).toBe(target.id);

      await assertRenamedGraph(storage, target.id);

      // Persisted: reload from disk with a fresh storage instance
      const reloaded = new GraphStorage(filePath);
      await assertRenamedGraph(reloaded, target.id);
    });

    it('keeps O(1) storage indexes consistent after rename', async () => {
      await seedGraph(manager, relationManager);
      await manager.renameEntity('Target', 'Renamed');

      expect(storage.hasEntity('Target')).toBe(false);
      expect(storage.hasEntity('Renamed')).toBe(true);
      expect(storage.getEntityByName('Renamed')?.name).toBe('Renamed');
      expect(storage.getRelationsFrom('Renamed')).toHaveLength(1);
      expect(storage.getRelationsTo('Renamed')).toHaveLength(1);
      expect(storage.getRelationsFor('Target')).toHaveLength(0);
    });

    it('throws EntityNotFoundError for a nonexistent entity', async () => {
      await expect(manager.renameEntity('Ghost', 'NewGhost')).rejects.toThrow(
        EntityNotFoundError
      );
    });

    it('throws DuplicateEntityError when the new name already exists', async () => {
      await manager.createEntities([
        { name: 'A', entityType: 't', observations: [] },
        { name: 'B', entityType: 't', observations: [] },
      ]);
      await expect(manager.renameEntity('A', 'B')).rejects.toThrow(DuplicateEntityError);
    });

    it('throws ValidationError for an invalid new name', async () => {
      await manager.createEntities([{ name: 'A', entityType: 't', observations: [] }]);
      await expect(manager.renameEntity('A', '')).rejects.toThrow(ValidationError);
      const tooLong = 'x'.repeat(501);
      await expect(manager.renameEntity('A', tooLong)).rejects.toThrow(ValidationError);
    });

    it('enforces reserved namespaces on the new name (same rules as create)', async () => {
      await manager.createEntities([{ name: 'A', entityType: 't', observations: [] }]);
      await expect(manager.renameEntity('A', 'profile-A')).rejects.toThrow(ValidationError);
      await expect(manager.renameEntity('A', 'diary-A')).rejects.toThrow(ValidationError);
      // Allowed when the entityType matches the namespace owner
      await manager.createEntities([{ name: 'P', entityType: 'profile', observations: [] }]);
      const renamed = await manager.renameEntity('P', 'profile-P');
      expect(renamed.name).toBe('profile-P');
    });

    it('emits entity:renamed, entity:deleted, entity:created in order', async () => {
      await seedGraph(manager, relationManager);
      const seen: GraphEvent[] = [];
      storage.events.on('entity:renamed', (e) => seen.push(e));
      storage.events.on('entity:deleted', (e) => seen.push(e));
      storage.events.on('entity:created', (e) => seen.push(e));

      await manager.renameEntity('Target', 'Renamed');

      expect(seen.map((e) => e.type)).toEqual([
        'entity:renamed',
        'entity:deleted',
        'entity:created',
      ]);
      const renamedEvent = seen[0];
      if (renamedEvent.type === 'entity:renamed') {
        expect(renamedEvent.oldName).toBe('Target');
        expect(renamedEvent.newName).toBe('Renamed');
        expect(renamedEvent.entity.name).toBe('Renamed');
      }
      const deletedEvent = seen[1];
      if (deletedEvent.type === 'entity:deleted') {
        expect(deletedEvent.entityName).toBe('Target');
      }
      const createdEvent = seen[2];
      if (createdEvent.type === 'entity:created') {
        expect(createdEvent.entity.name).toBe('Renamed');
      }
    });

    it('TF-IDF index reflects the new name after rename (via TFIDFEventSync)', async () => {
      await seedGraph(manager, relationManager);

      const indexManager = new TFIDFIndexManager(testDir);
      await indexManager.buildIndex(await storage.loadGraph());
      const sync = new TFIDFEventSync(indexManager, storage.events, storage, { coalesceMs: 0 });
      sync.enable();
      try {
        expect(indexManager.getIndex()?.documents.has('Target')).toBe(true);

        await manager.renameEntity('Target', 'Renamed');

        const documents = indexManager.getIndex()?.documents;
        expect(documents?.has('Target')).toBe(false);
        expect(documents?.has('Renamed')).toBe(true);
      } finally {
        sync.disable();
      }
    });

    it('RefIndex aliases pointing at the old name resolve to the new name', async () => {
      await seedGraph(manager, relationManager);
      const refIndex = new RefIndex(join(testDir, 'refs.jsonl'));
      manager.setRefIndex(refIndex);
      await manager.registerRef('my-stable-ref', 'Target', 'points at Target');

      await manager.renameEntity('Target', 'Renamed');

      expect(await refIndex.resolve('my-stable-ref')).toBe('Renamed');
      const resolved = await manager.resolveRef('my-stable-ref');
      expect(resolved?.name).toBe('Renamed');
      // Reverse index remapped too
      expect(await refIndex.refsForEntity('Renamed')).toEqual(['my-stable-ref']);
      expect(await refIndex.refsForEntity('Target')).toEqual([]);
    });
  });

  describe('SQLite backend (SQLiteStorage)', () => {
    let dbPath: string;
    let storage: SQLiteStorage | null;
    let manager: EntityManager;
    let relationManager: RelationManager;

    beforeEach(() => {
      dbPath = join(testDir, 'graph.db');
      storage = new SQLiteStorage(dbPath);
      manager = new EntityManager(storage as unknown as GraphStorage);
      relationManager = new RelationManager(storage as unknown as GraphStorage);
    });

    afterEach(() => {
      storage?.close();
      storage = null;
    });

    it('rewrites relations, parentId, and version-chain fields; preserves id/createdAt', async () => {
      const target = await seedGraph(manager, relationManager);

      const renamed = await manager.renameEntity('Target', 'Renamed');
      expect(renamed.name).toBe('Renamed');
      expect(renamed.id).toBe(target.id);

      await assertRenamedGraph(storage!, target.id);

      // Persisted: close and reopen the database
      storage!.close();
      storage = new SQLiteStorage(dbPath);
      await assertRenamedGraph(storage, target.id);
    });

    it('keeps FTS5 in sync (full-text search finds the new name, not the old)', async () => {
      await seedGraph(manager, relationManager);
      await manager.renameEntity('Target', 'Renamed');

      const results = storage!.fullTextSearch('zephyrine');
      expect(results.map((r) => r.name)).toContain('Renamed');
      expect(results.map((r) => r.name)).not.toContain('Target');
    });

    it('throws EntityNotFoundError / DuplicateEntityError', async () => {
      await manager.createEntities([
        { name: 'A', entityType: 't', observations: [] },
        { name: 'B', entityType: 't', observations: [] },
      ]);
      await expect(manager.renameEntity('Ghost', 'X')).rejects.toThrow(EntityNotFoundError);
      await expect(manager.renameEntity('A', 'B')).rejects.toThrow(DuplicateEntityError);
    });

    it('rename failure leaves the graph untouched (atomic transaction)', async () => {
      await seedGraph(manager, relationManager);
      await expect(manager.renameEntity('Target', 'Peer')).rejects.toThrow(
        DuplicateEntityError
      );

      const graph = await storage!.loadGraph();
      expect(graph.entities.find((e) => e.name === 'Target')).toBeDefined();
      const outgoing = graph.relations.find((r) => r.relationType === 'knows');
      expect(outgoing?.from).toBe('Target');
    });
  });

  describe('segment mode (MEMORY_STORAGE_SEGMENT_COUNT=2)', () => {
    let previous: string | undefined;

    beforeEach(() => {
      previous = process.env.MEMORY_STORAGE_SEGMENT_COUNT;
      process.env.MEMORY_STORAGE_SEGMENT_COUNT = '2';
    });

    afterEach(() => {
      if (previous === undefined) {
        delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
      } else {
        process.env.MEMORY_STORAGE_SEGMENT_COUNT = previous;
      }
    });

    it('rename is routing-aware: entity migrates to its new owning segment and persists', async () => {
      const filePath = join(testDir, 'segmented.jsonl');
      const storage = new GraphStorage(filePath);
      const manager = new EntityManager(storage);
      const relationManager = new RelationManager(storage);

      const target = await seedGraph(manager, relationManager);
      const renamed = await manager.renameEntity('Target', 'Renamed');
      expect(renamed.name).toBe('Renamed');

      await assertRenamedGraph(storage, target.id);

      // Reload from segment files with a fresh storage instance — the
      // renamed entity must be readable from its (potentially different)
      // owning segment, and no stale copy of the old name may remain.
      const reloaded = new GraphStorage(filePath);
      await assertRenamedGraph(reloaded, target.id);
      const graph = await reloaded.loadGraph();
      expect(graph.entities.filter((e) => e.name === 'Renamed')).toHaveLength(1);
    });
  });
});
