/**
 * AgentReflectionManager — Phase 2 Sprint 8 Unit Tests
 *
 * Covers:
 * - create() validation, content-hash dedup, invariants
 * - list() filtering by scope / session / minConfidence / limit
 * - getRelevantForSession() evidence-overlap retrieval
 * - archive() discriminated MarkResolvedResult-style returns
 * - getAll() convenience
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentReflectionManager } from '../../../src/agent/AgentReflectionManager.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { Entity, KnowledgeGraph, IGraphStorage } from '../../../src/types/types.js';
import type { ReflectionEntity } from '../../../src/types/agent-memory.js';
import { isReflectionMemory } from '../../../src/types/agent-memory.js';
import { VersionConflictError, EntityNotFoundError } from '../../../src/utils/errors.js';
import { microtaskTicks } from '../../test-utils/microtask-ticks.js';

/** Minimal in-memory storage that satisfies the duck-typed `IGraphStorage` slice AgentReflectionManager needs. */
function createMockStorage(): IGraphStorage & {
  _entities: Map<string, Entity>;
} {
  const entities = new Map<string, Entity>();
  return {
    _entities: entities,
    async appendEntity(entity: Entity) {
      entities.set(entity.name, entity);
    },
    async updateEntity(name: string, updates: Partial<Entity>): Promise<boolean> {
      const current = entities.get(name);
      if (!current) return false;
      entities.set(name, { ...current, ...updates });
      return true;
    },
    getEntityByName(name: string): Entity | undefined {
      return entities.get(name);
    },
    async loadGraph(): Promise<KnowledgeGraph> {
      return { entities: Array.from(entities.values()), relations: [] };
    },
    // Stubs for unused methods (kept loose; AgentReflectionManager touches few of these)
    async getGraphForMutation() {
      return { entities: Array.from(entities.values()), relations: [] };
    },
    async saveGraph(g: KnowledgeGraph) {
      entities.clear();
      for (const e of g.entities) entities.set(e.name, e);
    },
  } as unknown as IGraphStorage & { _entities: Map<string, Entity> };
}

/** Fake EntityManager mirroring `updateEntity` OCC semantics. */
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
  } as unknown as EntityManager;
}

