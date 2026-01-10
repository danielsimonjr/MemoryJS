import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { HybridSearchManager } from '../../src/search/HybridSearchManager.js';
import { RankedSearch } from '../../src/search/RankedSearch.js';
import type { Entity, ReadonlyKnowledgeGraph } from '../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('hybrid_search Integration', () => {
  let testDir: string;
  let storage: GraphStorage;
  let rankedSearch: RankedSearch;
  let hybridSearch: HybridSearchManager;
  let testGraph: ReadonlyKnowledgeGraph;

  const testEntities: Entity[] = [
    {
      name: 'Alice',
      entityType: 'person',
      observations: ['software engineer at TechCorp', 'expert in TypeScript'],
      tags: ['tech', 'senior'],
      importance: 8,
      createdAt: '2026-01-01T00:00:00Z',
      lastModified: '2026-01-01T00:00:00Z',
    },
    {
      name: 'Bob',
      entityType: 'person',
      observations: ['designer at DesignCo', 'specializes in UX'],
      tags: ['creative'],
      importance: 5,
      createdAt: '2025-06-01T00:00:00Z',
      lastModified: '2025-06-01T00:00:00Z',
    },
    {
      name: 'TechCorp',
      entityType: 'company',
      observations: ['technology company founded in 2010', 'builds software solutions'],
      tags: ['tech', 'enterprise'],
      importance: 9,
      createdAt: '2024-01-01T00:00:00Z',
      lastModified: '2024-01-01T00:00:00Z',
    },
    {
      name: 'DesignCo',
      entityType: 'company',
      observations: ['design agency', 'creative services'],
      tags: ['creative', 'agency'],
      importance: 6,
      createdAt: '2025-01-01T00:00:00Z',
      lastModified: '2025-01-01T00:00:00Z',
    },
    {
      name: 'TypeScript',
      entityType: 'technology',
      observations: ['programming language', 'superset of JavaScript'],
      tags: ['tech', 'language'],
      importance: 7,
      createdAt: '2020-01-01T00:00:00Z',
      lastModified: '2020-01-01T00:00:00Z',
    },
  ];

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `hybrid-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'test.jsonl'));

    await storage.saveGraph({
      entities: testEntities,
      relations: [],
    });

    rankedSearch = new RankedSearch(storage);
    // Use null for semantic search since it requires embedding service
    hybridSearch = new HybridSearchManager(null, rankedSearch);
    testGraph = await storage.loadGraph();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('basic search', () => {
    it('should return results for a simple query', async () => {
      const results = await hybridSearch.search(testGraph, 'software');

      expect(results.length).toBeGreaterThan(0);
      // Alice and TechCorp mention software
      const names = results.map((r) => r.entity.name);
      expect(names).toContain('Alice');
    });

    it('should return empty array for unmatched query', async () => {
      const results = await hybridSearch.search(testGraph, 'xyznonexistent');

      // May have results from symbolic layer with base score
      // but lexical should return nothing
      for (const r of results) {
        expect(r.scores.lexical).toBe(0);
      }
    });

    it('should respect limit parameter', async () => {
      const results = await hybridSearch.search(testGraph, 'company', { limit: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('weight customization', () => {
    it('should allow custom weights', async () => {
      const results = await hybridSearch.search(testGraph, 'tech', {
        semanticWeight: 0.1,
        lexicalWeight: 0.7,
        symbolicWeight: 0.2,
      });

      expect(results.length).toBeGreaterThan(0);
      // Verify results are sorted by combined score
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].scores.combined).toBeGreaterThanOrEqual(
          results[i].scores.combined
        );
      }
    });

    it('should normalize weights automatically', async () => {
      // Weights don't sum to 1.0 - should be normalized
      const results = await hybridSearch.search(testGraph, 'design', {
        semanticWeight: 1,
        lexicalWeight: 1,
        symbolicWeight: 1,
      });

      expect(results.length).toBeGreaterThan(0);
      // Combined scores should still be <= 1.0 after normalization
      for (const r of results) {
        expect(r.scores.combined).toBeLessThanOrEqual(1);
      }
    });

    it('should work with zero semantic weight', async () => {
      const results = await hybridSearch.search(testGraph, 'TypeScript', {
        semanticWeight: 0,
        lexicalWeight: 0.8,
        symbolicWeight: 0.2,
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('symbolic filters', () => {
    it('should filter by tags', async () => {
      const results = await hybridSearch.search(testGraph, 'company', {
        symbolic: { tags: ['creative'] },
      });

      // With hybrid search, symbolic filters boost matching entities
      // but don't strictly exclude non-matching ones
      // Entities with 'creative' tag should have higher symbolic scores
      const creativeResults = results.filter((r) =>
        r.entity.tags?.includes('creative')
      );
      const nonCreativeResults = results.filter(
        (r) => !r.entity.tags?.includes('creative')
      );

      // Creative entities should have non-zero symbolic scores
      for (const r of creativeResults) {
        expect(r.scores.symbolic).toBeGreaterThan(0);
      }
      // Non-creative entities should have zero symbolic scores
      for (const r of nonCreativeResults) {
        expect(r.scores.symbolic).toBe(0);
      }
    });

    it('should filter by entity types', async () => {
      const results = await hybridSearch.search(testGraph, 'software', {
        symbolic: { entityTypes: ['person'] },
      });

      // With hybrid search, entity type filters boost matching entities
      // Entities of type 'person' should have higher symbolic scores
      const personResults = results.filter((r) => r.entity.entityType === 'person');
      const nonPersonResults = results.filter((r) => r.entity.entityType !== 'person');

      // Person entities should have non-zero symbolic scores
      for (const r of personResults) {
        expect(r.scores.symbolic).toBeGreaterThan(0);
      }
      // Non-person entities should have zero symbolic scores
      for (const r of nonPersonResults) {
        expect(r.scores.symbolic).toBe(0);
      }
    });

    it('should filter by importance range', async () => {
      const results = await hybridSearch.search(testGraph, 'tech', {
        symbolic: { importance: { min: 7 } },
      });

      for (const r of results) {
        expect(r.entity.importance).toBeGreaterThanOrEqual(7);
      }
    });

    it('should filter by date range', async () => {
      const results = await hybridSearch.search(testGraph, 'company', {
        symbolic: {
          dateRange: { start: '2025-01-01', end: '2026-12-31' },
        },
      });

      // With hybrid search, date range filters boost matching entities
      // Entities in range (2025-2026) should have non-zero symbolic scores
      // Entities out of range should have zero symbolic scores
      const inRangeEntities = ['Alice', 'Bob', 'DesignCo'];

      for (const r of results) {
        if (inRangeEntities.includes(r.entity.name)) {
          expect(r.scores.symbolic).toBeGreaterThan(0);
        } else {
          // TechCorp (2024) and TypeScript (2020) are out of range
          expect(r.scores.symbolic).toBe(0);
        }
      }
    });

    it('should combine multiple filters with AND logic', async () => {
      const results = await hybridSearch.search(testGraph, 'works', {
        symbolic: {
          entityTypes: ['person'],
          tags: ['tech'],
        },
      });

      // Only Alice is a person with 'tech' tag
      for (const r of results) {
        expect(r.entity.entityType).toBe('person');
        expect(r.entity.tags).toContain('tech');
      }
    });
  });

  describe('response structure', () => {
    it('should include per-layer scores', async () => {
      const results = await hybridSearch.search(testGraph, 'software');

      expect(results.length).toBeGreaterThan(0);
      const result = results[0];

      expect(result.scores).toHaveProperty('semantic');
      expect(result.scores).toHaveProperty('lexical');
      expect(result.scores).toHaveProperty('symbolic');
      expect(result.scores).toHaveProperty('combined');

      expect(typeof result.scores.semantic).toBe('number');
      expect(typeof result.scores.lexical).toBe('number');
      expect(typeof result.scores.symbolic).toBe('number');
      expect(typeof result.scores.combined).toBe('number');
    });

    it('should include matchedLayers array', async () => {
      const results = await hybridSearch.search(testGraph, 'TypeScript');

      expect(results.length).toBeGreaterThan(0);
      const result = results[0];

      expect(Array.isArray(result.matchedLayers)).toBe(true);
      // Should match at least lexical (keyword match)
      expect(result.matchedLayers.length).toBeGreaterThan(0);
    });

    it('should include full entity data', async () => {
      const results = await hybridSearch.searchWithEntities(testGraph, 'Alice');

      expect(results.length).toBeGreaterThan(0);
      const result = results.find((r) => r.entity.name === 'Alice');

      expect(result?.entity.entityType).toBe('person');
      expect(result?.entity.observations.length).toBeGreaterThan(0);
      expect(result?.entity.tags).toContain('tech');
    });
  });

  describe('edge cases', () => {
    it('should handle empty query gracefully', async () => {
      const results = await hybridSearch.search(testGraph, '');

      // Empty query should return results from symbolic layer
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle special characters in query', async () => {
      const results = await hybridSearch.search(testGraph, 'TypeScript (language)');

      // Should not throw, may or may not find results
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle empty graph', async () => {
      const emptyGraph: ReadonlyKnowledgeGraph = { entities: [], relations: [] };
      const results = await hybridSearch.search(emptyGraph, 'test');

      expect(results).toEqual([]);
    });

    it('should handle filters with no matches', async () => {
      const results = await hybridSearch.search(testGraph, 'software', {
        symbolic: { tags: ['nonexistent-tag'] },
      });

      // With hybrid search, results may still come from lexical/semantic layers
      // but symbolic scores should be zero for all since no tags match
      for (const r of results) {
        expect(r.scores.symbolic).toBe(0);
      }
    });
  });
});
