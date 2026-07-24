/**
 * RankedSearch Benchmarks
 *
 * Performance benchmarks for the index-less TF-IDF path
 * (`RankedSearch.searchWithoutIndex`) — the default path used by
 * `ctx.rankedSearch` and the lexical channel of `HybridSearchManager`
 * (no `storageDir` is passed, so no pre-built index exists).
 *
 * Guards the S1 optimization (per-query IDF hoisting): scoring must stay
 * O(N * terms), not O(N^2 * terms). The comparative assertion checks that
 * doubling the corpus does not triple the search time — a quadratic
 * regression would cost ~4x.
 *
 * Gated on `SKIP_BENCHMARKS=true` — keeps `npm test` fast. Thresholds are
 * deliberately generous (see the CLAUDE.md "performance benchmark
 * flakiness" gotcha for Windows/Dropbox timing variance).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { performance } from 'node:perf_hooks';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { RankedSearch } from '../../src/search/RankedSearch.js';
import type { Entity } from '../../src/types/index.js';

const BENCH_CONFIG = {
  /** Base synthetic corpus size. */
  BASE_CORPUS: 2000,
  /** Generous absolute bound for one warm search over BASE_CORPUS docs. */
  MAX_SEARCH_MS: 10_000,
  /**
   * Linearity bound: search over 2x corpus must cost < RATIO x the base
   * time. Linear scaling costs ~2x; a quadratic regression costs ~4x.
   * The Math.max floor absorbs sub-millisecond timer noise.
   */
  LINEARITY_RATIO: 3,
  /**
   * Timer-noise floor for the base measurement: at ~10 ms scales, single-run
   * jitter (GC, scheduler) can distort the ratio. The floor keeps the canary
   * meaningful — the pre-S1 quadratic code measured ~600 ms base / ~3300 ms
   * doubled, far above 3 x max(base, floor).
   */
  LINEARITY_FLOOR_MS: 10,
  /** Warm timed iterations; the minimum is reported (least-noise sample). */
  TIMED_ITERATIONS: 7,
};

/** Multi-term query mixing a corpus-wide term with rotating topic terms. */
const QUERY = 'magnesium alpha delta systems shared note';

const TOPICS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];

function makeCorpus(size: number): Entity[] {
  return Array.from({ length: size }, (_, i) => ({
    name: `Entity_${i}`,
    entityType: i % 2 === 0 ? 'person' : 'project',
    observations: [
      `observation ${i} about ${TOPICS[i % TOPICS.length]} systems and pipelines`,
      `secondary note ${i} covering ${TOPICS[(i + 3) % TOPICS.length]} with shared keyword magnesium`,
      `tertiary detail ${i} referencing ${TOPICS[(i + 5) % TOPICS.length]} tooling`,
    ],
  }));
}

/**
 * Time warm searches: one untimed run populates the fallback token cache,
 * then the minimum of TIMED_ITERATIONS runs is returned so the measurement
 * reflects scoring cost, not tokenization or GC noise.
 */
async function timeWarmSearch(search: RankedSearch, query: string): Promise<number> {
  await search.searchNodesRanked(query); // warm-up (populates token cache)
  let best = Infinity;
  for (let i = 0; i < BENCH_CONFIG.TIMED_ITERATIONS; i++) {
    const start = performance.now();
    await search.searchNodesRanked(query);
    const elapsed = performance.now() - start;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

async function setupCorpus(
  dir: string,
  size: number
): Promise<{ storage: GraphStorage; search: RankedSearch }> {
  const storage = new GraphStorage(join(dir, `graph-${size}.jsonl`));
  await storage.saveGraph({ entities: makeCorpus(size), relations: [] });
  // No storageDir -> no TF-IDF index -> searchWithoutIndex path (the
  // default configuration in ManagerContext / SearchManager).
  return { storage, search: new RankedSearch(storage) };
}

describe.skipIf(process.env.SKIP_BENCHMARKS === 'true')('RankedSearch benchmarks (searchWithoutIndex)', () => {
  const testDir = join(tmpdir(), `ranked-search-bench-${Date.now()}-${Math.random()}`);

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('completes a warm multi-term search over ~2k entities within a generous bound', async () => {
    await fs.mkdir(testDir, { recursive: true });
    const { search } = await setupCorpus(testDir, BENCH_CONFIG.BASE_CORPUS);

    const elapsed = await timeWarmSearch(search, QUERY);
    // eslint-disable-next-line no-console
    console.log(
      `[ranked-search-bench] warm search over ${BENCH_CONFIG.BASE_CORPUS} entities: ${elapsed.toFixed(2)} ms`
    );

    const results = await search.searchNodesRanked(QUERY);
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(BENCH_CONFIG.MAX_SEARCH_MS);
  });

  it('scales linearly-ish: 2x corpus does not cost >= 3x time (O(N^2) canary)', async () => {
    await fs.mkdir(testDir, { recursive: true });
    const base = await setupCorpus(testDir, BENCH_CONFIG.BASE_CORPUS);
    const doubled = await setupCorpus(testDir, BENCH_CONFIG.BASE_CORPUS * 2);

    const baseMs = await timeWarmSearch(base.search, QUERY);
    const doubledMs = await timeWarmSearch(doubled.search, QUERY);

    // eslint-disable-next-line no-console
    console.log(
      `[ranked-search-bench] ${BENCH_CONFIG.BASE_CORPUS} entities: ${baseMs.toFixed(2)} ms | ` +
        `${BENCH_CONFIG.BASE_CORPUS * 2} entities: ${doubledMs.toFixed(2)} ms | ` +
        `ratio: ${(doubledMs / Math.max(baseMs, 0.001)).toFixed(2)}x`
    );

    expect(doubledMs).toBeLessThan(
      BENCH_CONFIG.LINEARITY_RATIO * Math.max(baseMs, BENCH_CONFIG.LINEARITY_FLOOR_MS)
    );
  }, 120_000);
});
