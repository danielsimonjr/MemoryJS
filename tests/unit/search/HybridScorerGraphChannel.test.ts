/**
 * HybridScorer Graph Channel Unit Tests
 *
 * Fourth `graph` scoring channel: default weight 0 preserves the legacy
 * three-layer behavior; a positive weight lets well-connected entities
 * outrank isolated ones at equal text scores.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HybridScorer,
  DEFAULT_SCORER_WEIGHTS,
  type SemanticLayerResult,
  type LexicalSearchResult,
  type GraphLayerResult,
} from '../../../src/search/HybridScorer.js';
import type { Entity } from '../../../src/types/index.js';

describe('HybridScorer graph channel', () => {
  let entityMap: Map<string, Entity>;

  const createEntity = (name: string): Entity => ({
    name,
    entityType: 'test',
    observations: [`Observation for ${name}`],
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  });

  beforeEach(() => {
    entityMap = new Map(
      ['connected', 'isolated', 'other'].map(name => [name, createEntity(name)])
    );
  });

  it('should default the graph weight to 0', () => {
    expect(DEFAULT_SCORER_WEIGHTS.graph).toBe(0);
    const scorer = new HybridScorer();
    expect(scorer.getWeights().graph).toBe(0);
  });

  it('should produce identical combined scores with graph weight 0 (default) on the same fixtures', () => {
    const scorer = new HybridScorer();

    const semanticResults: SemanticLayerResult[] = [
      { entityName: 'connected', similarity: 0.9 },
      { entityName: 'isolated', similarity: 0.7 },
    ];
    const lexicalResults: LexicalSearchResult[] = [
      { entityName: 'connected', score: 5 },
      { entityName: 'isolated', score: 10 },
    ];
    const graphResults: GraphLayerResult[] = [
      { entityName: 'connected', score: 1.0 },
      { entityName: 'isolated', score: 0.0 },
    ];

    const withoutGraph = scorer.combine(semanticResults, lexicalResults, [], entityMap);
    const withGraph = scorer.combine(
      semanticResults,
      lexicalResults,
      [],
      entityMap,
      graphResults
    );

    // A 0-weight graph layer with results must contribute exactly 0:
    // same ordering, same combined scores.
    expect(withGraph.map(r => r.entityName)).toEqual(withoutGraph.map(r => r.entityName));
    for (let i = 0; i < withoutGraph.length; i++) {
      expect(withGraph[i].scores.combined).toBeCloseTo(withoutGraph[i].scores.combined, 12);
      expect(withGraph[i].scores.semantic).toBeCloseTo(withoutGraph[i].scores.semantic, 12);
      expect(withGraph[i].scores.lexical).toBeCloseTo(withoutGraph[i].scores.lexical, 12);
    }
    // Legacy path reports graph score 0
    for (const result of withoutGraph) {
      expect(result.scores.graph).toBe(0);
    }
  });

  it('should let a well-connected entity outrank an isolated one at equal text scores', () => {
    const scorer = new HybridScorer({
      weights: { semantic: 0.4, lexical: 0.4, symbolic: 0, graph: 0.2 },
    });

    // Identical text signals for both entities
    const semanticResults: SemanticLayerResult[] = [
      { entityName: 'connected', similarity: 0.8 },
      { entityName: 'isolated', similarity: 0.8 },
    ];
    const lexicalResults: LexicalSearchResult[] = [
      { entityName: 'connected', score: 5 },
      { entityName: 'isolated', score: 5 },
    ];
    // Only the graph signal differs
    const graphResults: GraphLayerResult[] = [
      { entityName: 'connected', score: 1.0 },
      { entityName: 'isolated', score: 0.0 },
    ];

    const results = scorer.combine(
      semanticResults,
      lexicalResults,
      [],
      entityMap,
      graphResults
    );

    expect(results[0].entityName).toBe('connected');
    expect(results[0].scores.combined).toBeGreaterThan(results[1].scores.combined);
    expect(results[0].matchedLayers).toContain('graph');
    expect(results[0].scores.graph).toBe(1);
    expect(results[0].rawScores.graph).toBe(1.0);
  });

  it('should track the graph layer in matchedLayers and rawScores', () => {
    const scorer = new HybridScorer({ weights: { graph: 0.5 } });

    const graphResults: GraphLayerResult[] = [{ entityName: 'connected', score: 0.75 }];
    const results = scorer.combine([], [], [], entityMap, graphResults);

    expect(results).toHaveLength(1);
    expect(results[0].matchedLayers).toEqual(['graph']);
    expect(results[0].rawScores.graph).toBe(0.75);
  });

  it('should redistribute weights across active layers including graph', () => {
    const scorer = new HybridScorer({
      weights: { semantic: 0.4, lexical: 0.4, symbolic: 0.2, graph: 0.4 },
    });

    const weights = scorer.getNormalizedWeights(true, false, false, true);
    // semantic (0.4) + graph (0.4) = 0.8 -> 0.5 each
    expect(weights.semantic).toBeCloseTo(0.5);
    expect(weights.graph).toBeCloseTo(0.5);
    expect(weights.lexical).toBe(0);
    expect(weights.symbolic).toBe(0);

    // Legacy three-argument call still works (graph inactive by default)
    const legacy = scorer.getNormalizedWeights(true, false, false);
    expect(legacy.semantic).toBe(1);
    expect(legacy.graph).toBe(0);
  });

  it('should include the graph term in combineFromMaps and calculateScore', () => {
    const scorer = new HybridScorer({
      weights: { semantic: 0.4, lexical: 0.4, symbolic: 0.2, graph: 0.2 },
      normalizeWeights: false,
    });

    const results = scorer.combineFromMaps(
      new Map([['connected', 0.8]]),
      new Map(),
      new Map(),
      entityMap,
      new Map([['connected', 1.0]])
    );
    expect(results).toHaveLength(1);
    // semantic 0.8 (sole value -> normalizes to 1) * 0.4 + graph 1 * 0.2
    expect(results[0].scores.combined).toBeCloseTo(0.4 + 0.2);

    // calculateScore: 0.8*0.4 + 0.6*0.4 + 0.4*0.2 + 1.0*0.2 = 0.84
    expect(scorer.calculateScore(0.8, 0.6, 0.4, 1.0)).toBeCloseTo(0.84);
    // Omitted graph score defaults to 0 (legacy behavior)
    expect(scorer.calculateScore(0.8, 0.6, 0.4)).toBeCloseTo(0.64);
  });
});
