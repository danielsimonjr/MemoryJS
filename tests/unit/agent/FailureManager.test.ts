/**
 * FailureManager Unit Tests
 *
 * Tests for the structured failure-memory type — the catalog's "single
 * biggest concrete win available to most agentic systems" (per
 * docs/roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md §4 Priority 1 / Type 9).
 *
 * Design decisions enforced by these tests (per pre-implementation
 * type-design review):
 *
 *   1. FailureLifecycle discriminated union (mirrors ProspectiveLifecycle):
 *      illegal states like { status: 'open', resolvedAt: '...' } are
 *      unrepresentable at the type level.
 *   2. Embedding stays off the public FailureRecord surface (encapsulation).
 *   3. sourceSessionId optional — present when produced by
 *      FailureDistillation, absent for manual records.
 *   4. Tags come from inherited AgentEntity.tags, not duplicated on
 *      FailureRecord.
 *   5. record() validates non-empty strings on required fields.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FailureManager } from '../../../src/agent/FailureManager.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { IGraphStorage, Entity } from '../../../src/types/types.js';
import type { FailureRecord, FailureEntity } from '../../../src/types/agent-memory.js';
import { isFailureMemory } from '../../../src/types/agent-memory.js';
import { VersionConflictError, EntityNotFoundError } from '../../../src/utils/errors.js';

/** FailureManager doesn't read relations; mock only the entity surface. */
function createMockStorage(initialEntities: Entity[] = []): IGraphStorage {
  const entities: Entity[] = [...initialEntities];
  return {
    appendEntity: vi.fn(async (entity: Entity) => {
      entities.push(entity);
    }),
    loadGraph: vi.fn(async () => ({ entities, relations: [] })),
    getEntityByName: vi.fn((name: string) => entities.find((e) => e.name === name)),
    updateEntity: vi.fn(async (name: string, updates: Partial<Entity>) => {
      const idx = entities.findIndex((e) => e.name === name);
      if (idx === -1) return false;
      entities[idx] = { ...entities[idx], ...updates };
      return true;
    }),
  } as unknown as IGraphStorage;
}

/**
 * Minimal fake EntityManager satisfying the surface FailureManager
 * uses (`updateEntity` with optional `expectedVersion` OCC). Delegates
 * to the mock storage so tests can observe writes via their existing
 * `storage.updateEntity` spy, then layers OCC + version bump on top.
 */
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
      if (!ok) throw new EntityNotFoundError(name); // vanished mid-update
      return { ...entity, ...merged } as Entity;
    }),
  } as unknown as EntityManager;
}

/** Convenience factory for valid `record()` input. */
function validInput(overrides: Partial<Parameters<FailureManager['record']>[0]> = {}): Parameters<FailureManager['record']>[0] {
  return {
    context: 'Building the authentication module',
    attempted: 'Used bcrypt.hash with default salt rounds',
    failure_mode: 'Login attempts timed out after 30s under load',
    root_cause: 'bcrypt default salt rounds is 10; under load that exceeds the request budget',
    applicability_hint: 'Setting up password hashing for auth flows',
    ...overrides,
  };
}

