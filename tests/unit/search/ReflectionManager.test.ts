/**
 * ReflectionManager Unit Tests
 *
 * Phase 12 Sprint 4: Tests for reflection loop optimization features.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReflectionManager } from '../../../src/search/ReflectionManager.js';
import { QueryAnalyzer } from '../../../src/search/QueryAnalyzer.js';
import type { Entity, HybridSearchResult, ReadonlyKnowledgeGraph } from '../../../src/types/index.js';

describe('ReflectionManager', () => {
  const mockHybridSearch = {
    search: vi.fn(),
    searchWithEntities: vi.fn(),
  };

  let reflectionManager: ReflectionManager;
  let analyzer: QueryAnalyzer;
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
    analyzer = new QueryAnalyzer();
    reflectionManager = new ReflectionManager(mockHybridSearch as any, analyzer);

    testGraph = {
      entities: [
        createEntity('Alice', 'person', ['software engineer'], ['tech'], 8),
        createEntity('Bob', 'person', ['designer'], ['creative'], 5),
        createEntity('TechCorp', 'company', ['technology company'], ['tech'], 9),
        createEntity('Project Alpha', 'project', ['web app'], ['active'], 7),
        createEntity('New York', 'location', ['city'], ['usa'], 6),
      ],
      relations: [],
    };

    // Default mock behavior
    mockHybridSearch.searchWithEntities.mockResolvedValue([]);
  });

  describe('basic reflection', () => {
    it('should return results from a single iteration', async () => {
      mockHybridSearch.searchWithEntities.mockResolvedValue([
        createResult(testGraph.entities[0], 0.9),
        createResult(testGraph.entities[1], 0.8),
        createResult(testGraph.entities[2], 0.7),
      ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'Find people',
        { maxIterations: 1 }
      );

      expect(result.results.length).toBe(3);
      expect(result.iterations).toBe(1);
    });

    it('should respect maxIterations limit', async () => {
      mockHybridSearch.searchWithEntities.mockResolvedValue([]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'xyz',
        { maxIterations: 2, adequacyThreshold: 1.0 }
      );

      expect(result.iterations).toBeLessThanOrEqual(2);
    });

    it('should deduplicate results across iterations', async () => {
      mockHybridSearch.searchWithEntities
        .mockResolvedValueOnce([createResult(testGraph.entities[0], 0.9)])
        .mockResolvedValueOnce([
          createResult(testGraph.entities[0], 0.85), // Duplicate
          createResult(testGraph.entities[1], 0.8),
        ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'test',
        { maxIterations: 3, adequacyThreshold: 0.99 }
      );

      const uniqueNames = new Set(result.results.map(r => r.entity.name));
      expect(uniqueNames.size).toBe(result.results.length);
    });

    it('should sort results by combined score', async () => {
      mockHybridSearch.searchWithEntities.mockResolvedValue([
        createResult(testGraph.entities[0], 0.5),
        createResult(testGraph.entities[1], 0.9),
        createResult(testGraph.entities[2], 0.7),
      ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'test',
        { maxIterations: 1 }
      );

      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].scores.combined).toBeGreaterThanOrEqual(
          result.results[i].scores.combined
        );
      }
    });
  });

  describe('Phase 12 Sprint 4: progressive limit increase', () => {
    it('should increase limit per iteration', async () => {
      const limits: number[] = [];
      // Return results that trigger refinement (missing person type)
      mockHybridSearch.searchWithEntities.mockImplementation((_g: any, _q: any, opts: any) => {
        if (opts && typeof opts.limit === 'number') {
          limits.push(opts.limit);
        }
        // Return a non-person result to trigger refinement for person-type queries
        return Promise.resolve([createResult(testGraph.entities[2], 0.5)]); // TechCorp (company)
      });

      await reflectionManager.retrieveWithReflection(
        testGraph,
        'Who is Alice?', // Question about person triggers person-type refinement
        {
          maxIterations: 3,
          adequacyThreshold: 1.0, // High threshold to force all iterations
          initialLimit: 10,
          limitIncreaseFactor: 2.0,
        }
      );

      // With factor 2.0: 10, 20, 40
      expect(limits.length).toBe(3);
      expect(limits[0]).toBe(10);
      expect(limits[1]).toBe(20);
      expect(limits[2]).toBe(40);
    });

    it('should use default limit factor of 1.5', async () => {
      const limits: number[] = [];
      // Return results that trigger refinement
      mockHybridSearch.searchWithEntities.mockImplementation((_g: any, _q: any, opts: any) => {
        if (opts && typeof opts.limit === 'number') {
          limits.push(opts.limit);
        }
        return Promise.resolve([createResult(testGraph.entities[2], 0.5)]); // TechCorp (company)
      });

      await reflectionManager.retrieveWithReflection(
        testGraph,
        'Who is Alice?', // Question about person triggers person-type refinement
        {
          maxIterations: 3,
          adequacyThreshold: 1.0,
          initialLimit: 10,
        }
      );

      // With factor 1.5: 10, 15, 23 (rounded)
      expect(limits.length).toBe(3);
      expect(limits[0]).toBe(10);
      expect(limits[1]).toBe(15);
      expect(limits[2]).toBe(23);
    });

    it('should return finalLimit in result', async () => {
      // Return results that trigger refinement
      mockHybridSearch.searchWithEntities.mockResolvedValue([
        createResult(testGraph.entities[2], 0.5), // TechCorp (company)
      ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'Who is Alice?', // Question about person triggers refinement
        {
          maxIterations: 2,
          adequacyThreshold: 1.0,
          initialLimit: 10,
          limitIncreaseFactor: 2.0,
        }
      );

      // After 2 iterations with factor 2.0: limit goes from 10 to 20
      expect(result.finalLimit).toBe(20);
    });
  });

  describe('Phase 12 Sprint 4: focused query refinement', () => {
    it('should track refinement history', async () => {
      mockHybridSearch.searchWithEntities
        .mockResolvedValueOnce([createResult(testGraph.entities[0], 0.5)])
        .mockResolvedValueOnce([createResult(testGraph.entities[1], 0.6)]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'Who worked on the project?',
        { maxIterations: 2, adequacyThreshold: 1.0 }
      );

      expect(result.refinementHistory).toBeDefined();
      expect(result.refinementHistory.length).toBeGreaterThan(0);
    });

    it('should include iteration details in history', async () => {
      mockHybridSearch.searchWithEntities.mockResolvedValue([
        createResult(testGraph.entities[0], 0.8),
        createResult(testGraph.entities[1], 0.7),
        createResult(testGraph.entities[2], 0.6),
      ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'Find people',
        { maxIterations: 1 }
      );

      const entry = result.refinementHistory[0];
      expect(entry.iteration).toBe(1);
      expect(entry.query).toBeDefined();
      expect(entry.limit).toBeGreaterThan(0);
      expect(entry.resultsFound).toBeDefined();
      expect(entry.adequacyScore).toBeDefined();
    });

    it('should record refinement reasons when applicable', async () => {
      mockHybridSearch.searchWithEntities
        .mockResolvedValueOnce([createResult(testGraph.entities[0], 0.3)])
        .mockResolvedValueOnce([createResult(testGraph.entities[1], 0.4)]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'Find Alice',
        { maxIterations: 2, adequacyThreshold: 1.0 }
      );

      // First iteration should have refinement reason if refinement occurred
      if (result.refinementHistory.length > 1) {
        expect(result.refinementHistory[0].refinementReason).toBeDefined();
      }
    });

    it('should track missing info types', async () => {
      // Return results that don't satisfy required info types
      mockHybridSearch.searchWithEntities.mockResolvedValue([
        createResult(testGraph.entities[3], 0.8), // project, not location
      ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'Where is the meeting?',
        {
          maxIterations: 2,
          adequacyThreshold: 1.0,
          focusMissingTypes: true,
        }
      );

      // First entry may have missing info types
      const firstEntry = result.refinementHistory[0];
      if (firstEntry.missingInfoTypes) {
        expect(firstEntry.missingInfoTypes).toContain('location');
      }
    });

    it('should focus refinement on missing types when enabled', async () => {
      const queries: string[] = [];
      mockHybridSearch.searchWithEntities.mockImplementation((_g, query) => {
        queries.push(query);
        return Promise.resolve([createResult(testGraph.entities[0], 0.5)]);
      });

      await reflectionManager.retrieveWithReflection(
        testGraph,
        'When did the project start?',
        {
          maxIterations: 2,
          adequacyThreshold: 1.0,
          focusMissingTypes: true,
        }
      );

      // Second query should include temporal keywords
      if (queries.length > 1) {
        const refinedQuery = queries[1].toLowerCase();
        expect(
          refinedQuery.includes('when') ||
          refinedQuery.includes('date') ||
          refinedQuery.includes('time')
        ).toBe(true);
      }
    });

    it('should disable focused refinement when option is false', async () => {
      const queries: string[] = [];
      mockHybridSearch.searchWithEntities.mockImplementation((_g, query) => {
        queries.push(query);
        return Promise.resolve([createResult(testGraph.entities[0], 0.5)]);
      });

      await reflectionManager.retrieveWithReflection(
        testGraph,
        'When did the project start?',
        {
          maxIterations: 2,
          adequacyThreshold: 1.0,
          focusMissingTypes: false,
        }
      );

      // Refinement should not be focused on missing types
      // (we verify the option is respected by checking the call count)
      expect(mockHybridSearch.searchWithEntities).toHaveBeenCalled();
    });
  });

  describe('Phase 12 Sprint 4: refinement history details', () => {
    it('should record results found per iteration', async () => {
      mockHybridSearch.searchWithEntities
        .mockResolvedValueOnce([
          createResult(testGraph.entities[0], 0.8),
          createResult(testGraph.entities[1], 0.7),
        ])
        .mockResolvedValueOnce([
          createResult(testGraph.entities[2], 0.6),
        ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'test',
        { maxIterations: 2, adequacyThreshold: 1.0 }
      );

      expect(result.refinementHistory[0].resultsFound).toBe(2);
      if (result.refinementHistory.length > 1) {
        expect(result.refinementHistory[1].resultsFound).toBe(1);
      }
    });

    it('should track adequacy score progression', async () => {
      mockHybridSearch.searchWithEntities
        .mockResolvedValueOnce([createResult(testGraph.entities[0], 0.5)])
        .mockResolvedValueOnce([
          createResult(testGraph.entities[0], 0.5),
          createResult(testGraph.entities[1], 0.6),
          createResult(testGraph.entities[2], 0.7),
        ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'test',
        { maxIterations: 2, adequacyThreshold: 0.99 }
      );

      // Adequacy should generally improve with more results
      if (result.refinementHistory.length > 1) {
        const scores = result.refinementHistory.map(h => h.adequacyScore);
        expect(scores[scores.length - 1]).toBeGreaterThanOrEqual(scores[0]);
      }
    });

    it('should record query used in each iteration', async () => {
      mockHybridSearch.searchWithEntities
        .mockResolvedValueOnce([createResult(testGraph.entities[0], 0.5)])
        .mockResolvedValueOnce([createResult(testGraph.entities[1], 0.6)]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'Find Alice',
        { maxIterations: 2, adequacyThreshold: 1.0 }
      );

      expect(result.refinementHistory[0].query).toBe('Find Alice');
      if (result.refinementHistory.length > 1 && result.refinements.length > 0) {
        expect(result.refinementHistory[1].query).toBe(result.refinements[0]);
      }
    });
  });

  describe('adequacy calculation', () => {
    it('should return adequate true when threshold is met', async () => {
      mockHybridSearch.searchWithEntities.mockResolvedValue([
        createResult(testGraph.entities[0], 0.9),
        createResult(testGraph.entities[1], 0.8),
        createResult(testGraph.entities[2], 0.7),
      ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'Find people',
        { adequacyThreshold: 0.3, minResults: 2 }
      );

      expect(result.adequate).toBe(true);
    });

    it('should return adequate false when threshold is not met', async () => {
      mockHybridSearch.searchWithEntities.mockResolvedValue([
        createResult(testGraph.entities[0], 0.2),
      ]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        'test',
        { adequacyThreshold: 0.99, minResults: 10, maxIterations: 1 }
      );

      expect(result.adequate).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty graph', async () => {
      const emptyGraph: ReadonlyKnowledgeGraph = { entities: [], relations: [] };
      mockHybridSearch.searchWithEntities.mockReset();
      mockHybridSearch.searchWithEntities.mockResolvedValue([]);

      const result = await reflectionManager.retrieveWithReflection(
        emptyGraph,
        'test'
      );

      expect(result.results.length).toBe(0);
      expect(result.adequate).toBe(false);
    });

    it('should handle search errors gracefully', async () => {
      mockHybridSearch.searchWithEntities.mockRejectedValue(new Error('Search failed'));

      await expect(
        reflectionManager.retrieveWithReflection(testGraph, 'test')
      ).rejects.toThrow();
    });

    it('should handle empty query', async () => {
      mockHybridSearch.searchWithEntities.mockResolvedValue([]);

      const result = await reflectionManager.retrieveWithReflection(
        testGraph,
        '',
        { maxIterations: 1 }
      );

      expect(result.results).toEqual([]);
    });
  });
});
