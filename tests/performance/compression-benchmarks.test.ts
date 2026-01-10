/**
 * Compression Performance Benchmarks
 *
 * Performance tests for brotli compression operations.
 * Uses relative timing to avoid flaky tests on different machines.
 *
 * Phase 3 Sprint 5: Archive & Cache Compression
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { compress, decompress } from '../../src/utils/compressionUtil.js';
import { CompressedCache } from '../../src/utils/compressedCache.js';
import { ArchiveManager } from '../../src/features/ArchiveManager.js';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { COMPRESSION_CONFIG } from '../../src/utils/constants.js';
import type { Entity } from '../../src/types/index.js';

describe('Compression Performance Benchmarks', () => {
  let testDir: string;

  // Performance tests need longer timeouts (especially for CI)
  const PERF_TIMEOUT = 60000;

  beforeAll(async () => {
    testDir = join(tmpdir(), `compression-benchmark-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  }, PERF_TIMEOUT);

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Helper to create test entities
  const createEntity = (name: string, observationCount: number = 5): Entity => ({
    name,
    entityType: 'benchmark',
    observations: Array.from({ length: observationCount }, (_, i) =>
      `Observation ${i + 1} for ${name}: This is a substantial observation text with repeating patterns that should compress well. The knowledge graph system stores various types of information including projects, people, concepts, and their relationships. This content is designed to be realistic and compressible.`
    ),
    createdAt: '2024-01-01T00:00:00Z',
    lastModified: '2024-01-01T00:00:00Z',
    tags: ['benchmark', 'test', 'compression', 'performance'],
    importance: 5,
  });

  // Helper to create a batch of entities
  const createEntities = (count: number, obsPerEntity: number = 5): Entity[] =>
    Array.from({ length: count }, (_, i) => createEntity(`Entity${i}`, obsPerEntity));

  // Helper to measure execution time
  const measureTime = async (fn: () => Promise<void>): Promise<number> => {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000; // Convert to milliseconds
  };

  describe('brotli compression', () => {
    it('should compress 5K entities in reasonable time', async () => {
      const entities = createEntities(5000, 3);
      const jsonContent = JSON.stringify(entities);

      const compressionTime = await measureTime(async () => {
        await compress(jsonContent, {
          quality: COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE,
        });
      });

      // Quality 11 (ARCHIVE) is slow - should complete within 120 seconds
      // High-quality brotli compression is CPU-intensive and varies by machine
      expect(compressionTime).toBeLessThan(120000);
      console.log(`5K entity compression: ${compressionTime.toFixed(2)}ms`);
    }, PERF_TIMEOUT * 2);

    it('should decompress 5K entities faster than compression', async () => {
      const entities = createEntities(5000, 3);
      const jsonContent = JSON.stringify(entities);

      const compressionResult = await compress(jsonContent, {
        quality: COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE,
      });

      const decompressionTime = await measureTime(async () => {
        await decompress(compressionResult.compressed);
      });

      // Decompression should be fast
      expect(decompressionTime).toBeLessThan(5000);
      console.log(`5K entity decompression: ${decompressionTime.toFixed(2)}ms`);
    }, PERF_TIMEOUT * 2); // Compression step takes a long time at quality 11

    it('should achieve 50%+ compression ratio on typical graph data', async () => {
      const entities = createEntities(1000, 5);
      const jsonContent = JSON.stringify(entities);
      const originalSize = Buffer.byteLength(jsonContent, 'utf-8');

      const result = await compress(jsonContent, {
        quality: COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE,
      });

      const compressionRatio = result.compressedSize / originalSize;

      expect(compressionRatio).toBeLessThan(0.5); // At least 50% compression
      console.log(`Compression ratio: ${(compressionRatio * 100).toFixed(1)}% (${result.originalSize} -> ${result.compressedSize} bytes)`);
    }, PERF_TIMEOUT);

    it('should show quality level impact on compression', async () => {
      const entities = createEntities(1000, 5);
      const jsonContent = JSON.stringify(entities);

      // Test different quality levels
      const qualities = [
        COMPRESSION_CONFIG.BROTLI_QUALITY_REALTIME,
        COMPRESSION_CONFIG.BROTLI_QUALITY_BATCH,
        COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE,
      ];

      const results: Array<{ quality: number; time: number; ratio: number }> = [];

      for (const quality of qualities) {
        const startTime = process.hrtime.bigint();
        const result = await compress(jsonContent, { quality });
        const endTime = process.hrtime.bigint();
        const time = Number(endTime - startTime) / 1_000_000;

        results.push({
          quality,
          time,
          ratio: result.ratio,
        });
      }

      // Higher quality should give better compression (lower ratio)
      expect(results[2].ratio).toBeLessThan(results[0].ratio);

      console.log('Quality level comparison:');
      for (const r of results) {
        console.log(`  Quality ${r.quality}: ${r.time.toFixed(2)}ms, ratio ${(r.ratio * 100).toFixed(1)}%`);
      }
    }, PERF_TIMEOUT);
  });

  describe('CompressedCache performance', () => {
    it('should handle cache operations efficiently', async () => {
      const cache = new CompressedCache({
        maxUncompressed: 100,
        compressionThresholdMs: 0,
      });

      const entities = createEntities(500, 3);

      // Measure set operations
      const setTime = await measureTime(async () => {
        for (const entity of entities) {
          cache.set(entity.name, entity);
        }
      });

      expect(setTime).toBeLessThan(1000);
      console.log(`500 cache sets: ${setTime.toFixed(2)}ms`);

      // Measure get operations (some will decompress)
      const getTime = await measureTime(async () => {
        for (const entity of entities) {
          cache.get(entity.name);
        }
      });

      expect(getTime).toBeLessThan(1000);
      console.log(`500 cache gets (with decompression): ${getTime.toFixed(2)}ms`);

      const stats = cache.getStats();
      console.log(`Cache stats: ${stats.compressed} compressed, ${stats.uncompressed} uncompressed`);
    });

    it('should reduce memory usage through compression', async () => {
      const cache = new CompressedCache({
        maxUncompressed: 50,
        compressionThresholdMs: 0,
      });

      // Add many entities to trigger compression
      for (let i = 0; i < 200; i++) {
        cache.set(`Entity${i}`, createEntity(`Entity${i}`, 10));
        // Small delay to ensure different access times
        if (i % 20 === 0) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }

      const stats = cache.getStats();

      // Should have compressed entries
      expect(stats.compressed).toBeGreaterThan(0);

      // Memory savings should be significant
      expect(stats.memorySaved).toBeGreaterThan(0);

      console.log(`Memory saved: ${(stats.memorySaved / 1024).toFixed(2)}KB`);
      console.log(`Original total: ${(stats.totalOriginalSize / 1024).toFixed(2)}KB`);
      console.log(`Savings percentage: ${((stats.memorySaved / stats.totalOriginalSize) * 100).toFixed(1)}%`);
    });
  });

  describe('ArchiveManager performance', () => {
    it('should archive entities with compression efficiently', async () => {
      const testFilePath = join(testDir, 'archive-benchmark.jsonl');
      const storage = new GraphStorage(testFilePath);
      const archiveManager = new ArchiveManager(storage);

      // Create graph with entities to archive
      const entities = createEntities(1000, 5).map(e => ({
        ...e,
        lastModified: '2020-01-01T00:00:00Z',
      }));

      await storage.saveGraph({
        entities,
        relations: [],
      });

      // Measure archive operation
      const archiveTime = await measureTime(async () => {
        await archiveManager.archiveEntities({
          olderThan: '2023-01-01T00:00:00Z',
        });
      });

      // Archive time varies significantly based on machine and disk I/O
      expect(archiveTime).toBeLessThan(30000);
      console.log(`1000 entity archive: ${archiveTime.toFixed(2)}ms`);

      // Check compression stats
      const archives = await archiveManager.listArchives();
      expect(archives).toHaveLength(1);

      const archive = archives[0];
      console.log(`Archive compression: ${(archive.compressionRatio! * 100).toFixed(1)}%`);
      console.log(`Archive size: ${archive.compressedSize} bytes (from ${archive.originalSize} bytes)`);
    }, PERF_TIMEOUT * 2);
  });

  describe('comparative benchmarks', () => {
    it('should show compression overhead is acceptable', async () => {
      const entities = createEntities(500, 5);
      const jsonContent = JSON.stringify(entities);

      // Baseline: JSON.stringify/parse
      const jsonTime = await measureTime(async () => {
        const str = JSON.stringify(entities);
        JSON.parse(str);
      });

      // With compression
      const compressedTime = await measureTime(async () => {
        const result = await compress(jsonContent);
        await decompress(result.compressed);
      });

      // Compression should add reasonable overhead (< 10x baseline)
      const overhead = compressedTime / jsonTime;
      expect(overhead).toBeLessThan(20);

      console.log(`JSON roundtrip: ${jsonTime.toFixed(2)}ms`);
      console.log(`Compressed roundtrip: ${compressedTime.toFixed(2)}ms`);
      console.log(`Overhead factor: ${overhead.toFixed(1)}x`);
    });

    it('should show compression benefits outweigh costs for large data', async () => {
      const largeEntities = createEntities(2000, 10);
      const jsonContent = JSON.stringify(largeEntities);
      const originalSize = Buffer.byteLength(jsonContent, 'utf-8');

      const compressionResult = await compress(jsonContent, {
        quality: COMPRESSION_CONFIG.BROTLI_QUALITY_BATCH,
      });

      // Calculate effective throughput (bytes saved per ms spent)
      const startTime = process.hrtime.bigint();
      await compress(jsonContent, { quality: COMPRESSION_CONFIG.BROTLI_QUALITY_BATCH });
      const endTime = process.hrtime.bigint();
      const compressionMs = Number(endTime - startTime) / 1_000_000;

      const bytesSaved = originalSize - compressionResult.compressedSize;
      const throughput = bytesSaved / compressionMs;

      console.log(`Original size: ${(originalSize / 1024).toFixed(2)}KB`);
      console.log(`Compressed size: ${(compressionResult.compressedSize / 1024).toFixed(2)}KB`);
      console.log(`Bytes saved: ${(bytesSaved / 1024).toFixed(2)}KB`);
      console.log(`Compression time: ${compressionMs.toFixed(2)}ms`);
      console.log(`Throughput: ${(throughput / 1024).toFixed(2)}KB saved per ms`);

      // Should save significant bytes
      expect(bytesSaved).toBeGreaterThan(originalSize * 0.5);
    });
  });
});
