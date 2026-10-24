/**
 * Heap selection pins for SalienceEngine.getMostSalient.
 *
 * When the entity count is above three times the limit, getMostSalient keeps the
 * best `limit` entities in a min-heap on `salienceScore`. Equal scores have no tie
 * key, so their output order follows the heap structure. These tests replace
 * `calculateSalience` with fixed scores, so each case fixes the heap steps alone.
 * Every expected value comes from the source before the shared heap.
 */

import { describe, it, expect, vi } from 'vitest';
import { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import type { IGraphStorage } from '../../../src/types/types.js';
import type { AgentEntity, SalienceComponents, ScoredEntity } from '../../../src/types/agent-memory.js';
import { microtaskTicks } from '../../test-utils/microtask-ticks.js';

const NOW = '2026-10-20T12:00:00.000Z';

const COMPONENTS: SalienceComponents = {
  baseImportance: 0,
  recencyBoost: 0,
  frequencyBoost: 0,
  contextRelevance: 0,
  noveltyBoost: 0,
  connectivityBoost: 0,
};

function agentEntity(name: string): AgentEntity {
  return {
    name,
    entityType: 'memory',
    observations: ['Test observation'],
    createdAt: NOW,
    lastModified: NOW,
    lastAccessedAt: NOW,
    importance: 5,
    memoryType: 'working',
    accessCount: 10,
    confidence: 0.8,
    confirmationCount: 3,
    visibility: 'private',
  };
}

/** Builds an engine over entities e0, e1, ... whose salience is `scores[i]`. */
function engineWithScores(scores: number[]) {
  const entities = scores.map((_, i) => agentEntity(`e${i}`));
  const storage = {
    loadGraph: vi.fn().mockResolvedValue({ entities, relations: [] }),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getEntityByName: vi.fn((name: string) => entities.find(e => e.name === name)),
    updateEntity: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStorage;
  const accessTracker = new AccessTracker(storage);
  const engine = new SalienceEngine(storage, accessTracker, new DecayEngine(storage, accessTracker));
  const scored = entities.map((entity, i): ScoredEntity => ({ entity, salienceScore: scores[i], components: COMPONENTS }));
  const spy = vi
    .spyOn(engine, 'calculateSalience')
    .mockImplementation(async entity => scored[Number(entity.name.slice(1))]);
  return { engine, spy, scored };
}

async function select(scores: number[], limit: number): Promise<{ names: string[]; scores: number[] }> {
  const { engine } = engineWithScores(scores);
  const result = await engine.getMostSalient({}, limit);
  return { names: result.map(s => s.entity.name), scores: result.map(s => s.salienceScore) };
}

const NAN = Number.NaN;
const INF = Number.POSITIVE_INFINITY;

describe('SalienceEngine.getMostSalient heap pins', () => {
  describe('equal scores', () => {
    const tens = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

    it.each([
      [3, ['e1', 'e2', 'e0']],
      [2, ['e1', 'e0']],
    ])('limit %i returns the first entries in heap order', async (limit, expected) => {
      expect((await select(tens, limit)).names).toEqual(expected);
    });

    it('limit 1 keeps the first entry', async () => {
      expect((await select([0.5, 0.5, 0.5, 0.5], 1)).names).toEqual(['e0']);
    });

    it('never replaces the root with an equal later score', async () => {
      const result = await select([0.9, 0.5, 0.5, 0.5, 0.5, 0.1, 0.5, 0.5, 0.5, 0.5], 3);
      expect(result.names).toEqual(['e0', 'e2', 'e1']);
    });

    it('keeps heap order for a run of ties across the boundary', async () => {
      const result = await select([0.5, 0.9, 0.5, 0.1, 0.5, 0.5, 0.9, 0.5, 0.5, 0.3, 0.5, 0.5, 0.5], 4);
      expect(result.names).toEqual(['e6', 'e1', 'e2', 'e0']);
      expect(result.scores).toEqual([0.9, 0.9, 0.5, 0.5]);
    });

    it('treats -0 and 0 as equal and keeps the first arrivals', async () => {
      const result = await select([0, -0, 0, -0, -0, 0, 0, -0, 0, -0], 3);
      expect(result.names).toEqual(['e1', 'e2', 'e0']);
      expect(Object.is(result.scores[0], -0)).toBe(true);
      expect(Object.is(result.scores[1], 0)).toBe(true);
      expect(Object.is(result.scores[2], 0)).toBe(true);
    });
  });

  describe('odd scores', () => {
    it('ranks the three Infinity scores first', async () => {
      const result = await select([-INF, INF, 1, INF, -INF, 0.5, INF, 2, -INF, 3], 3);
      expect(result.names).toEqual(['e1', 'e3', 'e6']);
      expect(result.scores).toEqual([INF, INF, INF]);
    });

    it('keeps NaN scores that rise past the root on insert', async () => {
      const result = await select([0.5, NAN, 0.7, NAN, 0.2, 0.9, NAN, 0.1, 0.4, 0.3], 3);
      expect(result.names).toEqual(['e5', 'e1', 'e0']);
      expect(Number.isNaN(result.scores[1])).toBe(true);
    });

    it('lets a later score rise above a NaN root', async () => {
      const result = await select([NAN, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 2);
      expect(result.names).toEqual(['e0', 'e6']);
      expect(Number.isNaN(result.scores[0])).toBe(true);
    });

    it('never admits a NaN score into a full heap', async () => {
      expect((await select([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, NAN], 2)).names).toEqual(['e5', 'e4']);
    });

    it('returns ascending and descending input highest first', async () => {
      const asc = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      expect((await select(asc, 3)).names).toEqual(['e9', 'e8', 'e7']);
      expect((await select([...asc].reverse(), 3)).names).toEqual(['e0', 'e1', 'e2']);
    });
  });

  describe('odd limits', () => {
    it.each([[0], [-1], [NAN]])(
      'limit %d rejects with a TypeError after the first score',
      async limit => {
        const { engine, spy } = engineWithScores([0.1, 0.2]);
        const pending = engine.getMostSalient({}, limit);
        await expect(pending).rejects.toThrow(TypeError);
        await expect(pending).rejects.toThrow(/salienceScore/);
        expect(spy).toHaveBeenCalledTimes(1);
      }
    );

    it('limit 0.5 keeps one entry', async () => {
      expect((await select([0.2, 0.9, 0.5, 0.7], 0.5)).names).toEqual(['e1']);
    });

    it('limit 2.5 keeps three entries', async () => {
      const result = await select([0.1, 0.8, 0.3, 0.8, 0.5, 0.2, 0.9, 0.4], 2.5);
      expect(result.names).toEqual(['e6', 'e3', 'e1']);
    });
  });

  describe('call order and timing', () => {
    it('scores every entity once, in storage order, and returns the scored objects', async () => {
      const { engine, spy, scored } = engineWithScores([0.4, 0.9, 0.1, 0.7, 0.3, 0.8, 0.2]);
      const result = await engine.getMostSalient({}, 2);
      expect(spy.mock.calls.map(([entity]) => entity.name)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
      expect(result[0]).toBe(scored[1]);
      expect(result[1]).toBe(scored[5]);
    });

    it('settles in the same number of microtask turns', async () => {
      const { engine } = engineWithScores([0.4, 0.9, 0.1, 0.7, 0.3, 0.8, 0.2]);
      expect(await microtaskTicks(engine.getMostSalient({}, 2))).toBe(9);
    });
  });
});
