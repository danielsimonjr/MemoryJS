/**
 * Batch Processor
 *
 * Phase 12 Sprint 2: Generic batch processing utility with parallel execution,
 * retry logic, progress callbacks, and error collection.
 *
 * @module utils/BatchProcessor
 */

/**
 * Progress information for batch processing.
 */
export interface BatchProgress {
  /** Number of items completed (successfully or failed) */
  completed: number;
  /** Total number of items to process */
  total: number;
  /** Completion percentage (0-100) */
  percentage: number;
  /** Number of successful items */
  succeeded: number;
  /** Number of failed items */
  failed: number;
  /** Current item being processed (if applicable) */
  currentItem?: unknown;
  /** Current batch index */
  batchIndex: number;
  /** Total number of batches */
  totalBatches: number;
}

/**
 * Progress callback function type.
 */
export type BatchProgressCallback = (progress: BatchProgress) => void;

/**
 * Result for a single item in the batch.
 */
export interface BatchItemResult<T> {
  /** Index of the item in the original array */
  index: number;
  /** Whether the processing succeeded */
  success: boolean;
  /** Result value if successful */
  result?: T;
  /** Error if failed */
  error?: Error;
  /** Number of attempts made */
  attempts: number;
  /** Processing time in milliseconds */
  durationMs: number;
}

/**
 * Overall result of batch processing.
 */
export interface BatchProcessResult<T> {
  /** Results for each item */
  results: BatchItemResult<T>[];
  /** Number of successful items */
  succeeded: number;
  /** Number of failed items */
  failed: number;
  /** Total processing time in milliseconds */
  totalTimeMs: number;
  /** Whether all items succeeded */
  allSucceeded: boolean;
  /** Errors encountered (indexed by item position) */
  errors: Map<number, Error>;
}

/**
 * Options for batch processing.
 */
export interface BatchProcessorOptions {
  /** Number of items to process concurrently (default: 4) */
  concurrency?: number;
  /** Size of each batch for progress reporting (default: equals concurrency) */
  batchSize?: number;
  /** Maximum retry attempts per item (default: 0 - no retries) */
  maxRetries?: number;
  /** Initial delay between retries in milliseconds (default: 1000) */
  retryDelayMs?: number;
  /** Exponential backoff multiplier (default: 2) */
  retryBackoffMultiplier?: number;
  /** Maximum retry delay in milliseconds (default: 30000) */
  maxRetryDelayMs?: number;
  /** Whether to continue processing on item failure (default: true) */
  continueOnError?: boolean;
  /** Progress callback function */
  onProgress?: BatchProgressCallback;
  /** Timeout per item in milliseconds (default: no timeout) */
  itemTimeoutMs?: number;
  /** Optional abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Default options for batch processing.
 */
const DEFAULT_OPTIONS: Required<Omit<BatchProcessorOptions, 'onProgress' | 'signal'>> = {
  concurrency: 4,
  batchSize: 4,
  maxRetries: 0,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 2,
  maxRetryDelayMs: 30000,
  continueOnError: true,
  itemTimeoutMs: 0,
};

/**
 * BatchProcessor - Generic batch processing with parallel execution
 *
 * Provides a flexible utility for processing arrays of items with:
 * - Configurable concurrency
 * - Automatic retry with exponential backoff
 * - Progress callbacks for monitoring
 * - Error collection without failing the entire batch
 * - Cancellation support via AbortSignal
 *
 * @example
 * ```typescript
 * const processor = new BatchProcessor<string, number>({
 *   concurrency: 4,
 *   maxRetries: 3,
 *   onProgress: (p) => console.log(`${p.percentage.toFixed(1)}% complete`),
 * });
 *
 * const result = await processor.process(
 *   ['item1', 'item2', 'item3'],
 *   async (item) => {
 *     const response = await fetchData(item);
 *     return response.value;
 *   }
 * );
 *
 * console.log(`Succeeded: ${result.succeeded}, Failed: ${result.failed}`);
 * ```
 */
export class BatchProcessor<TInput, TOutput> {
  private options: Required<Omit<BatchProcessorOptions, 'onProgress' | 'signal'>> & {
    onProgress?: BatchProgressCallback;
    signal?: AbortSignal;
  };

