/**
 * Challenger findings for Sprint 8 (`src/utils/threadPool.ts`), recorded by a
 * differential run of the real `@danielsimonjr/workerpool` 10.2.0 in a scratch
 * directory against the in-repo pool.
 *
 * These tests pin challenger findings against `@danielsimonjr/workerpool`
 * 10.2.0. `maxQueueSize: 0` is falsy there (`options.maxQueueSize || Infinity`)
 * and is unbounded in the in-repo pool as well.
 *
 * @module tests/unit/utils/threadPool.challenger
 */

import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../../../src/utils/threadPool.js';

const pools: Array<{ terminate(force?: boolean): Promise<void> }> = [];

afterAll(async () => {
  await Promise.all(pools.map((p) => p.terminate(true)));
});

describe('threadPool challenger: maxQueueSize semantics', () => {
  // workerpool 10.2.0 reads `options.maxQueueSize || Infinity` (Pool.js line
  // 60), so a zero falls back to the unlimited default and the first exec
  // succeeds. The in-repo pool matches that with `|| Infinity`.
  it('treats maxQueueSize 0 as 10.2.0 does: falsy, so the queue is unbounded', async () => {
    const p = pool({ maxWorkers: 1, maxQueueSize: 0 });
    pools.push(p);
    const value = await p.exec((a: number, b: number) => a + b, [1, 2]);
    expect(value).toBe(3);
  });
});
