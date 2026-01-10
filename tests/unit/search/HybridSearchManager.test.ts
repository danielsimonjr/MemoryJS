import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HybridSearchManager, DEFAULT_HYBRID_WEIGHTS } from '../../../src/search/HybridSearchManager.js';
import { SymbolicSearch } from '../../../src/search/SymbolicSearch.js';
import type { Entity, ReadonlyKnowledgeGraph } from '../../../src/types/index.js';

describe('HybridSearchManager', () => {
  const mockSemanticSearch = {
    search: vi.fn(),
  };
  const mockRankedSearch = {
    searchNodesRanked: vi.fn(),
  };

  let hybridSearch: HybridSearchManager;
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
    hybridSearch = new HybridSearchManager(
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

  describe('search', () => {
    it('should execute all three search layers', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 0.9 },
      ]);
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const results = await hybridSearch.search(testGraph, 'engineer', {
        symbolic: { tags: ['tech'] },
      });

      expect(mockSemanticSearch.search).toHaveBeenCalled();
      expect(mockRankedSearch.searchNodesRanked).toHaveBeenCalled();
      expect(results.length).toBeGreaterThan(0);
    });

    it('should normalize weights to sum to 1.0', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 1.0 },
      ]);
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 10 },
      ]);

      const results = await hybridSearch.search(testGraph, 'test', {
        semanticWeight: 1,
        lexicalWeight: 1,
        symbolicWeight: 1,
      });

      // With equal weights (normalized to 0.333 each), combined score should be
      // based on normalized values
      expect(results.length).toBeGreaterThan(0);
      // Combined score should never exceed 1.0
      expect(results[0].scores.combined).toBeLessThanOrEqual(1);
    });

    it('should use default weights when not specified', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 1.0 },
      ]);
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 10 },
      ]);

      await hybridSearch.search(testGraph, 'test');

      // Verify the search was performed with default weights
      expect(mockSemanticSearch.search).toHaveBeenCalled();
      expect(mockRankedSearch.searchNodesRanked).toHaveBeenCalled();
    });

    it('should track which layers matched each result', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 0.8 },
      ]);
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
        { entity: testGraph.entities[1], score: 3 }, // Only lexical match
      ]);

      const results = await hybridSearch.search(testGraph, 'test');

      // Alice should match both semantic and lexical
      const aliceResult = results.find(r => r.entity.name === 'Alice');
      expect(aliceResult?.matchedLayers).toContain('semantic');
      expect(aliceResult?.matchedLayers).toContain('lexical');
    });

    it('should sort results by combined score descending', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 0.5 },
        { entity: testGraph.entities[1], similarity: 0.9 },
      ]);
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 2 },
        { entity: testGraph.entities[1], score: 8 },
      ]);

      const results = await hybridSearch.search(testGraph, 'test');

      // Results should be sorted by combined score
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].scores.combined).toBeGreaterThanOrEqual(
          results[i].scores.combined
        );
      }
    });

    it('should respect limit option', async () => {
      mockSemanticSearch.search.mockResolvedValue(
        testGraph.entities.map(e => ({ entity: e, similarity: 0.5 }))
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue(
        testGraph.entities.map(e => ({ entity: e, score: 3 }))
      );

      const results = await hybridSearch.search(testGraph, 'test', { limit: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should handle semantic search failure gracefully', async () => {
      mockSemanticSearch.search.mockRejectedValue(new Error('Not indexed'));
      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const results = await hybridSearch.search(testGraph, 'test');

      // Should still return results from lexical search
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle lexical search failure gracefully', async () => {
      mockSemanticSearch.search.mockResolvedValue([
        { entity: testGraph.entities[0], similarity: 0.8 },
      ]);
      mockRankedSearch.searchNodesRanked.mockRejectedValue(new Error('Failed'));

      const results = await hybridSearch.search(testGraph, 'test');

      // Should still return results from semantic search
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle null semantic search', async () => {
      const hybridNoSemantic = new HybridSearchManager(
        null, // No semantic search
        mockRankedSearch as any
      );

      mockRankedSearch.searchNodesRanked.mockResolvedValue([
        { entity: testGraph.entities[0], score: 5 },
      ]);

      const results = await hybridNoSemantic.search(testGraph, 'test');

      expect(results.length).toBeGreaterThan(0);
      // Results should only have lexical matches
      const result = results.find(r => r.entity.name === 'Alice');
      expect(result?.matchedLayers).not.toContain('semantic');
    });
  });

  describe('symbolic filters', () => {
    it('should filter by tags', async () => {
      mockRankedSearch.searchNodesRanked.mockResolvedValue([]);

      const results = await hybridSearch.search(testGraph, 'test', {
        symbolic: { tags: ['creative'] },
      });

      // Only Bob has 'creative' tag
      const matchedNames = results.map(r => r.entity.name);
      expect(matchedNames).toContain('Bob');
      expect(matchedNames).not.toContain('Alice');
    });

    it('should filter by entity types', async () => {
      mockRankedSearch.searchNodesRanked.mockResolvedValue([]);

      const results = await hybridSearch.search(testGraph, 'test', {
        symbolic: { entityTypes: ['company'] },
      });

      // Only TechCorp is a company
      const matchedNames = results.map(r => r.entity.name);
      expect(matchedNames).toContain('TechCorp');
      expect(matchedNames).not.toContain('Alice');
      expect(matchedNames).not.toContain('Bob');
    });

    it('should filter by importance range', async () => {
      mockRankedSearch.searchNodesRanked.mockResolvedValue([]);

      const results = await hybridSearch.search(testGraph, 'test', {
        symbolic: { importance: { min: 7 } },
      });

      // Only Alice (8) and TechCorp (9) have importance >= 7
      const matchedNames = results.map(r => r.entity.name);
      expect(matchedNames).toContain('Alice');
      expect(matchedNames).toContain('TechCorp');
      expect(matchedNames).not.toContain('Bob');
    });

    it('should give base score when no symbolic filters specified', async () => {
      mockRankedSearch.searchNodesRanked.mockResolvedValue([]);
      mockSemanticSearch.search.mockResolvedValue([]);

      const results = await hybridSearch.search(testGraph, 'test', {});

      // All entities should have symbolic score of 0.5
      for (const result of results) {
        expect(result.scores.symbolic).toBe(0.5);
      }
    });
  });

  describe('DEFAULT_HYBRID_WEIGHTS', () => {
    it('should have weights summing to 1.0', () => {
      const sum =
        DEFAULT_HYBRID_WEIGHTS.semantic +
        DEFAULT_HYBRID_WEIGHTS.lexical +
        DEFAULT_HYBRID_WEIGHTS.symbolic;
      expect(sum).toBe(1.0);
    });

    it('should have semantic as highest weight', () => {
      expect(DEFAULT_HYBRID_WEIGHTS.semantic).toBeGreaterThan(
        DEFAULT_HYBRID_WEIGHTS.lexical
      );
      expect(DEFAULT_HYBRID_WEIGHTS.semantic).toBeGreaterThan(
        DEFAULT_HYBRID_WEIGHTS.symbolic
      );
    });
  });
});

