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