  constructor(options: BatchProcessorOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      batchSize: options.batchSize ?? options.concurrency ?? DEFAULT_OPTIONS.concurrency,
    };
  }

  /**
   * Process all items in batches with the specified processor function.
   *
   * @param items - Array of items to process
   * @param processor - Async function to process each item
   * @returns Batch processing result with all item results and statistics
   */
  async process(
    items: TInput[],
    processor: (item: TInput, index: number) => Promise<TOutput>
  ): Promise<BatchProcessResult<TOutput>> {
    const startTime = Date.now();
    const results: BatchItemResult<TOutput>[] = new Array(items.length);
    const errors = new Map<number, Error>();
    let succeeded = 0;
    let failed = 0;

    const totalBatches = Math.ceil(items.length / this.options.batchSize);

    // Process items in batches
    for (let batchIndex = 0; batchIndex < items.length; batchIndex += this.options.batchSize) {
      // Check for cancellation
      if (this.options.signal?.aborted) {
        throw new Error('Batch processing cancelled');
      }

      const batchItems = items.slice(batchIndex, batchIndex + this.options.batchSize);
      const batchStartIndex = batchIndex;
      const currentBatchIndex = Math.floor(batchIndex / this.options.batchSize);

      // Process batch concurrently
      const batchPromises = batchItems.map((item, localIndex) =>
        this.processItem(item, batchStartIndex + localIndex, processor)
      );

      const batchResults = await Promise.all(batchPromises);

      // Collect results
      for (let i = 0; i < batchResults.length; i++) {
        const itemResult = batchResults[i];
        const globalIndex = batchStartIndex + i;
        results[globalIndex] = itemResult;

        if (itemResult.success) {
          succeeded++;
        } else {
          failed++;
          if (itemResult.error) {
            errors.set(globalIndex, itemResult.error);
          }

          // Stop if continueOnError is false
          if (!this.options.continueOnError) {
            return {
              results,
              succeeded,
              failed,
              totalTimeMs: Date.now() - startTime,
              allSucceeded: false,
              errors,
            };
          }
        }
      }

      // Report progress
      if (this.options.onProgress) {
        const completed = Math.min(batchIndex + batchItems.length, items.length);
        this.options.onProgress({
          completed,
          total: items.length,
          percentage: (completed / items.length) * 100,
          succeeded,
          failed,
          batchIndex: currentBatchIndex,
          totalBatches,
        });
      }
    }

    return {
      results,
      succeeded,
      failed,
      totalTimeMs: Date.now() - startTime,
      allSucceeded: failed === 0,
      errors,
    };
  }

  /**
   * Process a single item with retry logic.
   */
  private async processItem(
    item: TInput,
    index: number,
    processor: (item: TInput, index: number) => Promise<TOutput>
  ): Promise<BatchItemResult<TOutput>> {
    const startTime = Date.now();
    let lastError: Error | undefined;
    let attempts = 0;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      attempts = attempt + 1;

      // Check for cancellation before each attempt
      if (this.options.signal?.aborted) {
        return {
          index,
          success: false,
          error: new Error('Processing cancelled'),
          attempts,
          durationMs: Date.now() - startTime,
        };
      }

      try {
        let result: TOutput;

        if (this.options.itemTimeoutMs > 0) {
          // Process with timeout
          result = await Promise.race([
            processor(item, index),
            this.createTimeout<TOutput>(this.options.itemTimeoutMs),
          ]);
        } else {
          result = await processor(item, index);
        }

        return {
          index,
          success: true,
          result,
          attempts,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on last attempt
        if (attempt < this.options.maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          await this.sleep(delay);
        }
      }
    }

    return {
      index,
      success: false,
      error: lastError,
      attempts,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Calculate delay for retry with exponential backoff.
   */
  private calculateRetryDelay(attempt: number): number {
    const delay = this.options.retryDelayMs * Math.pow(this.options.retryBackoffMultiplier, attempt);
    return Math.min(delay, this.options.maxRetryDelayMs);
  }

  /**
   * Create a timeout promise.
   */
  private createTimeout<T>(ms: number): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Item processing timeout')), ms);
    });
  }

  /**
   * Sleep for the specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the configured options.
   */
  getOptions(): BatchProcessorOptions {
    return { ...this.options };
  }
}

