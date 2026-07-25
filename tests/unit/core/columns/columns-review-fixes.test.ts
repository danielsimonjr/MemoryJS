/**
 * Phase 8 review-fix regression tests
 *
 * Targets the substantive findings from the Phase 8 review on the
 * cumulative diff through `2b94279`:
 * - #1 + #10  JsonlColumnStore rollback on flush failure
 * - #2 + #11  Deleted-entity ghost data through column store
 * - #3 + #12  Bypass paths (createEntities / updateEntity) shadow-mirror
 * - #4        reload() drops cache so external sidecar edits become visible
 * - #14       Sidecar path uses hyphen-delimited convention
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { JsonlColumnStore } from '../../../../src/core/columns/JsonlColumnStore.js';
import {
  InMemoryColumnStore,
  type ObservationColumn,
} from '../../../../src/core/columns/IColumnStore.js';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import { injectFlushFailure as sharedInjectFlushFailure } from '../../../test-utils/inject-flush-failure.js';

/**
 * Poll until `read()` satisfies `predicate`.
 *
 * The column store mirrors observation writes from a `GraphEventEmitter`
 * subscription — the listener fires synchronously but does its work async, so
 * an awaited entity write does NOT guarantee the mirror has landed. A fixed
 * `setTimeout` race loses under parallel-suite I/O load (these tests used a
 * flat 50ms and intermittently read a not-yet-written sidecar: `ENOENT` /
 * stale value). Polling is deterministic and usually far faster.
 */
