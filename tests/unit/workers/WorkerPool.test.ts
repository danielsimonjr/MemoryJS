/**
 * Workerpool Integration Tests
 *
 * Unit tests for the workerpool library integration (Phase 8).
 *
 * Note: Full worker execution tests are skipped due to ESM/worker thread
 * compatibility issues in the test environment. The FuzzySearch integration
 * tests verify the end-to-end functionality.
 */

import { describe, it, expect } from 'vitest';
import workerpool from '@danielsimonjr/workerpool';

describe('Workerpool Integration', () => {
  describe('Pool API', () => {
    it('should export pool function', () => {
      expect(typeof workerpool.pool).toBe('function');
    });

    it('should export worker function', () => {
      expect(typeof workerpool.worker).toBe('function');
    });

    it('should export cpus constant', () => {
      expect(typeof workerpool.cpus).toBe('number');
      expect(workerpool.cpus).toBeGreaterThan(0);
    });

    it('should create a pool instance', () => {
      // Create pool without a script (will use inline functions)
      const pool = workerpool.pool();

      expect(pool).toBeDefined();
      expect(typeof pool.exec).toBe('function');
      expect(typeof pool.terminate).toBe('function');
      expect(typeof pool.stats).toBe('function');

      // Immediately terminate - no tasks submitted
      pool.terminate(true);
    });

    it('should report pool stats', () => {
      const pool = workerpool.pool();

      const stats = pool.stats();
      expect(typeof stats.totalWorkers).toBe('number');
      expect(typeof stats.busyWorkers).toBe('number');
      expect(typeof stats.idleWorkers).toBe('number');
      expect(typeof stats.pendingTasks).toBe('number');

      pool.terminate(true);
    });
  });

  describe('Configuration', () => {
    it('should accept maxWorkers option', () => {
      const pool = workerpool.pool({
        maxWorkers: 2,
      });

      expect(pool).toBeDefined();
      pool.terminate(true);
    });

    it('should accept workerType option', () => {
      const pool = workerpool.pool({
        workerType: 'thread',
      });

      expect(pool).toBeDefined();
      pool.terminate(true);
    });
  });
});