/**
 * Process items in parallel batches (convenience function).
 *
 * @template TInput - Input item type
 * @template TOutput - Output result type
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param options - Batch processing options
 * @returns Batch processing result
 *
 * @example
 * ```typescript
 * const result = await processBatch(
 *   urls,
 *   async (url) => fetch(url).then(r => r.json()),
 *   { concurrency: 5, maxRetries: 2 }
 * );
 * ```
 */
export async function processBatch<TInput, TOutput>(
  items: TInput[],
  processor: (item: TInput, index: number) => Promise<TOutput>,
  options: BatchProcessorOptions = {}
): Promise<BatchProcessResult<TOutput>> {
  const batchProcessor = new BatchProcessor<TInput, TOutput>(options);
  return batchProcessor.process(items, processor);
}

/**
 * Process items with automatic retry on failure (convenience function).
 *
 * @template TInput - Input item type
 * @template TOutput - Output result type
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @param onProgress - Optional progress callback
 * @returns Batch processing result
 *
 * @example
 * ```typescript
 * const result = await processWithRetry(
 *   items,
 *   async (item) => unreliableOperation(item),
 *   3,
 *   (p) => console.log(`${p.percentage}%`)
 * );
 * ```
 */
export async function processWithRetry<TInput, TOutput>(
  items: TInput[],
  processor: (item: TInput, index: number) => Promise<TOutput>,
  maxRetries = 3,
  onProgress?: BatchProgressCallback
): Promise<BatchProcessResult<TOutput>> {
  return processBatch(items, processor, { maxRetries, onProgress });
}

/**
 * Chunk an array into smaller arrays of specified size.
 *
 * @template T - Item type
 * @param array - Array to chunk
 * @param size - Size of each chunk
 * @returns Array of chunks
 *
 * @example
 * ```typescript
 * const chunks = chunkArray([1, 2, 3, 4, 5], 2);
 * // [[1, 2], [3, 4], [5]]
 * ```
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than 0');
  }

  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Execute async functions in parallel with a concurrency limit.
 *
 * @template T - Result type
 * @param tasks - Array of async functions to execute
 * @param concurrency - Maximum concurrent executions
 * @returns Array of results (successful results or errors)
 *
 * @example
 * ```typescript
 * const tasks = urls.map(url => () => fetch(url));
 * const results = await parallelLimit(tasks, 5);
 * ```
 */
export async function parallelLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<Array<{ success: true; value: T } | { success: false; error: Error }>> {
  const results: Array<{ success: true; value: T } | { success: false; error: Error }> = [];

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async task => {
        try {
          const value = await task();
          return { success: true as const, value };
        } catch (error) {
          return {
            success: false as const,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      })
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Map over items in parallel with a concurrency limit.
 *
 * @template TInput - Input item type
 * @template TOutput - Output result type
 * @param items - Array of items to map
 * @param mapper - Async mapping function
 * @param concurrency - Maximum concurrent operations (default: 4)
 * @returns Array of results (in order)
 *
 * @example
 * ```typescript
 * const results = await mapParallel(
 *   ids,
 *   async (id) => fetchUser(id),
 *   10
 * );
 * ```
 */
export async function mapParallel<TInput, TOutput>(
  items: TInput[],
  mapper: (item: TInput, index: number) => Promise<TOutput>,
  concurrency = 4
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(items.length);

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const startIndex = i;

    const batchResults = await Promise.all(
      batch.map((item, localIndex) => mapper(item, startIndex + localIndex))
    );

    for (let j = 0; j < batchResults.length; j++) {
      results[startIndex + j] = batchResults[j];
    }
  }

  return results;
}

/**
 * Filter items in parallel with a concurrency limit.
 *
 * @template T - Item type
 * @param items - Array of items to filter
 * @param predicate - Async predicate function
 * @param concurrency - Maximum concurrent operations (default: 4)
 * @returns Filtered array (in order)
 *
 * @example
 * ```typescript
 * const validItems = await filterParallel(
 *   items,
 *   async (item) => validateItem(item),
 *   10
 * );
 * ```
 */
export async function filterParallel<T>(
  items: T[],
  predicate: (item: T, index: number) => Promise<boolean>,
  concurrency = 4
): Promise<T[]> {
  const includeFlags = await mapParallel(items, predicate, concurrency);
  return items.filter((_, index) => includeFlags[index]);
}
