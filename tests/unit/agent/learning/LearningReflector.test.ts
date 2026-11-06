/** LearningReflector (Recursa RS-21): one learning reflection per round, evidence checks, insights, fallback. */
import { describe, it, expect } from 'vitest';
import { AgentReflectionManager } from '../../../../src/agent/AgentReflectionManager.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { LearningReflector, MAX_KEY_INSIGHTS, type ReflectChild } from '../../../../src/agent/learning/LearningReflector.js';
import type { EvalMetrics } from '../../../../src/types/learning.js';
import type { PGCompletionProvider } from '../../../../src/agent/procedural/graph/CompletionProvider.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { closeStorage, reopen } from '../knowledge/knowledgeFixtures.js';
import { makeTraces } from './leafFixtures.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { LearningTrace } from '../../../../src/agent/learning/LearningTrace.js';

/** Empty metrics with a given all-pass count out of `tasks`. */
function metrics(tasks: number, allPass: number): EvalMetrics {
  return { tasks, allPass: tasks === 0 ? 0 : allPass / tasks, meanCriteria: 0, byCategory: {} };
}

/** A child outcome with the given improvement flag. */
function child(traceId: string, label: string, improved: boolean, extra: Partial<ReflectChild> = {}): ReflectChild {
  return { traceId, label, improved, before: metrics(2, 0), after: metrics(2, improved ? 2 : 0), ...extra };
}

/** Storage with reflector, stores and two child traces plus the round trace. */
async function setup(storage: IGraphStorage, llmProvider?: PGCompletionProvider) {
  const entityManager = new EntityManager(storage as never);
  const traces: LearningTrace = makeTraces(storage);
  const reflections = new AgentReflectionManager(storage, entityManager);
  const reflector = new LearningReflector(reflections, traces, llmProvider ? { llmProvider } : {});
  const round = await traces.create({ learnerKind: 'recursive', round: 0, subsetLabel: 'all', actions: [], revisionIds: [], metrics: metrics(0, 0) });
  const a = await traces.create({ learnerKind: 'leaf', round: 0, subsetLabel: 'a', actions: [], revisionIds: [], metrics: metrics(0, 0), parentTraceId: round });
  const b = await traces.create({ learnerKind: 'leaf', round: 0, subsetLabel: 'b', actions: [], revisionIds: [], metrics: metrics(0, 0), parentTraceId: round });
  return { reflector, reflections, traces, round, a, b };
}

withBothBackends('LearningReflector writes one reflection per round', (backend) => {
  it('writes exactly one scope-learning reflection whose evidence names existing child traces', async () => {
    const storage = backend.create();
    const { reflector, reflections, round, a, b } = await setup(storage);
    const result = await reflector.reflect({
      traceId: round,
      round: 0,
      children: [child(a, 'a', true), child(b, 'b', false)],
      mergeNotes: [],
    });
    const stored = await reflections.list({ scope: 'learning' });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(result.reflectionId);
    expect(stored[0]!.scope).toBe('learning');
    expect([...stored[0]!.evidence].sort()).toEqual([a, b].sort());
    expect(stored[0]!.generalization_confidence).toBe(0.5);
    expect(result.improvedShare).toBe(0.5);
    expect(result.skippedEvidence).toEqual([]);
  });

  it('skips a child trace id that does not exist and notes it in the summary', async () => {
    const storage = backend.create();
    const { reflector, reflections, round, a } = await setup(storage);
    const result = await reflector.reflect({
      traceId: round,
      round: 1,
      children: [child(a, 'a', true), child('trace-missing', 'ghost', false)],
      mergeNotes: [],
    });
    expect(result.skippedEvidence).toEqual(['trace-missing']);
    const [stored] = await reflections.list({ scope: 'learning' });
    expect(stored!.evidence).toEqual([a]);
    expect(stored!.summary).toContain('skipped nonexistent evidence: trace-missing');
  });

  it('survives a reopen with its evidence and insights intact', async () => {
    const storage1 = backend.create();
    const first = await setup(storage1);
    await first.reflector.reflect({ traceId: first.round, round: 0, children: [child(first.a, 'a', true)], mergeNotes: [] });
    closeStorage(storage1);
    const storage2 = reopen(backend, storage1);
    const reflections = new AgentReflectionManager(storage2, new EntityManager(storage2 as never));
    const stored = await reflections.list({ scope: 'learning' });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.evidence).toEqual([first.a]);
    closeStorage(storage2);
  });
});

