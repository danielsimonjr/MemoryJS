/** Unified worker pool management for parallelizable operations. */

import workerpool from '@danielsimonjr/workerpool';
import type { Pool, PoolStats } from '@danielsimonjr/workerpool';

export interface WorkerPoolConfig {
  maxWorkers?: number;
  workerType?: 'thread' | 'process';
  workerPath?: string;
  minParallelSize?: number;
  defaultTimeout?: number;
}

export interface ExtendedPoolStats extends PoolStats {
  poolId: string;
  createdAt: number;
  totalTasksExecuted: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
}

export type PoolEventCallback = (poolId: string, event: 'created' | 'shutdown' | 'error', data?: unknown) => void;

interface PoolEntry {
  pool: Pool;
  config: WorkerPoolConfig;
  createdAt: number;
  totalTasksExecuted: number;
  totalExecutionTime: number;
}

const DEFAULT_CONFIG: Required<WorkerPoolConfig> = {
  maxWorkers: Math.max(1, workerpool.cpus - 1),
  workerType: 'thread',
  workerPath: '',
  minParallelSize: 200,
  defaultTimeout: 30000,
};

/** Centralized management of named worker pools with lifecycle and statistics tracking. */
export class WorkerPoolManager {
  private static instance: WorkerPoolManager | null = null;

  private pools: Map<string, PoolEntry> = new Map();
  private eventCallbacks: PoolEventCallback[] = [];
  private isShuttingDown = false;
  private shutdownRegistered = false;

  private constructor() {
    this.registerShutdownHandlers();
  }

  /** Get the singleton instance. */
  static getInstance(): WorkerPoolManager {
    if (!WorkerPoolManager.instance) {
      WorkerPoolManager.instance = new WorkerPoolManager();
    }
    return WorkerPoolManager.instance;
  }

  /** Reset the singleton instance (for testing). */
  static resetInstance(): void {
    if (WorkerPoolManager.instance) {
      WorkerPoolManager.instance.shutdownAll().catch(() => {
        // Ignore errors during reset
      });
      WorkerPoolManager.instance = null;
    }
  }

  /** Register process exit handlers for cleanup. */
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

  /** Get or create a named worker pool. */
  getPool(poolId: string, config: WorkerPoolConfig = {}): Pool {
    const existing = this.pools.get(poolId);
    if (existing) {
      return existing.pool;
    }

    return this.createPool(poolId, config);
  }

  /** Create a new worker pool. Throws if poolId already exists. */
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

  /** Check if a pool exists. */
  hasPool(poolId: string): boolean {
    return this.pools.has(poolId);
  }

  /** Get pool configuration. */
  getPoolConfig(poolId: string): WorkerPoolConfig | undefined {
    const entry = this.pools.get(poolId);
    return entry ? { ...entry.config } : undefined;
  }

  /** Get extended statistics for a pool. */
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

  /** Get statistics for all pools. */
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

  /** Record task execution for statistics tracking. */
  recordTaskExecution(poolId: string, executionTimeMs: number): void {
    const entry = this.pools.get(poolId);
    if (entry) {
      entry.totalTasksExecuted++;
      entry.totalExecutionTime += executionTimeMs;
    }
  }

  /** Execute a task with automatic statistics tracking. */
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
      const message = error instanceof Error ? error.message : 'Worker task failed';
      throw new Error(message);
    }
  }

  /** Shutdown a specific pool. */
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

  /** Shutdown all pools. */
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

  /** Synchronous shutdown for process exit handlers. */
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

  /** Register an event callback. Returns unsubscribe function. */
  onEvent(callback: PoolEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /** Emit an event to all registered callbacks. */
  private emitEvent(poolId: string, event: 'created' | 'shutdown' | 'error', data?: unknown): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(poolId, event, data);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /** Get the number of active pools. */
  get poolCount(): number {
    return this.pools.size;
  }

  /** Get all pool IDs. */
  getPoolIds(): string[] {
    return Array.from(this.pools.keys());
  }

  /** Check if data size meets minimum parallel threshold. */
  shouldUseParallel(poolId: string, size: number): boolean {
    const entry = this.pools.get(poolId);
    const minSize = entry?.config.minParallelSize ?? DEFAULT_CONFIG.minParallelSize;
    return size >= minSize;
  }

  /** Get the default configuration values. */
  static getDefaultConfig(): Required<WorkerPoolConfig> {
    return { ...DEFAULT_CONFIG };
  }

  /** Get the CPU count available for workers. */
  static getCpuCount(): number {
    return workerpool.cpus;
  }
}

/** Convenience function to get the WorkerPoolManager singleton. */
export function getWorkerPoolManager(): WorkerPoolManager {
  return WorkerPoolManager.getInstance();
}
