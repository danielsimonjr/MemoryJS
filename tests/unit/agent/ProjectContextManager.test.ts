/**
 * ProjectContextManager — Phase PC A unit tests.
 *
 * Covers:
 * - upsert creates a new context on first call; merges on subsequent
 * - arrays (facts/conventions) dedup on merge
 * - typed appenders (appendFact / appendConvention / appendCommand /
 *   appendGlossaryTerm) work and dedup
 * - removeFact / removeConvention / removeCommand / removeGlossaryTerm
 * - clear wipes the four arrays but keeps the entity
 * - get is synchronous via storage.getEntityByName
 * - forContext returns a prose summary respecting an optional budget
 * - OCC: 'conflict' arm via VersionConflictError
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectContextManager } from '../../../src/agent/ProjectContextManager.js';
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

describe('ProjectContextManager', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let entityManager: EntityManager;
  let mgr: ProjectContextManager;

  beforeEach(() => {
    storage = createMockStorage();
    entityManager = createFakeEntityManager(storage);
    mgr = new ProjectContextManager(storage, entityManager);
  });

  describe('upsert', () => {
    it('creates a new ProjectContextRecord on first call', async () => {
      const rec = await mgr.upsert('proj_alpha', {
        facts: ['Built with TypeScript'],
        conventions: ['Prefer Result<T,E> over throw'],
      });
      expect(rec.projectId).toBe('proj_alpha');
      expect(rec.facts).toEqual(['Built with TypeScript']);
      expect(rec.conventions).toEqual(['Prefer Result<T,E> over throw']);
      expect(rec.commands).toEqual([]);
      expect(rec.glossary).toEqual([]);
    });

    it('merges arrays on subsequent calls (append + dedup)', async () => {
      await mgr.upsert('proj_alpha', { facts: ['A', 'B'] });
      const merged = await mgr.upsert('proj_alpha', { facts: ['B', 'C'] });
      expect(merged.facts).toEqual(['A', 'B', 'C']);
    });

    it('overwrites scalars on merge (e.g. lastUpdated)', async () => {
      const first = await mgr.upsert('proj_alpha', { facts: ['A'] });
      // Wait a tick so timestamps differ
      await new Promise((r) => setTimeout(r, 5));
      const second = await mgr.upsert('proj_alpha', { facts: ['B'] });
      expect(second.lastUpdated).not.toBe(first.lastUpdated);
    });

    it('returns "conflict" via VersionConflictError handling', async () => {
      await mgr.upsert('proj_alpha', { facts: ['A'] });
      (entityManager.updateEntity as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new VersionConflictError('project-context-proj_alpha', 1, 2));
      await expect(mgr.upsert('proj_alpha', { facts: ['B'] })).rejects.toThrow(/conflict/i);
    });
  });

  describe('typed appenders', () => {
    it('appendFact adds + dedups', async () => {
      await mgr.upsert('proj_alpha', {});
      await mgr.appendFact('proj_alpha', 'Built with TypeScript');
      await mgr.appendFact('proj_alpha', 'Built with TypeScript');
      const rec = mgr.get('proj_alpha')!;
      expect(rec.facts).toEqual(['Built with TypeScript']);
    });

    it('appendConvention adds + dedups', async () => {
      await mgr.upsert('proj_alpha', {});
      await mgr.appendConvention('proj_alpha', 'Use Result<T,E>');
      await mgr.appendConvention('proj_alpha', 'Use Result<T,E>');
      const rec = mgr.get('proj_alpha')!;
      expect(rec.conventions).toEqual(['Use Result<T,E>']);
    });

    it('appendCommand adds + dedups by name', async () => {
      await mgr.upsert('proj_alpha', {});
      await mgr.appendCommand('proj_alpha', {
        name: 'test', command: 'npm test', purpose: 'Run all tests',
      });
      await mgr.appendCommand('proj_alpha', {
        name: 'test', command: 'npm test', purpose: 'Run all tests',
      });
      const rec = mgr.get('proj_alpha')!;
      expect(rec.commands).toHaveLength(1);
    });

    it('appendGlossaryTerm adds + dedups by term', async () => {
      await mgr.upsert('proj_alpha', {});
      await mgr.appendGlossaryTerm('proj_alpha', {
        term: 'OCC', definition: 'Optimistic Concurrency Control',
      });
      await mgr.appendGlossaryTerm('proj_alpha', {
        term: 'OCC', definition: 'Optimistic Concurrency Control',
      });
      const rec = mgr.get('proj_alpha')!;
      expect(rec.glossary).toHaveLength(1);
    });

    it('auto-creates the context when an appender is called on a fresh projectId', async () => {
      await mgr.appendFact('proj_brand_new', 'Initial fact');
      const rec = mgr.get('proj_brand_new')!;
      expect(rec).toBeDefined();
      expect(rec.facts).toEqual(['Initial fact']);
    });
  });

  describe('remove operations', () => {
    it('removeFact drops a single fact and returns true', async () => {
      await mgr.upsert('proj_alpha', { facts: ['A', 'B', 'C'] });
      expect(await mgr.removeFact('proj_alpha', 'B')).toBe(true);
      expect(mgr.get('proj_alpha')!.facts).toEqual(['A', 'C']);
    });

    it('removeFact returns false when the fact is not present', async () => {
      await mgr.upsert('proj_alpha', { facts: ['A'] });
      expect(await mgr.removeFact('proj_alpha', 'unknown')).toBe(false);
    });

    it('removeCommand drops by name', async () => {
      await mgr.upsert('proj_alpha', {
        commands: [
          { name: 'test', command: 'npm test', purpose: 'tests' },
          { name: 'build', command: 'npm run build', purpose: 'compile' },
        ],
      });
      expect(await mgr.removeCommand('proj_alpha', 'test')).toBe(true);
      const rec = mgr.get('proj_alpha')!;
      expect(rec.commands).toHaveLength(1);
      expect(rec.commands[0]!.name).toBe('build');
    });
  });

  describe('clear', () => {
    it('wipes all four arrays but keeps the entity', async () => {
      await mgr.upsert('proj_alpha', {
        facts: ['A'],
        conventions: ['B'],
        commands: [{ name: 'c', command: 'c', purpose: 'c' }],
        glossary: [{ term: 'g', definition: 'g' }],
      });
      expect(await mgr.clear('proj_alpha')).toBe(true);
      const rec = mgr.get('proj_alpha')!;
      expect(rec).toBeDefined();
      expect(rec.facts).toEqual([]);
      expect(rec.conventions).toEqual([]);
      expect(rec.commands).toEqual([]);
      expect(rec.glossary).toEqual([]);
    });

    it('returns false when the projectId has no context', async () => {
      expect(await mgr.clear('does_not_exist')).toBe(false);
    });
  });

  describe('get', () => {
    it('returns undefined for unknown projectId', () => {
      expect(mgr.get('unknown_proj')).toBeUndefined();
    });
  });

  describe('forContext', () => {
    it('returns a prose summary that includes all four sections', async () => {
      await mgr.upsert('proj_alpha', {
        facts: ['Built with TypeScript', 'Uses Vitest'],
        conventions: ['Use Result<T,E>'],
        commands: [{ name: 'test', command: 'npm test', purpose: 'Run all tests' }],
        glossary: [{ term: 'OCC', definition: 'Optimistic Concurrency Control' }],
      });
      const prose = await mgr.forContext('proj_alpha');
      expect(prose).toContain('Facts');
      expect(prose).toContain('TypeScript');
      expect(prose).toContain('Conventions');
      expect(prose).toContain('Result<T,E>');
      expect(prose).toContain('Commands');
      expect(prose).toContain('npm test');
      expect(prose).toContain('Glossary');
      expect(prose).toContain('OCC');
    });

    it('returns an empty string for unknown projectId', async () => {
      expect(await mgr.forContext('unknown_proj')).toBe('');
    });

    it('respects an optional character budget', async () => {
      await mgr.upsert('proj_alpha', {
        facts: Array.from({ length: 50 }, (_, i) => `Fact ${i} is a longer-than-average sentence with multiple words.`),
      });
      const prose = await mgr.forContext('proj_alpha', { budgetChars: 200 });
      expect(prose.length).toBeLessThanOrEqual(220); // leave room for truncation marker
    });
  });
});
