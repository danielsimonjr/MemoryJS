/**
 * ProspectiveMemoryManager Unit Tests
 *
 * Tests for prospective memory — intention-to-act / future-tense memory.
 *
 * Design decisions enforced by these tests (from
 * docs/roadmap/MEMORY_TYPES_EXPANSION.md §6):
 *
 *   D1 — `action: 'invoke'` uses dependency injection (callback in
 *        constructor), not direct ProcedureManager import. Tests pass
 *        a stub `procedureInvoker` and assert it was called with the
 *        right id.
 *   D2 — `cancelOnEvent` uses OR (first-match) semantics — matches
 *        TriggerCondition firing semantics.
 *   D3 — Default visibility is 'private'.
 *   D4 — N/A at this level (test-only concerns are library; MCP/CLI
 *        ship separately).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProspectiveMemoryManager } from '../../../src/agent/ProspectiveMemoryManager.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { ProspectiveEntity } from '../../../src/types/agent-memory.js';
import { isProspectiveMemory } from '../../../src/types/agent-memory.js';

/**
 * Minimal mock storage matching the surface that ProspectiveMemoryManager uses.
 *
 * Method choice mirrors EpisodicMemoryManager.test.ts conventions:
 * appendEntity / loadGraph / getEntityByName / updateEntity / saveGraph.
 */
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
    loadGraph: vi.fn(async () => ({
      entities,
      relations,
    })),
    getEntityByName: vi.fn((name: string) => {
      return entities.find((e) => e.name === name);
    }),
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

