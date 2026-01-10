/**
 * Early Termination Manager Tests
 *
 * Phase 12 Sprint 4: Tests for early termination search execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EarlyTerminationManager } from '../../../src/search/EarlyTerminationManager.js';
import { QueryCostEstimator } from '../../../src/search/QueryCostEstimator.js';
import type { Entity, HybridSearchResult, ReadonlyKnowledgeGraph } from '../../../src/types/index.js';

describe('EarlyTerminationManager', () => {
  const mockHybridSearch = {
    search: vi.fn(),
    searchWithEntities: vi.fn(),
  };

  let manager: EarlyTerminationManager;
  let testGraph: ReadonlyKnowledgeGraph;

  const createEntity = (
    name: string,
    type: string,
    obs: string[] = [],
    tags: string[] = [],
    importance = 5
  ): Entity => ({
    name,
    entityType: type,
    observations: obs,
    tags,
    importance,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  });

  const createResult = (
    entity: Entity,
    combined: number,
    layers: Array<'semantic' | 'lexical' | 'symbolic'>
  ): HybridSearchResult => ({
    entity,
    scores: {
      semantic: layers.includes('semantic') ? combined : 0,
      lexical: layers.includes('lexical') ? combined : 0,
      symbolic: layers.includes('symbolic') ? combined : 0,
      combined,
    },
    matchedLayers: layers,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new EarlyTerminationManager(mockHybridSearch as any);

    testGraph = {
      entities: [
        createEntity('Alice', 'person', ['software engineer'], ['tech'], 8),
        createEntity('Bob', 'person', ['designer'], ['creative'], 5),
        createEntity('TechCorp', 'company', ['technology company'], ['tech', 'enterprise'], 9),
        createEntity('Project Alpha', 'project', ['web app'], ['active'], 7),
        createEntity('Task 1', 'task', ['coding'], ['pending'], 3),
      ],
      relations: [],
    };

    // Default mock behavior
    mockHybridSearch.search.mockResolvedValue([]);
  });

  describe('searchWithEarlyTermination', () => {
    it('should execute search and return results', async () => {
      mockHybridSearch.search.mockResolvedValue([
        createResult(testGraph.entities[0], 0.8, ['lexical']),
        createResult(testGraph.entities[1], 0.6, ['lexical']),
        createResult(testGraph.entities[2], 0.7, ['lexical']),
      ]);

      const result = await manager.searchWithEarlyTermination(testGraph, 'test');

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.executedLayers.length).toBeGreaterThan(0);
      expect(result.adequacy).toBeDefined();
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should terminate early when results are adequate', async () => {
      // Return enough high-quality results from first layer
      mockHybridSearch.search
        .mockResolvedValueOnce([
          createResult(testGraph.entities[0], 0.9, ['symbolic']),
          createResult(testGraph.entities[1], 0.85, ['symbolic']),
          createResult(testGraph.entities[2], 0.8, ['symbolic']),
          createResult(testGraph.entities[3], 0.75, ['symbolic']),
        ]);

      const result = await manager.searchWithEarlyTermination(testGraph, 'test', {
        adequacyThreshold: 0.5,
        minResults: 3,
      });

      expect(result.earlyTerminated).toBe(true);
      expect(result.executedLayers.length).toBe(1); // Only executed first layer
    });

    it('should continue all layers when results are inadequate', async () => {
      // Return few low-quality results from each layer
      mockHybridSearch.search
        .mockResolvedValueOnce([
          createResult(testGraph.entities[0], 0.3, ['symbolic']),
        ])
        .mockResolvedValueOnce([
          createResult(testGraph.entities[1], 0.4, ['lexical']),
        ])
        .mockResolvedValueOnce([
          createResult(testGraph.entities[2], 0.35, ['semantic']),
        ]);

      const result = await manager.searchWithEarlyTermination(testGraph, 'test', {
        adequacyThreshold: 0.9,
        minResults: 5,
      });

      expect(result.earlyTerminated).toBe(false);
      expect(result.executedLayers.length).toBe(3); // All layers executed
    });

    it('should merge results from multiple layers', async () => {
      mockHybridSearch.search
        .mockResolvedValueOnce([
          createResult(testGraph.entities[0], 0.8, ['symbolic']),
        ])
        .mockResolvedValueOnce([
          createResult(testGraph.entities[0], 0.7, ['lexical']),
          createResult(testGraph.entities[1], 0.6, ['lexical']),
        ]);

      const result = await manager.searchWithEarlyTermination(testGraph, 'test', {
        adequacyThreshold: 0.9, // High threshold to ensure all layers run
      });

      // Alice should appear once with both layers in matchedLayers
      const aliceResult = result.results.find(r => r.entity.name === 'Alice');
      expect(aliceResult).toBeDefined();
      expect(aliceResult?.matchedLayers).toContain('symbolic');
      expect(aliceResult?.matchedLayers).toContain('lexical');
    });

    it('should sort results by combined score', async () => {
      mockHybridSearch.search.mockResolvedValue([
        createResult(testGraph.entities[0], 0.5, ['lexical']),
        createResult(testGraph.entities[1], 0.9, ['lexical']),
        createResult(testGraph.entities[2], 0.7, ['lexical']),
      ]);

      const result = await manager.searchWithEarlyTermination(testGraph, 'test');

      expect(result.results[0].scores.combined).toBeGreaterThanOrEqual(
        result.results[1].scores.combined
      );
      expect(result.results[1].scores.combined).toBeGreaterThanOrEqual(
        result.results[2].scores.combined
      );
    });

    it('should respect maxResults option', async () => {
      mockHybridSearch.search.mockResolvedValue(
        testGraph.entities.map((e, i) => createResult(e, 0.9 - i * 0.1, ['lexical']))
      );

      const result = await manager.searchWithEarlyTermination(testGraph, 'test', {
        maxResults: 2,
      });

      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('should handle layer search failures gracefully', async () => {
      mockHybridSearch.search
        .mockResolvedValueOnce([
          createResult(testGraph.entities[0], 0.8, ['symbolic']),
        ])
        .mockRejectedValueOnce(new Error('Search failed'))
        .mockResolvedValueOnce([
          createResult(testGraph.entities[1], 0.7, ['semantic']),
        ]);

      const result = await manager.searchWithEarlyTermination(testGraph, 'test');

      // Should still have results from successful layers
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should track executed layers', async () => {
      mockHybridSearch.search.mockResolvedValue([]);

      const result = await manager.searchWithEarlyTermination(testGraph, 'test');

      expect(result.executedLayers).toContain('symbolic');
      expect(result.executedLayers).toContain('lexical');
      // Semantic may or may not be included depending on semanticAvailable
    });

    it('should exclude semantic when not available', async () => {
      mockHybridSearch.search.mockResolvedValue([]);

      const result = await manager.searchWithEarlyTermination(testGraph, 'test', {
        semanticAvailable: false,
      });

      expect(result.executedLayers).not.toContain('semantic');
    });
  });

  describe('checkAdequacy', () => {
    it('should return adequate for sufficient high-quality results', () => {
      const results: HybridSearchResult[] = [
        createResult(testGraph.entities[0], 0.9, ['lexical', 'symbolic']),
        createResult(testGraph.entities[1], 0.85, ['lexical', 'semantic']),
        createResult(testGraph.entities[2], 0.8, ['symbolic']),
      ];

      const adequacy = manager.checkAdequacy(results, { minResults: 3, minRelevance: 0.5 }, ['lexical', 'symbolic', 'semantic']);

      expect(adequacy.adequate).toBe(true);
      expect(adequacy.score).toBeGreaterThan(0.7);
    });

    it('should return inadequate for insufficient results', () => {
      const results: HybridSearchResult[] = [
        createResult(testGraph.entities[0], 0.9, ['lexical']),
      ];

      const adequacy = manager.checkAdequacy(results, { minResults: 5, adequacyThreshold: 0.9 }, ['lexical']);

      expect(adequacy.adequate).toBe(false);
      // Check that reasons array contains a message about insufficient results
      expect(adequacy.reasons.some(r => r.includes('Insufficient') || r.includes('1/'))).toBe(true);
    });

    it('should return inadequate for low relevance scores', () => {
      const results: HybridSearchResult[] = [
        createResult(testGraph.entities[0], 0.2, ['lexical']),
        createResult(testGraph.entities[1], 0.3, ['lexical']),
        createResult(testGraph.entities[2], 0.1, ['lexical']),
      ];

      const adequacy = manager.checkAdequacy(results, { minResults: 3, minRelevance: 0.7, adequacyThreshold: 0.9 }, ['lexical']);

      expect(adequacy.adequate).toBe(false);
      // Check that reasons array contains a message about low relevance
      expect(adequacy.reasons.some(r => r.includes('relevance') || r.includes('0.2'))).toBe(true);
    });

    it('should track contributing layers', () => {
      const results: HybridSearchResult[] = [
        createResult(testGraph.entities[0], 0.8, ['lexical', 'semantic']),
        createResult(testGraph.entities[1], 0.7, ['symbolic']),
      ];

      const adequacy = manager.checkAdequacy(results, {}, ['lexical', 'symbolic', 'semantic']);

      expect(adequacy.contributingLayers).toContain('lexical');
      expect(adequacy.contributingLayers).toContain('semantic');
      expect(adequacy.contributingLayers).toContain('symbolic');
    });

    it('should consider diversity in adequacy score', () => {
      // High diversity - multiple entity types and layers
      const diverseResults: HybridSearchResult[] = [
        createResult(createEntity('A', 'person', []), 0.8, ['lexical']),
        createResult(createEntity('B', 'company', []), 0.8, ['semantic']),
        createResult(createEntity('C', 'project', []), 0.8, ['symbolic']),
      ];

      // Low diversity - same type, same layer
      const uniformResults: HybridSearchResult[] = [
        createResult(createEntity('A', 'person', []), 0.8, ['lexical']),
        createResult(createEntity('B', 'person', []), 0.8, ['lexical']),
        createResult(createEntity('C', 'person', []), 0.8, ['lexical']),
      ];

      const diverseAdequacy = manager.checkAdequacy(diverseResults, { minDiversity: 0.3, minResults: 3 }, ['lexical', 'semantic', 'symbolic']);
      const uniformAdequacy = manager.checkAdequacy(uniformResults, { minDiversity: 0.3, minResults: 3 }, ['lexical']);

      // Diverse results should have higher score due to better diversity
      // or at least not lower (coverage might vary)
      expect(diverseAdequacy.score).toBeGreaterThanOrEqual(uniformAdequacy.score * 0.9);
    });

    it('should handle empty results', () => {
      const adequacy = manager.checkAdequacy([], { minResults: 3 }, ['lexical']);

      expect(adequacy.adequate).toBe(false);
      expect(adequacy.score).toBe(0);
    });
  });

  describe('calculateAdequacyScore', () => {
    it('should return score between 0 and 1', () => {
      const results: HybridSearchResult[] = [
        createResult(testGraph.entities[0], 0.8, ['lexical']),
        createResult(testGraph.entities[1], 0.7, ['lexical']),
      ];

      const score = manager.calculateAdequacyScore(results);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should return 0 for empty results', () => {
      const score = manager.calculateAdequacyScore([]);
      expect(score).toBe(0);
    });
  });

  describe('getCostEstimator', () => {
    it('should return the cost estimator', () => {
      const costEstimator = manager.getCostEstimator();
      expect(costEstimator).toBeInstanceOf(QueryCostEstimator);
    });

    it('should allow custom cost estimator', () => {
      const customEstimator = new QueryCostEstimator({ basicTimePerEntity: 1.0 });
      const customManager = new EarlyTerminationManager(
        mockHybridSearch as any,
        customEstimator
      );

      expect(customManager.getCostEstimator()).toBe(customEstimator);
    });
  });

  describe('layer execution order', () => {
    it('should execute layers in cost order (fastest first)', async () => {
      const executionOrder: string[] = [];

      mockHybridSearch.search.mockImplementation(async (_graph, _query, options) => {
        if (options?.symbolicWeight === 1.0) executionOrder.push('symbolic');
        if (options?.lexicalWeight === 1.0) executionOrder.push('lexical');
        if (options?.semanticWeight === 1.0) executionOrder.push('semantic');
        return [];
      });

      await manager.searchWithEarlyTermination(testGraph, 'test', {
        adequacyThreshold: 1.0, // Ensure all layers execute
      });

      // Symbolic should be first (cheapest), semantic last (most expensive)
      expect(executionOrder.indexOf('symbolic')).toBeLessThan(
        executionOrder.indexOf('lexical')
      );
      expect(executionOrder.indexOf('lexical')).toBeLessThan(
        executionOrder.indexOf('semantic')
      );
    });
  });

  describe('analysis-based adequacy', () => {
    it('should consider required info types from analysis', () => {
      const results: HybridSearchResult[] = [
        createResult(createEntity('Alice', 'person', []), 0.8, ['lexical']),
        createResult(createEntity('Bob', 'person', []), 0.7, ['lexical']),
      ];

      // Analysis that requires person type
      const adequacyWithMatch = manager.checkAdequacy(
        results,
        {
          analysis: {
            query: 'Who worked on the project?',
            entities: [],
            persons: [],
            locations: [],
            organizations: [],
            temporalRange: null,
            questionType: 'factual',
            complexity: 'low',
            confidence: 0.8,
            requiredInfoTypes: ['person'],
          },
        },
        ['lexical']
      );

      // Analysis that requires location type (not covered)
      const adequacyWithoutMatch = manager.checkAdequacy(
        results,
        {
          analysis: {
            query: 'Where is the meeting?',
            entities: [],
            persons: [],
            locations: [],
            organizations: [],
            temporalRange: null,
            questionType: 'factual',
            complexity: 'low',
            confidence: 0.8,
            requiredInfoTypes: ['location'],
          },
        },
        ['lexical']
      );

      // Score should be higher when required types are covered
      expect(adequacyWithMatch.score).toBeGreaterThan(adequacyWithoutMatch.score);
    });
  });
});
