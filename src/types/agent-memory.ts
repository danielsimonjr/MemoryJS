/**
 * Agent Memory Type Definitions
 *
 * Extended type definitions for AI agent memory systems.
 * Provides interfaces for working, episodic, and semantic memory
 * with lifecycle management and multi-agent support.
 *
 * @module types/agent-memory
 */

import type { Entity } from './types.js';

// ==================== Memory Classification Types ====================

/**
 * Classification of memory types based on cognitive patterns.
 * - working: Short-term, session-scoped, TTL-based
 * - episodic: Conversation history, events, experiences
 * - semantic: Long-term facts, concepts, knowledge
 * - procedural: Skills, patterns, procedures (future)
 */
export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';

/**
 * Classification of memory access frequency.
 * Used for decay calculations and retrieval ranking.
 */
export type AccessPattern = 'frequent' | 'occasional' | 'rare';

/**
 * Memory visibility for multi-agent scenarios.
 * - private: Only owning agent can access
 * - shared: Specified agents can access
 * - public: All agents can access
 */
export type MemoryVisibility = 'private' | 'shared' | 'public';

/**
 * How a memory was acquired.
 * - observed: Directly perceived/received
 * - inferred: Derived through reasoning
 * - told: Communicated by another agent
 * - consolidated: Created by merging other memories
 */
export type MemoryAcquisitionMethod = 'observed' | 'inferred' | 'told' | 'consolidated';

/**
 * Session lifecycle status.
 * - active: Session is currently in progress
 * - completed: Session ended normally
 * - abandoned: Session ended without proper closure
 */
export type SessionStatus = 'active' | 'completed' | 'abandoned';

/**
 * Temporal focus for salience calculation.
 */
export type TemporalFocus = 'recent' | 'historical' | 'balanced';

// ==================== Memory Source Types ====================

/**
 * Source tracking for observation provenance.
 *
 * Tracks how an observation was acquired:
 * - user_input: Directly from user conversation
 * - agent_inference: Derived by agent reasoning
 * - external_api: Retrieved from external service
 * - consolidation: Created by summarizing other observations
 */
export interface ObservationSource {
  /** How the observation was acquired */
  type: 'user_input' | 'agent_inference' | 'external_api' | 'consolidation';
  /** Agent that created this observation */
  agentId?: string;
  /** Session during which observation was created */
  sessionId?: string;
  /** Original user input if transformed */
  rawInput?: string;
}

/**
 * Provenance tracking for memory origin.
 *
 * Tracks the complete lineage of a memory:
 * - Which agent created it
 * - When it was created
 * - How it was acquired
 * - How reliable it is
 * - What it was derived from (if consolidated)
 *
 * @example
 * ```typescript
 * const source: MemorySource = {
 *   agentId: 'travel_assistant',
 *   timestamp: '2024-01-15T10:30:00Z',
 *   method: 'observed',
 *   reliability: 0.95
 * };
 * ```
 */
export interface MemorySource {
  /** ID of the agent that created this memory */
  agentId: string;
  /** ISO 8601 timestamp when memory was created */
  timestamp: string;
  /** How the memory was acquired */
  method: MemoryAcquisitionMethod;
  /** Trust/reliability score (0.0-1.0) */
  reliability: number;
  /** Original entity ID if consolidated from another memory */
  originalEntityId?: string;
}

// ==================== Agent Entity Types ====================

/**
 * Extended entity interface for agent memory systems.
 *
 * Extends the base Entity with fields for:
 * - Memory classification (working/episodic/semantic/procedural)
 * - Session and task context
 * - Lifecycle management (TTL, promotion tracking)
 * - Access tracking (frequency, recency, patterns)
 * - Memory strength (confidence, confirmations, decay)
 * - Multi-agent support (ownership, visibility, provenance)
 *
 * @example
 * ```typescript
 * const memory: AgentEntity = {
 *   name: 'user_preference_budget_travel',
 *   entityType: 'preference',
 *   observations: ['User prefers budget travel options'],
 *   memoryType: 'working',
 *   sessionId: 'session_123',
 *   expiresAt: '2024-01-02T00:00:00Z',
 *   accessCount: 5,
 *   confidence: 0.9,
 *   confirmationCount: 2,
 *   visibility: 'private'
 * };
 * ```
 */
