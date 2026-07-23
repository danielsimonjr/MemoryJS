/**
 * HybridSearchManager Graph Wiring Unit Tests
 *
 * GraphRankPrior integration: graph channel weighting and one-hop neighbor
 * expansion (both default-off).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HybridSearchManager } from '../../../src/search/HybridSearchManager.js';
import type { GraphRankPrior } from '../../../src/search/GraphRankPrior.js';
import type {
  Entity,
  HybridSearchResult,
  ReadonlyKnowledgeGraph,
} from '../../../src/types/index.js';

describe('HybridSearchManager graph integration', () => {
  const mockSemanticSearch = {
    search: vi.fn(),
  };
  const mockRankedSearch = {
    searchNodesRanked: vi.fn(),
  };

  let testGraph: ReadonlyKnowledgeGraph;

  const createEntity = (name: string): Entity => ({
    name,
    entityType: 'person',
    observations: [`Observation for ${name}`],
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  });

  /** Fake GraphRankPrior with configurable scores and neighbor lists. */
  const makeFakePrior = (
    scores: Record<string, number>,
    neighbors: Record<string, string[]> = {}
  ) => {
    const fake = {
      getScores: vi.fn(async (names: string[]) => {
        const map = new Map<string, number>();
        for (const name of names) {
          map.set(name, scores[name] ?? 0);
        }
        return map;
      }),
      neighbors: vi.fn((name: string) => neighbors[name] ?? []),
    };
    return { fake, prior: fake as unknown as GraphRankPrior };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    testGraph = {
      entities: ['Connected', 'Isolated', 'Neighbor1', 'Neighbor2'].map(createEntity),
      relations: [],
    };
    mockSemanticSearch.search.mockResolvedValue([]);
    mockRankedSearch.searchNodesRanked.mockResolvedValue([]);
  });

  describe('graph channel', () => {
    it('should not query the prior when graph weight is 0 (default)', async () => {
      const { fake, prior } = makeFakePrior({ Connected: 1 });
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never,
        prior
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const results = await manager.search(testGraph, 'test');

      expect(fake.getScores).not.toHaveBeenCalled();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchedLayers).not.toContain('graph');
    });

    it('should produce identical results to a prior-less manager when weight is 0', async () => {
      const { prior } = makeFakePrior({ Connected: 1, Isolated: 0 });
      const withPrior = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never,
        prior
      );
      const withoutPrior = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
        { entity: testGraph.entities[1], score: 3 },
      ]);

      const a = await withPrior.search(testGraph, 'test');
      const b = await withoutPrior.search(testGraph, 'test');

      expect(a).toEqual(b);
    });

    it('should rank a well-connected entity above an isolated one at equal text scores', async () => {
      const { fake, prior } = makeFakePrior({ Connected: 1, Isolated: 0 });
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never,
        prior
      );
      // Equal lexical scores for both entities
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
        { entity: testGraph.entities[1], score: 5 },
      ]);

      const results = await manager.search(testGraph, 'test', { graphWeight: 0.3 });

      expect(fake.getScores).toHaveBeenCalledTimes(1);
      expect(results[0].entity.name).toBe('Connected');
      expect(results[0].scores.combined).toBeGreaterThan(results[1].scores.combined);
      expect(results[0].matchedLayers).toContain('graph');
      expect(results[1].matchedLayers).not.toContain('graph');
    });

    it('should use the constructor default graphWeight when no per-call weight given', async () => {
      const { fake, prior } = makeFakePrior({ Connected: 1, Isolated: 0 });
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never,
        prior,
        { graphWeight: 0.5 }
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
        { entity: testGraph.entities[1], score: 5 },
      ]);

      const results = await manager.search(testGraph, 'test');

      expect(fake.getScores).toHaveBeenCalledTimes(1);
      expect(results[0].entity.name).toBe('Connected');
    });

    it("should type matchedLayers containing 'graph' as plain HybridSearchResult (no downcast)", async () => {
      const { prior } = makeFakePrior({ Connected: 1, Isolated: 0 });
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never,
        prior
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      // Compile-level proof: the canonical HybridSearchResult type (from
      // src/types) now admits 'graph' in matchedLayers — no
      // GraphHybridSearchResult assertion required on either side.
      const results: HybridSearchResult[] = await manager.search(testGraph, 'test', {
        graphWeight: 0.3,
      });
      const layers: HybridSearchResult['matchedLayers'] = results[0].matchedLayers;

      expect(layers).toContain('graph');
    });

    it('should ignore a positive graph weight when no prior is attached', async () => {
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const results = await manager.search(testGraph, 'test', { graphWeight: 0.5 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchedLayers).not.toContain('graph');
    });
  });

  describe('expandNeighbors', () => {
    it('should add one-hop neighbors with damped scores and matchedLayers [graph]', async () => {
      const { fake, prior } = makeFakePrior(
        {},
        { Connected: ['Neighbor1', 'Neighbor2'] }
      );
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never,
        prior
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const results = await manager.search(testGraph, 'test', {
        expandNeighbors: { hops: 1 },
      });

      expect(fake.neighbors).toHaveBeenCalledWith('Connected');
      const parent = results.find(r => r.entity.name === 'Connected')!;
      const neighbor1 = results.find(r => r.entity.name === 'Neighbor1')!;
      const neighbor2 = results.find(r => r.entity.name === 'Neighbor2')!;

      expect(neighbor1).toBeDefined();
      expect(neighbor2).toBeDefined();
      // Default damping 0.3
      expect(neighbor1.scores.combined).toBeCloseTo(0.3 * parent.scores.combined);
      expect(neighbor1.matchedLayers).toEqual(['graph']);
      expect(neighbor2.matchedLayers).toEqual(['graph']);
      // Parent still outranks its damped neighbors
      expect(results[0].entity.name).toBe('Connected');
    });

    it('should not duplicate results that are already present', async () => {
      const { prior } = makeFakePrior({}, { Connected: ['Isolated', 'Neighbor1'] });
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never,
        prior
      );
      // Isolated is already a scored result
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
        { entity: testGraph.entities[1], score: 3 },
      ]);

      const results = await manager.search(testGraph, 'test', {
        expandNeighbors: { hops: 1 },
      });

      const isolatedOccurrences = results.filter(r => r.entity.name === 'Isolated');
      expect(isolatedOccurrences).toHaveLength(1);
      // The existing result keeps its lexical provenance (not overwritten by graph)
      expect(isolatedOccurrences[0].matchedLayers).toContain('lexical');
    });

    it('should honor custom damping and skip neighbors missing from the graph', async () => {
      const { prior } = makeFakePrior(
        {},
        { Connected: ['Neighbor1', 'GhostEntity'] }
      );
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never,
        prior
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const results = await manager.search(testGraph, 'test', {
        expandNeighbors: { hops: 1, damping: 0.5 },
      });

      const parent = results.find(r => r.entity.name === 'Connected')!;
      const neighbor = results.find(r => r.entity.name === 'Neighbor1')!;
      expect(neighbor.scores.combined).toBeCloseTo(0.5 * parent.scores.combined);
      expect(results.find(r => r.entity.name === 'GhostEntity')).toBeUndefined();
    });

    it('should only expand from the top-K results', async () => {
      const { fake, prior } = makeFakePrior(
        {},
        { Connected: ['Neighbor1'], Isolated: ['Neighbor2'] }
      );
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never,
        prior
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
        { entity: testGraph.entities[1], score: 3 },
      ]);

      const results = await manager.search(testGraph, 'test', {
        expandNeighbors: { hops: 1, topK: 1 },
      });

      expect(fake.neighbors).toHaveBeenCalledTimes(1);
      expect(fake.neighbors).toHaveBeenCalledWith('Connected');
      expect(results.find(r => r.entity.name === 'Neighbor1')).toBeDefined();
      expect(results.find(r => r.entity.name === 'Neighbor2')).toBeUndefined();
    });

    it('should not expand when no prior is attached', async () => {
      const manager = new HybridSearchManager(
        mockSemanticSearch as never,
        mockRankedSearch as never
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const results = await manager.search(testGraph, 'test', {
        expandNeighbors: { hops: 1 },
      });

      expect(results.map(r => r.entity.name)).toEqual(['Connected']);
    });
  });
});
