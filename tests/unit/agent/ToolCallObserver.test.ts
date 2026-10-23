/**
 * ToolCallObserver — Phase Tool B unit tests.
 *
 * Covers:
 * - observeStart → observeComplete round-trip records 'success'
 * - observeError records 'failure' with error message
 * - observePartial records 'partial' with reason
 * - cancel drops the in-flight entry without recording
 * - durationMs is computed from start to completion
 * - events fire with correct payloads
 * - concurrent observations don't cross-wire (one tool's outcome
 *   isn't attributed to another)
 * - completing an unknown callId is a no-op (defensive)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToolCallObserver } from '../../../src/agent/ToolCallObserver.js';
import { ToolAffordanceManager } from '../../../src/agent/ToolAffordanceManager.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { Entity, IGraphStorage, KnowledgeGraph } from '../../../src/types/types.js';
import { VersionConflictError, EntityNotFoundError } from '../../../src/utils/errors.js';

function createMockStorage(): IGraphStorage & { _entities: Map<string, Entity> } {
  const entities = new Map<string, Entity>();
  return {
    _entities: entities,
    async appendEntity(entity: Entity) {
      entities.set(entity.name, entity);
    },
    async updateEntity(name: string, updates: Partial<Entity>): Promise<boolean> {
      const cur = entities.get(name);
      if (!cur) return false;
      entities.set(name, { ...cur, ...updates });
      return true;
    },
    getEntityByName(name: string): Entity | undefined {
      return entities.get(name);
    },
    async loadGraph(): Promise<KnowledgeGraph> {
      return { entities: Array.from(entities.values()), relations: [] };
    },
  } as unknown as IGraphStorage & { _entities: Map<string, Entity> };
}

function createFakeEntityManager(storage: IGraphStorage): EntityManager {
  return {
    updateEntity: vi.fn(async (
      name: string,
      updates: Partial<Entity>,
      options?: { expectedVersion?: number },
    ) => {
      const entity = storage.getEntityByName(name);
      if (!entity) throw new EntityNotFoundError(name);
      if (options?.expectedVersion !== undefined) {
        const live = entity.version ?? 1;
        if (live !== options.expectedVersion) {
          throw new VersionConflictError(name, options.expectedVersion, live);
        }
      }
      const merged: Partial<Entity> = { ...updates };
      if (options?.expectedVersion !== undefined) {
        merged.version = (entity.version ?? 1) + 1;
      }
      const ok = await storage.updateEntity(name, merged);
      if (!ok) throw new EntityNotFoundError(name);
      return { ...entity, ...merged } as Entity;
    }),
    deleteEntities: vi.fn(),
  } as unknown as EntityManager;
}

describe('ToolCallObserver', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let entityManager: EntityManager;
  let manager: ToolAffordanceManager;
  let observer: ToolCallObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    storage = createMockStorage();
    entityManager = createFakeEntityManager(storage);
    manager = new ToolAffordanceManager(storage, entityManager);
    observer = new ToolCallObserver(manager);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('observeStart → observeComplete records "success" with duration', async () => {
    const callId = observer.observeStart('shell.run', { cmd: 'ls' });
    vi.advanceTimersByTime(250);
    await observer.observeComplete(callId);

    const rec = manager.get('shell.run')!;
    expect(rec.outcomes).toHaveLength(1);
    expect(rec.outcomes[0]!.outcome).toBe('success');
    expect(rec.outcomes[0]!.durationMs).toBe(250);
  });

  it('observeError records "failure" with the error message', async () => {
    const callId = observer.observeStart('shell.run');
    await observer.observeError(callId, new Error('command not found'));

    const rec = manager.get('shell.run')!;
    expect(rec.outcomes[0]!.outcome).toBe('failure');
    expect(rec.outcomes[0]!.errorMessage).toBe('command not found');
  });

  it('observeError accepts a plain string', async () => {
    const callId = observer.observeStart('shell.run');
    await observer.observeError(callId, 'EACCES');

    const rec = manager.get('shell.run')!;
    expect(rec.outcomes[0]!.errorMessage).toBe('EACCES');
  });

  it('observePartial records "partial" with the reason', async () => {
    const callId = observer.observeStart('grep.search');
    await observer.observePartial(callId, 'truncated at 100 matches');

    const rec = manager.get('grep.search')!;
    expect(rec.outcomes[0]!.outcome).toBe('partial');
    expect(rec.outcomes[0]!.errorMessage).toBe('truncated at 100 matches');
  });

  it('cancel drops the in-flight entry without recording', async () => {
    const callId = observer.observeStart('shell.run');
    expect(observer.inFlightCount()).toBe(1);
    observer.cancel(callId);
    expect(observer.inFlightCount()).toBe(0);
    // No record should have been written.
    expect(manager.get('shell.run')).toBeUndefined();
  });

  it('observeComplete on an unknown callId is a no-op', async () => {
    await observer.observeComplete('not-a-real-id');
    expect(manager.get('shell.run')).toBeUndefined();
  });

  it('concurrent observations stay independent', async () => {
    const callA = observer.observeStart('tool.a');
    const callB = observer.observeStart('tool.b');
    expect(observer.inFlightCount()).toBe(2);

    vi.advanceTimersByTime(100);
    await observer.observeError(callA, 'a-failed');
    await observer.observeComplete(callB);

    const recA = manager.get('tool.a')!;
    const recB = manager.get('tool.b')!;
    expect(recA.outcomes[0]!.outcome).toBe('failure');
    expect(recA.outcomes[0]!.errorMessage).toBe('a-failed');
    expect(recB.outcomes[0]!.outcome).toBe('success');
  });

  it('records the exact outcome for each finish method and ignores an unknown call id', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const recordOutcome = vi.spyOn(manager, 'recordOutcome');
      const completed = observer.observeStart('tool_ok');
      const failed = observer.observeStart('tool_bad');
      const partial = observer.observeStart('tool_part');

      await observer.observeComplete(completed, { result: 'done' });
      await observer.observeError(failed, new Error('boom'));
      await observer.observePartial(partial, 'half');
      await observer.observeComplete('unknown');
      await observer.observeError('unknown', 'x');
      await observer.observePartial('unknown', 'y');

      expect(recordOutcome.mock.calls).toStrictEqual([
        ['tool_ok', { outcome: 'success', durationMs: 0 }],
        ['tool_bad', { outcome: 'failure', errorMessage: 'boom', durationMs: 0 }],
        ['tool_part', { outcome: 'partial', errorMessage: 'half', durationMs: 0 }],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits the exact payload of each completion event after the outcome is recorded', async () => {
    const recordOutcome = vi.spyOn(manager, 'recordOutcome');
    const emitted: Array<{ event: string; payload: unknown; recorded: number }> = [];
    for (const event of ['toolCall:complete', 'toolCall:error', 'toolCall:partial']) {
      observer.events.on(event, (payload) => {
        emitted.push({ event, payload, recorded: recordOutcome.mock.calls.length });
      });
    }

    const completed = observer.observeStart('tool_ok');
    const completedNoMeta = observer.observeStart('tool_ok_no_meta');
    const failed = observer.observeStart('tool_bad');
    const failedText = observer.observeStart('tool_bad_text');
    const partial = observer.observeStart('tool_part');
    vi.advanceTimersByTime(250);

    await observer.observeComplete(completed, { result: 'done' });
    await observer.observeComplete(completedNoMeta);
    await observer.observeError(failed, new Error('boom'));
    await observer.observeError(failedText, 'plain text');
    await observer.observePartial(partial, 'half');

    expect(emitted).toStrictEqual([
      {
        event: 'toolCall:complete',
        payload: { callId: completed, toolName: 'tool_ok', durationMs: 250, result: 'done' },
        recorded: 1,
      },
      {
        event: 'toolCall:complete',
        payload: { callId: completedNoMeta, toolName: 'tool_ok_no_meta', durationMs: 250, result: undefined },
        recorded: 2,
      },
      {
        event: 'toolCall:error',
        payload: { callId: failed, toolName: 'tool_bad', durationMs: 250, errorMessage: 'boom' },
        recorded: 3,
      },
      {
        event: 'toolCall:error',
        payload: { callId: failedText, toolName: 'tool_bad_text', durationMs: 250, errorMessage: 'plain text' },
        recorded: 4,
      },
      {
        event: 'toolCall:partial',
        payload: { callId: partial, toolName: 'tool_part', durationMs: 250, reason: 'half' },
        recorded: 5,
      },
    ]);
  });

  it('does not touch the error value for an unknown call id', async () => {
    const recordOutcome = vi.spyOn(manager, 'recordOutcome');
    const hostile = {
      toString(): string {
        throw new Error('toString must not run');
      },
    };

    await expect(observer.observeError('unknown', hostile as unknown as Error)).resolves.toBeUndefined();
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it('closes the call before it reads an error value that throws', async () => {
    const recordOutcome = vi.spyOn(manager, 'recordOutcome');
    const emitted: unknown[] = [];
    observer.events.on('toolCall:error', (payload) => emitted.push(payload));
    const hostile = {
      toString(): string {
        throw new Error('toString failed');
      },
    };
    const callId = observer.observeStart('tool_bad');

    await expect(observer.observeError(callId, hostile as unknown as Error)).rejects.toThrow('toString failed');

    expect(observer.inFlightCount()).toBe(0);
    expect(recordOutcome).not.toHaveBeenCalled();
    expect(emitted).toStrictEqual([]);
  });

  it('reads the error text before recording and the result after recording', async () => {
    const order: string[] = [];
    vi.spyOn(manager, 'recordOutcome').mockImplementation(async () => {
      order.push('record');
      return undefined as never;
    });
    const completed = observer.observeStart('tool_ok');
    const failed = observer.observeStart('tool_bad');
    const meta = {
      get result(): string {
        order.push('read result');
        return 'r';
      },
    };
    const text = {
      toString(): string {
        order.push('read text');
        return 'x';
      },
    };

    await observer.observeComplete(completed, meta);
    await observer.observeError(failed, text as unknown as Error);

    expect(order).toStrictEqual(['record', 'read result', 'read text', 'record']);
  });

  it('measures the call duration before it reads the error text', async () => {
    const recordOutcome = vi.spyOn(manager, 'recordOutcome');
    const slow = {
      toString(): string {
        vi.advanceTimersByTime(100);
        return 'slow';
      },
    };
    const callId = observer.observeStart('tool_slow');
    vi.advanceTimersByTime(50);

    await observer.observeError(callId, slow as unknown as Error);

    expect(recordOutcome.mock.calls).toStrictEqual([
      ['tool_slow', { outcome: 'failure', errorMessage: 'slow', durationMs: 50 }],
    ]);
  });

  it('fires events for start / complete / error / partial', async () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    observer.events.on('toolCall:start', (p) => events.push({ event: 'start', payload: p }));
    observer.events.on('toolCall:complete', (p) => events.push({ event: 'complete', payload: p }));
    observer.events.on('toolCall:error', (p) => events.push({ event: 'error', payload: p }));
    observer.events.on('toolCall:partial', (p) => events.push({ event: 'partial', payload: p }));

    const c1 = observer.observeStart('t1');
    await observer.observeComplete(c1);
    const c2 = observer.observeStart('t2');
    await observer.observeError(c2, 'oops');
    const c3 = observer.observeStart('t3');
    await observer.observePartial(c3, 'half-done');

    expect(events.map((e) => e.event)).toEqual([
      'start', 'complete', 'start', 'error', 'start', 'partial',
    ]);
  });

  it('inFlightCount drops after each completion', async () => {
    const a = observer.observeStart('a');
    const b = observer.observeStart('b');
    expect(observer.inFlightCount()).toBe(2);
    await observer.observeComplete(a);
    expect(observer.inFlightCount()).toBe(1);
    await observer.observeError(b, 'x');
    expect(observer.inFlightCount()).toBe(0);
  });
});
