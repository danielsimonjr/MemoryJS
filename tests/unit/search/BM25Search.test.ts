/**
 * BM25Search Unit Tests
 *
 * Phase 12 Sprint 3: Search Algorithm Optimization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BM25Search, STOPWORDS, DEFAULT_BM25_CONFIG } from '../../../src/search/BM25Search.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('BM25Search', () => {
  let storage: GraphStorage;
  let bm25: BM25Search;
  let entityManager: EntityManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `bm25-search-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    bm25 = new BM25Search(storage);
    entityManager = new EntityManager(storage);

    // Create test data
    await entityManager.createEntities([
      {
        name: 'Machine_Learning_Doc',
        entityType: 'document',
        observations: ['Machine learning is a subset of artificial intelligence', 'Neural networks are used in deep learning'],
      },
      {
        name: 'Programming_Guide',
        entityType: 'document',
        observations: ['Python programming language is popular', 'Machine learning libraries like TensorFlow'],
      },
      {
        name: 'AI_Research',
        entityType: 'research',
        observations: ['Artificial intelligence research paper', 'Deep learning neural network architecture'],
      },
      {
        name: 'Short_Doc',
        entityType: 'document',
        observations: ['Brief note'],
      },
      {
        name: 'Long_Doc',
        entityType: 'document',
        observations: [
          'This is a very long document with many words',
          'It contains extensive information about various topics',
          'The document covers multiple subjects in detail',
          'Length normalization should affect its score',
        ],
      },
    ]);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Configuration', () => {
    it('should use default BM25 config values', () => {
      const config = bm25.getConfig();
      expect(config.k1).toBe(DEFAULT_BM25_CONFIG.k1);
      expect(config.b).toBe(DEFAULT_BM25_CONFIG.b);
    });

    it('should allow custom config in constructor', () => {
      const customBm25 = new BM25Search(storage, { k1: 1.5, b: 0.5 });
      const config = customBm25.getConfig();
      expect(config.k1).toBe(1.5);
      expect(config.b).toBe(0.5);
    });

    it('should update config with setConfig', () => {
      bm25.setConfig({ k1: 2.0 });
      const config = bm25.getConfig();
      expect(config.k1).toBe(2.0);
      expect(config.b).toBe(DEFAULT_BM25_CONFIG.b);
    });
  });

  describe('Tokenization', () => {
    it('should tokenize text to lowercase', () => {
      const tokens = bm25.tokenize('Hello World');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });

    it('should remove punctuation', () => {
      const tokens = bm25.tokenize('Hello, World! How are you?');
      expect(tokens).not.toContain(',');
      expect(tokens).not.toContain('!');
      expect(tokens).not.toContain('?');
    });

    it('should filter stopwords by default', () => {
      const tokens = bm25.tokenize('The quick brown fox');
      expect(tokens).not.toContain('the');
      expect(tokens).toContain('quick');
      expect(tokens).toContain('brown');
      expect(tokens).toContain('fox');
    });

    it('should keep stopwords when filterStopwords is false', () => {
      const tokens = bm25.tokenize('The quick brown fox', false);
      expect(tokens).toContain('the');
      expect(tokens).toContain('quick');
    });

    it('should handle empty strings', () => {
      const tokens = bm25.tokenize('');
      expect(tokens).toEqual([]);
    });
  });

  describe('Index Building', () => {
    it('should build index from graph', async () => {
      await bm25.buildIndex();
      expect(bm25.isIndexed()).toBe(true);
    });

    it('should report index statistics', async () => {
      await bm25.buildIndex();
      const stats = bm25.getIndexStats();

      expect(stats).not.toBeNull();
      expect(stats!.documents).toBe(5);
      expect(stats!.terms).toBeGreaterThan(0);
      expect(stats!.avgDocLength).toBeGreaterThan(0);
    });

    it('should clear index', async () => {
      await bm25.buildIndex();
      expect(bm25.isIndexed()).toBe(true);

      bm25.clearIndex();
      expect(bm25.isIndexed()).toBe(false);
      expect(bm25.getIndexStats()).toBeNull();
    });
  });

  describe('Search', () => {
    it('should find documents containing search term', async () => {
      const results = await bm25.search('machine learning');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.entity.name === 'Machine_Learning_Doc')).toBe(true);
    });

    it('should rank results by BM25 score', async () => {
      const results = await bm25.search('learning');

      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should return empty for queries with only stopwords', async () => {
      const results = await bm25.search('the a an');
      expect(results).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const results = await bm25.search('document', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should include matched fields in results', async () => {
      const results = await bm25.search('machine');
      const mlDoc = results.find(r => r.entity.name === 'Machine_Learning_Doc');

      expect(mlDoc).toBeDefined();
      expect(mlDoc!.matchedFields.name).toBe(true);
    });

    it('should auto-build index if not built', async () => {
      expect(bm25.isIndexed()).toBe(false);
      const results = await bm25.search('machine');
      expect(bm25.isIndexed()).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Incremental Updates', () => {
    it('should update index for changed entities', async () => {
      await bm25.buildIndex();

      // Add new entity
      await entityManager.createEntities([{
        name: 'New_Entity',
        entityType: 'test',
        observations: ['Unique quantum computing term'],
      }]);

      // Update index
      await bm25.update(new Set(['New_Entity']));

      const results = await bm25.search('quantum');
      expect(results.some(r => r.entity.name === 'New_Entity')).toBe(true);
    });

    it('should remove entity from index', async () => {
      await bm25.buildIndex();
      const statsBefore = bm25.getIndexStats();

      const removed = bm25.remove('Machine_Learning_Doc');
      expect(removed).toBe(true);

      const statsAfter = bm25.getIndexStats();
      expect(statsAfter!.documents).toBe(statsBefore!.documents - 1);
    });

    it('should return false when removing non-existent entity', async () => {
      await bm25.buildIndex();
      const removed = bm25.remove('Non_Existent');
      expect(removed).toBe(false);
    });
  });

  describe('Stopwords', () => {
    it('should have common stopwords in set', () => {
      expect(STOPWORDS.has('the')).toBe(true);
      expect(STOPWORDS.has('and')).toBe(true);
      expect(STOPWORDS.has('is')).toBe(true);
      expect(STOPWORDS.has('of')).toBe(true);
    });

    it('should not have content words in stopwords', () => {
      expect(STOPWORDS.has('machine')).toBe(false);
      expect(STOPWORDS.has('learning')).toBe(false);
      expect(STOPWORDS.has('python')).toBe(false);
    });
  });

  describe('Empty Graph', () => {
    it('should handle empty graph gracefully', async () => {
      const emptyDir = join(tmpdir(), `bm25-empty-${Date.now()}`);
      await fs.mkdir(emptyDir, { recursive: true });
      const emptyPath = join(emptyDir, 'empty.jsonl');

      const emptyStorage = new GraphStorage(emptyPath);
      const emptyBm25 = new BM25Search(emptyStorage);

      const results = await emptyBm25.search('anything');
      expect(results).toEqual([]);

      await fs.rm(emptyDir, { recursive: true, force: true });
    });
  });
});
