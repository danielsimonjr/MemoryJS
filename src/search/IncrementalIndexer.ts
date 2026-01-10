/**
 * Incremental Indexer
 *
 * Phase 12 Sprint 5: Queues embedding index updates and batch-processes them
 * efficiently using flush thresholds and timer-based flushing.
 *
 * @module search/IncrementalIndexer
 */

import type { EmbeddingService, EmbeddingMode } from '../types/index.js';
import type { IVectorStore } from '../types/index.js';
import type { EmbeddingProgressCallback } from './EmbeddingService.js';

/**
 * Types of index operations.
 */
export type IndexOperationType = 'create' | 'update' | 'delete';

/**
 * Queued index operation.
 */
export interface IndexOperation {
  /** Type of operation */
  type: IndexOperationType;
  /** Entity name */
  entityName: string;
  /** Text to embed (for create/update) */
  text?: string;
  /** Timestamp when operation was queued */
  queuedAt: number;
}

/**
 * Options for IncrementalIndexer.
 */
export interface IncrementalIndexerOptions {
  /** Flush threshold - number of operations to queue before auto-flush (default: 50) */
  flushThreshold?: number;
  /** Timer-based flush interval in milliseconds (default: 5000ms) */
  flushIntervalMs?: number;
  /** Embedding mode for new embeddings (default: 'document') */
  embeddingMode?: EmbeddingMode;
  /** Progress callback for batch operations */
  onProgress?: EmbeddingProgressCallback;
}

/**
 * Default indexer options.
 */
export const DEFAULT_INDEXER_OPTIONS: Required<Omit<IncrementalIndexerOptions, 'onProgress'>> = {
  flushThreshold: 50,
  flushIntervalMs: 5000,
  embeddingMode: 'document',
};

/**
 * Result of a flush operation.
 */
export interface FlushResult {
  /** Number of operations processed */
  processed: number;
  /** Number of successful operations */
  succeeded: number;
  /** Number of failed operations */
  failed: number;
  /** Errors encountered during flush */
  errors: Array<{ entityName: string; error: string }>;
  /** Duration of flush in milliseconds */
  durationMs: number;
}

/**
 * Incremental indexer for embedding vectors.
 *
 * Queues index updates and batch-processes them efficiently:
 * - Auto-flush when queue reaches threshold
 * - Timer-based flush for time-sensitive updates
 * - Supports create, update, and delete operations
 * - Graceful shutdown with final flush
 *
 * @example
 * ```typescript
 * const indexer = new IncrementalIndexer(embeddingService, vectorStore, {
 *   flushThreshold: 100,
 *   flushIntervalMs: 10000,
 * });
 *
 * // Queue operations
 * indexer.queueCreate('entity1', 'Entity text content');
 * indexer.queueUpdate('entity2', 'Updated text content');
 * indexer.queueDelete('entity3');
 *
 * // Manual flush
 * const result = await indexer.flush();
 * console.log(`Processed ${result.processed} operations`);
 *
 * // Graceful shutdown
 * await indexer.shutdown();
 * ```
 */
export class IncrementalIndexer {
  private embeddingService: EmbeddingService;
  private vectorStore: IVectorStore;
  private options: Required<Omit<IncrementalIndexerOptions, 'onProgress'>>;
  private onProgress?: EmbeddingProgressCallback;

