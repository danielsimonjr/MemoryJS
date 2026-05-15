/**
 * ExclusionManager — Phase Excl A unit tests.
 *
 * Covers:
 * - add() creates an ExclusionRule with id, timestamp, blockedCount=0
 * - scope='both' deletes matching existing memories on add
 * - scope='future-only' leaves existing matches alone
 * - scope='past-only' deletes existing matches but does NOT block future writes
 * - check() is case-insensitive substring matching
 * - check() respects entityType filter on the rule
 * - findMatchingMemories() previews without persisting
 * - list() returns all rules
 * - remove() drops the rule and does NOT restore deleted memories
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExclusionManager } from '../../../src/agent/ExclusionManager.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { Entity, IGraphStorage, KnowledgeGraph } from '../../../src/types/types.js';

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
    deleteEntities: vi.fn(async (names: string[]) => {
      const map = (storage as unknown as { _entities: Map<string, Entity> })._entities;
      for (const n of names) map.delete(n);
    }),
  } as unknown as EntityManager;
}

function makeEntity(name: string, observations: string[], entityType = 'person'): Entity {
  const now = new Date().toISOString();
  return {
    name,
    entityType,
    observations,
    createdAt: now,
    lastModified: now,
    importance: 5,
  } as Entity;
}

describe('ExclusionManager', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let entityManager: EntityManager;
  let mgr: ExclusionManager;

  beforeEach(() => {
    storage = createMockStorage();
    entityManager = createFakeEntityManager(storage);
    mgr = new ExclusionManager(storage, entityManager);
  });

  describe('add', () => {
    it('creates an ExclusionRule with id, timestamp, blockedCount=0', async () => {
      const rule = await mgr.add({ pattern: 'password' });
      expect(rule.id).toMatch(/^exclusion-/);
      expect(rule.pattern).toBe('password');
      expect(rule.mode).toBe('substring');
      expect(rule.scope).toBe('both');
      expect(rule.blockedCount).toBe(0);
      expect(new Date(rule.timestamp).getTime()).not.toBeNaN();
    });

    it('rejects empty patterns', async () => {
      await expect(mgr.add({ pattern: '' })).rejects.toThrow(/pattern/i);
      await expect(mgr.add({ pattern: '   ' })).rejects.toThrow(/pattern/i);
    });

    it('with scope=both deletes existing matching memories and sets deletedCount', async () => {
      storage._entities.set('e1', makeEntity('e1', ['my secret password is hunter2']));
      storage._entities.set('e2', makeEntity('e2', ['just a normal observation']));
      storage._entities.set('e3', makeEntity('e3', ['another password mention']));

      const rule = await mgr.add({ pattern: 'password' });

      expect(rule.deletedCount).toBe(2);
      expect(storage._entities.has('e1')).toBe(false);
      expect(storage._entities.has('e3')).toBe(false);
      expect(storage._entities.has('e2')).toBe(true);
    });

    it('with scope=future-only does NOT delete existing matches', async () => {
      storage._entities.set('e1', makeEntity('e1', ['my secret password']));

      const rule = await mgr.add({ pattern: 'password', scope: 'future-only' });

      expect(rule.deletedCount).toBe(0);
      expect(storage._entities.has('e1')).toBe(true);
    });

    it('with scope=past-only deletes existing matches', async () => {
      storage._entities.set('e1', makeEntity('e1', ['my secret password']));

      const rule = await mgr.add({ pattern: 'password', scope: 'past-only' });

      expect(rule.deletedCount).toBe(1);
      expect(storage._entities.has('e1')).toBe(false);
    });

    it('respects entityType filter when deleting past matches', async () => {
      storage._entities.set('p1', makeEntity('p1', ['contains password'], 'person'));
      storage._entities.set('proj1', makeEntity('proj1', ['contains password'], 'project'));

      const rule = await mgr.add({ pattern: 'password', entityType: 'person' });

      expect(rule.deletedCount).toBe(1);
      expect(storage._entities.has('p1')).toBe(false);
      expect(storage._entities.has('proj1')).toBe(true);
    });
  });

  describe('check', () => {
    it('returns blocked=true when content matches an active rule', async () => {
      await mgr.add({ pattern: 'secret', scope: 'both' });
      const result = await mgr.check('contains the secret keyword');
      expect(result.blocked).toBe(true);
      expect(result.ruleId).toMatch(/^exclusion-/);
    });

    it('returns blocked=false when no rule matches', async () => {
      await mgr.add({ pattern: 'secret' });
      const result = await mgr.check('totally innocuous content');
      expect(result.blocked).toBe(false);
      expect(result.ruleId).toBeUndefined();
    });

    it('is case-insensitive', async () => {
      await mgr.add({ pattern: 'PASSWORD' });
      expect((await mgr.check('contains password')).blocked).toBe(true);
      expect((await mgr.check('contains Password')).blocked).toBe(true);
      expect((await mgr.check('contains PASSWORD')).blocked).toBe(true);
    });

    it('past-only rules do NOT block future writes', async () => {
      await mgr.add({ pattern: 'password', scope: 'past-only' });
      const result = await mgr.check('my password is X');
      expect(result.blocked).toBe(false);
    });

    it('respects entityType filter on the rule', async () => {
      await mgr.add({ pattern: 'sensitive', entityType: 'person' });
      const personResult = await mgr.check('sensitive info', 'person');
      const projectResult = await mgr.check('sensitive info', 'project');
      expect(personResult.blocked).toBe(true);
      expect(projectResult.blocked).toBe(false);
    });

    it('without an entityType-scoped rule, all entityTypes are blocked', async () => {
      await mgr.add({ pattern: 'sensitive' });
      expect((await mgr.check('sensitive info', 'person')).blocked).toBe(true);
      expect((await mgr.check('sensitive info', 'project')).blocked).toBe(true);
      expect((await mgr.check('sensitive info')).blocked).toBe(true);
    });

    it('returns blocked=false when no rules exist', async () => {
      const result = await mgr.check('any content');
      expect(result.blocked).toBe(false);
    });
  });

  describe('findMatchingMemories', () => {
    it('returns matching entities without persisting the rule', async () => {
      storage._entities.set('e1', makeEntity('e1', ['has password']));
      storage._entities.set('e2', makeEntity('e2', ['clean']));

      const matches = await mgr.findMatchingMemories({ pattern: 'password' });
      expect(matches).toHaveLength(1);
      expect(matches[0]!.name).toBe('e1');
      // No rule was persisted
      expect(await mgr.list()).toHaveLength(0);
      expect(storage._entities.has('e1')).toBe(true);
    });

    it('respects entityType filter', async () => {
      storage._entities.set('p1', makeEntity('p1', ['shared text'], 'person'));
      storage._entities.set('proj1', makeEntity('proj1', ['shared text'], 'project'));

      const matches = await mgr.findMatchingMemories({
        pattern: 'shared',
        entityType: 'project',
      });
      expect(matches).toHaveLength(1);
      expect(matches[0]!.name).toBe('proj1');
    });
  });

  describe('list and remove', () => {
    it('list returns all registered rules', async () => {
      await mgr.add({ pattern: 'a' });
      await mgr.add({ pattern: 'b' });
      const rules = await mgr.list();
      expect(rules).toHaveLength(2);
      expect(rules.map((r) => r.pattern).sort()).toEqual(['a', 'b']);
    });

    it('remove drops the rule and returns true', async () => {
      const rule = await mgr.add({ pattern: 'foo' });
      expect(await mgr.remove(rule.id)).toBe(true);
      expect(await mgr.list()).toHaveLength(0);
    });

    it('remove returns false for unknown id', async () => {
      expect(await mgr.remove('exclusion-does-not-exist')).toBe(false);
    });

    it('removing a rule does NOT restore previously deleted memories', async () => {
      storage._entities.set('e1', makeEntity('e1', ['has password']));
      const rule = await mgr.add({ pattern: 'password' });
      expect(storage._entities.has('e1')).toBe(false);
      await mgr.remove(rule.id);
      expect(storage._entities.has('e1')).toBe(false);
    });
  });
});
