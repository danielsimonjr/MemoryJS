/**
 * DES-12 (CMP-8): `ctx.diagnostics({ observationDedup: true })` reports the
 * observation dedup ratio over the cached graph. Default call must not load.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { withBothBackends, cleanupTempDirs, makeTempJsonlPath, makeTempSqlitePath } from '../../helpers/tempStorage.js';

const SHARED = 'Shared observation text';

const savedType = process.env.MEMORY_STORAGE_TYPE;

function pathFor(name: 'jsonl' | 'sqlite'): string {
  return name === 'jsonl' ? makeTempJsonlPath() : makeTempSqlitePath();
}

async function seed(filePath: string, name: 'jsonl' | 'sqlite'): Promise<void> {
  process.env.MEMORY_STORAGE_TYPE = name;
  const ctx = new ManagerContext(filePath);
  await ctx.entityManager.createEntities([
    { name: 'A', entityType: 'note', observations: [SHARED, 'only in A'] },
    { name: 'B', entityType: 'note', observations: [SHARED] },
    { name: 'C', entityType: 'task', observations: [SHARED, 'only in C'] },
  ]);
  // Close the seeding context: Windows cannot remove a temp dir while a
  // SQLite connection inside it is still open (EBUSY on rmSync).
  ctx.close();
}

function closeCtx(ctx: ManagerContext): void {
  ctx.close();
}

describe('ctx.diagnostics() observationDedup opt-in (DES-12)', () => {
  beforeEach(() => {
    delete process.env.MEMORY_STORAGE_TYPE;
  });

  afterEach(() => {
    if (savedType === undefined) delete process.env.MEMORY_STORAGE_TYPE;
    else process.env.MEMORY_STORAGE_TYPE = savedType;
    cleanupTempDirs();
  });

  withBothBackends('empty graph', (backend) => {
    it('reports zero observations and dedupRatio 1 when the cache is loaded but empty', async () => {
      process.env.MEMORY_STORAGE_TYPE = backend.name;
      const ctx = new ManagerContext(pathFor(backend.name));
      await ctx.storage.loadGraph();
      const report = ctx.diagnostics({ observationDedup: true });
      expect(report.observationDedup).toEqual({
        uniqueObservations: 0,
        totalReferences: 0,
        dedupRatio: 1,
        bytesSaved: 0,
      });
      expect(ctx.observationStore.size()).toBe(0);
      closeCtx(ctx);
    });

    it('leaves observationDedup undefined when nothing is cached', () => {
      process.env.MEMORY_STORAGE_TYPE = backend.name;
      const ctx = new ManagerContext(pathFor(backend.name));
      const report = ctx.diagnostics({ observationDedup: true });
      expect(report.observationDedup).toBeUndefined();
      closeCtx(ctx);
    });
  });

  withBothBackends('duplicated observations across entities', (backend) => {
    it('counts shared observations across entities and reports a dedup ratio > 1', async () => {
      const filePath = pathFor(backend.name);
      await seed(filePath, backend.name);

      process.env.MEMORY_STORAGE_TYPE = backend.name;
      const ctx = new ManagerContext(filePath);
      await ctx.storage.loadGraph();
      const report = ctx.diagnostics({ observationDedup: true });
      // 5 logical observations (A:2, B:1, C:2); unique = SHARED + 'only in A' + 'only in C' = 3.
      expect(report.observationDedup?.totalReferences).toBe(5);
      expect(report.observationDedup?.uniqueObservations).toBe(3);
      expect(report.observationDedup?.dedupRatio).toBeCloseTo(5 / 3, 5);
      expect(report.observationDedup?.bytesSaved).toBe(SHARED.length * 2);
      closeCtx(ctx);
    });

    it('does not populate ctx.observationStore (throwaway store only)', async () => {
      const filePath = pathFor(backend.name);
      await seed(filePath, backend.name);

      process.env.MEMORY_STORAGE_TYPE = backend.name;
      const ctx = new ManagerContext(filePath);
      await ctx.storage.loadGraph();
      ctx.diagnostics({ observationDedup: true });
      expect(ctx.observationStore.size()).toBe(0);
      closeCtx(ctx);
    });

    it('omits observationDedup without the opt-in and does not load the graph', async () => {
      const filePath = pathFor(backend.name);
      await seed(filePath, backend.name);

      process.env.MEMORY_STORAGE_TYPE = backend.name;
      const ctx = new ManagerContext(filePath);
      const loadSpy = vi.spyOn(ctx.storage, 'loadGraph');
      const report = ctx.diagnostics();
      expect(loadSpy).not.toHaveBeenCalled();
      expect(report.observationDedup).toBeUndefined();
      expect(report.entityCounts.total).toBe(-1);
      expect('observationDedup' in report).toBe(false);

      const explicitFalse = ctx.diagnostics({ observationDedup: false });
      expect(loadSpy).not.toHaveBeenCalled();
      expect(explicitFalse.observationDedup).toBeUndefined();
      closeCtx(ctx);
    });
  });

});