export interface AgentEntity extends Entity {
  // === Memory Classification ===
  /** Type of memory: working, episodic, semantic, or procedural */
  memoryType: MemoryType;

  // === Session & Context ===
  /** Session ID grouping related memories */
  sessionId?: string;
  /** Specific conversation identifier */
  conversationId?: string;
  /** Associated task or goal identifier */
  taskId?: string;

  // === Lifecycle Management ===
  /** ISO 8601 timestamp for auto-cleanup (working memory) */
  expiresAt?: string;
  /** Flag indicating temporary working memory */
  isWorkingMemory?: boolean;
  /** ISO 8601 timestamp when promoted to long-term */
  promotedAt?: string;
  /** Source session or entity ID if promoted */
  promotedFrom?: string;
  /** Flag indicating memory is marked for promotion consideration */
  markedForPromotion?: boolean;

  // === Access Tracking ===
  /** Total number of times this memory was retrieved */
  accessCount: number;
  /** ISO 8601 timestamp of most recent access */
  lastAccessedAt?: string;
  /** Classified access frequency pattern */
  accessPattern?: AccessPattern;

  // === Memory Strength ===
  /** Belief strength / certainty (0.0-1.0) */
  confidence: number;
  /** Number of times this memory was verified/reinforced */
  confirmationCount: number;
  /** Custom decay rate multiplier (default 1.0) */
  decayRate?: number;

  // === Multi-Agent ===
  /** Owning agent identifier */
  agentId?: string;
  /** Visibility level for multi-agent access */
  visibility: MemoryVisibility;
  /** Provenance tracking for memory origin */
  source?: MemorySource;
}

// ==================== Agent Observation Types ====================

/**
 * Extended observation with confidence, temporal validity, and provenance.
 *
 * Agent observations go beyond simple strings to include:
 * - Confidence scoring for belief strength
 * - Confirmation counting for verification tracking
 * - Contradiction references for conflicting information
 * - Temporal scoping for time-bounded facts
 * - Source provenance for audit trails
 * - Consolidation metadata for summarization tracking
 *
 * @example
 * ```typescript
 * const observation: AgentObservation = {
 *   content: 'User prefers budget travel under $100/night',
 *   confidence: 0.95,
 *   confirmationCount: 3,
 *   observedAt: '2024-01-15T10:30:00Z',
 *   source: { type: 'user_input', sessionId: 'session_123' },
 *   abstractionLevel: 0
 * };
 * ```
 */
export interface AgentObservation {
  /** The observation content text */
  content: string;

  // === Confidence & Verification ===
  /** Certainty level (0.0-1.0) */
  confidence: number;
  /** Number of times this observation was confirmed */
  confirmationCount: number;
  /** IDs of observations that contradict this one */
  contradictedBy?: string[];

  // === Temporal Context ===
  /** ISO 8601 timestamp when this was learned */
  observedAt: string;
  /** ISO 8601 timestamp when this fact becomes valid */
  validFrom?: string;
  /** ISO 8601 timestamp when this fact expires */
  validUntil?: string;

  // === Source Tracking ===
  /** Provenance information */
  source: ObservationSource;

  // === Consolidation ===
  /** IDs of observations this was summarized from */
  consolidatedFrom?: string[];
  /** Abstraction depth: 0=raw, 1=summarized, 2=generalized */
  abstractionLevel: number;
}

// ==================== Session Entity Types ====================

/**
 * Entity representing a conversation or task session.
 *
 * Sessions group working memories and provide context for:
 * - Memory scoping (all memories in a session)
 * - Consolidation triggers (end of session)
 * - Context continuity (linked sessions)
 * - Goal tracking (task metadata)
 *
 * @example
 * ```typescript
 * const session: SessionEntity = {
 *   name: 'session_trip_planning_2024_01_15',
 *   entityType: 'session',
 *   observations: ['Planning trip to Japan'],
 *   memoryType: 'episodic',
 *   status: 'active',
 *   startedAt: '2024-01-15T10:00:00Z',
 *   goalDescription: 'Help user plan a 2-week trip to Japan',
 *   taskType: 'travel_planning',
 *   memoryCount: 15,
 *   consolidatedCount: 0,
 *   accessCount: 0,
 *   confidence: 1.0,
 *   confirmationCount: 0,
 *   visibility: 'private'
 * };
 * ```
 */
