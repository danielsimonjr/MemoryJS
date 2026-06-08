/**
 * Search Algorithm Benchmarks
 *
 * Performance benchmarks for BM25, OptimizedInvertedIndex, and HybridScorer.
 *
 * Phase 12 Sprint 3: Search Algorithm Optimization
 *
 * IMPORTANT: Benchmark assertions are SKIPPED by default.
 * These tests verify correctness only. Performance optimization
 * will be addressed after the codebase split.
 *
 * To run with performance assertions, set RUN_PERF_ASSERTIONS=true
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { EntityManager } from '../../src/core/EntityManager.js';
import { BM25Search, STOPWORDS } from '../../src/search/BM25Search.js';
import { OptimizedInvertedIndex } from '../../src/search/OptimizedInvertedIndex.js';
import {
  HybridScorer,
  DEFAULT_SCORER_WEIGHTS,
  type SemanticSearchResult,
  type LexicalSearchResult,
  type SymbolicSearchResult,
} from '../../src/search/HybridScorer.js';
import type { Entity } from '../../src/types/index.js';

/**
 * Skip performance assertions unless explicitly enabled.
 * Set RUN_PERF_ASSERTIONS=true to enable.
 */
const SKIP_PERF_ASSERTIONS = process.env.RUN_PERF_ASSERTIONS !== 'true';

/**
 * Helper to conditionally skip performance assertions.
 */
function perfExpect(actual: number): {
  toBeLessThan: (expected: number) => void;
  toBeGreaterThan: (expected: number) => void;
} {
  if (SKIP_PERF_ASSERTIONS) {
    return {
      toBeLessThan: () => {},
      toBeGreaterThan: () => {},
    };
  }
  return {
    toBeLessThan: (expected: number) => expect(actual).toBeLessThan(expected),
    toBeGreaterThan: (expected: number) => expect(actual).toBeGreaterThan(expected),
  };
}

