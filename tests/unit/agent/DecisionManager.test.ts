/**
 * DecisionManager — Phase Dec A unit tests.
 *
 * Covers:
 * - propose() creates a DecisionRecord with status='proposed'
 * - accept() transitions proposed → accepted with timestamp
 * - reject() transitions proposed → rejected with reason
 * - supersede() transitions accepted → superseded with link
 * - illegal transitions surface as 'illegal-transition'
 * - OCC: 'conflict' arm via VersionConflictError
 * - 'not-found' for unknown ids
 * - findByContext substring matching
 * - getChain walks `supersedes` backward
 * - list with optional status filter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DecisionManager } from '../../../src/agent/DecisionManager.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { Entity, IGraphStorage, KnowledgeGraph } from '../../../src/types/types.js';
import type { DecisionId } from '../../../src/types/agent-memory.js';
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

describe('DecisionManager', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let entityManager: EntityManager;
  let mgr: DecisionManager;

  beforeEach(() => {
    storage = createMockStorage();
    entityManager = createFakeEntityManager(storage);
    mgr = new DecisionManager(storage, entityManager);
  });

  describe('propose', () => {
    it('creates a DecisionRecord with status=proposed and unique id', async () => {
      const rec = await mgr.propose({
        context: 'Choosing a hashing algorithm for password storage',
        decision: 'Use argon2id with default memory cost',
        alternatives: ['bcrypt with 12 salt rounds', 'scrypt'],
        consequences: ['Higher memory usage', 'Better resistance to GPU attacks'],
      });
      expect(rec.id).toMatch(/^decision-/);
      expect(rec.status).toBe('proposed');
      expect(rec.context).toContain('password storage');
      expect(rec.alternatives).toHaveLength(2);
      expect(rec.consequences).toHaveLength(2);
      expect(new Date(rec.timestamp).getTime()).not.toBeNaN();
    });

    it('rejects empty context or decision', async () => {
      await expect(mgr.propose({
        context: '',
        decision: 'x',
        alternatives: [],
        consequences: [],
      })).rejects.toThrow(/context/i);
      await expect(mgr.propose({
        context: 'x',
        decision: '',
        alternatives: [],
        consequences: [],
      })).rejects.toThrow(/decision/i);
    });
  });

  describe('accept', () => {
    it('transitions proposed → accepted', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      expect(await mgr.accept(rec.id)).toBe('accepted');
      const after = mgr.get(rec.id)!;
      expect(after.status).toBe('accepted');
    });

    it('returns "already-accepted" on second call', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      await mgr.accept(rec.id);
      expect(await mgr.accept(rec.id)).toBe('already-accepted');
    });

    it('returns "not-found" for unknown id', async () => {
      expect(await mgr.accept('decision-does-not-exist')).toBe('not-found');
    });

    it('returns "illegal-transition" when target is rejected', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      await mgr.reject(rec.id, 'changed plan');
      expect(await mgr.accept(rec.id)).toBe('illegal-transition');
    });

    it('returns "conflict" when EntityManager throws VersionConflictError', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      (entityManager.updateEntity as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new VersionConflictError(rec.id, 1, 2));
      expect(await mgr.accept(rec.id)).toBe('conflict');
    });
  });

  describe('reject', () => {
    it('transitions proposed → rejected with reason', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      expect(await mgr.reject(rec.id, 'better option found')).toBe('rejected');
      const after = mgr.get(rec.id)!;
      expect(after.status).toBe('rejected');
    });

    it('returns "already-rejected" on second call', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      await mgr.reject(rec.id, 'r');
      expect(await mgr.reject(rec.id, 'r')).toBe('already-rejected');
    });

    it('returns "illegal-transition" when target is accepted', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      await mgr.accept(rec.id);
      expect(await mgr.reject(rec.id, 'r')).toBe('illegal-transition');
    });
  });

  describe('supersede', () => {
    it('transitions accepted → superseded with link to replacement', async () => {
      const oldRec = await mgr.propose({
        context: 'auth scheme',
        decision: 'bcrypt 10 rounds',
        alternatives: [],
        consequences: [],
      });
      await mgr.accept(oldRec.id);
      const newRec = await mgr.propose({
        context: 'auth scheme',
        decision: 'argon2id',
        alternatives: [],
        consequences: [],
        supersedes: oldRec.id as DecisionId,
      });
      await mgr.accept(newRec.id);
      expect(await mgr.supersede(oldRec.id, newRec.id as DecisionId)).toBe('superseded');
      const after = mgr.get(oldRec.id)!;
      expect(after.status).toBe('superseded');
    });

    it('returns "illegal-transition" when target is not accepted', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      const other = await mgr.propose({
        context: 'c2', decision: 'd2', alternatives: [], consequences: [],
      });
      expect(await mgr.supersede(rec.id, other.id as DecisionId)).toBe('illegal-transition');
    });

    it('returns "not-found" when replacement does not exist', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      await mgr.accept(rec.id);
      expect(await mgr.supersede(rec.id, 'decision-does-not-exist' as DecisionId)).toBe('not-found');
    });
  });

  describe('findByContext', () => {
    it('returns decisions whose context contains the query', async () => {
      await mgr.propose({
        context: 'password hashing strategy',
        decision: 'argon2id',
        alternatives: [], consequences: [],
      });
      await mgr.propose({
        context: 'API rate limiting',
        decision: 'token bucket',
        alternatives: [], consequences: [],
      });
      const matches = await mgr.findByContext('password');
      expect(matches).toHaveLength(1);
      expect(matches[0]!.decision).toBe('argon2id');
    });
  });

  describe('getChain', () => {
    it('walks the supersedes link backward to the original proposal', async () => {
      const v1 = await mgr.propose({
        context: 'c', decision: 'v1 — md5', alternatives: [], consequences: [],
      });
      await mgr.accept(v1.id);
      const v2 = await mgr.propose({
        context: 'c', decision: 'v2 — sha256',
        alternatives: [], consequences: [],
        supersedes: v1.id as DecisionId,
      });
      await mgr.accept(v2.id);
      await mgr.supersede(v1.id, v2.id as DecisionId);
      const v3 = await mgr.propose({
        context: 'c', decision: 'v3 — argon2id',
        alternatives: [], consequences: [],
        supersedes: v2.id as DecisionId,
      });
      await mgr.accept(v3.id);
      await mgr.supersede(v2.id, v3.id as DecisionId);

      const chain = await mgr.getChain(v3.id);
      expect(chain.map((r) => r.decision)).toEqual([
        'v1 — md5',
        'v2 — sha256',
        'v3 — argon2id',
      ]);
    });

    it('returns a single-element chain when there is no supersedes link', async () => {
      const r = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      const chain = await mgr.getChain(r.id);
      expect(chain).toHaveLength(1);
      expect(chain[0]!.id).toBe(r.id);
    });
  });

  describe('list', () => {
    it('returns all decisions when no filter is supplied', async () => {
      await mgr.propose({ context: 'a', decision: 'a', alternatives: [], consequences: [] });
      await mgr.propose({ context: 'b', decision: 'b', alternatives: [], consequences: [] });
      expect(await mgr.list()).toHaveLength(2);
    });

    it('filters by status', async () => {
      const a = await mgr.propose({ context: 'a', decision: 'a', alternatives: [], consequences: [] });
      await mgr.propose({ context: 'b', decision: 'b', alternatives: [], consequences: [] });
      await mgr.accept(a.id);
      expect(await mgr.list({ status: 'accepted' })).toHaveLength(1);
      expect(await mgr.list({ status: 'proposed' })).toHaveLength(1);
    });
  });

  // ==================== ADR markdown dual-write (Phase Dec B) ====================

  describe('exportAsAdrMarkdown', () => {
    it('renders a DecisionRecord as ADR-format markdown', async () => {
      const rec = await mgr.propose({
        context: 'Selecting a hashing algorithm',
        decision: 'Use argon2id',
        alternatives: ['bcrypt', 'scrypt'],
        consequences: ['Higher memory cost', 'GPU-resistant'],
      });
      const md = mgr.exportAsAdrMarkdown(rec.id);
      expect(md).toMatch(/^# /m); // has a top-level heading
      expect(md).toContain('## Status');
      expect(md).toContain('Proposed');
      expect(md).toContain('## Context');
      expect(md).toContain('Selecting a hashing algorithm');
      expect(md).toContain('## Decision');
      expect(md).toContain('argon2id');
      expect(md).toContain('## Consequences');
      expect(md).toContain('- Higher memory cost');
      expect(md).toContain('## Alternatives');
      expect(md).toContain('- bcrypt');
    });

    it('reflects the current lifecycle status', async () => {
      const rec = await mgr.propose({
        context: 'c', decision: 'd', alternatives: [], consequences: [],
      });
      await mgr.accept(rec.id);
      const md = mgr.exportAsAdrMarkdown(rec.id);
      expect(md).toContain('## Status');
      expect(md).toContain('Accepted');
    });

    it('throws when the decision does not exist', () => {
      expect(() => mgr.exportAsAdrMarkdown('decision-does-not-exist')).toThrow(/not found/i);
    });
  });

  describe('parseAdrMarkdown', () => {
    it('round-trips a record through export → parse', async () => {
      const original = await mgr.propose({
        context: 'Selecting a hashing algorithm',
        decision: 'Use argon2id',
        alternatives: ['bcrypt', 'scrypt'],
        consequences: ['Higher memory cost', 'GPU-resistant'],
      });
      const md = mgr.exportAsAdrMarkdown(original.id);
      const parsed = DecisionManager.parseAdrMarkdown(md);
      expect(parsed).not.toBeNull();
      expect(parsed!.context).toBe(original.context);
      expect(parsed!.decision).toBe(original.decision);
      expect(parsed!.alternatives).toEqual(original.alternatives);
      expect(parsed!.consequences).toEqual(original.consequences);
    });

    it('returns null when required sections are missing', () => {
      const malformed = '# A title only — no Context or Decision';
      expect(DecisionManager.parseAdrMarkdown(malformed)).toBeNull();
    });

    it('parses a hand-written ADR with mixed whitespace', () => {
      const md = [
        '# 42. Use argon2id for password hashing',
        '',
        'Date: 2026-05-15',
        '',
        '## Status',
        '',
        'Accepted',
        '',
        '## Context',
        '',
        'We need to choose a password hashing algorithm that resists',
        'GPU-accelerated attacks while staying within the request budget.',
        '',
        '## Decision',
        '',
        'Use argon2id with a 64 MiB memory cost and 3 iterations.',
        '',
        '## Consequences',
        '',
        '- Higher memory footprint per auth request',
        '- Better attack resistance',
        '',
      ].join('\n');
      const parsed = DecisionManager.parseAdrMarkdown(md);
      expect(parsed).not.toBeNull();
      expect(parsed!.context).toContain('password hashing algorithm');
      expect(parsed!.decision).toContain('argon2id');
      expect(parsed!.consequences).toEqual([
        'Higher memory footprint per auth request',
        'Better attack resistance',
      ]);
    });
  });
});