export interface SessionEntity extends AgentEntity {
  /** Fixed entity type for sessions */
  entityType: 'session';
  /** Sessions are episodic memory */
  memoryType: 'episodic';

  // === Session Metadata ===
  /** ISO 8601 timestamp when session started */
  startedAt: string;
  /** ISO 8601 timestamp when session ended */
  endedAt?: string;
  /** Current session status */
  status: SessionStatus;

  // === Context ===
  /** Description of the session's goal or purpose */
  goalDescription?: string;
  /** Type of task being performed */
  taskType?: string;
  /** Detected user intent for the session */
  userIntent?: string;

  // === Statistics ===
  /** Count of memories created during this session */
  memoryCount: number;
  /** Count of memories promoted to long-term storage */
  consolidatedCount: number;

  // === Relationships ===
  /** ID of previous session if this is a continuation */
  previousSessionId?: string;
  /** IDs of related sessions */
  relatedSessionIds?: string[];
}

// ==================== Context Types ====================

/**
 * Context provided when recording a memory access.
 * Used to track how and why a memory was retrieved.
 */
export interface AccessContext {
  /** Session ID during which access occurred */
  sessionId?: string;
  /** Task ID associated with access */
  taskId?: string;
  /** Search query that triggered this access */
  queryContext?: string;
  /** How the memory was retrieved */
  retrievalMethod?: 'search' | 'direct' | 'traversal';
}

/**
 * Builder for constructing AccessContext objects.
 *
 * @example
 * ```typescript
 * const ctx = new AccessContextBuilder()
 *   .forSession('session_123')
 *   .withQuery('budget hotels')
 *   .viaSearch()
 *   .build();
 * ```
 */
export class AccessContextBuilder {
  private context: AccessContext = {};

  forSession(sessionId: string): this {
    this.context.sessionId = sessionId;
    return this;
  }

  forTask(taskId: string): this {
    this.context.taskId = taskId;
    return this;
  }

  withQuery(queryContext: string): this {
    this.context.queryContext = queryContext;
    return this;
  }

  viaSearch(): this {
    this.context.retrievalMethod = 'search';
    return this;
  }

  viaDirect(): this {
    this.context.retrievalMethod = 'direct';
    return this;
  }

  viaTraversal(): this {
    this.context.retrievalMethod = 'traversal';
    return this;
  }

  build(): AccessContext {
    return { ...this.context };
  }
}

/**
 * Context for salience calculation.
 *
 * @example
 * ```typescript
 * const context: SalienceContext = {
 *   currentTask: 'travel_booking',
 *   currentSession: 'session_123',
 *   queryText: 'hotel preferences',
 *   temporalFocus: 'recent',
 * };
 * ```
 */
export interface SalienceContext {
  /** Current task identifier */
  currentTask?: string;
  /** Current session identifier */
  currentSession?: string;
  /** Recently accessed entity names */
  recentEntities?: string[];
  /** Query text for relevance matching */
  queryText?: string;
  /** Inferred user intent */
  userIntent?: string;
  /** Temporal focus for scoring */
  temporalFocus?: TemporalFocus;
  /** Custom context fields */
  metadata?: Record<string, unknown>;
}

/**
 * Weights for salience calculation components.
 */
export interface SalienceWeights {
  importance: number;
  recency: number;
  frequency: number;
  context: number;
  novelty: number;
}

/**
 * Component breakdown of salience score.
 */
export interface SalienceComponents {
  /** Base importance after decay */
  baseImportance: number;
  /** Recency contribution */
  recencyBoost: number;
  /** Frequency contribution */
  frequencyBoost: number;
  /** Context relevance contribution */
  contextRelevance: number;
  /** Novelty contribution */
  noveltyBoost: number;
}

