/**
 * Compression Adapter — Interface + Zlib Reference Impl
 *
 * Phase 10 task 75 (§3.4) — first task in the in-memory compression
 * breakdown. Defines a synchronous compress/decompress contract any
 * compression library can implement, and ships a zlib-backed
 * reference that uses Node's built-in `zlib.deflateSync` /
 * `zlib.inflateSync` (no external deps).
 *
 * **Why a synchronous contract?** The intended caller is
 * `CompressedMap` (task 76) — a Map-like data structure where cold
 * entries live in compressed form and are decompressed on `get`.
 * Async decompression would force every `get` to return a Promise,
 * which would ripple through the entire codebase. Synchronous
 * `Buffer`-in / `Buffer`-out keeps the data structure ergonomic.
 *
 * **No external deps.** `ZlibCompressionAdapter` uses Node's built-in
 * `zlib`. Faster alternatives (lz4 for ~3× compress speed, brotli
 * for better ratio) land as separate adapters in task 78.
 *
 * @module utils/compression/ICompressionAdapter
 * @experimental Adapter selection (zlib / brotli / lz4) is a user-
 *   facing decision flagged for the Phase 10 task 77 benchmark.
 *   The interface itself is stable.
 */

import { deflateSync, inflateSync } from 'zlib';

/**
 * Synchronous compress / decompress pair. Implementations are
 * expected to round-trip every byte sequence: `decompress(compress(x))
 * === x` for any input `x`. Throwing on malformed input is correct
 * behavior — callers handle it as data corruption.
 */
export interface ICompressionAdapter {
  /** Stable name for diagnostics. */
  readonly name: string;

  /**
   * Compress `input` into a (typically smaller) buffer. Implementations
   * are free to return a buffer longer than the input when the input
   * is incompressible — there's no contract guaranteeing size
   * reduction. Callers that care about the bound should compare
   * lengths before deciding to store the compressed form.
   */
  compress(input: Buffer): Buffer;

  /**
   * Decompress a buffer previously produced by this adapter (or by
   * a wire-compatible adapter). Throwing on corrupted / truncated /
   * wrong-format input is correct — callers should treat the
   * exception as data corruption signal.
   */
  decompress(input: Buffer): Buffer;
}

/**
 * Zlib-backed reference implementation. Uses Node's built-in
 * `deflateSync` / `inflateSync` (raw deflate, not gzip framing) for
 * minimal overhead. The deflate format is wire-compatible with
 * `pako` / `zlib` libraries in other languages, so a compressed
 * blob produced here can be decompressed by any zlib-capable
 * consumer.
 *
 * **Quality knob:** `level` (0-9, default 6) trades compression
 * ratio for speed. Level 0 is fastest (almost no compression);
 * level 9 is smallest but ~3× slower than level 6. Default
 * matches zlib's default and is well-tuned for general-purpose
 * payloads.
 *
 * @example
 * ```typescript
 * const adapter = new ZlibCompressionAdapter();
 * const compressed = adapter.compress(Buffer.from('hello world'));
 * const back = adapter.decompress(compressed);
 * console.log(back.toString()); // 'hello world'
 * ```
 */
export class ZlibCompressionAdapter implements ICompressionAdapter {
  readonly name = 'zlib';

  constructor(private readonly level: number = 6) {
    if (!Number.isInteger(level) || level < 0 || level > 9) {
      throw new Error(
        `ZlibCompressionAdapter: level must be an integer in [0, 9], got ${level}`,
      );
    }
  }

  compress(input: Buffer): Buffer {
    try {
      return deflateSync(input, { level: this.level });
    } catch (err) {
      throw new Error(
        `ZlibCompressionAdapter: compress failed (input may exceed Buffer.constants.MAX_LENGTH): ${(err as Error).message}`,
      );
    }
  }

  decompress(input: Buffer): Buffer {
    // Wrap the underlying zlib error (review #5) so callers can tell
    // which adapter rejected. A buffer compressed by `BrotliCompressionAdapter`
    // throws here with the wrapper identifying the adapter — letting
    // multi-adapter callers distinguish "wrong adapter" from "truncated input."
    try {
      return inflateSync(input);
    } catch (err) {
      throw new Error(
        `ZlibCompressionAdapter: decompress failed — input is likely corrupted, truncated, or produced by a different adapter: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Identity adapter — round-trips the buffer unchanged. Useful for
 * tests that want to exercise the data-structure layer without the
 * cost / complexity of real compression, and as a known-good
 * baseline for the Phase 10 task 77 benchmark.
 */
export class IdentityCompressionAdapter implements ICompressionAdapter {
  readonly name = 'identity';

  compress(input: Buffer): Buffer {
    return Buffer.from(input);
  }

  decompress(input: Buffer): Buffer {
    return Buffer.from(input);
  }
}