describe('LearningReflector insights and fallback', () => {
  withBothBackends('LearningReflector insights', (backend) => {
    it('lists non-improving subsets, conflicts, noisy clusters and a split hint', async () => {
      const storage = backend.create();
      const { reflector, round, a, b, traces } = await setup(storage);
      const c = await traces.create({ learnerKind: 'leaf', round: 0, subsetLabel: 'c', actions: [], revisionIds: [], metrics: metrics(0, 0), parentTraceId: round });
      const result = await reflector.reflect({
        traceId: round,
        round: 0,
        strategy: 'byCategory',
        children: [
          child(a, 'a', false, { conflicts: ['skill fix-x edited by a and b'], noisyCount: 2 }),
          child(b, 'b', true),
          child(c, 'c', true),
        ],
        mergeNotes: ['[conflict]: a vs b'],
      });
      expect(result.keyInsights).toContain('subset a did not improve (allPass 0 -> 0)');
      expect(result.keyInsights).toContain('conflict in subset a: skill fix-x edited by a and b');
      expect(result.keyInsights).toContain('noisy feedback in subset a: 2 task(s)');
      expect(result.keyInsights).toContain('split by byCategory: 2 of 3 subsets improved');
      expect(result.improvedShare).toBeCloseTo(2 / 3);
    });

    it('caps key insights at five', async () => {
      const storage = backend.create();
      const { reflector, round, a, b } = await setup(storage);
      const many = Array.from({ length: 6 }, (_, i) => `c${i}`);
      const result = await reflector.reflect({
        traceId: round,
        round: 0,
        strategy: 'bySkill',
        children: [child(a, 'a', false, { conflicts: many, noisyCount: 1 }), child(b, 'b', false)],
        mergeNotes: [],
      });
      expect(result.keyInsights).toHaveLength(MAX_KEY_INSIGHTS);
    });

    it('reports that no subset improved when none did, and falls back when the LLM fails', async () => {
      const storage = backend.create();
      const failing: PGCompletionProvider = {
        complete: async () => {
          throw new Error('provider down');
        },
      };
      const { reflector, reflections, round, a } = await setup(storage, failing);
      const result = await reflector.reflect({
        traceId: round,
        round: 2,
        strategy: 'auto',
        children: [child(a, 'a', false)],
        mergeNotes: [],
      });
      expect(result.keyInsights).toContain('split by auto: no subset improved; try another strategy');
      expect(result.improvedShare).toBe(0);
      expect(result.summary.startsWith('Round 2: 0 of 1 subsets improved')).toBe(true);
      const [stored] = await reflections.list({ scope: 'learning' });
      expect(stored!.generalization_confidence).toBe(0);
    });
  });
});

withBothBackends('LearningReflector N3 (split slot, prefer-split token, idempotency)', (backend) => {
  it('reserves a slot for the split insight and stores a prefer-split token', async () => {
    const storage = backend.create();
    const { reflector, round, a } = await setup(storage);
    const many = Array.from({ length: 6 }, (_, i) => child(a, `s${i}`, false));
    const result = await reflector.reflect({ traceId: round, round: 0, children: many, mergeNotes: [], strategy: 'byCategory' });
    expect(result.keyInsights).toHaveLength(MAX_KEY_INSIGHTS);
    expect(result.keyInsights.some((k) => k.startsWith('split by byCategory'))).toBe(true);
    expect(result.keyInsights).toContain('prefer-split:byFailureMode');
    expect(result.preferredStrategy).toBe('byFailureMode');
    const improved = await reflector.reflect({ traceId: round, round: 1, children: [child(a, 'x', true)], mergeNotes: [], strategy: 'bySkill' });
    expect(improved.keyInsights).toContain('prefer-split:bySkill');
    const auto = await reflector.reflect({ traceId: round, round: 2, children: [child(a, 'y', true)], mergeNotes: [], strategy: 'auto' });
    expect(auto.keyInsights.some((k) => k.startsWith('prefer-split:'))).toBe(false);
  });

  it('is idempotent per round: a second call for the same round and evidence returns the first reflection', async () => {
    const storage = backend.create();
    const { reflector, reflections, round, a, b } = await setup(storage);
    const input = { traceId: round, round: 3, children: [child(a, 'a', true), child(b, 'b', false)], mergeNotes: [], strategy: 'byTool' };
    const first = await reflector.reflect(input);
    const second = await reflector.reflect(input);
    expect(second.reflectionId).toBe(first.reflectionId);
    const stored = await reflections.list({ scope: 'learning' });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.experienceType).toBe(`learning-round:${round}#3`);
  });
});
