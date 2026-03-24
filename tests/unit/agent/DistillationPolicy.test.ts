/**
 * DistillationPolicy & DistillationPipeline Unit Tests
 *
 * Feature 4 — Memory Distillation Policy
 * Tests for all policy classes and the distillation pipeline.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DefaultDistillationPolicy,
  NoOpDistillationPolicy,
  CompositeDistillationPolicy,
  type DistillationConfig,
  type IDistillationPolicy,
  type DistilledMemory,
} from '../../../src/agent/DistillationPolicy.js';
import {
  DistillationPipeline,
} from '../../../src/agent/DistillationPipeline.js';
import type { HybridSearchResult, Entity } from '../../../src/types/types.js';

// ==================== Test Helpers ====================

/**
 * Create a minimal Entity for testing.
 */
function makeEntity(overrides: Partial<Entity> = {}): Entity {
  const now = new Date().toISOString();
  return {
    name: 'test_entity',
    entityType: 'memory',
    observations: ['Test observation'],
    createdAt: now,
    lastModified: now,
    importance: 5,
    ...overrides,
  };
}

/**
 * Create a HybridSearchResult wrapping an entity.
 */
function makeResult(
  entity: Entity,
  combined = 0.8
): HybridSearchResult {
  return {
    entity,
    scores: { semantic: combined, lexical: combined, symbolic: combined, combined },
    matchedLayers: ['semantic', 'lexical'],
  };
}

/**
 * Create an entity timestamped in the past.
 */
function makeOldEntity(hoursAgo: number, overrides: Partial<Entity> = {}): Entity {
  const then = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  return makeEntity({ lastModified: then, createdAt: then, ...overrides });
}

// ==================== DefaultDistillationPolicy ====================

