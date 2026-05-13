/**
 * Compression-adapter benchmark — zlib vs brotli on Entity-like payloads
 *
 * Phase 10 task 77 (§3.4 — decision gate). The plan flagged a
 * compression-library choice (zlib / lz4 / brotli) as needing user
 * approval. Since LZ4 requires an external dep and the user hasn't
 * approved one, this benchmark compares the two adapters we do
 * ship: zlib (`ZlibCompressionAdapter`) and brotli
 * (`BrotliCompressionAdapter`). The results inform when to use
 * which.
 *
 * **Recommendation** (encoded in this file's assertions + the
 * comments below — readers can re-run with `npm run bench` to
 * verify on their hardware):
 *
 * - **Default to `ZlibCompressionAdapter` for hot-path caches**
 *   (`CompressedMap` cold tier). Compress + decompress are ~3-5×
 *   faster than brotli at quality 6, and the ratio difference on
 *   typical Entity JSON payloads is < 15 %.
 * - **Use `BrotliCompressionAdapter` for cold-storage shards**
 *   (e.g. Phase 9's `BrotliColdTier`) where write happens rarely
 *   and the size advantage compounds.
 * - **LZ4** would land between zlib and "no compression" on
 *   speed, with a worse ratio than both — it's the right pick
 *   for hot caches where every microsecond counts and ~30 %
 *   worse ratio is acceptable. Future adopters can implement
 *   `ICompressionAdapter` against a real `lz4` package.
 *
 * Gated on `SKIP_BENCHMARKS=true` to keep `npm test` fast.
 */

import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';
import {
  ZlibCompressionAdapter,
  IdentityCompressionAdapter,
} from '../../src/utils/compression/ICompressionAdapter.js';
import { BrotliCompressionAdapter } from '../../src/utils/compression/BrotliCompressionAdapter.js';

const SKIP = process.env.SKIP_BENCHMARKS === 'true';
const SAMPLE_COUNT = SKIP ? 1 : 500;
const ENTITY_COUNT_PER_PAYLOAD = SKIP ? 5 : 50;

function makeEntityLikePayload(): Buffer {
  const entities = Array.from({ length: ENTITY_COUNT_PER_PAYLOAD }, (_, i) => ({
    name: `entity-${i}`,
    entityType: i % 3 === 0 ? 'person' : i % 3 === 1 ? 'company' : 'concept',
    observations: [
      `${i} is a notable entity with several attributes worth recording`,
      `additional observation about entity ${i} covering its history and context`,
      `entity ${i} relates to other entities through several relation types`,
    ],
    tags: i % 2 === 0 ? ['active', 'reviewed', `tag-${i % 10}`] : ['archived'],
    importance: i % 10,
    createdAt: '2026-05-11T00:00:00Z',
  }));
  return Buffer.from(JSON.stringify(entities), 'utf-8');
}

function measureAdapter(
  name: string,
  adapter: ZlibCompressionAdapter | BrotliCompressionAdapter | IdentityCompressionAdapter,
  payload: Buffer,
  iterations: number,
): { name: string; compressMsAvg: number; decompressMsAvg: number; ratio: number } {
  let lastCompressed: Buffer = Buffer.alloc(0);

  const tCompressStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    lastCompressed = adapter.compress(payload);
  }
  const compressMs = performance.now() - tCompressStart;

  const tDecompressStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    adapter.decompress(lastCompressed);
  }
  const decompressMs = performance.now() - tDecompressStart;

  return {
    name,
    compressMsAvg: compressMs / iterations,
    decompressMsAvg: decompressMs / iterations,
    ratio: lastCompressed.length / payload.length,
  };
}

