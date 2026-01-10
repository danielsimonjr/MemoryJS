/**
 * HybridScorer Unit Tests
 *
 * Phase 12 Sprint 3: Search Algorithm Optimization
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HybridScorer,
  DEFAULT_SCORER_WEIGHTS,
  type SemanticSearchResult,
  type LexicalSearchResult,
  type SymbolicSearchResult,
} from '../../../src/search/HybridScorer.js';
import type { Entity } from '../../../src/types/index.js';

describe('HybridScorer', () => {
  let scorer: HybridScorer;
  let entityMap: Map<string, Entity>;

  const createEntity = (name: string): Entity => ({
    name,
    entityType: 'test',
    observations: [`Observation for ${name}`],
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  });

  beforeEach(() => {
    scorer = new HybridScorer();
    entityMap = new Map([
      ['entity1', createEntity('entity1')],
      ['entity2', createEntity('entity2')],
      ['entity3', createEntity('entity3')],
      ['entity4', createEntity('entity4')],
    ]);
  });

  describe('Configuration', () => {
    it('should use default weights', () => {
      const weights = scorer.getWeights();
      expect(weights.semantic).toBe(DEFAULT_SCORER_WEIGHTS.semantic);
      expect(weights.lexical).toBe(DEFAULT_SCORER_WEIGHTS.lexical);
      expect(weights.symbolic).toBe(DEFAULT_SCORER_WEIGHTS.symbolic);
    });

    it('should accept custom weights in constructor', () => {
      const customScorer = new HybridScorer({
        weights: { semantic: 0.5, lexical: 0.3, symbolic: 0.2 },
      });
      const weights = customScorer.getWeights();
      expect(weights.semantic).toBe(0.5);
      expect(weights.lexical).toBe(0.3);
      expect(weights.symbolic).toBe(0.2);
    });

    it('should update weights with setWeights', () => {
      scorer.setWeights({ semantic: 0.6 });
      const weights = scorer.getWeights();
      expect(weights.semantic).toBe(0.6);
      expect(weights.lexical).toBe(DEFAULT_SCORER_WEIGHTS.lexical);
    });

    it('should accept minimum score threshold', () => {
      const thresholdScorer = new HybridScorer({ minScore: 0.5 });
      // With multiple results, min-max normalization will spread scores
      // If we have scores [0.1, 0.9], they normalize to [0, 1]
      // With semantic weight 0.4, combined scores would be [0, 0.4]
      // Both would be below 0.5 threshold
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'entity1', similarity: 0.1 },
        { entityName: 'entity2', similarity: 0.9 },
      ];

      const results = thresholdScorer.combine(
        semanticResults,
        [],
        [],
        entityMap
      );

      // With only semantic layer active (weight redistributed to 1.0),
      // entity1 normalizes to 0, entity2 normalizes to 1
      // Only entity2 should pass the 0.5 threshold
      expect(results).toHaveLength(1);
      expect(results[0].entityName).toBe('entity2');
    });
  });

  describe('Min-Max Normalization', () => {
    it('should normalize scores to 0-1 range', () => {
      const scores = new Map([
        ['entity1', 10],
        ['entity2', 50],
        ['entity3', 100],
      ]);

      const normalized = scorer.minMaxNormalize(scores);

      expect(normalized.get('entity1')).toBe(0);
      expect(normalized.get('entity2')).toBe((50 - 10) / (100 - 10));
      expect(normalized.get('entity3')).toBe(1);
    });

    it('should handle all same scores', () => {
      const scores = new Map([
        ['entity1', 50],
        ['entity2', 50],
        ['entity3', 50],
      ]);

      const normalized = scorer.minMaxNormalize(scores);

      // All non-zero same scores should normalize to 1
      expect(normalized.get('entity1')).toBe(1);
      expect(normalized.get('entity2')).toBe(1);
      expect(normalized.get('entity3')).toBe(1);
    });

    it('should handle all zero scores', () => {
      const scores = new Map([
        ['entity1', 0],
        ['entity2', 0],
      ]);

      const normalized = scorer.minMaxNormalize(scores);

      expect(normalized.get('entity1')).toBe(0);
      expect(normalized.get('entity2')).toBe(0);
    });

    it('should handle empty scores', () => {
      const scores = new Map<string, number>();
      const normalized = scorer.minMaxNormalize(scores);
      expect(normalized.size).toBe(0);
    });
  });

  describe('Score Combination', () => {
    it('should combine results from all three layers', () => {
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'entity1', similarity: 0.9 },
        { entityName: 'entity2', similarity: 0.7 },
      ];

      const lexicalResults: LexicalSearchResult[] = [
        { entityName: 'entity1', score: 10 },
        { entityName: 'entity3', score: 15 },
      ];

      const symbolicResults: SymbolicSearchResult[] = [
        { entityName: 'entity1', score: 1.0 },
        { entityName: 'entity4', score: 0.5 },
      ];

      const results = scorer.combine(
        semanticResults,
        lexicalResults,
        symbolicResults,
        entityMap
      );

      // entity1 should be in results (appears in all layers)
      const entity1Result = results.find(r => r.entityName === 'entity1');
      expect(entity1Result).toBeDefined();
      expect(entity1Result!.matchedLayers).toContain('semantic');
      expect(entity1Result!.matchedLayers).toContain('lexical');
      expect(entity1Result!.matchedLayers).toContain('symbolic');
    });

    it('should sort results by combined score descending', () => {
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'entity1', similarity: 0.5 },
        { entityName: 'entity2', similarity: 0.9 },
      ];

      const results = scorer.combine(
        semanticResults,
        [],
        [],
        entityMap
      );

      // Higher score should be first
      expect(results[0].entityName).toBe('entity2');
    });

    it('should track matched layers correctly', () => {
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'entity1', similarity: 0.8 },
      ];

      const lexicalResults: LexicalSearchResult[] = [
        { entityName: 'entity2', score: 5 },
      ];

      const results = scorer.combine(
        semanticResults,
        lexicalResults,
        [],
        entityMap
      );

      const entity1 = results.find(r => r.entityName === 'entity1');
      const entity2 = results.find(r => r.entityName === 'entity2');

      expect(entity1!.matchedLayers).toEqual(['semantic']);
      expect(entity2!.matchedLayers).toEqual(['lexical']);
    });

    it('should include raw scores in results', () => {
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'entity1', similarity: 0.85 },
      ];

      const results = scorer.combine(
        semanticResults,
        [],
        [],
        entityMap
      );

      expect(results[0].rawScores.semantic).toBe(0.85);
    });

    it('should exclude entities not in entityMap', () => {
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'unknown_entity', similarity: 0.9 },
      ];

      const results = scorer.combine(
        semanticResults,
        [],
        [],
        entityMap
      );

      expect(results).toHaveLength(0);
    });
  });

  describe('Weight Normalization', () => {
    it('should normalize weights when layers are missing', () => {
      const weights = scorer.getNormalizedWeights(true, false, false);

      // Only semantic active, should be 1.0
      expect(weights.semantic).toBe(1);
      expect(weights.lexical).toBe(0);
      expect(weights.symbolic).toBe(0);
    });

    it('should redistribute weights across active layers', () => {
      const weights = scorer.getNormalizedWeights(true, true, false);

      // Semantic (0.4) + Lexical (0.4) = 0.8 total
      // Normalized: semantic = 0.4/0.8 = 0.5, lexical = 0.4/0.8 = 0.5
      expect(weights.semantic).toBe(0.5);
      expect(weights.lexical).toBe(0.5);
      expect(weights.symbolic).toBe(0);
    });

    it('should return zero weights when no layers active', () => {
      const weights = scorer.getNormalizedWeights(false, false, false);

      expect(weights.semantic).toBe(0);
      expect(weights.lexical).toBe(0);
      expect(weights.symbolic).toBe(0);
    });
  });

  describe('Alternative Interfaces', () => {
    it('should combine from maps', () => {
      const semanticScores = new Map([['entity1', 0.8]]);
      const lexicalScores = new Map([['entity1', 10]]);
      const symbolicScores = new Map([['entity1', 0.9]]);

      const results = scorer.combineFromMaps(
        semanticScores,
        lexicalScores,
        symbolicScores,
        entityMap
      );

      expect(results).toHaveLength(1);
      expect(results[0].entityName).toBe('entity1');
      expect(results[0].matchedLayers).toHaveLength(3);
    });

    it('should calculate single score', () => {
      const score = scorer.calculateScore(0.8, 0.6, 0.4);

      // 0.8 * 0.4 + 0.6 * 0.4 + 0.4 * 0.2 = 0.32 + 0.24 + 0.08 = 0.64
      expect(score).toBeCloseTo(0.64);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty results from all layers', () => {
      const results = scorer.combine([], [], [], entityMap);
      expect(results).toHaveLength(0);
    });

    it('should handle single result', () => {
      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'entity1', similarity: 1.0 },
      ];

      const results = scorer.combine(semanticResults, [], [], entityMap);

      expect(results).toHaveLength(1);
      expect(results[0].scores.semantic).toBe(1);
    });

    it('should disable weight normalization when configured', () => {
      const noNormScorer = new HybridScorer({ normalizeWeights: false });

      const semanticResults: SemanticSearchResult[] = [
        { entityName: 'entity1', similarity: 1.0 },
      ];

      const results = noNormScorer.combine(semanticResults, [], [], entityMap);

      // Without normalization, score = 1.0 * 0.4 = 0.4 (semantic weight)
      expect(results[0].scores.combined).toBeCloseTo(0.4);
    });
  });
});
