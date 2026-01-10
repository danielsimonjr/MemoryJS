/**
 * WorkerPoolManager Unit Tests
 *
 * Phase 12 Sprint 2: Tests for unified worker pool management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WorkerPoolManager,
  getWorkerPoolManager,
  type WorkerPoolConfig,
  type ExtendedPoolStats,
  type PoolEventCallback,
} from '../../../src/utils/WorkerPoolManager.js';

describe('WorkerPoolManager', () => {
  let manager: WorkerPoolManager;

  beforeEach(() => {
    // Reset the singleton for clean tests
    WorkerPoolManager.resetInstance();
    manager = WorkerPoolManager.getInstance();
  });

  afterEach(async () => {
    // Clean up pools after each test
    await manager.shutdownAll(true);
    WorkerPoolManager.resetInstance();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = WorkerPoolManager.getInstance();
      const instance2 = WorkerPoolManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should return different instance after reset', () => {
      const instance1 = WorkerPoolManager.getInstance();
      WorkerPoolManager.resetInstance();
      const instance2 = WorkerPoolManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });

    it('should provide convenience function for getting instance', () => {
      const instance = getWorkerPoolManager();

      expect(instance).toBe(manager);
    });
  });

  describe('Pool Creation', () => {
    it('should create a pool with default config', () => {
      const pool = manager.getPool('test-pool');

      expect(pool).toBeDefined();
      expect(manager.hasPool('test-pool')).toBe(true);
    });

    it('should create a pool with custom config', () => {
      const config: WorkerPoolConfig = {
        maxWorkers: 2,
        defaultTimeout: 5000,
        minParallelSize: 100,
      };

      const pool = manager.getPool('custom-pool', config);

      expect(pool).toBeDefined();
      expect(manager.getPoolConfig('custom-pool')).toMatchObject(config);
    });

    it('should return existing pool if already created', () => {
      const pool1 = manager.getPool('reuse-pool');
      const pool2 = manager.getPool('reuse-pool');

      expect(pool1).toBe(pool2);
    });

    it('should throw when creating duplicate pool with createPool', () => {
      manager.createPool('unique-pool');

      expect(() => manager.createPool('unique-pool')).toThrow(
        "Pool with ID 'unique-pool' already exists"
      );
    });

    it('should create multiple pools with different IDs', () => {
      const pool1 = manager.getPool('pool-1');
      const pool2 = manager.getPool('pool-2');
      const pool3 = manager.getPool('pool-3');

      expect(manager.poolCount).toBe(3);
      expect(pool1).not.toBe(pool2);
      expect(pool2).not.toBe(pool3);
    });
  });

  describe('Pool Configuration', () => {
    it('should return undefined for non-existent pool config', () => {
      const config = manager.getPoolConfig('non-existent');

      expect(config).toBeUndefined();
    });

    it('should return pool config with defaults merged', () => {
      manager.getPool('config-test', { maxWorkers: 2 });
      const config = manager.getPoolConfig('config-test');

      expect(config).toBeDefined();
      expect(config?.maxWorkers).toBe(2);
      expect(config?.workerType).toBe('thread');
      expect(config?.minParallelSize).toBe(200);
      expect(config?.defaultTimeout).toBe(30000);
    });

    it('should provide static default config', () => {
      const defaults = WorkerPoolManager.getDefaultConfig();

      expect(defaults.workerType).toBe('thread');
      expect(defaults.minParallelSize).toBe(200);
      expect(defaults.defaultTimeout).toBe(30000);
      expect(defaults.maxWorkers).toBeGreaterThan(0);
    });

    it('should provide CPU count', () => {
      const cpus = WorkerPoolManager.getCpuCount();

      expect(cpus).toBeGreaterThan(0);
    });
  });

  describe('Pool Statistics', () => {
    it('should return undefined stats for non-existent pool', () => {
      const stats = manager.getPoolStats('non-existent');

      expect(stats).toBeUndefined();
    });

    it('should return extended stats for pool', () => {
      manager.getPool('stats-test');
      const stats = manager.getPoolStats('stats-test');

      expect(stats).toBeDefined();
      expect(stats?.poolId).toBe('stats-test');
      expect(stats?.createdAt).toBeGreaterThan(0);
      expect(stats?.totalTasksExecuted).toBe(0);
      expect(stats?.totalExecutionTime).toBe(0);
      expect(stats?.averageExecutionTime).toBe(0);
    });

    it('should track task execution statistics', () => {
      manager.getPool('tracking-test');

      manager.recordTaskExecution('tracking-test', 100);
      manager.recordTaskExecution('tracking-test', 200);
      manager.recordTaskExecution('tracking-test', 150);

      const stats = manager.getPoolStats('tracking-test');

      expect(stats?.totalTasksExecuted).toBe(3);
      expect(stats?.totalExecutionTime).toBe(450);
      expect(stats?.averageExecutionTime).toBe(150);
    });

    it('should get stats for all pools', () => {
      manager.getPool('pool-a');
      manager.getPool('pool-b');

      const allStats = manager.getAllPoolStats();

      expect(allStats.size).toBe(2);
      expect(allStats.has('pool-a')).toBe(true);
      expect(allStats.has('pool-b')).toBe(true);
    });

    it('should ignore recording for non-existent pool', () => {
      // Should not throw
      manager.recordTaskExecution('non-existent', 100);

      const stats = manager.getPoolStats('non-existent');
      expect(stats).toBeUndefined();
    });
  });

  describe('Pool IDs and Count', () => {
    it('should return correct pool count', () => {
      expect(manager.poolCount).toBe(0);

      manager.getPool('pool-1');
      expect(manager.poolCount).toBe(1);

      manager.getPool('pool-2');
      expect(manager.poolCount).toBe(2);
    });

    it('should return all pool IDs', () => {
      manager.getPool('alpha');
      manager.getPool('beta');
      manager.getPool('gamma');

      const ids = manager.getPoolIds();

      expect(ids).toHaveLength(3);
      expect(ids).toContain('alpha');
      expect(ids).toContain('beta');
      expect(ids).toContain('gamma');
    });
  });

  describe('Parallel Threshold', () => {
    it('should check if size meets parallel threshold', () => {
      manager.getPool('threshold-test', { minParallelSize: 100 });

      expect(manager.shouldUseParallel('threshold-test', 50)).toBe(false);
      expect(manager.shouldUseParallel('threshold-test', 100)).toBe(true);
      expect(manager.shouldUseParallel('threshold-test', 200)).toBe(true);
    });

    it('should use default threshold for non-existent pool', () => {
      // Default minParallelSize is 200
      expect(manager.shouldUseParallel('non-existent', 150)).toBe(false);
      expect(manager.shouldUseParallel('non-existent', 200)).toBe(true);
    });
  });

  describe('Event Callbacks', () => {
    it('should emit created event', () => {
      const callback = vi.fn();
      manager.onEvent(callback);

      manager.getPool('event-test');

      expect(callback).toHaveBeenCalledWith('event-test', 'created', undefined);
    });

    it('should emit shutdown event', async () => {
      const callback = vi.fn();
      manager.getPool('shutdown-event-test');
      manager.onEvent(callback);

      await manager.shutdownPool('shutdown-event-test', true);

      expect(callback).toHaveBeenCalledWith('shutdown-event-test', 'shutdown', undefined);
    });

    it('should allow unsubscribing from events', () => {
      const callback = vi.fn();
      const unsubscribe = manager.onEvent(callback);

      manager.getPool('unsub-test-1');
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      manager.getPool('unsub-test-2');
      expect(callback).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should handle callback errors gracefully', () => {
      const errorCallback: PoolEventCallback = () => {
        throw new Error('Callback error');
      };
      const normalCallback = vi.fn();

      manager.onEvent(errorCallback);
      manager.onEvent(normalCallback);

      // Should not throw despite errorCallback
      manager.getPool('error-callback-test');

      expect(normalCallback).toHaveBeenCalled();
    });
  });

  describe('Pool Shutdown', () => {
    it('should shutdown a specific pool', async () => {
      manager.getPool('shutdown-test');
      expect(manager.hasPool('shutdown-test')).toBe(true);

      await manager.shutdownPool('shutdown-test', true);

      expect(manager.hasPool('shutdown-test')).toBe(false);
    });

    it('should handle shutdown of non-existent pool gracefully', async () => {
      // Should not throw
      await manager.shutdownPool('non-existent', true);
    });

    it('should shutdown all pools', async () => {
      manager.getPool('all-1');
      manager.getPool('all-2');
      manager.getPool('all-3');

      expect(manager.poolCount).toBe(3);

      await manager.shutdownAll(true);

      expect(manager.poolCount).toBe(0);
    });

    it('should handle multiple shutdown calls gracefully', async () => {
      manager.getPool('multi-shutdown');

      // Multiple shutdown calls should not throw
      await manager.shutdownAll(true);
      await manager.shutdownAll(true);

      expect(manager.poolCount).toBe(0);
    });
  });

  describe('Task Execution', () => {
    it('should throw for non-existent pool', async () => {
      await expect(
        manager.executeTask('non-existent', 'someMethod', [])
      ).rejects.toThrow("Pool 'non-existent' not found");
    });

    it('should execute inline function task', async () => {
      manager.getPool('inline-task', { defaultTimeout: 5000 });

      const result = await manager.executeTask<number>(
        'inline-task',
        (a: number, b: number) => a + b,
        [2, 3]
      );

      // May fail due to worker limitations, but should at least try
      // In many test environments, this will fall back to main thread
      expect(typeof result).toBe('number');
    });

    it('should record task execution time', async () => {
      manager.getPool('timing-test', { defaultTimeout: 5000 });

      try {
        await manager.executeTask<number>(
          'timing-test',
          (x: number) => x * 2,
          [5]
        );
      } catch {
        // May fail in test environment
      }

      const stats = manager.getPoolStats('timing-test');
      // Should have recorded at least one task attempt
      expect(stats?.totalTasksExecuted).toBe(1);
    });
  });

  describe('hasPool', () => {
    it('should return true for existing pool', () => {
      manager.getPool('exists');

      expect(manager.hasPool('exists')).toBe(true);
    });

    it('should return false for non-existent pool', () => {
      expect(manager.hasPool('does-not-exist')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty pool ID', () => {
      const pool = manager.getPool('');

      expect(pool).toBeDefined();
      expect(manager.hasPool('')).toBe(true);
    });

    it('should handle special characters in pool ID', () => {
      const pool = manager.getPool('pool-with/special:chars!');

      expect(pool).toBeDefined();
      expect(manager.hasPool('pool-with/special:chars!')).toBe(true);
    });

    it('should preserve pool after failed task execution', async () => {
      manager.getPool('preserve-test', { defaultTimeout: 100 });

      try {
        // This will likely timeout
        await manager.executeTask<void>(
          'preserve-test',
          () => {
            // Infinite loop that would timeout
            while (true) {
              // Keep spinning
            }
          },
          [],
          100
        );
      } catch {
        // Expected to fail
      }

      // Pool should still exist after failed task
      expect(manager.hasPool('preserve-test')).toBe(true);
    });
  });
});