  private queue: IndexOperation[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private isShutdown = false;

  /**
   * Create a new incremental indexer.
   *
   * @param embeddingService - Service for generating embeddings
   * @param vectorStore - Store for embedding vectors
   * @param options - Indexer configuration options
   */
  constructor(
    embeddingService: EmbeddingService,
    vectorStore: IVectorStore,
    options?: IncrementalIndexerOptions
  ) {
    this.embeddingService = embeddingService;
    this.vectorStore = vectorStore;
    this.options = { ...DEFAULT_INDEXER_OPTIONS, ...options };
    this.onProgress = options?.onProgress;

    // Start the flush timer
    this.startFlushTimer();
  }

  /**
   * Start the timer-based flush interval.
   */
  private startFlushTimer(): void {
    if (this.flushTimer || this.isShutdown) {
      return;
    }

    this.flushTimer = setInterval(async () => {
      if (this.queue.length > 0 && !this.isFlushing) {
        await this.flush();
      }
    }, this.options.flushIntervalMs);
  }

  /**
   * Stop the flush timer.
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Queue a create operation.
   *
   * @param entityName - Name of the entity to create
   * @param text - Text content to embed
   */
  queueCreate(entityName: string, text: string): void {
    if (this.isShutdown) {
      throw new Error('Indexer is shutdown');
    }

    // Remove any existing operations for this entity
    this.removeFromQueue(entityName);

    this.queue.push({
      type: 'create',
      entityName,
      text,
      queuedAt: Date.now(),
    });

    this.checkAutoFlush();
  }

  /**
   * Queue an update operation.
   *
   * @param entityName - Name of the entity to update
   * @param text - Updated text content to embed
   */
  queueUpdate(entityName: string, text: string): void {
    if (this.isShutdown) {
      throw new Error('Indexer is shutdown');
    }

    // Remove any existing operations for this entity
    this.removeFromQueue(entityName);

    this.queue.push({
      type: 'update',
      entityName,
      text,
      queuedAt: Date.now(),
    });

    this.checkAutoFlush();
  }

  /**
   * Queue a delete operation.
   *
   * @param entityName - Name of the entity to delete
   */
  queueDelete(entityName: string): void {
    if (this.isShutdown) {
      throw new Error('Indexer is shutdown');
    }

    // Remove any existing operations for this entity
    this.removeFromQueue(entityName);

    this.queue.push({
      type: 'delete',
      entityName,
      queuedAt: Date.now(),
    });

    this.checkAutoFlush();
  }

  /**
   * Remove all queued operations for an entity.
   *
   * @param entityName - Entity name to remove from queue
   */
  private removeFromQueue(entityName: string): void {
    this.queue = this.queue.filter(op => op.entityName !== entityName);
  }

  /**
   * Check if auto-flush threshold is reached.
   */
  private checkAutoFlush(): void {
    if (this.queue.length >= this.options.flushThreshold && !this.isFlushing) {
      // Use setImmediate to avoid blocking
      setImmediate(() => this.flush());
    }
  }

  /**
   * Flush the queue and process all pending operations.
   *
   * @returns Result of the flush operation
   */
  async flush(): Promise<FlushResult> {
    if (this.isFlushing) {
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
        durationMs: 0,
      };
    }

    this.isFlushing = true;
    const startTime = Date.now();
    const errors: Array<{ entityName: string; error: string }> = [];
    let succeeded = 0;
    let failed = 0;

    // Take the current queue
    const operations = [...this.queue];
    this.queue = [];

    try {
      // Separate operations by type
      const createOps = operations.filter(op => op.type === 'create');
      const updateOps = operations.filter(op => op.type === 'update');
      const deleteOps = operations.filter(op => op.type === 'delete');

      // Process deletes first (fast, O(1))
      for (const op of deleteOps) {
        try {
          this.vectorStore.remove(op.entityName);
          succeeded++;
        } catch (error) {
          failed++;
          errors.push({
            entityName: op.entityName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Batch process creates and updates together
      const embedOps = [...createOps, ...updateOps];
      if (embedOps.length > 0) {
        const texts = embedOps.map(op => op.text!);
        const entityNames = embedOps.map(op => op.entityName);

        try {
          // Check if the embedding service has the batch with progress method
          let embeddings: number[][];

          if (this.onProgress && 'embedBatchWithProgress' in this.embeddingService) {
            embeddings = await (this.embeddingService as { embedBatchWithProgress: (texts: string[], mode: EmbeddingMode, onProgress?: EmbeddingProgressCallback) => Promise<number[][]> })
              .embedBatchWithProgress(texts, this.options.embeddingMode, this.onProgress);
          } else {
            embeddings = await this.embeddingService.embedBatch(texts, this.options.embeddingMode);
          }

          // Store each embedding
          for (let i = 0; i < embeddings.length; i++) {
            try {
              this.vectorStore.add(entityNames[i], embeddings[i]);
              succeeded++;
            } catch (error) {
              failed++;
              errors.push({
                entityName: entityNames[i],
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        } catch (error) {
          // Batch embedding failed, count all as failed
          failed += embedOps.length;
          for (const op of embedOps) {
            errors.push({
              entityName: op.entityName,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } finally {
      this.isFlushing = false;
    }

    return {
      processed: operations.length,
      succeeded,
      failed,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Get the current queue size.
   *
   * @returns Number of operations in the queue
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get the current queue contents (for debugging/monitoring).
   *
   * @returns Copy of the current queue
   */
  getQueue(): IndexOperation[] {
    return [...this.queue];
  }

  /**
   * Check if the indexer is currently flushing.
   *
   * @returns True if flushing
   */
  isBusy(): boolean {
    return this.isFlushing;
  }

  /**
   * Check if the indexer is shutdown.
   *
   * @returns True if shutdown
   */
  isShutdownComplete(): boolean {
    return this.isShutdown;
  }

  /**
   * Graceful shutdown with final flush.
   *
   * Stops the timer and flushes any remaining operations.
   *
   * @returns Result of the final flush
   */
  async shutdown(): Promise<FlushResult> {
    this.isShutdown = true;
    this.stopFlushTimer();

    // Wait for any in-progress flush to complete
    while (this.isFlushing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Final flush
    return this.flush();
  }

  /**
   * Update indexer options.
   *
   * Note: Changes to flushIntervalMs will take effect on the next interval.
   *
   * @param options - New options to apply
   */
  updateOptions(options: Partial<IncrementalIndexerOptions>): void {
    const { onProgress, ...rest } = options;

    if (onProgress !== undefined) {
      this.onProgress = onProgress;
    }

    if (Object.keys(rest).length > 0) {
      this.options = { ...this.options, ...rest } as Required<Omit<IncrementalIndexerOptions, 'onProgress'>>;

      // Restart timer if interval changed
      if (rest.flushIntervalMs !== undefined) {
        this.stopFlushTimer();
        this.startFlushTimer();
      }
    }
  }

  /**
   * Clear the queue without processing.
   *
   * @returns Number of operations cleared
   */
  clearQueue(): number {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }
}