/**
 * Entity with calculated salience score.
 *
 * @example
 * ```typescript
 * const scored = await engine.calculateSalience(entity, context);
 * console.log(`Score: ${scored.salienceScore}`);
 * console.log(`Recency: ${scored.components.recencyBoost}`);
 * ```
 */
export interface ScoredEntity {
  /** The entity being scored */
  entity: AgentEntity;
  /** Overall salience score (0-1) */
  salienceScore: number;
  /** Component breakdown */
  components: SalienceComponents;
}

// ==================== Working Memory Types ====================

/**
 * Options for creating working memory.
 *
 * @example
 * ```typescript
 * const options: WorkingMemoryOptions = {
 *   ttlHours: 48,
 *   taskId: 'trip_planning',
 *   importance: 7,
 *   confidence: 0.9,
 * };
 * ```
 */
export interface WorkingMemoryOptions {
  /** TTL in hours (default: 24) */
  ttlHours?: number;
  /** Enable auto-promotion when thresholds met */
  autoPromote?: boolean;
  /** Associated task ID */
  taskId?: string;
  /** Initial importance (0-10) */
  importance?: number;
  /** Initial confidence (0-1) */
  confidence?: number;
  /** Entity type (default: 'working_memory') */
  entityType?: string;
  /** Visibility for multi-agent scenarios */
  visibility?: MemoryVisibility;
  /** Agent ID for multi-agent scenarios */
  agentId?: string;
}

// ==================== Decay Types ====================

/**
 * Options for decay operations.
 *
 * @remarks
 * - halfLifeHours must be positive
 * - minImportance should be in range [0, 10]
 */
export interface DecayOptions {
  /** Override half-life in hours (must be > 0) */
  halfLifeHours?: number;
  /** Enable importance-based half-life modulation */
  importanceModulation?: boolean;
  /** Enable access frequency-based modulation */
  accessModulation?: boolean;
  /** Minimum importance floor (0-10) */
  minImportance?: number;
  /** Dry run - calculate but don't persist */
  dryRun?: boolean;
}

/**
 * Options for forgetting weak memories.
 *
 * @remarks
 * - effectiveImportanceThreshold is required and must be in range [0, 10]
 * - olderThanHours must be positive if specified
 */
export interface ForgetOptions {
  /** Threshold - forget memories with effective importance below this (required) */
  effectiveImportanceThreshold: number;
  /** Only forget memories older than this many hours */
  olderThanHours?: number;
  /** Tags that protect memories from forgetting */
  excludeTags?: string[];
  /** Preview mode - calculate but don't delete */
  dryRun?: boolean;
  /** Archive instead of hard delete */
  archive?: boolean;
}

/**
 * Result of batch decay operation.
 */
export interface DecayResult {
  /** Number of entities processed */
  entitiesProcessed: number;
  /** Average decay factor (0-1, higher = more decay) */
  averageDecay: number;
  /** Memories below warning threshold but not forgotten */
  memoriesAtRisk: number;
  /** Processing time in milliseconds */
  processingTimeMs: number;
}

/**
 * Result of forget operation.
 */
export interface ForgetResult {
  /** Number of memories forgotten */
  memoriesForgotten: number;
  /** Names of forgotten entities */
  forgottenNames: string[];
  /** Memories protected by tags */
  memoriesProtected: number;
  /** Memories too young to forget */
  memoriesTooYoung: number;
  /** Was this a dry run? */
  dryRun: boolean;
}

// ==================== Type Guards ====================

/**
 * Type guard to check if an entity is an AgentEntity.
 *
 * @param entity - Entity to check
 * @returns True if entity has AgentEntity required fields
 *
 * @example
 * ```typescript
 * if (isAgentEntity(entity)) {
 *   console.log(entity.memoryType); // TypeScript knows this exists
 * }
 * ```
 */
export function isAgentEntity(entity: unknown): entity is AgentEntity {
  if (!entity || typeof entity !== 'object') return false;
  const e = entity as Record<string, unknown>;
  return (
    typeof e.name === 'string' &&
    typeof e.entityType === 'string' &&
    typeof e.memoryType === 'string' &&
    ['working', 'episodic', 'semantic', 'procedural'].includes(e.memoryType as string) &&
    typeof e.accessCount === 'number' &&
    typeof e.confidence === 'number' &&
    typeof e.confirmationCount === 'number' &&
    typeof e.visibility === 'string' &&
    ['private', 'shared', 'public'].includes(e.visibility as string)
  );
}

