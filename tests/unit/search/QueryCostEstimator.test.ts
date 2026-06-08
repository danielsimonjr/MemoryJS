/**
 * Query Cost Estimator Tests
 *
 * Phase 10 Sprint 4: Tests for query cost estimation and method recommendation.
 * Phase 12 Sprint 4: Tests for adaptive depth, token estimation, and layer recommendations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QueryCostEstimator } from '../../../src/search/QueryCostEstimator.js';
import { QueryAnalyzer } from '../../../src/search/QueryAnalyzer.js';
import type { SearchMethod, QueryAnalysis } from '../../../src/types/index.js';

describe('QueryCostEstimator', () => {
  let estimator: QueryCostEstimator;

  beforeEach(() => {
    estimator = new QueryCostEstimator();
  });

  describe('estimateMethod', () => {
    it('should return estimate for basic search', () => {
      const estimate = estimator.estimateMethod('basic', 'test', 100);

      expect(estimate.method).toBe('basic');
      expect(estimate.estimatedTimeMs).toBeGreaterThan(0);
      expect(estimate.complexity).toBe('low');
      expect(estimate.entityCount).toBe(100);
      expect(estimate.recommendation).toContain('substring');
      expect(typeof estimate.isRecommended).toBe('boolean');
    });

    it('should return estimate for ranked search', () => {
      const estimate = estimator.estimateMethod('ranked', 'test query', 500);

      expect(estimate.method).toBe('ranked');
      expect(estimate.estimatedTimeMs).toBeGreaterThan(0);
      expect(estimate.complexity).toBe('medium');
      expect(estimate.recommendation).toContain('TF-IDF');
    });

    it('should return estimate for boolean search', () => {
      const estimate = estimator.estimateMethod('boolean', 'test AND query', 100);

      expect(estimate.method).toBe('boolean');
      expect(estimate.estimatedTimeMs).toBeGreaterThan(0);
      expect(estimate.recommendation).toContain('Boolean');
    });

    it('should return estimate for fuzzy search', () => {
      const estimate = estimator.estimateMethod('fuzzy', 'tset', 100);

      expect(estimate.method).toBe('fuzzy');
      expect(estimate.estimatedTimeMs).toBeGreaterThan(0);
      expect(estimate.recommendation).toContain('typo');
    });

    it('should return estimate for semantic search', () => {
      const estimate = estimator.estimateMethod('semantic', 'conceptual query', 100);

      expect(estimate.method).toBe('semantic');
      expect(estimate.estimatedTimeMs).toBeGreaterThan(0);
      expect(estimate.recommendation).toContain('Meaning');
    });

    it('should classify low complexity for small graphs', () => {
      const estimate = estimator.estimateMethod('basic', 'test', 50);
      expect(estimate.complexity).toBe('low');
    });

    it('should classify medium complexity for medium graphs', () => {
      const estimate = estimator.estimateMethod('basic', 'test', 500);
      expect(estimate.complexity).toBe('medium');
    });

    it('should classify high complexity for large graphs', () => {
      const estimate = estimator.estimateMethod('basic', 'test', 2000);
      expect(estimate.complexity).toBe('high');
    });

    it('should increase estimated time with entity count', () => {
      const small = estimator.estimateMethod('basic', 'test', 100);
      const large = estimator.estimateMethod('basic', 'test', 1000);

      expect(large.estimatedTimeMs).toBeGreaterThan(small.estimatedTimeMs);
    });

    it('should adjust time based on query complexity', () => {
      const simple = estimator.estimateMethod('basic', 'test', 100);
      const complex = estimator.estimateMethod('basic', 'test query with many words', 100);

      expect(complex.estimatedTimeMs).toBeGreaterThan(simple.estimatedTimeMs);
    });
  });

  describe('estimateAllMethods', () => {
    it('should return estimates for all 5 search methods', () => {
      const estimates = estimator.estimateAllMethods('test', 100);

      expect(estimates).toHaveLength(5);

      const methods = estimates.map(e => e.method);
      expect(methods).toContain('basic');
      expect(methods).toContain('ranked');
      expect(methods).toContain('boolean');
      expect(methods).toContain('fuzzy');
      expect(methods).toContain('semantic');
    });

    it('should mark exactly one method as recommended', () => {
      const estimates = estimator.estimateAllMethods('test', 100);

      const recommended = estimates.filter(e => e.isRecommended);
      expect(recommended).toHaveLength(1);
    });

    it('should have consistent entity counts', () => {
      const estimates = estimator.estimateAllMethods('test', 500);

      for (const estimate of estimates) {
        expect(estimate.entityCount).toBe(500);
      }
    });
  });

  describe('recommendMethod', () => {
    it('should recommend basic for simple short queries on small graphs', () => {
      const result = estimator.recommendMethod('test', 50);

      expect(result.method).toBe('basic');
      expect(result.reason).toContain('small graph');
    });

    it('should recommend boolean for queries with AND operator', () => {
      const result = estimator.recommendMethod('alice AND bob', 500);

      expect(result.method).toBe('boolean');
      expect(result.reason).toContain('logical operators');
    });

    it('should recommend boolean for queries with OR operator', () => {
      const result = estimator.recommendMethod('frontend OR backend', 500);

      expect(result.method).toBe('boolean');
      expect(result.reason).toContain('logical operators');
    });

    it('should recommend boolean for queries with NOT operator', () => {
      const result = estimator.recommendMethod('api NOT deprecated', 500);

      expect(result.method).toBe('boolean');
      expect(result.reason).toContain('logical operators');
    });

    it('should recommend ranked for multi-word queries', () => {
      const result = estimator.recommendMethod('machine learning algorithms', 500);

      expect(result.method).toBe('ranked');
      expect(result.reason).toContain('multi-word');
    });

    it('should recommend fuzzy for wildcard queries', () => {
      const result = estimator.recommendMethod('test*', 500);

      expect(result.method).toBe('fuzzy');
      expect(result.reason).toContain('wildcard');
    });

    it('should recommend ranked for long natural language queries', () => {
      // Note: Ranked search provides best balance of speed and relevance
      // for multi-word queries, so it's preferred over semantic
      const result = estimator.recommendMethod(
        'find all entities related to software engineering best practices',
        500
      );

      expect(result.method).toBe('ranked');
      expect(result.reason).toContain('multi-word');
    });

    it('should include estimate in result', () => {
      const result = estimator.recommendMethod('test', 100);

      expect(result.estimate).toBeDefined();
      expect(result.estimate.method).toBe(result.method);
      expect(result.estimate.estimatedTimeMs).toBeGreaterThan(0);
    });

    it('should respect preferredMethods filter', () => {
      const preferredMethods: SearchMethod[] = ['basic', 'fuzzy'];
      const result = estimator.recommendMethod('alice AND bob', 500, preferredMethods);

      expect(preferredMethods).toContain(result.method);
    });

    it('should not recommend boolean when not in preferred methods', () => {
      const preferredMethods: SearchMethod[] = ['basic', 'ranked'];
      const result = estimator.recommendMethod('test AND query', 500, preferredMethods);

      expect(result.method).not.toBe('boolean');
    });
  });

  describe('query complexity factors', () => {
    it('should reduce complexity factor for boolean search with operators', () => {
      // Boolean search should be more efficient for queries with operators
      const withOperator = estimator.estimateMethod('boolean', 'test AND query', 100);
      const withoutOperator = estimator.estimateMethod('boolean', 'test query', 100);

      // The one with operators should have lower estimated time (more efficient)
      expect(withOperator.estimatedTimeMs).toBeLessThan(withoutOperator.estimatedTimeMs);
    });

    it('should reduce complexity factor for fuzzy search with wildcards', () => {
      const withWildcard = estimator.estimateMethod('fuzzy', 'test*', 100);
      const withoutWildcard = estimator.estimateMethod('fuzzy', 'test', 100);

      expect(withWildcard.estimatedTimeMs).toBeLessThan(withoutWildcard.estimatedTimeMs);
    });

    it('should reduce complexity factor for ranked search with quotes', () => {
      const withQuotes = estimator.estimateMethod('ranked', '"exact phrase"', 100);
      const withoutQuotes = estimator.estimateMethod('ranked', 'exact phrase', 100);

      expect(withQuotes.estimatedTimeMs).toBeLessThan(withoutQuotes.estimatedTimeMs);
    });
  });

  describe('custom options', () => {
    it('should accept custom time per entity options', () => {
      const customEstimator = new QueryCostEstimator({
        basicTimePerEntity: 0.1,
        rankedTimePerEntity: 0.5,
      });

      const defaultBasic = estimator.estimateMethod('basic', 'test', 100);
      const customBasic = customEstimator.estimateMethod('basic', 'test', 100);

      // Custom should be 10x slower
      expect(customBasic.estimatedTimeMs).toBeGreaterThan(defaultBasic.estimatedTimeMs);
    });

    it('should accept custom complexity thresholds', () => {
      const customEstimator = new QueryCostEstimator({
        lowComplexityThreshold: 50,
        highComplexityThreshold: 200,
      });

      // 100 entities should be medium with custom thresholds
      const estimate = customEstimator.estimateMethod('basic', 'test', 100);
      expect(estimate.complexity).toBe('medium');

      // 100 entities should be low with default thresholds
      const defaultEstimate = estimator.estimateMethod('basic', 'test', 100);
      expect(defaultEstimate.complexity).toBe('low');
    });
  });

  describe('recommendations include graph size context', () => {
    it('should warn about slow performance for semantic on large graphs', () => {
      const estimate = estimator.estimateMethod('semantic', 'test', 2000);
      expect(estimate.recommendation).toContain('may be slow');
    });

    it('should mention fast performance for small graphs', () => {
      const estimate = estimator.estimateMethod('basic', 'test', 50);
      expect(estimate.recommendation).toContain('fast');
    });
  });

  // ==================== Phase 12 Sprint 4: New Tests ====================

  describe('Phase 12 Sprint 4: adaptive depth calculation', () => {
    it('should calculate adaptive depth for simple queries', () => {
      const depth = estimator.calculateAdaptiveDepth('Find Alice');
      expect(depth).toBeGreaterThanOrEqual(10);
      expect(depth).toBeLessThanOrEqual(100);
    });

    it('should increase depth for complex queries', () => {
      const simpleDepth = estimator.calculateAdaptiveDepth('Find Alice');
      const complexDepth = estimator.calculateAdaptiveDepth(
        'Find Alice and Bob, then show their projects and related tasks'
      );

      expect(complexDepth).toBeGreaterThan(simpleDepth);
    });

    it('should use analysis for more accurate depth', () => {
      const analyzer = new QueryAnalyzer();
      const analysis = analyzer.analyze('What happened last month?');

      const depthWithAnalysis = estimator.calculateAdaptiveDepth(
        'What happened last month?',
        analysis
      );
      const depthWithoutAnalysis = estimator.calculateAdaptiveDepth(
        'What happened last month?'
      );

      // Should be similar but potentially different due to analysis info
      expect(depthWithAnalysis).toBeGreaterThanOrEqual(10);
      expect(depthWithoutAnalysis).toBeGreaterThanOrEqual(10);
    });

    it('should respect max depth cap', () => {
      // Create estimator with low max depth
      const limitedEstimator = new QueryCostEstimator(undefined, { maxDepth: 15 });
      const depth = limitedEstimator.calculateAdaptiveDepth(
        'Very complex query with lots of words and operators AND clauses'
      );
      expect(depth).toBeLessThanOrEqual(15);
    });

    it('should increase depth with higher delta', () => {
      const normalEstimator = new QueryCostEstimator(undefined, { delta: 0.5 });
      const highDeltaEstimator = new QueryCostEstimator(undefined, { delta: 1.0 });

      const normalDepth = normalEstimator.calculateAdaptiveDepth('test query');
      const highDeltaDepth = highDeltaEstimator.calculateAdaptiveDepth('test query');

      expect(highDeltaDepth).toBeGreaterThanOrEqual(normalDepth);
    });

    it('should handle analysis with sub-queries', () => {
      const analysis: QueryAnalysis = {
        query: 'Find Alice and then show projects',
        entities: [],
        persons: ['Alice'],
        locations: [],
        organizations: [],
        temporalRange: null,
        questionType: 'factual',
        complexity: 'medium',
        confidence: 0.7,
        requiredInfoTypes: ['person', 'entity'],
        subQueries: ['Find Alice', 'show projects'],
      };

      const depth = estimator.calculateAdaptiveDepth('Find Alice and then show projects', analysis);
      expect(depth).toBeGreaterThan(10); // Increased due to sub-queries
    });
  });

  describe('Phase 12 Sprint 4: token estimation', () => {
    it('should estimate tokens for a query', () => {
      const tokens = estimator.estimateTokens('test query', 100);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate more tokens for longer queries', () => {
      const shortTokens = estimator.estimateTokens('test', 100);
      const longTokens = estimator.estimateTokens(
        'This is a much longer query with many more words',
        100
      );
      expect(longTokens).toBeGreaterThan(shortTokens);
    });

    it('should estimate more tokens for more expected results', () => {
      const fewResults = estimator.estimateTokens('test', 100, 5);
      const manyResults = estimator.estimateTokens('test', 100, 50);
      expect(manyResults).toBeGreaterThan(fewResults);
    });

    it('should include entity count overhead', () => {
      const smallGraph = estimator.estimateTokens('test', 10);
      const largeGraph = estimator.estimateTokens('test', 10000);
      expect(largeGraph).toBeGreaterThan(smallGraph);
    });
  });

  describe('Phase 12 Sprint 4: layer recommendations', () => {
    it('should recommend layers for a query', () => {
      const layers = estimator.recommendLayers('Find Alice');
      expect(layers.length).toBeGreaterThan(0);
      expect(layers.length).toBeLessThanOrEqual(3);
    });

    it('should include all three layers when semantic is available', () => {
      const layers = estimator.recommendLayers('Find Alice', { semanticAvailable: true });
      expect(layers).toContain('lexical');
      expect(layers).toContain('symbolic');
      expect(layers).toContain('semantic');
    });

    it('should exclude semantic when not available', () => {
      const layers = estimator.recommendLayers('Find Alice', { semanticAvailable: false });
      expect(layers).not.toContain('semantic');
      expect(layers).toContain('lexical');
      expect(layers).toContain('symbolic');
    });

    it('should prefer symbolic for temporal queries', () => {
      const analyzer = new QueryAnalyzer();
      const analysis = analyzer.analyze('What happened last month?');

      const layers = estimator.recommendLayers('What happened last month?', { analysis });
      // Symbolic should be among the top recommendations for temporal queries
      // The exact order may vary based on other factors
      expect(layers).toContain('symbolic');
    });

    it('should prefer semantic for conceptual queries', () => {
      const analyzer = new QueryAnalyzer();
      const analysis = analyzer.analyze('Explain why the project failed');

      const layers = estimator.recommendLayers('Explain why the project failed', {
        analysis,
        semanticAvailable: true,
      });

      // Semantic should be high priority for conceptual questions
      expect(layers).toContain('semantic');
    });

    it('should respect maxLayers option', () => {
      const layers = estimator.recommendLayers('test', { maxLayers: 2 });
      expect(layers.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Phase 12 Sprint 4: extended cost estimation', () => {
    it('should return extended estimate with all fields', () => {
      const extended = estimator.estimateExtended('ranked', 'Find Alice', 100);

      expect(extended.recommendedLayers).toBeDefined();
      expect(extended.estimatedTokens).toBeDefined();
      expect(extended.adaptiveDepth).toBeDefined();
      expect(extended.layerCosts).toBeDefined();

      // Should include base estimate fields
      expect(extended.method).toBe('ranked');
      expect(extended.entityCount).toBe(100);
    });

    it('should calculate layer costs', () => {
      const extended = estimator.estimateExtended('ranked', 'Find Alice', 1000);

      expect(extended.layerCosts.semantic).toBeGreaterThan(0);
      expect(extended.layerCosts.lexical).toBeGreaterThan(0);
      expect(extended.layerCosts.symbolic).toBeGreaterThan(0);

      // Symbolic should be cheapest
      expect(extended.layerCosts.symbolic).toBeLessThan(extended.layerCosts.semantic);
    });

    it('should use analysis for extended estimate', () => {
      const analyzer = new QueryAnalyzer();
      const analysis = analyzer.analyze('What projects did Alice work on?');

      const extended = estimator.estimateExtended('ranked', 'What projects did Alice work on?', 100, analysis);

      expect(extended.recommendedLayers.length).toBeGreaterThan(0);
      expect(extended.adaptiveDepth).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Phase 12 Sprint 4: layers by cost', () => {
    it('should return layers sorted by cost', () => {
      const layers = estimator.getLayersByCost('test', 100);

      expect(layers.length).toBeGreaterThan(0);

      // Should be sorted by estimatedMs ascending
      for (let i = 1; i < layers.length; i++) {
        expect(layers[i].estimatedMs).toBeGreaterThanOrEqual(layers[i - 1].estimatedMs);
      }
    });

    it('should have symbolic as cheapest for small queries', () => {
      const layers = estimator.getLayersByCost('test', 100);
      expect(layers[0].layer).toBe('symbolic');
    });

    it('should exclude semantic when not available', () => {
      const layers = estimator.getLayersByCost('test', 100, false);
      expect(layers.every(l => l.layer !== 'semantic')).toBe(true);
    });

    it('should scale costs with entity count', () => {
      const smallGraph = estimator.getLayersByCost('test', 100);
      const largeGraph = estimator.getLayersByCost('test', 10000);

      // Find semantic layer in both
      const smallSemantic = smallGraph.find(l => l.layer === 'semantic');
      const largeSemantic = largeGraph.find(l => l.layer === 'semantic');

      if (smallSemantic && largeSemantic) {
        expect(largeSemantic.estimatedMs).toBeGreaterThan(smallSemantic.estimatedMs);
      }
    });
  });

  describe('Phase 12 Sprint 4: custom configuration', () => {
    it('should accept custom adaptive depth config', () => {
      const customEstimator = new QueryCostEstimator(undefined, {
        kBase: 20,
        delta: 1.0,
      });

      const depth = customEstimator.calculateAdaptiveDepth('simple test');
      expect(depth).toBeGreaterThanOrEqual(20);
    });

    it('should accept custom token estimation config', () => {
      const customEstimator = new QueryCostEstimator(undefined, undefined, {
        charsPerToken: 2, // Smaller = more tokens
      });

      const defaultTokens = estimator.estimateTokens('test query', 100);
      const customTokens = customEstimator.estimateTokens('test query', 100);

      expect(customTokens).toBeGreaterThan(defaultTokens);
    });
  });
});
