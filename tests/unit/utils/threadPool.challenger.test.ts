/**
 * Challenger findings for Sprint 8 (`src/utils/threadPool.ts`), recorded by a
 * differential run of the real `@danielsimonjr/workerpool` 10.2.0 in a scratch
 * directory against the in-repo pool.
 *
 * These tests pin behaviour where the two implementations differ. They FAIL on
 * the current implementation on purpose, so the diff cannot be merged silently:
 * either the pool matches the recorded 10.2.0 behaviour, or the deviation is
 * written into the Sprint 8 "as built" paragraph as an accepted one.
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
  // succeeds. The in-repo pool reads `?? Infinity`, so 0 is a real cap of zero
  // and every exec throws "Max queue size of 0 reached".
  it('treats maxQueueSize 0 as 10.2.0 does: falsy, so the queue is unbounded', async () => {
    const p = pool({ maxWorkers: 1, maxQueueSize: 0 });
    pools.push(p);
    // On 10.2.0 this resolves; on the in-repo pool this throws
    // "Max queue size of 0 reached".
    const value = await p.exec((a: number, b: number) => a + b, [1, 2]);
    expect(value).toBe(3);
  });
});
