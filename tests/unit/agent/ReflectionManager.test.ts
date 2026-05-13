/**
 * ReflectionManager — Phase 2 Sprint 8 Unit Tests
 *
 * Covers:
 * - create() validation, content-hash dedup, invariants
 * - list() filtering by scope / session / minConfidence / limit
 * - getRelevantForSession() evidence-overlap retrieval
 * - archive() discriminated MarkResolvedResult-style returns
 * - getAll() convenience
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReflectionManager } from '../../../src/agent/ReflectionManager.js';
import type { Entity, KnowledgeGraph, IGraphStorage } from '../../../src/types/types.js';
import type { ReflectionEntity } from '../../../src/types/agent-memory.js';
import { isReflectionMemory } from '../../../src/types/agent-memory.js';

/** Minimal in-memory storage that satisfies the duck-typed `IGraphStorage` slice ReflectionManager needs. */
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
    // Stubs for unused methods (kept loose; ReflectionManager touches few of these)
    async getGraphForMutation() {
      return { entities: Array.from(entities.values()), relations: [] };
    },
    async saveGraph(g: KnowledgeGraph) {
      entities.clear();
      for (const e of g.entities) entities.set(e.name, e);
    },
  } as unknown as IGraphStorage & { _entities: Map<string, Entity> };
}

describe('ReflectionManager', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let rm: ReflectionManager;

  beforeEach(() => {
    storage = createMockStorage();
    rm = new ReflectionManager(storage);
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
