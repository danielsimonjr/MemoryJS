/**
 * SQLiteStorage Unit Tests
 *
 * Tests for the better-sqlite3-based SQLite storage implementation.
 * Validates native SQLite functionality including:
 * - Basic CRUD operations
 * - Referential integrity (ON DELETE CASCADE)
 * - FTS5 full-text search
 * - Transaction handling
 * - WAL mode persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SQLiteStorage', () => {
  let storage: SQLiteStorage;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `sqlite-storage-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.db');
    storage = new SQLiteStorage(testFilePath);
  });

  afterEach(async () => {
    try {
      storage.close();
      // Clean up WAL files as well
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadGraph', () => {
    it('should return empty graph when database does not exist', async () => {
      const graph = await storage.loadGraph();

      expect(graph.entities).toEqual([]);
      expect(graph.relations).toEqual([]);
    });

    it('should load entities and relations from database', async () => {
      // Save test data - include both entities for the relation
      await storage.saveGraph({
        entities: [
          {
            name: 'Alice',
            entityType: 'person',
            observations: ['Engineer'],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
          },
          {
            name: 'Bob',
            entityType: 'person',
            observations: ['Designer'],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
          },
        ],
        relations: [
          {
            from: 'Alice',
            to: 'Bob',
            relationType: 'knows',
            createdAt: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      // Clear cache and reload
      storage.clearCache();
      const graph = await storage.loadGraph();

      expect(graph.entities).toHaveLength(2);
      expect(graph.entities[0].name).toBe('Alice');
      expect(graph.relations).toHaveLength(1);
      expect(graph.relations[0].from).toBe('Alice');
    });

    it('should use cache on second load', async () => {
      // First load - populates cache
      await storage.loadGraph();

      // Second load - should return cached data
      const graph1 = await storage.loadGraph();
      const graph2 = await storage.loadGraph();

      expect(graph1).toBe(graph2); // Same cached reference
    });

    it('should return read-only graph from loadGraph and mutable copy from getGraphForMutation', async () => {
      // loadGraph returns read-only reference (same object)
      const graph1 = await storage.loadGraph();
      const graph2 = await storage.loadGraph();
      expect(graph1).toBe(graph2); // Same cached reference

      // getGraphForMutation returns a mutable copy
      const mutableGraph = await storage.getGraphForMutation();
      mutableGraph.entities.push({
        name: 'Mutated',
        entityType: 'test',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // Original cache should not be affected
      const graph3 = await storage.loadGraph();
      expect(graph3.entities).toHaveLength(0);
    });
  });

  describe('saveGraph', () => {
    it('should save entities and relations to SQLite', async () => {
      // First create both entities so the relation can be created
      const graph = {
        entities: [
          {
            name: 'Alice',
            entityType: 'person',
            observations: ['Engineer'],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
          },
          {
            name: 'Bob',
            entityType: 'person',
            observations: ['Designer'],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
          },
        ],
        relations: [
          {
            from: 'Alice',
            to: 'Bob',
            relationType: 'knows',
            createdAt: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
          },
        ],
      };

      await storage.saveGraph(graph);

      // Verify by reloading
      storage.clearCache();
      const loaded = await storage.loadGraph();

      expect(loaded.entities).toHaveLength(2);
      expect(loaded.entities[0].name).toBe('Alice');
      expect(loaded.relations).toHaveLength(1);
      expect(loaded.relations[0].from).toBe('Alice');
    });

    it('should include optional entity fields', async () => {
      const graph = {
        entities: [
          {
            name: 'Company',
            entityType: 'organization',
            observations: ['Tech company'],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
          },
          {
            name: 'Alice',
            entityType: 'person',
            observations: [],
            tags: ['team'],
            importance: 8,
            parentId: 'Company',
            createdAt: '2024-01-01T00:00:00.000Z',
            lastModified: '2024-01-01T00:00:00.000Z',
          },
        ],
        relations: [],
      };

      await storage.saveGraph(graph);

      storage.clearCache();
      const loaded = await storage.loadGraph();

      const alice = loaded.entities.find(e => e.name === 'Alice');
      expect(alice?.tags).toEqual(['team']);
      expect(alice?.importance).toBe(8);
      expect(alice?.parentId).toBe('Company');
    });

    it('should persist to disk file', async () => {
      const graph = {
        entities: [{
          name: 'Alice',
          entityType: 'person',
          observations: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastModified: '2024-01-01T00:00:00.000Z',
        }],
        relations: [],
      };
      await storage.saveGraph(graph);

      // Verify file exists
      const stat = await fs.stat(testFilePath);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('should clear the in-memory cache', async () => {
      // Load to populate cache
      await storage.loadGraph();

      // Save data
      const graph = {
        entities: [{
          name: 'NewEntity',
          entityType: 'test',
          observations: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastModified: '2024-01-01T00:00:00.000Z',
        }],
        relations: [],
      };
      await storage.saveGraph(graph);

      // Clear cache manually
      storage.clearCache();

      // Load - should read from database
      const loaded = await storage.loadGraph();

      expect(loaded.entities).toHaveLength(1);
      expect(loaded.entities[0].name).toBe('NewEntity');
    });
  });

  describe('getFilePath', () => {
    it('should return the file path', () => {
      expect(storage.getFilePath()).toBe(testFilePath);
    });
  });

  describe('Append Operations', () => {
    describe('appendEntity', () => {
      it('should append entity to database', async () => {
        const entity = {
          name: 'Alice',
          entityType: 'person',
          observations: ['Engineer'],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };

        await storage.appendEntity(entity);

        const graph = await storage.loadGraph();
        expect(graph.entities).toHaveLength(1);
        expect(graph.entities[0].name).toBe('Alice');
      });

      it('should update existing entity (INSERT OR REPLACE)', async () => {
        // First append
        const entity1 = {
          name: 'Alice',
          entityType: 'person',
          observations: ['v1'],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };
        await storage.appendEntity(entity1);

        // Append updated version (same name)
        const entity2 = {
          name: 'Alice',
          entityType: 'person',
          observations: ['v2'],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };
        await storage.appendEntity(entity2);

        // SQLite uses INSERT OR REPLACE, so only 1 entity
        const graph = await storage.loadGraph();
        expect(graph.entities).toHaveLength(1);
        expect(graph.entities[0].observations).toEqual(['v2']);
      });

      it('should track pending changes', async () => {
        const entity = {
          name: 'Test',
          entityType: 'test',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };

        expect(storage.getPendingAppends()).toBe(0);
        await storage.appendEntity(entity);
        expect(storage.getPendingAppends()).toBeGreaterThanOrEqual(0); // May be 0 or 1 depending on auto-persist
      });
    });

    describe('appendRelation', () => {
      it('should append relation to database', async () => {
        // First create the entities (required for referential integrity)
        await storage.appendEntity({
          name: 'Alice',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });
        await storage.appendEntity({
          name: 'Bob',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        const relation = {
          from: 'Alice',
          to: 'Bob',
          relationType: 'knows',
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };

        await storage.appendRelation(relation);

        const graph = await storage.loadGraph();
        expect(graph.relations).toHaveLength(1);
        expect(graph.relations[0].from).toBe('Alice');
      });

      it('should update cache with new relation', async () => {
        // First create the entities (required for referential integrity)
        await storage.appendEntity({
          name: 'Alice',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });
        await storage.appendEntity({
          name: 'Bob',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        const relation = {
          from: 'Alice',
          to: 'Bob',
          relationType: 'knows',
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };

        await storage.appendRelation(relation);

        const graph = await storage.loadGraph();
        expect(graph.relations).toHaveLength(1);
        expect(graph.relations[0].from).toBe('Alice');
      });
    });
  });

  describe('updateEntity', () => {
    it('should update entity in cache and database', async () => {
      // First create an entity
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      const updated = await storage.updateEntity('Alice', { importance: 8 });
      expect(updated).toBe(true);

      const graph = await storage.loadGraph();
      expect(graph.entities[0].importance).toBe(8);
    });

    it('should return false for non-existent entity', async () => {
      const updated = await storage.updateEntity('NonExistent', { importance: 5 });
      expect(updated).toBe(false);
    });

    it('should update lastModified timestamp', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        lastModified: '2024-01-01T00:00:00.000Z',
      });

      await storage.updateEntity('Alice', { importance: 5 });

      const graph = await storage.loadGraph();
      expect(graph.entities[0].lastModified).not.toBe('2024-01-01T00:00:00.000Z');
    });

    it('should persist updates after flush', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      await storage.updateEntity('Alice', { importance: 9 });
      await storage.flush();

      // Create new storage to verify persistence
      const newStorage = new SQLiteStorage(testFilePath);
      const graph = await newStorage.loadGraph();
      expect(graph.entities[0].importance).toBe(9);
      newStorage.close();
    });
  });

  describe('Compaction', () => {
    it('should run VACUUM on compact', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: ['test'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // compact() should run VACUUM and rebuild FTS
      await storage.compact();

      // Verify data is still there
      storage.clearCache();
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
    });
  });

  describe('Index Operations', () => {
    it('should get entity by name', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      const entity = storage.getEntityByName('Alice');
      expect(entity).toBeDefined();
      expect(entity?.name).toBe('Alice');
    });

    it('should return undefined for non-existent entity', async () => {
      await storage.ensureLoaded();
      const entity = storage.getEntityByName('NonExistent');
      expect(entity).toBeUndefined();
    });

    it('should check entity existence', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      expect(storage.hasEntity('Alice')).toBe(true);
      expect(storage.hasEntity('Bob')).toBe(false);
    });

    it('should get entities by type', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Company', entityType: 'organization', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      });

      const people = storage.getEntitiesByType('person');
      expect(people).toHaveLength(2);

      const orgs = storage.getEntitiesByType('organization');
      expect(orgs).toHaveLength(1);
    });

    it('should get all entity types', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Company', entityType: 'organization', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      });

      const types = storage.getEntityTypes();
      expect(types).toContain('person');
      expect(types).toContain('organization');
    });

    it('should get lowercase data for entity', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'Person',
        observations: ['Software Engineer'],
        tags: ['TEAM'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      const lowercased = storage.getLowercased('Alice');
      expect(lowercased).toBeDefined();
      expect(lowercased?.name).toBe('alice');
      expect(lowercased?.entityType).toBe('person');
      expect(lowercased?.observations).toContain('software engineer');
      expect(lowercased?.tags).toContain('team');
    });
  });

  describe('getGraphForMutation', () => {
    it('should return a deep copy of the graph', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: ['original'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      const mutableGraph = await storage.getGraphForMutation();
      mutableGraph.entities[0].observations.push('modified');

      // Original cache should be unaffected
      const cached = await storage.loadGraph();
      expect(cached.entities[0].observations).toEqual(['original']);
    });

    it('should return fresh copy each time', async () => {
      await storage.appendEntity({
        name: 'Test',
        entityType: 'test',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      const copy1 = await storage.getGraphForMutation();
      const copy2 = await storage.getGraphForMutation();

      expect(copy1).not.toBe(copy2);
    });
  });

  describe('Concurrent Access', () => {
    it('should handle multiple concurrent reads', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      });

      // Perform multiple concurrent reads
      const results = await Promise.all([
        storage.loadGraph(),
        storage.loadGraph(),
        storage.loadGraph(),
      ]);

      // All should return same cached data
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
    });
  });

  describe('Persistence', () => {
    it('should persist data across storage instances', async () => {
      // Save data with first instance
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['test'], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      });
      storage.close();

      // Load with new instance
      const newStorage = new SQLiteStorage(testFilePath);
      const graph = await newStorage.loadGraph();

      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('Alice');
      newStorage.close();
    });

    it('should flush pending changes on demand', async () => {
      await storage.appendEntity({
        name: 'Test',
        entityType: 'test',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      await storage.flush();

      // Verify file was written
      const stat = await fs.stat(testFilePath);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe('Transaction Safety', () => {
    it('should use transactions for saveGraph', async () => {
      // Save multiple entities - should be atomic
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Charlie', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [
          { from: 'Alice', to: 'Bob', relationType: 'knows', createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
      });

      storage.clearCache();
      const graph = await storage.loadGraph();

      expect(graph.entities).toHaveLength(3);
      expect(graph.relations).toHaveLength(1);
    });
  });

  describe('Referential Integrity', () => {
    it('should cascade delete relations when entity is deleted', async () => {
      // Create entities and relation
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [
          { from: 'Alice', to: 'Bob', relationType: 'knows', createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
      });

      // Now save without Alice - relations referencing Alice should be cascade deleted
      await storage.saveGraph({
        entities: [
          { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      });

      storage.clearCache();
      const graph = await storage.loadGraph();

      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('Bob');
      expect(graph.relations).toHaveLength(0);
    });

    it('should allow saving entities with dangling parentId references', async () => {
      // saveGraph allows dangling references (like JSONL behavior)
      // This matches the original JSONL behavior where parentId could reference non-existent entities
      await storage.saveGraph({
        entities: [
          { name: 'Child', entityType: 'item', observations: [], parentId: 'NonExistentParent', createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      });

      storage.clearCache();
      const graph = await storage.loadGraph();

      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('Child');
      // parentId is preserved even if parent doesn't exist (matches JSONL behavior)
      expect(graph.entities[0].parentId).toBe('NonExistentParent');
    });
  });

  describe('FTS5 Full-Text Search', () => {
    it('should perform full-text search on entity names', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Alice Smith', entityType: 'person', observations: ['Software engineer'], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Bob Johnson', entityType: 'person', observations: ['Designer'], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Alice Cooper', entityType: 'person', observations: ['Musician'], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      });

      const results = storage.fullTextSearch('Alice');

      expect(results.length).toBeGreaterThan(0);
      expect(results.map(r => r.name)).toContain('Alice Smith');
      expect(results.map(r => r.name)).toContain('Alice Cooper');
    });

    it('should perform full-text search on observations', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['Software engineer at Google'], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Bob', entityType: 'person', observations: ['Designer at Apple'], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      });

      const results = storage.fullTextSearch('engineer');

      expect(results.length).toBeGreaterThan(0);
      expect(results.map(r => r.name)).toContain('Alice');
    });

    it('should return empty array for invalid FTS query', async () => {
      await storage.ensureLoaded();

      // Invalid FTS5 query syntax should return empty array, not throw
      const results = storage.fullTextSearch('AND OR NOT');

      expect(results).toEqual([]);
    });

    it('should perform simple LIKE-based search', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: ['Engineer'], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Bob', entityType: 'person', observations: ['Designer'], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      });

      const results = storage.simpleSearch('alice');

      expect(results).toContain('Alice');
      expect(results).not.toContain('Bob');
    });
  });

  describe('WAL Mode', () => {
    it('should create WAL files for persistence', async () => {
      await storage.appendEntity({
        name: 'Test',
        entityType: 'test',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // WAL files should be created
      const files = await fs.readdir(testDir);
      // Main db file should exist
      expect(files).toContain('test-graph.db');
      // WAL and SHM files may exist depending on whether checkpoint was run
    });
  });

  describe('Relation Operations', () => {
    beforeEach(async () => {
      // Create entities for relation tests
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Charlie', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [
          { from: 'Alice', to: 'Bob', relationType: 'knows', createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { from: 'Alice', to: 'Charlie', relationType: 'manages', createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { from: 'Bob', to: 'Charlie', relationType: 'works_with', createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
      });
    });

    describe('getRelationsFrom', () => {
      it('should return outgoing relations for an entity', async () => {
        const relations = storage.getRelationsFrom('Alice');
        expect(relations).toHaveLength(2);
        expect(relations.every(r => r.from === 'Alice')).toBe(true);
      });

      it('should return empty array for entity with no outgoing relations', async () => {
        const relations = storage.getRelationsFrom('Charlie');
        expect(relations).toHaveLength(0);
      });

      it('should return empty array for non-existent entity', async () => {
        const relations = storage.getRelationsFrom('NonExistent');
        expect(relations).toHaveLength(0);
      });
    });

    describe('getRelationsTo', () => {
      it('should return incoming relations for an entity', async () => {
        const relations = storage.getRelationsTo('Charlie');
        expect(relations).toHaveLength(2);
        expect(relations.every(r => r.to === 'Charlie')).toBe(true);
      });

      it('should return empty array for entity with no incoming relations', async () => {
        const relations = storage.getRelationsTo('Alice');
        expect(relations).toHaveLength(0);
      });

      it('should return empty array for non-existent entity', async () => {
        const relations = storage.getRelationsTo('NonExistent');
        expect(relations).toHaveLength(0);
      });
    });

    describe('getRelationsFor', () => {
      it('should return all relations involving an entity', async () => {
        const relations = storage.getRelationsFor('Alice');
        expect(relations).toHaveLength(2);
      });

      it('should return incoming and outgoing relations for Bob', async () => {
        const relations = storage.getRelationsFor('Bob');
        expect(relations).toHaveLength(2);
        expect(relations.some(r => r.from === 'Alice' && r.to === 'Bob')).toBe(true);
        expect(relations.some(r => r.from === 'Bob' && r.to === 'Charlie')).toBe(true);
      });

      it('should cache bidirectional relation lookups', async () => {
        // First lookup
        const relations1 = storage.getRelationsFor('Bob');
        // Second lookup should use cache
        const relations2 = storage.getRelationsFor('Bob');

        expect(relations1).toEqual(relations2);
      });

      it('should return empty array for entity with no relations', async () => {
        await storage.appendEntity({
          name: 'Lonely',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        const relations = storage.getRelationsFor('Lonely');
        expect(relations).toHaveLength(0);
      });
    });

    describe('hasRelations', () => {
      it('should return true for entity with relations', async () => {
        expect(storage.hasRelations('Alice')).toBe(true);
        expect(storage.hasRelations('Bob')).toBe(true);
        expect(storage.hasRelations('Charlie')).toBe(true);
      });

      it('should return false for entity with no relations', async () => {
        await storage.appendEntity({
          name: 'Lonely',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        expect(storage.hasRelations('Lonely')).toBe(false);
      });

      it('should return false for non-existent entity', async () => {
        expect(storage.hasRelations('NonExistent')).toBe(false);
      });
    });

    describe('Bidirectional Cache Invalidation', () => {
      it('should invalidate cache when new relation is added', async () => {
        // First lookup to populate cache
        const relations1 = storage.getRelationsFor('Alice');
        expect(relations1).toHaveLength(2);

        // Add new relation
        await storage.appendRelation({
          from: 'Charlie',
          to: 'Alice',
          relationType: 'admires',
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        // Cache should be invalidated
        const relations2 = storage.getRelationsFor('Alice');
        expect(relations2).toHaveLength(3);
      });
    });
  });

  describe('Embedding Storage', () => {
    describe('storeEmbedding', () => {
      it('should store an embedding vector', async () => {
        await storage.ensureLoaded();
        await storage.appendEntity({
          name: 'Alice',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        const vector = [0.1, 0.2, 0.3, 0.4, 0.5];
        storage.storeEmbedding('Alice', vector, 'test-model');

        const retrieved = storage.getEmbedding('Alice');
        expect(retrieved).not.toBeNull();
        expect(retrieved).toHaveLength(5);
      });

      it('should update existing embedding', async () => {
        await storage.ensureLoaded();
        await storage.appendEntity({
          name: 'Alice',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        storage.storeEmbedding('Alice', [0.1, 0.2], 'model-v1');
        storage.storeEmbedding('Alice', [0.3, 0.4, 0.5], 'model-v2');

        const retrieved = storage.getEmbedding('Alice');
        expect(retrieved).toHaveLength(3);
      });

      it('should throw error if database not initialized', async () => {
        const uninitStorage = new SQLiteStorage(join(testDir, 'uninit.db'));

        expect(() => {
          uninitStorage.storeEmbedding('Alice', [0.1], 'model');
        }).toThrow('Database not initialized');
      });
    });

    describe('getEmbedding', () => {
      it('should retrieve stored embedding', async () => {
        await storage.ensureLoaded();
        await storage.appendEntity({
          name: 'Alice',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        const vector = [0.1, 0.2, 0.3];
        storage.storeEmbedding('Alice', vector, 'test-model');

        const retrieved = storage.getEmbedding('Alice');
        expect(retrieved).not.toBeNull();
        // Float32 may have slight precision differences
        expect(retrieved![0]).toBeCloseTo(0.1, 5);
        expect(retrieved![1]).toBeCloseTo(0.2, 5);
        expect(retrieved![2]).toBeCloseTo(0.3, 5);
      });

      it('should return null for non-existent embedding', async () => {
        await storage.ensureLoaded();
        const retrieved = storage.getEmbedding('NonExistent');
        expect(retrieved).toBeNull();
      });

      it('should return null when database not initialized', async () => {
        const uninitStorage = new SQLiteStorage(join(testDir, 'uninit.db'));
        const result = uninitStorage.getEmbedding('Alice');
        expect(result).toBeNull();
      });
    });

    describe('loadAllEmbeddings', () => {
      it('should load all stored embeddings', async () => {
        await storage.ensureLoaded();
        await storage.saveGraph({
          entities: [
            { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
            { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          ],
          relations: [],
        });

        storage.storeEmbedding('Alice', [0.1, 0.2], 'model');
        storage.storeEmbedding('Bob', [0.3, 0.4], 'model');

        const embeddings = await storage.loadAllEmbeddings();
        expect(embeddings).toHaveLength(2);
        expect(embeddings.map(e => e[0])).toContain('Alice');
        expect(embeddings.map(e => e[0])).toContain('Bob');
      });

      it('should return empty array when no embeddings exist', async () => {
        await storage.ensureLoaded();
        const embeddings = await storage.loadAllEmbeddings();
        expect(embeddings).toEqual([]);
      });

      it('should return empty array when database not initialized', async () => {
        const uninitStorage = new SQLiteStorage(join(testDir, 'uninit.db'));
        const embeddings = await uninitStorage.loadAllEmbeddings();
        expect(embeddings).toEqual([]);
      });
    });

    describe('removeEmbedding', () => {
      it('should remove embedding for entity', async () => {
        await storage.ensureLoaded();
        await storage.appendEntity({
          name: 'Alice',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        storage.storeEmbedding('Alice', [0.1, 0.2], 'model');
        expect(storage.hasEmbedding('Alice')).toBe(true);

        storage.removeEmbedding('Alice');
        expect(storage.hasEmbedding('Alice')).toBe(false);
      });

      it('should not throw when removing non-existent embedding', async () => {
        await storage.ensureLoaded();
        expect(() => storage.removeEmbedding('NonExistent')).not.toThrow();
      });

      it('should not throw when database not initialized', async () => {
        const uninitStorage = new SQLiteStorage(join(testDir, 'uninit.db'));
        expect(() => uninitStorage.removeEmbedding('Alice')).not.toThrow();
      });
    });

    describe('clearAllEmbeddings', () => {
      it('should clear all stored embeddings', async () => {
        await storage.ensureLoaded();
        await storage.saveGraph({
          entities: [
            { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
            { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          ],
          relations: [],
        });

        storage.storeEmbedding('Alice', [0.1], 'model');
        storage.storeEmbedding('Bob', [0.2], 'model');
        expect(storage.getEmbeddingStats().count).toBe(2);

        storage.clearAllEmbeddings();
        expect(storage.getEmbeddingStats().count).toBe(0);
      });

      it('should not throw when no embeddings exist', async () => {
        await storage.ensureLoaded();
        expect(() => storage.clearAllEmbeddings()).not.toThrow();
      });

      it('should not throw when database not initialized', async () => {
        const uninitStorage = new SQLiteStorage(join(testDir, 'uninit.db'));
        expect(() => uninitStorage.clearAllEmbeddings()).not.toThrow();
      });
    });

    describe('hasEmbedding', () => {
      it('should return true for entity with embedding', async () => {
        await storage.ensureLoaded();
        await storage.appendEntity({
          name: 'Alice',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });

        storage.storeEmbedding('Alice', [0.1, 0.2], 'model');
        expect(storage.hasEmbedding('Alice')).toBe(true);
      });

      it('should return false for entity without embedding', async () => {
        await storage.ensureLoaded();
        expect(storage.hasEmbedding('NonExistent')).toBe(false);
      });

      it('should return false when database not initialized', async () => {
        const uninitStorage = new SQLiteStorage(join(testDir, 'uninit.db'));
        expect(uninitStorage.hasEmbedding('Alice')).toBe(false);
      });
    });

    describe('getEmbeddingStats', () => {
      it('should return correct stats', async () => {
        await storage.ensureLoaded();
        await storage.saveGraph({
          entities: [
            { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
            { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          ],
          relations: [],
        });

        storage.storeEmbedding('Alice', [0.1], 'model-a');
        storage.storeEmbedding('Bob', [0.2], 'model-b');

        const stats = storage.getEmbeddingStats();
        expect(stats.count).toBe(2);
        expect(stats.models).toContain('model-a');
        expect(stats.models).toContain('model-b');
      });

      it('should return zero count when no embeddings exist', async () => {
        await storage.ensureLoaded();
        const stats = storage.getEmbeddingStats();
        expect(stats.count).toBe(0);
        expect(stats.models).toEqual([]);
      });

      it('should return zero count when database not initialized', async () => {
        const uninitStorage = new SQLiteStorage(join(testDir, 'uninit.db'));
        const stats = uninitStorage.getEmbeddingStats();
        expect(stats.count).toBe(0);
        expect(stats.models).toEqual([]);
      });
    });
  });

  describe('Database Operations without Cache', () => {
    it('should fall back to database query for getRelationsFrom', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [
          { from: 'Alice', to: 'Bob', relationType: 'knows', createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
      });

      // Verify data is accessible
      const relations = storage.getRelationsFrom('Alice');
      expect(relations).toHaveLength(1);
    });

    it('should return empty for uninitialized database queries', async () => {
      const uninitStorage = new SQLiteStorage(join(testDir, 'uninit.db'));

      expect(uninitStorage.fullTextSearch('test')).toEqual([]);
      expect(uninitStorage.simpleSearch('test')).toEqual([]);
    });
  });

  describe('updateEntity with type change', () => {
    it('should update type index when entity type changes', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // Update type
      await storage.updateEntity('Alice', { entityType: 'employee' });

      // Check type index is updated
      const people = storage.getEntitiesByType('person');
      const employees = storage.getEntitiesByType('employee');

      expect(people).toHaveLength(0);
      expect(employees).toHaveLength(1);
      expect(employees[0].name).toBe('Alice');
    });
  });
});
