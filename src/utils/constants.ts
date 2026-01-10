/**
 * Application Constants
 *
 * Centralized configuration constants for file paths, extensions, and default values.
 *
 * @module utils/constants
 */

/**
 * File extensions used by the memory system.
 */
export const FILE_EXTENSIONS = {
  /** JSONL format for line-delimited JSON storage */
  JSONL: '.jsonl',
  /** Legacy JSON format (backward compatibility) */
  JSON: '.json',
} as const;

/**
 * File name suffixes for auxiliary data files.
 * These suffixes are appended to the base memory file name.
 */
export const FILE_SUFFIXES = {
  /** Suffix for saved searches file */
  SAVED_SEARCHES: '-saved-searches',
  /** Suffix for tag aliases file */
  TAG_ALIASES: '-tag-aliases',
} as const;

/**
 * Default file names used by the memory system.
 */
export const DEFAULT_FILE_NAMES = {
  /** Default memory file name */
  MEMORY: 'memory',
  /** Legacy memory file name (for backward compatibility) */
  MEMORY_LEGACY: 'memory',
} as const;

/**
 * Environment variable names used for configuration.
 */
export const ENV_VARS = {
  /** Environment variable for custom memory file path */
  MEMORY_FILE_PATH: 'MEMORY_FILE_PATH',
} as const;

/**
 * Default base directory relative to the compiled code.
 */
export const DEFAULT_BASE_DIR = '../';

/**
 * Log message prefixes for consistent logging.
 */
export const LOG_PREFIXES = {
  /** Informational message prefix */
  INFO: '[INFO]',
  /** Error message prefix */
  ERROR: '[ERROR]',
  /** Warning message prefix */
  WARN: '[WARN]',
} as const;

/**
 * Similarity scoring weights for duplicate detection.
 * These weights determine the relative importance of each factor
 * when calculating entity similarity for duplicate detection.
 * Total weights must sum to 1.0 (100%).
 */
export const SIMILARITY_WEIGHTS = {
  /** Name similarity weight (40%) - Uses Levenshtein distance */
  NAME: 0.4,
  /** Entity type match weight (20%) - Exact match required */
  TYPE: 0.2,
  /** Observation overlap weight (30%) - Uses Jaccard similarity */
  OBSERVATIONS: 0.3,
  /** Tag overlap weight (10%) - Uses Jaccard similarity */
  TAGS: 0.1,
} as const;

/**
 * Default threshold for duplicate detection (80% similarity required).
 */
export const DEFAULT_DUPLICATE_THRESHOLD = 0.8;

/**
 * Search result limits to prevent resource exhaustion.
 */
export const SEARCH_LIMITS = {
  /** Default number of results to return */
  DEFAULT: 50,
  /** Maximum number of results allowed */
  MAX: 200,
  /** Minimum number of results (must be at least 1) */
  MIN: 1,
} as const;

/**
 * Entity importance range validation constants.
 * Importance is used to prioritize entities (0 = lowest, 10 = highest).
 */
export const IMPORTANCE_RANGE = {
  /** Minimum importance value */
  MIN: 0,
  /** Maximum importance value */
  MAX: 10,
} as const;

/**
 * Graph size limits to prevent resource exhaustion and ensure performance.
 * These limits help maintain system stability and responsiveness.
 */
export const GRAPH_LIMITS = {
  /** Maximum number of entities in the graph */
  MAX_ENTITIES: 100000,
  /** Maximum number of relations in the graph */
  MAX_RELATIONS: 1000000,
  /** Maximum graph file size in megabytes */
  MAX_FILE_SIZE_MB: 500,
  /** Maximum observations per entity */
  MAX_OBSERVATIONS_PER_ENTITY: 1000,
  /** Maximum tags per entity */
  MAX_TAGS_PER_ENTITY: 100,
} as const;

/**
 * Query complexity limits to prevent expensive query operations.
 * These limits protect against denial-of-service through complex queries.
 */
export const QUERY_LIMITS = {
  /** Maximum nesting depth for boolean queries */
  MAX_DEPTH: 10,
  /** Maximum number of terms in a single query */
  MAX_TERMS: 50,
  /** Maximum number of boolean operators (AND/OR/NOT) */
  MAX_OPERATORS: 20,
  /** Maximum query string length */
  MAX_QUERY_LENGTH: 5000,
} as const;

/**
 * Brotli compression configuration constants.
 * Brotli is built into Node.js >=11.7.0 via the zlib module.
 * No external dependencies required.
 *
 * Quality levels determine compression ratio vs speed tradeoff:
 * - Lower values (0-4): Faster compression, lower ratio
 * - Higher values (9-11): Slower compression, higher ratio
 */
export const COMPRESSION_CONFIG = {
  // Quality levels (0-11)
  /** Fast compression for real-time entity writes (quality 4) */
  BROTLI_QUALITY_REALTIME: 4,
  /** Balanced compression for exports and imports (quality 6) */
  BROTLI_QUALITY_BATCH: 6,
  /** Maximum compression for backups and archives (quality 11) */
  BROTLI_QUALITY_ARCHIVE: 11,
  /** Fast decompress for cache compression (quality 5) */
  BROTLI_QUALITY_CACHE: 5,

  // Auto-compression thresholds (in bytes)
  /** Auto-compress exports larger than 100KB */
  AUTO_COMPRESS_EXPORT_SIZE: 100 * 1024,
  /** Auto-compress MCP responses larger than 256KB */
  AUTO_COMPRESS_RESPONSE_SIZE: 256 * 1024,
  /** Always compress backups by default */
  AUTO_COMPRESS_BACKUP: true,

  // File extension for compressed files
  /** Brotli compressed file extension */
  BROTLI_EXTENSION: '.br',

  // Performance tuning
  /** Chunk size for streaming compression (64KB) */
  COMPRESSION_CHUNK_SIZE: 65536,
  /** Default window size for brotli (lgwin parameter) */
  COMPRESSION_WINDOW_SIZE: 22,
} as const;

