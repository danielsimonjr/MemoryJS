/**
 * GraphStorage Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('GraphStorage', () => {
  let storage: GraphStorage;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `graph-storage-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');
    storage = new GraphStorage(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadGraph', () => {
    it('should return empty graph when file does not exist', async () => {
      const graph = await storage.loadGraph();

      expect(graph.entities).toEqual([]);
      expect(graph.relations).toEqual([]);
    });

    it('should load entities and relations from file', async () => {
      // Write test data
      const testData = [
        JSON.stringify({
          type: 'entity',
          name: 'Alice',
          entityType: 'person',
          observations: ['Engineer'],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastModified: '2024-01-01T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'relation',
          from: 'Alice',
          to: 'Bob',
          relationType: 'knows',
          createdAt: '2024-01-01T00:00:00.000Z',
          lastModified: '2024-01-01T00:00:00.000Z',
        }),
      ].join('\n');

      await fs.writeFile(testFilePath, testData);

      const graph = await storage.loadGraph();

      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('Alice');
      expect(graph.relations).toHaveLength(1);
      expect(graph.relations[0].from).toBe('Alice');
    });

    it('should add missing timestamps for backward compatibility', async () => {
      const testData = JSON.stringify({
        type: 'entity',
        name: 'Alice',
        entityType: 'person',
        observations: [],
      });

      await fs.writeFile(testFilePath, testData);

      const graph = await storage.loadGraph();

      expect(graph.entities[0].createdAt).toBeDefined();
      expect(graph.entities[0].lastModified).toBeDefined();
    });

    it('should use cache on second load', async () => {
      // First load - populates cache
      await storage.loadGraph();

      // Modify file directly
      await fs.writeFile(testFilePath, JSON.stringify({
        type: 'entity',
        name: 'Modified',
        entityType: 'test',
        observations: [],
      }));

      // Second load - should return cached data (not modified data)
      const graph = await storage.loadGraph();

      expect(graph.entities).toHaveLength(0); // Empty from first load
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

      // Original cache should not be affected until saveGraph is called
      const graph3 = await storage.loadGraph();
      expect(graph3.entities).toHaveLength(0);
    });
  });

  describe('saveGraph', () => {
    it('should save entities and relations to JSONL format', async () => {
      const graph = {
        entities: [
          {
            name: 'Alice',
            entityType: 'person',
            observations: ['Engineer'],
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

      const content = await fs.readFile(testFilePath, 'utf-8');
      const lines = content.split('\n');

      expect(lines).toHaveLength(2);

      const entity = JSON.parse(lines[0]);
      expect(entity.type).toBe('entity');
      expect(entity.name).toBe('Alice');

      const relation = JSON.parse(lines[1]);
      expect(relation.type).toBe('relation');
      expect(relation.from).toBe('Alice');
    });

    it('should include optional entity fields', async () => {
      const graph = {
        entities: [
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

      const content = await fs.readFile(testFilePath, 'utf-8');
      const entity = JSON.parse(content);

      expect(entity.tags).toEqual(['team']);
      expect(entity.importance).toBe(8);
      expect(entity.parentId).toBe('Company');
    });

    it('should invalidate cache after save', async () => {
      // Load to populate cache
      await storage.loadGraph();

      // Save new data
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

      // Load again - should read from disk (cache invalidated)
      const loaded = await storage.loadGraph();

      expect(loaded.entities).toHaveLength(1);
      expect(loaded.entities[0].name).toBe('Alice');
    });
  });

  describe('clearCache', () => {
    it('should clear the in-memory cache', async () => {
      // Load to populate cache
      await storage.loadGraph();

      // Modify file
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

      // Load - should read from disk
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
      it('should append entity to file', async () => {
        const entity = {
          name: 'Alice',
          entityType: 'person',
          observations: ['Engineer'],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };

        await storage.appendEntity(entity);

        const content = await fs.readFile(testFilePath, 'utf-8');
        expect(content).toContain('Alice');
      });

      it('should update cache with new entity', async () => {
        const entity = {
          name: 'Alice',
          entityType: 'person',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };

        await storage.appendEntity(entity);

        const graph = await storage.loadGraph();
        expect(graph.entities).toHaveLength(1);
        expect(graph.entities[0].name).toBe('Alice');
      });

      it('should accumulate entities in cache (deduplication happens on reload)', async () => {
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

        // Cache has both entries (no deduplication)
        const graph = await storage.loadGraph();
        expect(graph.entities).toHaveLength(2);

        // But fresh load from disk deduplicates
        storage.clearCache();
        const reloaded = await storage.loadGraph();
        expect(reloaded.entities).toHaveLength(1);
        expect(reloaded.entities[0].observations).toEqual(['v2']);
      });

      it('should track pending appends', async () => {
        const entity = {
          name: 'Test',
          entityType: 'test',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };

        expect(storage.getPendingAppends()).toBe(0);
        await storage.appendEntity(entity);
        expect(storage.getPendingAppends()).toBe(1);
      });
    });

    describe('appendRelation', () => {
      it('should append relation to file', async () => {
        const relation = {
          from: 'Alice',
          to: 'Bob',
          relationType: 'knows',
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };

        await storage.appendRelation(relation);

        const content = await fs.readFile(testFilePath, 'utf-8');
        expect(content).toContain('"type":"relation"');
      });

      it('should update cache with new relation', async () => {
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

      it('should track pending appends', async () => {
        const relation = {
          from: 'A',
          to: 'B',
          relationType: 'test',
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        };

        await storage.appendRelation(relation);
        expect(storage.getPendingAppends()).toBe(1);
      });
    });
  });

  describe('updateEntity', () => {
    it('should update entity in cache and append to file', async () => {
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
  });

  describe('Compaction', () => {
    it('should write cache to file on compact (no in-memory dedup)', async () => {
      // Append same entity multiple times
      for (let i = 0; i < 3; i++) {
        await storage.appendEntity({
          name: 'Alice',
          entityType: 'person',
          observations: [`v${i}`],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });
      }

      // File should have 3 lines
      const beforeContent = await fs.readFile(testFilePath, 'utf-8');
      const beforeLines = beforeContent.split('\n').filter(l => l.trim());
      expect(beforeLines.length).toBe(3);

      // compact() saves cache which has 3 entries
      await storage.compact();

      // File still has 3 lines (cache has duplicates)
      const afterContent = await fs.readFile(testFilePath, 'utf-8');
      const afterLines = afterContent.split('\n').filter(l => l.trim());
      expect(afterLines.length).toBe(3);

      // Deduplication happens on reload
      storage.clearCache();
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].observations).toEqual(['v2']);
    });

    it('should reset pending appends counter', async () => {
      await storage.appendEntity({
        name: 'Test',
        entityType: 'test',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      expect(storage.getPendingAppends()).toBe(1);

      await storage.compact();

      expect(storage.getPendingAppends()).toBe(0);
    });

    it('should preserve latest version on reload (dedup via Map)', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: ['old'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: ['new'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // Cache has 2 entries (both versions)
      const graphBeforeReload = await storage.loadGraph();
      expect(graphBeforeReload.entities).toHaveLength(2);

      // Clear cache and reload - Map deduplication kicks in
      storage.clearCache();
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].observations).toEqual(['new']);
    });
  });

  describe('Index Operations', () => {
    it('should build indexes on load', async () => {
      // Create test data with multiple entities
      const graph = {
        entities: [
          { name: 'Alice', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Bob', entityType: 'person', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
          { name: 'Company', entityType: 'organization', observations: [], createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
        ],
        relations: [],
      };
      await storage.saveGraph(graph);

      // Create new storage to trigger fresh load
      const newStorage = new GraphStorage(testFilePath);
      await newStorage.loadGraph();

      // Indexes should allow fast lookups (tested indirectly through behavior)
      const loaded = await newStorage.loadGraph();
      expect(loaded.entities).toHaveLength(3);
    });

    it('should update indexes on append', async () => {
      await storage.appendEntity({
        name: 'Alice',
        entityType: 'person',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // Index should reflect new entity
      const graph = await storage.loadGraph();
      expect(graph.entities.find(e => e.name === 'Alice')).toBeDefined();
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
});