describe('AgentReflectionManager', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let entityManager: EntityManager;
  let rm: AgentReflectionManager;

  beforeEach(() => {
    storage = createMockStorage();
    entityManager = createFakeEntityManager(storage);
    rm = new AgentReflectionManager(storage, entityManager);
  });

  describe('create', () => {
    it('persists a ReflectionEntity with the input data', async () => {
      const rec = await rm.create({
        scope: 'session',
        evidence: ['entity_a', 'entity_b'],
        summary: 'pattern: morning planning then afternoon execution',
        generalization_confidence: 0.85,
      });

      expect(rec.id).toMatch(/^reflection-/);
      expect(rec.scope).toBe('session');
      expect(rec.evidence).toEqual(['entity_a', 'entity_b']);
      expect(rec.generalization_confidence).toBe(0.85);

      const stored = storage.getEntityByName(rec.id) as ReflectionEntity | undefined;
      expect(stored).toBeDefined();
      expect(isReflectionMemory(stored)).toBe(true);
      expect(stored?.memoryType).toBe('reflection');
    });

    it('rejects empty evidence array', async () => {
      await expect(
        rm.create({
          scope: 'session',
          evidence: [],
          summary: 'foo',
          generalization_confidence: 0.5,
        })
      ).rejects.toThrow(/evidence/i);
    });

    it('rejects empty summary', async () => {
      await expect(
        rm.create({
          scope: 'session',
          evidence: ['a'],
          summary: '',
          generalization_confidence: 0.5,
        })
      ).rejects.toThrow(/summary/i);
    });

    it('rejects out-of-range generalization_confidence', async () => {
      await expect(
        rm.create({
          scope: 'session',
          evidence: ['a'],
          summary: 'x',
          generalization_confidence: 1.5,
        })
      ).rejects.toThrow(/generalization_confidence/i);
      await expect(
        rm.create({
          scope: 'session',
          evidence: ['a'],
          summary: 'x',
          generalization_confidence: -0.1,
        })
      ).rejects.toThrow(/generalization_confidence/i);
    });

    it('content-hash dedups identical evidence+scope (returns existing record)', async () => {
      const first = await rm.create({
        scope: 'project',
        evidence: ['e1', 'e2'],
        summary: 'first reflection',
        generalization_confidence: 0.7,
      });
      const second = await rm.create({
        scope: 'project',
        evidence: ['e2', 'e1'], // same set, different order
        summary: 'duplicate attempt',
        generalization_confidence: 0.9,
      });
      expect(second.id).toBe(first.id);
      expect(second.summary).toBe('first reflection'); // not overwritten
    });

    it('does NOT dedup when scope differs', async () => {
      await rm.create({
        scope: 'session',
        evidence: ['e1', 'e2'],
        summary: 'session-level',
        generalization_confidence: 0.7,
      });
      const projectScoped = await rm.create({
        scope: 'project',
        evidence: ['e1', 'e2'],
        summary: 'project-level',
        generalization_confidence: 0.7,
      });
      expect(projectScoped.summary).toBe('project-level');
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await rm.create({
        scope: 'session',
        evidence: ['a'],
        summary: 'session high-conf',
        generalization_confidence: 0.9,
        sourceSessionId: 'sess_1',
      });
      await rm.create({
        scope: 'project',
        evidence: ['b'],
        summary: 'project low-conf',
        generalization_confidence: 0.3,
      });
      await rm.create({
        scope: 'global',
        evidence: ['c'],
        summary: 'global mid-conf',
        generalization_confidence: 0.6,
      });
    });

    it('returns all when no filter', async () => {
      const all = await rm.list();
      expect(all).toHaveLength(3);
    });

    it('filters by scope', async () => {
      const sessions = await rm.list({ scope: 'session' });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].summary).toBe('session high-conf');
    });

    it('filters by minConfidence', async () => {
      const highConf = await rm.list({ minConfidence: 0.5 });
      expect(highConf).toHaveLength(2);
      expect(highConf.every((r) => r.generalization_confidence >= 0.5)).toBe(true);
    });

    it('filters by sourceSessionId', async () => {
      const sess1 = await rm.list({ sourceSessionId: 'sess_1' });
      expect(sess1).toHaveLength(1);
    });

    it('respects limit', async () => {
      const limited = await rm.list({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('keeps a row whose confidence equals minConfidence', async () => {
      await rm.create({
        scope: 'global',
        evidence: ['floor'],
        summary: 'exactly the floor',
        generalization_confidence: 0.5,
      });
      const atFloor = await rm.list({ minConfidence: 0.5 });
      expect(atFloor.some((r) => r.summary === 'exactly the floor')).toBe(true);
    });
  });

  describe('getRelevantForSession', () => {
    it('returns reflections matching sourceSessionId OR overlapping evidence', async () => {
      await rm.create({
        scope: 'session',
        evidence: ['shared_entity'],
        summary: 'sourced from sess_X',
        generalization_confidence: 0.8,
        sourceSessionId: 'sess_X',
      });
      await rm.create({
        scope: 'global',
        evidence: ['shared_entity', 'other'],
        summary: 'evidence-overlap match',
        generalization_confidence: 0.7,
      });
      await rm.create({
        scope: 'global',
        evidence: ['unrelated_entity'],
        summary: 'unrelated reflection',
        generalization_confidence: 0.6,
      });

      const relevant = await rm.getRelevantForSession('sess_X', {
        sessionEntityNames: ['shared_entity'],
      });
      expect(relevant).toHaveLength(2);
      expect(relevant.map((r) => r.summary).sort()).toEqual([
        'evidence-overlap match',
        'sourced from sess_X',
      ]);
    });

    it('respects limit and minConfidence', async () => {
      for (let i = 0; i < 5; i++) {
        await rm.create({
          scope: 'session',
          evidence: [`e_${i}`],
          summary: `r${i}`,
          generalization_confidence: 0.5 + i * 0.1,
          sourceSessionId: 'sess_Y',
        });
      }
      const top = await rm.getRelevantForSession('sess_Y', {
        limit: 2,
        minConfidence: 0.7,
      });
      expect(top.length).toBeLessThanOrEqual(2);
      expect(top.every((r) => r.generalization_confidence >= 0.7)).toBe(true);
    });
  });

  describe('archive', () => {
    it('archives an existing reflection and returns "archived"', async () => {
      const rec = await rm.create({
        scope: 'session',
        evidence: ['e'],
        summary: 's',
        generalization_confidence: 0.7,
      });
      const result = await rm.archive(rec.id);
      expect(result).toBe('archived');
    });

    it('returns "not-found" for unknown id', async () => {
      expect(await rm.archive('reflection-nonexistent')).toBe('not-found');
    });

    it('returns "already-archived" for second call', async () => {
      const rec = await rm.create({
        scope: 'session',
        evidence: ['e'],
        summary: 's',
        generalization_confidence: 0.7,
      });
      await rm.archive(rec.id);
      expect(await rm.archive(rec.id)).toBe('already-archived');
    });

    it('hides archived rows from list unless includeArchived is set', async () => {
      const rec = await rm.create({
        scope: 'session',
        evidence: ['e'],
        summary: 'to-archive',
        generalization_confidence: 0.8,
      });
      await rm.archive(rec.id);
      expect((await rm.list()).some((r) => r.id === rec.id)).toBe(false);
      expect((await rm.list({ includeArchived: true })).some((r) => r.id === rec.id)).toBe(true);
      expect((await rm.getAll()).some((r) => r.id === rec.id)).toBe(true);
    });

    it('returns "vanished-mid-update" when storage.updateEntity returns false', async () => {
      const rec = await rm.create({
        scope: 'session',
        evidence: ['e'],
        summary: 's',
        generalization_confidence: 0.7,
      });
      // Simulate a concurrent delete: clear the entity between fetch and update.
      const original = storage.updateEntity.bind(storage);
      storage.updateEntity = async () => false;
      const result = await rm.archive(rec.id);
      expect(result).toBe('vanished-mid-update');
      storage.updateEntity = original;
    });

    it('returns "conflict" when EntityManager.updateEntity throws VersionConflictError', async () => {
      const rec = await rm.create({
        scope: 'session',
        evidence: ['e'],
        summary: 's',
        generalization_confidence: 0.7,
      });
      (entityManager.updateEntity as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new VersionConflictError(rec.id, 1, 2));
      expect(await rm.archive(rec.id)).toBe('conflict');
    });
  });

  describe('archive (pinned before the extraction)', () => {
    it('sends the stored version as expectedVersion and two patch keys', async () => {
      const rec = await rm.create({
        scope: 'session',
        evidence: ['e'],
        summary: 's',
        generalization_confidence: 0.7,
      });
      await rm.archive(rec.id);
      const update = entityManager.updateEntity as ReturnType<typeof vi.fn>;
      expect(update).toHaveBeenCalledTimes(1);
      const [name, patch, options] = update.mock.calls[0];
      expect(name).toBe(rec.id);
      expect(Object.keys(patch)).toEqual(['reflectionRecord', 'lastModified']);
      expect(options).toStrictEqual({ expectedVersion: 1 });
    });

    it('stores archived true with an archivedAt timestamp', async () => {
      const rec = await rm.create({
        scope: 'session',
        evidence: ['e'],
        summary: 's',
        generalization_confidence: 0.7,
      });
      await rm.archive(rec.id);
      const stored = storage.getEntityByName(rec.id) as ReflectionEntity;
      expect(stored.reflectionRecord.archived).toBe(true);
      expect(typeof stored.reflectionRecord.archivedAt).toBe('string');
    });
  });

  describe('isReflectionMemory type guard', () => {
    it('returns true for ReflectionEntity', async () => {
      const rec = await rm.create({
        scope: 'session',
        evidence: ['e'],
        summary: 's',
        generalization_confidence: 0.7,
      });
      const stored = storage.getEntityByName(rec.id);
      expect(isReflectionMemory(stored)).toBe(true);
    });

    it('returns false for non-reflection entities', () => {
      expect(isReflectionMemory({ memoryType: 'episodic' })).toBe(false);
      expect(isReflectionMemory(null)).toBe(false);
      expect(isReflectionMemory(undefined)).toBe(false);
    });
  });
});

/**
 * Microtask turns until each result settles, counted by microtaskTicks on V8.
 * A different count changes the order in which waiting callers resume.
 */
const REFLECTION_TICKS = {
  archived: 2,
  notFound: 1,
  alreadyArchived: 1,
  conflict: 2,
  vanished: 2,
  rejected: 2,
};

describe('AgentReflectionManager archive write errors', () => {
  const input = {
    scope: 'session' as const,
    evidence: ['e'],
    summary: 's',
    generalization_confidence: 0.7,
  };

  /** Seeds one reflection, then builds a manager whose entity manager runs `write`. */
  async function withWrite(write: (...args: unknown[]) => unknown) {
    const storage = createMockStorage();
    const rec = await new AgentReflectionManager(storage, createFakeEntityManager(storage)).create(input);
    const calls: Array<{ self: unknown; args: unknown[] }> = [];
    const entityManager: { updateEntity(...args: unknown[]): unknown } = {
      updateEntity(this: unknown, ...args: unknown[]) {
        calls.push({ self: this, args });
        return write(...args);
      },
    };
    const rm = new AgentReflectionManager(storage, entityManager as unknown as EntityManager);
    return { rm, id: rec.id, storage, calls, entityManager };
  }

  it('rethrows an error that is not a conflict or a missing entity', async () => {
    const boom = new Error('boom');
    const { rm, id } = await withWrite(async () => {
      throw boom;
    });
    await expect(rm.archive(id)).rejects.toBe(boom);
  });

  it('rethrows a rejection that is not an Error', async () => {
    const { rm, id } = await withWrite(() => Promise.reject('plain text'));
    await expect(rm.archive(id)).rejects.toBe('plain text');
  });

  it('maps errors that the entity manager throws before it returns a promise', async () => {
    const conflict = await withWrite(() => {
      throw new VersionConflictError('x', 1, 2);
    });
    expect(await conflict.rm.archive(conflict.id)).toBe('conflict');
    const vanished = await withWrite(() => {
      throw new EntityNotFoundError('x');
    });
    expect(await vanished.rm.archive(vanished.id)).toBe('vanished-mid-update');
    const boom = new Error('sync boom');
    const other = await withWrite(() => {
      throw boom;
    });
    await expect(other.rm.archive(other.id)).rejects.toBe(boom);
  });

  it('maps a rejection with a subclass of the missing-entity error', async () => {
    class LateMissing extends EntityNotFoundError {}
    const { rm, id } = await withWrite(() => Promise.reject(new LateMissing('x')));
    expect(await rm.archive(id)).toBe('vanished-mid-update');
  });

  it('calls updateEntity as a method of the entity manager, with the id, the patch and the version', async () => {
    const { rm, id, calls, entityManager, storage } = await withWrite(async () => ({}));
    (storage.getEntityByName(id) as Entity).version = 6;
    expect(await rm.archive(id)).toBe('archived');
    expect(calls).toHaveLength(1);
    expect(calls[0].self).toBe(entityManager);
    const [name, patch, options] = calls[0].args as [string, Record<string, unknown>, unknown];
    expect(name).toBe(id);
    expect(Object.keys(patch)).toEqual(['reflectionRecord', 'lastModified']);
    expect(options).toStrictEqual({ expectedVersion: 6 });
  });

  it('sends version 1 when the entity has no version', async () => {
    const { rm, id, calls } = await withWrite(async () => ({}));
    await rm.archive(id);
    expect(calls[0].args[2]).toStrictEqual({ expectedVersion: 1 });
  });

  it('stores one timestamp in archivedAt and in lastModified', async () => {
    const { rm, id, calls } = await withWrite(async () => ({}));
    await rm.archive(id);
    const patch = calls[0].args[1] as {
      reflectionRecord: { archived: boolean; archivedAt: string };
      lastModified: string;
    };
    expect(patch.reflectionRecord.archived).toBe(true);
    expect(patch.reflectionRecord.archivedAt).toBe(patch.lastModified);
  });

  it('does not call updateEntity for an unknown id', async () => {
    const { rm, calls } = await withWrite(async () => ({}));
    expect(await rm.archive('reflection-missing')).toBe('not-found');
    expect(calls).toHaveLength(0);
  });

  describe('settle timing', () => {
    it('archived settles after the expected number of microtask turns', async () => {
      const { rm, id } = await withWrite(async () => ({}));
      const pending = rm.archive(id);
      expect(await microtaskTicks(pending)).toBe(REFLECTION_TICKS.archived);
      expect(await pending).toBe('archived');
    });

    it('not-found settles after the expected number of turns', async () => {
      const { rm } = await withWrite(async () => ({}));
      const pending = rm.archive('reflection-missing');
      expect(await microtaskTicks(pending)).toBe(REFLECTION_TICKS.notFound);
      expect(await pending).toBe('not-found');
    });

    it('already-archived settles after the expected number of turns', async () => {
      const storage = createMockStorage();
      const rm = new AgentReflectionManager(storage, createFakeEntityManager(storage));
      const rec = await rm.create(input);
      await rm.archive(rec.id);
      const pending = rm.archive(rec.id);
      expect(await microtaskTicks(pending)).toBe(REFLECTION_TICKS.alreadyArchived);
      expect(await pending).toBe('already-archived');
    });

    it('conflict settles after the expected number of turns', async () => {
      const { rm, id } = await withWrite(async () => {
        throw new VersionConflictError('x', 1, 2);
      });
      const pending = rm.archive(id);
      expect(await microtaskTicks(pending)).toBe(REFLECTION_TICKS.conflict);
      expect(await pending).toBe('conflict');
    });

    it('vanished-mid-update settles after the expected number of turns', async () => {
      const { rm, id } = await withWrite(async () => {
        throw new EntityNotFoundError('x');
      });
      const pending = rm.archive(id);
      expect(await microtaskTicks(pending)).toBe(REFLECTION_TICKS.vanished);
      expect(await pending).toBe('vanished-mid-update');
    });

    it('a rethrown error rejects after the expected number of turns', async () => {
      const { rm, id } = await withWrite(async () => {
        throw new Error('boom');
      });
      const pending = rm.archive(id);
      expect(await microtaskTicks(pending)).toBe(REFLECTION_TICKS.rejected);
      await expect(pending).rejects.toThrow('boom');
    });
  });
});
