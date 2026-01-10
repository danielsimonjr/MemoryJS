/**
 * ParallelSearchExecutor Unit Tests
 *
 * Phase 12 Sprint 2: Tests for parallel search layer execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ParallelSearchExecutor,
  type LayerTiming,
  type ParallelSearchResult,
} from '../../../src/search/ParallelSearchExecutor.js';
import type { Entity, ReadonlyKnowledgeGraph } from '../../../src/types/index.js';

describe('ParallelSearchExecutor', () => {
  const mockSemanticSearch = {
    search: vi.fn(),
  };
  const mockRankedSearch = {
    searchNodesRanked: vi.fn(),
  };

  let executor: ParallelSearchExecutor;
  let testGraph: ReadonlyKnowledgeGraph;

  const createEntity = (
    name: string,
    type: string,
    obs: string[] = [],
    tags: string[] = [],
    importance: number = 5
  ): Entity => ({
    name,
    entityType: type,
    observations: obs,
    tags,
    importance,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new ParallelSearchExecutor(
      mockSemanticSearch as any,
      mockRankedSearch as any
    );
    testGraph = {
      entities: [
        createEntity('Alice', 'person', ['software engineer'], ['tech'], 8),
        createEntity('Bob', 'person', ['designer'], ['creative'], 5),
        createEntity('TechCorp', 'company', ['technology company'], ['tech', 'enterprise'], 9),
      ],
      relations: [],
    };
    mockSemanticSearch.search.mockResolvedValue([]);
    mockRankedSearch.searchNodesRanked.mockResolvedValue([]);
  });

  describe('execute', () => {
    it('should execute all three search layers', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 0.9 },
      ]);
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const result = await executor.execute(testGraph, 'engineer', {
        symbolic: { tags: ['tech'] },
      });

      expect(mockSemanticSearch.search).toHaveBeenCalled();
      expect(mockRankedSearch.searchNodesRanked).toHaveBeenCalled();
      expect(result.semanticResults.size).toBeGreaterThan(0);
      expect(result.lexicalResults.size).toBeGreaterThan(0);
    });

    it('should return timing metadata for all layers', async () => {
      const result = await executor.execute(testGraph, 'test');

      expect(result.timings).toHaveLength(3);
      expect(result.timings.map(t => t.layer)).toContain('semantic');
      expect(result.timings.map(t => t.layer)).toContain('lexical');
      expect(result.timings.map(t => t.layer)).toContain('symbolic');
    });

    it('should include timing details for each layer', async () => {
      const result = await executor.execute(testGraph, 'test');

      for (const timing of result.timings) {
        expect(timing.startTime).toBeGreaterThan(0);
        expect(timing.endTime).toBeGreaterThanOrEqual(timing.startTime);
        expect(timing.durationMs).toBeGreaterThanOrEqual(0);
        expect(typeof timing.success).toBe('boolean');
        expect(typeof timing.resultCount).toBe('number');
      }
    });

    it('should track total execution time', async () => {
      const result = await executor.execute(testGraph, 'test');

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should report allSucceeded when all layers succeed', async () => {
      mockSemanticSearch.search.mockResolvedValue([]);
      mockRankedSearch.searchNodesRanked.mockResolvedValue([]);

      const result = await executor.execute(testGraph, 'test');

      expect(result.allSucceeded).toBe(true);
      expect(result.failedLayers).toHaveLength(0);
    });

    it('should handle semantic search failure gracefully', async () => {
      mockSemanticSearch.search.mockRejectedValue(new Error('Not indexed'));
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const result = await executor.execute(testGraph, 'test');

      expect(result.allSucceeded).toBe(false);
      expect(result.failedLayers).toContain('semantic');
      // Other layers should still succeed
      expect(result.lexicalResults.size).toBeGreaterThan(0);
    });

    it('should handle lexical search failure gracefully', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 0.8 },
      ]);
      mockRankedSearch.searchNodesRanked.mockRejectedValue(new Error('Failed'));

      const result = await executor.execute(testGraph, 'test');

      expect(result.allSucceeded).toBe(false);
      expect(result.failedLayers).toContain('lexical');
      // Other layers should still succeed
      expect(result.semanticResults.size).toBeGreaterThan(0);
    });

    it('should include error message in timing for failed layers', async () => {
      mockSemanticSearch.search.mockRejectedValue(new Error('Embedding service unavailable'));

      const result = await executor.execute(testGraph, 'test');

      const semanticTiming = result.timings.find(t => t.layer === 'semantic');
      expect(semanticTiming?.success).toBe(false);
      expect(semanticTiming?.error).toContain('Embedding service unavailable');
    });

    it('should normalize lexical scores to 0-1 range', async () => {
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 10 },
        { entity: testGraph.entities[1], score: 5 },
      ]);

      const result = await executor.execute(testGraph, 'test');

      const scores = Array.from(result.lexicalResults.values());
      expect(scores.every(s => s >= 0 && s <= 1)).toBe(true);
      expect(scores).toContain(1); // Max score should be normalized to 1
    });

    it('should give base score 0.5 when no symbolic filters', async () => {
      const result = await executor.execute(testGraph, 'test', {});

      // All entities should have symbolic score of 0.5
      for (const score of result.symbolicResults.values()) {
        expect(score).toBe(0.5);
      }
    });

    it('should apply symbolic filters when provided', async () => {
      const result = await executor.execute(testGraph, 'test', {
        symbolic: { tags: ['tech'] },
      });

      // Only Alice and TechCorp have 'tech' tag
      expect(result.symbolicResults.has('Alice')).toBe(true);
      expect(result.symbolicResults.has('TechCorp')).toBe(true);
      // Bob should not be in results (or have lower score)
      const bobScore = result.symbolicResults.get('Bob');
      const aliceScore = result.symbolicResults.get('Alice');
      if (bobScore !== undefined && aliceScore !== undefined) {
        expect(aliceScore).toBeGreaterThan(bobScore);
      }
    });
  });

  describe('executeLayer', () => {
    it('should execute only semantic layer', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 0.9 },
      ]);

      const result = await executor.executeLayer('semantic', testGraph, 'test');

      expect(result.timing.layer).toBe('semantic');
      expect(result.results.size).toBeGreaterThan(0);
      expect(mockRankedSearch.searchNodesRanked).not.toHaveBeenCalled();
    });

    it('should execute only lexical layer', async () => {
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const result = await executor.executeLayer('lexical', testGraph, 'test');

      expect(result.timing.layer).toBe('lexical');
      expect(result.results.size).toBeGreaterThan(0);
      expect(mockSemanticSearch.search).not.toHaveBeenCalled();
    });

    it('should execute only symbolic layer', async () => {
      const result = await executor.executeLayer('symbolic', testGraph, 'test', {
        symbolic: { entityTypes: ['person'] },
      });

      expect(result.timing.layer).toBe('symbolic');
      expect(result.results.size).toBeGreaterThan(0);
      expect(mockSemanticSearch.search).not.toHaveBeenCalled();
      expect(mockRankedSearch.searchNodesRanked).not.toHaveBeenCalled();
    });
  });

  describe('executeSelectedLayers', () => {
    it('should execute only selected layers', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 0.8 },
      ]);

      const result = await executor.executeSelectedLayers(
        ['semantic', 'symbolic'],
        testGraph,
        'test'
      );

      expect(result.timings).toHaveLength(2);
      expect(result.results.has('semantic')).toBe(true);
      expect(result.results.has('symbolic')).toBe(true);
      expect(result.results.has('lexical')).toBe(false);
      expect(mockRankedSearch.searchNodesRanked).not.toHaveBeenCalled();
    });

    it('should track total time for selected layers', async () => {
      const result = await executor.executeSelectedLayers(
        ['lexical', 'symbolic'],
        testGraph,
        'test'
      );

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('null semantic search', () => {
    it('should handle null semantic search gracefully', async () => {
      const executorNoSemantic = new ParallelSearchExecutor(
        null,
        mockRankedSearch as any
      );

      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const result = await executorNoSemantic.execute(testGraph, 'test');

      expect(result.semanticResults.size).toBe(0);
      expect(result.allSucceeded).toBe(true); // Not an error, just not configured
      expect(result.lexicalResults.size).toBeGreaterThan(0);
    });

    it('should report semantic layer success even when not configured', async () => {
      const executorNoSemantic = new ParallelSearchExecutor(
        null,
        mockRankedSearch as any
      );

      const result = await executorNoSemantic.execute(testGraph, 'test');

      const semanticTiming = result.timings.find(t => t.layer === 'semantic');
      expect(semanticTiming?.success).toBe(true);
      expect(semanticTiming?.resultCount).toBe(0);
    });
  });

  describe('formatTimingSummary', () => {
    it('should format timing summary correctly', () => {
      const timings: LayerTiming[] = [
        {
          layer: 'semantic',
          startTime: 1000,
          endTime: 1100,
          durationMs: 100,
          success: true,
          resultCount: 10,
        },
        {
          layer: 'lexical',
          startTime: 1000,
          endTime: 1050,
          durationMs: 50,
          success: true,
          resultCount: 20,
        },
        {
          layer: 'symbolic',
          startTime: 1000,
          endTime: 1010,
          durationMs: 10,
          success: true,
          resultCount: 5,
        },
      ];

      const summary = ParallelSearchExecutor.formatTimingSummary(timings);

      expect(summary).toContain('Search Layer Timings:');
      expect(summary).toContain('semantic: 100ms');
      expect(summary).toContain('lexical: 50ms');
      expect(summary).toContain('symbolic: 10ms');
      expect(summary).toContain('Total (sequential): 160ms');
      expect(summary).toContain('Max (parallel bottleneck): 100ms');
    });

    it('should include error messages for failed layers', () => {
      const timings: LayerTiming[] = [
        {
          layer: 'semantic',
          startTime: 1000,
          endTime: 1100,
          durationMs: 100,
          success: false,
          error: 'Connection refused',
          resultCount: 0,
        },
      ];

      const summary = ParallelSearchExecutor.formatTimingSummary(timings);

      expect(summary).toContain('FAILED: Connection refused');
    });
  });

  describe('calculateSpeedup', () => {
    it('should calculate speedup correctly', () => {
      const timings: LayerTiming[] = [
        {
          layer: 'semantic',
          startTime: 0,
          endTime: 100,
          durationMs: 100,
          success: true,
          resultCount: 0,
        },
        {
          layer: 'lexical',
          startTime: 0,
          endTime: 50,
          durationMs: 50,
          success: true,
          resultCount: 0,
        },
        {
          layer: 'symbolic',
          startTime: 0,
          endTime: 10,
          durationMs: 10,
          success: true,
          resultCount: 0,
        },
      ];

      const speedup = ParallelSearchExecutor.calculateSpeedup(timings);

      expect(speedup.sequentialTime).toBe(160);
      expect(speedup.parallelTime).toBe(100);
      expect(speedup.speedup).toBe(1.6);
    });

    it('should handle single layer', () => {
      const timings: LayerTiming[] = [
        {
          layer: 'semantic',
          startTime: 0,
          endTime: 100,
          durationMs: 100,
          success: true,
          resultCount: 0,
        },
      ];

      const speedup = ParallelSearchExecutor.calculateSpeedup(timings);

      expect(speedup.sequentialTime).toBe(100);
      expect(speedup.parallelTime).toBe(100);
      expect(speedup.speedup).toBe(1);
    });
  });

  describe('timeout handling', () => {
    it('should respect timeout option', async () => {
      // Create a slow semantic search
      mockSemanticSearch.search.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([]), 5000))
      );

      // This should timeout
      const result = await executor.execute(testGraph, 'test', {
        timeoutMs: 50,
      });

      // Semantic should have timed out
      const semanticTiming = result.timings.find(t => t.layer === 'semantic');
      expect(semanticTiming?.success).toBe(false);
      expect(semanticTiming?.error).toContain('timeout');
    }, 10000);
  });

  describe('options passing', () => {
    it('should pass semantic options to semantic search', async () => {
      mockSemanticSearch.search.mockResolvedValue([]);

      await executor.execute(testGraph, 'test', {
        semantic: { minSimilarity: 0.8, topK: 5 },
        limit: 10,
      });

      expect(mockSemanticSearch.search).toHaveBeenCalledWith(
        testGraph,
        'test',
        5, // topK takes precedence
        0.8 // minSimilarity
      );
    });

    it('should pass limit to lexical search', async () => {
      mockRankedSearch.searchNodesRanked.mockResolvedValue([]);

      await executor.execute(testGraph, 'test', {
        limit: 25,
      });

      expect(mockRankedSearch.searchNodesRanked).toHaveBeenCalledWith(
        'test',
        undefined,
        undefined,
        undefined,
        50 // limit * 2
      );
    });
  });
});
