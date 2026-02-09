/**
 * Worker Pool Manager
 *
 * Phase 12 Sprint 2: Unified worker pool management for all parallelizable operations.
 * Provides centralized lifecycle management, configuration, and statistics.
 *
 * @module utils/WorkerPoolManager
 */

import workerpool from '@danielsimonjr/workerpool';
import type { Pool, PoolStats } from '@danielsimonjr/workerpool';

/**
 * Configuration options for worker pools.
 */
export interface WorkerPoolConfig {
  /** Maximum number of worker threads (default: CPU count - 1) */
  maxWorkers?: number;
  /** Worker type: 'thread' or 'process' (default: 'thread') */
  workerType?: 'thread' | 'process';
  /** Optional path to worker script file */
  workerPath?: string;
  /** Minimum array size to use parallel processing (default: 200) */
  minParallelSize?: number;
  /** Default task timeout in milliseconds (default: 30000) */
  defaultTimeout?: number;
}

/**
 * Extended pool statistics with additional metadata.
 */
export interface ExtendedPoolStats extends PoolStats {
  /** Pool identifier */
  poolId: string;
  /** When the pool was created */
  createdAt: number;
  /** Total tasks executed since creation */
  totalTasksExecuted: number;
  /** Total execution time in milliseconds */
  totalExecutionTime: number;
  /** Average task execution time in milliseconds */
  averageExecutionTime: number;
}

/**
 * Callback for pool events.
 */
export type PoolEventCallback = (poolId: string, event: 'created' | 'shutdown' | 'error', data?: unknown) => void;

/**
 * Internal pool entry with metadata.
 */
interface PoolEntry {
  pool: Pool;
  config: WorkerPoolConfig;
  createdAt: number;
  totalTasksExecuted: number;
  totalExecutionTime: number;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<WorkerPoolConfig> = {
  maxWorkers: Math.max(1, workerpool.cpus - 1),
  workerType: 'thread',
  workerPath: '',
  minParallelSize: 200,
  defaultTimeout: 30000,
};

/**
 * WorkerPoolManager - Unified worker pool management
 *
 * Provides centralized management of worker pools for parallel processing.
 * Features:
 * - Named pool registration with automatic lifecycle management
 * - Pool cleanup on process exit
 * - Statistics tracking per pool
 * - Event callbacks for monitoring
 *
 * @example
 * ```typescript
 * const manager = WorkerPoolManager.getInstance();
 *
 * // Get or create a pool
 * const pool = manager.getPool('fuzzySearch', {
 *   maxWorkers: 4,
 *   workerPath: '/path/to/worker.js'
 * });
 *
 * // Execute task
 * const result = await pool.exec('searchEntities', [data]);
 *
 * // Get statistics
 * const stats = manager.getPoolStats('fuzzySearch');
 *
 * // Shutdown all pools on exit
 * await manager.shutdownAll();
 * ```
 */
export class WorkerPoolManager {
  private static instance: WorkerPoolManager | null = null;

  private pools: Map<string, PoolEntry> = new Map();
  private eventCallbacks: PoolEventCallback[] = [];
  private isShuttingDown = false;
  private shutdownRegistered = false;

  /**
   * Private constructor for singleton pattern.
   */
  private constructor() {
    this.registerShutdownHandlers();
  }

  /**
   * Get the singleton instance of WorkerPoolManager.
   *
   * @returns The WorkerPoolManager instance
   */
  static getInstance(): WorkerPoolManager {
    if (!WorkerPoolManager.instance) {
      WorkerPoolManager.instance = new WorkerPoolManager();
    }
    return WorkerPoolManager.instance;
  }

  /**
   * Reset the singleton instance (primarily for testing).
   */
  static resetInstance(): void {
    if (WorkerPoolManager.instance) {
      WorkerPoolManager.instance.shutdownAll().catch(() => {
        // Ignore errors during reset
      });
      WorkerPoolManager.instance = null;
    }
  }

