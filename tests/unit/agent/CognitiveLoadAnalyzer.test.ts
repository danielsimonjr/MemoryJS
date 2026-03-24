/**
 * CognitiveLoadAnalyzer Unit Tests
 *
 * Tests for S7 — Cognitive Load Metrics.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CognitiveLoadAnalyzer } from '../../../src/agent/CognitiveLoadAnalyzer.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';

// ==================== Helpers ====================

function makeMemory(name: string, observations: string[], overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    name,
    entityType: 'memory',
    observations,
    memoryType: 'semantic',
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
    visibility: 'private',
    ...overrides,
  } as AgentEntity;
}

/** Simple char/4 estimator matching the production default. */
function charEstimator(entity: AgentEntity): number {
  const text = [entity.name, entity.entityType, ...(entity.observations ?? [])].join(' ');
  return Math.ceil(text.length / 4);
}

/** Estimator that always returns a fixed value. */
function fixedEstimator(tokens: number) {
  return (_: AgentEntity) => tokens;
}

// ==================== Tests ====================

describe('CognitiveLoadAnalyzer', () => {
  let analyzer: CognitiveLoadAnalyzer;

  beforeEach(() => {
    analyzer = new CognitiveLoadAnalyzer();
  });

  // -------------------- computeMetrics --------------------

  describe('computeMetrics', () => {
    it('returns zero metrics for empty array', () => {
      const metrics = analyzer.computeMetrics([], charEstimator);
      expect(metrics.tokenCount).toBe(0);
      expect(metrics.tokenDensity).toBe(0);
      expect(metrics.redundancyRatio).toBe(0);
      expect(metrics.diversityScore).toBe(1);
      expect(metrics.loadScore).toBe(0);
      expect(metrics.exceedsThreshold).toBe(false);
    });

    it('returns metrics for a single memory', () => {
      const memory = makeMemory('alpha', ['unique fact about alpha']);
      const metrics = analyzer.computeMetrics([memory], charEstimator);
      expect(metrics.tokenCount).toBeGreaterThan(0);
      expect(metrics.redundancyRatio).toBe(0);
      expect(metrics.diversityScore).toBe(1);
      expect(metrics.exceedsThreshold).toBe(false);
    });

    it('computes token density correctly', () => {
      // With maxTokensForDensity=8000 and 8000 tokens the density should be 1
      const memory = makeMemory('x', ['y']);
      const metrics = analyzer.computeMetrics([memory], fixedEstimator(8000));
      expect(metrics.tokenDensity).toBe(1);
      expect(metrics.tokenCount).toBe(8000);
    });

    it('clamps token density at 1 when tokens exceed max', () => {
      const memory = makeMemory('x', ['y']);
      const metrics = analyzer.computeMetrics([memory], fixedEstimator(20000));
      expect(metrics.tokenDensity).toBe(1);
    });

    it('detects high redundancy for near-identical memories', () => {
      // Use a lower redundancyThreshold so token overlap from shared observations registers
      const strictAnalyzer = new CognitiveLoadAnalyzer({ redundancyThreshold: 0.5 });
      const obs = ['The user prefers dark mode in all applications'];
      const a = makeMemory('mem_a', obs);
      const b = makeMemory('mem_b', obs); // same observations, slightly different names
      const metrics = strictAnalyzer.computeMetrics([a, b], charEstimator);
      // Observations share many tokens → Jaccard well above 0.5
      expect(metrics.redundancyRatio).toBeGreaterThan(0);
      expect(metrics.diversityScore).toBeLessThan(1);
    });

    it('reports low redundancy for diverse memories', () => {
      const a = makeMemory('alpha', ['the quick brown fox jumped over the lazy dog']);
      const b = makeMemory('beta', ['machine learning transforms software engineering practice']);
      const c = makeMemory('gamma', ['database schemas require careful planning and review']);
      const metrics = analyzer.computeMetrics([a, b, c], charEstimator);
      expect(metrics.redundancyRatio).toBeLessThan(0.3);
      expect(metrics.diversityScore).toBeGreaterThan(0.5);
    });

    it('exceedsThreshold is true when loadScore >= threshold', () => {
      // Force a high load scenario: large tokens + redundant content
      const obs = ['identical content repeated here for high redundancy score'];
      const memories = Array.from({ length: 5 }, (_, i) => makeMemory(`m${i}`, obs));
      const customAnalyzer = new CognitiveLoadAnalyzer({
        loadThreshold: 0.1,   // very low threshold to guarantee trigger
        maxTokensForDensity: 50,
      });
      const metrics = customAnalyzer.computeMetrics(memories, charEstimator);
      expect(metrics.exceedsThreshold).toBe(true);
    });

    it('exceedsThreshold is false when loadScore < threshold', () => {
      const memory = makeMemory('solo', ['only one memory, very small']);
      const metrics = analyzer.computeMetrics([memory], charEstimator);
      expect(metrics.exceedsThreshold).toBe(false);
    });

    it('loadScore is within [0, 1]', () => {
      const obs = ['lots of content to push the score high yes indeed'];
      const memories = Array.from({ length: 10 }, (_, i) => makeMemory(`m${i}`, obs));
      const metrics = analyzer.computeMetrics(memories, fixedEstimator(1000));
      expect(metrics.loadScore).toBeGreaterThanOrEqual(0);
      expect(metrics.loadScore).toBeLessThanOrEqual(1);
    });

    it('uses custom weights from config', () => {
      // All weight goes to token density
      const a = new CognitiveLoadAnalyzer({
        tokenWeight: 1,
        redundancyWeight: 0,
        diversityWeight: 0,
        maxTokensForDensity: 100,
      });
      const m = makeMemory('x', ['y']);
      const metrics = a.computeMetrics([m], fixedEstimator(50));
      // density = 0.5, loadScore = 0.5 * 1 = 0.5
      expect(metrics.loadScore).toBeCloseTo(0.5, 3);
    });

    it('diversityScore is inverse of average pairwise similarity', () => {
      // Two completely disjoint token sets → Jaccard = 0 → diversityScore = 1
      const a = makeMemory('aaa', ['alpha beta gamma']);
      const b = makeMemory('bbb', ['delta epsilon zeta']);
      const metrics = analyzer.computeMetrics([a, b], charEstimator);
      // Names 'aaa'/'bbb' are also disjoint, so near-zero similarity
      expect(metrics.diversityScore).toBeGreaterThan(0.7);
    });
  });

  // -------------------- adaptiveReduce --------------------

  describe('adaptiveReduce', () => {
    it('returns all memories unchanged when load is below threshold', () => {
      const memories = [
        makeMemory('a', ['apple pie recipe']),
        makeMemory('b', ['database indexing strategies']),
      ];
      const result = analyzer.adaptiveReduce(memories, new Map(), charEstimator);
      expect(result.retained).toHaveLength(2);
      expect(result.removed).toHaveLength(0);
      expect(result.beforeMetrics.exceedsThreshold).toBe(false);
    });

    it('removes lowest-salience redundant memory when overloaded', () => {
      const obs = ['the same content is repeated across both memories'];
      const a = makeMemory('high_sal', obs);
      const b = makeMemory('low_sal', obs);

      const lowThresholdAnalyzer = new CognitiveLoadAnalyzer({
        loadThreshold: 0.05,
        redundancyThreshold: 0.5,
        maxTokensForDensity: 10,
      });

      const salienceScores = new Map([
        ['high_sal', 0.9],
        ['low_sal', 0.1],
      ]);

      const result = lowThresholdAnalyzer.adaptiveReduce(
        [a, b],
        salienceScores,
        charEstimator
      );

      // low_sal should be removed
      expect(result.removed.some((m) => m.name === 'low_sal')).toBe(true);
      expect(result.retained.some((m) => m.name === 'high_sal')).toBe(true);
    });

    it('after reduction, afterMetrics reflect the smaller set', () => {
      const obs = ['identical observations for testing redundancy behaviour'];
      const memories = Array.from({ length: 4 }, (_, i) =>
        makeMemory(`m${i}`, obs)
      );
      const lowThreshold = new CognitiveLoadAnalyzer({
        loadThreshold: 0.05,
        redundancyThreshold: 0.5,
        maxTokensForDensity: 10,
      });
      const salience = new Map(memories.map((m, i) => [m.name, i * 0.1]));
      const result = lowThreshold.adaptiveReduce(memories, salience, charEstimator);

      expect(result.afterMetrics.tokenCount).toBeLessThanOrEqual(
        result.beforeMetrics.tokenCount
      );
      expect(result.retained.length + result.removed.length).toBe(memories.length);
    });

    it('tracks redundantPairsFound', () => {
      const obs = ['shared content to trigger redundancy detection'];
      const a = makeMemory('x', obs);
      const b = makeMemory('y', obs);
      const lowThreshold = new CognitiveLoadAnalyzer({
        loadThreshold: 0.01,
        redundancyThreshold: 0.5,
        maxTokensForDensity: 5,
      });
      const result = lowThreshold.adaptiveReduce([a, b], new Map(), charEstimator);
      expect(result.redundantPairsFound).toBeGreaterThanOrEqual(1);
    });

    it('does not reduce below 1 memory', () => {
      const obs = ['very large content designed to exceed token budget limit'];
      const memories = [makeMemory('only', obs)];
      const aggressive = new CognitiveLoadAnalyzer({
        loadThreshold: 0,
        maxTokensForDensity: 1,
      });
      const result = aggressive.adaptiveReduce(memories, new Map(), charEstimator);
      expect(result.retained).toHaveLength(1);
      expect(result.removed).toHaveLength(0);
    });

    it('falls back to lowest-salience removal when no redundant pairs', () => {
      // Different content → no redundant pairs, but threshold is very low
      const memories = [
        makeMemory('aaa', ['apple tree grows fruit']),
        makeMemory('bbb', ['quantum computing transforms algorithms']),
        makeMemory('ccc', ['medieval history poetry and art']),
      ];
      const aggressive = new CognitiveLoadAnalyzer({
        loadThreshold: 0,
        redundancyThreshold: 0.99, // very high → no pairs detected
        maxTokensForDensity: 1,
      });
      const salience = new Map([
        ['aaa', 0.9],
        ['bbb', 0.5],
        ['ccc', 0.1], // lowest
      ]);
      const result = aggressive.adaptiveReduce(memories, salience, charEstimator);
      // ccc should be the first to go as it has the lowest salience
      expect(result.removed[0]?.name).toBe('ccc');
    });

    it('returns correct beforeMetrics', () => {
      const obs = ['same text same text same text'];
      const memories = [makeMemory('a', obs), makeMemory('b', obs)];
      const lowThreshold = new CognitiveLoadAnalyzer({ loadThreshold: 0.05 });
      const result = lowThreshold.adaptiveReduce(memories, new Map(), charEstimator);
      // beforeMetrics should reflect both memories
      expect(result.beforeMetrics.tokenCount).toBeGreaterThan(0);
    });

    it('handles empty salienceScores map (all default to 0)', () => {
      const obs = ['duplicate content here once more for testing'];
      const memories = [makeMemory('a', obs), makeMemory('b', obs)];
      const lowThreshold = new CognitiveLoadAnalyzer({
        loadThreshold: 0.01,
        redundancyThreshold: 0.5,
        maxTokensForDensity: 5,
      });
      // Should not throw
      expect(() =>
        lowThreshold.adaptiveReduce(memories, new Map(), charEstimator)
      ).not.toThrow();
    });
  });

  // -------------------- getConfig --------------------

  describe('getConfig', () => {
    it('returns defaults when no config provided', () => {
      const cfg = analyzer.getConfig();
      expect(cfg.loadThreshold).toBe(0.7);
      expect(cfg.tokenWeight).toBe(0.4);
      expect(cfg.redundancyWeight).toBe(0.35);
      expect(cfg.diversityWeight).toBe(0.25);
      expect(cfg.maxTokensForDensity).toBe(8000);
      expect(cfg.redundancyThreshold).toBe(0.85);
    });

    it('reflects custom config values', () => {
      const custom = new CognitiveLoadAnalyzer({
        loadThreshold: 0.5,
        redundancyThreshold: 0.9,
        maxTokensForDensity: 4000,
      });
      const cfg = custom.getConfig();
      expect(cfg.loadThreshold).toBe(0.5);
      expect(cfg.redundancyThreshold).toBe(0.9);
      expect(cfg.maxTokensForDensity).toBe(4000);
    });

    it('returns a copy (not the internal config object)', () => {
      const cfg1 = analyzer.getConfig();
      const cfg2 = analyzer.getConfig();
      expect(cfg1).not.toBe(cfg2);
    });
  });

  // -------------------- Jaccard internals via computeMetrics --------------------

  describe('Jaccard similarity behaviour', () => {
    it('identical memories have redundancyRatio of 1 with default threshold=0.85', () => {
      const obs = ['same words same words same words same words'];
      // Using a low threshold so identical token sets register as redundant
      const a = new CognitiveLoadAnalyzer({ redundancyThreshold: 0.5 });
      const memories = [makeMemory('x', obs), makeMemory('y', obs)];
      const metrics = a.computeMetrics(memories, charEstimator);
      expect(metrics.redundancyRatio).toBeCloseTo(1, 5);
    });

    it('completely disjoint memories have redundancyRatio of 0', () => {
      const a = makeMemory('aaa', ['alpha beta gamma delta epsilon']);
      const b = makeMemory('bbb', ['zeta eta theta iota kappa']);
      const metrics = analyzer.computeMetrics([a, b], charEstimator);
      // 'aaa'/'bbb' share no tokens with observation words
      expect(metrics.redundancyRatio).toBe(0);
    });

    it('caps token extraction at 500 tokens without throwing', () => {
      // Entity with a very large set of observations
      const bigObs = Array.from({ length: 200 }, (_, i) => `token${i} word${i} fact${i}`);
      const big = makeMemory('big', bigObs);
      const small = makeMemory('small', ['hello world']);
      expect(() => analyzer.computeMetrics([big, small], charEstimator)).not.toThrow();
    });
  });
});