describe('FailureManager', () => {
  let storage: IGraphStorage;
  let entityManager: EntityManager;
  let fm: FailureManager;

  beforeEach(() => {
    storage = createMockStorage();
    entityManager = createFakeEntityManager(storage);
    fm = new FailureManager(storage, entityManager);
  });

  // ==================== record() ====================

  describe('record', () => {
    it('creates a FailureRecord with lifecycle.status === "open"', async () => {
      const rec = await fm.record(validInput());
      expect(rec.lifecycle.status).toBe('open');
      expect(rec.context).toContain('authentication module');
      expect(rec.id).toMatch(/^failure-/);
    });

    it('sets a valid ISO 8601 timestamp', async () => {
      const before = Date.now();
      const rec = await fm.record(validInput());
      const after = Date.now();
      const ts = new Date(rec.timestamp).getTime();
      expect(Number.isNaN(ts)).toBe(false);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('persists the failure as a FailureEntity (memoryType === "failure")', async () => {
      const rec = await fm.record(validInput());
      const stored = await storage.getEntityByName(rec.id);
      expect(stored).toBeDefined();
      expect((stored as FailureEntity).memoryType).toBe('failure');
      expect((stored as FailureEntity).failureRecord.id).toBe(rec.id);
    });

    it('rejects empty context', async () => {
      await expect(fm.record(validInput({ context: '' }))).rejects.toThrow(/context/i);
    });

    it('rejects whitespace-only attempted', async () => {
      await expect(fm.record(validInput({ attempted: '   ' }))).rejects.toThrow(/attempted/i);
    });

    it('rejects empty failure_mode', async () => {
      await expect(fm.record(validInput({ failure_mode: '' }))).rejects.toThrow(/failure_mode/i);
    });

    it('rejects empty root_cause', async () => {
      await expect(fm.record(validInput({ root_cause: '' }))).rejects.toThrow(/root_cause/i);
    });

    it('rejects empty applicability_hint', async () => {
      await expect(fm.record(validInput({ applicability_hint: '' }))).rejects.toThrow(/applicability_hint/i);
    });

    it('accepts optional alternative_taken and sourceSessionId', async () => {
      const rec = await fm.record(
        validInput({ alternative_taken: 'Reduced salt rounds to 8 + queued hashing', sourceSessionId: 'sess-abc' })
      );
      expect(rec.alternative_taken).toContain('Reduced salt rounds');
      expect(rec.sourceSessionId).toBe('sess-abc');
    });

    it('wraps storage.appendEntity errors with the failure id for attribution', async () => {
      (storage.appendEntity as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('EPERM: operation not permitted')
      );
      await expect(fm.record(validInput())).rejects.toThrow(/FailureManager\.record: failed to persist failure 'failure-.*': EPERM/);
    });

    it('error message includes received value/type for empty fields', async () => {
      // Use any-cast to bypass the compile-time signature check
      const undefinedInput = validInput() as Record<string, unknown>;
      undefinedInput.context = undefined;
      await expect(fm.record(undefinedInput as never)).rejects.toThrow(/received undefined/);
    });

    it('passes tags through to the entity (not duplicated on FailureRecord)', async () => {
      const rec = await fm.record(validInput(), { tags: ['security', 'auth'] });
      const stored = (await storage.getEntityByName(rec.id)) as FailureEntity;
      expect(stored.tags).toContain('security');
      expect(stored.tags).toContain('auth');
      // FailureRecord itself doesn't carry tags
      expect((rec as Record<string, unknown>).tags).toBeUndefined();
    });
  });

  // ==================== lookupForTask() ====================

  describe('lookupForTask', () => {
    beforeEach(async () => {
      await fm.record(validInput({
        applicability_hint: 'Setting up password hashing',
        context: 'auth module',
      }));
      await fm.record(validInput({
        applicability_hint: 'Adding rate limiting to API endpoints',
        context: 'rate-limit middleware',
        attempted: 'express-rate-limit',
        failure_mode: 'Per-IP storage exhausted memory',
        root_cause: 'Default in-memory store unbounded',
      }));
      await fm.record(validInput({
        applicability_hint: 'Configuring CSP headers',
        context: 'security headers',
        attempted: 'helmet defaults',
        failure_mode: 'Blocked inline styles needed for the editor',
        root_cause: 'helmet defaults are strict-by-default',
      }));
    });

    it('returns failures whose applicability_hint matches the task', async () => {
      const matches = await fm.lookupForTask('password hashing');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.applicability_hint.includes('password hashing'))).toBe(true);
    });

    it('returns failures whose context matches when applicability_hint does not', async () => {
      const matches = await fm.lookupForTask('rate-limit middleware');
      expect(matches.some((m) => m.context.includes('rate-limit'))).toBe(true);
    });

    it('returns empty array when nothing matches', async () => {
      const matches = await fm.lookupForTask('completely unrelated kafka pipeline');
      expect(matches).toEqual([]);
    });

    it('respects the limit option', async () => {
      // Add many matching failures
      for (let i = 0; i < 10; i++) {
        await fm.record(validInput({
          applicability_hint: `task-X variant ${i}`,
          context: 'task-X context',
        }));
      }
      const limited = await fm.lookupForTask('task-X', { limit: 3 });
      expect(limited.length).toBeLessThanOrEqual(3);
    });

    it('excludes resolved failures by default', async () => {
      const rec = await fm.record(validInput({
        applicability_hint: 'transient X-fix task',
        context: 'X-fix',
      }));
      await fm.markResolved(rec.id, 'patched upstream');
      const matches = await fm.lookupForTask('X-fix');
      expect(matches.find((m) => m.id === rec.id)).toBeUndefined();
    });

    it('includes resolved failures when status: "all"', async () => {
      const rec = await fm.record(validInput({
        applicability_hint: 'resolved-Y task',
        context: 'Y-context',
      }));
      await fm.markResolved(rec.id);
      const matches = await fm.lookupForTask('resolved-Y', { status: 'all' });
      expect(matches.some((m) => m.id === rec.id)).toBe(true);
    });
  });

  // ==================== markResolved() ====================

  describe('markResolved', () => {
    it('transitions an open failure to resolved with timestamp', async () => {
      const rec = await fm.record(validInput());
      const result = await fm.markResolved(rec.id, 'fixed in commit abc123');
      expect(result).toBe('resolved');

      const stored = (await storage.getEntityByName(rec.id)) as FailureEntity;
      expect(stored.failureRecord.lifecycle.status).toBe('resolved');
      if (stored.failureRecord.lifecycle.status === 'resolved') {
        expect(stored.failureRecord.lifecycle.resolvedAt).toBeDefined();
        expect(stored.failureRecord.lifecycle.resolvedReason).toBe('fixed in commit abc123');
      }
    });

    it('returns "resolved" on first, "already-resolved" on second', async () => {
      const rec = await fm.record(validInput());
      expect(await fm.markResolved(rec.id)).toBe('resolved');
      expect(await fm.markResolved(rec.id)).toBe('already-resolved');
    });

    it('returns "not-found" for unknown id', async () => {
      expect(await fm.markResolved('failure-does-not-exist')).toBe('not-found');
    });

    it('returns "vanished-mid-update" when updateEntity returns false', async () => {
      const rec = await fm.record(validInput());
      // Force updateEntity to return false (simulating concurrent delete)
      (storage.updateEntity as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      expect(await fm.markResolved(rec.id)).toBe('vanished-mid-update');
    });

    it('returns "conflict" when EntityManager.updateEntity throws VersionConflictError', async () => {
      const rec = await fm.record(validInput());
      // Simulate a concurrent writer having bumped the version between
      // our read and our write — EntityManager surfaces this as a
      // VersionConflictError, which markResolved must translate.
      (entityManager.updateEntity as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new VersionConflictError(rec.id, 1, 2));
      expect(await fm.markResolved(rec.id, 'should conflict')).toBe('conflict');
    });

    it('accepts optional reason; absence is fine', async () => {
      const rec = await fm.record(validInput());
      await fm.markResolved(rec.id);
      const stored = (await storage.getEntityByName(rec.id)) as FailureEntity;
      if (stored.failureRecord.lifecycle.status === 'resolved') {
        expect(stored.failureRecord.lifecycle.resolvedReason).toBeUndefined();
      }
    });
  });

  // ==================== getAll() ====================

  describe('getAll', () => {
    it('returns all failures, regardless of lifecycle status', async () => {
      const r1 = await fm.record(validInput());
      const r2 = await fm.record(validInput({ context: 'second context' }));
      await fm.markResolved(r2.id);
      const all = await fm.getAll();
      expect(all.length).toBe(2);
      // r1 found, r2 found regardless of status
      expect(all.some((r) => r.id === r1.id)).toBe(true);
      expect(all.some((r) => r.id === r2.id)).toBe(true);
    });

    it('filters by status', async () => {
      const r1 = await fm.record(validInput());
      const r2 = await fm.record(validInput({ context: 'second' }));
      await fm.markResolved(r2.id);

      const open = await fm.getAll({ status: 'open' });
      expect(open.length).toBe(1);
      expect(open[0].id).toBe(r1.id);

      const resolved = await fm.getAll({ status: 'resolved' });
      expect(resolved.length).toBe(1);
      expect(resolved[0].id).toBe(r2.id);
    });

    it('filters by sourceSessionId', async () => {
      const a = await fm.record(validInput({ sourceSessionId: 'sess-A' }));
      await fm.record(validInput({ context: 'b', sourceSessionId: 'sess-B' }));
      await fm.record(validInput({ context: 'c' })); // no sessionId

      const fromA = await fm.getAll({ sourceSessionId: 'sess-A' });
      expect(fromA.length).toBe(1);
      expect(fromA[0].id).toBe(a.id);
    });
  });

  // ==================== type guard ====================

  describe('isFailureMemory type guard', () => {
    it('returns true for a persisted FailureEntity', async () => {
      const rec = await fm.record(validInput());
      const stored = await storage.getEntityByName(rec.id);
      expect(isFailureMemory(stored)).toBe(true);
    });

    it('returns false for non-failure entities', () => {
      expect(isFailureMemory({ memoryType: 'episodic' })).toBe(false);
      expect(isFailureMemory(null)).toBe(false);
      expect(isFailureMemory(undefined)).toBe(false);
    });

    it('returns false for an entity claiming failure type but without failureRecord', () => {
      // Hand-construct an entity that lies about its type
      expect(
        isFailureMemory({
          name: 'x',
          entityType: 'failure',
          memoryType: 'failure',
          observations: [],
          accessCount: 0,
          confidence: 0.9,
          confirmationCount: 0,
          visibility: 'private',
          // failureRecord missing
        })
      ).toBe(false);
    });
  });
});
