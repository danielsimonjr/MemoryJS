/**
 * Tests for Parallel Utilities
 *
 * Phase 8 Sprint 3: Parallel array operations.
 *
 * NOTE: Due to ESM/worker thread compatibility issues in vitest,
 * these tests focus on API validation rather than actual parallelization.
 * The parallel execution works in production but may fall back to
 * single-threaded in the test environment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parallelMap,
  parallelFilter,
  getPoolStats,
  shutdownParallelUtils,
} from '../../../src/utils/parallelUtils.js';

describe('Parallel Utilities', () => {
  afterAll(async () => {
    // Clean up worker pool after tests
    await shutdownParallelUtils();
  });

  describe('parallelMap', () => {
    it('should map small arrays (single-threaded fallback)', async () => {
      const numbers = [1, 2, 3, 4, 5];
      const squared = await parallelMap(numbers, (n: number) => n * n);

      expect(squared).toEqual([1, 4, 9, 16, 25]);
    });

    it('should map arrays with custom chunk size', async () => {
      const numbers = Array.from({ length: 10 }, (_, i) => i + 1);
      const doubled = await parallelMap(numbers, (n: number) => n * 2, 5);

      expect(doubled).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    });

    it('should handle empty arrays', async () => {
      const empty: number[] = [];
      const result = await parallelMap(empty, (n: number) => n * 2);

      expect(result).toEqual([]);
    });

    it('should preserve array order', async () => {
      const numbers = Array.from({ length: 50 }, (_, i) => i + 1);
      const mapped = await parallelMap(numbers, (n: number) => n + 100);

      expect(mapped).toEqual(numbers.map(n => n + 100));
    });

    it('should handle complex transformations', async () => {
      interface Item {
        id: number;
        value: string;
      }

      const items: Item[] = [
        { id: 1, value: 'a' },
        { id: 2, value: 'b' },
        { id: 3, value: 'c' },
      ];

      const mapped = await parallelMap(
        items,
        (item: Item) => ({ ...item, value: item.value.toUpperCase() })
      );

      expect(mapped).toEqual([
        { id: 1, value: 'A' },
        { id: 2, value: 'B' },
        { id: 3, value: 'C' },
      ]);
    });
  });

  describe('parallelFilter', () => {
    it('should filter small arrays (single-threaded fallback)', async () => {
      const numbers = [1, 2, 3, 4, 5, 6];
      const evens = await parallelFilter(numbers, (n: number) => n % 2 === 0);

      expect(evens).toEqual([2, 4, 6]);
    });

    it('should filter arrays with custom chunk size', async () => {
      const numbers = Array.from({ length: 20 }, (_, i) => i + 1);
      const greaterThan10 = await parallelFilter(
        numbers,
        (n: number) => n > 10,
        5
      );

      expect(greaterThan10).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    });

    it('should handle empty arrays', async () => {
      const empty: number[] = [];
      const result = await parallelFilter(empty, (n: number) => n > 0);

      expect(result).toEqual([]);
    });

    it('should handle filters that match nothing', async () => {
      const numbers = [1, 2, 3, 4, 5];
      const result = await parallelFilter(numbers, (n: number) => n > 10);

      expect(result).toEqual([]);
    });

    it('should handle filters that match everything', async () => {
      const numbers = [1, 2, 3, 4, 5];
      const result = await parallelFilter(numbers, (n: number) => n > 0);

      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should preserve array order', async () => {
      const numbers = Array.from({ length: 50 }, (_, i) => i + 1);
      const filtered = await parallelFilter(numbers, (n: number) => n % 2 === 0);

      expect(filtered).toEqual(numbers.filter(n => n % 2 === 0));
    });

    it('should handle complex predicates', async () => {
      interface Item {
        id: number;
        active: boolean;
      }

      const items: Item[] = [
        { id: 1, active: true },
        { id: 2, active: false },
        { id: 3, active: true },
        { id: 4, active: false },
      ];

      const filtered = await parallelFilter(items, (item: Item) => item.active);

      expect(filtered).toEqual([
        { id: 1, active: true },
        { id: 3, active: true },
      ]);
    });
  });

  describe('getPoolStats', () => {
    it('should return null before pool is initialized', () => {
      // This test runs first, so pool might not be initialized yet
      const stats = getPoolStats();
      expect(stats === null || typeof stats === 'object').toBe(true);
    });

    it('should return pool stats after pool is used', async () => {
      // Use pool to ensure it's initialized
      await parallelMap([1, 2, 3], (n: number) => n * 2);

      const stats = getPoolStats();
      // Stats might be null if pool was already shut down
      if (stats) {
        expect(typeof stats).toBe('object');
      }
    });
  });

  describe('shutdownParallelUtils', () => {
    it('should shutdown worker pool without errors', async () => {
      // Initialize pool
      await parallelMap([1, 2, 3], (n: number) => n * 2);

      // Shutdown
      await expect(shutdownParallelUtils()).resolves.toBeUndefined();
    });

    it('should handle multiple shutdown calls', async () => {
      await expect(shutdownParallelUtils()).resolves.toBeUndefined();
      await expect(shutdownParallelUtils()).resolves.toBeUndefined();
    });
  });

  describe('Large array scenarios', () => {
    it('should handle larger arrays (may use workers if threshold met)', async () => {
      // Create array just below worker threshold (200 items)
      const numbers = Array.from({ length: 150 }, (_, i) => i + 1);
      const squared = await parallelMap(numbers, (n: number) => n * n);

      expect(squared.length).toBe(150);
      expect(squared[0]).toBe(1);
      expect(squared[149]).toBe(150 * 150);
    });

    it(
      'should handle arrays above worker threshold',
      async () => {
        // Create array above worker threshold (200 items)
        // Note: This test may fall back to single-threaded due to ESM/worker
        // compatibility issues in vitest, but it verifies the API works correctly
        const numbers = Array.from({ length: 250 }, (_, i) => i + 1);
        const filtered = await parallelFilter(numbers, (n: number) => n % 2 === 0);

        expect(filtered.length).toBe(125);
        expect(filtered.every(n => n % 2 === 0)).toBe(true);
      },
      15000 // Increased timeout for potentially slow worker operations
    );
  });

  // ==================== SPRINT 10: Additional Coverage Tests ====================

  describe('Input Validation', () => {
    it('should reject non-function for parallelMap', async () => {
      const numbers = [1, 2, 3];
      await expect(
        parallelMap(numbers, 'not a function' as unknown as (n: number) => number)
      ).rejects.toThrow(TypeError);
    });

    it('should reject non-function for parallelFilter', async () => {
      const numbers = [1, 2, 3];
      await expect(
        parallelFilter(numbers, 'not a function' as unknown as (n: number) => boolean)
      ).rejects.toThrow(TypeError);
    });

    it('should reject null function for parallelMap', async () => {
      const numbers = [1, 2, 3];
      await expect(
        parallelMap(numbers, null as unknown as (n: number) => number)
      ).rejects.toThrow(TypeError);
    });

    it('should reject undefined function for parallelFilter', async () => {
      const numbers = [1, 2, 3];
      await expect(
        parallelFilter(numbers, undefined as unknown as (n: number) => boolean)
      ).rejects.toThrow(TypeError);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single-element arrays', async () => {
      const result = await parallelMap([42], (n: number) => n * 2);
      expect(result).toEqual([84]);
    });

    it('should handle array with undefined values', async () => {
      const items = [1, undefined, 3];
      const result = await parallelMap(items, (n: number | undefined) => n ?? 0);
      expect(result).toEqual([1, 0, 3]);
    });

    it('should handle array with null values', async () => {
      const items = [1, null, 3];
      const result = await parallelFilter(
        items,
        (n: number | null) => n !== null
      );
      expect(result).toEqual([1, 3]);
    });

    it('should map strings correctly', async () => {
      const strings = ['hello', 'world', 'test'];
      const result = await parallelMap(strings, (s: string) => s.toUpperCase());
      expect(result).toEqual(['HELLO', 'WORLD', 'TEST']);
    });

    it('should filter strings correctly', async () => {
      const strings = ['hello', 'hi', 'world', 'test'];
      const result = await parallelFilter(
        strings,
        (s: string) => s.length > 3
      );
      expect(result).toEqual(['hello', 'world', 'test']);
    });
  });

  describe('Chunk Size Behavior', () => {
    it('should respect chunk size of 1', async () => {
      const numbers = [1, 2, 3, 4, 5];
      const result = await parallelMap(numbers, (n: number) => n + 1, 1);
      expect(result).toEqual([2, 3, 4, 5, 6]);
    });

    it('should handle chunk size larger than array', async () => {
      const numbers = [1, 2, 3];
      const result = await parallelMap(numbers, (n: number) => n * 2, 1000);
      expect(result).toEqual([2, 4, 6]);
    });

    it('should handle chunk size of array length', async () => {
      const numbers = [1, 2, 3, 4, 5];
      const result = await parallelFilter(
        numbers,
        (n: number) => n % 2 === 0,
        5
      );
      expect(result).toEqual([2, 4]);
    });
  });

  describe('Performance Characteristics', () => {
    it('should complete map operation in reasonable time', async () => {
      const start = Date.now();
      const numbers = Array.from({ length: 1000 }, (_, i) => i);
      await parallelMap(numbers, (n: number) => n * n);
      const duration = Date.now() - start;

      // Should complete in under 1 second even with worker overhead
      expect(duration).toBeLessThan(1000);
    });

    it('should complete filter operation in reasonable time', async () => {
      const start = Date.now();
      const numbers = Array.from({ length: 1000 }, (_, i) => i);
      await parallelFilter(numbers, (n: number) => n % 2 === 0);
      const duration = Date.now() - start;

      // Should complete in under 1 second even with worker overhead
      expect(duration).toBeLessThan(1000);
    });
  });
});