/**
 * Type guard to check if an entity is a SessionEntity.
 *
 * @param entity - Entity to check
 * @returns True if entity is a session
 *
 * @example
 * ```typescript
 * if (isSessionEntity(entity)) {
 *   console.log(entity.status); // TypeScript knows this is SessionEntity
 * }
 * ```
 */
export function isSessionEntity(entity: unknown): entity is SessionEntity {
  if (!isAgentEntity(entity)) return false;
  const e = entity as AgentEntity;
  return (
    e.entityType === 'session' &&
    e.memoryType === 'episodic' &&
    typeof (e as SessionEntity).startedAt === 'string' &&
    typeof (e as SessionEntity).status === 'string' &&
    ['active', 'completed', 'abandoned'].includes((e as SessionEntity).status) &&
    typeof (e as SessionEntity).memoryCount === 'number' &&
    typeof (e as SessionEntity).consolidatedCount === 'number'
  );
}

/**
 * Type guard to check if an entity is working memory.
 */
export function isWorkingMemory(entity: unknown): entity is AgentEntity & { memoryType: 'working' } {
  return isAgentEntity(entity) && entity.memoryType === 'working';
}

/**
 * Type guard to check if an entity is episodic memory.
 */
export function isEpisodicMemory(entity: unknown): entity is AgentEntity & { memoryType: 'episodic' } {
  return isAgentEntity(entity) && entity.memoryType === 'episodic';
}

/**
 * Type guard to check if an entity is semantic memory.
 */
export function isSemanticMemory(entity: unknown): entity is AgentEntity & { memoryType: 'semantic' } {
  return isAgentEntity(entity) && entity.memoryType === 'semantic';
}

/**
 * Type guard to check if an entity is procedural memory.
 */
export function isProceduralMemory(entity: unknown): entity is AgentEntity & { memoryType: 'procedural' } {
  return isAgentEntity(entity) && entity.memoryType === 'procedural';
}

// ==================== Utility Types ====================

/**
 * Utility type for working memory entities.
 */
export type WorkingMemoryEntity = AgentEntity & { memoryType: 'working' };

/**
 * Utility type for episodic memory entities.
 */
export type EpisodicMemoryEntity = AgentEntity & { memoryType: 'episodic' };

/**
 * Utility type for semantic memory entities.
 */
export type SemanticMemoryEntity = AgentEntity & { memoryType: 'semantic' };

/**
 * Utility type for procedural memory entities (future).
 */
export type ProceduralMemoryEntity = AgentEntity & { memoryType: 'procedural' };

// ==================== Consolidation Types ====================

/**
 * Options for memory consolidation operations.
 *
 * Controls how working memories are transformed and promoted
 * to long-term storage.
 *
 * @example
 * ```typescript
 * const options: ConsolidateOptions = {
 *   summarize: true,
 *   extractPatterns: true,
 *   minConfidence: 0.8,
 *   minConfirmations: 3,
 * };
 * ```
 */
export interface ConsolidateOptions {
  /** Enable observation summarization (default: true) */
  summarize?: boolean;
  /** Enable pattern extraction (default: true) */
  extractPatterns?: boolean;
  /** Minimum confidence for promotion (0-1, default: 0.7) */
  minConfidence?: number;
  /** Minimum confirmation count for promotion (default: 2) */
  minConfirmations?: number;
  /** Keep original working memories after promotion (default: false) */
  preserveOriginals?: boolean;
  /** Target memory type for promotion (default: 'episodic') */
  targetType?: MemoryType;
}

/**
 * Result of a consolidation operation.
 *
 * Provides detailed statistics about what was processed
 * and any errors encountered.
 *
 * @example
 * ```typescript
 * const result = await pipeline.consolidateSession('session_1');
 * console.log(`Promoted ${result.memoriesPromoted} of ${result.memoriesProcessed}`);
 * ```
 */