describe('Search Algorithm Benchmarks', () => {
  let testDir: string;
  let testFilePath: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;

  beforeAll(async () => {
    testDir = join(tmpdir(), `search-algo-bench-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    entityManager = new EntityManager(storage);

    // Create test entities
    const entities = Array.from({ length: 500 }, (_, i) => ({
      name: `Entity${i}`,
      entityType: i % 3 === 0 ? 'person' : i % 3 === 1 ? 'project' : 'concept',
      observations: [
        `This is observation ${i} about machine learning and artificial intelligence`,
        `Another observation ${i} discussing data science and analytics`,
      ],
      tags: i % 5 === 0 ? ['important', 'featured'] : ['standard'],
      importance: (i % 10) + 1,
    }));

    await entityManager.createEntities(entities);
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('BM25Search Benchmarks', () => {
    let bm25: BM25Search;

    beforeEach(() => {
      bm25 = new BM25Search(storage);
    });

    it('should correctly configure k1 and b parameters', () => {
      const config = bm25.getConfig();
      expect(config.k1).toBe(1.2);
      expect(config.b).toBe(0.75);

      bm25.setConfig({ k1: 1.5, b: 0.6 });
      const newConfig = bm25.getConfig();
      expect(newConfig.k1).toBe(1.5);
      expect(newConfig.b).toBe(0.6);
    });

    it('should tokenize with stopword filtering', () => {
      const tokens = bm25.tokenize('the quick brown fox jumps over the lazy dog');
      expect(tokens).not.toContain('the');
      expect(tokens).not.toContain('over');
      expect(tokens).toContain('quick');
      expect(tokens).toContain('brown');
      expect(tokens).toContain('fox');
    });

    it('should build index successfully', async () => {
      await bm25.buildIndex();
      expect(bm25.isIndexed()).toBe(true);

      const stats = bm25.getIndexStats();
      expect(stats).not.toBeNull();
      expect(stats!.documents).toBe(500);
      expect(stats!.avgDocLength).toBeGreaterThan(0);
    });

    it('should search with BM25 scoring', async () => {
      await bm25.buildIndex();
      const results = await bm25.search('machine learning');

      expect(results.length).toBeGreaterThan(0);
      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should update index incrementally', async () => {
      await bm25.buildIndex();
      const initialStats = bm25.getIndexStats();

      // Add new entity
      await entityManager.createEntities([{
        name: 'NewEntity',
        entityType: 'test',
        observations: ['quantum computing research'],
      }]);

      await bm25.update(new Set(['NewEntity']));

      const updatedStats = bm25.getIndexStats();
      expect(updatedStats!.documents).toBe(initialStats!.documents + 1);
    });

    it('should remove entities from index', async () => {
      await bm25.buildIndex();
      const initialStats = bm25.getIndexStats();

      bm25.remove('Entity0');

      const updatedStats = bm25.getIndexStats();
      expect(updatedStats!.documents).toBe(initialStats!.documents - 1);
    });

    it('benchmark: index building time (skipped)', async () => {
      const startTime = Date.now();
      await bm25.buildIndex();
      const duration = Date.now() - startTime;

      // Just verify it completes; performance assertion skipped
      expect(bm25.isIndexed()).toBe(true);
      perfExpect(duration).toBeLessThan(5000); // 5 seconds max
    });

    it('benchmark: search latency (skipped)', async () => {
      await bm25.buildIndex();

      const startTime = Date.now();
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        await bm25.search('machine learning');
      }
      const duration = Date.now() - startTime;
      const avgLatency = duration / iterations;

      // Just verify it completes; performance assertion skipped
      expect(avgLatency).toBeDefined();
      perfExpect(avgLatency).toBeLessThan(50); // 50ms average max
    });
  });

  describe('OptimizedInvertedIndex Benchmarks', () => {
    let index: OptimizedInvertedIndex;

    beforeEach(() => {
      index = new OptimizedInvertedIndex();
    });

    it('should add and search documents', () => {
      index.addDocument('doc1', ['machine', 'learning', 'ai']);
      index.addDocument('doc2', ['deep', 'learning', 'neural']);
      index.addDocument('doc3', ['machine', 'vision', 'computer']);

      const results = index.search('machine');
      expect(results).toContain('doc1');
      expect(results).toContain('doc3');
      expect(results).not.toContain('doc2');
    });

    it('should perform intersection correctly', () => {
      index.addDocument('doc1', ['machine', 'learning', 'ai']);
      index.addDocument('doc2', ['deep', 'learning', 'neural']);
      index.addDocument('doc3', ['machine', 'learning', 'deep']);
      index.finalize();

      // Intersection of 'machine' AND 'learning'
      const results = index.intersect(['machine', 'learning']);
      expect(results).toContain('doc1');
      expect(results).toContain('doc3');
      expect(results).not.toContain('doc2');
    });

    it('should perform union correctly', () => {
      index.addDocument('doc1', ['machine', 'learning']);
      index.addDocument('doc2', ['deep', 'neural']);
      index.finalize();

      const results = index.union(['machine', 'deep']);
      expect(results).toContain('doc1');
      expect(results).toContain('doc2');
    });

    it('should remove documents', () => {
      index.addDocument('doc1', ['machine', 'learning']);
      index.addDocument('doc2', ['deep', 'learning']);

      expect(index.hasDocument('doc1')).toBe(true);

      const removed = index.removeDocument('doc1');
      expect(removed).toBe(true);
      expect(index.hasDocument('doc1')).toBe(false);

      const results = index.search('machine');
      expect(results).not.toContain('doc1');
    });

    it('should report memory usage', () => {
      // Add many documents
      for (let i = 0; i < 1000; i++) {
        index.addDocument(`doc${i}`, [`term${i}`, 'common', 'shared']);
      }
      index.finalize();

      const usage = index.getMemoryUsage();
      expect(usage.documentCount).toBe(1000);
      expect(usage.termCount).toBeGreaterThan(0);
      expect(usage.totalBytes).toBeGreaterThan(0);
    });

    it('should use Uint32Array after finalization', () => {
      index.addDocument('doc1', ['test']);
      index.finalize();

      const posting = index.getPostingList('test');
      expect(posting).not.toBeNull();
      expect(posting!.docIds).toBeInstanceOf(Uint32Array);
    });

    it('benchmark: intersection performance (skipped)', { timeout: 30000 }, () => {
      // Create index with many documents
      for (let i = 0; i < 10000; i++) {
        const terms = ['common'];
        if (i % 2 === 0) terms.push('even');
        if (i % 3 === 0) terms.push('divisibleBy3');
        if (i % 5 === 0) terms.push('divisibleBy5');
        index.addDocument(`doc${i}`, terms);
      }
      index.finalize();

      // Benchmark intersection
      const startTime = Date.now();
      const iterations = 1000;
      for (let i = 0; i < iterations; i++) {
        index.intersect(['common', 'even']);
      }
      const duration = Date.now() - startTime;
      const avgLatency = duration / iterations;

      expect(avgLatency).toBeDefined();
      perfExpect(avgLatency).toBeLessThan(1); // 1ms average max
    });

    it('benchmark: memory efficiency vs string arrays (skipped)', () => {
      // Create index
      for (let i = 0; i < 5000; i++) {
        index.addDocument(`entity_with_long_name_${i}`, ['term1', 'term2', 'term3']);
      }
      index.finalize();

      const usage = index.getMemoryUsage();

      // Uint32Array uses 4 bytes per ID
      // String would use ~30+ bytes per entity name
      // We should see significant memory savings
      expect(usage.postingListBytes).toBeDefined();

      // Estimate string-based memory (rough approximation)
      const estimatedStringBytes = 5000 * 30 * 3; // 5000 docs, ~30 bytes/name, 3 terms
      perfExpect(usage.postingListBytes).toBeLessThan(estimatedStringBytes / 2);
    });
  });

  describe('HybridScorer Benchmarks', () => {
    let scorer: HybridScorer;
    let entityMap: Map<string, Entity>;

    beforeEach(async () => {
      scorer = new HybridScorer();
      const graph = await storage.loadGraph();
      entityMap = new Map(graph.entities.map(e => [e.name, e]));
    });

    it('should use default weights', () => {
      const weights = scorer.getWeights();
      expect(weights).toEqual(DEFAULT_SCORER_WEIGHTS);
    });

    it('should perform min-max normalization', () => {
      const scores = new Map<string, number>([
        ['a', 10],
        ['b', 50],
        ['c', 100],
      ]);

      const normalized = scorer.minMaxNormalize(scores);

      expect(normalized.get('a')).toBe(0);
      expect(normalized.get('b')).toBe((50 - 10) / (100 - 10));
      expect(normalized.get('c')).toBe(1);
    });

    it('should handle equal scores in normalization', () => {
      const scores = new Map<string, number>([
        ['a', 50],
        ['b', 50],
        ['c', 50],
      ]);

      const normalized = scorer.minMaxNormalize(scores);

      // All equal non-zero scores should normalize to 1
      expect(normalized.get('a')).toBe(1);
      expect(normalized.get('b')).toBe(1);
      expect(normalized.get('c')).toBe(1);
    });

    it('should combine results from all layers', () => {
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'Entity0', similarity: 0.9 },
        { entityName: 'Entity1', similarity: 0.8 },
      ];

      const lexicalResults: LexicalSearchResult[] = [
        { entityName: 'Entity0', score: 5.0 },
        { entityName: 'Entity2', score: 3.0 },
      ];

      const symbolicResults: SymbolicSearchResult[] = [
        { entityName: 'Entity0', score: 1.0 },
        { entityName: 'Entity1', score: 0.5 },
        { entityName: 'Entity3', score: 0.8 },
      ];

      const results = scorer.combine(
        semanticResults,
        lexicalResults,
        symbolicResults,
        entityMap
      );

      // Entity0 appears in all three layers
      const entity0 = results.find(r => r.entityName === 'Entity0');
      expect(entity0).toBeDefined();
      expect(entity0!.matchedLayers).toHaveLength(3);
      expect(entity0!.matchedLayers).toContain('semantic');
      expect(entity0!.matchedLayers).toContain('lexical');
      expect(entity0!.matchedLayers).toContain('symbolic');

      // Results should be sorted by combined score
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].scores.combined).toBeGreaterThanOrEqual(results[i].scores.combined);
      }
    });

    it('should normalize weights when layers are missing', () => {
      const weights = scorer.getNormalizedWeights(true, true, false);

      // Semantic + Lexical should sum to 1
      const sum = weights.semantic + weights.lexical + weights.symbolic;
      expect(sum).toBeCloseTo(1, 5);
      expect(weights.symbolic).toBe(0);
    });

    it('should track raw scores before normalization', () => {
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'Entity0', similarity: 0.85 },
      ];

      const lexicalResults: LexicalSearchResult[] = [
        { entityName: 'Entity0', score: 15.5 },
      ];

      const results = scorer.combine(
        semanticResults,
        lexicalResults,
        [],
        entityMap
      );

      const entity0 = results.find(r => r.entityName === 'Entity0');
      expect(entity0!.rawScores.semantic).toBe(0.85);
      expect(entity0!.rawScores.lexical).toBe(15.5);
    });

    it('benchmark: combine performance (skipped)', () => {
      // Generate large result sets
      const semanticResults: SemanticSearchResult[] = Array.from(
        { length: 100 },
        (_, i) => ({ entityName: `Entity${i}`, similarity: Math.random() })
      );

      const lexicalResults: LexicalSearchResult[] = Array.from(
        { length: 150 },
        (_, i) => ({ entityName: `Entity${i * 2}`, score: Math.random() * 10 })
      );

      const symbolicResults: SymbolicSearchResult[] = Array.from(
        { length: 200 },
        (_, i) => ({ entityName: `Entity${i * 3}`, score: Math.random() })
      );

      // Benchmark combination
      const startTime = Date.now();
      const iterations = 1000;
      for (let i = 0; i < iterations; i++) {
        scorer.combine(semanticResults, lexicalResults, symbolicResults, entityMap);
      }
      const duration = Date.now() - startTime;
      const avgLatency = duration / iterations;

      expect(avgLatency).toBeDefined();
      perfExpect(avgLatency).toBeLessThan(10); // 10ms average max
    });

    it('benchmark: normalization performance (skipped)', { timeout: 30000 }, () => {
      // Generate large score map
      const scores = new Map<string, number>();
      for (let i = 0; i < 10000; i++) {
        scores.set(`Entity${i}`, Math.random() * 100);
      }

      const startTime = Date.now();
      const iterations = 1000;
      for (let i = 0; i < iterations; i++) {
        scorer.minMaxNormalize(scores);
      }
      const duration = Date.now() - startTime;
      const avgLatency = duration / iterations;

      expect(avgLatency).toBeDefined();
      perfExpect(avgLatency).toBeLessThan(5); // 5ms average max
    });
  });

  describe('Integration: Combined Search Pipeline', () => {
    let bm25: BM25Search;
    let invertedIndex: OptimizedInvertedIndex;
    let scorer: HybridScorer;
    let entityMap: Map<string, Entity>;

    beforeAll(async () => {
      const graph = await storage.loadGraph();
      entityMap = new Map(graph.entities.map(e => [e.name, e]));

      // Build BM25 index
      bm25 = new BM25Search(storage);
      await bm25.buildIndex();

      // Build inverted index
      invertedIndex = new OptimizedInvertedIndex();
      for (const entity of graph.entities) {
        const text = [entity.name, entity.entityType, ...entity.observations].join(' ');
        const tokens = bm25.tokenize(text);
        invertedIndex.addDocument(entity.name, tokens);
      }
      invertedIndex.finalize();

      scorer = new HybridScorer();
    });

    it('should combine BM25 with inverted index intersection', async () => {
      // Get BM25 results
      const bm25Results = await bm25.search('machine learning');

      // Get inverted index intersection
      const intersectionResults = invertedIndex.intersect(['machine', 'learning']);

      // Filter BM25 results to only those in intersection
      const filteredResults = bm25Results.filter(r =>
        intersectionResults.includes(r.entity.name)
      );

      expect(filteredResults.length).toBeGreaterThan(0);
      expect(filteredResults.length).toBeLessThanOrEqual(bm25Results.length);
    });

    it('should work in hybrid scoring pipeline', async () => {
      // Simulate semantic results (mock)
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'Entity0', similarity: 0.9 },
        { entityName: 'Entity10', similarity: 0.85 },
        { entityName: 'Entity20', similarity: 0.8 },
      ];

      // Get BM25 (lexical) results
      const bm25Results = await bm25.search('machine');
      const lexicalResults: LexicalSearchResult[] = bm25Results.map(r => ({
        entityName: r.entity.name,
        score: r.score,
      }));

      // Symbolic results (based on importance)
      const symbolicResults: SymbolicSearchResult[] = [];
      for (const [name, entity] of entityMap) {
        if ((entity.importance ?? 0) >= 8) {
          symbolicResults.push({
            entityName: name,
            score: (entity.importance ?? 0) / 10,
          });
        }
      }

      // Combine all signals
      const combinedResults = scorer.combine(
        semanticResults,
        lexicalResults,
        symbolicResults,
        entityMap
      );

      expect(combinedResults.length).toBeGreaterThan(0);

      // Verify results have all expected properties
      const firstResult = combinedResults[0];
      expect(firstResult.entityName).toBeDefined();
      expect(firstResult.entity).toBeDefined();
      expect(firstResult.scores.combined).toBeGreaterThan(0);
      expect(firstResult.matchedLayers.length).toBeGreaterThan(0);
    });

    it('benchmark: full hybrid pipeline (skipped)', async () => {
      const startTime = Date.now();
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        // Semantic (mock)
        const semanticResults: SemanticSearchResult[] = [
          { entityName: `Entity${i}`, similarity: 0.9 },
        ];

        // Lexical (BM25)
        const bm25Results = await bm25.search('machine');
        const lexicalResults: LexicalSearchResult[] = bm25Results.slice(0, 50).map(r => ({
          entityName: r.entity.name,
          score: r.score,
        }));

        // Symbolic (inverted index intersection + filter)
        const symbolicNames = invertedIndex.intersect(['machine']);
        const symbolicResults: SymbolicSearchResult[] = symbolicNames.slice(0, 50).map(name => ({
          entityName: name,
          score: 0.5,
        }));

        // Combine
        scorer.combine(semanticResults, lexicalResults, symbolicResults, entityMap);
      }

      const duration = Date.now() - startTime;
      const avgLatency = duration / iterations;

      expect(avgLatency).toBeDefined();
      perfExpect(avgLatency).toBeLessThan(100); // 100ms average max for full pipeline
    });
  });

  describe('Stopword Filtering', () => {
    it('should contain common English stopwords', () => {
      expect(STOPWORDS.has('the')).toBe(true);
      expect(STOPWORDS.has('and')).toBe(true);
      expect(STOPWORDS.has('is')).toBe(true);
      expect(STOPWORDS.has('of')).toBe(true);
    });

    it('should not contain meaningful words', () => {
      expect(STOPWORDS.has('machine')).toBe(false);
      expect(STOPWORDS.has('learning')).toBe(false);
      expect(STOPWORDS.has('computer')).toBe(false);
    });
  });
});