async function waitUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  what: string,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  let lastErr: unknown;
  for (;;) {
    try {
      last = await read();
      if (predicate(last)) return last;
    } catch (err) {
      // Not ready yet (e.g. sidecar file absent) — keep polling, but remember
      // the error so a timeout reports WHY rather than just "undefined".
      lastErr = err;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `waitUntil timed out after ${timeoutMs}ms waiting for ${what}; ` +
          `last value: ${JSON.stringify(last)}` +
          (lastErr ? `; last error: ${String(lastErr)}` : ''),
      );
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Poll until `path` exists (same fire-and-forget mirror caveat as above). */
async function waitForFile(path: string, timeoutMs = 3000): Promise<void> {
  await waitUntil(
    async () => fs.access(path).then(() => true).catch(() => false),
    (ok) => ok,
    `file to exist: ${path}`,
    timeoutMs,
  );
}

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `cols-review-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const savedEnv = process.env.MEMORY_OBSERVATIONS_COLUMNAR;

describe('Review #1 + #10: JsonlColumnStore rollback on flush failure', () => {
  let dir: string;
  let sidecarPath: string;
  let store: JsonlColumnStore<ObservationColumn>;

  beforeEach(async () => {
    dir = await makeDir();
    sidecarPath = join(dir, 'sidecar.jsonl');
    store = new JsonlColumnStore(sidecarPath);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  // Shared helper — see `tests/test-utils/inject-flush-failure.ts`.
  const injectFlushFailure = (): void => {
    sharedInjectFlushFailure(sidecarPath);
  };

  it('put: cache rolls back if flush fails (no-prior-value branch)', async () => {
    // Prime with one entry so the snapshot has something to roll back to.
    await store.put('alice', ['a-1']);
    injectFlushFailure();
    await expect(store.put('bob', ['b-1'])).rejects.toThrow(/synthetic/);
    vi.restoreAllMocks();
    expect(await store.has('bob')).toBe(false);
    expect(await store.get('alice')).toEqual(['a-1']);
  });

  it('put: cache rolls back to prior value (had-prior branch)', async () => {
    await store.put('alice', ['original']);
    injectFlushFailure();
    await expect(store.put('alice', ['replacement'])).rejects.toThrow(/synthetic/);
    vi.restoreAllMocks();
    expect(await store.get('alice')).toEqual(['original']);
  });

  it('delete: cache restores the deleted value on flush failure', async () => {
    await store.put('alice', ['keepme']);
    injectFlushFailure();
    await expect(store.delete('alice')).rejects.toThrow(/synthetic/);
    vi.restoreAllMocks();
    expect(await store.get('alice')).toEqual(['keepme']);
  });

  it('batchPut: whole batch rolls back on flush failure (no partial state)', async () => {
    await store.put('existing', ['e-original']);
    injectFlushFailure();
    await expect(
      store.batchPut([
        { name: 'existing', value: ['e-modified'] },
        { name: 'new1', value: ['n1'] },
        { name: 'new2', value: ['n2'] },
      ]),
    ).rejects.toThrow(/synthetic/);
    vi.restoreAllMocks();
    expect(await store.get('existing')).toEqual(['e-original']);
    expect(await store.has('new1')).toBe(false);
    expect(await store.has('new2')).toBe(false);
  });

  it('clear: cache restores on flush failure', async () => {
    await store.put('alice', ['x']);
    await store.put('bob', ['y']);
    injectFlushFailure();
    await expect(store.clear()).rejects.toThrow(/synthetic/);
    vi.restoreAllMocks();
    expect(await store.size()).toBe(2);
    expect(await store.get('alice')).toEqual(['x']);
  });
});

describe('Review #4: reload() drops cache for external-edit visibility', () => {
  let dir: string;
  let sidecarPath: string;

  beforeEach(async () => {
    dir = await makeDir();
    sidecarPath = join(dir, 'sidecar.jsonl');
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('JsonlColumnStore.reload() picks up an externally-edited sidecar', async () => {
    const store = new JsonlColumnStore<ObservationColumn>(sidecarPath);
    await store.put('alice', ['v1']);
    // External writer (simulated migration tool) replaces the file.
    await fs.writeFile(sidecarPath, JSON.stringify({ name: 'alice', value: ['external-edit'] }) + '\n');
    // Before reload: stale cache still wins.
    expect(await store.get('alice')).toEqual(['v1']);
    // After reload: fresh value visible.
    await store.reload();
    expect(await store.get('alice')).toEqual(['external-edit']);
  });

  it('InMemoryColumnStore.reload() is a no-op (cache IS the store)', async () => {
    const store = new InMemoryColumnStore<ObservationColumn>();
    await store.put('alice', ['x']);
    await store.reload();
    expect(await store.get('alice')).toEqual(['x']);
  });
});

describe('Review #2 + #11: deleted-entity ghost data', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
  });
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_OBSERVATIONS_COLUMNAR;
    else process.env.MEMORY_OBSERVATIONS_COLUMNAR = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('getObservationsFor returns [] after entity is deleted', async () => {
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['o1'] },
    ]);
    // Confirm column store has the entry.
    expect(await ctx.observationManager.getObservationsFor('alice')).toEqual(['o1']);

    await ctx.entityManager.deleteEntities(['alice']);

    // After delete: column store entry should be cleaned up via the
    // entity:deleted event subscription. No more ghost data.
    expect(await ctx.observationManager.getObservationsFor('alice')).toEqual([]);
    expect(await ctx.observationColumnStore!.has('alice')).toBe(false);
  });
});

describe('Review #3 + #12: bypass paths shadow-mirror via events', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
  });
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_OBSERVATIONS_COLUMNAR;
    else process.env.MEMORY_OBSERVATIONS_COLUMNAR = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('EntityManager.createEntities with non-empty observations populates the column store', async () => {
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    // Make sure the column store is wired by touching observationManager.
    void ctx.observationManager;
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['inline-1', 'inline-2'] },
    ]);
    // Listeners fire sync but work async — poll rather than sleep a fixed 50ms.
    expect(
      await waitUntil(
        async () => {
          // JsonlColumnStore caches and never auto-reloads (see Review #4
          // tests) — a poll that only calls get() caches an empty map on its
          // first pass and then never sees the write. Reload each pass.
          await ctx.observationColumnStore!.reload();
          return ctx.observationColumnStore!.get('alice');
        },
        (v) => JSON.stringify(v) === JSON.stringify(['inline-1', 'inline-2']),
        "column store to mirror alice's created observations",
      ),
    ).toEqual(['inline-1', 'inline-2']);
  });

  it('EntityManager.updateEntity with `observations` patch updates the column store', async () => {
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    void ctx.observationManager;
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['original'] },
    ]);
    await waitUntil(
      async () => {
        await ctx.observationColumnStore!.reload();
        return ctx.observationColumnStore!.get('alice');
      },
      (v) => JSON.stringify(v) === JSON.stringify(['original']),
      'column store to mirror the initial observations',
    );
    // Update observations through the entity update path (not
    // ObservationManager.addObservations).
    await ctx.entityManager.updateEntity('alice', { observations: ['updated'] });
    expect(
      await waitUntil(
        async () => {
          // JsonlColumnStore caches and never auto-reloads (see Review #4
          // tests) — a poll that only calls get() caches an empty map on its
          // first pass and then never sees the write. Reload each pass.
          await ctx.observationColumnStore!.reload();
          return ctx.observationColumnStore!.get('alice');
        },
        (v) => JSON.stringify(v) === JSON.stringify(['updated']),
        'column store to mirror the updated observations',
      ),
    ).toEqual(['updated']);
  });

  it('updateEntity without `observations` in the patch does NOT touch the column store', async () => {
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    void ctx.observationManager;
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['only-via-create'] },
    ]);
    await waitUntil(
      async () => {
        await ctx.observationColumnStore!.reload();
        return ctx.observationColumnStore!.get('alice');
      },
      (v) => JSON.stringify(v) === JSON.stringify(['only-via-create']),
      'column store to mirror the created observations',
    );
    await ctx.entityManager.updateEntity('alice', { entityType: 'agent' });
    // NEGATIVE assertion — we must prove the value does NOT change, so a short
    // settle is legitimate here (there is no event to wait for).
    await new Promise((r) => setTimeout(r, 50));
    // Column store still has the original observations.
    expect(await ctx.observationColumnStore!.get('alice')).toEqual(['only-via-create']);
  });
});

describe('Review #14: sidecar path uses hyphen-delimited convention', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
  });
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_OBSERVATIONS_COLUMNAR;
    else process.env.MEMORY_OBSERVATIONS_COLUMNAR = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('sidecar lives at `<basename>-observations.jsonl` (matches `-saved-searches.jsonl` style)', async () => {
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    void ctx.observationManager;
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['hello'] },
    ]);
    // Poll for the sidecar instead of a fixed 50ms sleep — this is the exact
    // assertion that intermittently failed with ENOENT under load.
    await waitForFile(join(dir, 'memory-observations.jsonl'));

    // The hyphen-delimited path exists.
    await expect(fs.access(join(dir, 'memory-observations.jsonl'))).resolves.toBeUndefined();
    // The dot-delimited (rejected) variant does NOT exist.
    await expect(fs.access(join(dir, 'memory.observations.jsonl'))).rejects.toThrow();
  });
});
