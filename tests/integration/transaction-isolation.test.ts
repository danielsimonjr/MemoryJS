/**
 * Transaction isolation and persistence guarantees (wave 1 step 4).
 *
 * Every test reopens the storage from disk with a fresh instance, so an
 * acknowledged operation that only lives in a cache does not count.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { ManagerContext } from '../../src/core/ManagerContext.js';
import { BatchTransaction, TransactionManager } from '../../src/core/TransactionManager.js';

async function reopen(file: string) {
  return new GraphStorage(file).loadGraph();
}

describe('transaction isolation (JSONL, single process)', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tx-isolation-'));
    file = path.join(dir, 'memory.jsonl');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function seed(names: string[]) {
    const storage = new GraphStorage(file);
    await storage.saveGraph({
      entities: names.map(name => ({ name, entityType: 't', observations: [] })),
      relations: [],
    });
  }

  it('concurrent batches keep every acknowledged update after reopen', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `e${i}`);
    await seed(names);
    const storage = new GraphStorage(file);

    const results = await Promise.all(
      names.map((name, i) => new BatchTransaction(storage).updateEntity(name, { importance: i + 1 }).execute()),
    );
    expect(results.every(r => r.success)).toBe(true);

    const graph = await reopen(file);
    for (const [i, name] of names.entries()) {
      expect(graph.entities.find(e => e.name === name)?.importance).toBe(i + 1);
    }
  });

  it('batches mixed with ordinary manager writes keep every acknowledged operation', async () => {
    const ctx = new ManagerContext(file);
    await ctx.entityManager.createEntities([
      { name: 'hub', entityType: 't', observations: [] },
      { name: 'b0', entityType: 't', observations: [] },
    ]);

    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 6; i++) {
      work.push(ctx.batch(b => { b.addObservations('b0', [`batch ${i}`]); }));
      work.push(ctx.observationManager.addObservations([{ entityName: 'hub', contents: [`manager ${i}`] }]));
      work.push(ctx.entityManager.createEntities([{ name: `m${i}`, entityType: 't', observations: [] }]));
    }
    const settled = await Promise.all(work);
    for (const r of settled) {
      if (r && typeof r === 'object' && 'success' in r) expect((r as { success: boolean }).success).toBe(true);
    }

    const graph = await reopen(file);
    const hub = graph.entities.find(e => e.name === 'hub')!;
    const b0 = graph.entities.find(e => e.name === 'b0')!;
    for (let i = 0; i < 6; i++) {
      expect(hub.observations).toContain(`manager ${i}`);
      expect(b0.observations).toContain(`batch ${i}`);
      expect(graph.entities.some(e => e.name === `m${i}`)).toBe(true);
    }
  });

  it('concurrent legacy TransactionManager commits keep every acknowledged update', async () => {
    await seed(['a', 'b', 'c']);
    const storage = new GraphStorage(file);
    const commits = ['a', 'b', 'c'].map(async (name, i) => {
      const tm = new TransactionManager(storage);
      tm.begin();
      tm.updateEntity(name, { importance: i + 5 });
      return tm.commit();
    });
    const results = await Promise.all(commits);
    expect(results.map(r => r.error)).toEqual([undefined, undefined, undefined]);

    const graph = await reopen(file);
    expect(graph.entities.map(e => e.importance)).toEqual([5, 6, 7]);
  });

  it('a queued batch cancelled before it acquires the lock never runs', async () => {
    await seed(['x']);
    const storage = new GraphStorage(file);
    const release = await storage.graphMutex.acquire();
    const controller = new AbortController();
    const pending = new BatchTransaction(storage)
      .createEntity({ name: 'never', entityType: 't', observations: [] })
      .execute({ signal: controller.signal });
    controller.abort();
    const spy = vi.spyOn(storage, 'getGraphForMutation');
    release();

    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.operationsExecuted).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect((await reopen(file)).entities.map(e => e.name)).toEqual(['x']);
  });

  for (const boundary of ['write', 'sync', 'rename'] as const) {
    it(`a failure at the ${boundary} boundary leaves the old state on reopen`, async () => {
      await seed(['old']);
      const storage = new GraphStorage(file);
      await storage.loadGraph();
      const realOpen = fs.open.bind(fs);
      const injected = Object.assign(new Error(`injected ${boundary}`), { code: 'EIO' });
      if (boundary === 'rename') {
        vi.spyOn(fs, 'rename').mockRejectedValueOnce(injected);
      } else {
        vi.spyOn(fs, 'open').mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
          const handle = await realOpen(...args);
          if (boundary === 'write') vi.spyOn(handle, 'write').mockRejectedValueOnce(injected);
          else vi.spyOn(handle, 'sync').mockRejectedValueOnce(injected);
          return handle;
        });
      }

      const result = await new BatchTransaction(storage)
        .createEntity({ name: 'new', entityType: 't', observations: [] })
        .execute();
      expect(result.success).toBe(false);

      const graph = await reopen(file);
      expect(graph.entities.map(e => e.name)).toEqual(['old']);
    });
  }
});

describe('TransactionManager rollback', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tx-rollback-'));
    file = path.join(dir, 'memory.jsonl');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const legacyLines = [
    JSON.stringify({ type: 'entity', name: 'a', entityType: 't', observations: [] }),
    JSON.stringify({ type: 'entity', name: 'b', entityType: 't', observations: [] }),
    JSON.stringify({ type: 'relation', from: 'a', to: 'b', relationType: 'r' }),
  ].join('\n');

  it('a failed commit restores the exact pre-commit state (no timestamps filled in)', async () => {
    await fs.writeFile(file, legacyLines);
    const storage = new GraphStorage(file);
    const tm = new TransactionManager(storage);
    tm.begin();
    tm.updateEntity('a', { importance: 3 });
    tm.createEntity({ name: 'a', entityType: 't', observations: [] }); // duplicate -> fails

    const result = await tm.commit();
    expect(result.success).toBe(false);

    // Nothing was saved, so rollback must not rewrite the file. (Restoring the
    // backup used to rewrite it with filled-in timestamps.)
    expect(await fs.readFile(file, 'utf8')).toBe(legacyLines);
    const graph = await reopen(file);
    expect(graph.entities.find(e => e.name === 'a')?.importance).toBeUndefined();
  });

  it('a save failure rolls back to the exact pre-commit state', async () => {
    await fs.writeFile(file, legacyLines);
    const storage = new GraphStorage(file);
    const loadedRelationCreatedAt = (await storage.loadGraph()).relations[0].createdAt;
    const realSave = storage.saveGraph.bind(storage);
    vi.spyOn(storage, 'saveGraph').mockImplementationOnce(async graph => {
      await realSave(graph);
      throw new Error('injected after write');
    });
    const tm = new TransactionManager(storage);
    tm.begin();
    tm.createEntity({ name: 'c', entityType: 't', observations: [] });

    const result = await tm.commit();
    expect(result.success).toBe(false);

    const graph = await reopen(file);
    expect(graph.entities.map(e => e.name)).toEqual(['a', 'b']);
    // The pre-commit in-memory graph is written back as it was; the backup's
    // restore path would stamp a new, later timestamp instead.
    expect(graph.relations[0].createdAt).toBe(loadedRelationCreatedAt);
  });

  it('a rollback failure keeps a valid old or new state and reports the backup', async () => {
    await fs.writeFile(file, legacyLines);
    const storage = new GraphStorage(file);
    await storage.loadGraph();
    vi.spyOn(storage, 'saveGraph').mockRejectedValue(new Error('disk gone'));
    const tm = new TransactionManager(storage);
    tm.begin();
    tm.createEntity({ name: 'c', entityType: 't', observations: [] });

    const result = await tm.commit();
    expect(result.success).toBe(false);
    expect(result.rollbackBackup).toBeDefined();
    await expect(fs.access(result.rollbackBackup!)).resolves.toBeUndefined();

    vi.restoreAllMocks();
    const names = (await reopen(file)).entities.map(e => e.name);
    expect([['a', 'b'], ['a', 'b', 'c']]).toContainEqual(names);
  });
});
