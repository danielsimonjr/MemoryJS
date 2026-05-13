/**
 * ProspectiveMemoryManager Unit Tests
 *
 * Tests for prospective memory — intention-to-act / future-tense memory.
 *
 * Design decisions enforced by these tests (from
 * docs/roadmap/MEMORY_TYPES_EXPANSION.md §6 + review findings):
 *
 *   D1 — `action: 'invoke'` uses dependency injection (callback in
 *        constructor). Invoker rejections surface on
 *        `FiredEvent.invocationError` without unwinding the fire.
 *   D2 — `cancelOnEvent` uses OR (first-match) semantics; cancel beats
 *        fire when both match.
 *   D3 — Default visibility is 'private'.
 *
 * All timing tests use explicit `tick(new Date(...))` injection — no
 * `setTimeout` sleeps (Windows-flaky).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProspectiveMemoryManager } from '../../../src/agent/ProspectiveMemoryManager.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { ProspectiveEntity } from '../../../src/types/agent-memory.js';
import { isProspectiveMemory } from '../../../src/types/agent-memory.js';

/** Minimal mock storage matching ProspectiveMemoryManager's surface. */
function createMockStorage(
  initialEntities: Entity[] = [],
  initialRelations: Relation[] = []
): IGraphStorage {
  const entities: Entity[] = [...initialEntities];
  const relations: Relation[] = [...initialRelations];

  return {
    appendEntity: vi.fn(async (entity: Entity) => {
      entities.push(entity);
    }),
    appendRelation: vi.fn(async (relation: Relation) => {
      relations.push(relation);
    }),
    loadGraph: vi.fn(async () => ({ entities, relations })),
    getEntityByName: vi.fn((name: string) => entities.find((e) => e.name === name)),
    getRelationsFrom: vi.fn((name: string) => relations.filter((r) => r.from === name)),
    getRelationsTo: vi.fn((name: string) => relations.filter((r) => r.to === name)),
    saveGraph: vi.fn(async (graph: { entities: Entity[]; relations: Relation[] }) => {
      entities.length = 0;
      entities.push(...graph.entities);
      relations.length = 0;
      relations.push(...graph.relations);
    }),
    updateEntity: vi.fn(async (name: string, updates: Partial<Entity>) => {
      const idx = entities.findIndex((e) => e.name === name);
      if (idx === -1) return false;
      entities[idx] = { ...entities[idx], ...updates };
      return true;
    }),
    deleteEntity: vi.fn(async () => true),
    deleteRelation: vi.fn(async () => true),
    clear: vi.fn(async () => {}),
  } as unknown as IGraphStorage;
}

/** Helper: convenient future Date factory used by tick-injection tests. */
const futureDate = (msFromNow: number): Date => new Date(Date.now() + msFromNow);

