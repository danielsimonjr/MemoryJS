/**
 * Embedding Service
 *
 * Phase 4 Sprint 10: Provides embedding abstractions for semantic search.
 * Phase 12 Sprint 5: Added query/document prefixes, l2Normalize, mode parameter,
 *                    and batch embedding with progress callback.
 * Supports multiple providers: OpenAI (cloud) and local (transformers.js).
 *
 * @module search/EmbeddingService
 */

import type { EmbeddingService, EmbeddingConfig, EmbeddingMode } from '../types/index.js';
import {
  EMBEDDING_DEFAULTS,
  OPENAI_API_CONFIG,
  getEmbeddingConfig,
} from '../utils/constants.js';

/**
 * Phase 12 Sprint 5: Prefixes for query-optimized embedding encoding.
 *
 * These prefixes are used to distinguish between query and document embeddings,
 * which can improve retrieval performance with asymmetric embedding models.
 */
export const QUERY_PREFIX = 'query: ';
export const DOCUMENT_PREFIX = 'passage: ';

/**
 * Phase 12 Sprint 5: Callback for batch embedding progress.
 */
export type EmbeddingProgressCallback = (progress: {
  current: number;
  total: number;
  percentage: number;
}) => void;

/**
 * Phase 12 Sprint 5: L2 normalize a vector for cosine similarity.
 *
 * Normalizes a vector to unit length (magnitude 1), which is required
 * for accurate cosine similarity calculations.
 *
 * @param vector - Input vector to normalize
 * @returns L2 normalized vector
 *
 * @example
 * ```typescript
 * const normalized = l2Normalize([3, 4]); // [0.6, 0.8]
 * ```
 */
export function l2Normalize(vector: number[]): number[] {
  let magnitude = 0;
  for (const v of vector) {
    magnitude += v * v;
  }
  magnitude = Math.sqrt(magnitude);

  if (magnitude === 0 || magnitude === 1) {
    return magnitude === 0 ? vector : vector.slice();
  }

  return vector.map(v => v / magnitude);
}

/**
 * OpenAI Embedding Service
 *
 * Uses OpenAI's text-embedding-3-small model for generating embeddings.
 * Supports single and batch embedding with rate limit handling.
 * Phase 12 Sprint 5: Added mode parameter and progress callback support.
 *
 * @example
 * ```typescript
 * const service = new OpenAIEmbeddingService('sk-...');
 * const embedding = await service.embed("Hello world", 'query');
 * console.log(`Generated ${embedding.length} dimensions`);
 * ```
 */