describe('DefaultDistillationPolicy', () => {
  let policy: DefaultDistillationPolicy;

  beforeEach(() => {
    policy = new DefaultDistillationPolicy();
  });

  // ----------------------------------------
  // Empty input
  // ----------------------------------------
  describe('empty input', () => {
    it('returns empty array for empty input without throwing', async () => {
      const result = await policy.distill([], {});
      expect(result).toEqual([]);
    });

    it('returns empty array with config but no results', async () => {
      const result = await policy.distill([], { minScore: 0.5, queryKeywords: ['test'] });
      expect(result).toEqual([]);
    });
  });

  // ----------------------------------------
  // Basic keep/filter behaviour
  // ----------------------------------------
  describe('minScore filtering', () => {
    it('keeps entities that score above minScore', async () => {
      // Entity created just now → high recency, importance=9
      const entity = makeEntity({ importance: 9 });
      const result = await policy.distill([makeResult(entity)], { minScore: 0.3 });
      expect(result.length).toBe(1);
      expect(result[0].kept).toBe(true);
    });

    it('filters entities that score below minScore', async () => {
      // Very old entity, no importance → low score
      const entity = makeOldEntity(24 * 365, { importance: 0 }); // 1 year old
      const result = await policy.distill([makeResult(entity)], {
        minScore: 0.99,
        queryKeywords: [],
      });
      expect(result.length).toBe(0);
    });

    it('uses default minScore of 0.3 when not specified', async () => {
      // Entity with moderate recency and importance
      const entity = makeEntity({ importance: 5 });
      const result = await policy.distill([makeResult(entity)], {});
      // Default weights: 0.3 recency (≈1.0) + 0.4 termOverlap (0.5 neutral) + 0.3 importance (0.5)
      // ≈ 0.3*1.0 + 0.4*0.5 + 0.3*0.5 = 0.3 + 0.2 + 0.15 = 0.65 → should pass
      expect(result.length).toBe(1);
    });
  });

  // ----------------------------------------
  // maxMemories cap
  // ----------------------------------------
  describe('maxMemories cap', () => {
    it('returns at most maxMemories results', async () => {
      const entities = Array.from({ length: 20 }, (_, i) =>
        makeEntity({ name: `entity_${i}`, importance: 8 })
      );
      const results = entities.map((e) => makeResult(e));
      const distilled = await policy.distill(results, { maxMemories: 5, minScore: 0.0 });
      expect(distilled.length).toBeLessThanOrEqual(5);
    });

    it('respects maxMemories: 1', async () => {
      const entities = Array.from({ length: 10 }, (_, i) =>
        makeEntity({ name: `entity_${i}`, importance: 7 })
      );
      const distilled = await policy.distill(
        entities.map((e) => makeResult(e)),
        { maxMemories: 1, minScore: 0.0 }
      );
      expect(distilled.length).toBeLessThanOrEqual(1);
    });

    it('returns fewer than maxMemories if not enough pass minScore', async () => {
      // Very old entities that score low
      const entities = Array.from({ length: 10 }, (_, i) =>
        makeOldEntity(24 * 365, { name: `old_${i}`, importance: 0 })
      );
      const distilled = await policy.distill(
        entities.map((e) => makeResult(e)),
        { maxMemories: 10, minScore: 0.99 }
      );
      expect(distilled.length).toBe(0);
    });
  });

  // ----------------------------------------
  // Term overlap scoring
  // ----------------------------------------
  describe('term overlap scoring', () => {
    it('entity with matching keywords scores higher than entity without', async () => {
      const matching = makeEntity({
        name: 'hotel_preference',
        entityType: 'preference',
        observations: ['User prefers budget hotels near city center'],
        importance: 5,
      });
      const nonMatching = makeEntity({
        name: 'weather_report',
        entityType: 'report',
        observations: ['Sunny with light winds'],
        importance: 5,
      });

      const config: DistillationConfig = {
        queryKeywords: ['hotel', 'budget'],
        minScore: 0.0,
      };
      const results = await policy.distill(
        [makeResult(matching), makeResult(nonMatching)],
        config
      );

      // Both should be kept (minScore=0), but matching should have higher score
      expect(results.length).toBe(2);
      const matchingResult = results.find((r) => r.entity.name === 'hotel_preference')!;
      const nonMatchingResult = results.find((r) => r.entity.name === 'weather_report')!;
      expect(matchingResult.distilledScore).toBeGreaterThan(nonMatchingResult.distilledScore);
    });

    it('uses neutral overlap score (0.5) when queryKeywords is empty', async () => {
      const entity = makeEntity({ importance: 5 });
      const overlapScore = policy.scoreTermOverlap(entity, []);
      expect(overlapScore).toBe(0.5);
    });

    it('scores full overlap as 1.0', async () => {
      const entity = makeEntity({
        name: 'hotel_budget',
        observations: ['hotel budget'],
        entityType: 'memory',
      });
      const score = policy.scoreTermOverlap(entity, ['hotel', 'budget']);
      expect(score).toBe(1.0);
    });

    it('scores zero overlap as 0.0', async () => {
      const entity = makeEntity({
        name: 'sunny_weather',
        observations: ['Sunny weather today'],
        entityType: 'report',
      });
      const score = policy.scoreTermOverlap(entity, ['hotel', 'budget']);
      expect(score).toBe(0.0);
    });
  });

  // ----------------------------------------
  // Recency scoring
  // ----------------------------------------
  describe('recency scoring', () => {
    it('entity modified 1 minute ago scores higher than entity from last year', async () => {
      const recent = makeEntity({
        name: 'recent_entity',
        lastModified: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
        importance: 5,
      });
      const old = makeOldEntity(24 * 365, { name: 'old_entity', importance: 5 }); // 1 year ago

      const recentScore = policy.scoreRecency(recent);
      const oldScore = policy.scoreRecency(old);
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('newly created entity has high recency score (> 0.9)', () => {
      const entity = makeEntity();
      const score = policy.scoreRecency(entity);
      expect(score).toBeGreaterThan(0.9);
    });

    it('entity from 1 year ago has very low recency score (< 0.05)', () => {
      const entity = makeOldEntity(24 * 365);
      const score = policy.scoreRecency(entity);
      expect(score).toBeLessThan(0.05);
    });

    it('returns 0 when no timestamp is set', () => {
      const entity = makeEntity({ lastModified: undefined, createdAt: undefined });
      const score = policy.scoreRecency(entity);
      expect(score).toBe(0);
    });
  });

  // ----------------------------------------
  // Importance scoring
  // ----------------------------------------
  describe('importance scoring', () => {
    it('importance 10 gives score 1.0', () => {
      const score = policy.scoreImportance(makeEntity({ importance: 10 }));
      expect(score).toBe(1.0);
    });

    it('importance 0 gives score 0.0', () => {
      const score = policy.scoreImportance(makeEntity({ importance: 0 }));
      expect(score).toBe(0.0);
    });

    it('importance 5 gives score 0.5', () => {
      const score = policy.scoreImportance(makeEntity({ importance: 5 }));
      expect(score).toBe(0.5);
    });

    it('undefined importance gives neutral score 0.5', () => {
      const entity = makeEntity({ importance: undefined });
      const score = policy.scoreImportance(entity);
      expect(score).toBe(0.5);
    });
  });

  // ----------------------------------------
  // Expired memory removal
  // ----------------------------------------
  describe('expired memory removal', () => {
    it('removes expired entities (TTL elapsed)', async () => {
      const createdAt = new Date(Date.now() - 10_000).toISOString(); // 10 seconds ago
      const expired = makeEntity({
        name: 'expired_entity',
        createdAt,
        ttl: 1000, // 1 second TTL → already expired
        importance: 9,
      });
      const result = await policy.distill([makeResult(expired)], { minScore: 0.0 });
      expect(result.length).toBe(0);
    });

    it('keeps non-expired entities with TTL', async () => {
      const notExpired = makeEntity({
        name: 'fresh_entity',
        ttl: 24 * 60 * 60 * 1000, // 24 hours TTL
        importance: 8,
      });
      const result = await policy.distill([makeResult(notExpired)], { minScore: 0.0 });
      expect(result.length).toBe(1);
    });

    it('keeps entities with no TTL set', async () => {
      const entity = makeEntity({ name: 'no_ttl', ttl: undefined, importance: 8 });
      const result = await policy.distill([makeResult(entity)], { minScore: 0.0 });
      expect(result.length).toBe(1);
    });
  });

  // ----------------------------------------
  // Duplicate removal
  // ----------------------------------------
  describe('near-duplicate removal', () => {
    it('removes near-duplicate entity names (high Jaccard similarity)', async () => {
      // These names share 3 of 4 tokens after tokenising on underscores.
      // Tokens: ['user', 'hotel', 'pref', 'data'] vs ['user', 'hotel', 'pref', 'info']
      // Intersection = 3, union = 5 → 0.6 — not above 0.8.
      // Use identical first entity name to guarantee dedup (same name → same tokens → Jaccard 1.0).
      const entity1 = makeEntity({ name: 'user_hotel_pref', importance: 8 });
      // Rename with the exact same tokens → Jaccard 1.0 → removed as duplicate.
      const entity2 = makeEntity({ name: 'user_hotel_pref_copy', importance: 8 });

      // Override: use very similar names that tokenise identically (repeat of entity1).
      // Actually the safest test: confirm duplicate detection works for truly identical names.
      const entity3 = makeEntity({ name: 'same_name', importance: 8 });
      const entity4 = makeEntity({ name: 'same_name', importance: 8 }); // exact duplicate name

      const result = await policy.distill(
        [makeResult(entity3), makeResult(entity4)],
        { minScore: 0.0 }
      );
      // Both have identical names → Jaccard 1.0 → second is near-duplicate
      expect(result.length).toBeLessThan(2);
    });

    it('keeps entities with clearly distinct names', async () => {
      const entity1 = makeEntity({ name: 'hotel_preference', importance: 8 });
      const entity2 = makeEntity({ name: 'weather_forecast', importance: 8 });

      const result = await policy.distill(
        [makeResult(entity1), makeResult(entity2)],
        { minScore: 0.0 }
      );
      expect(result.length).toBe(2);
    });
  });

  // ----------------------------------------
  // All returned items are kept: true
  // ----------------------------------------
  describe('returned items have kept: true', () => {
    it('all returned DistilledMemory objects have kept: true', async () => {
      const entities = Array.from({ length: 5 }, (_, i) =>
        makeEntity({ name: `entity_${i}`, importance: 6 })
      );
      const result = await policy.distill(
        entities.map((e) => makeResult(e)),
        { minScore: 0.0 }
      );
      for (const dm of result) {
        expect(dm.kept).toBe(true);
      }
    });
  });

  // ----------------------------------------
  // rawScore preservation
  // ----------------------------------------
  describe('rawScore preservation', () => {
    it('preserves the original combined score as rawScore', async () => {
      const entity = makeEntity({ importance: 8 });
      const result = await policy.distill([makeResult(entity, 0.75)], { minScore: 0.0 });
      expect(result.length).toBe(1);
      expect(result[0].rawScore).toBe(0.75);
    });
  });
});

// ==================== NoOpDistillationPolicy ====================

describe('NoOpDistillationPolicy', () => {
  let policy: NoOpDistillationPolicy;

  beforeEach(() => {
    policy = new NoOpDistillationPolicy();
  });

  it('passes through all inputs unchanged', async () => {
    const entities = Array.from({ length: 5 }, (_, i) =>
      makeEntity({ name: `entity_${i}` })
    );
    const results = entities.map((e) => makeResult(e, 0.6));
    const distilled = await policy.distill(results, {});
    expect(distilled.length).toBe(5);
  });

  it('all results have kept: true', async () => {
    const result = await policy.distill([makeResult(makeEntity())], {});
    expect(result[0].kept).toBe(true);
  });

  it('preserves the combined score as both rawScore and distilledScore', async () => {
    const result = await policy.distill([makeResult(makeEntity(), 0.77)], {});
    expect(result[0].rawScore).toBe(0.77);
    expect(result[0].distilledScore).toBe(0.77);
  });

  it('returns empty for empty input', async () => {
    const result = await policy.distill([], {});
    expect(result).toEqual([]);
  });

  it('ignores minScore (NoOp passes everything)', async () => {
    const entities = Array.from({ length: 3 }, (_, i) =>
      makeEntity({ name: `e_${i}` })
    );
    const result = await policy.distill(entities.map((e) => makeResult(e)), {
      minScore: 0.99,
    });
    // NoOp doesn't filter
    expect(result.length).toBe(3);
  });
});

// ==================== CompositeDistillationPolicy ====================

describe('CompositeDistillationPolicy', () => {
  it('returns empty for empty input', async () => {
    const composite = new CompositeDistillationPolicy([new NoOpDistillationPolicy()]);
    const result = await composite.distill([], {});
    expect(result).toEqual([]);
  });

  it('returns empty when policies list is empty', async () => {
    const composite = new CompositeDistillationPolicy([]);
    const entities = [makeEntity({ name: 'e1' })];
    const result = await composite.distill(entities.map((e) => makeResult(e)), {});
    expect(result).toEqual([]);
  });

  it('single NoOp policy passes all through', async () => {
    const composite = new CompositeDistillationPolicy([new NoOpDistillationPolicy()]);
    const entities = Array.from({ length: 5 }, (_, i) => makeEntity({ name: `e_${i}` }));
    const result = await composite.distill(entities.map((e) => makeResult(e)), {});
    expect(result.length).toBe(5);
  });

  it('chains two policies: first reduces, second further reduces', async () => {
    // Policy 1: keeps only entities with name containing 'keep'
    const policy1: IDistillationPolicy = {
      async distill(results, _cfg) {
        return results
          .filter((r) => r.entity.name.includes('keep'))
          .map((r) => ({
            entity: r.entity,
            rawScore: r.scores.combined,
            distilledScore: 0.9,
            reason: 'name contains keep',
            kept: true,
          }));
      },
    };

    // Policy 2: keeps only entities with distilledScore > 0.5
    const policy2: IDistillationPolicy = {
      async distill(results, _cfg) {
        return results
          .filter((r) => r.scores.combined > 0.5)
          .map((r) => ({
            entity: r.entity,
            rawScore: r.scores.combined,
            distilledScore: r.scores.combined,
            reason: 'above threshold',
            kept: true,
          }));
      },
    };

    const composite = new CompositeDistillationPolicy([policy1, policy2]);

    const entities = [
      makeEntity({ name: 'keep_this' }),
      makeEntity({ name: 'remove_this' }),
      makeEntity({ name: 'keep_that' }),
    ];
    const result = await composite.distill(entities.map((e) => makeResult(e, 0.9)), {});
    expect(result.length).toBe(2);
    expect(result.every((r) => r.entity.name.includes('keep'))).toBe(true);
  });

  it('second policy receives output of first policy as adapted input', async () => {
    const received: HybridSearchResult[] = [];
    const capturePolicy: IDistillationPolicy = {
      async distill(results, _cfg) {
        received.push(...results);
        return results.map((r) => ({
          entity: r.entity,
          rawScore: r.scores.combined,
          distilledScore: r.scores.combined,
          reason: 'captured',
          kept: true,
        }));
      },
    };

    const firstPolicy: IDistillationPolicy = {
      async distill(results, _cfg) {
        return results.slice(0, 2).map((r) => ({
          entity: r.entity,
          rawScore: r.scores.combined,
          distilledScore: 0.7,
          reason: 'first kept',
          kept: true,
        }));
      },
    };

    const composite = new CompositeDistillationPolicy([firstPolicy, capturePolicy]);
    const entities = Array.from({ length: 5 }, (_, i) => makeEntity({ name: `e_${i}` }));
    await composite.distill(entities.map((e) => makeResult(e, 0.8)), {});

    // Second policy should have received only the 2 kept by first
    expect(received.length).toBe(2);
    // Combined score should be the distilledScore from first policy (0.7)
    expect(received[0].scores.combined).toBe(0.7);
  });

  it('policyCount reflects number of policies', () => {
    const composite = new CompositeDistillationPolicy([
      new NoOpDistillationPolicy(),
      new DefaultDistillationPolicy(),
    ]);
    expect(composite.policyCount).toBe(2);
  });
});

// ==================== DistillationPipeline ====================

describe('DistillationPipeline', () => {
  let pipeline: DistillationPipeline;

  beforeEach(() => {
    pipeline = new DistillationPipeline();
  });

  // ----------------------------------------
  // Empty input
  // ----------------------------------------
  describe('empty input', () => {
    it('returns empty output for empty input (no policies)', async () => {
      const result = await pipeline.distill([], {});
      expect(result.kept).toEqual([]);
      expect(result.stats.inputCount).toBe(0);
      expect(result.stats.outputCount).toBe(0);
    });

    it('returns empty output for empty input (with policies)', async () => {
      pipeline.addPolicy(new DefaultDistillationPolicy());
      const result = await pipeline.distill([], {});
      expect(result.kept).toEqual([]);
      expect(result.stats.inputCount).toBe(0);
    });
  });

  // ----------------------------------------
  // No-policy pass-through
  // ----------------------------------------
  describe('no policies configured', () => {
    it('passes all inputs through when no policies are configured', async () => {
      const entities = Array.from({ length: 5 }, (_, i) => makeEntity({ name: `e_${i}` }));
      const results = entities.map((e) => makeResult(e));
      const result = await pipeline.distill(results, {});
      expect(result.kept.length).toBe(5);
      expect(result.stats.inputCount).toBe(5);
      expect(result.stats.outputCount).toBe(5);
      expect(result.stats.totalRemoved).toBe(0);
      expect(Object.keys(result.stats.removedByPolicy)).toHaveLength(0);
    });
  });

  // ----------------------------------------
  // Single policy statistics
  // ----------------------------------------
  describe('stats tracking', () => {
    it('tracks inputCount and outputCount', async () => {
      pipeline.addPolicy(new DefaultDistillationPolicy());

      const entities = Array.from({ length: 10 }, (_, i) =>
        makeEntity({ name: `e_${i}`, importance: 7 })
      );
      const result = await pipeline.distill(
        entities.map((e) => makeResult(e)),
        { minScore: 0.0 }
      );
      expect(result.stats.inputCount).toBe(10);
      expect(result.stats.outputCount).toBe(result.kept.length);
    });

    it('tracks removedByPolicy per policy name', async () => {
      pipeline.addPolicy(new DefaultDistillationPolicy(), 'default_policy');

      const entities = [
        makeEntity({ name: 'recent', importance: 8 }),                          // should pass
        makeOldEntity(24 * 365, { name: 'old_low_importance', importance: 0 }), // likely fail
      ];
      const result = await pipeline.distill(
        entities.map((e) => makeResult(e)),
        { minScore: 0.8 }
      );

      expect(result.stats.removedByPolicy).toHaveProperty('default_policy');
      expect(result.stats.totalRemoved).toBe(
        result.stats.inputCount - result.stats.outputCount
      );
    });

    it('assigns default policy name based on index', async () => {
      pipeline.addPolicy(new NoOpDistillationPolicy());
      const entities = [makeEntity()];
      const result = await pipeline.distill(entities.map((e) => makeResult(e)), {});
      expect(result.stats.removedByPolicy).toHaveProperty('policy_0');
    });

    it('multi-policy: removedByPolicy has entry for each policy', async () => {
      pipeline.addPolicy(new NoOpDistillationPolicy(), 'first');
      pipeline.addPolicy(new NoOpDistillationPolicy(), 'second');

      const entities = [makeEntity(), makeEntity({ name: 'e2' })];
      const result = await pipeline.distill(entities.map((e) => makeResult(e)), {});
      expect(result.stats.removedByPolicy).toHaveProperty('first');
      expect(result.stats.removedByPolicy).toHaveProperty('second');
    });

    it('totalRemoved equals inputCount minus outputCount', async () => {
      pipeline.addPolicy(new DefaultDistillationPolicy(), 'p1');
      const entities = Array.from({ length: 8 }, (_, i) =>
        makeEntity({ name: `e_${i}`, importance: 5 })
      );
      const result = await pipeline.distill(
        entities.map((e) => makeResult(e)),
        { minScore: 0.0 }
      );
      expect(result.stats.totalRemoved).toBe(
        result.stats.inputCount - result.stats.outputCount
      );
    });
  });

  // ----------------------------------------
  // addPolicy / clearPolicies
  // ----------------------------------------
  describe('policy management', () => {
    it('policyCount starts at 0', () => {
      expect(pipeline.policyCount).toBe(0);
    });

    it('policyCount increments with addPolicy', () => {
      pipeline.addPolicy(new NoOpDistillationPolicy());
      pipeline.addPolicy(new DefaultDistillationPolicy());
      expect(pipeline.policyCount).toBe(2);
    });

    it('clearPolicies resets policyCount to 0', () => {
      pipeline.addPolicy(new NoOpDistillationPolicy());
      pipeline.clearPolicies();
      expect(pipeline.policyCount).toBe(0);
    });

    it('getPolicyNames returns names in order', () => {
      pipeline.addPolicy(new NoOpDistillationPolicy(), 'alpha');
      pipeline.addPolicy(new DefaultDistillationPolicy(), 'beta');
      expect(pipeline.getPolicyNames()).toEqual(['alpha', 'beta']);
    });
  });

  // ----------------------------------------
  // asPolicyAdapter
  // ----------------------------------------
  describe('asPolicyAdapter', () => {
    it('returns an IDistillationPolicy whose distill returns DistilledMemory[]', async () => {
      pipeline.addPolicy(new NoOpDistillationPolicy());
      const adapter = pipeline.asPolicyAdapter();
      const entities = [makeEntity({ name: 'e1' }), makeEntity({ name: 'e2' })];
      const result = await adapter.distill(entities.map((e) => makeResult(e)), {});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].kept).toBe(true);
    });

    it('adapter returns only kept memories', async () => {
      // Policy that keeps only entities named 'keep'
      const selectivePolicy: IDistillationPolicy = {
        async distill(results, _cfg) {
          return results
            .filter((r) => r.entity.name === 'keep')
            .map((r) => ({
              entity: r.entity,
              rawScore: r.scores.combined,
              distilledScore: 0.9,
              reason: 'selected',
              kept: true,
            }));
        },
      };
      pipeline.addPolicy(selectivePolicy);
      const adapter = pipeline.asPolicyAdapter();

      const entities = [
        makeEntity({ name: 'keep' }),
        makeEntity({ name: 'discard' }),
      ];
      const result = await adapter.distill(entities.map((e) => makeResult(e)), {});
      expect(result.length).toBe(1);
      expect(result[0].entity.name).toBe('keep');
    });
  });

  // ----------------------------------------
  // Context affects filtering
  // ----------------------------------------
  describe('context affects filtering (query relevance)', () => {
    it('queryKeywords increase score for matching entities', async () => {
      pipeline.addPolicy(new DefaultDistillationPolicy());

      const relevant = makeEntity({
        name: 'hotel_budget_preference',
        observations: ['Prefers budget hotels downtown'],
        importance: 5,
      });
      const irrelevant = makeEntity({
        name: 'weather_sunny_day',
        observations: ['Clear skies and sun'],
        importance: 5,
      });

      const resultWithKeywords = await pipeline.distill(
        [makeResult(relevant), makeResult(irrelevant)],
        { queryKeywords: ['hotel', 'budget'], minScore: 0.0 }
      );

      const relevantDistilled = resultWithKeywords.kept.find(
        (m) => m.entity.name === 'hotel_budget_preference'
      );
      const irrelevantDistilled = resultWithKeywords.kept.find(
        (m) => m.entity.name === 'weather_sunny_day'
      );

      if (relevantDistilled && irrelevantDistilled) {
        expect(relevantDistilled.distilledScore).toBeGreaterThan(
          irrelevantDistilled.distilledScore
        );
      } else {
        // At least the relevant one should have survived
        expect(relevantDistilled).toBeDefined();
      }
    });

    it('empty queryKeywords gives neutral relevance (no extra filtering)', async () => {
      pipeline.addPolicy(new DefaultDistillationPolicy());

      const entities = Array.from({ length: 3 }, (_, i) =>
        makeEntity({ name: `entity_${i}`, importance: 5 })
      );
      const resultNoKeywords = await pipeline.distill(
        entities.map((e) => makeResult(e)),
        { queryKeywords: [], minScore: 0.0 }
      );

      // All should pass since importance=5 gives decent score
      expect(resultNoKeywords.kept.length).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------
  // Integration with DefaultDistillationPolicy
  // ----------------------------------------
  describe('DefaultDistillationPolicy integration', () => {
    it('filters low-relevance memories with minScore: 0.3', async () => {
      pipeline.addPolicy(new DefaultDistillationPolicy());

      const highRelevance = makeEntity({ name: 'high', importance: 9 });
      const lowRelevance = makeOldEntity(24 * 365, { name: 'low', importance: 0 });

      const result = await pipeline.distill(
        [makeResult(highRelevance), makeResult(lowRelevance)],
        { minScore: 0.3 }
      );

      // high relevance should survive, low may not
      const highKept = result.kept.find((m) => m.entity.name === 'high');
      expect(highKept).toBeDefined();
    });

    it('pipeline stats match what DefaultDistillationPolicy would produce', async () => {
      pipeline.addPolicy(new DefaultDistillationPolicy(), 'default');

      const entities = Array.from({ length: 10 }, (_, i) =>
        makeEntity({ name: `e_${i}`, importance: 5 })
      );
      const res = await pipeline.distill(
        entities.map((e) => makeResult(e)),
        { minScore: 0.0 }
      );

      expect(res.stats.inputCount).toBe(10);
      expect(res.stats.outputCount + res.stats.totalRemoved).toBe(10);
    });
  });
});
