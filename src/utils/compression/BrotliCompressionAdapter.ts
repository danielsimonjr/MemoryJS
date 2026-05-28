import { brotliCompressSync, brotliDecompressSync } from 'zlib';
import type { ICompressionAdapter } from './ICompressionAdapter.js';

export class BrotliCompressionAdapter implements ICompressionAdapter {
  readonly name = 'brotli';

  compress(input: Buffer): Buffer {
    try {
      return brotliCompressSync(input);
    } catch (err) {
      throw new Error(
        `BrotliCompressionAdapter: compress failed (input may exceed Buffer.constants.MAX_LENGTH): ${(err as Error).message}`,
      );
    }
  }

  decompress(input: Buffer): Buffer {
    try {
      return brotliDecompressSync(input);
    } catch (err) {
      throw new Error(
        `BrotliCompressionAdapter: decompress failed — input is likely corrupted, truncated, or produced by a different adapter: ${(err as Error).message}`,
      );
    }
  }
}
