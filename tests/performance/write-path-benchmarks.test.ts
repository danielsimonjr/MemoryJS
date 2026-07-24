/**
 * Write-Path Benchmarks (S2 delta persistence)
 *
 * Measures the keystone write-path optimization: manager mutations now
 * persist as delta operations (append / targeted row ops) instead of
 * full-graph rewrites.
 *
 * Two guards per backend:
 * (a) N sequential single-entity `createEntities` calls complete under a
 *     generous absolute bound (before S2 this was O(N²): every call
 *     rewrote the whole file / reinserted every row).
 * (b) Comparative guard: one-by-one creation must cost less than
 *     20 × the one-batch cost plus a constant slack. The slack term
 *     covers the unavoidable per-call durability floor (JSONL fsyncs
 *     once per call; SQLite commits once per call) which exists in any
 *     O(changed) implementation; without the S2 fix the one-by-one path
 *     serializes Θ(N²) entity lines and blows far past the bound.
 *
 * Gated by SKIP_BENCHMARKS=true (same convention as the other perf
 * suites). Thresholds are deliberately generous to avoid flakiness on
 * slow/contended machines while still catching an O(N²) regression.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../src/core/SQLiteStorage.js';
import { EntityManager } from '../../src/core/EntityManager.js';
import type { Entity } from '../../src/types/index.js';

const N = 2000;
/** Generous absolute wall-clock bound for N sequential single creates. */
const SEQUENTIAL_BOUND_MS = 120_000;
/** Comparative guard: sequential < RATIO × batch + SLACK. */
const RATIO = 20;
const SLACK_MS = 10_000;
const TEST_TIMEOUT_MS = 300_000;

function entityBatch(count: number, prefix: string): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      name: `${prefix}-${i}`,
      entityType: 'benchmark',
      observations: [`observation for ${prefix}-${i}`, 'second observation line'],
    } as Entity);
  }
  return out;
}

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `write-path-bench-${Date.now()}-${Math.random()}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors (Windows WAL locks)
  }
});

interface BenchResult {
  sequentialMs: number;
  batchMs: number;
}

async function runBench(
  makeStorage: (suffix: string) => GraphStorage,
  close: (s: GraphStorage) => void,
): Promise<BenchResult> {
  // Batch: minimal number of createEntities calls (the validation schema
  // caps a single batch at 1000 entities, so N=2000 takes two calls)
  const batchStorage = makeStorage('batch');
  let batchMs: number;
  try {
    const manager = new EntityManager(batchStorage);
    const entities = entityBatch(N, 'batch');
    const t0 = performance.now();
    let createdCount = 0;
    for (let i = 0; i < entities.length; i += 1000) {
      const created = await manager.createEntities(entities.slice(i, i + 1000));
      createdCount += created.length;
    }
    batchMs = performance.now() - t0;
    expect(createdCount).toBe(N);
  } finally {
    close(batchStorage);
  }

  // Sequential: N createEntities calls with one entity each
  const seqStorage = makeStorage('seq');
  let sequentialMs: number;
  try {
    const manager = new EntityManager(seqStorage);
    const entities = entityBatch(N, 'seq');
    const t0 = performance.now();
    for (const entity of entities) {
      await manager.createEntities([entity]);
    }
    sequentialMs = performance.now() - t0;
    const graph = await seqStorage.loadGraph();
    expect(graph.entities).toHaveLength(N);
  } finally {
    close(seqStorage);
  }

  return { sequentialMs, batchMs };
}

function report(label: string, r: BenchResult): void {
  const opsPerSec = (N / (r.sequentialMs / 1000)).toFixed(0);
  // eslint-disable-next-line no-console
  console.log(
    `[write-path-bench] ${label}: sequential ${N}x1 = ${r.sequentialMs.toFixed(0)}ms ` +
      `(${opsPerSec} ops/sec), batch 1x${N} = ${r.batchMs.toFixed(0)}ms, ` +
      `ratio = ${(r.sequentialMs / r.batchMs).toFixed(1)}x`,
  );
}

describe.skipIf(process.env.SKIP_BENCHMARKS === 'true')('Write-path benchmarks (S2 delta persistence)', () => {
  it(
    `JSONL: ${N} sequential single-entity creates stay under the bound and within ${RATIO}x of one batch`,
    async () => {
      const r = await runBench(
        (suffix) => new GraphStorage(join(testDir, `bench-${suffix}.jsonl`)),
        () => {},
      );
      report('jsonl', r);

      expect(r.sequentialMs).toBeLessThan(SEQUENTIAL_BOUND_MS);
      expect(r.sequentialMs).toBeLessThan(RATIO * r.batchMs + SLACK_MS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `SQLite: ${N} sequential single-entity creates stay under the bound and within ${RATIO}x of one batch`,
    async () => {
      const r = await runBench(
        (suffix) =>
          new SQLiteStorage(join(testDir, `bench-${suffix}.db`)) as unknown as GraphStorage,
        (s) => (s as unknown as SQLiteStorage).close(),
      );
      report('sqlite', r);

      expect(r.sequentialMs).toBeLessThan(SEQUENTIAL_BOUND_MS);
      expect(r.sequentialMs).toBeLessThan(RATIO * r.batchMs + SLACK_MS);
    },
    TEST_TIMEOUT_MS,
  );
});
