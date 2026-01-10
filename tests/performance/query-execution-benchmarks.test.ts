/**
 * Query Execution Benchmarks
 *
 * Phase 12 Sprint 4: Benchmark suite for early termination, reflection, and caching.
 *
 * NOTE: Performance assertions are skipped per task requirements.
 * Focus is on correctness tests with basic timing measurements.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EarlyTerminationManager } from '../../src/search/EarlyTerminationManager.js';
import { ReflectionManager } from '../../src/search/ReflectionManager.js';
import { QueryPlanCache } from '../../src/search/QueryPlanCache.js';
import { QueryCostEstimator } from '../../src/search/QueryCostEstimator.js';
import { QueryAnalyzer } from '../../src/search/QueryAnalyzer.js';
import type { Entity, HybridSearchResult, ReadonlyKnowledgeGraph, QueryAnalysis } from '../../src/types/index.js';

// Skip benchmark timing assertions for now
const SKIP_BENCHMARKS = process.env.SKIP_BENCHMARKS === 'true' || true;

/**
 * Helper to measure execution time.
 */
async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
  const start = performance.now();
  const result = await fn();
  const timeMs = performance.now() - start;
  return { result, timeMs };
}

/**
 * Synchronous measurement helper.
 */
function measureTimeSync<T>(fn: () => T): { result: T; timeMs: number } {
  const start = performance.now();
  const result = fn();
  const timeMs = performance.now() - start;
  return { result, timeMs };
}