describe('ProspectiveMemoryManager', () => {
  let storage: IGraphStorage;
  let pmm: ProspectiveMemoryManager;

  beforeEach(() => {
    storage = createMockStorage();
    pmm = new ProspectiveMemoryManager(storage);
  });

  // ==================== scheduleAt — time-based triggers ====================

  describe('scheduleAt', () => {
    it('creates a prospective entity with kind="time" trigger', async () => {
      const at = new Date(Date.now() + 60_000);
      const entity = await pmm.scheduleAt('Send daily standup brief', at, {
        sessionId: 'session_a',
      });

      expect(entity.memoryType).toBe('prospective');
      expect(entity.trigger.kind).toBe('time');
      if (entity.trigger.kind === 'time') {
        expect(entity.trigger.at).toBe(at.toISOString());
      }
      expect(entity.status).toBe('pending');
      expect(entity.sessionId).toBe('session_a');
    });

    it('defaults visibility to private (D3)', async () => {
      const at = new Date(Date.now() + 60_000);
      const entity = await pmm.scheduleAt('reminder', at);
      expect(entity.visibility).toBe('private');
    });

    it('rejects scheduling with a past timestamp', async () => {
      const at = new Date(Date.now() - 60_000);
      await expect(pmm.scheduleAt('rewind', at)).rejects.toThrow(/past|future/i);
    });

    it('defaults action to inject-context when not specified', async () => {
      const at = new Date(Date.now() + 60_000);
      const entity = await pmm.scheduleAt('default-action', at);
      expect(entity.action.kind).toBe('inject-context');
    });
  });

  // ==================== scheduleOnEvent — event-based triggers ====================

  describe('scheduleOnEvent', () => {
    it('creates a prospective entity with kind="event" trigger', async () => {
      const entity = await pmm.scheduleOnEvent(
        'Remind about migration deadline',
        { tags: ['migration', 'plan'] },
        { sessionId: 'project_x' }
      );

      expect(entity.trigger.kind).toBe('event');
      if (entity.trigger.kind === 'event') {
        expect(entity.trigger.condition.tags).toEqual(['migration', 'plan']);
      }
      expect(entity.status).toBe('pending');
    });

    it('supports maxFireCount cap for recurring intentions', async () => {
      const entity = await pmm.scheduleOnEvent(
        'one-shot reminder',
        { tags: ['oneshot'] },
        { maxFireCount: 1 }
      );
      expect(entity.maxFireCount).toBe(1);
      expect(entity.fireCount).toBe(0);
    });
  });

  // ==================== scheduleConditional — predicate triggers ====================

  describe('scheduleConditional', () => {
    it('creates a prospective entity with kind="conditional" trigger', async () => {
      const entity = await pmm.scheduleConditional(
        'observation count check',
        'observation_count(project-x) > 100',
        { checkIntervalMs: 3600_000 }
      );

      expect(entity.trigger.kind).toBe('conditional');
      if (entity.trigger.kind === 'conditional') {
        expect(entity.trigger.predicate).toBe('observation_count(project-x) > 100');
        expect(entity.trigger.checkIntervalMs).toBe(3600_000);
      }
    });
  });

  // ==================== getPending / getFired ====================

  describe('getPending / getFired', () => {
    it('returns pending intentions for a session, sorted by next fire time', async () => {
      const now = Date.now();
      const t1 = new Date(now + 60_000);
      const t2 = new Date(now + 120_000);
      const t3 = new Date(now + 30_000);

      await pmm.scheduleAt('B', t1, { sessionId: 'sess' });
      await pmm.scheduleAt('A', t3, { sessionId: 'sess' });
      await pmm.scheduleAt('C', t2, { sessionId: 'sess' });

      const pending = await pmm.getPending({ sessionId: 'sess' });
      expect(pending).toHaveLength(3);
      expect(pending[0].observations[0]).toBe('A'); // earliest at
      expect(pending[1].observations[0]).toBe('B');
      expect(pending[2].observations[0]).toBe('C');
    });

    it('filters by sessionId', async () => {
      await pmm.scheduleAt('alpha', new Date(Date.now() + 60_000), { sessionId: 'one' });
      await pmm.scheduleAt('beta', new Date(Date.now() + 60_000), { sessionId: 'two' });

      const pending = await pmm.getPending({ sessionId: 'one' });
      expect(pending).toHaveLength(1);
      expect(pending[0].observations[0]).toBe('alpha');
    });

    it('returns no pending intentions for a fresh session', async () => {
      const pending = await pmm.getPending({ sessionId: 'nothing-here' });
      expect(pending).toEqual([]);
    });

    it('getFired returns only fired intentions', async () => {
      const entity = await pmm.scheduleAt(
        'past-due',
        new Date(Date.now() + 50),
        { sessionId: 's' }
      );
      // Wait past trigger
      await new Promise((r) => setTimeout(r, 100));
      const fired = await pmm.tick();
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe(entity.name);

      const firedQuery = await pmm.getFired({ sessionId: 's' });
      expect(firedQuery).toHaveLength(1);
      expect(firedQuery[0].status).toBe('fired');

      const pending = await pmm.getPending({ sessionId: 's' });
      expect(pending).toEqual([]);
    });
  });

  // ==================== tick — time-based firing ====================

  describe('tick', () => {
    it('fires intentions whose trigger.at is past', async () => {
      const e = await pmm.scheduleAt(
        'fire-me',
        new Date(Date.now() + 50)
      );
      await new Promise((r) => setTimeout(r, 100));

      const fired = await pmm.tick();
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe(e.name);
      expect(fired[0].entity.status).toBe('fired');
      expect(fired[0].entity.firedAt).toBeDefined();
    });

    it('does not fire intentions still in the future', async () => {
      await pmm.scheduleAt('future', new Date(Date.now() + 60_000));
      const fired = await pmm.tick();
      expect(fired).toEqual([]);
    });

    it('is idempotent — fires each intention exactly once', async () => {
      await pmm.scheduleAt('once', new Date(Date.now() + 50));
      await new Promise((r) => setTimeout(r, 100));

      const fired1 = await pmm.tick();
      const fired2 = await pmm.tick();
      expect(fired1).toHaveLength(1);
      expect(fired2).toEqual([]);
    });

    it('builds injectionPayload for action: inject-context', async () => {
      const at = new Date(Date.now() + 50);
      await pmm.scheduleAt('payload-content', at);
      await new Promise((r) => setTimeout(r, 100));

      const fired = await pmm.tick();
      expect(fired[0].injectionPayload).toBeDefined();
      expect(fired[0].injectionPayload).toContain('payload-content');
    });
  });

  // ==================== onObservation — event-based firing ====================

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
      const fired = await pmm.onObservation('discussing the migration plan', {});
      expect(fired).toHaveLength(1);
      expect(fired[0].entity.name).toBe(e.name);
    });

    it('respects maxFireCount cap', async () => {
      await pmm.scheduleOnEvent(
        'capped',
        { tags: ['fire'] },
        { maxFireCount: 2 }
      );

      const a = await pmm.onObservation('x', { tags: ['fire'] });
      const b = await pmm.onObservation('y', { tags: ['fire'] });
      const c = await pmm.onObservation('z', { tags: ['fire'] });

      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(c).toEqual([]); // Cap reached — entity has status 'expired'
    });
  });

  // ==================== cancel ====================

  describe('cancel', () => {
    it('marks pending intention as cancelled', async () => {
      const e = await pmm.scheduleAt('cancel-me', new Date(Date.now() + 60_000));
      await pmm.cancel(e.name, 'user request');

      const pending = await pmm.getPending();
      expect(pending).toEqual([]);
      // Entity persists but with status='cancelled'
      const stored = await storage.getEntityByName(e.name);
      expect((stored as ProspectiveEntity).status).toBe('cancelled');
    });

    it('is a no-op on already-fired intention', async () => {
      const e = await pmm.scheduleAt('fired', new Date(Date.now() + 50));
      await new Promise((r) => setTimeout(r, 100));
      await pmm.tick();

      // Cancel on already-fired: should not change status from 'fired'
      await pmm.cancel(e.name);
      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.status).toBe('fired');
    });
  });

  // ==================== expireOverdue ====================

  describe('expireOverdue', () => {
    it('marks intentions past their default expiry as expired', async () => {
      // Schedule with a default expiry; the entity itself has an `expiresAt`
      // far enough in the past that `expireOverdue` flags it.
      const e = await pmm.scheduleAt(
        'overdue',
        new Date(Date.now() + 60_000),
        { sessionId: 's' }
      );
      // Manually back-date expiresAt to simulate an old, never-fired intention.
      await storage.updateEntity(e.name, {
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const expiredCount = await pmm.expireOverdue();
      expect(expiredCount).toBeGreaterThanOrEqual(1);
      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.status).toBe('expired');
    });
  });

  // ==================== D1 — invoke action uses DI callback ====================

  describe('D1: action="invoke" via dependency injection', () => {
    it('calls the procedureInvoker callback when invoke action fires', async () => {
      const invoker = vi.fn(async (_id: string) => {});
      const pmmWithInvoker = new ProspectiveMemoryManager(storage, {
        procedureInvoker: invoker,
      });

      // Schedule with invoke action via scheduleOnEvent (so we can trigger easily)
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

    it('does not call invoker when action is inject-context (default)', async () => {
      const invoker = vi.fn(async () => {});
      const pmmWithInvoker = new ProspectiveMemoryManager(storage, {
        procedureInvoker: invoker,
      });

      await pmmWithInvoker.scheduleOnEvent('ic', { tags: ['t'] });
      await pmmWithInvoker.onObservation('any', { tags: ['t'] });
      expect(invoker).not.toHaveBeenCalled();
    });

    it('does not crash when invoke action fires but no invoker is wired', async () => {
      // No procedureInvoker on `pmm` (the default beforeEach instance)
      await pmm.scheduleOnEvent(
        'no-invoker',
        { tags: ['t'] },
        { action: { kind: 'invoke', procedureId: 'p' } }
      );
      const fired = await pmm.onObservation('any', { tags: ['t'] });
      expect(fired).toHaveLength(1);
      // Procedure was "skipped" — entity is still fired, but no side effect
      expect(fired[0].invokedProcedureId).toBe('p');
    });
  });

  // ==================== D2 — cancelOnEvent uses OR semantics ====================

  describe('D2: cancelOnEvent uses OR (first-match) semantics', () => {
    it('cancels the intention when ANY tag in cancelOnEvent matches', async () => {
      const e = await pmm.scheduleOnEvent(
        'cancel-by-or',
        { tags: ['fire'] },
        { cancelOnEvent: { tags: ['stop', 'halt'] } }
      );

      // Observation has 'halt' — second tag in cancelOnEvent. Should cancel.
      await pmm.onObservation('any', { tags: ['halt'] });

      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.status).toBe('cancelled');
    });

    it('does not cancel when no cancelOnEvent field matches', async () => {
      const e = await pmm.scheduleOnEvent(
        'no-cancel',
        { tags: ['fire'] },
        { cancelOnEvent: { tags: ['stop'] } }
      );
      await pmm.onObservation('any', { tags: ['unrelated'] });

      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.status).toBe('pending');
    });

    it('cancel takes precedence over fire when both conditions match', async () => {
      // Trigger AND cancel both match the same observation — cancel wins.
      const e = await pmm.scheduleOnEvent(
        'cancel-wins',
        { tags: ['fire'] },
        { cancelOnEvent: { tags: ['fire'] } }
      );
      const fired = await pmm.onObservation('any', { tags: ['fire'] });

      expect(fired).toEqual([]); // No fire — cancelled instead
      const stored = (await storage.getEntityByName(e.name)) as ProspectiveEntity;
      expect(stored.status).toBe('cancelled');
    });
  });

  // ==================== Type guard ====================

  describe('isProspectiveMemory type guard', () => {
    it('returns true for a prospective entity', async () => {
      const e = await pmm.scheduleAt('check', new Date(Date.now() + 60_000));
      expect(isProspectiveMemory(e)).toBe(true);
    });

    it('returns false for non-prospective entities', () => {
      expect(isProspectiveMemory({ memoryType: 'episodic' })).toBe(false);
      expect(isProspectiveMemory(null)).toBe(false);
      expect(isProspectiveMemory(undefined)).toBe(false);
    });
  });
});