/**
 * Type representing valid brotli quality levels used in the application.
 */
export type CompressionQuality =
  | typeof COMPRESSION_CONFIG.BROTLI_QUALITY_REALTIME
  | typeof COMPRESSION_CONFIG.BROTLI_QUALITY_BATCH
  | typeof COMPRESSION_CONFIG.BROTLI_QUALITY_ARCHIVE
  | typeof COMPRESSION_CONFIG.BROTLI_QUALITY_CACHE;

// ==================== Semantic Search Configuration (Phase 4 Sprint 10-12) ====================

/**
 * Environment variable names for embedding configuration.
 */
export const EMBEDDING_ENV_VARS = {
  /** Embedding provider: 'openai', 'local', or 'none' (default: 'none') */
  PROVIDER: 'MEMORY_EMBEDDING_PROVIDER',
  /** OpenAI API key (required when provider is 'openai') */
  OPENAI_API_KEY: 'MEMORY_OPENAI_API_KEY',
  /** Optional model override for the embedding service */
  MODEL: 'MEMORY_EMBEDDING_MODEL',
  /** Auto-index entities on creation: 'true' or 'false' (default: 'false') */
  AUTO_INDEX: 'MEMORY_AUTO_INDEX_EMBEDDINGS',
} as const;

/**
 * Default embedding configuration values.
 */
export const EMBEDDING_DEFAULTS = {
  /** Default provider (disabled by default) */
  PROVIDER: 'none' as const,
  /** Default OpenAI model for embeddings (1536 dimensions) */
  OPENAI_MODEL: 'text-embedding-3-small',
  /** Default local model for embeddings (384 dimensions) */
  LOCAL_MODEL: 'Xenova/all-MiniLM-L6-v2',
  /** OpenAI embedding dimensions for text-embedding-3-small */
  OPENAI_DIMENSIONS: 1536,
  /** Local embedding dimensions for all-MiniLM-L6-v2 */
  LOCAL_DIMENSIONS: 384,
  /** Maximum texts per batch for OpenAI */
  OPENAI_MAX_BATCH_SIZE: 2048,
  /** Default batch size for embedding operations */
  DEFAULT_BATCH_SIZE: 100,
  /** Whether to auto-index entities by default */
  AUTO_INDEX: false,
} as const;

/**
 * Semantic search configuration limits.
 */
export const SEMANTIC_SEARCH_LIMITS = {
  /** Default number of results for semantic search */
  DEFAULT_LIMIT: 10,
  /** Maximum number of results for semantic search */
  MAX_LIMIT: 100,
  /** Minimum similarity score for results (0.0-1.0) */
  MIN_SIMILARITY: 0.0,
} as const;

/**
 * OpenAI API configuration.
 */
export const OPENAI_API_CONFIG: {
  BASE_URL: string;
  EMBEDDINGS_ENDPOINT: string;
  MAX_RETRIES: number;
  INITIAL_BACKOFF_MS: number;
  MAX_BACKOFF_MS: number;
} = {
  /** Base URL for OpenAI API */
  BASE_URL: 'https://api.openai.com/v1',
  /** Embeddings endpoint */
  EMBEDDINGS_ENDPOINT: '/embeddings',
  /** Maximum retries for rate limiting */
  MAX_RETRIES: 3,
  /** Initial backoff delay in milliseconds */
  INITIAL_BACKOFF_MS: 1000,
  /** Maximum backoff delay in milliseconds */
  MAX_BACKOFF_MS: 10000,
};

/**
 * Get embedding configuration from environment variables.
 *
 * @returns EmbeddingConfig object with values from environment or defaults
 */
export function getEmbeddingConfig(): {
  provider: 'openai' | 'local' | 'none';
  apiKey?: string;
  model?: string;
  autoIndex: boolean;
} {
  const provider = (process.env[EMBEDDING_ENV_VARS.PROVIDER] || EMBEDDING_DEFAULTS.PROVIDER) as 'openai' | 'local' | 'none';
  const apiKey = process.env[EMBEDDING_ENV_VARS.OPENAI_API_KEY];
  const model = process.env[EMBEDDING_ENV_VARS.MODEL];
  const autoIndex = process.env[EMBEDDING_ENV_VARS.AUTO_INDEX] === 'true';

  return { provider, apiKey, model, autoIndex };
}

// ==================== Streaming Export Configuration (Phase 7 Sprint 1) ====================

/**
 * Streaming export configuration.
 *
 * Controls when to use streaming mode and buffer sizes for optimal memory usage.
 */
export const STREAMING_CONFIG = {
  /** Minimum entity count to trigger streaming mode */
  STREAMING_THRESHOLD: 5000,
  /** Chunk size for batched streaming operations */
  CHUNK_SIZE: 500,
  /** High water mark for stream buffers (bytes) */
  HIGH_WATER_MARK: 64 * 1024,
  /** Flush interval for long-running streams (ms) */
  FLUSH_INTERVAL_MS: 100,
} as const;
