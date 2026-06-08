/**
 * DistillationPipeline Smoke Tests
 *
 * Targets the test-coverage gap noted in
 * docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md §15.2.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DistillationPipeline,
} from '../../../src/agent/DistillationPipeline.js';
import {
  NoOpDistillationPolicy,
  type IDistillationPolicy,
  type DistillationConfig,
  type DistilledMemory,
} from '../../../src/agent/DistillationPolicy.js';
import type { HybridSearchResult, Entity } from '../../../src/types/types.js';

const ENTITY_A: Entity = {
  name: 'A',
  entityType: 'note',
  observations: ['observation about hotels and budget travel'],
};
const ENTITY_B: Entity = {
  name: 'B',
  entityType: 'note',
  observations: ['unrelated content about cookery'],
};

const inputs: HybridSearchResult[] = [
  {
    entity: ENTITY_A,
    scores: { semantic: 0.8, lexical: 0.6, symbolic: 0, combined: 0.7 },
    matchedLayers: ['semantic', 'lexical'],
  },
  {
    entity: ENTITY_B,
    scores: { semantic: 0.1, lexical: 0.2, symbolic: 0, combined: 0.15 },
    matchedLayers: ['lexical'],
  },
];

const config: DistillationConfig = {
  minScore: 0.3,
  queryKeywords: ['hotel', 'budget'],
};

describe('DistillationPipeline', () => {
  it('with no policies returns the input unchanged as kept memories', async () => {
    const pipeline = new DistillationPipeline();
    const result = await pipeline.distill(inputs, config);
    expect(result.kept).toHaveLength(2);
    expect(result.stats.inputCount).toBe(2);
    expect(result.stats.outputCount).toBe(2);
    expect(result.stats.totalRemoved).toBe(0);
  });

  it('NoOpDistillationPolicy keeps every input', async () => {
    const pipeline = new DistillationPipeline();
    pipeline.addPolicy(new NoOpDistillationPolicy(), 'noop');
    const result = await pipeline.distill(inputs, config);
    expect(result.kept).toHaveLength(2);
    expect(result.stats.removedByPolicy['noop']).toBe(0);
  });

  it('a policy that filters by score reports removals correctly', async () => {
    const scoreFilter: IDistillationPolicy = {
      async distill(results, cfg): Promise<DistilledMemory[]> {
        const min = cfg.minScore ?? 0;
        return results
          .filter((r) => r.scores.combined >= min)
          .map((r) => ({
            entity: r.entity,
            rawScore: r.scores.combined,
            distilledScore: r.scores.combined,
            reason: 'score-filter',
            kept: true,
          }));
      },
    };
    const pipeline = new DistillationPipeline();
    pipeline.addPolicy(scoreFilter, 'score');
    const result = await pipeline.distill(inputs, config);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.entity.name).toBe('A');
    expect(result.stats.removedByPolicy['score']).toBe(1);
    expect(result.stats.totalRemoved).toBe(1);
  });

  it('two policies compose and removal counts attribute per stage', async () => {
    const dropOne: IDistillationPolicy = {
      async distill(results) {
        return results.slice(1).map((r) => ({
          entity: r.entity,
          rawScore: r.scores.combined,
          distilledScore: r.scores.combined,
          reason: 'drop-first',
          kept: true,
        }));
      },
    };
    const keepAll: IDistillationPolicy = {
      async distill(results) {
        return results.map((r) => ({
          entity: r.entity,
          rawScore: r.rawScore ?? 0,
          distilledScore: r.distilledScore ?? 0,
          reason: 'keep-all',
          kept: true,
        }));
      },
    };
    const pipeline = new DistillationPipeline();
    pipeline.addPolicy(dropOne, 'first');
    pipeline.addPolicy(keepAll, 'second');
    const result = await pipeline.distill(inputs, config);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.entity.name).toBe('B');
    expect(result.stats.removedByPolicy['first']).toBe(1);
    expect(result.stats.removedByPolicy['second']).toBe(0);
  });

  it('addPolicy + clearPolicies + getPolicyNames round-trip', () => {
    const pipeline = new DistillationPipeline();
    pipeline.addPolicy(new NoOpDistillationPolicy(), 'noop1');
    pipeline.addPolicy(new NoOpDistillationPolicy(), 'noop2');
    expect(pipeline.getPolicyNames()).toEqual(['noop1', 'noop2']);
    pipeline.clearPolicies();
    expect(pipeline.getPolicyNames()).toEqual([]);
  });

  it('asPolicyAdapter exposes the pipeline as a single IDistillationPolicy', async () => {
    const inner: IDistillationPolicy = {
      distill: vi.fn(async (results) =>
        results.map((r) => ({
          entity: r.entity,
          rawScore: r.scores.combined,
          distilledScore: r.scores.combined,
          reason: 'inner',
          kept: true,
        })),
      ),
    };
    const pipeline = new DistillationPipeline();
    pipeline.addPolicy(inner, 'inner');
    const adapter = pipeline.asPolicyAdapter();
    const distilled = await adapter.distill(inputs, config);
    expect(distilled).toHaveLength(2);
    expect(inner.distill).toHaveBeenCalled();
  });
});