export interface ConsolidationResult {
  /** Total memories processed */
  memoriesProcessed: number;
  /** Memories successfully promoted to long-term */
  memoriesPromoted: number;
  /** Memories merged with existing entities */
  memoriesMerged: number;
  /** Patterns extracted from observations */
  patternsExtracted: number;
  /** Summary observations created */
  summariesCreated: number;
  /** Error messages encountered */
  errors: string[];
}

/**
 * Result of observation summarization.
 *
 * Provides detailed statistics about the summarization operation
 * including compression metrics and provenance tracking.
 *
 * @example
 * ```typescript
 * const result = await pipeline.summarizeObservations(entity);
 * console.log(`Compressed ${result.originalCount} to ${result.summaryCount}`);
 * console.log(`Compression ratio: ${result.compressionRatio.toFixed(2)}x`);
 * ```
 */
export interface SummarizationResult {
  /** Number of original observations */
  originalCount: number;
  /** Number of summary observations */
  summaryCount: number;
  /** Compression ratio (original / summary) */
  compressionRatio: number;
  /** The generated summaries */
  summaries: string[];
  /** Source observations for each summary (for provenance) */
  sourceObservations: string[][];
}

/**
 * Result of pattern detection in observations.
 *
 * Represents a detected template pattern with variable slots.
 * Used for identifying recurring patterns and creating semantic memories.
 *
 * @example
 * ```typescript
 * const patterns = await pipeline.extractPatterns('preference');
 * for (const p of patterns) {
 *   console.log(`Pattern: ${p.pattern}`);
 *   console.log(`Variables: ${p.variables.join(', ')}`);
 *   console.log(`Confidence: ${p.confidence}`);
 * }
 * ```
 */
export interface PatternResult {
  /** Template pattern with {X} variable slots (e.g., "User prefers {X}") */
  pattern: string;
  /** Extracted variable values from matching observations */
  variables: string[];
  /** Number of times pattern appeared */
  occurrences: number;
  /** Confidence score based on frequency (0-1) */
  confidence: number;
  /** Names of source entities that contain this pattern */
  sourceEntities: string[];
}

/**
 * Strategy for merging duplicate memories.
 * - newest: Keep the most recently modified entity
 * - strongest: Keep entity with highest confidence * confirmations
 * - merge_observations: Combine all observations into first entity
 */
export type MemoryMergeStrategy = 'newest' | 'strongest' | 'merge_observations';

/**
 * Result of a memory merge operation.
 *
 * @example
 * ```typescript
 * const result = await pipeline.mergeMemories(['ent1', 'ent2'], 'newest');
 * console.log(`Survivor: ${result.survivor.name}`);
 * console.log(`Merged ${result.mergedCount} entities`);
 * ```
 */
export interface MergeResult {
  /** The surviving merged entity */
  survivor: AgentEntity;
  /** Names of entities that were merged */
  mergedEntities: string[];
  /** Number of entities merged */
  mergedCount: number;
  /** Strategy used for merge */
  strategy: MemoryMergeStrategy;
  /** Combined observation count after dedup */
  observationCount: number;
}

/**
 * Result of duplicate detection.
 */
export interface DuplicatePair {
  /** First entity name */
  entity1: string;
  /** Second entity name */
  entity2: string;
  /** Similarity score between entities (0-1) */
  similarity: number;
}

// ==================== Auto-Consolidation Rule Types ====================

/**
 * Trigger types for consolidation rules.
 */
export type ConsolidationTrigger =
  | 'session_end'
  | 'time_elapsed'
  | 'confirmation_threshold'
  | 'manual';

/**
 * Actions for consolidation rules.
 */
export type ConsolidationAction =
  | 'promote_to_episodic'
  | 'promote_to_semantic'
  | 'merge_duplicates'
  | 'archive'
  | 'summarize';

/**
 * Conditions for rule evaluation.
 *
 * @example
 * ```typescript
 * const conditions: RuleConditions = {
 *   minConfidence: 0.8,
 *   minConfirmations: 2,
 *   memoryType: 'working',
 *   useAnd: true,
 * };
 * ```
 */
