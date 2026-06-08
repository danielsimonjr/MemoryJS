/**
 * Known-issue regression tests
 *
 * Locks in the contracts of the two pre-existing concurrency holes
 * fixed alongside the Phase 11 close-out:
 *
 * - Phase 11 #3: `GraphStorage.ensureLoaded` shares an in-flight
 *   promise across concurrent callers so `loadFromDisk` runs at
 *   most once per cold-cache window.
 * - Phase 8 #9: `ObservationManager.addObservations` and
 *   `deleteObservations` acquire `storage.graphMutex` so a
 *   concurrent write to the same entity can't race the inline
 *   save against the shadow column write.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import type { Entity } from '../../../src/types/index.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `known-issue-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('Phase 11 #3: concurrent loadGraph shares the in-flight promise', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await makeDir();
    filePath = join(dir, 'memory.jsonl');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('two concurrent loadGraph() calls trigger exactly one loadFromDisk', async () => {
    // Seed a file so loadGraph has something to load.
    const seedStorage = new GraphStorage(filePath);
    await seedStorage.saveGraph({
      entities: [{ name: 'a', entityType: 'x', observations: [], createdAt: 't', lastModified: 't' }],
      relations: [],
    });

    // Fresh instance for the concurrency test.
    const storage = new GraphStorage(filePath);
    // Spy on the private loadFromDisk via the typed accessor.
    const loadSpy = vi.spyOn(storage as unknown as { loadFromDisk: () => Promise<void> }, 'loadFromDisk');

    const [a, b] = await Promise.all([storage.loadGraph(), storage.loadGraph()]);

    expect(a.entities).toHaveLength(1);
    expect(b.entities).toHaveLength(1);
    // Without the in-flight promise this would be 2.
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('after the in-flight promise resolves, a subsequent loadGraph hits the cache (no extra load)', async () => {
    const seedStorage = new GraphStorage(filePath);
    await seedStorage.saveGraph({
      entities: [{ name: 'a', entityType: 'x', observations: [], createdAt: 't', lastModified: 't' }],
      relations: [],
    });

    const storage = new GraphStorage(filePath);
    const loadSpy = vi.spyOn(storage as unknown as { loadFromDisk: () => Promise<void> }, 'loadFromDisk');

    await storage.loadGraph();
    await storage.loadGraph();
    await storage.loadGraph();

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('load failure clears the in-flight promise so the next caller retries', async () => {
    const storage = new GraphStorage(filePath);
    const realLoad = (storage as unknown as { loadFromDisk: () => Promise<void> }).loadFromDisk.bind(storage);
    let calls = 0;
    vi.spyOn(storage as unknown as { loadFromDisk: () => Promise<void> }, 'loadFromDisk').mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('synthetic-first-load-failure');
      return realLoad();
    });

    // Seed the file so the second load succeeds.
    await fs.writeFile(
      filePath,
      JSON.stringify({ type: 'entity', name: 'a', entityType: 'x', observations: [], createdAt: 't', lastModified: 't' }) + '\n',
    );

    // First call fails — the in-flight promise should clear so the
    // second call retries (not hang on a rejected promise).
    await expect(storage.loadGraph()).rejects.toThrow('synthetic-first-load-failure');
    const back = await storage.loadGraph();
    expect(back.entities).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

describe('Phase 8 #9: ObservationManager.addObservations serializes concurrent writes', () => {
  let dir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    dir = await makeDir();
    ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['initial'] },
    ]);
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('two concurrent addObservations on the same entity both land (no lost write)', async () => {
    // Pre-fix behavior: two concurrent calls both snapshot, both
    // call saveGraph; the second clobbers the first's persisted
    // state and we lose one of the two new observations.
    await Promise.all([
      ctx.observationManager.addObservations([
        { entityName: 'alice', contents: ['from-call-A'] },
      ]),
      ctx.observationManager.addObservations([
        { entityName: 'alice', contents: ['from-call-B'] },
      ]),
    ]);

    // Reload from disk (clears any cached state) to verify both
    // writes actually persisted.
    const fresh = new ManagerContext(join(dir, 'memory.jsonl'));
    const alice = await fresh.entityManager.getEntity('alice');
    expect(alice).toBeDefined();
    expect(alice!.observations).toContain('initial');
    expect(alice!.observations).toContain('from-call-A');
    expect(alice!.observations).toContain('from-call-B');
  });

  it('two concurrent deleteObservations both apply (no lost delete)', async () => {
    await ctx.observationManager.addObservations([
      { entityName: 'alice', contents: ['o1', 'o2', 'o3'] },
    ]);

    await Promise.all([
      ctx.observationManager.deleteObservations([
        { entityName: 'alice', observations: ['o1'] },
      ]),
      ctx.observationManager.deleteObservations([
        { entityName: 'alice', observations: ['o2'] },
      ]),
    ]);

    const fresh = new ManagerContext(join(dir, 'memory.jsonl'));
    const alice = await fresh.entityManager.getEntity('alice');
    expect(alice!.observations).not.toContain('o1');
    expect(alice!.observations).not.toContain('o2');
    expect(alice!.observations).toContain('o3');
  });

  it('100 concurrent addObservations on the same entity all land', async () => {
    const expected = Array.from({ length: 100 }, (_, i) => `parallel-${i}`);
    await Promise.all(
      expected.map((content) =>
        ctx.observationManager.addObservations([
          { entityName: 'alice', contents: [content] },
        ]),
      ),
    );

    const fresh = new ManagerContext(join(dir, 'memory.jsonl'));
    const alice = await fresh.entityManager.getEntity('alice');
    const finalObservations = new Set(alice!.observations);
    for (const e of expected) {
      expect(finalObservations.has(e), `lost write: ${e}`).toBe(true);
    }
  });
});

describe('column-store + addObservations concurrency: shadow stays in sync', () => {
  let dir: string;
  const savedEnv = process.env.MEMORY_OBSERVATIONS_COLUMNAR;

  beforeEach(async () => {
    dir = await makeDir();
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
  });
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_OBSERVATIONS_COLUMNAR;
    else process.env.MEMORY_OBSERVATIONS_COLUMNAR = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('shadow column store sees every concurrent observation (was the race that exposed #9)', async () => {
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    // Touch observationManager so the column-store event subscription wires up.
    void ctx.observationManager;
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: [] },
    ]);

    const expected = Array.from({ length: 20 }, (_, i) => `concurrent-${i}`);
    await Promise.all(
      expected.map((content) =>
        ctx.observationManager.addObservations([
          { entityName: 'alice', contents: [content] },
        ]),
      ),
    );

    // Wait for the async shadow writes to settle.
    await new Promise((r) => setTimeout(r, 100));

    // Inline state on disk:
    const fresh = new ManagerContext(join(dir, 'memory.jsonl'));
    const alice = await fresh.entityManager.getEntity('alice');
    expect(alice!.observations.sort()).toEqual(expected.sort());

    // Column-store state:
    const fromColumn = await ctx.observationManager.getObservationsFor('alice');
    expect(fromColumn.sort()).toEqual(expected.sort());
  });
});
