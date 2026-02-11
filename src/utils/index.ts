/**
 * Utilities Module Barrel Export
 *
 * Centralizes all utility exports for convenient importing.
 * Consolidated from 17 files to 9 focused modules (Phase 5 cleanup).
 *
 * @module utils
 */

// ==================== Error Types (Phase 1 Sprint 10 Enhanced) ====================
export {
  ErrorCode,
  KnowledgeGraphError,
  EntityNotFoundError,
  RelationNotFoundError,
  DuplicateEntityError,
  ValidationError,
  CycleDetectedError,
  InvalidImportanceError,
  FileOperationError,
  ImportError,
  ExportError,
  InsufficientEntitiesError,
  OperationCancelledError,
  type ErrorOptions,
} from './errors.js';

// ==================== Error Suggestions (Phase 1 Sprint 10) ====================
export { generateSuggestions, getQuickHint } from './errorSuggestions.js';

// ==================== Constants ====================
export {
  FILE_EXTENSIONS,
  FILE_SUFFIXES,
  DEFAULT_FILE_NAMES,
  ENV_VARS,
  DEFAULT_BASE_DIR,
  LOG_PREFIXES,
  SIMILARITY_WEIGHTS,
  DEFAULT_DUPLICATE_THRESHOLD,
  SEARCH_LIMITS,
  IMPORTANCE_RANGE,
  GRAPH_LIMITS,
  QUERY_LIMITS,
  COMPRESSION_CONFIG,
  STREAMING_CONFIG,
  type CompressionQuality,
} from './constants.js';

// ==================== Compression Utilities ====================
export {
  compress,
  decompress,
  compressFile,
  decompressFile,
  compressToBase64,
  decompressFromBase64,
  hasBrotliExtension,
  getCompressionRatio,
  createMetadata,
  createUncompressedMetadata,
  type CompressionOptions,
  type CompressionResult,
  type CompressionMetadata,
} from './compressionUtil.js';

// ==================== Compressed Cache ====================
export {
  CompressedCache,
  type CompressedCacheOptions,
  type CompressedCacheStats,
} from './compressedCache.js';

// ==================== Logger ====================
export { logger } from './logger.js';

// ==================== Search Algorithms ====================
export {
  levenshteinDistance,
  calculateTF,
  calculateIDF,
  calculateIDFFromTokenSets,
  calculateTFIDF,
  tokenize,
} from './searchAlgorithms.js';

// ==================== Indexes ====================
export {
  NameIndex,
  TypeIndex,
  LowercaseCache,
  RelationIndex,
} from './indexes.js';

// ==================== Search Cache ====================
export {
  SearchCache,
  searchCaches,
  clearAllSearchCaches,
  getAllCacheStats,
  cleanupAllCaches,
  type CacheStats,
} from './searchCache.js';

// ==================== Schemas and Validation ====================
// Consolidated from: schemas.ts, validationHelper.ts, validationUtils.ts
export {
  // Zod schemas - Entity/Relation
  EntitySchema,
  CreateEntitySchema,
  UpdateEntitySchema,
  RelationSchema,
  CreateRelationSchema,
  SearchQuerySchema,
  DateRangeSchema,
  TagAliasSchema,
  ExportFormatSchema,
  BatchCreateEntitiesSchema,
  BatchCreateRelationsSchema,
  EntityNamesSchema,
  DeleteRelationsSchema,
  // Zod schemas - Observations
  AddObservationInputSchema,
  AddObservationsInputSchema,
  DeleteObservationInputSchema,
  DeleteObservationsInputSchema,
  // Zod schemas - Archive
  ArchiveCriteriaSchema,
  // Zod schemas - Saved Search
  SavedSearchInputSchema,
  SavedSearchUpdateSchema,
  // Zod schemas - Import/Export
  ImportFormatSchema,
  ExtendedExportFormatSchema,
  MergeStrategySchema,
  ExportFilterSchema,
  // Zod schemas - Search
  OptionalTagsSchema,
  OptionalEntityNamesSchema,
  // Schema types
  type EntityInput,
  type CreateEntityInput,
  type UpdateEntityInput,
  type RelationInput,
  type CreateRelationInput,
  type SearchQuery,
  type DateRange,
  type TagAliasInput,
  type AddObservationInput,
  type DeleteObservationInput,
  type ArchiveCriteriaInput,
  type SavedSearchInput,
  type SavedSearchUpdateInput,
  type ImportFormatInput,
  type ExtendedExportFormatInput,
  type MergeStrategyInput,
  type ExportFilterInput,
  // Validation result type
  type ValidationResult,
  // Zod helpers
  formatZodErrors,
  validateWithSchema,
  validateSafe,
  validateArrayWithSchema,
  // Manual validation functions
  validateEntity,
  validateRelation,
  validateImportance,
  validateTags,
} from './schemas.js';

