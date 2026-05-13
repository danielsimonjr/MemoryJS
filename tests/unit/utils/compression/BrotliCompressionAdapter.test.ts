/**
 * BrotliCompressionAdapter tests
 *
 * Covers Phase 10 task 78: brotli-backed `ICompressionAdapter` impl.
 * Mirrors the test shape of `ICompressionAdapter.test.ts` (the
 * zlib-adapter coverage from task 75) plus mode/quality knobs unique
 * to brotli.
 */

import { describe, it, expect } from 'vitest';
import { BrotliCompressionAdapter } from '../../../../src/utils/compression/BrotliCompressionAdapter.js';

describe('BrotliCompressionAdapter', () => {
  it('round-trips arbitrary bytes', () => {
    const adapter = new BrotliCompressionAdapter();
    const input = Buffer.from('hello world this is some sample text');
    const compressed = adapter.compress(input);
    const back = adapter.decompress(compressed);
    expect(back.equals(input)).toBe(true);
  });

  it('round-trips an empty buffer', () => {
    const adapter = new BrotliCompressionAdapter();
    const input = Buffer.alloc(0);
    const back = adapter.decompress(adapter.compress(input));
    expect(back.length).toBe(0);
  });

  it('round-trips a buffer with non-ASCII / binary bytes', () => {
    const adapter = new BrotliCompressionAdapter();
    const input = Buffer.from([0, 1, 2, 255, 254, 253, 128, 64]);
    const back = adapter.decompress(adapter.compress(input));
    expect(back.equals(input)).toBe(true);
  });

  it('compresses a highly-redundant payload smaller than the input', () => {
    const adapter = new BrotliCompressionAdapter();
    const input = Buffer.from('a'.repeat(10000));
    const compressed = adapter.compress(input);
    // Redundant input should compress to a small fraction of original.
    expect(compressed.length).toBeLessThan(input.length / 10);
  });

  it('exposes a stable name', () => {
    expect(new BrotliCompressionAdapter().name).toBe('brotli');
  });

  it('throws on invalid quality at construction', () => {
    expect(() => new BrotliCompressionAdapter({ quality: -1 })).toThrow();
    expect(() => new BrotliCompressionAdapter({ quality: 12 })).toThrow();
    expect(() => new BrotliCompressionAdapter({ quality: 3.5 })).toThrow();
  });

  it("mode 'text' achieves a ratio at least as good as 'generic' on natural-language input", () => {
    // Brotli's text-mode dictionary is tuned for English prose;
    // repeating a sentence many times keeps the payload dictionary-
    // friendly so the assertion is loose-but-stable.
    const sentence =
      'The quick brown fox jumps over the lazy dog and then keeps running. ';
    const input = Buffer.from(sentence.repeat(200));
    const generic = new BrotliCompressionAdapter({ mode: 'generic' });
    const text = new BrotliCompressionAdapter({ mode: 'text' });
    expect(text.compress(input).length).toBeLessThanOrEqual(
      generic.compress(input).length,
    );
  });

  it('higher quality (11) achieves ratio at least as good as quality 1 on redundant input', () => {
    const fast = new BrotliCompressionAdapter({ quality: 1 });
    const slow = new BrotliCompressionAdapter({ quality: 11 });
    const input = Buffer.from('the quick brown fox '.repeat(500));
    expect(slow.compress(input).length).toBeLessThanOrEqual(
      fast.compress(input).length,
    );
  });

  it('decompresses output produced by a separately-constructed instance', () => {
    const a = new BrotliCompressionAdapter();
    const b = new BrotliCompressionAdapter();
    const input = Buffer.from('cross-instance round-trip');
    const back = b.decompress(a.compress(input));
    expect(back.equals(input)).toBe(true);
  });

  it('throws on malformed input to decompress', () => {
    const adapter = new BrotliCompressionAdapter();
    expect(() => adapter.decompress(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toThrow();
  });

  it('constructor with no options uses default quality and generic mode', () => {
    // Public surface doesn't expose the resolved knobs, so we
    // verify behavior: no-args constructor must round-trip and
    // produce wire output compatible with another no-args instance.
    const a = new BrotliCompressionAdapter();
    const b = new BrotliCompressionAdapter();
    const input = Buffer.from('default-options round-trip');
    const compressed = a.compress(input);
    expect(compressed.length).toBeGreaterThan(0);
    expect(b.decompress(compressed).equals(input)).toBe(true);
  });
});
