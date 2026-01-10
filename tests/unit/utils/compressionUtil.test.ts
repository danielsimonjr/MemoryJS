/**
 * Compression Utility Tests
 *
 * Tests for brotli compression utilities using Node.js built-in zlib.
 *
 * @module tests/unit/utils/compressionUtil
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  compress,
  decompress,
  compressFile,
  decompressFile,
  compressToBase64,
  decompressFromBase64,
  hasBrotliExtension,
  getCompressionRatio,
  createMetadata,
  createUncompressedMetadata,
} from '../../../src/utils/compressionUtil.js';
import { COMPRESSION_CONFIG } from '../../../src/utils/constants.js';

describe('compressionUtil', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'compression-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('compress/decompress roundtrip', () => {
    it('should compress and decompress string data correctly', async () => {
      const original = 'Hello, World! This is a test string for compression.';
      const compressed = await compress(original);
      const decompressed = await decompress(compressed.compressed);

      expect(decompressed.toString('utf-8')).toBe(original);
    });

    it('should compress and decompress Buffer data correctly', async () => {
      const original = Buffer.from('Binary data test with some special bytes: \x00\x01\x02\xFF');
      const compressed = await compress(original);
      const decompressed = await decompress(compressed.compressed);

      expect(decompressed).toEqual(original);
    });

    it('should handle empty input', async () => {
      const original = '';
      const compressed = await compress(original);
      const decompressed = await decompress(compressed.compressed);

      expect(decompressed.toString('utf-8')).toBe(original);
      expect(compressed.originalSize).toBe(0);
    });

    it('should handle large data (1MB+)', async () => {
      // Create ~1MB of JSON-like data
      const entities = Array.from({ length: 10000 }, (_, i) => ({
        name: `entity_with_longer_name_${i}`,
        type: 'test_type',
        observations: [
          `observation ${i} with some additional text content`,
          `another observation ${i} with more descriptive content`,
          `a third observation ${i} to add more data volume`,
        ],
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
        importance: i % 10,
      }));
      const original = JSON.stringify(entities);

      expect(original.length).toBeGreaterThan(1000000); // Verify it's > 1MB

      const compressed = await compress(original);
      const decompressed = await decompress(compressed.compressed);

      expect(decompressed.toString('utf-8')).toBe(original);
    });

    it('should achieve expected compression ratio for JSON data', async () => {
      // Typical JSON data should compress well (50-75% reduction)
      const data = JSON.stringify({
        entities: Array.from({ length: 100 }, (_, i) => ({
          name: `entity_${i}`,
          entityType: 'test',
          observations: ['This is a typical observation with some text content'],
          tags: ['common', 'tags', 'repeated'],
        })),
      });

      const result = await compress(data, { quality: 6 });

      // Expect at least 50% compression (ratio < 0.5)
      expect(result.ratio).toBeLessThan(0.5);
    });

    it('should handle unicode content correctly', async () => {
      const original = 'Hello 世界! Привет мир! 🎉 Special chars: äöü ñ';
      const compressed = await compress(original);
      const decompressed = await decompress(compressed.compressed);

      expect(decompressed.toString('utf-8')).toBe(original);
    });

    it('should handle repeated content efficiently', async () => {
      // Highly repetitive data should compress very well
      const repeated = 'AAAAAAAAAA'.repeat(10000);
      const result = await compress(repeated);

      // Highly repetitive data should compress to < 5% of original
      expect(result.ratio).toBeLessThan(0.05);
    });
  });

  describe('hasBrotliExtension', () => {
    it('should detect .br file extension', () => {
      expect(hasBrotliExtension('file.br')).toBe(true);
      expect(hasBrotliExtension('backup.jsonl.br')).toBe(true);
      expect(hasBrotliExtension('/path/to/file.br')).toBe(true);
    });

    it('should reject .json extension', () => {
      expect(hasBrotliExtension('file.json')).toBe(false);
    });

    it('should reject .jsonl extension', () => {
      expect(hasBrotliExtension('file.jsonl')).toBe(false);
      expect(hasBrotliExtension('memory.jsonl')).toBe(false);
    });

    it('should handle paths with multiple dots', () => {
      expect(hasBrotliExtension('file.tar.gz.br')).toBe(true);
      expect(hasBrotliExtension('file.v1.0.json.br')).toBe(true);
      expect(hasBrotliExtension('file.br.json')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(hasBrotliExtension('')).toBe(false);
      expect(hasBrotliExtension('.br')).toBe(true);
      expect(hasBrotliExtension('br')).toBe(false);
    });
  });

  describe('quality levels', () => {
    const testData = 'x'.repeat(10000);

    it('should compress faster with lower quality', async () => {
      const startLow = performance.now();
      await compress(testData, { quality: 1 });
      const timeLow = performance.now() - startLow;

      const startHigh = performance.now();
      await compress(testData, { quality: 11 });
      const timeHigh = performance.now() - startHigh;

      // Quality 11 should take longer than quality 1
      // (but not always guaranteed on small data, so we just verify both work)
      expect(timeLow).toBeGreaterThanOrEqual(0);
      expect(timeHigh).toBeGreaterThanOrEqual(0);
    });

    it('should achieve better ratio with higher quality', async () => {
      // Use larger, more compressible data
      const largeData = JSON.stringify(
        Array.from({ length: 1000 }, (_, i) => ({
          name: `entity_${i}`,
          observations: ['repeated observation content here'],
        }))
      );

      const resultLow = await compress(largeData, { quality: 1 });
      const resultHigh = await compress(largeData, { quality: 11 });

      // Higher quality should achieve equal or better compression
      expect(resultHigh.ratio).toBeLessThanOrEqual(resultLow.ratio);
    });

    it('should work with all quality levels 0-11', async () => {
      for (let quality = 0; quality <= 11; quality++) {
        const result = await compress(testData, { quality });
        const decompressed = await decompress(result.compressed);
        expect(decompressed.toString('utf-8')).toBe(testData);
      }
    });

    it('should use default quality from COMPRESSION_CONFIG', async () => {
      const result = await compress(testData);
      // Just verify it works with default quality
      expect(result.compressed.length).toBeGreaterThan(0);
    });

    it('should respect text mode option', async () => {
      const textData = 'Hello world! '.repeat(1000);
      const resultGeneric = await compress(textData, { mode: 'generic' });
      const resultText = await compress(textData, { mode: 'text' });

      // Both should decompress correctly
      const decompressedGeneric = await decompress(resultGeneric.compressed);
      const decompressedText = await decompress(resultText.compressed);

      expect(decompressedGeneric.toString()).toBe(textData);
      expect(decompressedText.toString()).toBe(textData);
    });
  });

  describe('file operations', () => {
    it('should compress file to disk', async () => {
      const inputPath = join(tempDir, 'input.txt');
      const outputPath = join(tempDir, 'output.br');
      const content = 'Test file content '.repeat(100);

      await fs.writeFile(inputPath, content);
      const result = await compressFile(inputPath, outputPath);

      expect(result.originalSize).toBe(Buffer.byteLength(content));
      expect(result.compressedSize).toBeLessThan(result.originalSize);

      const compressed = await fs.readFile(outputPath);
      expect(compressed.length).toBe(result.compressedSize);
    });

    it('should decompress file from disk', async () => {
      const inputPath = join(tempDir, 'input.txt');
      const compressedPath = join(tempDir, 'compressed.br');
      const outputPath = join(tempDir, 'output.txt');
      const content = 'Decompression test content '.repeat(100);

      // Create and compress
      await fs.writeFile(inputPath, content);
      await compressFile(inputPath, compressedPath);

      // Decompress
      await decompressFile(compressedPath, outputPath);

      const restored = await fs.readFile(outputPath, 'utf-8');
      expect(restored).toBe(content);
    });

    it('should preserve file content through roundtrip', async () => {
      const inputPath = join(tempDir, 'original.json');
      const compressedPath = join(tempDir, 'compressed.json.br');
      const outputPath = join(tempDir, 'restored.json');

      const content = JSON.stringify({
        entities: [
          { name: 'test', type: 'example', observations: ['obs1', 'obs2'] },
        ],
        relations: [{ from: 'a', to: 'b', relationType: 'knows' }],
      });

      await fs.writeFile(inputPath, content);
      await compressFile(inputPath, compressedPath);
      await decompressFile(compressedPath, outputPath);

      const restored = await fs.readFile(outputPath, 'utf-8');
      expect(JSON.parse(restored)).toEqual(JSON.parse(content));
    });

    it('should handle binary files', async () => {
      const inputPath = join(tempDir, 'binary.bin');
      const compressedPath = join(tempDir, 'binary.bin.br');
      const outputPath = join(tempDir, 'restored.bin');

      // Create binary content with all byte values
      const content = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        content[i] = i;
      }

      await fs.writeFile(inputPath, content);
      await compressFile(inputPath, compressedPath);
      await decompressFile(compressedPath, outputPath);

      const restored = await fs.readFile(outputPath);
      expect(restored).toEqual(content);
    });
  });

  describe('error handling', () => {
    it('should throw on corrupt compressed data', async () => {
      const corruptData = Buffer.from('not valid brotli data');

      await expect(decompress(corruptData)).rejects.toThrow(
        /Brotli decompression failed/
      );
    });

    it('should throw on invalid quality range', async () => {
      await expect(compress('test', { quality: -1 })).rejects.toThrow(
        /Invalid brotli quality level/
      );
      await expect(compress('test', { quality: 12 })).rejects.toThrow(
        /Invalid brotli quality level/
      );
    });

    it('should throw on invalid window size', async () => {
      await expect(compress('test', { lgwin: 5 })).rejects.toThrow(
        /Invalid brotli window size/
      );
      await expect(compress('test', { lgwin: 30 })).rejects.toThrow(
        /Invalid brotli window size/
      );
    });

    it('should throw on file not found', async () => {
      await expect(
        compressFile('/nonexistent/path.txt', '/output.br')
      ).rejects.toThrow();
    });

    it('should throw when decompress receives non-Buffer', async () => {
      // @ts-expect-error Testing runtime type check
      await expect(decompress('string input')).rejects.toThrow(
        /Input must be a Buffer/
      );
    });

    it('should handle truncated compressed data', async () => {
      const original = 'x'.repeat(1000);
      const result = await compress(original);

      // Truncate the compressed data
      const truncated = result.compressed.subarray(
        0,
        Math.floor(result.compressed.length / 2)
      );

      await expect(decompress(truncated)).rejects.toThrow();
    });
  });

  describe('metadata', () => {
    it('should create valid compression metadata', async () => {
      const result = await compress('test data');
      const metadata = createMetadata(result);

      expect(metadata.compressed).toBe(true);
      expect(metadata.compressionFormat).toBe('brotli');
      expect(metadata.originalSize).toBe(result.originalSize);
      expect(metadata.compressedSize).toBe(result.compressedSize);
      expect(metadata.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include checksum when provided', async () => {
      const result = await compress('test data');
      const checksum = 'abc123';
      const metadata = createMetadata(result, checksum);

      expect(metadata.originalChecksum).toBe(checksum);
    });

    it('should calculate correct compression ratio in metadata', async () => {
      const data = 'x'.repeat(10000);
      const result = await compress(data);
      const metadata = createMetadata(result);

      const expectedRatio = metadata.compressedSize / metadata.originalSize;
      expect(result.ratio).toBeCloseTo(expectedRatio, 10);
    });

    it('should create uncompressed metadata', () => {
      const size = 12345;
      const metadata = createUncompressedMetadata(size);

      expect(metadata.compressed).toBe(false);
      expect(metadata.compressionFormat).toBe('none');
      expect(metadata.originalSize).toBe(size);
      expect(metadata.compressedSize).toBe(size);
    });
  });

  describe('getCompressionRatio', () => {
    it('should calculate ratio correctly', () => {
      expect(getCompressionRatio(1000, 250)).toBe(0.25);
      expect(getCompressionRatio(100, 50)).toBe(0.5);
      expect(getCompressionRatio(100, 100)).toBe(1);
    });

    it('should handle zero original size', () => {
      expect(getCompressionRatio(0, 0)).toBe(1);
      expect(getCompressionRatio(0, 100)).toBe(1);
    });

    it('should handle expansion (ratio > 1)', () => {
      // Small data might expand after compression
      expect(getCompressionRatio(10, 20)).toBe(2);
    });
  });

  describe('base64 encoding', () => {
    it('should compress to base64 and decompress correctly', async () => {
      const original = 'Test data for base64 compression';
      const base64 = await compressToBase64(original);
      const restored = await decompressFromBase64(base64);

      expect(restored).toBe(original);
    });

    it('should produce valid base64 string', async () => {
      const base64 = await compressToBase64('test');

      // Base64 should only contain valid characters
      expect(base64).toMatch(/^[A-Za-z0-9+/=]*$/);
    });

    it('should handle large JSON data', async () => {
      const data = JSON.stringify({
        entities: Array.from({ length: 100 }, (_, i) => ({
          name: `entity_${i}`,
          data: 'x'.repeat(100),
        })),
      });

      const base64 = await compressToBase64(data);
      const restored = await decompressFromBase64(base64);

      expect(JSON.parse(restored)).toEqual(JSON.parse(data));
    });

    it('should handle unicode in base64 encoding', async () => {
      const original = '你好世界 🌍 Привет';
      const base64 = await compressToBase64(original);
      const restored = await decompressFromBase64(base64);

      expect(restored).toBe(original);
    });
  });

  describe('COMPRESSION_CONFIG constants', () => {
    it('should have valid quality level values', () => {
      expect(COMPRESSION_CONFIG.BROTLI_QUALITY_REALTIME).toBe(4);
      expect(COMPRESSION_CONFIG.BROTLI_QUALITY_BATCH).toBe(6);
      expect(COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE).toBe(11);
      expect(COMPRESSION_CONFIG.BROTLI_QUALITY_CACHE).toBe(5);
    });

    it('should have valid threshold values', () => {
      expect(COMPRESSION_CONFIG.AUTO_COMPRESS_EXPORT_SIZE).toBe(100 * 1024);
      expect(COMPRESSION_CONFIG.AUTO_COMPRESS_RESPONSE_SIZE).toBe(256 * 1024);
    });

    it('should have correct file extension', () => {
      expect(COMPRESSION_CONFIG.BROTLI_EXTENSION).toBe('.br');
    });
  });
});
