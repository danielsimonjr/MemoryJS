/**
 * ToolAffordanceManager — Phase Tool A unit tests.
 *
 * Covers:
 * - first recordOutcome creates the record with outcome appended
 * - subsequent records append to rolling window
 * - rollingWindowSize caps stored outcomes (oldest dropped)
 * - successRate updates correctly with mixed outcomes
 * - commonFailureModes ranks top-N error messages by frequency
 * - avgDurationMs reflects rolling mean
 * - suggestTool returns matches sorted by success_rate × recency
 * - get is sync; list / remove work
 * - OCC: 'conflict' arm via VersionConflictError
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    deleteEntities: vi.fn(async (names: string[]) => {
      const map = (storage as unknown as { _entities: Map<string, Entity> })._entities;
      for (const n of names) map.delete(n);
    }),
  } as unknown as EntityManager;
}

describe('ToolAffordanceManager', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let entityManager: EntityManager;
  let mgr: ToolAffordanceManager;

  beforeEach(() => {
    storage = createMockStorage();
    entityManager = createFakeEntityManager(storage);
    mgr = new ToolAffordanceManager(storage, entityManager);
  });

  describe('recordOutcome', () => {
    it('creates the record on first call', async () => {
      const rec = await mgr.recordOutcome('shell.run', { outcome: 'success' });
      expect(rec.toolName).toBe('shell.run');
      expect(rec.outcomes).toHaveLength(1);
      expect(rec.successRate).toBe(1);
      expect(rec.totalCalls).toBe(1);
    });

    it('appends to rolling window on subsequent calls', async () => {
      await mgr.recordOutcome('t', { outcome: 'success' });
      await mgr.recordOutcome('t', { outcome: 'success' });
      await mgr.recordOutcome('t', { outcome: 'failure', errorMessage: 'oops' });
      const rec = mgr.get('t')!;
      expect(rec.outcomes).toHaveLength(3);
      expect(rec.successRate).toBeCloseTo(2 / 3, 5);
      expect(rec.totalCalls).toBe(3);
    });

    it('caps stored outcomes at rollingWindowSize (drops oldest)', async () => {
      const capped = new ToolAffordanceManager(storage, entityManager, {
        rollingWindowSize: 3,
      });
      await capped.recordOutcome('t', { outcome: 'success', errorMessage: 'a' });
      await capped.recordOutcome('t', { outcome: 'success', errorMessage: 'b' });
      await capped.recordOutcome('t', { outcome: 'failure', errorMessage: 'c' });
      await capped.recordOutcome('t', { outcome: 'failure', errorMessage: 'd' });
      const rec = capped.get('t')!;
      expect(rec.outcomes).toHaveLength(3);
      // Window=[b, c, d]: 1 success + 2 failures.
      expect(rec.successRate).toBeCloseTo(1 / 3, 5);
      // totalCalls still increments across the window (lifetime count).
      expect(rec.totalCalls).toBe(4);
    });

    it('ranks commonFailureModes by frequency', async () => {
      await mgr.recordOutcome('t', { outcome: 'failure', errorMessage: 'timeout' });
      await mgr.recordOutcome('t', { outcome: 'failure', errorMessage: 'timeout' });
      await mgr.recordOutcome('t', { outcome: 'failure', errorMessage: 'auth-failed' });
      const rec = mgr.get('t')!;
      expect(rec.commonFailureModes[0]).toBe('timeout');
      expect(rec.commonFailureModes).toContain('auth-failed');
    });

    it('computes rolling avgDurationMs', async () => {
      await mgr.recordOutcome('t', { outcome: 'success', durationMs: 100 });
      await mgr.recordOutcome('t', { outcome: 'success', durationMs: 200 });
      const rec = mgr.get('t')!;
      expect(rec.avgDurationMs).toBeCloseTo(150, 5);
    });

    it('returns "conflict" handling via VersionConflictError', async () => {
      await mgr.recordOutcome('t', { outcome: 'success' });
      (entityManager.updateEntity as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new VersionConflictError('tool-affordance-t', 1, 2));
      // recordOutcome retries are out of scope for v1 — surface as a
      // thrown error (callers can re-call).
      await expect(mgr.recordOutcome('t', { outcome: 'success' })).rejects.toThrow(/conflict/i);
    });
  });

  describe('rollingStats', () => {
    it('returns undefined for unknown tool', () => {
      expect(mgr.rollingStats('unknown')).toBeUndefined();
    });

    it('reports success_rate, total_calls, common_failure_modes', async () => {
      await mgr.recordOutcome('t', { outcome: 'success' });
      await mgr.recordOutcome('t', { outcome: 'failure', errorMessage: 'fail-a' });
      const stats = mgr.rollingStats('t')!;
      expect(stats.success_rate).toBeCloseTo(0.5, 5);
      expect(stats.total_calls).toBe(2);
      expect(stats.common_failure_modes).toEqual(['fail-a']);
    });
  });

  describe('suggestTool', () => {
    it('returns tools matching the hint, sorted by success rate', async () => {
      await mgr.recordOutcome('shell.run', { outcome: 'success' });
      await mgr.recordOutcome('shell.run', { outcome: 'success' });
      await mgr.recordOutcome('shell.exec', { outcome: 'success' });
      await mgr.recordOutcome('shell.exec', { outcome: 'failure', errorMessage: 'oops' });
      await mgr.recordOutcome('grep.search', { outcome: 'success' });

      const suggestions = await mgr.suggestTool('shell');
      expect(suggestions.length).toBe(2);
      expect(suggestions.map((s) => s.toolName)).toEqual(['shell.run', 'shell.exec']);
    });

    it('returns empty when no tool matches the hint', async () => {
      await mgr.recordOutcome('shell.run', { outcome: 'success' });
      expect(await mgr.suggestTool('nonexistent')).toEqual([]);
    });
  });

  describe('get / list / remove', () => {
    it('list returns all tools', async () => {
      await mgr.recordOutcome('a', { outcome: 'success' });
      await mgr.recordOutcome('b', { outcome: 'success' });
      expect((await mgr.list()).map((r) => r.toolName).sort()).toEqual(['a', 'b']);
    });

    it('remove drops the record', async () => {
      await mgr.recordOutcome('t', { outcome: 'success' });
      expect(await mgr.remove('t')).toBe(true);
      expect(mgr.get('t')).toBeUndefined();
    });

    it('remove returns false for unknown tool', async () => {
      expect(await mgr.remove('unknown')).toBe(false);
    });
  });
});