export interface RuleConditions {
  /** Minimum confidence score (0-1) */
  minConfidence?: number;
  /** Minimum confirmation count */
  minConfirmations?: number;
  /** Minimum access count */
  minAccessCount?: number;
  /** Memory type filter */
  memoryType?: MemoryType;
  /** Entity type filter */
  entityType?: string;
  /** Minimum age in hours */
  minAgeHours?: number;
  /** Use AND logic (default: true) */
  useAnd?: boolean;
}

/**
 * Rule for automatic consolidation.
 *
 * @example
 * ```typescript
 * const rule: ConsolidationRule = {
 *   name: 'Promote confirmed memories',
 *   trigger: 'session_end',
 *   conditions: {
 *     minConfidence: 0.8,
 *     minConfirmations: 2,
 *     memoryType: 'working',
 *   },
 *   action: 'promote_to_episodic',
 *   enabled: true,
 *   priority: 10,
 * };
 * ```
 */
export interface ConsolidationRule {
  /** Rule name for identification */
  name: string;
  /** What triggers this rule */
  trigger: ConsolidationTrigger;
  /** Conditions that must be met */
  conditions: RuleConditions;
  /** Action to take */
  action: ConsolidationAction;
  /** Whether rule is active */
  enabled: boolean;
  /** Optional priority (higher = processed first) */
  priority?: number;
}

/**
 * Result of rule evaluation.
 */
export interface RuleEvaluationResult {
  /** Whether all conditions passed */
  passed: boolean;
  /** Per-condition results */
  details: Record<string, boolean>;
}

// ==================== Context Window Management Types ====================

/**
 * Options for retrieving memories within a token budget.
 *
 * @example
 * ```typescript
 * const options: ContextRetrievalOptions = {
 *   maxTokens: 4000,
 *   context: { currentTask: 'booking', queryText: 'hotel' },
 *   includeWorkingMemory: true,
 *   includeEpisodicRecent: true,
 *   mustInclude: ['user_preferences'],
 * };
 * ```
 */
export interface ContextRetrievalOptions {
  /** Maximum token budget for retrieved memories */
  maxTokens: number;
  /** Salience context for relevance scoring */
  context?: SalienceContext;
  /** Include working memory entities (default: true) */
  includeWorkingMemory?: boolean;
  /** Include recent episodic memories (default: true) */
  includeEpisodicRecent?: boolean;
  /** Include semantically relevant memories (default: true) */
  includeSemanticRelevant?: boolean;
  /** Entity names that must be included regardless of budget */
  mustInclude?: string[];
  /** Minimum salience score to consider (default: 0) */
  minSalience?: number;
}

/**
 * Token breakdown by memory type.
 */
export interface TokenBreakdown {
  /** Tokens used by working memory */
  working: number;
  /** Tokens used by episodic memory */
  episodic: number;
  /** Tokens used by semantic memory */
  semantic: number;
  /** Tokens used by procedural memory */
  procedural: number;
  /** Tokens used by must-include entities */
  mustInclude: number;
}

/**
 * Result of context window memory retrieval.
 *
 * @example
 * ```typescript
 * const result: ContextPackage = {
 *   memories: [entity1, entity2],
 *   totalTokens: 3500,
 *   breakdown: { working: 1000, episodic: 2000, semantic: 500, procedural: 0, mustInclude: 0 },
 *   excluded: [{ entity: entity3, reason: 'budget_exceeded', tokens: 800 }],
 *   suggestions: ['Consider retrieving user_history if more space available'],
 * };
 * ```
 */
export interface ContextPackage {
  /** Retrieved memory entities */
  memories: AgentEntity[];
  /** Total tokens used */
  totalTokens: number;
  /** Token breakdown by memory type */
  breakdown: TokenBreakdown;
  /** Entities that didn't fit in budget */
  excluded: ExcludedEntity[];
  /** Suggestions for additional retrieval if budget increases */
  suggestions: string[];
}

/**
 * Entity excluded from context package with reason.
 */
export interface ExcludedEntity {
  /** The excluded entity */
  entity: AgentEntity;
  /** Why it was excluded */
  reason: 'budget_exceeded' | 'low_salience' | 'filtered';
  /** Estimated tokens for this entity */
  tokens: number;
  /** Salience score at time of exclusion */
  salience?: number;
}
