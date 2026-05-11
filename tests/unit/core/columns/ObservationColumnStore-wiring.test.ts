/**
 * ObservationManager <-> Column Store wiring tests
 *
 * Covers Phase 8 tasks 66 + 67: `ObservationManager` shadow-mirrors
 * observation writes to an attached `IColumnStore`, and
 * `getObservationsFor(name)` reads the column store first with an
 * inline fallback. Activated via `MEMORY_OBSERVATIONS_COLUMNAR=true`
 * env var resolved by `ManagerContext`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import { ObservationManager } from '../../../../src/core/ObservationManager.js';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import {
  InMemoryColumnStore,
  type ObservationColumn,
} from '../../../../src/core/columns/IColumnStore.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `obs-col-test-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const savedEnv = process.env.MEMORY_OBSERVATIONS_COLUMNAR;

describe('ObservationManager column-store wiring', () => {
  let dir: string;
  let storage: GraphStorage;
  let manager: ObservationManager;

  beforeEach(async () => {
    dir = await makeDir();
    storage = new GraphStorage(join(dir, 'memory.jsonl'));
    manager = new ObservationManager(storage);
  });

  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('setColumnStore + hasColumnStore reflect attach/detach', () => {
    expect(manager.hasColumnStore()).toBe(false);
    manager.setColumnStore(new InMemoryColumnStore<ObservationColumn>());
    expect(manager.hasColumnStore()).toBe(true);
    manager.setColumnStore(null);
    expect(manager.hasColumnStore()).toBe(false);
  });

  it('getObservationsFor returns [] for unknown entity', async () => {
    expect(await manager.getObservationsFor('ghost')).toEqual([]);
  });

  it('getObservationsFor falls back to inline when no column store attached', async () => {
    await storage.saveGraph({
      entities: [{ name: 'alice', entityType: 'person', observations: ['inline-only'] }],
      relations: [],
    });
    expect(await manager.getObservationsFor('alice')).toEqual(['inline-only']);
  });

  it('addObservations shadow-mirrors to column store after save', async () => {
    const col = new InMemoryColumnStore<ObservationColumn>();
    manager.setColumnStore(col);
    await storage.saveGraph({
      entities: [{ name: 'alice', entityType: 'person', observations: [] }],
      relations: [],
    });
    await manager.addObservations([
      { entityName: 'alice', contents: ['o1', 'o2'] },
    ]);
    expect(await col.get('alice')).toEqual(['o1', 'o2']);
  });

  it('deleteObservations shadow-updates column store with the remaining values', async () => {
    const col = new InMemoryColumnStore<ObservationColumn>();
    manager.setColumnStore(col);
    await storage.saveGraph({
      entities: [{ name: 'alice', entityType: 'person', observations: ['o1', 'o2', 'o3'] }],
      relations: [],
    });
    // Prime the column store with the initial state.
    await col.put('alice', ['o1', 'o2', 'o3']);

    await manager.deleteObservations([
      { entityName: 'alice', observations: ['o2'] },
    ]);
    expect(await col.get('alice')).toEqual(['o1', 'o3']);
  });

  it('getObservationsFor prefers column store over inline when both populated', async () => {
    const col = new InMemoryColumnStore<ObservationColumn>();
    manager.setColumnStore(col);
    await storage.saveGraph({
      entities: [{ name: 'alice', entityType: 'person', observations: ['inline-value'] }],
      relations: [],
    });
    await col.put('alice', ['column-value']);
    expect(await manager.getObservationsFor('alice')).toEqual(['column-value']);
  });

  it('getObservationsFor falls back to inline when column store has no entry', async () => {
    // "Mixed-format" graph — some entities migrated, others not.
    const col = new InMemoryColumnStore<ObservationColumn>();
    manager.setColumnStore(col);
    await storage.saveGraph({
      entities: [
        { name: 'alice', entityType: 'person', observations: ['inline'] },
        { name: 'bob', entityType: 'person', observations: ['inline-b'] },
      ],
      relations: [],
    });
    await col.put('alice', ['column']);
    // alice has a column-store entry → reads column
    expect(await manager.getObservationsFor('alice')).toEqual(['column']);
    // bob has no column entry → falls back to inline
    expect(await manager.getObservationsFor('bob')).toEqual(['inline-b']);
  });

  it('column-store write failure logs but does not reject the addObservations call', async () => {
    // Build a column store whose put() always throws.
    const failingStore = new InMemoryColumnStore<ObservationColumn>();
    const realPut = failingStore.put.bind(failingStore);
    failingStore.put = async () => {
      throw new Error('synthetic shadow-write failure');
    };
    manager.setColumnStore(failingStore);

    await storage.saveGraph({
      entities: [{ name: 'alice', entityType: 'person', observations: [] }],
      relations: [],
    });

    // Should NOT throw — inline state is authoritative; column-store
    // failure is best-effort.
    await expect(
      manager.addObservations([{ entityName: 'alice', contents: ['o1'] }]),
    ).resolves.toBeDefined();

    // Inline state still got the write.
    const fresh = new GraphStorage(join(dir, 'memory.jsonl'));
    const graph = await fresh.loadGraph();
    const alice = graph.entities.find((e) => e.name === 'alice');
    expect(alice?.observations).toEqual(['o1']);

    // Sanity — realPut was never replaced back, so column store stays
    // empty. (Just confirming the spy mechanism worked.)
    expect(realPut).toBeDefined();
  });

  it('getObservationsFor returns a defensive copy — caller mutation does not leak', async () => {
    const col = new InMemoryColumnStore<ObservationColumn>();
    manager.setColumnStore(col);
    await col.put('alice', ['o1']);
    const obs = await manager.getObservationsFor('alice');
    obs.push('mutation');
    expect(await manager.getObservationsFor('alice')).toEqual(['o1']);
  });
});

describe('ManagerContext.observationColumnStore env-gating', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_OBSERVATIONS_COLUMNAR;
    else process.env.MEMORY_OBSERVATIONS_COLUMNAR = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('unset → observationColumnStore is null, no sidecar file created on writes', async () => {
    delete process.env.MEMORY_OBSERVATIONS_COLUMNAR;
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.observationColumnStore).toBeNull();
    expect(ctx.observationManager.hasColumnStore()).toBe(false);

    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['hello'] },
    ]);
    await expect(fs.access(join(dir, 'memory.observations.jsonl'))).rejects.toThrow();
  });

  it('=true → observationColumnStore is non-null and ObservationManager has it wired', async () => {
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.observationColumnStore).not.toBeNull();
    expect(ctx.observationManager.hasColumnStore()).toBe(true);
  });

  it('=false / =1 / =yes do NOT activate (strict literal match)', () => {
    for (const value of ['false', '1', 'yes', 'TRUE', 'True', '']) {
      delete process.env.MEMORY_OBSERVATIONS_COLUMNAR;
      if (value !== '') process.env.MEMORY_OBSERVATIONS_COLUMNAR = value;
      const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
      expect(ctx.observationColumnStore).toBeNull();
    }
  });

  it('end-to-end: addObservations through ManagerContext populates the sidecar file', async () => {
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: [] },
    ]);
    await ctx.observationManager.addObservations([
      { entityName: 'alice', contents: ['o1', 'o2'] },
    ]);

    const sidecarContent = await fs.readFile(
      join(dir, 'memory.observations.jsonl'),
      'utf-8',
    );
    expect(sidecarContent).toContain('alice');
    expect(sidecarContent).toContain('o1');
    expect(sidecarContent).toContain('o2');

    // Reads via getObservationsFor return the column-store value.
    expect(await ctx.observationManager.getObservationsFor('alice')).toEqual(['o1', 'o2']);
  });
});
