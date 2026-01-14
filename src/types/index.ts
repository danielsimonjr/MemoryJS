/**
 * Types Module - Barrel Export
 *
 * Central export point for all type definitions used throughout the
 * Memory MCP Server. All types are consolidated in types.ts (Phase 5 cleanup).
 *
 * @example
 * ```typescript
 * import { Entity, Relation, KnowledgeGraph, SearchResult } from './types/index.js';
 * ```
 */

export type {
  // Entity types
  Entity,
  Relation,
  KnowledgeGraph,
  ReadonlyKnowledgeGraph,
  // Search types
  SearchResult,
  SavedSearch,
  BooleanQueryNode,
  DocumentVector,
  TFIDFIndex,
  // Phase 4: Search cache types
  FuzzyCacheKey,
  BooleanCacheEntry,
  PaginatedCacheEntry,
  TokenizedEntity,
  // Analytics types
  GraphStats,
  ValidationReport,
  ValidationIssue,
  ValidationWarning,
  CacheCompressionStats,
  // Archive types
  ArchiveResultExtended,
  // Import/Export types
  ExportFilter,
  ExportOptions,
  ExportResult,
  ImportResult,
  GraphCompressionResult,
  // Backup types
  BackupOptions,
  BackupResult,
  RestoreResult,
  BackupMetadataExtended,
  BackupInfoExtended,
  // Tag types
  TagAlias,
  // Storage types
  IGraphStorage,
  StorageConfig,
  LowercaseData,
  // Phase 4 Sprint 6-9: Graph algorithm types
  TraversalOptions,
  TraversalResult,
  PathResult,
  ConnectedComponentsResult,
  CentralityResult,
  WeightedRelation,
  // Phase 4 Sprint 10-12: Semantic search types
  EmbeddingMode,
  EmbeddingService,
  SemanticSearchResult,
  IVectorStore,
  VectorSearchResult,
  EmbeddingConfig,
  SemanticIndexOptions,
  // Phase 9B: Long-running operation types
  LongRunningOperationOptions,
  // Phase 10 Sprint 1: Transaction batching types
  BatchOperationType,
  BatchOperation,
  BatchResult,
  BatchOptions,
  // Phase 10 Sprint 2: Graph change events types
  GraphEventType,
  GraphEventBase,
  EntityCreatedEvent,
  EntityUpdatedEvent,
  EntityDeletedEvent,
  RelationCreatedEvent,
  RelationDeletedEvent,
  ObservationAddedEvent,
  ObservationDeletedEvent,
  GraphSavedEvent,
  GraphLoadedEvent,
  GraphEvent,
  GraphEventListener,
  GraphEventMap,
  // Phase 10 Sprint 4: Query cost estimation types
  SearchMethod,
  QueryCostEstimate,
  AutoSearchResult,
  QueryCostEstimatorOptions,
  // Phase 12 Sprint 1: Compression types
  PreparedEntity,
  // Phase 11 Sprint 1: Hybrid search types
  SymbolicFilters,
  HybridSearchOptions,
  HybridSearchResult,
  // Phase 11 Sprint 3: Query analysis types
  ExtractedEntity,
  TemporalRange,
  QueryAnalysis,
  SubQuery,
  QueryPlan,
} from './types.js';

// Agent Memory Types (Phase 1 - Agent Memory System)
export type {
  // Memory classification types
  MemoryType,
  AccessPattern,
  MemoryVisibility,
  MemoryAcquisitionMethod,
  SessionStatus,
  TemporalFocus,
  // Memory source types
  ObservationSource,
  MemorySource,
  // Agent entity types
  AgentEntity,
  AgentObservation,
  SessionEntity,
  // Context types
  AccessContext,
  SalienceContext,
  SalienceWeights,
  SalienceComponents,
  ScoredEntity,
  // Working memory types
  WorkingMemoryOptions,
  // Decay types
  DecayOptions,
  ForgetOptions,
  DecayResult,
  ForgetResult,
  // Utility types
  WorkingMemoryEntity,
  EpisodicMemoryEntity,
  SemanticMemoryEntity,
  ProceduralMemoryEntity,
  // Consolidation types
  ConsolidateOptions,
  ConsolidationResult,
  // Summarization types
  SummarizationResult,
} from './agent-memory.js';

// Agent Memory Type Guards and Classes
export {
  isAgentEntity,
  isSessionEntity,
  isWorkingMemory,
  isEpisodicMemory,
  isSemanticMemory,
  isProceduralMemory,
  AccessContextBuilder,
} from './agent-memory.js';
