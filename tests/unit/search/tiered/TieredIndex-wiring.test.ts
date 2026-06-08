/**
 * Tiered index wiring + diagnostics tests
 *
 * Covers Phase 9 tasks 73 + 74: `ctx.tieredPostingsIndex` env-gated
 * lazy getter + `ctx.diagnostics()` tier-stats roll-up.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `tiered-wiring-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const savedEnv = process.env.MEMORY_TIERED_INDEX;

describe('ctx.tieredPostingsIndex env-gated activation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_TIERED_INDEX;
    else process.env.MEMORY_TIERED_INDEX = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('unset → null (no tiered index)', () => {
    delete process.env.MEMORY_TIERED_INDEX;
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.tieredPostingsIndex).toBeNull();
  });

  it("='false' → null", () => {
    process.env.MEMORY_TIERED_INDEX = 'false';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.tieredPostingsIndex).toBeNull();
  });

  it("='yes' → null (strict 'true' literal-match)", () => {
    process.env.MEMORY_TIERED_INDEX = 'yes';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.tieredPostingsIndex).toBeNull();
  });

  it("='1' → null (strict 'true' literal-match)", () => {
    process.env.MEMORY_TIERED_INDEX = '1';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.tieredPostingsIndex).toBeNull();
  });

  it("='true' → composer instance", () => {
    process.env.MEMORY_TIERED_INDEX = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    expect(ctx.tieredPostingsIndex).not.toBeNull();
    const stats = ctx.tieredPostingsIndex!.stats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.perTierHits).toMatchObject({ hot: 0, warm: 0, cold: 0 });
  });

  it('cached after first access (lazy + sticky)', () => {
    process.env.MEMORY_TIERED_INDEX = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const first = ctx.tieredPostingsIndex;
    // Flip env mid-process — value should NOT change (matches
    // observationColumnStore precedent).
    process.env.MEMORY_TIERED_INDEX = 'false';
    const second = ctx.tieredPostingsIndex;
    expect(second).toBe(first);
  });

  it('round-trips a value through the composer', async () => {
    process.env.MEMORY_TIERED_INDEX = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const tiered = ctx.tieredPostingsIndex!;
    await tiered.put('term', [1, 2, 3]);
    expect(await tiered.get('term')).toEqual([1, 2, 3]);
    expect(tiered.stats().hits).toBe(1);
    expect(tiered.stats().misses).toBe(0);
  });
});

describe('ctx.diagnostics() tier-stats roll-up (task 74)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDir();
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_TIERED_INDEX;
    else process.env.MEMORY_TIERED_INDEX = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('omits tieredIndexStats when no tiered index is active', () => {
    delete process.env.MEMORY_TIERED_INDEX;
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const report = ctx.diagnostics();
    expect(report.tieredIndexStats).toBeUndefined();
  });

  it('omits tieredIndexStats when env is set but composer never touched', () => {
    process.env.MEMORY_TIERED_INDEX = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    // Don't touch ctx.tieredPostingsIndex — composer stays undefined.
    const report = ctx.diagnostics();
    expect(report.tieredIndexStats).toBeUndefined();
  });

  it('includes tieredIndexStats once the composer has been initialized', async () => {
    process.env.MEMORY_TIERED_INDEX = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const tiered = ctx.tieredPostingsIndex!;
    await tiered.put('a', [1]);
    await tiered.get('a');  // 1 hit
    await tiered.get('ghost');  // 1 miss

    const report = ctx.diagnostics();
    expect(report.tieredIndexStats).toBeDefined();
    expect(report.tieredIndexStats!.hits).toBe(1);
    expect(report.tieredIndexStats!.misses).toBe(1);
    expect(report.tieredIndexStats!.hitRate).toBe(0.5);
  });

  it('hitRate is 0 when there has been no traffic', async () => {
    process.env.MEMORY_TIERED_INDEX = 'true';
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    void ctx.tieredPostingsIndex; // initialize
    const report = ctx.diagnostics();
    expect(report.tieredIndexStats!.hitRate).toBe(0);
  });
});
