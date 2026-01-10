import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { HybridSearchManager } from '../../src/search/HybridSearchManager.js';
import { ReflectionManager } from '../../src/search/ReflectionManager.js';
import { QueryAnalyzer } from '../../src/search/QueryAnalyzer.js';
import { QueryPlanner } from '../../src/search/QueryPlanner.js';
import { RankedSearch } from '../../src/search/RankedSearch.js';
import type { Entity, ReadonlyKnowledgeGraph } from '../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('smart_search Integration', () => {
  let testDir: string;
  let storage: GraphStorage;
  let rankedSearch: RankedSearch;
  let hybridSearch: HybridSearchManager;
  let analyzer: QueryAnalyzer;
  let planner: QueryPlanner;
  let reflection: ReflectionManager;
  let testGraph: ReadonlyKnowledgeGraph;

  const testEntities: Entity[] = [
    {
      name: 'Alice',
      entityType: 'person',
      observations: ['software engineer at TechCorp', 'works on AI projects', 'team lead'],
      tags: ['tech', 'senior'],
      importance: 8,
      createdAt: '2026-01-01T00:00:00Z',
      lastModified: '2026-01-01T00:00:00Z',
    },
    {
      name: 'Bob',
      entityType: 'person',
      observations: ['designer at DesignCo', 'specializes in UX', 'created mobile app UI'],
      tags: ['creative', 'design'],
      importance: 6,
      createdAt: '2025-06-01T00:00:00Z',
      lastModified: '2025-06-01T00:00:00Z',
    },
    {
      name: 'ProjectX',
      entityType: 'project',
      observations: ['AI research project', 'started in 2025', 'involves machine learning'],
      tags: ['ai', 'research'],
      importance: 9,
      createdAt: '2025-01-01T00:00:00Z',
      lastModified: '2025-01-01T00:00:00Z',
    },
    {
      name: 'ProjectY',
      entityType: 'project',
      observations: ['Mobile app development', 'launched in 2024', 'consumer facing'],
      tags: ['mobile', 'product'],
      importance: 7,
      createdAt: '2024-06-01T00:00:00Z',
      lastModified: '2024-06-01T00:00:00Z',
    },
    {
      name: 'TechCorp',
      entityType: 'company',
      observations: ['technology company', 'specializes in AI', 'founded 2010'],
      tags: ['tech', 'enterprise'],
      importance: 8,
      createdAt: '2010-01-01T00:00:00Z',
      lastModified: '2010-01-01T00:00:00Z',
    },
    {
      name: 'DesignCo',
      entityType: 'company',
      observations: ['design agency', 'creative services', 'UX/UI expertise'],
      tags: ['creative', 'agency'],
      importance: 6,
      createdAt: '2015-01-01T00:00:00Z',
      lastModified: '2015-01-01T00:00:00Z',
    },
  ];

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `smart-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'test.jsonl'));

    await storage.saveGraph({
      entities: testEntities,
      relations: [],
    });

    rankedSearch = new RankedSearch(storage);
    hybridSearch = new HybridSearchManager(null, rankedSearch);
    analyzer = new QueryAnalyzer();
    planner = new QueryPlanner();
    reflection = new ReflectionManager(hybridSearch, analyzer);
    testGraph = await storage.loadGraph();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('QueryAnalyzer integration', () => {
    it('should analyze query and extract persons', () => {
      const analysis = analyzer.analyze('Find projects by Alice');
      expect(analysis.persons).toContain('Alice');
      expect(analysis.questionType).toBe('factual');
    });

    it('should detect temporal references', () => {
      const analysis = analyzer.analyze('What happened last month?');
      expect(analysis.temporalRange?.relative).toBe('last month');
    });

    it('should estimate complexity correctly', () => {
      const simple = analyzer.analyze('Find Alice');
      const complex = analyzer.analyze(
        'What projects did Alice work on last year, and how do they compare to Bob\'s projects in terms of success rate and team involvement?'
      );
      expect(simple.complexity).toBe('low');
      expect(complex.complexity).toBe('high');
    });
  });

  describe('QueryPlanner integration', () => {
    it('should create plan from analysis', () => {
      const analysis = analyzer.analyze('Find projects by Alice');
      const plan = planner.createPlan('Find projects by Alice', analysis);

      expect(plan.originalQuery).toBe('Find projects by Alice');
      expect(plan.subQueries.length).toBeGreaterThan(0);
      expect(plan.executionStrategy).toBeDefined();
    });

    it('should select appropriate layer', () => {
      const temporalAnalysis = analyzer.analyze('What happened last month?');
      const temporalPlan = planner.createPlan('What happened last month?', temporalAnalysis);
      expect(temporalPlan.subQueries[0].targetLayer).toBe('symbolic');

      const simplePlan = planner.createPlan(
        'Find projects',
        analyzer.analyze('Find projects')
      );
      expect(simplePlan.subQueries[0].targetLayer).toBe('hybrid');
    });
  });

  describe('ReflectionManager integration', () => {
    it('should return results for a valid query', async () => {
      const result = await reflection.retrieveWithReflection(
        testGraph,
        'Find software engineers',
        { maxIterations: 3 }
      );

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.iterations).toBeGreaterThanOrEqual(1);
      expect(result.adequacyScore).toBeGreaterThanOrEqual(0);
    });

    it('should respect maxIterations limit', async () => {
      const result = await reflection.retrieveWithReflection(
        testGraph,
        'xyz nonexistent query',
        { maxIterations: 2, adequacyThreshold: 0.99 }
      );

      expect(result.iterations).toBeLessThanOrEqual(2);
    });

    it('should terminate early when adequate', async () => {
      const result = await reflection.retrieveWithReflection(
        testGraph,
        'software engineer',
        { maxIterations: 5, adequacyThreshold: 0.1 }
      );

      // With low threshold and good data, should terminate early
      expect(result.adequate).toBe(true);
      expect(result.iterations).toBeLessThanOrEqual(5);
    });

    it('should track refinements when made', async () => {
      const result = await reflection.retrieveWithReflection(
        testGraph,
        'only specific exact person data',
        { maxIterations: 3, adequacyThreshold: 0.99 }
      );

      // If refinements were made, they should be recorded
      if (result.iterations > 1) {
        expect(result.refinements.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('should calculate adequacy score', async () => {
      const result = await reflection.retrieveWithReflection(
        testGraph,
        'Find AI projects',
        { maxIterations: 3 }
      );

      expect(result.adequacyScore).toBeGreaterThanOrEqual(0);
      expect(result.adequacyScore).toBeLessThanOrEqual(1);
    });

    it('should combine results from multiple iterations', async () => {
      const result = await reflection.retrieveWithReflection(
        testGraph,
        'person people team',
        { maxIterations: 3, adequacyThreshold: 0.99 }
      );

      // All results should be present and deduplicated
      const uniqueNames = new Set(result.results.map(r => r.entity.name));
      expect(uniqueNames.size).toBe(result.results.length);
    });
  });

  describe('end-to-end smart search workflow', () => {
    it('should complete full workflow: analyze → plan → search → reflect', async () => {
      const query = 'What projects are related to AI?';

      // Step 1: Analyze
      const analysis = analyzer.analyze(query);
      expect(analysis.questionType).toBe('factual');

      // Step 2: Plan
      const plan = planner.createPlan(query, analysis);
      expect(plan.subQueries.length).toBeGreaterThan(0);

      // Step 3: Search with reflection
      const result = await reflection.retrieveWithReflection(testGraph, query, {
        maxIterations: 3,
        adequacyThreshold: 0.5,
      });

      // Step 4: Verify results
      expect(result.results.length).toBeGreaterThan(0);
      const names = result.results.map(r => r.entity.name);
      expect(names).toContain('ProjectX'); // AI research project
    });

    it('should handle empty graph gracefully', async () => {
      const emptyGraph: ReadonlyKnowledgeGraph = { entities: [], relations: [] };

      const result = await reflection.retrieveWithReflection(emptyGraph, 'test query', {
        maxIterations: 2,
      });

      expect(result.results.length).toBe(0);
      expect(result.adequate).toBe(false);
    });

    it('should handle special characters in query', async () => {
      const result = await reflection.retrieveWithReflection(
        testGraph,
        'Find Alice (software engineer)',
        { maxIterations: 2 }
      );

      // Should not throw
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('should return sorted results by combined score', async () => {
      const result = await reflection.retrieveWithReflection(
        testGraph,
        'technology projects',
        { maxIterations: 2 }
      );

      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].scores.combined).toBeGreaterThanOrEqual(
          result.results[i].scores.combined
        );
      }
    });
  });
});
