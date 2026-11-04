/**
 * ProspectiveMemoryManager — conditional triggers with a pluggable
 * predicate evaluator (DES-13).
 *
 * Without an evaluator, conditional intentions never fire (pre-DES-13
 * behaviour). With one, `tick()` evaluates them. The evaluator's return
 * value is the only fire signal. `checkIntervalMs` gates how often it runs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ProspectiveMemoryManager,
  type PredicateEvaluator,
} from '../../../src/agent/ProspectiveMemoryManager.js';
import { logger } from '../../../src/utils/logger.js';
import { createInMemoryStorageFake } from '../../helpers/mockStorage.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../helpers/tempStorage.js';
import type { ProspectiveEntity } from '../../../src/types/agent-memory.js';
import type { IGraphStorage, Entity } from '../../../src/types/types.js';

const T0 = new Date('2030-01-01T00:00:00.000Z');
const MIN = 60_000;

function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * MIN);
}

function makeManager(
  storage: IGraphStorage,
  evaluator?: PredicateEvaluator,
): ProspectiveMemoryManager {
  return new ProspectiveMemoryManager(storage, {
    predicateEvaluator: evaluator,
    defaultExpiryHours: 1000,
  });
}

async function loadProspective(storage: IGraphStorage, name: string): Promise<ProspectiveEntity> {
  const entity = storage.getEntityByName(name) as unknown as ProspectiveEntity | undefined;
  if (!entity) throw new Error(`missing ${name}`);
  return entity;
}

describe('ProspectiveMemoryManager conditional triggers (DES-13)', () => {
  let storage: IGraphStorage;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    storage = createInMemoryStorageFake([], {});
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('without an evaluator (unchanged behaviour)', () => {
    it('warns once when a conditional intention is scheduled', async () => {
      const pmm = makeManager(storage);
      await pmm.scheduleConditional('a', 'x > 1');
      await pmm.scheduleConditional('b', 'x > 2');
      const conditionalWarnings = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('scheduleConditional'),
      );
      expect(conditionalWarnings).toHaveLength(1);
    });

    it('never fires a conditional intention on tick', async () => {
      const pmm = makeManager(storage);
      await pmm.scheduleConditional('a', 'x > 1');
      const fired = await pmm.tick(at(10_000));
      expect(fired).toEqual([]);
      const pending = await pmm.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.lifecycle.status).toBe('pending');
    });
  });

  describe('with an evaluator', () => {
    it('does not emit the no-evaluator warning', async () => {
      const pmm = makeManager(storage, () => false);
      await pmm.scheduleConditional('a', 'x > 1');
      const conditionalWarnings = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('scheduleConditional'),
      );
      expect(conditionalWarnings).toHaveLength(0);
    });

    it('fires when the evaluator returns true and transitions to fired', async () => {
      const evaluator = vi.fn<PredicateEvaluator>(() => true);
      const pmm = makeManager(storage, evaluator);
      const entity = await pmm.scheduleConditional('deploy when green', 'ci_green');

      const fired = await pmm.tick(at(1));

      expect(fired).toHaveLength(1);
      expect(fired[0]!.entity.name).toBe(entity.name);
      expect(fired[0]!.injectionPayload).toContain('deploy when green');
      expect(evaluator).toHaveBeenCalledTimes(1);
      expect(evaluator.mock.calls[0]![0]).toBe('ci_green');
      expect(evaluator.mock.calls[0]![1].entity.name).toBe(entity.name);
      expect(evaluator.mock.calls[0]![1].now.getTime()).toBe(at(1).getTime());

      const stored = await loadProspective(storage, entity.name);
      expect(stored.lifecycle.status).toBe('fired');
      expect(await pmm.getPending()).toHaveLength(0);
    });

    it('does not fire when the evaluator returns false', async () => {
      const pmm = makeManager(storage, () => false);
      await pmm.scheduleConditional('a', 'x');
      expect(await pmm.tick(at(1))).toEqual([]);
      expect(await pmm.getPending()).toHaveLength(1);
    });

    it('fires only on the boolean true, not on other truthy values', async () => {
      const pmm = makeManager(storage, (() => 'yes') as unknown as PredicateEvaluator);
      await pmm.scheduleConditional('a', 'x');
      expect(await pmm.tick(at(1))).toEqual([]);
    });

    it('supports an async evaluator', async () => {
      const pmm = makeManager(storage, async () => {
        await Promise.resolve();
        return true;
      });
      await pmm.scheduleConditional('a', 'x');
      expect(await pmm.tick(at(1))).toHaveLength(1);
    });

    it('evaluates each pending conditional intention once per tick', async () => {
      const evaluator = vi.fn<PredicateEvaluator>(() => false);
      const pmm = makeManager(storage, evaluator);
      await pmm.scheduleConditional('a', 'p1');
      await pmm.scheduleConditional('b', 'p2');
      await pmm.tick(at(1));
      expect(evaluator).toHaveBeenCalledTimes(2);
      expect(evaluator.mock.calls.map((c) => c[0]).sort()).toEqual(['p1', 'p2']);
    });

    it('does not evaluate or fire time or event intentions through the conditional path', async () => {
      const evaluator = vi.fn<PredicateEvaluator>(() => true);
      const pmm = makeManager(storage, evaluator);
      await pmm.scheduleAt('time', new Date(Date.now() + 60 * MIN));
      await pmm.scheduleOnEvent('event', { text: 'hello' });
      const fired = await pmm.tick(new Date(Date.now() + 120 * MIN));
      expect(fired).toHaveLength(1); // only the time trigger
      expect(fired[0]!.entity.trigger.kind).toBe('time');
      expect(evaluator).not.toHaveBeenCalled();
    });
  });

  describe('checkIntervalMs', () => {
    it('skips the evaluator inside the interval and calls it again after it', async () => {
      const evaluator = vi.fn<PredicateEvaluator>(() => false);
      const pmm = makeManager(storage, evaluator);
      await pmm.scheduleConditional('a', 'p', { checkIntervalMs: 5 * MIN });

      await pmm.tick(at(0));
      await pmm.tick(at(1));
      await pmm.tick(at(4));
      expect(evaluator).toHaveBeenCalledTimes(1);

      await pmm.tick(at(6));
      expect(evaluator).toHaveBeenCalledTimes(2);
    });

    it('persists lastCheckedAt on a pending intention after a not-due check', async () => {
      const pmm = makeManager(storage, () => false);
      const entity = await pmm.scheduleConditional('a', 'p', { checkIntervalMs: 5 * MIN });
      await pmm.tick(at(2));
      const stored = await loadProspective(storage, entity.name);
      expect(stored.lifecycle.status).toBe('pending');
      expect(stored.lifecycle).toMatchObject({ lastCheckedAt: at(2).toISOString() });
    });

    it('does not persist lastCheckedAt when no interval is set', async () => {
      const evaluator = vi.fn<PredicateEvaluator>(() => false);
      const pmm = makeManager(storage, evaluator);
      const entity = await pmm.scheduleConditional('a', 'p');
      await pmm.tick(at(1));
      await pmm.tick(at(2));
      expect(evaluator).toHaveBeenCalledTimes(2);
      const stored = await loadProspective(storage, entity.name);
      expect((stored.lifecycle as { lastCheckedAt?: string }).lastCheckedAt).toBeUndefined();
    });

    it('treats a malformed lastCheckedAt as never checked', async () => {
      const evaluator = vi.fn<PredicateEvaluator>(() => false);
      const pmm = makeManager(storage, evaluator);
      const entity = await pmm.scheduleConditional('a', 'p', { checkIntervalMs: 5 * MIN });
      const stored = storage.getEntityByName(entity.name) as unknown as Entity & {
        lifecycle: { lastCheckedAt?: string };
      };
      stored.lifecycle = { status: 'pending', fireCount: 0, lastCheckedAt: 'not-a-date' } as never;
      await pmm.tick(at(1));
      expect(evaluator).toHaveBeenCalledTimes(1);
    });

    it('does not carry lastCheckedAt onto the fired variant', async () => {
      let calls = 0;
      const pmm = makeManager(storage, () => {
        calls += 1;
        return calls >= 2;
      });
      const entity = await pmm.scheduleConditional('a', 'p', { checkIntervalMs: 1 * MIN });
      await pmm.tick(at(0)); // not due, lastCheckedAt recorded
      const fired = await pmm.tick(at(2)); // due
      expect(fired).toHaveLength(1);
      const stored = await loadProspective(storage, entity.name);
      expect(stored.lifecycle.status).toBe('fired');
      expect((stored.lifecycle as { lastCheckedAt?: string }).lastCheckedAt).toBeUndefined();
    });
  });

  describe('evaluator failures', () => {
    it('a throwing evaluator does not fire, does not throw from tick, and warns once per intention', async () => {
      const pmm = makeManager(storage, () => {
        throw new Error('boom');
      });
      await pmm.scheduleConditional('a', 'p');
      await expect(pmm.tick(at(1))).resolves.toEqual([]);
      await expect(pmm.tick(at(2))).resolves.toEqual([]);
      const failureWarnings = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('predicate evaluator failed'),
      );
      expect(failureWarnings).toHaveLength(1);
      expect(String(failureWarnings[0]![0])).toContain('boom');
    });

    it('a rejecting evaluator leaves other pending intentions unaffected', async () => {
      const pmm = makeManager(storage, async (predicate) => {
        if (predicate === 'bad') throw new Error('rejected');
        return true;
      });
      await pmm.scheduleConditional('bad one', 'bad');
      await pmm.scheduleConditional('good one', 'good');
      const fired = await pmm.tick(at(1));
      expect(fired).toHaveLength(1);
      expect(fired[0]!.entity.observations[0]).toBe('good one');
      expect(await pmm.getPending()).toHaveLength(1);
    });

    it('warns separately for each failing intention', async () => {
      const pmm = makeManager(storage, () => {
        throw new Error('nope');
      });
      await pmm.scheduleConditional('a', 'p');
      await pmm.scheduleConditional('b', 'p');
      await pmm.tick(at(1));
      const failureWarnings = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('predicate evaluator failed'),
      );
      expect(failureWarnings).toHaveLength(2);
    });
  });

  describe('lifecycle parity with time triggers', () => {
    it('maxFireCount expires a conditional intention at its cap', async () => {
      const pmm = makeManager(storage, () => true);
      const entity = await pmm.scheduleConditional('a', 'p', { maxFireCount: 1 });
      const fired = await pmm.tick(at(1));
      expect(fired).toHaveLength(1);
      const stored = await loadProspective(storage, entity.name);
      expect(stored.lifecycle.status).toBe('expired');
    });

    it('a cancelled conditional intention is not evaluated', async () => {
      const evaluator = vi.fn<PredicateEvaluator>(() => true);
      const pmm = makeManager(storage, evaluator);
      const entity = await pmm.scheduleConditional('a', 'p');
      await pmm.cancel(entity.name);
      expect(await pmm.tick(at(1))).toEqual([]);
      expect(evaluator).not.toHaveBeenCalled();
    });
  });
});

describe('ManagerContextOptions.prospectivePredicateEvaluator', () => {
  afterEach(() => {
    cleanupTempDirs();
  });

  it('reaches the ctx.prospectiveMemory manager', async () => {
    const evaluator = vi.fn<PredicateEvaluator>(() => true);
    const ctx = new ManagerContext({
      storagePath: makeTempJsonlPath(),
      prospectivePredicateEvaluator: evaluator,
    });
    try {
      await ctx.prospectiveMemory.scheduleConditional('wired', 'p');
      const fired = await ctx.prospectiveMemory.tick(new Date(Date.now() + MIN));
      expect(fired).toHaveLength(1);
      expect(evaluator).toHaveBeenCalledTimes(1);
    } finally {
      ctx.close();
    }
  });

  it('without the option, ctx.prospectiveMemory never fires conditionals', async () => {
    const ctx = new ManagerContext({ storagePath: makeTempJsonlPath() });
    try {
      await ctx.prospectiveMemory.scheduleConditional('unwired', 'p');
      const fired = await ctx.prospectiveMemory.tick(new Date(Date.now() + MIN));
      expect(fired).toEqual([]);
    } finally {
      ctx.close();
    }
  });
});
