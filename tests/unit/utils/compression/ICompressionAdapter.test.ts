/**
 * ICompressionAdapter + reference impl tests
 *
 * Covers Phase 10 task 75: interface contract + ZlibCompressionAdapter
 * + IdentityCompressionAdapter.
 */

import { describe, it, expect } from 'vitest';
import {
  ZlibCompressionAdapter,
  IdentityCompressionAdapter,
} from '../../../../src/utils/compression/ICompressionAdapter.js';

describe('ZlibCompressionAdapter', () => {
  it('round-trips arbitrary bytes', () => {
    const adapter = new ZlibCompressionAdapter();
    const input = Buffer.from('hello world this is some sample text');
    const compressed = adapter.compress(input);
    const back = adapter.decompress(compressed);
    expect(back.equals(input)).toBe(true);
  });

  it('round-trips an empty buffer', () => {
    const adapter = new ZlibCompressionAdapter();
    const input = Buffer.alloc(0);
    const back = adapter.decompress(adapter.compress(input));
    expect(back.length).toBe(0);
  });

  it('round-trips a buffer with non-ASCII / binary bytes', () => {
    const adapter = new ZlibCompressionAdapter();
    const input = Buffer.from([0, 1, 2, 255, 254, 253, 128, 64]);
    const back = adapter.decompress(adapter.compress(input));
    expect(back.equals(input)).toBe(true);
  });

  it('compresses a highly-redundant payload smaller than the input', () => {
    const adapter = new ZlibCompressionAdapter();
    const input = Buffer.from('a'.repeat(10000));
    const compressed = adapter.compress(input);
    // Redundant input should compress to a small fraction of original.
    expect(compressed.length).toBeLessThan(input.length / 10);
  });

  it('exposes a stable name', () => {
    expect(new ZlibCompressionAdapter().name).toBe('zlib');
  });

  it('throws on invalid level at construction', () => {
    expect(() => new ZlibCompressionAdapter(-1)).toThrow();
    expect(() => new ZlibCompressionAdapter(10)).toThrow();
    expect(() => new ZlibCompressionAdapter(3.5)).toThrow();
  });

  it('higher level (9) achieves ratio at least as good as level 1 on redundant input', () => {
    const fast = new ZlibCompressionAdapter(1);
    const slow = new ZlibCompressionAdapter(9);
    const input = Buffer.from('the quick brown fox '.repeat(500));
    expect(slow.compress(input).length).toBeLessThanOrEqual(fast.compress(input).length);
  });

  it('throws on malformed input to decompress', () => {
    const adapter = new ZlibCompressionAdapter();
    expect(() => adapter.decompress(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toThrow();
  });

  it('decompresses output produced by a separately-constructed instance', () => {
    const a = new ZlibCompressionAdapter();
    const b = new ZlibCompressionAdapter();
    const input = Buffer.from('cross-instance round-trip');
    const back = b.decompress(a.compress(input));
    expect(back.equals(input)).toBe(true);
  });

  describe('decompression output cap (Sec8)', () => {
    it('throws a clear error naming the limit when output exceeds an injected cap', () => {
      const writer = new ZlibCompressionAdapter();
      const bomb = writer.compress(Buffer.from('a'.repeat(1024 * 1024)));
      expect(bomb.length).toBeLessThan(10_000); // sanity: highly compressible

      const capped = new ZlibCompressionAdapter(6, 1024);
      expect(() => capped.decompress(bomb)).toThrow(/maximum allowed size of 1024 bytes/);
    });

    it('normal roundtrips are unaffected by a cap that is not exceeded', () => {
      const adapter = new ZlibCompressionAdapter(6, 2 * 1024 * 1024);
      const input = Buffer.from('a'.repeat(1024 * 1024));
      const back = adapter.decompress(adapter.compress(input));
      expect(back.equals(input)).toBe(true);
    });

    it('rejects an invalid maxOutputLength at construction', () => {
      expect(() => new ZlibCompressionAdapter(6, 0)).toThrow(/maxOutputLength/);
      expect(() => new ZlibCompressionAdapter(6, -5)).toThrow(/maxOutputLength/);
      expect(() => new ZlibCompressionAdapter(6, 1.5)).toThrow(/maxOutputLength/);
    });

    it('honors the MEMORY_MAX_DECOMPRESSED_BYTES env var (read at construction)', () => {
      const previous = process.env.MEMORY_MAX_DECOMPRESSED_BYTES;
      process.env.MEMORY_MAX_DECOMPRESSED_BYTES = '2048';
      try {
        const writer = new ZlibCompressionAdapter();
        const bomb = writer.compress(Buffer.from('b'.repeat(1024 * 1024)));
        const envCapped = new ZlibCompressionAdapter();
        expect(() => envCapped.decompress(bomb)).toThrow(/maximum allowed size of 2048 bytes/);
      } finally {
        if (previous === undefined) delete process.env.MEMORY_MAX_DECOMPRESSED_BYTES;
        else process.env.MEMORY_MAX_DECOMPRESSED_BYTES = previous;
      }
    });

    it('corrupt input still reports the corruption error, not the cap error', () => {
      const capped = new ZlibCompressionAdapter(6, 1024);
      expect(() => capped.decompress(Buffer.from([0xff, 0xff, 0xff, 0xff])))
        .toThrow(/corrupted, truncated, or produced by a different adapter/);
    });
  });
});

describe('IdentityCompressionAdapter', () => {
  it('returns the input bytes unchanged', () => {
    const adapter = new IdentityCompressionAdapter();
    const input = Buffer.from('verbatim');
    expect(adapter.compress(input).equals(input)).toBe(true);
    expect(adapter.decompress(input).equals(input)).toBe(true);
  });

  it('returns defensive copies (mutations to the result do not affect input)', () => {
    const adapter = new IdentityCompressionAdapter();
    const input = Buffer.from('abc');
    const out = adapter.compress(input);
    out[0] = 0xff;
    expect(input[0]).toBe(0x61); // 'a' unchanged
  });

  it('exposes a stable name', () => {
    expect(new IdentityCompressionAdapter().name).toBe('identity');
  });
});