// ==================== Formatters ====================
// Consolidated from: responseFormatter.ts, paginationUtils.ts
export {
  // Response formatting
  formatToolResponse,
  formatTextResponse,
  formatRawResponse,
  formatErrorResponse,
  type ToolResponse,
  // Pagination utilities
  validatePagination,
  applyPagination,
  paginateArray,
  getPaginationMeta,
  type ValidatedPagination,
} from './formatters.js';

// ==================== Entity Utilities ====================
// Consolidated from: entityUtils.ts, tagUtils.ts, dateUtils.ts, filterUtils.ts, pathUtils.ts
export {
  // Hash functions (Phase 12 Sprint 1)
  fnv1aHash,
  // Entity lookup
  findEntityByName,
  findEntitiesByNames,
  entityExists,
  getEntityIndex,
  removeEntityByName,
  getEntityNameSet,
  groupEntitiesByType,
  touchEntity,
  // Tag utilities
  normalizeTag,
  normalizeTags,
  hasMatchingTag,
  hasAllTags,
  filterByTags,
  addUniqueTags,
  removeTags,
  // Date utilities
  isWithinDateRange,
  parseDateRange,
  isValidISODate,
  getCurrentTimestamp,
  // Filter utilities
  isWithinImportanceRange,
  filterByImportance,
  filterByCreatedDate,
  filterByModifiedDate,
  filterByEntityType,
  entityPassesFilters,
  type CommonSearchFilters,
  // Path utilities
  validateFilePath,
  defaultMemoryPath,
  ensureMemoryFilePath,
  // Security utilities
  sanitizeObject,
  escapeCsvFormula,
} from './entityUtils.js';

// ==================== Parallel Utilities ====================
export {
  parallelMap,
  parallelFilter,
  getPoolStats,
  shutdownParallelUtils,
} from './parallelUtils.js';

// ==================== Task Scheduler ====================
export {
  // Types and Enums
  TaskPriority,
  TaskStatus,
  type Task,
  type TaskResult,
  type ProgressCallback,
  type TaskBatchOptions,
  type QueueStats,
  // Task Queue
  TaskQueue,
  // Batch Processing
  batchProcess,
  rateLimitedProcess,
  withRetry,
  // Rate Limiting
  debounce,
  throttle,
} from './taskScheduler.js';

// ==================== Operation Utilities (Phase 9B) ====================
export {
  checkCancellation,
  createProgressReporter,
  createProgress,
  executeWithPhases,
  processBatchesWithProgress,
  type PhaseDefinition,
} from './operationUtils.js';

// ==================== Worker Pool Manager (Phase 12 Sprint 2) ====================
export {
  WorkerPoolManager,
  getWorkerPoolManager,
  type WorkerPoolConfig,
  type ExtendedPoolStats,
  type PoolEventCallback,
} from './WorkerPoolManager.js';

// ==================== Batch Processor (Phase 12 Sprint 2) ====================
export {
  BatchProcessor,
  processBatch,
  processWithRetry,
  chunkArray,
  parallelLimit,
  mapParallel,
  filterParallel,
  type BatchProgress,
  type BatchProgressCallback,
  type BatchItemResult,
  type BatchProcessResult,
  type BatchProcessorOptions,
} from './BatchProcessor.js';

// ==================== Memory Monitor (Phase 12 Sprint 6) ====================
export {
  MemoryMonitor,
  globalMemoryMonitor,
  type ComponentMemoryUsage,
  type MemoryUsageStats,
  type MemoryThresholds,
  type MemoryAlert,
  type MemoryChangeCallback,
} from './MemoryMonitor.js';

// ==================== Relation Helpers (Phase 1 Sprint 4) ====================
export {
  isWeightedRelation,
  isTemporalRelation,
  isBidirectionalRelation,
  hasConfidence,
  isCurrentlyValid,
  RelationBuilder,
} from './relationHelpers.js';

// ==================== Relation Validation (Phase 1 Sprint 4) ====================
export {
  validateRelationMetadata,
  validateRelationsMetadata,
  allRelationsValidMetadata,
  type RelationValidationResult,
  type RelationValidationError,
  type RelationValidationWarning,
} from './relationValidation.js';

// ==================== Entity Validation (Phase 1 Sprint 9) ====================
export {
  EntityValidator,
  type EntityValidatorConfig,
  type EntityValidationRule,
  type EntityRuleResult,
  type EntityValidationIssue,
  type EntityValidationResult,
} from './EntityValidator.js';

export {
  required,
  minLength,
  maxLength,
  pattern,
  range,
  min,
  max,
  oneOf,
  minItems,
  maxItems,
  email,
  url,
  isoDate,
  typeOf,
  custom,
  customSync,
  asWarning,
  all,
  when,
} from './validators.js';

export { SchemaValidator, type JsonSchema } from './SchemaValidator.js';

// ==================== Async Mutex ====================
export { AsyncMutex } from './AsyncMutex.js';