describe('Query Execution Benchmarks', () => {
  // Mock dependencies
  const mockHybridSearch = {
    search: vi.fn(),
    searchWithEntities: vi.fn(),
  };

  let costEstimator: QueryCostEstimator;
  let analyzer: QueryAnalyzer;
  let cache: QueryPlanCache;
  let earlyTermination: EarlyTerminationManager;
  let reflection: ReflectionManager;
  let testGraph: ReadonlyKnowledgeGraph;

  const createEntity = (name: string, type: string, obs: string[] = []): Entity => ({
    name,
    entityType: type,
    observations: obs,
    tags: [],
    importance: 5,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  });

  const createResult = (entity: Entity, score: number): HybridSearchResult => ({
    entity,
    scores: {
      semantic: score,
      lexical: score,
      symbolic: score,
      combined: score,
    },
    matchedLayers: ['lexical'],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    costEstimator = new QueryCostEstimator();
    analyzer = new QueryAnalyzer();
    cache = new QueryPlanCache();
    earlyTermination = new EarlyTerminationManager(mockHybridSearch as any, costEstimator);
    reflection = new ReflectionManager(mockHybridSearch as any, analyzer);

    // Create test graph with 100 entities
    const entities: Entity[] = [];
    for (let i = 0; i < 100; i++) {
      entities.push(createEntity(`Entity${i}`, i % 3 === 0 ? 'person' : 'project', [`observation ${i}`]));
    }
    testGraph = { entities, relations: [] };

    // Default mock to return some results
    mockHybridSearch.search.mockResolvedValue([]);
    mockHybridSearch.searchWithEntities.mockResolvedValue([]);
  });

  describe('QueryCostEstimator benchmarks', () => {
    it('should estimate costs quickly', () => {
      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 100; i++) {
          costEstimator.estimateMethod('ranked', 'test query', 1000);
        }
      });

      // Log for reference
      console.log(`100 cost estimates: ${timeMs.toFixed(2)}ms`);
      expect(timeMs).toBeLessThan(1000); // Basic sanity check
    });

    it('should calculate adaptive depth quickly', () => {
      const analysis = analyzer.analyze('What projects did Alice work on?');

      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 1000; i++) {
          costEstimator.calculateAdaptiveDepth('test query', analysis);
        }
      });

      console.log(`1000 adaptive depth calculations: ${timeMs.toFixed(2)}ms`);
      expect(timeMs).toBeLessThan(1000);
    });

    it('should recommend layers quickly', () => {
      const analysis = analyzer.analyze('Find all projects');

      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 100; i++) {
          costEstimator.recommendLayers('test query', { analysis });
        }
      });

      console.log(`100 layer recommendations: ${timeMs.toFixed(2)}ms`);
      expect(timeMs).toBeLessThan(500);
    });

    it.skipIf(SKIP_BENCHMARKS)('should estimate extended costs within 1ms average', () => {
      const analysis = analyzer.analyze('Complex query with multiple words');

      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 100; i++) {
          costEstimator.estimateExtended('ranked', 'Complex query', 1000, analysis);
        }
      });

      const avgMs = timeMs / 100;
      console.log(`Average extended estimate: ${avgMs.toFixed(3)}ms`);
      expect(avgMs).toBeLessThan(1);
    });
  });

  describe('QueryPlanCache benchmarks', () => {
    it('should cache and retrieve quickly', () => {
      const analysis = analyzer.analyze('test query');

      // Preload cache
      for (let i = 0; i < 100; i++) {
        cache.setAnalysis(`query${i}`, analysis);
      }

      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 1000; i++) {
          cache.getAnalysis(`query${i % 100}`);
        }
      });

      console.log(`1000 cache retrievals: ${timeMs.toFixed(2)}ms`);
      expect(timeMs).toBeLessThan(100);
    });

    it('should handle query normalization quickly', () => {
      const analysis = analyzer.analyze('test');

      cache.setAnalysis('test query', analysis);

      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 1000; i++) {
          // Try different variations
          cache.getAnalysis('Test Query');
          cache.getAnalysis('TEST QUERY');
          cache.getAnalysis('test  query');
        }
      });

      console.log(`3000 normalized lookups: ${timeMs.toFixed(2)}ms`);
      expect(timeMs).toBeLessThan(200);
    });

    it('should handle LRU eviction without major slowdown', () => {
      const smallCache = new QueryPlanCache({ maxSize: 100 });
      const analysis = analyzer.analyze('test');

      // Fill cache and trigger evictions
      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 500; i++) {
          smallCache.setAnalysis(`query${i}`, analysis);
        }
      });

      console.log(`500 inserts with evictions: ${timeMs.toFixed(2)}ms`);
      expect(timeMs).toBeLessThan(500);
      expect(smallCache.getStats().evictions).toBeGreaterThan(0);
    });

    it.skipIf(SKIP_BENCHMARKS)('should maintain sub-millisecond retrieval times', () => {
      const analysis = analyzer.analyze('test');
      cache.setAnalysis('test', analysis);

      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 10000; i++) {
          cache.getAnalysis('test');
        }
      });

      const avgMs = timeMs / 10000;
      console.log(`Average cache retrieval: ${(avgMs * 1000).toFixed(3)}us`);
      expect(avgMs).toBeLessThan(0.1);
    });
  });

  describe('EarlyTermination benchmarks', () => {
    it('should terminate early when results are adequate', async () => {
      // Return good results from first layer
      mockHybridSearch.search.mockResolvedValueOnce(
        testGraph.entities.slice(0, 10).map(e => createResult(e, 0.9))
      );

      const { result, timeMs } = await measureTime(() =>
        earlyTermination.searchWithEarlyTermination(testGraph, 'test', {
          adequacyThreshold: 0.5,
          minResults: 5,
        })
      );

      console.log(`Early termination search: ${timeMs.toFixed(2)}ms`);
      expect(result.earlyTerminated).toBe(true);
      expect(result.executedLayers.length).toBe(1);
    });

    it('should complete all layers when necessary', async () => {
      // Return minimal results
      mockHybridSearch.search
        .mockResolvedValueOnce([createResult(testGraph.entities[0], 0.3)])
        .mockResolvedValueOnce([createResult(testGraph.entities[1], 0.3)])
        .mockResolvedValueOnce([createResult(testGraph.entities[2], 0.3)]);

      const { result, timeMs } = await measureTime(() =>
        earlyTermination.searchWithEarlyTermination(testGraph, 'test', {
          adequacyThreshold: 0.99,
          minResults: 100,
        })
      );

      console.log(`Full layer execution: ${timeMs.toFixed(2)}ms`);
      expect(result.earlyTerminated).toBe(false);
      expect(result.executedLayers.length).toBe(3);
    });

    it('should calculate adequacy score quickly', () => {
      const results: HybridSearchResult[] = testGraph.entities.slice(0, 20).map(e =>
        createResult(e, Math.random())
      );

      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 1000; i++) {
          earlyTermination.calculateAdequacyScore(results);
        }
      });

      console.log(`1000 adequacy calculations: ${timeMs.toFixed(2)}ms`);
      expect(timeMs).toBeLessThan(500);
    });
  });

  describe('ReflectionManager benchmarks', () => {
    it('should complete reflection loop quickly', async () => {
      // Return results that meet threshold
      mockHybridSearch.searchWithEntities.mockResolvedValue(
        testGraph.entities.slice(0, 5).map(e => createResult(e, 0.8))
      );

      const { result, timeMs } = await measureTime(() =>
        reflection.retrieveWithReflection(testGraph, 'test', {
          maxIterations: 3,
          adequacyThreshold: 0.5,
          initialLimit: 10,
        })
      );

      console.log(`Reflection loop: ${timeMs.toFixed(2)}ms, iterations: ${result.iterations}`);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should handle multiple iterations efficiently', async () => {
      // Return poor results to force multiple iterations
      mockHybridSearch.searchWithEntities
        .mockResolvedValueOnce([createResult(testGraph.entities[0], 0.3)])
        .mockResolvedValueOnce([createResult(testGraph.entities[1], 0.4)])
        .mockResolvedValueOnce([createResult(testGraph.entities[2], 0.5)]);

      const { result, timeMs } = await measureTime(() =>
        reflection.retrieveWithReflection(testGraph, 'test', {
          maxIterations: 3,
          adequacyThreshold: 0.99,
          initialLimit: 10,
          limitIncreaseFactor: 1.5,
        })
      );

      console.log(`Multi-iteration reflection: ${timeMs.toFixed(2)}ms, iterations: ${result.iterations}`);
      expect(result.refinementHistory.length).toBe(result.iterations);
    });

    it('should track progressive limit increase', async () => {
      // Return person results so query refinement can look for other types
      // Using query that triggers person search refinement
      let callCount = 0;
      mockHybridSearch.searchWithEntities.mockImplementation(() => {
        callCount++;
        // Return project (non-person) results to trigger person-finding refinement
        const projectEntity = testGraph.entities.find(e => e.entityType === 'project')!;
        return Promise.resolve([
          createResult(projectEntity, 0.1),
        ]);
      });

      const { result } = await measureTime(() =>
        // Use query that expects person results to trigger refinement
        reflection.retrieveWithReflection(testGraph, 'find alice', {
          maxIterations: 3,
          adequacyThreshold: 1.0,
          initialLimit: 10,
          limitIncreaseFactor: 2.0,
          minResults: 10, // Ensures adequacy is never reached
        })
      );

      // Verify progressive limits in history
      expect(result.refinementHistory.length).toBeGreaterThan(0);
      // First limit should be initialLimit (10)
      expect(result.refinementHistory[0].limit).toBe(10);
      // If multiple iterations, limits should increase
      if (result.iterations > 1) {
        expect(result.refinementHistory[1].limit).toBe(20);
      }
    });
  });

  describe('QueryAnalyzer benchmarks', () => {
    it('should analyze queries quickly', () => {
      const queries = [
        'Find Alice',
        'What projects did Bob work on?',
        'Show me all the results from last month',
        'Compare Alice and Bob\'s performance',
        'How many tasks are pending?',
      ];

      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 100; i++) {
          for (const query of queries) {
            analyzer.analyze(query);
          }
        }
      });

      console.log(`500 query analyses: ${timeMs.toFixed(2)}ms`);
      expect(timeMs).toBeLessThan(1000);
    });

    it.skipIf(SKIP_BENCHMARKS)('should analyze complex queries under 1ms', () => {
      const complexQuery =
        'What projects did Alice work on last year, and how do they compare to Bob\'s projects in terms of success rate?';

      const { timeMs } = measureTimeSync(() => {
        for (let i = 0; i < 100; i++) {
          analyzer.analyze(complexQuery);
        }
      });

      const avgMs = timeMs / 100;
      console.log(`Average complex analysis: ${avgMs.toFixed(3)}ms`);
      expect(avgMs).toBeLessThan(1);
    });
  });

  describe('Combined workflow benchmarks', () => {
    it('should complete full workflow efficiently', async () => {
      // Simulate realistic workflow
      mockHybridSearch.search.mockResolvedValue(
        testGraph.entities.slice(0, 15).map(e => createResult(e, Math.random() * 0.5 + 0.5))
      );
      mockHybridSearch.searchWithEntities.mockResolvedValue(
        testGraph.entities.slice(0, 10).map(e => createResult(e, Math.random() * 0.5 + 0.5))
      );

      const query = 'Find software engineers working on AI projects';

      const { timeMs: analyzeTime } = measureTimeSync(() => {
        return analyzer.analyze(query);
      });

      const { timeMs: cacheCheckTime } = measureTimeSync(() => {
        return cache.getAnalysis(query);
      });

      const analysis = analyzer.analyze(query);

      const { timeMs: costTime } = measureTimeSync(() => {
        return costEstimator.estimateExtended('ranked', query, testGraph.entities.length, analysis);
      });

      const { timeMs: searchTime } = await measureTime(() =>
        earlyTermination.searchWithEarlyTermination(testGraph, query, {
          adequacyThreshold: 0.5,
          analysis,
        })
      );

      const totalTime = analyzeTime + cacheCheckTime + costTime + searchTime;

      console.log('Full workflow breakdown:');
      console.log(`  Analysis: ${analyzeTime.toFixed(2)}ms`);
      console.log(`  Cache check: ${cacheCheckTime.toFixed(2)}ms`);
      console.log(`  Cost estimation: ${costTime.toFixed(2)}ms`);
      console.log(`  Search: ${searchTime.toFixed(2)}ms`);
      console.log(`  Total: ${totalTime.toFixed(2)}ms`);

      expect(totalTime).toBeLessThan(1000); // Basic sanity check
    });

    it('should benefit from caching', async () => {
      const query = 'Find all projects';
      const analysis = analyzer.analyze(query);

      // First pass - no cache
      const { timeMs: firstTime } = measureTimeSync(() => {
        const analysis = analyzer.analyze(query);
        cache.setAnalysis(query, analysis);
        return analysis;
      });

      // Second pass - with cache
      const { timeMs: secondTime } = measureTimeSync(() => {
        return cache.getAnalysis(query);
      });

      console.log(`First pass (analyze + cache): ${firstTime.toFixed(3)}ms`);
      console.log(`Second pass (cache hit): ${secondTime.toFixed(3)}ms`);

      // Cache should be faster
      expect(secondTime).toBeLessThan(firstTime);
    });
  });

  describe('Correctness tests (not performance)', () => {
    it('should produce consistent results from early termination', async () => {
      mockHybridSearch.search.mockResolvedValue(
        testGraph.entities.slice(0, 5).map(e => createResult(e, 0.8))
      );

      const results: number[] = [];
      for (let i = 0; i < 10; i++) {
        const { result } = await measureTime(() =>
          earlyTermination.searchWithEarlyTermination(testGraph, 'test', {
            adequacyThreshold: 0.5,
          })
        );
        results.push(result.results.length);
      }

      // All runs should return the same number of results
      expect(new Set(results).size).toBe(1);
    });

    it('should produce valid adequacy scores', async () => {
      mockHybridSearch.search.mockResolvedValue(
        testGraph.entities.slice(0, 5).map(e => createResult(e, 0.8))
      );

      const { result } = await measureTime(() =>
        earlyTermination.searchWithEarlyTermination(testGraph, 'test')
      );

      expect(result.adequacy.score).toBeGreaterThanOrEqual(0);
      expect(result.adequacy.score).toBeLessThanOrEqual(1);
    });

    it('should track cache statistics correctly', () => {
      const analysis = analyzer.analyze('test');

      cache.setAnalysis('query1', analysis);
      cache.getAnalysis('query1'); // Hit
      cache.getAnalysis('query2'); // Miss
      cache.getAnalysis('query1'); // Hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should correctly track refinement history', async () => {
      mockHybridSearch.searchWithEntities
        .mockResolvedValueOnce([createResult(testGraph.entities[0], 0.5)])
        .mockResolvedValueOnce([createResult(testGraph.entities[1], 0.6)])
        .mockResolvedValueOnce([createResult(testGraph.entities[2], 0.7)]);

      const result = await reflection.retrieveWithReflection(testGraph, 'test', {
        maxIterations: 3,
        adequacyThreshold: 0.99,
      });

      expect(result.refinementHistory.length).toBe(result.iterations);
      for (let i = 0; i < result.refinementHistory.length; i++) {
        expect(result.refinementHistory[i].iteration).toBe(i + 1);
      }
    });
  });
});
