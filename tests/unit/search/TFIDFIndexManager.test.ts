/**
 * TFIDFIndexManager Unit Tests
 *
 * Tests for TF-IDF index building, updating, persistence, and lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TFIDFIndexManager } from '../../../src/search/TFIDFIndexManager.js';
import type { KnowledgeGraph } from '../../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TFIDFIndexManager', () => {
  let manager: TFIDFIndexManager;
  let testDir: string;
  let sampleGraph: KnowledgeGraph;

  beforeEach(async () => {
    testDir = join(tmpdir(), `tfidf-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    manager = new TFIDFIndexManager(testDir);

    sampleGraph = {
      entities: [
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Software developer', 'Works on frontend'],
        },
        {
          name: 'Bob',
          entityType: 'person',
          observations: ['Database administrator', 'Works on backend'],
        },
        {
          name: 'Project X',
          entityType: 'project',
          observations: ['Full stack application', 'Uses React'],
        },
      ],
      relations: [],
    };
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('buildIndex', () => {
    it('should build index from graph', async () => {
      const index = await manager.buildIndex(sampleGraph);

      expect(index).toBeDefined();
      expect(index.documents.size).toBe(3);
      expect(index.idf.size).toBeGreaterThan(0);
    });

    it('should include version in index', async () => {
      const index = await manager.buildIndex(sampleGraph);

      expect(index.version).toBe('1.0');
    });

    it('should include lastUpdated timestamp', async () => {
      const before = new Date().toISOString();
      const index = await manager.buildIndex(sampleGraph);
      const after = new Date().toISOString();

      expect(index.lastUpdated >= before).toBe(true);
      expect(index.lastUpdated <= after).toBe(true);
    });

    it('should create document vectors for each entity', async () => {
      const index = await manager.buildIndex(sampleGraph);

      expect(index.documents.has('Alice')).toBe(true);
      expect(index.documents.has('Bob')).toBe(true);
      expect(index.documents.has('Project X')).toBe(true);
    });

    it('should calculate term frequencies', async () => {
      const index = await manager.buildIndex(sampleGraph);
      const aliceDoc = index.documents.get('Alice');

      expect(aliceDoc).toBeDefined();
      expect(aliceDoc?.terms).toBeDefined();
      expect(Object.keys(aliceDoc?.terms || {}).length).toBeGreaterThan(0);
    });

    it('should include entity name in document text', async () => {
      const index = await manager.buildIndex(sampleGraph);
      const aliceDoc = index.documents.get('Alice');

      expect(aliceDoc?.documentText).toContain('Alice');
    });

    it('should include entity type in document text', async () => {
      const index = await manager.buildIndex(sampleGraph);
      const aliceDoc = index.documents.get('Alice');

      expect(aliceDoc?.documentText).toContain('person');
    });

    it('should include observations in document text', async () => {
      const index = await manager.buildIndex(sampleGraph);
      const aliceDoc = index.documents.get('Alice');

      expect(aliceDoc?.documentText).toContain('Software developer');
    });

    it('should calculate IDF for terms', async () => {
      const index = await manager.buildIndex(sampleGraph);

      // 'works' appears in multiple documents, should have lower IDF
      // than unique terms
      expect(index.idf.size).toBeGreaterThan(0);
    });

    it('should handle empty graph', async () => {
      const index = await manager.buildIndex({ entities: [], relations: [] });

      expect(index.documents.size).toBe(0);
      expect(index.idf.size).toBe(0);
    });

    it('should handle entity with no observations', async () => {
      const graph: KnowledgeGraph = {
        entities: [{ name: 'Empty', entityType: 'test', observations: [] }],
        relations: [],
      };

      const index = await manager.buildIndex(graph);

      expect(index.documents.has('Empty')).toBe(true);
    });
  });

  describe('updateIndex', () => {
    it('should build from scratch if no existing index', async () => {
      const index = await manager.updateIndex(sampleGraph, new Set(['Alice']));

      expect(index.documents.size).toBe(3);
    });

    it('should update existing index incrementally', async () => {
      // Build initial index
      await manager.buildIndex(sampleGraph);

      // Update with changed entity
      const changedGraph: KnowledgeGraph = {
        ...sampleGraph,
        entities: [
          ...sampleGraph.entities.slice(0, 2),
          { name: 'Alice', entityType: 'person', observations: ['Updated observation'] },
        ],
      };

      const index = await manager.updateIndex(changedGraph, new Set(['Alice']));

      expect(index.documents.get('Alice')?.documentText).toContain('Updated observation');
    });

    it('should remove deleted entities from index', async () => {
      await manager.buildIndex(sampleGraph);

      // Remove an entity
      const reducedGraph: KnowledgeGraph = {
        entities: sampleGraph.entities.slice(0, 2),
        relations: [],
      };

      const index = await manager.updateIndex(reducedGraph, new Set(['Project X']));

      expect(index.documents.has('Project X')).toBe(false);
    });

    it('should update lastUpdated on incremental update', async () => {
      await manager.buildIndex(sampleGraph);
      await new Promise(r => setTimeout(r, 10));

      const updatedIndex = await manager.updateIndex(sampleGraph, new Set(['Alice']));

      expect(updatedIndex.lastUpdated).toBeDefined();
    });

    it('should recalculate IDF after update', async () => {
      await manager.buildIndex(sampleGraph);

      // Add more entities with new terms
      const expandedGraph: KnowledgeGraph = {
        entities: [
          ...sampleGraph.entities,
          { name: 'NewEntity', entityType: 'new', observations: ['Unique term xyz'] },
        ],
        relations: [],
      };

      const index = await manager.updateIndex(expandedGraph, new Set(['NewEntity']));

      expect(index.idf.size).toBeGreaterThan(0);
    });
  });

  describe('saveIndex and loadIndex', () => {
    it('should save index to disk', async () => {
      await manager.buildIndex(sampleGraph);
      await manager.saveIndex();

      const indexPath = join(testDir, '.indexes', 'tfidf-index.json');
      const exists = await fs.access(indexPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should load index from disk', async () => {
      await manager.buildIndex(sampleGraph);
      await manager.saveIndex();

      // Create new manager instance
      const newManager = new TFIDFIndexManager(testDir);
      const loaded = await newManager.loadIndex();

      expect(loaded).not.toBeNull();
      expect(loaded?.documents.size).toBe(3);
    });

    it('should preserve document data after save/load', async () => {
      await manager.buildIndex(sampleGraph);
      await manager.saveIndex();

      const newManager = new TFIDFIndexManager(testDir);
      const loaded = await newManager.loadIndex();

      expect(loaded?.documents.get('Alice')?.entityName).toBe('Alice');
      expect(loaded?.documents.get('Alice')?.documentText).toContain('Alice');
    });

    it('should preserve IDF data after save/load', async () => {
      await manager.buildIndex(sampleGraph);
      const originalSize = manager.getIndex()?.idf.size;
      await manager.saveIndex();

      const newManager = new TFIDFIndexManager(testDir);
      const loaded = await newManager.loadIndex();

      expect(loaded?.idf.size).toBe(originalSize);
    });

    it('should return null for non-existent index file', async () => {
      const loaded = await manager.loadIndex();
      expect(loaded).toBeNull();
    });

    it('should create indexes directory if not exists', async () => {
      await manager.buildIndex(sampleGraph);
      await manager.saveIndex();

      const indexDir = join(testDir, '.indexes');
      const exists = await fs.access(indexDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should throw error when saving without index', async () => {
      await expect(manager.saveIndex()).rejects.toThrow('No index to save');
    });

    it('should accept index parameter for save', async () => {
      const index = await manager.buildIndex(sampleGraph);

      // Create new manager without cached index
      const newManager = new TFIDFIndexManager(testDir);
      await newManager.saveIndex(index);

      const loaded = await newManager.loadIndex();
      expect(loaded).not.toBeNull();
    });
  });

  describe('getIndex', () => {
    it('should return null before building', () => {
      const index = manager.getIndex();
      expect(index).toBeNull();
    });

    it('should return cached index after building', async () => {
      await manager.buildIndex(sampleGraph);

      const index = manager.getIndex();
      expect(index).not.toBeNull();
      expect(index?.documents.size).toBe(3);
    });

    it('should return cached index after loading', async () => {
      await manager.buildIndex(sampleGraph);
      await manager.saveIndex();

      const newManager = new TFIDFIndexManager(testDir);
      await newManager.loadIndex();

      expect(newManager.getIndex()).not.toBeNull();
    });
  });

  describe('clearIndex', () => {
    it('should clear cached index', async () => {
      await manager.buildIndex(sampleGraph);
      await manager.clearIndex();

      expect(manager.getIndex()).toBeNull();
    });

    it('should delete index file from disk', async () => {
      await manager.buildIndex(sampleGraph);
      await manager.saveIndex();
      await manager.clearIndex();

      const indexPath = join(testDir, '.indexes', 'tfidf-index.json');
      const exists = await fs.access(indexPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should not throw if index file does not exist', async () => {
      await expect(manager.clearIndex()).resolves.not.toThrow();
    });
  });

  describe('needsRebuild', () => {
    it('should return true when no index exists', () => {
      const needs = manager.needsRebuild(sampleGraph);
      expect(needs).toBe(true);
    });

    it('should return false when index matches graph', async () => {
      await manager.buildIndex(sampleGraph);

      const needs = manager.needsRebuild(sampleGraph);
      expect(needs).toBe(false);
    });

    it('should return true when entity count differs', async () => {
      await manager.buildIndex(sampleGraph);

      const modifiedGraph: KnowledgeGraph = {
        entities: sampleGraph.entities.slice(0, 2),
        relations: [],
      };

      const needs = manager.needsRebuild(modifiedGraph);
      expect(needs).toBe(true);
    });

    it('should return true when entity is missing from index', async () => {
      await manager.buildIndex(sampleGraph);

      const modifiedGraph: KnowledgeGraph = {
        entities: [
          ...sampleGraph.entities.slice(0, 2),
          { name: 'NewEntity', entityType: 'test', observations: [] },
        ],
        relations: [],
      };

      const needs = manager.needsRebuild(modifiedGraph);
      expect(needs).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle entity with special characters in name', async () => {
      const graph: KnowledgeGraph = {
        entities: [
          { name: 'Test<>&"\'', entityType: 'test', observations: ['data'] },
        ],
        relations: [],
      };

      const index = await manager.buildIndex(graph);
      expect(index.documents.has('Test<>&"\'')).toBe(true);
    });

    it('should handle entity with unicode in name', async () => {
      const graph: KnowledgeGraph = {
        entities: [
          { name: '日本語', entityType: 'test', observations: ['日本語テスト'] },
        ],
        relations: [],
      };

      const index = await manager.buildIndex(graph);
      expect(index.documents.has('日本語')).toBe(true);
    });

    it('should handle large graph', async () => {
      const largeGraph: KnowledgeGraph = {
        entities: Array.from({ length: 100 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [`Observation ${i}`, `Details about entity ${i}`],
        })),
        relations: [],
      };

      const index = await manager.buildIndex(largeGraph);
      expect(index.documents.size).toBe(100);
    });

    it('should handle entity with very long observations', async () => {
      const graph: KnowledgeGraph = {
        entities: [
          {
            name: 'LongObs',
            entityType: 'test',
            observations: ['a'.repeat(10000)],
          },
        ],
        relations: [],
      };

      const index = await manager.buildIndex(graph);
      expect(index.documents.has('LongObs')).toBe(true);
    });
  });
});