  /**
   * Register process exit handlers for cleanup.
   */
  private registerShutdownHandlers(): void {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    const shutdownHandler = () => {
      if (!this.isShuttingDown) {
        this.shutdownAllSync();
      }
    };

    // Register for various exit signals
    process.on('exit', shutdownHandler);
    process.on('SIGINT', () => {
      this.shutdownAll().then(() => process.exit(0)).catch(() => process.exit(1));
    });
    process.on('SIGTERM', () => {
      this.shutdownAll().then(() => process.exit(0)).catch(() => process.exit(1));
    });
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err.message);
      this.shutdownAllSync();
      process.exit(1);
    });
  }

  /**
   * Get or create a named worker pool.
   *
   * If a pool with the given ID exists, returns the existing pool.
   * Otherwise, creates a new pool with the provided configuration.
   *
   * @param poolId - Unique identifier for the pool
   * @param config - Pool configuration options
   * @returns The worker pool instance
   */
  getPool(poolId: string, config: WorkerPoolConfig = {}): Pool {
    const existing = this.pools.get(poolId);
    if (existing) {
      return existing.pool;
    }

    return this.createPool(poolId, config);
  }

  /**
   * Create a new worker pool with the given ID.
   *
   * @param poolId - Unique identifier for the pool
   * @param config - Pool configuration options
   * @returns The newly created worker pool
   * @throws Error if a pool with the same ID already exists
   */
  createPool(poolId: string, config: WorkerPoolConfig = {}): Pool {
    if (this.pools.has(poolId)) {
      throw new Error(`Pool with ID '${poolId}' already exists`);
    }

    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    // Create pool options with inline type definition
    // Using inline type since WorkerPoolOptions is not directly exported
    const poolOptions: {
      maxWorkers?: number;
      workerType?: 'auto' | 'web' | 'process' | 'thread';
      workerThreadOpts?: Record<string, unknown>;
    } = {
      maxWorkers: mergedConfig.maxWorkers,
      workerType: mergedConfig.workerType,
    };

    // Add worker thread options for ESM support
    if (mergedConfig.workerType === 'thread') {
      poolOptions.workerThreadOpts = { type: 'module' };
    }

    // Create pool with or without worker script
    let pool: Pool;
    if (mergedConfig.workerPath) {
      pool = workerpool.pool(mergedConfig.workerPath, poolOptions);
    } else {
      pool = workerpool.pool(poolOptions);
    }

    const entry: PoolEntry = {
      pool,
      config: mergedConfig,
      createdAt: Date.now(),
      totalTasksExecuted: 0,
      totalExecutionTime: 0,
    };

    this.pools.set(poolId, entry);
    this.emitEvent(poolId, 'created');

    return pool;
  }

  /**
   * Check if a pool with the given ID exists.
   *
   * @param poolId - Pool identifier to check
   * @returns True if pool exists
   */
  hasPool(poolId: string): boolean {
    return this.pools.has(poolId);
  }

  /**
   * Get the configuration for a pool.
   *
   * @param poolId - Pool identifier
   * @returns Pool configuration or undefined if not found
   */
  getPoolConfig(poolId: string): WorkerPoolConfig | undefined {
    const entry = this.pools.get(poolId);
    return entry ? { ...entry.config } : undefined;
  }

  /**
   * Get extended statistics for a pool.
   *
   * @param poolId - Pool identifier
   * @returns Extended pool statistics or undefined if not found
   */
  getPoolStats(poolId: string): ExtendedPoolStats | undefined {
    const entry = this.pools.get(poolId);
    if (!entry) return undefined;

    const baseStats = entry.pool.stats();
    return {
      ...baseStats,
      poolId,
      createdAt: entry.createdAt,
      totalTasksExecuted: entry.totalTasksExecuted,
      totalExecutionTime: entry.totalExecutionTime,
      averageExecutionTime:
        entry.totalTasksExecuted > 0
          ? entry.totalExecutionTime / entry.totalTasksExecuted
          : 0,
    };
  }

  /**
   * Get statistics for all pools.
   *
   * @returns Map of pool IDs to their statistics
   */
  getAllPoolStats(): Map<string, ExtendedPoolStats> {
    const stats = new Map<string, ExtendedPoolStats>();
    for (const poolId of this.pools.keys()) {
      const poolStats = this.getPoolStats(poolId);
      if (poolStats) {
        stats.set(poolId, poolStats);
      }
    }
    return stats;
  }

  /**
   * Record task execution for statistics tracking.
   *
   * @param poolId - Pool identifier
   * @param executionTimeMs - Task execution time in milliseconds
   */
  recordTaskExecution(poolId: string, executionTimeMs: number): void {
    const entry = this.pools.get(poolId);
    if (entry) {
      entry.totalTasksExecuted++;
      entry.totalExecutionTime += executionTimeMs;
    }
  }

  /**
   * Execute a task on a pool with automatic statistics tracking.
   *
   * @template T - Result type
   * @param poolId - Pool identifier
   * @param method - Method name to execute (for worker script pools) or inline function
   * @param args - Arguments to pass to the method/function
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise resolving to the task result
   */
  async executeTask<T>(
    poolId: string,
    method: string | ((...args: unknown[]) => T),
    args: unknown[] = [],
    timeout?: number
  ): Promise<T> {
    const entry = this.pools.get(poolId);
    if (!entry) {
      throw new Error(`Pool '${poolId}' not found`);
    }

    const effectiveTimeout = timeout ?? entry.config.defaultTimeout ?? DEFAULT_CONFIG.defaultTimeout;
    const startTime = Date.now();

    try {
      let result: T;
      if (typeof method === 'string') {
        // Execute named method from worker script
        result = await entry.pool.exec(method, args).timeout(effectiveTimeout) as T;
      } else {
        // Execute inline function
        result = await entry.pool.exec(method, args).timeout(effectiveTimeout) as T;
      }

      const executionTime = Date.now() - startTime;
      this.recordTaskExecution(poolId, executionTime);

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.recordTaskExecution(poolId, executionTime);
      throw error;
    }
  }

  /**
   * Shutdown a specific pool.
   *
   * @param poolId - Pool identifier
   * @param force - If true, forcefully terminate workers (default: false)
   * @returns Promise resolving when shutdown is complete
   */
  async shutdownPool(poolId: string, force = false): Promise<void> {
    const entry = this.pools.get(poolId);
    if (!entry) return;

    try {
      await entry.pool.terminate(force);
      this.emitEvent(poolId, 'shutdown');
    } catch (error) {
      this.emitEvent(poolId, 'error', error);
      throw error;
    } finally {
      this.pools.delete(poolId);
    }
  }

  /**
   * Shutdown all pools asynchronously.
   *
   * @param force - If true, forcefully terminate workers (default: false)
   * @returns Promise resolving when all pools are shut down
   */
  async shutdownAll(force = false): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    const shutdownPromises: Promise<void>[] = [];
    for (const poolId of this.pools.keys()) {
      shutdownPromises.push(this.shutdownPool(poolId, force));
    }

    try {
      await Promise.allSettled(shutdownPromises);
    } finally {
      this.pools.clear();
      this.isShuttingDown = false;
    }
  }

  /**
   * Synchronous shutdown for process exit handlers.
   * Forces immediate termination of all pools.
   */
  private shutdownAllSync(): void {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    for (const [poolId, entry] of this.pools) {
      try {
        entry.pool.terminate(true);
        this.emitEvent(poolId, 'shutdown');
      } catch {
        // Ignore errors during sync shutdown
      }
    }

    this.pools.clear();
    this.isShuttingDown = false;
  }

  /**
   * Register an event callback for pool events.
   *
   * @param callback - Callback function to invoke on events
   * @returns Unsubscribe function
   */
  onEvent(callback: PoolEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all registered callbacks.
   */
  private emitEvent(poolId: string, event: 'created' | 'shutdown' | 'error', data?: unknown): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(poolId, event, data);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Get the number of active pools.
   *
   * @returns Number of pools currently managed
   */
  get poolCount(): number {
    return this.pools.size;
  }

  /**
   * Get all pool IDs.
   *
   * @returns Array of pool identifiers
   */
  getPoolIds(): string[] {
    return Array.from(this.pools.keys());
  }

  /**
   * Check if the minimum parallel size threshold is met.
   *
   * @param poolId - Pool identifier
   * @param size - Size of the data to process
   * @returns True if size meets or exceeds minimum threshold
   */
  shouldUseParallel(poolId: string, size: number): boolean {
    const entry = this.pools.get(poolId);
    const minSize = entry?.config.minParallelSize ?? DEFAULT_CONFIG.minParallelSize;
    return size >= minSize;
  }

  /**
   * Get the default configuration values.
   *
   * @returns Copy of default configuration
   */
  static getDefaultConfig(): Required<WorkerPoolConfig> {
    return { ...DEFAULT_CONFIG };
  }

  /**
   * Get the CPU count available for workers.
   *
   * @returns Number of CPUs
   */
  static getCpuCount(): number {
    return workerpool.cpus;
  }
}

/**
 * Convenience function to get the WorkerPoolManager instance.
 *
 * @returns The WorkerPoolManager singleton
 */
export function getWorkerPoolManager(): WorkerPoolManager {
  return WorkerPoolManager.getInstance();
}