export class OpenAIEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  readonly provider = 'openai';
  readonly model: string;
  private apiKey: string;

  /**
   * Create an OpenAI embedding service.
   *
   * @param apiKey - OpenAI API key
   * @param model - Optional model override (default: text-embedding-3-small)
   */
  constructor(apiKey: string, model?: string) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }
    this.apiKey = apiKey;
    this.model = model || EMBEDDING_DEFAULTS.OPENAI_MODEL;
    this.dimensions = EMBEDDING_DEFAULTS.OPENAI_DIMENSIONS;
  }

  /**
   * Check if the service is ready.
   */
  async isReady(): Promise<boolean> {
    return !!this.apiKey;
  }

  /**
   * Apply prefix to text based on embedding mode.
   *
   * @param text - Original text
   * @param mode - Embedding mode ('query' or 'document')
   * @returns Text with appropriate prefix
   */
  private applyPrefix(text: string, mode: EmbeddingMode = 'document'): string {
    return mode === 'query' ? `${QUERY_PREFIX}${text}` : `${DOCUMENT_PREFIX}${text}`;
  }

  /**
   * Generate embedding for a single text.
   *
   * @param text - Text to embed
   * @param mode - Embedding mode ('query' or 'document', default: 'document')
   * @returns Embedding vector
   */
  async embed(text: string, mode: EmbeddingMode = 'document'): Promise<number[]> {
    const results = await this.embedBatch([text], mode);
    return results[0];
  }

  /**
   * Generate embeddings for multiple texts in batch.
   *
   * @param texts - Array of texts to embed
   * @param mode - Embedding mode ('query' or 'document', default: 'document')
   * @returns Array of embedding vectors
   */
  async embedBatch(texts: string[], mode: EmbeddingMode = 'document'): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Apply prefix based on mode
    const prefixedTexts = texts.map(text => this.applyPrefix(text, mode));

    // Split into batches if needed
    const maxBatchSize = EMBEDDING_DEFAULTS.OPENAI_MAX_BATCH_SIZE;
    const results: number[][] = [];

    for (let i = 0; i < prefixedTexts.length; i += maxBatchSize) {
      const batch = prefixedTexts.slice(i, i + maxBatchSize);
      const batchResults = await this.embedBatchInternal(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Generate embeddings with progress callback support.
   *
   * Phase 12 Sprint 5: Added for tracking progress on large batch operations.
   *
   * @param texts - Array of texts to embed
   * @param mode - Embedding mode ('query' or 'document', default: 'document')
   * @param onProgress - Optional progress callback
   * @returns Array of embedding vectors
   */
  async embedBatchWithProgress(
    texts: string[],
    mode: EmbeddingMode = 'document',
    onProgress?: EmbeddingProgressCallback
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Apply prefix based on mode
    const prefixedTexts = texts.map(text => this.applyPrefix(text, mode));

    // Split into batches if needed
    const maxBatchSize = EMBEDDING_DEFAULTS.OPENAI_MAX_BATCH_SIZE;
    const results: number[][] = [];
    const total = prefixedTexts.length;

    for (let i = 0; i < prefixedTexts.length; i += maxBatchSize) {
      const batch = prefixedTexts.slice(i, i + maxBatchSize);
      const batchResults = await this.embedBatchInternal(batch);
      results.push(...batchResults);

      // Report progress
      if (onProgress) {
        const current = Math.min(i + maxBatchSize, total);
        onProgress({
          current,
          total,
          percentage: Math.round((current / total) * 100),
        });
      }
    }

    return results;
  }

  /**
   * Internal batch embedding with retry logic.
   */
  private async embedBatchInternal(texts: string[]): Promise<number[][]> {
    let lastError: Error | null = null;
    let backoff = OPENAI_API_CONFIG.INITIAL_BACKOFF_MS;

    for (let attempt = 0; attempt <= OPENAI_API_CONFIG.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(
          `${OPENAI_API_CONFIG.BASE_URL}${OPENAI_API_CONFIG.EMBEDDINGS_ENDPOINT}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              model: this.model,
              input: texts,
            }),
          }
        );

        if (!response.ok) {
          const errorBody = await response.text();

          // Handle rate limiting
          if (response.status === 429) {
            if (attempt < OPENAI_API_CONFIG.MAX_RETRIES) {
              await this.sleep(backoff);
              backoff = Math.min(backoff * 2, OPENAI_API_CONFIG.MAX_BACKOFF_MS);
              continue;
            }
          }

          throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
        }

        const data = await response.json() as OpenAIEmbeddingResponse;

        // Sort by index to ensure correct order
        const sortedData = [...data.data].sort((a, b) => a.index - b.index);
        return sortedData.map(item => item.embedding);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Retry on network errors
        if (attempt < OPENAI_API_CONFIG.MAX_RETRIES && this.isRetryableError(error)) {
          await this.sleep(backoff);
          backoff = Math.min(backoff * 2, OPENAI_API_CONFIG.MAX_BACKOFF_MS);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('Failed to generate embeddings after retries');
  }

  /**
   * Check if an error is retryable.
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors and rate limits are retryable
      return error.message.includes('fetch') ||
             error.message.includes('network') ||
             error.message.includes('429');
    }
    return false;
  }

  /**
   * Sleep for a given duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * OpenAI API response type for embeddings.
 */
interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Local Embedding Service
 *
 * Uses @xenova/transformers for local embedding generation.
 * No API calls needed - runs entirely offline after initial model download.
 * Phase 12 Sprint 5: Added mode parameter and progress callback support.
 *
 * Note: Requires @xenova/transformers to be installed as an optional dependency.
 * If not available, initialization will fail gracefully.
 *
 * @example
 * ```typescript
 * const service = new LocalEmbeddingService();
 * await service.initialize();
 * const embedding = await service.embed("Hello world", 'query');
 * ```
 */
export class LocalEmbeddingService implements EmbeddingService {
  readonly dimensions: number = EMBEDDING_DEFAULTS.LOCAL_DIMENSIONS;
  readonly provider = 'local';
  readonly model: string;

  private pipeline: unknown = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Create a local embedding service.
   *
   * @param model - Optional model override (default: Xenova/all-MiniLM-L6-v2)
   */
  constructor(model?: string) {
    this.model = model || EMBEDDING_DEFAULTS.LOCAL_MODEL;
  }

  /**
   * Initialize the model pipeline.
   * Must be called before using embed/embedBatch.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initializeInternal();
    return this.initPromise;
  }

  /**
   * Internal initialization.
   */
  private async initializeInternal(): Promise<void> {
    try {
      // Dynamic import to allow optional dependency
      // @ts-expect-error - @xenova/transformers is an optional peer dependency
      const transformers = await import('@xenova/transformers');
      const { pipeline } = transformers;

      this.pipeline = await pipeline('feature-extraction', this.model);
      this.initialized = true;
    } catch (error) {
      this.initPromise = null;
      throw new Error(
        `Failed to initialize local embedding service: ${error instanceof Error ? error.message : String(error)}. ` +
        'Make sure @xenova/transformers is installed.'
      );
    }
  }

  /**
   * Check if the service is ready.
   */
  async isReady(): Promise<boolean> {
    if (!this.initialized && !this.initPromise) {
      try {
        await this.initialize();
      } catch {
        return false;
      }
    }
    return this.initialized;
  }

  /**
   * Apply prefix to text based on embedding mode.
   *
   * @param text - Original text
   * @param mode - Embedding mode ('query' or 'document')
   * @returns Text with appropriate prefix
   */
  private applyPrefix(text: string, mode: EmbeddingMode = 'document'): string {
    return mode === 'query' ? `${QUERY_PREFIX}${text}` : `${DOCUMENT_PREFIX}${text}`;
  }

  /**
   * Generate embedding for a single text.
   *
   * @param text - Text to embed
   * @param mode - Embedding mode ('query' or 'document', default: 'document')
   * @returns Embedding vector
   */
  async embed(text: string, mode: EmbeddingMode = 'document'): Promise<number[]> {
    await this.ensureInitialized();

    const prefixedText = this.applyPrefix(text, mode);
    const pipelineFn = this.pipeline as (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;
    const output = await pipelineFn(prefixedText, { pooling: 'mean', normalize: true });

    return Array.from(output.data);
  }

  /**
   * Generate embeddings for multiple texts in batch.
   * Note: Local processing is done sequentially to avoid memory issues.
   *
   * @param texts - Array of texts to embed
   * @param mode - Embedding mode ('query' or 'document', default: 'document')
   * @returns Array of embedding vectors
   */
  async embedBatch(texts: string[], mode: EmbeddingMode = 'document'): Promise<number[][]> {
    await this.ensureInitialized();

    const results: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embed(text, mode);
      results.push(embedding);
    }
    return results;
  }

  /**
   * Generate embeddings with progress callback support.
   *
   * Phase 12 Sprint 5: Added for tracking progress on large batch operations.
   *
   * @param texts - Array of texts to embed
   * @param mode - Embedding mode ('query' or 'document', default: 'document')
   * @param onProgress - Optional progress callback
   * @returns Array of embedding vectors
   */
  async embedBatchWithProgress(
    texts: string[],
    mode: EmbeddingMode = 'document',
    onProgress?: EmbeddingProgressCallback
  ): Promise<number[][]> {
    await this.ensureInitialized();

    const results: number[][] = [];
    const total = texts.length;

    for (let i = 0; i < texts.length; i++) {
      const embedding = await this.embed(texts[i], mode);
      results.push(embedding);

      // Report progress
      if (onProgress) {
        const current = i + 1;
        onProgress({
          current,
          total,
          percentage: Math.round((current / total) * 100),
        });
      }
    }
    return results;
  }

  /**
   * Ensure the service is initialized.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

/**
 * Mock Embedding Service for testing
 *
 * Generates deterministic mock embeddings for testing purposes.
 * Useful for unit tests that don't need real embeddings.
 * Phase 12 Sprint 5: Added mode parameter and progress callback support.
 */
export class MockEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  readonly provider = 'mock';
  readonly model = 'mock-model';

  /**
   * Create a mock embedding service.
   *
   * @param dimensions - Number of dimensions for mock embeddings
   */
  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
  }

  /**
   * Check if the service is ready.
   */
  async isReady(): Promise<boolean> {
    return true;
  }

  /**
   * Apply prefix to text based on embedding mode.
   *
   * @param text - Original text
   * @param mode - Embedding mode ('query' or 'document')
   * @returns Text with appropriate prefix
   */
  private applyPrefix(text: string, mode: EmbeddingMode = 'document'): string {
    return mode === 'query' ? `${QUERY_PREFIX}${text}` : `${DOCUMENT_PREFIX}${text}`;
  }

  /**
   * Generate a deterministic mock embedding for a text.
   *
   * @param text - Text to embed
   * @param mode - Embedding mode ('query' or 'document', default: 'document')
   * @returns Mock embedding vector
   */
  async embed(text: string, mode: EmbeddingMode = 'document'): Promise<number[]> {
    // Apply prefix based on mode (affects hash for different embeddings per mode)
    const prefixedText = this.applyPrefix(text, mode);

    // Generate deterministic embedding based on text hash
    const hash = this.hashString(prefixedText);
    const embedding: number[] = [];

    for (let i = 0; i < this.dimensions; i++) {
      // Use hash and index to generate deterministic values
      const value = Math.sin(hash + i * 0.1) * 0.5;
      embedding.push(value);
    }

    // Normalize the vector
    return this.normalize(embedding);
  }

  /**
   * Generate mock embeddings for multiple texts.
   *
   * @param texts - Array of texts to embed
   * @param mode - Embedding mode ('query' or 'document', default: 'document')
   * @returns Array of mock embedding vectors
   */
  async embedBatch(texts: string[], mode: EmbeddingMode = 'document'): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text, mode)));
  }

  /**
   * Generate mock embeddings with progress callback support.
   *
   * Phase 12 Sprint 5: Added for tracking progress on large batch operations.
   *
   * @param texts - Array of texts to embed
   * @param mode - Embedding mode ('query' or 'document', default: 'document')
   * @param onProgress - Optional progress callback
   * @returns Array of mock embedding vectors
   */
  async embedBatchWithProgress(
    texts: string[],
    mode: EmbeddingMode = 'document',
    onProgress?: EmbeddingProgressCallback
  ): Promise<number[][]> {
    const results: number[][] = [];
    const total = texts.length;

    for (let i = 0; i < texts.length; i++) {
      const embedding = await this.embed(texts[i], mode);
      results.push(embedding);

      // Report progress
      if (onProgress) {
        const current = i + 1;
        onProgress({
          current,
          total,
          percentage: Math.round((current / total) * 100),
        });
      }
    }
    return results;
  }

  /**
   * Simple string hash function.
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * Normalize a vector to unit length.
   */
  private normalize(vector: number[]): number[] {
    let magnitude = 0;
    for (const v of vector) {
      magnitude += v * v;
    }
    magnitude = Math.sqrt(magnitude);

    if (magnitude === 0) {
      return vector;
    }

    return vector.map(v => v / magnitude);
  }
}

/**
 * Create an embedding service based on configuration.
 *
 * @param config - Optional configuration override
 * @returns Embedding service instance, or null if provider is 'none'
 */
export function createEmbeddingService(config?: Partial<EmbeddingConfig>): EmbeddingService | null {
  const envConfig = getEmbeddingConfig();
  const mergedConfig = { ...envConfig, ...config };

  switch (mergedConfig.provider) {
    case 'openai':
      if (!mergedConfig.apiKey) {
        throw new Error(
          'OpenAI API key is required. Set MEMORY_OPENAI_API_KEY environment variable or provide apiKey in config.'
        );
      }
      return new OpenAIEmbeddingService(mergedConfig.apiKey, mergedConfig.model);

    case 'local':
      return new LocalEmbeddingService(mergedConfig.model);

    case 'none':
    default:
      return null;
  }
}
