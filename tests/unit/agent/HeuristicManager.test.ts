/**
 * HeuristicManager Unit Tests — Phase 3B.8a (storage-backed).
 *
 * Covers add/get/list/match/reinforce/recordContradiction/detectConflicts/
 * remove/clear over the new storage-backed facade, including the
 * `'conflict'` arm surfaced when `EntityManager.updateEntity` throws
 * `VersionConflictError`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HeuristicManager } from '../../../src/agent/HeuristicManager.js';
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
    async getGraphForMutation() {
      return { entities: Array.from(entities.values()), relations: [] };
    },
    async saveGraph(g: KnowledgeGraph) {
      entities.clear();
      for (const e of g.entities) entities.set(e.name, e);
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
    deleteEntities: vi.fn(async (names: string[]) => {
      const map = (storage as unknown as { _entities: Map<string, Entity> })._entities;
      for (const n of names) map.delete(n);
    }),
  } as unknown as EntityManager;
}

describe('HeuristicManager (storage-backed)', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let entityManager: EntityManager;
  let mgr: HeuristicManager;

  beforeEach(() => {
    storage = createMockStorage();
    entityManager = createFakeEntityManager(storage);
    mgr = new HeuristicManager(storage, entityManager);
  });

  it('add returns a new id and the heuristic is retrievable', async () => {
    const id = await mgr.add({
      condition: 'user asks for code review',
      action: 'request the PR URL first',
    });
    const h = mgr.get(id);
    expect(h).toBeDefined();
    expect(h?.condition).toBe('user asks for code review');
    expect(h?.confidence).toBeCloseTo(0.5, 5);
    expect(await mgr.size()).toBe(1);
  });

  it('match returns heuristics overlapping the input by token, sorted by score', async () => {
    const id1 = await mgr.add({
      condition: 'user asks for code review',
      action: 'request PR URL',
      initialConfidence: 0.9,
    });
    await mgr.add({
      condition: 'user asks for cookery advice',
      action: 'recommend recipe',
      initialConfidence: 0.5,
    });
    const matches = await mgr.match('please review my code now');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.heuristic.id).toBe(id1);
  });

  it('reinforce raises confidence asymptotically toward 1', async () => {
    const id = await mgr.add({ condition: 'x token', action: 'y action', initialConfidence: 0.5 });
    expect(await mgr.reinforce(id)).toBe('updated');
    const h = mgr.get(id)!;
    expect(h.support).toBe(1);
    expect(h.confidence).toBeGreaterThan(0.5);
    expect(h.confidence).toBeLessThan(1);
  });

  it('recordContradiction lowers confidence and bumps contradictions', async () => {
    const id = await mgr.add({ condition: 'x token', action: 'y action', initialConfidence: 0.5 });
    expect(await mgr.recordContradiction(id)).toBe('updated');
    const h = mgr.get(id)!;
    expect(h.contradictions).toBe(1);
    expect(h.confidence).toBeLessThan(0.5);
  });

  it('reinforce returns "not-found" for an unknown id', async () => {
    expect(await mgr.reinforce('h_does-not-exist')).toBe('not-found');
  });

  it('reinforce returns "conflict" when EntityManager.updateEntity throws VersionConflictError', async () => {
    const id = await mgr.add({ condition: 'a b c', action: 'x', initialConfidence: 0.5 });
    (entityManager.updateEntity as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new VersionConflictError(id, 1, 2));
    expect(await mgr.reinforce(id)).toBe('conflict');
  });

  it('detectConflicts surfaces opposing-action overlap pairs as contradictions', async () => {
    await mgr.add({ condition: 'review pull request', action: 'merge after one approval' });
    await mgr.add({ condition: 'review pull request', action: "don't merge after one approval" });
    const conflicts = await mgr.detectConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('contradiction');
  });

  it('detectConflicts flags overlapping conditions with different actions as overlap', async () => {
    await mgr.add({ condition: 'production deploy gate', action: 'require two approvals' });
    await mgr.add({ condition: 'production deploy gate', action: 'require integration tests' });
    const conflicts = await mgr.detectConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('overlap');
  });

  it('match respects the minScore threshold', async () => {
    await mgr.add({
      condition: 'totally unrelated keywords here',
      action: 'something',
      initialConfidence: 0.9,
    });
    const matches = await mgr.match('cookery recipe onion', { minScore: 0.5 });
    expect(matches).toEqual([]);
  });

  it('remove and clear behave as expected', async () => {
    const id = await mgr.add({ condition: 'x token', action: 'y action' });
    expect(await mgr.remove(id)).toBe(true);
    expect(await mgr.remove('h_does-not-exist')).toBe(false);
    await mgr.add({ condition: 'a token', action: 'b action' });
    await mgr.clear();
    expect(await mgr.size()).toBe(0);
  });
});