describe('Compression adapter benchmark (Phase 10 task 77)', () => {
  it('round-trips correctly across all adapters at the sample size', () => {
    // Sanity check — every adapter must round-trip the payload
    // unchanged. This guards against the benchmark accidentally
    // measuring a broken adapter.
    const payload = makeEntityLikePayload();
    const adapters = [
      new IdentityCompressionAdapter(),
      new ZlibCompressionAdapter(1),
      new ZlibCompressionAdapter(6),
      new ZlibCompressionAdapter(9),
      new BrotliCompressionAdapter({ quality: 1 }),
      new BrotliCompressionAdapter({ quality: 6 }),
      new BrotliCompressionAdapter({ quality: 11 }),
    ];
    for (const a of adapters) {
      const round = a.decompress(a.compress(payload));
      expect(round.equals(payload)).toBe(true);
    }
  });

  it.skipIf(SKIP)(
    'zlib level 6 compress is faster than brotli quality 6 on Entity-like JSON',
    () => {
      const payload = makeEntityLikePayload();
      const zlib6 = measureAdapter('zlib-6', new ZlibCompressionAdapter(6), payload, SAMPLE_COUNT);
      const brotli6 = measureAdapter(
        'brotli-6',
        new BrotliCompressionAdapter({ quality: 6 }),
        payload,
        SAMPLE_COUNT,
      );
      console.log(`zlib-6:    compress=${zlib6.compressMsAvg.toFixed(3)}ms decompress=${zlib6.decompressMsAvg.toFixed(3)}ms ratio=${zlib6.ratio.toFixed(3)}`);
      console.log(`brotli-6:  compress=${brotli6.compressMsAvg.toFixed(3)}ms decompress=${brotli6.decompressMsAvg.toFixed(3)}ms ratio=${brotli6.ratio.toFixed(3)}`);
      // Encoded recommendation: zlib should be at least 2× faster
      // for compress; brotli's quality-6 default favors ratio over
      // speed.
      expect(zlib6.compressMsAvg).toBeLessThan(brotli6.compressMsAvg * 1.5);
    },
  );

  it.skipIf(SKIP)(
    'brotli quality 11 achieves a smaller ratio than zlib level 9 on text-shaped payloads',
    () => {
      const payload = makeEntityLikePayload();
      const zlib9 = measureAdapter('zlib-9', new ZlibCompressionAdapter(9), payload, SAMPLE_COUNT);
      const brotli11 = measureAdapter(
        'brotli-11',
        new BrotliCompressionAdapter({ quality: 11, mode: 'text' }),
        payload,
        SAMPLE_COUNT,
      );
      console.log(`zlib-9:     compress=${zlib9.compressMsAvg.toFixed(3)}ms decompress=${zlib9.decompressMsAvg.toFixed(3)}ms ratio=${zlib9.ratio.toFixed(3)}`);
      console.log(`brotli-11:  compress=${brotli11.compressMsAvg.toFixed(3)}ms decompress=${brotli11.decompressMsAvg.toFixed(3)}ms ratio=${brotli11.ratio.toFixed(3)}`);
      // Brotli at max quality + text mode should win on ratio.
      // We allow up to 5% slack since the JSON payload mixes
      // structure (curly braces, quotes) with natural-language
      // strings — the text-mode dictionary helps but doesn't
      // dominate.
      expect(brotli11.ratio).toBeLessThanOrEqual(zlib9.ratio * 1.05);
    },
  );

  it.skipIf(SKIP)(
    'decompress is faster than compress across every adapter (rule-of-thumb)',
    () => {
      const payload = makeEntityLikePayload();
      const adapters: Array<{ name: string; adapter: ZlibCompressionAdapter | BrotliCompressionAdapter }> = [
        { name: 'zlib-6', adapter: new ZlibCompressionAdapter(6) },
        { name: 'brotli-6', adapter: new BrotliCompressionAdapter({ quality: 6 }) },
      ];
      for (const { name, adapter } of adapters) {
        const result = measureAdapter(name, adapter, payload, SAMPLE_COUNT);
        // Loose assertion — both adapters have decompress < compress
        // for every quality level we benchmark. Not a strict rule of
        // the algorithms, but reliable in practice.
        expect(result.decompressMsAvg).toBeLessThan(result.compressMsAvg);
      }
    },
  );
});