describe('ProspectiveMemoryManager', () => {
  let storage: IGraphStorage;
  let pmm: ProspectiveMemoryManager;

  beforeEach(() => {
    storage = createMockStorage();
    pmm = new ProspectiveMemoryManager(storage);
  });

  // ==================== scheduleAt ====================

  describe('scheduleAt', () => {
    it('creates a prospective entity with kind="time" trigger', async () => {
      const at = futureDate(60_000);
      const entity = await pmm.scheduleAt('Send daily standup brief', at, {
        sessionId: 'session_a',
      });
      expect(entity.memoryType).toBe('prospective');
      expect(entity.trigger.kind).toBe('time');
      if (entity.trigger.kind === 'time') {
        expect(entity.trigger.at).toBe(at.toISOString());
      }
      expect(entity.lifecycle.status).toBe('pending');
      expect(entity.lifecycle.fireCount).toBe(0);
      expect(entity.sessionId).toBe('session_a');
    });

    it('defaults visibility to private (D3)', async () => {
      const entity = await pmm.scheduleAt('reminder', futureDate(60_000));
      expect(entity.visibility).toBe('private');
    });

    it('rejects scheduling with a past timestamp', async () => {
      await expect(pmm.scheduleAt('rewind', new Date(Date.now() - 60_000))).rejects.toThrow(/future/i);
    });

    it('rejects scheduling at exactly now (boundary)', async () => {
      const now = new Date();
      await expect(pmm.scheduleAt('now', now)).rejects.toThrow(/future/i);
    });

    it('defaults action to inject-context when not specified', async () => {
      const entity = await pmm.scheduleAt('default-action', futureDate(60_000));
      expect(entity.action.kind).toBe('inject-context');
    });

    it('honours custom confidence and importance', async () => {
      const entity = await pmm.scheduleAt('weighted', futureDate(60_000), {
        importance: 9,
        confidence: 0.5,
      });
      expect(entity.importance).toBe(9);
      expect(entity.confidence).toBe(0.5);
    });
  });

  // ==================== scheduleOnEvent ====================

  describe('scheduleOnEvent', () => {
    it('creates an entity with kind="event" trigger', async () => {
      const entity = await pmm.scheduleOnEvent(
        'Remind about migration',
        { tags: ['migration', 'plan'] },
        { sessionId: 'project_x' }
      );
      expect(entity.trigger.kind).toBe('event');
      if (entity.trigger.kind === 'event') {
        expect(entity.trigger.condition.tags).toEqual(['migration', 'plan']);
      }
    });

    it('supports maxFireCount cap for recurring intentions', async () => {
      const entity = await pmm.scheduleOnEvent(
        'one-shot',
        { tags: ['oneshot'] },
        { maxFireCount: 1 }
      );
      expect(entity.maxFireCount).toBe(1);
      expect(entity.lifecycle.fireCount).toBe(0);
    });

    it('rejects maxFireCount of 0 (positive-int brand)', async () => {
      await expect(
        pmm.scheduleOnEvent('bad', { tags: ['t'] }, { maxFireCount: 0 })
      ).rejects.toThrow(/positive integer/i);
    });

    it('rejects negative maxFireCount', async () => {
      await expect(
        pmm.scheduleOnEvent('bad', { tags: ['t'] }, { maxFireCount: -1 })
      ).rejects.toThrow(/positive integer/i);
    });
  });

  // ==================== scheduleConditional ====================

  describe('scheduleConditional', () => {
    it('creates an entity with kind="conditional" trigger', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const entity = await pmm.scheduleConditional(
        'count check',
        'observation_count(project-x) > 100',
        { checkIntervalMs: 3600_000 }
      );
      expect(entity.trigger.kind).toBe('conditional');
      if (entity.trigger.kind === 'conditional') {
        expect(entity.trigger.predicate).toBe('observation_count(project-x) > 100');
        expect(entity.trigger.checkIntervalMs).toBe(3600_000);
      }
      warnSpy.mockRestore();
    });

    it('warns once when scheduleConditional is called (stub API)', async () => {
      // logger.warn writes to console.error per repo logger convention
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await pmm.scheduleConditional('first', 'a');
      await pmm.scheduleConditional('second', 'b');
      // Warning emitted at most once across multiple calls (per-instance gate)
      expect(warnSpy.mock.calls.filter((c) => String(c[0]).includes('not implemented')).length).toBe(1);
      warnSpy.mockRestore();
    });
  });

  // ==================== getPending / getFired ====================

  describe('getPending / getFired', () => {
    it('returns pending intentions sorted by next fire time', async () => {
      const base = Date.now();
      await pmm.scheduleAt('B', new Date(base + 60_000), { sessionId: 'sess' });
      await pmm.scheduleAt('A', new Date(base + 30_000), { sessionId: 'sess' });
      await pmm.scheduleAt('C', new Date(base + 120_000), { sessionId: 'sess' });

      const pending = await pmm.getPending({ sessionId: 'sess' });
      expect(pending.map((p) => p.observations[0])).toEqual(['A', 'B', 'C']);
    });

    it('filters by sessionId', async () => {
      await pmm.scheduleAt('alpha', futureDate(60_000), { sessionId: 'one' });
      await pmm.scheduleAt('beta', futureDate(60_000), { sessionId: 'two' });
      const pending = await pmm.getPending({ sessionId: 'one' });
      expect(pending).toHaveLength(1);
      expect(pending[0].observations[0]).toBe('alpha');
    });

    it('returns empty for a fresh session', async () => {
      const pending = await pmm.getPending({ sessionId: 'nothing' });
      expect(pending).toEqual([]);
    });

    it('getFired returns only fired intentions', async () => {
      const at = futureDate(1000);
      const e = await pmm.scheduleAt('past-due', at, { sessionId: 's' });
      const fired = await pmm.tick(new Date(at.getTime() + 1));
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe(e.name);

      const firedQuery = await pmm.getFired({ sessionId: 's' });
      expect(firedQuery).toHaveLength(1);
      expect(firedQuery[0].lifecycle.status).toBe('fired');
      expect(await pmm.getPending({ sessionId: 's' })).toEqual([]);
    });

    it('getFired respects sinceDate filter', async () => {
      const at1 = futureDate(1000);
      const at2 = futureDate(2000);
      await pmm.scheduleAt('early', at1, { sessionId: 's' });
      await pmm.scheduleAt('late', at2, { sessionId: 's' });
      // Fire both
      await pmm.tick(new Date(at1.getTime() + 1));
      await pmm.tick(new Date(at2.getTime() + 1));
      // Only "late" should pass a sinceDate just after at1
      const recent = await pmm.getFired({
        sessionId: 's',
        sinceDate: new Date(at1.getTime() + 2),
      });
      expect(recent).toHaveLength(1);
      expect(recent[0].observations[0]).toBe('late');
    });
  });

  // ==================== tick — time triggers ====================

  describe('tick (time triggers)', () => {
    it('fires intentions whose trigger.at is past', async () => {
      const at = futureDate(1000);
      const e = await pmm.scheduleAt('fire-me', at);
      const fired = await pmm.tick(new Date(at.getTime() + 1));
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe(e.name);
      expect(fired[0].entity.lifecycle.status).toBe('fired');
      if (fired[0].entity.lifecycle.status === 'fired') {
        expect(fired[0].entity.lifecycle.firedAt).toBeDefined();
      }
    });

    it('does not fire intentions still in the future', async () => {
      await pmm.scheduleAt('future', futureDate(60_000));
      const fired = await pmm.tick();
      expect(fired).toEqual([]);
    });

    it('is idempotent — fires each intention exactly once', async () => {
      const at = futureDate(1000);
      await pmm.scheduleAt('once', at);
      const fired1 = await pmm.tick(new Date(at.getTime() + 1));
      const fired2 = await pmm.tick(new Date(at.getTime() + 1));
      expect(fired1).toHaveLength(1);
      expect(fired2).toEqual([]);
    });

    it('builds injectionPayload for inject-context action', async () => {
      const at = futureDate(1000);
      await pmm.scheduleAt('payload-content', at);
      const fired = await pmm.tick(new Date(at.getTime() + 1));
      expect(fired[0].injectionPayload).toContain('payload-content');
    });

    it('fires multiple intentions in chronological order', async () => {
      const base = Date.now();
      const a = await pmm.scheduleAt('A', new Date(base + 100));
      const b = await pmm.scheduleAt('B', new Date(base + 200));
      const c = await pmm.scheduleAt('C', new Date(base + 300));
      const fired = await pmm.tick(new Date(base + 1000));
      expect(fired.map((f) => f.entity.name)).toEqual([a.name, b.name, c.name]);
    });
  });

  // ==================== tick — time-window triggers ====================

  describe('tick (time-window triggers)', () => {
    // time-window triggers can't be directly created via the public API in
    // this MVP (only time / event / conditional schedule methods exist),
    // so we exercise the shouldFireOnTick branch via a pre-populated mock.

    it('fires kind="time-window" within [from, until)', async () => {
      const base = Date.now();
      const from = new Date(base + 1000).toISOString();
      const until = new Date(base + 5000).toISOString();
      // Seed a time-window entity directly
      const seeded: ProspectiveEntity = {
        name: 'tw_1',
        entityType: 'prospective',
        observations: ['within-window'],
        createdAt: new Date(base).toISOString(),
        lastModified: new Date(base).toISOString(),
        importance: 5,
        memoryType: 'prospective',
        sessionId: undefined,
        agentId: undefined,
        visibility: 'private',
        accessCount: 0,
        confidence: 0.9,
        confirmationCount: 0,
        expiresAt: new Date(base + 999_999).toISOString(),
        trigger: { kind: 'time-window', from: from as never, until: until as never },
        action: { kind: 'inject-context' },
        lifecycle: { status: 'pending', fireCount: 0 },
      } as ProspectiveEntity;
      await storage.appendEntity(seeded as unknown as Entity);

      // Inside window
      const fired = await pmm.tick(new Date(base + 2000));
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe('tw_1');
    });

    it('does NOT fire kind="time-window" once until is past', async () => {
      const base = Date.now();
      const from = new Date(base + 1000).toISOString();
      const until = new Date(base + 5000).toISOString();
      const seeded: ProspectiveEntity = {
        name: 'tw_2',
        entityType: 'prospective',
        observations: ['past-window'],
        createdAt: new Date(base).toISOString(),
        lastModified: new Date(base).toISOString(),
        importance: 5,
        memoryType: 'prospective',
        sessionId: undefined,
        agentId: undefined,
        visibility: 'private',
        accessCount: 0,
        confidence: 0.9,
        confirmationCount: 0,
        expiresAt: new Date(base + 999_999).toISOString(),
        trigger: { kind: 'time-window', from: from as never, until: until as never },
        action: { kind: 'inject-context' },
        lifecycle: { status: 'pending', fireCount: 0 },
      } as ProspectiveEntity;
      await storage.appendEntity(seeded as unknown as Entity);

      // After window
      const fired = await pmm.tick(new Date(base + 6000));
      expect(fired).toEqual([]);
    });
  });

  // ==================== onObservation ====================

  describe('onObservation', () => {
    it('fires when observation tags match', async () => {
      const e = await pmm.scheduleOnEvent('match', { tags: ['important'] });
      const fired = await pmm.onObservation('any text', { tags: ['important', 'other'] });
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe(e.name);
    });

    it('does not fire when no tags match', async () => {
      await pmm.scheduleOnEvent('no-match', { tags: ['important'] });
      const fired = await pmm.onObservation('any text', { tags: ['unrelated'] });
      expect(fired).toEqual([]);
    });

    it('matches on entityType (OR with tags)', async () => {
      const e = await pmm.scheduleOnEvent('type-match', { entityType: 'project' });
      const fired = await pmm.onObservation('text', { entityType: 'project' });
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe(e.name);
    });

    it('matches on substring text', async () => {
      const e = await pmm.scheduleOnEvent('text-match', { text: 'migration' });
      const fired = await pmm.onObservation('discussing the migration plan', {
        // need an OR-eligible field for typing — pass a tag that won't match
        tags: ['unused'],
      } as never);
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe(e.name);
    });

    it('matches on sessionId field', async () => {
      const e = await pmm.scheduleOnEvent('session-match', { sessionId: 'sess-1' });
      const fired = await pmm.onObservation('text', { sessionId: 'sess-1' });
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe(e.name);
    });

    it('respects maxFireCount cap', async () => {
      await pmm.scheduleOnEvent('capped', { tags: ['fire'] }, { maxFireCount: 2 });
      const a = await pmm.onObservation('x', { tags: ['fire'] });
      const b = await pmm.onObservation('y', { tags: ['fire'] });
      const c = await pmm.onObservation('z', { tags: ['fire'] });
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(c).toEqual([]); // status is now 'expired' so it's not in getPending
    });
  });

  // ==================== Session cap ====================

  describe('maxPendingPerSession cap', () => {
    it('rejects schedule when session has hit cap', async () => {
      const tightPmm = new ProspectiveMemoryManager(storage, { maxPendingPerSession: 2 });
      await tightPmm.scheduleAt('a', futureDate(60_000), { sessionId: 's' });
      await tightPmm.scheduleAt('b', futureDate(60_000), { sessionId: 's' });
      await expect(
        tightPmm.scheduleAt('c', futureDate(60_000), { sessionId: 's' })
      ).rejects.toThrow(/max pending cap/i);
    });

    it('cap is per-session', async () => {
      const tightPmm = new ProspectiveMemoryManager(storage, { maxPendingPerSession: 1 });
      await tightPmm.scheduleAt('a1', futureDate(60_000), { sessionId: 'session-1' });
      await tightPmm.scheduleAt('a2', futureDate(60_000), { sessionId: 'session-2' });
      // Both succeeded; no error
      const pending1 = await tightPmm.getPending({ sessionId: 'session-1' });
      const pending2 = await tightPmm.getPending({ sessionId: 'session-2' });
      expect(pending1).toHaveLength(1);
      expect(pending2).toHaveLength(1);
    });
  });

  // ==================== cancel — discriminated returns ====================

  describe('cancel (CancelResult)', () => {
    it('returns "cancelled" on a pending intention', async () => {
      const e = await pmm.scheduleAt('cancel-me', futureDate(60_000));
      const result = await pmm.cancel(e.name);
      expect(result).toBe('cancelled');
      const stored = await storage.getEntityByName(e.name);
      expect((stored as ProspectiveEntity).lifecycle.status).toBe('cancelled');
    });

    it('returns "not-found" for a typo / unknown name', async () => {
      const result = await pmm.cancel('does-not-exist');
      expect(result).toBe('not-found');
    });

    it('returns "already-fired" on a fired intention', async () => {
      const at = futureDate(1000);
      const e = await pmm.scheduleAt('fired', at);
      await pmm.tick(new Date(at.getTime() + 1));
      const result = await pmm.cancel(e.name);
      expect(result).toBe('already-fired');
    });

    it('returns "already-cancelled" on second cancel', async () => {
      const e = await pmm.scheduleAt('twice', futureDate(60_000));
      await pmm.cancel(e.name);
      const result = await pmm.cancel(e.name);
      expect(result).toBe('already-cancelled');
    });
  });

  // ==================== expireOverdue ====================

  describe('expireOverdue', () => {
    it('marks intentions past expiresAt as expired', async () => {
      const e = await pmm.scheduleAt('overdue', futureDate(60_000), { sessionId: 's' });
      await storage.updateEntity(e.name, {
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const count = await pmm.expireOverdue();
      expect(count).toBe(1);
      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.lifecycle.status).toBe('expired');
    });

    it('does nothing for intentions without expiresAt', async () => {
      const e = await pmm.scheduleAt('no-exp', futureDate(60_000));
      await storage.updateEntity(e.name, { expiresAt: undefined } as Partial<Entity>);
      const count = await pmm.expireOverdue();
      expect(count).toBe(0);
      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.lifecycle.status).toBe('pending');
    });

    it('skips and warns on malformed expiresAt', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const e = await pmm.scheduleAt('malformed', futureDate(60_000));
      await storage.updateEntity(e.name, { expiresAt: 'not-an-iso-string' } as Partial<Entity>);
      const count = await pmm.expireOverdue();
      expect(count).toBe(0);
      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.lifecycle.status).toBe('pending');
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('malformed'))).toBe(true);
      warnSpy.mockRestore();
    });
  });

  // ==================== D1 — invoke action via DI callback ====================

  describe('D1: action="invoke" via dependency injection', () => {
    it('calls procedureInvoker when invoke action fires', async () => {
      const invoker = vi.fn(async (_id: string) => {});
      const pmmWithInvoker = new ProspectiveMemoryManager(storage, {
        procedureInvoker: invoker,
      });
      await pmmWithInvoker.scheduleOnEvent(
        'invoke-test',
        { tags: ['go'] },
        { action: { kind: 'invoke', procedureId: 'cleanup-proc' } }
      );
      const fired = await pmmWithInvoker.onObservation('any', { tags: ['go'] });
      expect(fired).toHaveLength(1);
      expect(fired[0].invokedProcedureId).toBe('cleanup-proc');
      expect(invoker).toHaveBeenCalledWith('cleanup-proc', expect.anything());
    });

    it('does not call invoker for inject-context action', async () => {
      const invoker = vi.fn(async () => {});
      const pmmWithInvoker = new ProspectiveMemoryManager(storage, {
        procedureInvoker: invoker,
      });
      await pmmWithInvoker.scheduleOnEvent('ic', { tags: ['t'] });
      await pmmWithInvoker.onObservation('any', { tags: ['t'] });
      expect(invoker).not.toHaveBeenCalled();
    });

    it('surfaces invoker rejection on FiredEvent.invocationError', async () => {
      const invoker = vi.fn(async () => {
        throw new Error('downstream boom');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const pmmWithInvoker = new ProspectiveMemoryManager(storage, {
        procedureInvoker: invoker,
      });
      await pmmWithInvoker.scheduleOnEvent(
        'invoke-fail',
        { tags: ['go'] },
        { action: { kind: 'invoke', procedureId: 'p' } }
      );
      const fired = await pmmWithInvoker.onObservation('any', { tags: ['go'] });
      expect(fired).toHaveLength(1);
      expect(fired[0].invokedProcedureId).toBe('p');
      expect(fired[0].invocationError).toBeInstanceOf(Error);
      expect(fired[0].invocationError?.message).toBe('downstream boom');
      // Entity still ran through the fire path despite invoker rejection —
      // event-based recurring intentions stay 'pending' with fireCount > 0.
      expect(fired[0].entity.lifecycle.fireCount).toBe(1);
      warnSpy.mockRestore();
    });

    it('graceful when invoker absent', async () => {
      await pmm.scheduleOnEvent(
        'no-invoker',
        { tags: ['t'] },
        { action: { kind: 'invoke', procedureId: 'p' } }
      );
      const fired = await pmm.onObservation('any', { tags: ['t'] });
      expect(fired).toHaveLength(1);
      expect(fired[0].invokedProcedureId).toBe('p');
      expect(fired[0].invocationError).toBeUndefined();
    });
  });

  // ==================== tag-related action ====================

  describe('action="tag-related"', () => {
    it('adds tags to matching entities and reports their names', async () => {
      // Seed two non-prospective entities to be tagged
      await storage.appendEntity({
        name: 'doc-1',
        entityType: 'document',
        observations: ['some doc'],
        tags: ['existing'],
      } as Entity);
      await storage.appendEntity({
        name: 'doc-2',
        entityType: 'document',
        observations: ['another doc'],
      } as Entity);
      // And a non-matching one
      await storage.appendEntity({
        name: 'other',
        entityType: 'person',
        observations: ['someone'],
      } as Entity);

      await pmm.scheduleOnEvent(
        'tag-em',
        { tags: ['fire'] },
        {
          action: {
            kind: 'tag-related',
            tagsToAdd: ['stale'],
            relatedEntityFilter: { entityType: 'document' },
          },
        }
      );
      const fired = await pmm.onObservation('any', { tags: ['fire'] });
      expect(fired).toHaveLength(1);
      expect(fired[0].taggedEntityNames?.sort()).toEqual(['doc-1', 'doc-2']);

      const doc1 = (await storage.getEntityByName('doc-1')) as Entity;
      expect(doc1.tags).toContain('existing');
      expect(doc1.tags).toContain('stale');
      const doc2 = (await storage.getEntityByName('doc-2')) as Entity;
      expect(doc2.tags).toContain('stale');
      const other = (await storage.getEntityByName('other')) as Entity;
      expect(other.tags ?? []).not.toContain('stale');
    });

    it('does not re-tag entities that already have the tag', async () => {
      await storage.appendEntity({
        name: 'doc-1',
        entityType: 'document',
        observations: ['x'],
        tags: ['existing'],
      } as Entity);
      await pmm.scheduleOnEvent(
        'noop',
        { tags: ['fire'] },
        {
          action: {
            kind: 'tag-related',
            tagsToAdd: ['existing'],
            relatedEntityFilter: { entityType: 'document' },
          },
        }
      );
      const fired = await pmm.onObservation('any', { tags: ['fire'] });
      expect(fired[0].taggedEntityNames).toEqual([]);
    });
  });

  // ==================== D2 — cancelOnEvent OR semantics ====================

  describe('D2: cancelOnEvent OR (first-match) semantics', () => {
    it('cancels when ANY tag in cancelOnEvent matches', async () => {
      const e = await pmm.scheduleOnEvent(
        'cancel-by-or',
        { tags: ['fire'] },
        { cancelOnEvent: { tags: ['stop', 'halt'] } }
      );
      await pmm.onObservation('any', { tags: ['halt'] });
      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.lifecycle.status).toBe('cancelled');
    });

    it('does not cancel when no cancelOnEvent field matches', async () => {
      const e = await pmm.scheduleOnEvent(
        'no-cancel',
        { tags: ['fire'] },
        { cancelOnEvent: { tags: ['stop'] } }
      );
      await pmm.onObservation('any', { tags: ['unrelated'] });
      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.lifecycle.status).toBe('pending');
    });

    it('cancel takes precedence over fire when both match', async () => {
      const e = await pmm.scheduleOnEvent(
        'cancel-wins',
        { tags: ['fire'] },
        { cancelOnEvent: { tags: ['fire'] } }
      );
      const fired = await pmm.onObservation('any', { tags: ['fire'] });
      expect(fired).toEqual([]);
      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.lifecycle.status).toBe('cancelled');
    });
  });

  // ==================== Storage failure propagation ====================

  describe('storage failure propagation', () => {
    it('propagates updateEntity rejection from tick cleanly', async () => {
      const failingStorage = createMockStorage();
      const pmmF = new ProspectiveMemoryManager(failingStorage);
      const at = futureDate(1000);
      await pmmF.scheduleAt('will-fail', at);
      (failingStorage.updateEntity as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('disk full')
      );
      await expect(pmmF.tick(new Date(at.getTime() + 1))).rejects.toThrow(/disk full/);
    });
  });

  // ==================== Type guard ====================

  describe('isProspectiveMemory type guard', () => {
    it('returns true for a prospective entity', async () => {
      const e = await pmm.scheduleAt('check', futureDate(60_000));
      expect(isProspectiveMemory(e)).toBe(true);
    });

    it('returns false for non-prospective entities', () => {
      expect(isProspectiveMemory({ memoryType: 'episodic' })).toBe(false);
      expect(isProspectiveMemory(null)).toBe(false);
      expect(isProspectiveMemory(undefined)).toBe(false);
      // Missing lifecycle: still rejects
      expect(
        isProspectiveMemory({
          name: 'x',
          entityType: 'prospective',
          memoryType: 'prospective',
          accessCount: 0,
          confidence: 0.9,
          confirmationCount: 0,
          visibility: 'private',
        })
      ).toBe(false);
    });
  });
});