describe('SymbolicSearch', () => {
  let symbolicSearch: SymbolicSearch;
  let testEntities: Entity[];

  beforeEach(() => {
    symbolicSearch = new SymbolicSearch();
    testEntities = [
      {
        name: 'Alice',
        entityType: 'person',
        observations: ['works at tech'],
        tags: ['engineer', 'senior'],
        importance: 8,
        createdAt: '2026-01-01T00:00:00Z',
        lastModified: '2026-01-01T00:00:00Z',
      },
      {
        name: 'Bob',
        entityType: 'person',
        observations: ['designer'],
        tags: ['creative'],
        importance: 5,
        createdAt: '2025-06-01T00:00:00Z',
        lastModified: '2025-06-01T00:00:00Z',
      },
      {
        name: 'TechCorp',
        entityType: 'company',
        observations: ['tech company'],
        tags: ['tech', 'enterprise'],
        importance: 9,
        createdAt: '2024-01-01T00:00:00Z',
        lastModified: '2024-01-01T00:00:00Z',
      },
      {
        name: 'EmptyEntity',
        entityType: 'unknown',
        observations: [],
      },
    ];
  });

  describe('search', () => {
    it('should filter by single tag', () => {
      const results = symbolicSearch.search(testEntities, {
        tags: ['engineer'],
      });

      expect(results.length).toBe(1);
      expect(results[0].entity.name).toBe('Alice');
      expect(results[0].matchedFilters).toContain('tags:engineer');
    });

    it('should filter by multiple tags (OR within tags)', () => {
      const results = symbolicSearch.search(testEntities, {
        tags: ['engineer', 'creative'],
      });

      expect(results.length).toBe(2);
      const names = results.map(r => r.entity.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('should filter by entity type', () => {
      const results = symbolicSearch.search(testEntities, {
        entityTypes: ['company'],
      });

      expect(results.length).toBe(1);
      expect(results[0].entity.name).toBe('TechCorp');
    });

    it('should filter by importance minimum', () => {
      const results = symbolicSearch.search(testEntities, {
        importance: { min: 7 },
      });

      expect(results.length).toBe(2);
      const names = results.map(r => r.entity.name);
      expect(names).toContain('Alice');
      expect(names).toContain('TechCorp');
    });

    it('should filter by importance maximum', () => {
      const results = symbolicSearch.search(testEntities, {
        importance: { max: 6 },
      });

      expect(results.length).toBe(2);
      const names = results.map(r => r.entity.name);
      expect(names).toContain('Bob');
      expect(names).toContain('EmptyEntity'); // Default importance is 5
    });

    it('should filter by date range', () => {
      const results = symbolicSearch.search(testEntities, {
        dateRange: { start: '2025-01-01', end: '2026-12-31' },
      });

      expect(results.length).toBe(2);
      const names = results.map(r => r.entity.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('should filter by hasObservations', () => {
      const results = symbolicSearch.search(testEntities, {
        hasObservations: false,
      });

      expect(results.length).toBe(1);
      expect(results[0].entity.name).toBe('EmptyEntity');
    });

    it('should AND-combine multiple filters', () => {
      const results = symbolicSearch.search(testEntities, {
        entityTypes: ['person'],
        importance: { min: 7 },
      });

      // Only Alice is a person with importance >= 7
      expect(results.length).toBe(1);
      expect(results[0].entity.name).toBe('Alice');
    });

    it('should return all entities with base score when no filters', () => {
      const results = symbolicSearch.search(testEntities, {});

      expect(results.length).toBe(testEntities.length);
      for (const result of results) {
        expect(result.score).toBe(0.5);
      }
    });

    it('should calculate score based on filter match proportion', () => {
      const results = symbolicSearch.search(testEntities, {
        tags: ['senior'],
      });

      expect(results.length).toBe(1);
      expect(results[0].score).toBe(1); // 1/1 filter matched
    });

    it('should be case-insensitive for tags', () => {
      const results = symbolicSearch.search(testEntities, {
        tags: ['ENGINEER'],
      });

      expect(results.length).toBe(1);
      expect(results[0].entity.name).toBe('Alice');
    });

    it('should be case-insensitive for entity types', () => {
      const results = symbolicSearch.search(testEntities, {
        entityTypes: ['COMPANY'],
      });

      expect(results.length).toBe(1);
      expect(results[0].entity.name).toBe('TechCorp');
    });
  });

  describe('helper methods', () => {
    describe('byTag', () => {
      it('should filter entities by tag', () => {
        const results = symbolicSearch.byTag(testEntities, 'engineer');
        expect(results.length).toBe(1);
        expect(results[0].name).toBe('Alice');
      });

      it('should be case-insensitive', () => {
        const results = symbolicSearch.byTag(testEntities, 'CREATIVE');
        expect(results.length).toBe(1);
        expect(results[0].name).toBe('Bob');
      });
    });

    describe('byType', () => {
      it('should filter entities by type', () => {
        const results = symbolicSearch.byType(testEntities, 'company');
        expect(results.length).toBe(1);
        expect(results[0].name).toBe('TechCorp');
      });

      it('should be case-insensitive', () => {
        const results = symbolicSearch.byType(testEntities, 'PERSON');
        expect(results.length).toBe(2);
        const names = results.map(e => e.name);
        expect(names).toContain('Alice');
        expect(names).toContain('Bob');
      });
    });

    describe('byImportance', () => {
      it('should filter entities within importance range', () => {
        const results = symbolicSearch.byImportance(testEntities, 5, 8);
        expect(results.length).toBe(3);
        const names = results.map(e => e.name);
        expect(names).toContain('Alice');
        expect(names).toContain('Bob');
        expect(names).toContain('EmptyEntity');
      });

      it('should handle entities without importance (default 5)', () => {
        const results = symbolicSearch.byImportance(testEntities, 4, 6);
        expect(results.length).toBe(2);
        const names = results.map(e => e.name);
        expect(names).toContain('Bob');
        expect(names).toContain('EmptyEntity');
      });
    });
  });
});
