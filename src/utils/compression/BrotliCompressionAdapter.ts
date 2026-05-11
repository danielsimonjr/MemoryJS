/**
 * BrotliCompressionAdapter — Brotli-backed ICompressionAdapter
 *
 * Phase 10 task 78 (§3.4) — sibling to `ZlibCompressionAdapter` from
 * task 75. The task-77 benchmark decision gate (LZ4 vs zlib vs brotli)
 * was resolved in favor of shipping brotli immediately: it's already a
 * transitive dep through `src/utils/compressionUtil.ts` (which wraps
 * the same `zlib` built-in this adapter uses), so there's no new
 * approval surface. The LZ4 option stays open for any caller that
 * needs the speed — implementing it against `ICompressionAdapter` is
 * a separate task.
 *
 * **Why brotli?** Better compression ratio than deflate (typically
 * 15-20% smaller output on JSON / English text) at the cost of
 * higher CPU. The built-in text-mode dictionary helps further on
 * natural-language payloads. Defaults match the codebase convention
 * (`compressionUtil.ts` uses quality 6, generic mode).
 *
 * **No external deps.** Uses Node's built-in `zlib.brotliCompressSync`
 * / `zlib.brotliDecompressSync` directly — this keeps the adapter
 * self-contained and avoids a dependency edge into the async
 * `compressionUtil.ts` helpers (which would force the adapter to be
 * async, breaking the `ICompressionAdapter` contract).
 *
 * @module utils/compression/BrotliCompressionAdapter
 * @experimental Adapter selection (zlib / brotli / lz4) is a user-
 *   facing decision flagged for the Phase 10 task 77 benchmark.
 *   The wire format is stable (any brotli-capable consumer can
 *   decompress the output).
 */

import { brotliCompressSync, brotliDecompressSync, constants } from 'zlib';
import type { ICompressionAdapter } from './ICompressionAdapter.js';

/**
 * Construction options for `BrotliCompressionAdapter`.
 */
export interface BrotliCompressionAdapterOptions {
  /**
   * Brotli quality (0-11). Higher = smaller, slower. Default: 6
   * (the codebase's existing convention — see `compressionUtil.ts`).
   * Quality 11 is the smallest output but ~10× slower than 6;
   * quality 0 is the fastest but barely compresses.
   */
  quality?: number;

  /**
   * Mode hint. Brotli has built-in static dictionaries tuned per
   * mode:
   * - `'generic'` (default) — no dictionary preference, suitable for
   *   arbitrary binary payloads.
   * - `'text'` — uses brotli's built-in natural-language dictionary;
   *   useful when V is known to serialize as UTF-8 prose.
   * - `'font'` — tuned for WOFF / WOFF2 font payloads (rarely the
   *   right pick for `CompressedMap` callers, but included for
   *   completeness since brotli supports it).
   */
  mode?: 'generic' | 'text' | 'font';
}

/**
 * Map the public `mode` string onto brotli's numeric mode constant.
 * Kept as a small helper so the constructor body stays readable.
 */
function brotliModeConstant(mode: 'generic' | 'text' | 'font'): number {
  switch (mode) {
    case 'text':
      return constants.BROTLI_MODE_TEXT;
    case 'font':
      return constants.BROTLI_MODE_FONT;
    case 'generic':
    default:
      return constants.BROTLI_MODE_GENERIC;
  }
}

/**
 * Brotli-backed `ICompressionAdapter`. Uses Node's built-in
 * `brotliCompressSync` / `brotliDecompressSync` (no external deps).
 *
 * **Quality knob:** `quality` (0-11, default 6) trades ratio for
 * speed in the same shape as zlib's `level`, but with an extended
 * range (11 vs 9) reflecting brotli's larger search space.
 *
 * **Mode knob:** `mode` ('generic' | 'text' | 'font', default
 * 'generic') hints which built-in dictionary the encoder should
 * favor. The decoder doesn't need to know — wire output is
 * mode-agnostic — so cross-instance decompression works regardless
 * of which mode produced the buffer.
 *
 * @example
 * ```typescript
 * const adapter = new BrotliCompressionAdapter({ quality: 11, mode: 'text' });
 * const compressed = adapter.compress(Buffer.from('hello world'));
 * const back = adapter.decompress(compressed);
 * console.log(back.toString()); // 'hello world'
 * ```
 */
export class BrotliCompressionAdapter implements ICompressionAdapter {
  readonly name = 'brotli';

  private readonly quality: number;
  private readonly mode: number;

  constructor(options: BrotliCompressionAdapterOptions = {}) {
    const quality = options.quality ?? 6;
    if (!Number.isInteger(quality) || quality < 0 || quality > 11) {
      throw new Error(
        `BrotliCompressionAdapter: quality must be an integer in [0, 11], got ${quality}`,
      );
    }
    this.quality = quality;
    this.mode = brotliModeConstant(options.mode ?? 'generic');
  }

  compress(input: Buffer): Buffer {
    try {
      return brotliCompressSync(input, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: this.quality,
          [constants.BROTLI_PARAM_MODE]: this.mode,
        },
      });
    } catch (err) {
      throw new Error(
        `BrotliCompressionAdapter: compress failed (input may exceed Buffer.constants.MAX_LENGTH): ${(err as Error).message}`,
      );
    }
  }

  decompress(input: Buffer): Buffer {
    // Wrap the underlying brotli error (review #5) so callers can
    // tell which adapter rejected. A buffer compressed by
    // `ZlibCompressionAdapter` throws here with the wrapper
    // identifying the adapter.
    try {
      return brotliDecompressSync(input);
    } catch (err) {
      throw new Error(
        `BrotliCompressionAdapter: decompress failed — input is likely corrupted, truncated, or produced by a different adapter: ${(err as Error).message}`,
      );
    }
  }
}
