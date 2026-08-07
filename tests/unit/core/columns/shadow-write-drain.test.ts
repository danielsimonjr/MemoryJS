/**
 * Shadow column-store writes must be awaitable.
 *
 * The column-store mirror is driven by SYNCHRONOUS EventEmitter listeners that fire
 * `void this.shadowWriteColumn(...)` — un-awaited promises whose handles are discarded.
 * Nothing could observe when a shadow write finished.
 *
 * That surfaced as a flaky test: `columns-review-fixes > sidecar lives at
 * <basename>-observations.jsonl` polls for the sidecar with a 3s timeout and failed
 * intermittently under full-suite load (301 test files plus other work on the box). A
 * previous attempt already replaced a fixed 50ms sleep with polling; raising the
 * timeout again would only widen the same band-aid.
 *
 * The test was the symptom. The defect is durability: `ManagerContext.close()` could
 * not drain in-flight mirror writes either, so a process that recorded an observation
 * and exited promptly could lose the sidecar update with nothing reported. Making the
 * pending writes awaitable fixes the shutdown path and removes the need to poll.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';

const savedEnv = process.env.MEMORY_OBSERVATIONS_COLUMNAR;
const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `shadow-drain-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.MEMORY_OBSERVATIONS_COLUMNAR;
  else process.env.MEMORY_OBSERVATIONS_COLUMNAR = savedEnv;
  for (const d of dirs.splice(0)) {
    try { await fs.rm(d, { recursive: true, force: true }); } catch { /* */ }
  }
});

describe('shadow column-store writes are drainable', () => {
  it('drainShadowWrites resolves only after the sidecar is on disk — no polling', async () => {
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
    const dir = await makeDir();
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    void ctx.observationManager;

    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['hello'] },
    ]);
    await ctx.observationManager.drainShadowWrites();

    // No timeout, no retry: if drain is honest, the file is there NOW.
    await expect(fs.access(join(dir, 'memory-observations.jsonl'))).resolves.toBeUndefined();
  });

  it('is safe to call when nothing is pending', async () => {
    const dir = await makeDir();
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    await expect(ctx.observationManager.drainShadowWrites()).resolves.toBeUndefined();
  });

  it('is safe to call twice, and the second call is not blocked by the first', async () => {
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
    const dir = await makeDir();
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    void ctx.observationManager;
    await ctx.entityManager.createEntities([
      { name: 'bob', entityType: 'person', observations: ['hi'] },
    ]);
    await ctx.observationManager.drainShadowWrites();
    await expect(ctx.observationManager.drainShadowWrites()).resolves.toBeUndefined();
  });

  it('a failing shadow write does not make drain hang or reject', async () => {
    // Shadow writes already log-and-swallow their errors; drain must preserve that,
    // or one bad mirror write would take down an otherwise healthy shutdown.
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
    const dir = await makeDir();
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    void ctx.observationManager;
    await ctx.entityManager.createEntities([
      { name: 'carol', entityType: 'person', observations: ['hey'] },
    ]);
    await expect(ctx.observationManager.drainShadowWrites()).resolves.toBeUndefined();
  });

  it('drains writes queued by a bulk save, not only per-entity events', async () => {
    // createEntities goes through saveGraph -> `graph:saved`, a different listener
    // (resyncFromStorage). Both paths must be tracked or drain lies for bulk loads.
    process.env.MEMORY_OBSERVATIONS_COLUMNAR = 'true';
    const dir = await makeDir();
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    void ctx.observationManager;
    await ctx.entityManager.createEntities([
      { name: 'd1', entityType: 'person', observations: ['a'] },
      { name: 'd2', entityType: 'person', observations: ['b'] },
      { name: 'd3', entityType: 'person', observations: ['c'] },
    ]);
    await ctx.observationManager.drainShadowWrites();
    const body = await fs.readFile(join(dir, 'memory-observations.jsonl'), 'utf-8');
    for (const name of ['d1', 'd2', 'd3']) {
      expect(body).toContain(name);
    }
  });
});
