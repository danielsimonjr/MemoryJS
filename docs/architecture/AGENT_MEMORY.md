# Agent Memory System Design

This document specifies the architectural design for transforming MemoryJS into a comprehensive memory system for AI agents, supporting both short-term (working memory) and long-term (persistent knowledge) memory patterns.

## Overview

AI agents require memory systems that mirror human cognitive patterns: the ability to remember recent context, consolidate important information into long-term storage, forget irrelevant details over time, and retrieve contextually relevant memories efficiently.

### Design Goals

1. **Natural Memory Lifecycle** - Memories should decay, strengthen with use, and consolidate over time
2. **Session Isolation** - Working memory scoped to conversations/tasks
3. **Context-Aware Retrieval** - Recall memories relevant to current goals
4. **Multi-Agent Support** - Shared and private memory spaces
5. **Scalability** - Efficient memory management for long-running agents
6. **Backward Compatibility** - Build on existing MemoryJS primitives

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Memory Interface                        │
│  AgentMemoryManager - Unified API for agent memory operations   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Working Memory  │  │ Episodic Memory │  │ Semantic Memory │ │
│  │ (Short-term)    │  │ (Sessions)      │  │ (Long-term)     │ │
│  │ - TTL-based     │  │ - Conversation  │  │ - Facts         │ │
│  │ - Task context  │  │ - Timeline      │  │ - Concepts      │ │
│  │ - Scratchpad    │  │ - Events        │  │ - Relations     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                    Memory Lifecycle Services                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Access Tracker  │  │ Decay Engine    │  │ Consolidation   │ │
│  │ - Frequency     │  │ - Time decay    │  │ - Summarization │ │
│  │ - Recency       │  │ - Importance    │  │ - Promotion     │ │
│  │ - Patterns      │  │ - Forgetting    │  │ - Abstraction   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                    Context & Retrieval Services                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Salience Engine │  │ Context Window  │  │ Multi-Agent     │ │
│  │ - Dynamic score │  │ - Token budget  │  │ - Identity      │ │
│  │ - Task relevance│  │ - Prioritization│  │ - Visibility    │ │
│  │ - Novelty       │  │ - Spillover     │  │ - Conflict      │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                 MemoryJS Foundation Layer                        │
│  Entity | Relation | Observation | Search | Storage | Graph     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Subsystem Capabilities

The sections after this one describe the original lifecycle services. This section lists the other parts of `src/agent/` that exist today. The per-memory-type sections (Failure, Plan, Reflection, Heuristic, Tool Affordance, Project Context, Decision, Exclusion, Trust) describe the memory types in detail.

- **Roles and cognition.** `RoleProfiles` (5 built-in profiles), an entropy filter, a consolidation scheduler, collaborative synthesis, failure distillation, a cognitive load analyzer, and a 5-tier visibility resolver.
- **Versioning and scoping.** Memory versioning (supersession), project scoping, a contradiction detector, and semantic forget.
- **Temporal relations.** `invalidateRelation`, `queryAsOf`, and `timeline`. Entities and observations also carry bitemporal validity (`validFrom`, `validUntil`, `observationMeta[]`).
- **Wake-up and diary.** `ContextWindowManager.wakeUp` builds a 4-layer memory stack. Each agent has a diary. Local embeddings are the default.
- **Conversation ingest.** `IOManager.ingest` writes an `ingest-<id>` provenance manifest (per-chunk hash and offset, `derived_from` relations, per-observation `sourceRef`). `IngestOptions.mode` is `'accurate' | 'balanced' | 'lightweight'` and maps onto `MemoryDistiller` (`src/agent/reconstruction/MemoryDistiller.ts`), the same distiller that `ReconstructiveMemory` uses.
  - `'lightweight'` never calls the configured `llmProvider`.
  - `'balanced'` (default) lets the distiller decide.
  - `'accurate'` prefers the LLM path. It tightens the heuristic fallback when no external `validate` hook exists.
  - Enrichment (extra `[distilled] ...` observations) runs only when the caller passes `llmProvider`.
- **Conversation memory.** `MemoryEngine` is turn-aware and uses four-tier dedup: exact, prefix, Jaccard, semantic.
- **Backends.** `IMemoryBackend` is pluggable (in-memory or SQLite). `InMemoryBackend` is ephemeral by design; durability belongs to the SQLite backend. `DecayEngine.calculatePrdEffectiveImportance` gives PRD-scale scoring.
- **Quality and learning.** `MemoryValidator` (consistency, contradictions, reliability), `TrajectoryCompressor`, and `ExperienceExtractor`. All three wrap and extend existing components.
- **Multi-agent control.** A conflict view, visibility gates (role and time window), optimistic concurrency control, an audit attribution enforcer, RBAC (Role, Permission, Matrix, Middleware), and `PiiRedactor` for export-time PII scrubbing.
- **World model.** `ProcedureManager` with `StepSequencer`, `ActiveRetrievalController` (iterative query rewriting), `CausalReasoner`, and `WorldModelManager` with `WorldStateSnapshot`.
- **Scale infrastructure.** Agent managers sit on the storage layer and use its optional features without API changes: the mmap branch (`MEMORY_USE_MMAP`) for stores over 100 MB, segment-sharded JSONL (`MEMORY_STORAGE_SEGMENT_COUNT`), the `JsonlColumnStore` columnar observation backend, and `ctx.compressedEntityCache` (`CompressedMap` with `ZlibCompressionAdapter`) for retrieval results. All are opt-in through environment variables.
- **Error contract.** `Result<T, E>` (`src/types/result.ts`) and a documented policy (`CONTRIBUTING.md`): throw for programmer errors, return `Result` for expected domain failures, never swallow errors silently. `AccessTracker.getAccessStats` and `AccessTracker.flush` are synchronous. The absent-value sentinel is `undefined` in `AgentMemoryManager.copyMemory` / `mergeCrossAgent` and `MultiAgentMemoryManager.transferMemory` / `copyMemory` / `mergeCrossAgent`.
- **Observation dedup.** `ObservationDedupManager` (`ctx.observationDedupManager`) finds duplicate observation strings across entities. `findDuplicateObservations` uses SHA-256 exact match. `findJaccardDuplicates` uses token Jaccard with union-find grouping. Both take a `{entityType, projectId, sessionId, minOccurrences, maxGroups}` filter. `ObservationDedupReportStage` emits `[info]`-prefixed diagnostic entries. The manager reports only; it does not merge or strip.
- **Event reification (`@experimental`).** `EventManager` (`agent/events/EventManager.ts`, `ctx.eventManager`) turns actions into `entityType: 'event'` hub entities named `event-<action>-<shortId>`. Role-typed relations (`actor_of`, `targeted`, `occurred_in`, `participant_in`) link each event to its actor, target, context, and participants. An optional `flow:<key>` tag groups events. The API is `recordEvent`, `getEvent`, `queryEvents`, `getFlow`, and `whoDidWhat`. Missing endpoint entities become lightweight `entityType: 'concept'` stubs by default. The layer is a convention over existing storage with no schema change and no new memory type. It reuses `TypeIndex` and `RelationIndex`, so queries stay O(k) or O(1).
- **Relation consolidation (`@experimental`).** `RelationConsolidator` (`agent/RelationConsolidator.ts`) runs a three-tier pass over relations. Tier 1 merges spelling variants. Tier 2 deduplicates by embedding similarity (cosine >= 0.90, needs an injected embedding provider). Tier 3 validates neighborhoods with an injected `LLMProvider`, returns `ConsolidationFeedback`, and never mutates automatically. `RelationConsolidationStage` is a report-only `PipelineStage`. `ManagerContext` does not wire it; callers construct it directly.
- **Stable entity identity.** `Entity.id` is an opaque UUID assigned at creation and kept across updates, renames, and persistence on both backends. `EntityManager.renameEntity(oldName, newName)` rewrites relation endpoints, child `parentId` values, and version-chain fields atomically. It emits `entity:renamed`, then `entity:deleted` / `entity:created`. `ManagerContext` wires `RefIndex` into `EntityManager`, so references remap on rename and purge on delete. `SQLiteStorage` has full `GraphEventEmitter` parity with `GraphStorage` (`storage.events`), so event-driven derived views (TF-IDF sync, `GraphRankPrior`, the columnar observation store) work on both backends.
- **Graph connectivity signals (opt-in).** Every knob defaults to 0 (off).
  - `GraphRankPrior` (`@experimental`) caches normalized PageRank over `GraphTraversal`, with a degree-only fallback. It feeds a fourth `graph` channel on `HybridScorer` / `HybridSearchManager` (`MEMORY_HYBRID_GRAPH_WEIGHT`) and an optional `RankedSearch` boost (`MEMORY_RANKED_GRAPH_BOOST`).
  - `SalienceEngine.connectivityWeight` adds a `connectivityBoost` component (normalized entity degree) to `ScoredEntity.components` (`MEMORY_SALIENCE_CONNECTIVITY_WEIGHT` / `AGENT_MEMORY_SALIENCE_CONNECTIVITY_WEIGHT`).
  - `DecayEngine.connectivityProtection` slows decay for well-connected entities on the legacy decay path only. It needs a degree snapshot, which the batch decay operations or the public `refreshConnectivitySnapshot()` refresh (`MEMORY_DECAY_CONNECTIVITY_PROTECTION` / `AGENT_MEMORY_DECAY_CONNECTIVITY_PROTECTION`).
- **Graph-structured storage.** `ProcedureStore`, `WorkThreadManager`, and `SessionCheckpointManager` store their data as entities and relations: steps, threads, and checkpoints are first-class entities linked by `has_step` / `precedes` / `has_fallback`, `child_of` / `blocked_by`, and `has_checkpoint` / `snapshots`. Legacy single-JSON-blob observations migrate on read. Bulk `migrateLegacy*` helpers and `@deprecated` decoders remain available. `SessionCheckpointManager` takes `entityManager` and `relationManager` in its constructor (the facade wires them). `ReconstructiveMemory`'

## Data Model Extensions

### Extended Entity Interface

```typescript
interface AgentEntity extends Entity {
  // === Memory Classification ===
  memoryType: 'working' | 'episodic' | 'semantic' | 'procedural';

  // === Session & Context ===
  sessionId?: string;           // Conversation/task session grouping
  conversationId?: string;      // Specific conversation identifier
  taskId?: string;              // Associated task/goal

  // === Lifecycle Management ===
  expiresAt?: string;           // Auto-cleanup timestamp (working memory)
  isWorkingMemory?: boolean;    // Temporary flag
  promotedAt?: string;          // When promoted to long-term
  promotedFrom?: string;        // Source session/entity

  // === Access Tracking ===
  accessCount: number;          // Retrieval frequency
  lastAccessedAt?: string;      // Most recent access
  accessPattern?: 'frequent' | 'occasional' | 'rare';

  // === Memory Strength ===
  confidence: number;           // Belief strength
  confirmationCount: number;    // Times verified/reinforced
  decayRate?: number;           // Custom decay multiplier

  // === Multi-Agent ===
  agentId?: string;             // Owning agent identifier
  visibility: 'private' | 'shared' | 'public';
  source?: MemorySource;        // Provenance tracking
}

interface MemorySource {
  agentId: string;
  timestamp: string;
  method: 'observed' | 'inferred' | 'told' | 'consolidated';
  reliability: number;          // Trust score
  originalEntityId?: string;    // If consolidated from another memory
}
```

### Extended Observation Interface

```typescript
interface AgentObservation {
  content: string;

  // === Confidence & Verification ===
  confidence: number;           // How certain
  confirmationCount: number;    // Times verified
  contradictedBy?: string[];    // Conflicting observation IDs

  // === Temporal Context ===
  observedAt: string;           // When this was learned
  validFrom?: string;           // Temporal scope start
  validUntil?: string;          // Temporal scope end (if known)

  // === Source Tracking ===
  source: ObservationSource;

  // === Consolidation ===
  consolidatedFrom?: string[];  // If summarized from multiple observations
  abstractionLevel: number;     // 0=raw, 1=summarized, 2=generalized
}

interface ObservationSource {
  type: 'user_input' | 'agent_inference' | 'external_api' | 'consolidation';
  agentId?: string;
  sessionId?: string;
  rawInput?: string;            // Original input if transformed
}
```

### Session Entity

```typescript
interface SessionEntity extends AgentEntity {
  entityType: 'session';
  memoryType: 'episodic';

  // === Session Metadata ===
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'completed' | 'abandoned';

  // === Context ===
  goalDescription?: string;
  taskType?: string;
  userIntent?: string;

  // === Statistics ===
  memoryCount: number;          // Memories created in session
  consolidatedCount: number;    // Memories promoted to long-term

  // === Relationships ===
  previousSessionId?: string;   // Continuation from prior session
  relatedSessionIds?: string[]; // Linked sessions
}
```

---

## Core Services

### 1. Access Tracker

Tracks memory access patterns to inform decay and retrieval ranking.

```typescript
interface AccessTracker {
  /**
   * Record an access to an entity
   */
  recordAccess(entityName: string, context?: AccessContext): Promise<void>;

  /**
   * Record the same access context for many entities. Delta-capable storage
   * writes all access fields in one updateEntities call; otherwise each
   * entity goes through recordAccess.
   */
  recordAccessBatch(entityNames: readonly string[], context: AccessContext): Promise<void>;

  /**
   * Get access statistics for an entity
   */
  getAccessStats(entityName: string): AccessStats; // synchronous

  /**
   * Calculate recency score based on last access
   */
  calculateRecencyScore(entityName: string, halfLifeHours?: number): number;

  /**
   * Get frequently accessed entities
   */
  getFrequentlyAccessed(limit: number, timeWindow?: Duration): Promise<Entity[]>;

  /**
   * Get recently accessed entities
   */
  getRecentlyAccessed(limit: number, withinHours?: number): Promise<Entity[]>;
}

interface AccessContext {
  sessionId?: string;
  taskId?: string;
  queryContext?: string;        // What query triggered this access
  retrievalMethod?: 'search' | 'direct' | 'traversal';
}

interface AccessStats {
  totalAccesses: number;
  lastAccessedAt: string;
  accessPattern: 'frequent' | 'occasional' | 'rare';
  averageAccessInterval: number; // milliseconds
  accessesBySession: Record<string, number>;
}
```

### 2. Decay Engine

Implements time-based memory decay with importance modulation.

```typescript
interface DecayEngine {
  /**
   * Calculate effective importance considering decay
   * Formula: baseImportance * decayFactor * strengthMultiplier
   */
  calculateEffectiveImportance(entity: AgentEntity): number;

  /**
   * Calculate decay factor based on age
   * Uses exponential decay: e^(-lambda * age)
   */
  calculateDecayFactor(
    lastAccessedAt: string,
    halfLifeHours: number,
    importanceBoost?: number
  ): number;

  /**
   * Get memories that have decayed below threshold
   */
  getDecayedMemories(threshold: number): Promise<AgentEntity[]>;

  /**
   * Apply decay to all memories (background job)
   */
  applyDecay(options?: DecayOptions): Promise<DecayResult>;

  /**
   * Strengthen a memory (reset decay, increase confirmation)
   */
  reinforceMemory(entityName: string, amount?: number): Promise<void>;

  /**
   * Batch form of reinforceMemory. Every name must exist (missing name throws
   * before any write). `alreadyApplied: true` skips the reinforcement write
   * when the caller already persisted it; access tracking still runs.
   */
  reinforceMemories(entityNames: readonly string[], options?: BatchReinforcementOptions): Promise<void>;

  /**
   * Forget memories below threshold
   */
  forgetWeakMemories(options: ForgetOptions): Promise<ForgetResult>;
}

interface DecayOptions {
  halfLifeHours: number;        // Default decay rate
  importanceModulation: boolean; // High importance decays slower
  accessModulation: boolean;     // Frequent access decays slower
  minImportance: number;         // Floor for decay
}

interface ForgetOptions {
  effectiveImportanceThreshold: number;
  olderThanHours?: number;
  excludeTags?: string[];        // Never forget these
  dryRun?: boolean;
}

interface DecayResult {
  entitiesProcessed: number;
  averageDecay: number;
  memoriesAtRisk: number;        // Below threshold but not forgotten
}
```

> **Shipped `DecayEngineConfig` also has** (see the Decay Formula section
> below): `connectivityProtection` (default 0) — well-connected
> entities decay slower in this legacy path; and the PRD-scale sibling
> fields (`decayRate`/`freshnessCoefficient`/`relevanceWeight`/
> `minImportanceThreshold`) that back the separate
> `calculatePrdEffectiveImportance` method, not shown above.

### 3. Consolidation Pipeline

Manages transition from working memory to long-term storage.

```typescript
interface ConsolidationPipeline {
  /**
   * Consolidate session memories into long-term storage
   */
  consolidateSession(sessionId: string, options?: ConsolidateOptions): Promise<ConsolidationResult>;

  /**
   * Summarize similar observations into abstract fact
   */
  summarizeObservations(
    entityName: string,
    similarityThreshold: number
  ): Promise<SummarizationResult>;

  /**
   * Promote working memory to permanent storage
   */
  promoteMemory(
    entityName: string,
    targetType: 'episodic' | 'semantic'
  ): Promise<void>;

  /**
   * Batch promotion. Each name is validated and reported on its own; one
   * failure does not block the others. Returns the promoted entities and
   * per-name errors.
   */
  promoteMemories(
    entityNames: readonly string[],
    targetType: MemoryType
  ): Promise<{ promoted: AgentEntity[]; errors: Array<{ entityName: string; error: string }> }>;

  /**
   * Extract patterns from repeated observations
   */
  extractPatterns(
    entityType: string,
    minOccurrences: number
  ): Promise<PatternResult[]>;

  /**
   * Merge duplicate/similar entities
   */
  mergeMemories(
    entityNames: string[],
    strategy: 'newest' | 'strongest' | 'merge_observations'
  ): Promise<Entity>;

  /**
   * Auto-consolidate based on rules
   */
  runAutoConsolidation(rules: ConsolidationRule[]): Promise<ConsolidationResult>;
}

interface ConsolidateOptions {
  summarize: boolean;            // Summarize observations
  extractPatterns: boolean;      // Find generalizations
  minConfidence: number;         // Only promote confident memories
  minConfirmations: number;      // Require N confirmations
}

interface ConsolidationResult {
  memoriesProcessed: number;
  memoriesPromoted: number;
  memoriesMerged: number;
  patternsExtracted: number;
  summariesCreated: number;
}

interface ConsolidationRule {
  trigger: 'session_end' | 'time_elapsed' | 'confirmation_threshold' | 'manual';
  conditions: {
    minConfidence?: number;
    minConfirmations?: number;
    minAccessCount?: number;
    memoryType?: string;
  };
  action: 'promote' | 'summarize' | 'merge' | 'archive';
}
```

### 4. Salience Engine

Computes context-aware memory relevance.

```typescript
interface SalienceEngine {
  /**
   * Calculate salience score for entity given current context
   */
  calculateSalience(
    entity: AgentEntity,
    context: SalienceContext
  ): number;

  /**
   * Get most salient memories for context
   */
  getMostSalient(
    context: SalienceContext,
    limit: number
  ): Promise<ScoredEntity[]>;

  /**
   * Calculate novelty score (surprising/unexpected)
   */
  calculateNovelty(entity: AgentEntity): number;

  /**
   * Calculate task relevance
   */
  calculateTaskRelevance(
    entity: AgentEntity,
    taskDescription: string
  ): Promise<number>;
}

interface SalienceContext {
  currentTask?: string;          // Active task/goal description
  currentSession?: string;       // Active session ID
  recentEntities?: string[];     // Recently accessed entities
  queryText?: string;            // Current query/question
  userIntent?: string;           // Detected user intent
  temporalFocus?: 'recent' | 'historical' | 'any';
}

interface ScoredEntity {
  entity: AgentEntity;
  salienceScore: number;
  components: {
    baseImportance: number;
    recencyBoost: number;
    frequencyBoost: number;
    contextRelevance: number;
    noveltyBoost: number;
    connectivityBoost: number; // normalized entity degree, only computed when connectivityWeight > 0
  };
}
```

> **Shipped `SalienceEngineConfig` also has** `connectivityWeight`
> (default 0 = disabled) — weight applied to
> `components.connectivityBoost` above. With the default weight the
> signal is never computed, so scores are bit-identical to prior
> behavior. `rankEntitiesBySalience` caches the degree map once per
> ranking batch when enabled.

### 5. Context Window Manager

Manages memory retrieval for LLM context windows.

```typescript
interface ContextWindowManager {
  /**
   * Retrieve memories optimized for token budget
   */
  retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage>;

  /**
   * Estimate token count for entity
   */
  estimateTokens(entity: AgentEntity): number;

  /**
   * Prioritize memories for limited context
   */
  prioritize(
    entities: AgentEntity[],
    maxTokens: number
  ): AgentEntity[];

  /**
   * Handle context overflow
   */
  handleSpillover(
    included: AgentEntity[],
    excluded: AgentEntity[]
  ): SpilloverResult;
}

interface ContextRetrievalOptions {
  maxTokens: number;
  context: SalienceContext;
  includeWorkingMemory: boolean;
  includeEpisodicRecent: boolean;
  includeSemanticRelevant: boolean;
  mustInclude?: string[];        // Entity names to always include
  maxSlots?: number;             // Cap on the number of memories; unset = no cap
  composeHops?: 0 | 1;           // 1 adds one-hop neighbors of the top hybrid hits (query mode only)
  summarizeExcluded?: boolean;   // Summarize the excluded entities into excludedSummary. Off by default. Needs setSummarizer().
}

interface ContextPackage {
  memories: AgentEntity[];
  totalTokens: number;
  sourceTokens: number;          // totalTokens plus the tokens of every excluded entity
  compressionRatio: number;      // sourceTokens / totalTokens; 1 when nothing is excluded
  breakdown: TokenBreakdown;     // working, episodic, semantic, procedural, mustInclude
  excluded: ExcludedEntity[];    // What didn't fit; reason includes slot_limit
  suggestions: string[];         // What to retrieve if more space
  excludedSummary?: string;      // One summary of the excluded entities. Not counted in totalTokens.
}
```

`setSummarizer(summarizer)` attaches a summarizer to the context window manager. Pass `undefined` to detach it. The summary is made only when `summarizeExcluded` is `true`, a summarizer is attached and at least one excluded entity has observation text. The excluded entities are every entity in `excluded`: budget, slot and low-salience cuts. The summarizer receives their observations (entities without observations are left out) and the trimmed query text, or no query when the text is blank. Only `retrieveForContext` reads `summarizeExcluded`; `retrieveWithBudgetAllocation` ignores it. If the summarizer throws, retrieval logs a warning and leaves `excludedSummary` unset. Retrieval does not fail. No production code calls `setSummarizer`.

`setHybridSearch(search)` attaches a hybrid search to the manager. When `context.queryText` is non-blank, `retrieveForContext` orders the candidates by hybrid rank before the salience cut. Only candidates that the hybrid search returns, plus must-include entities, enter the result. If the hybrid search throws, retrieval logs a warning and uses the salience order. The default is off. `ctx.contextWindowManager` attaches it only when `MEMORY_CONTEXT_HYBRID_RANKING` is `true`. `AgentMemoryManager` is not covered. `composeHops: 1` requires an attached hybrid search and a query.

`maxSlots` caps the result in `retrieveForContext` and `retrieveWithBudgetAllocation`. Must-include entities count against the cap and are never cut. Entities that the cap cuts have reason `slot_limit`.

#### Context profiles

A named profile sets the salience weights, the temporal focus and the budget split. The `profile` option selects it. `profile: 'auto'` infers the profile from the query text. The presets are `default`, `planning`, `incident`, `handoff`, `review`, `lookup` and `synthesis`.

The inference checks the rules in this order. The first match wins. If no rule matches, the profile is `default`.

1. `incident`, `planning`, `handoff` and `review`. These match anywhere in the query.
2. `lookup`. The query starts with `who`, `which`, `when` or `where`.
3. `synthesis`. The query starts with `why` or `how`.

A profile can set `retrieval.composeHops` (`0 | 1`). `applyProfile` uses this value when the caller leaves `composeHops` unset. An explicit `composeHops` option wins. The shipped presets do not set `retrieval`. Only `retrieveForContext` reads `composeHops`; `retrieveWithBudgetAllocation` ignores it.

A profile can also set `retrieval.summarizeExcluded`. `applyProfile` uses this value when the caller leaves `summarizeExcluded` unset. An explicit `summarizeExcluded` option wins.

### 6. Working Memory Manager

Manages short-term, session-scoped memory.

```typescript
interface WorkingMemoryManager {
  /**
   * Create working memory for session
   */
  createWorkingMemory(
    sessionId: string,
    content: string,
    options?: WorkingMemoryOptions
  ): Promise<AgentEntity>;

  /**
   * Get all working memories for session
   */
  getSessionMemories(sessionId: string): Promise<AgentEntity[]>;

  /**
   * Clear expired working memories
   */
  clearExpired(): Promise<number>;

  /**
   * Extend TTL for active memories
   */
  extendTTL(entityNames: string[], additionalHours: number): Promise<void>;

  /**
   * Mark memory for promotion consideration
   */
  markForPromotion(entityName: string): Promise<void>;

  /**
   * Get promotion candidates from session
   */
  getPromotionCandidates(sessionId: string): Promise<AgentEntity[]>;
}

interface WorkingMemoryOptions {
  ttlHours?: number;             // Default: 24 hours
  autoPromote?: boolean;         // Auto-promote if confirmed
  taskId?: string;
  importance?: number;
}
```

### 7. Multi-Agent Memory Manager

Handles shared memory spaces and agent identity.

```typescript
interface MultiAgentMemoryManager {
  /**
   * Register an agent
   */
  registerAgent(agentId: string, metadata?: AgentMetadata): Promise<void>;

  /**
   * Create memory with agent ownership
   */
  createAgentMemory(
    agentId: string,
    entity: Partial<AgentEntity>
  ): Promise<AgentEntity>;

  /**
   * Get memories visible to agent
   */
  getVisibleMemories(
    agentId: string,
    filter?: MemoryFilter
  ): Promise<AgentEntity[]>;

  /**
   * Share memory with other agents
   */
  shareMemory(
    entityName: string,
    targetAgents: string[] | 'all'
  ): Promise<void>;

  /**
   * Resolve conflicting memories
   */
  resolveConflict(
    conflictingEntities: string[],
    strategy: ConflictStrategy
  ): Promise<AgentEntity>;

  /**
   * Merge memories from multiple agents
   */
  mergeCrossAgent(
    entityNames: string[],
    trustWeights?: Record<string, number>
  ): Promise<AgentEntity | undefined>; // undefined when < 2 inputs
}

interface AgentMetadata {
  name: string;
  type: string;
  trustLevel: number;            // 0.0-1.0
  capabilities?: string[];
}

type ConflictStrategy =
  | 'most_recent'
  | 'highest_confidence'
  | 'most_confirmations'
  | 'trusted_agent'
  | 'merge_all';
```

---

## Memory Types

### Working Memory (Short-Term)

- **Purpose**: Current task context, recent inputs, scratchpad
- **Lifetime**: Session-scoped, TTL-based (default 24 hours)
- **Characteristics**:
  - High access frequency
  - Volatile (auto-cleanup on expiry)
  - Limited capacity (token budget)
  - Fast retrieval priority

### Episodic Memory

- **Purpose**: Conversation history, events, experiences
- **Lifetime**: Permanent, but subject to decay
- **Characteristics**:
  - Session-grouped
  - Temporal ordering
  - Event sequences
  - Causal relationships

### Semantic Memory

- **Purpose**: Facts, concepts, learned knowledge
- **Lifetime**: Permanent, high stability
- **Characteristics**:
  - High confidence threshold
  - Multiple confirmations
  - Abstract/generalized
  - Entity-centric

### Procedural Memory

- **Purpose**: Skills, patterns, procedures
- **Lifetime**: Permanent
- **Manager**: `ProcedureManager` + `StepSequencer` + `ProcedureStore`
- **Characteristics**:
  - Extracted from repeated observations
  - Rule-based patterns
  - Action sequences executable via `invoke()`
  - **Storage**: `ProcedureStore` persists steps as
    first-class `procedure-step` entities (name
    `${procId}::step-${order}`, `parentId` = procedure) carrying
    `[order]`/`[action]`/`[timeout]`/`[param]` observation lines, linked
    via `has_step`/`precedes`/`has_fallback` relations — not a single
    JSON blob. Legacy `[procedure-steps]:` blob entities auto-migrate on
    `load()`; `migrateLegacyProcedures(entityManager, relationManager)`
    bulk-migrates and `decodeProcedure` remains as the `@deprecated`
    legacy decoder. `ProcedureStore`/`ProcedureManager` constructors
    take an added `RelationManager` — callers going through
    `ctx.procedureManager` are unaffected.

### Prospective Memory

- **Purpose**: Intentions-to-act at a future time / event / condition
- **Lifetime**: Append-only-until-fired; expires per TTL
- **Manager**: `ProspectiveMemoryManager`; `MemoryType: 'prospective'`
- **Pipeline integration**: `ProspectivePromotionStage` promotes fired
  `inject-context` actions to `'episodic'` with `prospective-fulfilled` tag
- **Wake-up surface**: L1.5 layer in `ContextWindowManager.wakeUp`
- **Trigger kinds**: `time-based` / `time-window` / `event` / `conditional`
- **Characteristics**:
  - Single intention per record (flat, not decomposed)
  - Discriminated `ProspectiveLifecycle` (`pending` / `fired` / `cancelled` /
    `expired`)
  - Append-only writes; lifecycle transitions return `CancelResult`
  - Conditional triggers are evaluated by `tick()` through a code-supplied
    `predicateEvaluator` (`ProspectiveMemoryConfig`, or
    `ManagerContextOptions.prospectivePredicateEvaluator`). Only `true`
    fires. Without an evaluator the intention never fires. With
    `checkIntervalMs`, each not-due check persists `lifecycle.lastCheckedAt`
    (an update to an otherwise append-only record)

### Failure Memory

- **Purpose**: Pre-task lookup of "what failed when I tried similar work
  before" — catalog frames this as the single biggest concrete win available
  to most agentic systems
- **Lifetime**: Permanent; `markResolved` flips status without deletion
- **Manager**: `FailureManager`; `MemoryType: 'failure'`
- **Characteristics**:
  - Structured `FailureRecord` with `context` / `attempted` / `failure_mode`
    / `root_cause` / `alternative_taken?` / `applicability_hint` (the
    retrieval key) / `lifecycle` / `sourceSessionId?`
  - Discriminated `FailureLifecycle` (`open` / `resolved`)
  - `lookupForTask(taskContext)` substring-match MVP scoring;
    `SearchManager.semanticSearch` upgrade is a follow-up
  - `markResolved` returns discriminated `MarkResolvedResult`

### Plan Memory

- **Purpose**: Hierarchical goal decomposition + sub-tasks + acceptance
  criteria. Forward-looking like prospective, but mutable and tree-shaped
- **Lifetime**: Active until `markPlanComplete` / `abandonPlan`
- **Manager**: `PlanManager`; `MemoryType: 'plan'`
- **Characteristics**:
  - `PlanRecord` with `rootGoal: GoalNode` (recursive tree), `currentNodeId`,
    history array, optional `sessionId` / `agentId`
  - Discriminated `PlanLifecycle` (`active` / `blocked` / `complete` /
    `abandoned`) + `GoalNodeLifecycle` (`pending` / `active` / `complete` /
    `blocked`)
  - Branded `PlanId` / `GoalNodeId` minted only via UUID helpers
  - `validatePlanInvariants` runs after every mutation (unique ids,
    `currentNodeId ∈ tree`, no cycles)
  - Cycle-protected DFS in `findNodeInTree` / `findPathToNode`
  - Unified `transitionNode(planId, nodeId, transition)` state-machine entry
    point; mutators throw on `storage.updateEntity` returning false

### Reflection Memory

- **Purpose**: Derived insights from pattern + trajectory summary +
  experience extraction over a candidate set. Catalog Type 10
- **Lifetime**: Permanent; soft-delete via `archive`
- **Manager**: `AgentReflectionManager` (named to avoid a collision with
  `src/search/ReflectionManager`; the back-compat barrel alias
  `ReflectionMemoryManager` exists); `MemoryType: 'reflection'`
- **Pipeline integration**: `ReflectionStage` — explicit
  `runOnSessionEnd(sessionId)` helper for session-end triggers, or register
  on the default pipeline
- **Characteristics**:
  - **Additive** (no supersession of evidence entities — episodic
    observations remain queryable)
  - `ReflectionScope` discriminator: `session` / `project` / `global`
  - Content-hash dedup at `create()` (`sha256(scope|sorted(evidence))`)
  - Raw `PatternResult.confidence ≥ 0.4` gate (default);
    `generalization_confidence = clamp(min(1 - compressionRatio,
    maxPatternConfidence), 0, 1)`
  - `getRelevantForSession` returns reflections matching `sourceSessionId`
    OR overlapping `evidence ∩ sessionEntityNames`

### Heuristic Guidelines

- **Purpose**: Crystallise implicit patterns into explicit
  natural-language `condition → action` strategies. Catalog Type 11
- **Lifetime**: Permanent; remove via `HeuristicManager.remove`
- **Manager**: storage-backed `HeuristicManager` (`@experimental` match
  algorithm); `MemoryType: 'heuristic'`; accessed via `ctx.heuristicManager`
- **Pipeline integration**: `HeuristicExtractionStage` — scans resolved
  `FailureRecord`s (with `resolvedReason` + `alternative_taken`) and
  qualifying `ReflectionRecord`s (with `experienceType` set and
  `generalization_confidence >= minConfidence`). One heuristic per
  reflection `keyInsight`. Content-hash idempotency
  (`h_${sha256(condition|action)}`). `runOnResolution(failureId)` helper
  for explicit single-failure passes; not auto-registered on the default
  pipeline
- **Characteristics**:
  - `Heuristic` record carries `condition`, `action`, `confidence`,
    `support`, `contradictions`, `priority?`
  - `match(input)` — Jaccard token-overlap × confidence, descending;
    ties broken by `priority`
  - `reinforce` / `recordContradiction` — OCC-protected via
    `EntityManager.updateEntity({expectedVersion})`; new discriminated
    `HeuristicUpdateResult` (`'updated' | 'not-found' | 'conflict' |
    'vanished-mid-update'`) — `'conflict'` surfaces `VersionConflictError`
  - `detectConflicts` — pair-wise overlap/contradiction detection
    (negation prefixes: `don't` / `do not` / `never` / `avoid`)
  - `HeuristicManager.add` accepts an optional content-addressed `id`
    for caller-managed idempotency

### Tool Affordance (catalog Type 8)

- **Purpose**: Per-tool rolling outcome statistics for adaptive tool
  selection — "which tools work / fail for which task patterns,
  including success rates, common failure modes, and cost estimates."
  Closes the catalog's Type 8
- **Lifetime**: Permanent; one record per `toolName` (entity name is
  `tool-affordance-${toolName}`)
- **Manager**: `ToolAffordanceManager`; `MemoryType: 'tool_affordance'`;
  accessed via `ctx.toolAffordanceManager`
- **Schema**: `outcomes[]` (rolling window of `ToolCallOutcome`,
  default 100) + derived `successRate` / `commonFailureModes[]` /
  `avgDurationMs` / `totalCalls` lifetime
- **Manager surface**: `recordOutcome(toolName, {outcome,
  errorMessage?, durationMs?})` (creates on first call, appends +
  recomputes on subsequent — OCC-protected with
  `VersionConflictError` re-thrown so producers decide retry policy);
  `rollingStats(toolName)` returns the flat snake-case shape;
  `suggestTool(taskHint, {limit?, minScore?})` ranks by
  `successRate × recencyFactor`; `get` / `list` / `remove`
- **Producer pipeline**: `ToolCallObserver`
  (`ctx.toolCallObserver`) is the canonical caller. `observeStart` →
  `observeComplete` / `observeError` / `observePartial` close the
  observation, compute `durationMs`, and emit `toolCall:*` events for
  telemetry subscribers
- **MCP adapter**: `MCPToolObserverAdapter`
  (`src/adapters/MCPToolObserverAdapter.ts`) wraps MCP-shaped tool-call
  envelopes (`{name}` / `{tool}` / `{method: 'tools/call', params:
  {name}}`); structural typing — no `@modelcontextprotocol/sdk` dep
  added
- **CLI**: `memory tool-affordance list|show|stats|suggest`
- **Scope note**: MemoryJS tracks tool-call outcomes, not just
  memories. See [`TOOL_AFFORDANCE_PLAN.md`](../roadmap/TOOL_AFFORDANCE_PLAN.md)

### Project Context

- **Purpose**: Structured project-knowledge memory — runtime-queryable
  companion to unstructured CLAUDE.md content. Catalog Type 2 enhancement
- **Lifetime**: Permanent; one record per `projectId` (uniqueness
  enforced at manager level). Entity name is
  `project-context-${projectId}`
- **Manager**: `ProjectContextManager`; `MemoryType: 'project_context'`;
  accessed via `ctx.projectContextManager`
- **Schema**: `facts[]` / `conventions[]` / `commands[]` (name + command +
  purpose) / `glossary[]` (term + definition). Plus `id` (== projectId),
  `timestamp`, `lastUpdated`
- **Manager surface**: `upsert(projectId, partial)` with array
  append+dedup and scalar overwrite; typed appenders (`appendFact` /
  `appendConvention` / `appendCommand` / `appendGlossaryTerm` —
  auto-create the record on first call); removers (`removeFact` /
  `removeConvention` / `removeCommand` (by name) / `removeGlossaryTerm`
  (by term)); `clear(projectId)` wipes the four arrays but keeps the
  entity; `get(projectId)` is sync via name index; `forContext(projectId,
  {budgetChars?})` formats as prose with ellipsis truncation. Mutations
  OCC-protected via `EntityManager.updateEntity({expectedVersion})`
- **wakeUp integration**: when `options.projectId` is set,
  `ContextWindowManager.wakeUp` populates `WakeUpResult.projectContext`
  with the prose summary (token budget via `maxProjectContextTokens`,
  default 300). Consumers concatenate `projectContext` ABOVE `l0` for
  system-prompt assembly; the result type is flat
- **CLI**: `memory project-context show|append-fact|append-convention|append-command|append-glossary|clear`

### Decision Rationale

- **Purpose**: Runtime-queryable architecture-decision-record (ADR)
  memory. Lets an agent answer "have we already decided X?" without
  scanning markdown files. Catalog Type 11
- **Lifetime**: Permanent. Lifecycle:
  proposed → accepted | rejected; accepted → superseded
- **Manager**: `DecisionManager`; `MemoryType: 'decision'`; accessed via
  `ctx.decisionManager`
- **Lifecycle methods**: `propose(input, options?)` (defaults to importance 8) /
  `accept(id)` / `reject(id, reason)` / `supersede(id, by)`. All return
  discriminated results (`'accepted' | 'already-accepted' | 'not-found' |
  'illegal-transition' | 'conflict' | 'vanished-mid-update'`) — same shape
  as `MarkResolvedResult` across agent-memory managers. OCC-protected via
  `EntityManager.updateEntity({expectedVersion})`
- **Query**: `findByContext(query)` substring-matches against
  `context` / `decision` / `consequences`. `getChain(id)` walks the
  `supersedes` link backward to the original proposal (cycle-protected).
  `list({status?, sourceSessionId?, sourceProjectId?, limit?})`
  enumerates with filters
- **ADR markdown dual-write**: `exportAsAdrMarkdown(id)` renders the
  canonical ADR layout; `DecisionManager.parseAdrMarkdown(text)` (static)
  parses a hand-written or previously-exported ADR into a
  `DecisionInput`. Returns `null` when required `## Context` or
  `## Decision` sections are missing. Status / Supersedes in the
  markdown are informational only — imports flow through `propose()` and
  start as `'proposed'`. File IO stays out of the manager; consumers
  (CLI) own `fs.readFileSync` / `writeFileSync`
- **CLI**: `memory decision propose|accept|reject|supersede|list|find|export|import`

### Exclusion (`do_not_remember`)

- **Purpose**: User-supplied content-pattern exclusion rules. Hard-delete
  existing matches on `add`; write-block future matches at the two hot
  write paths (`MemoryEngine.addTurn`, `WorkingMemoryManager.createWorkingMemory`).
  Distinct from `PiiRedactor` (which does structural pattern redaction for
  credit-card / SSN-shaped content) — this is free-form user-supplied
  content filtering
- **Lifetime**: Permanent; remove via `ExclusionManager.remove` (does
  NOT restore previously-deleted memories — the contract is "user said
  forget")
- **Manager**: `ExclusionManager`; `MemoryType: 'exclusion'`; accessed
  via `ctx.exclusionManager`
- **Hot-path integration**: `MemoryEngine.addTurn` returns
  `{ blocked: true, blockedByRuleId, blockedReason? }` and emits
  `memoryEngine:writeBlocked` when a rule matches.
  `WorkingMemoryManager.createWorkingMemory` throws
  `MemoryWriteBlockedError`. Both run BEFORE other gates (dedup /
  entropy) — user policy beats heuristics
- **CLI**: `memory exclude add <pattern>` / `memory exclude list` /
  `memory exclude remove <id>` for the hand-typed-rule use case
- **v1 scope cut**: substring matching only. `regex` mode is reserved
  on the `ExclusionMode` union as a future widening point — its ReDoS
  surface requires a careful design (timeout + max length cap +
  governance integration) that's deferred

### Trust Hierarchy Mixin

- **Purpose**: Categorical complement to the numeric `reliability` /
  `confidence` / `AgentMetadata.trustLevel` scores. Discriminated label
  on `MemorySource` so conflict resolution can use explicit ordering
  ("user-authored beats tool-verified regardless of recency") instead of
  scalar comparison
- **Scope**: Provenance metadata on every memory record (cross-cutting,
  not a memory-type slot)
- **Surface**: `MemorySource.trustLevel?: TrustLevel`; `inferTrustLevel`
  backfill from `method` + `reliability` (defensive NaN guard); new
  `'trust_level'` `ConflictStrategy` in `ConflictResolver`
- **Ordering**: `ground-truth` > `verified` > `inferred` > `unverified`;
  ties broken by recency (`lastModified` → `createdAt`)
- **Tuning**: `DEFAULT_TRUST_THRESHOLDS` exported for per-deployment
  override; `compareTrustLevel` standard comparator

---

## Memory Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                        Memory Lifecycle                           │
└──────────────────────────────────────────────────────────────────┘

    INPUT                WORKING MEMORY              LONG-TERM
      │                       │                          │
      ▼                       ▼                          ▼
┌──────────┐           ┌──────────────┐          ┌──────────────┐
│ New Info │──────────▶│   Session    │          │   Episodic   │
│ Observed │           │   Scoped     │          │   Memory     │
└──────────┘           │   TTL-based  │          └──────────────┘
                       └──────────────┘                  ▲
                              │                          │
                              │ Promotion                │
                              │ (confidence +            │
                              │  confirmations)          │
                              ▼                          │
                       ┌──────────────┐                  │
                       │ Consolidation│──────────────────┘
                       │   Pipeline   │
                       └──────────────┘
                              │
                              │ Abstraction
                              │ (patterns +
                              │  summarization)
                              ▼
                       ┌──────────────┐
                       │   Semantic   │
                       │   Memory     │
                       └──────────────┘

    DECAY & FORGETTING
    ───────────────────

    All memories subject to:
    - Time-based decay (exponential)
    - Importance modulation (high importance decays slower)
    - Access reinforcement (frequent access resets decay)
    - Threshold forgetting (below threshold = archived/deleted)
```

---

## Retrieval Strategy

### Context-Aware Retrieval Algorithm

```
1. PARSE QUERY CONTEXT
   - Extract task/goal
   - Identify temporal scope
   - Detect entities mentioned
   - Determine user intent

2. RETRIEVE CANDIDATES
   - Working memory (current session)
   - Recent episodic (last N sessions)
   - Semantically similar (embedding search)
   - Graph neighbors (related entities)

3. SCORE CANDIDATES
   For each candidate:
     salience = (
       base_importance * decay_factor +
       recency_boost +
       frequency_boost +
       context_relevance +
       novelty_bonus
     )

4. RANK & FILTER
   - Sort by salience score
   - Apply token budget
   - Ensure diversity (avoid redundancy)
   - Include must-have entities

5. PACKAGE FOR CONTEXT
   - Format for LLM consumption
   - Include metadata hints
   - Track what was excluded
```

### Decay Formula

```
effective_importance = base_importance * decay_factor * strength_multiplier

where:
  decay_factor = e^(-ln(2) * age_hours / half_life_hours)

  strength_multiplier = 1 + (confirmation_count * 0.1) + (access_count * 0.01)

  half_life_hours = base_half_life * (1 + importance_boost)
    where importance_boost = base_importance / 10
```

**Connectivity protection (off by default):** when
`DecayEngine`'s `connectivityProtection` config is > 0, `decay_factor`
above is replaced by an `effective_decay_factor` that is lifted toward 1
for well-connected entities:

```
effective_decay_factor = decay_factor +
  (1 - decay_factor) * connectivity_protection * normalized_degree

where normalized_degree = entity's relation degree / max degree in graph
```

`normalized_degree` comes from a cached snapshot (`calculateEffectiveImportance`
is synchronous) refreshed automatically by the batch decay operations
(`applyDecay`, `getDecayedMemories`, `getMemoriesAtRisk`,
`forgetWeakMemories`) or explicitly via `refreshConnectivitySnapshot()`;
before the first refresh no protection is applied. At `connectivity_protection
= 1` a max-degree entity does not decay at all; at `0` (default) behavior is
unchanged. This applies only to `calculateEffectiveImportance` — the PRD-scale
`calculatePrdEffectiveImportance` path is untouched.

---

## API Usage Examples

### Creating Session with Working Memory

```typescript
const agentMemory = new AgentMemoryManager(ctx);

// Start new session
const session = await agentMemory.startSession({
  goalDescription: 'Help user plan a trip to Japan',
  taskType: 'planning'
});

// Add working memory
await agentMemory.addWorkingMemory(session.id, {
  content: 'User prefers budget travel',
  confidence: 0.9,
  source: { type: 'user_input' }
});

await agentMemory.addWorkingMemory(session.id, {
  content: 'Trip duration: 2 weeks in April',
  confidence: 1.0,
  source: { type: 'user_input' }
});
```

### Context-Aware Retrieval

```typescript
// Get memories for current context
const contextPackage = await agentMemory.retrieveForContext({
  maxTokens: 4000,
  context: {
    currentTask: 'Recommend hotels in Tokyo',
    currentSession: session.id,
    queryText: 'What hotels fit my budget?'
  },
  includeWorkingMemory: true,
  includeSemanticRelevant: true
});

// Use in LLM prompt
const memories = contextPackage.memories
  .map(m => `- ${m.name}: ${m.observations.join('; ')}`)
  .join('\n');
```

### Memory Consolidation

```typescript
// At session end, consolidate important memories
await agentMemory.consolidateSession(session.id, {
  summarize: true,
  minConfidence: 0.7,
  minConfirmations: 1
});

// Or run automatic consolidation
await agentMemory.runAutoConsolidation([
  {
    trigger: 'session_end',
    conditions: { minConfidence: 0.8, minConfirmations: 2 },
    action: 'promote'
  },
  {
    trigger: 'confirmation_threshold',
    conditions: { minConfirmations: 5 },
    action: 'summarize'
  }
]);
```

### Multi-Agent Scenario

```typescript
const multiAgent = new MultiAgentMemoryManager(ctx);

// Register agents
await multiAgent.registerAgent('planner', { trustLevel: 0.9 });
await multiAgent.registerAgent('researcher', { trustLevel: 0.8 });

// Create shared memory
await multiAgent.createAgentMemory('researcher', {
  name: 'Tokyo_Hotels_Research',
  visibility: 'shared',
  observations: ['Budget hotels in Shinjuku: $50-80/night']
});

// Planner accesses shared memory
const visible = await multiAgent.getVisibleMemories('planner', {
  visibility: ['shared', 'public']
});
```

---

## Configuration

### Environment Variables

```bash
# Memory lifecycle
MEMORY_WORKING_TTL_HOURS=24           # Working memory default TTL
MEMORY_DECAY_HALF_LIFE_HOURS=168      # 1 week default half-life
MEMORY_DECAY_MIN_IMPORTANCE=0.1       # Floor for decay
MEMORY_FORGET_THRESHOLD=0.05          # Below this = forget

# Consolidation
MEMORY_AUTO_CONSOLIDATE=true          # Enable auto-consolidation
MEMORY_CONSOLIDATE_MIN_CONFIDENCE=0.7
MEMORY_CONSOLIDATE_MIN_CONFIRMATIONS=2

# Context window
MEMORY_DEFAULT_TOKEN_BUDGET=4000
MEMORY_CONTEXT_HYBRID_RANKING=false   # true: rank candidates with hybrid search when queryText is set
MEMORY_TOKEN_ESTIMATOR=tiktoken       # Token counting method

# Multi-agent
MEMORY_MULTI_AGENT_ENABLED=false
MEMORY_DEFAULT_VISIBILITY=private
```

### Programmatic Configuration

```typescript
const config: AgentMemoryConfig = {
  decay: {
    enabled: true,
    halfLifeHours: 168,
    importanceModulation: true,
    accessModulation: true,
    minImportance: 0.1,
    forgetThreshold: 0.05
  },
  consolidation: {
    autoEnabled: true,
    triggers: ['session_end', 'confirmation_threshold'],
    minConfidence: 0.7,
    minConfirmations: 2,
    summarizationProvider: 'openai'
  },
  workingMemory: {
    defaultTTLHours: 24,
    maxPerSession: 100,
    autoPromote: true
  },
  retrieval: {
    defaultTokenBudget: 4000,
    recencyBoostWeight: 0.2,
    frequencyBoostWeight: 0.1,
    noveltyBoostWeight: 0.1
  },
  multiAgent: {
    enabled: false,
    defaultVisibility: 'private',
    conflictStrategy: 'highest_confidence'
  }
};
```

---

## Testing Strategy

### Unit Tests
- Decay calculations
- Access tracking updates
- Salience scoring
- Token estimation
- Consolidation rules

### Integration Tests
- Full memory lifecycle (create → access → decay → forget)
- Session management (start → add memories → consolidate → end)
- Retrieval accuracy (relevant memories returned)
- Multi-agent scenarios (visibility, conflicts)

### Performance Tests
- Decay processing at scale (10k+ entities)
- Retrieval latency with token budgeting
- Consolidation throughput
- Concurrent multi-agent access

---

## Future Considerations

### Parametric Memory
Extract learned patterns instead of storing examples:
- Rule induction from observations
- Prototype extraction from similar entities
- Skill compilation from procedural memories

### Temporal Indexing
Efficient time-range queries:
- B-tree index on timestamps
- Time-bucketed storage
- Event sequence optimization

### Distributed Memory
Multi-node agent memory:
- Memory replication
- Consistency protocols
- Federated queries

### Memory Visualization
Debug and inspection tools:
- Memory timeline view
- Decay visualization
- Access pattern graphs
- Consolidation audit trail

## Knowledge repository and recursive learning

Recursa (`docs/development/RECURSA_SPEC_2026-11-06.md`) maps the paper's concepts onto MemoryJS (spec §1):

| Paper | MemoryJS |
|---|---|
| Knowledge repository `K`, snapshots `K^(t)` | `KnowledgeRepository` over skills (`SkillManager`) and instruction sets; `K-<n>` snapshot entities |
| `SOLVE(x, K)` | caller's `LearningSolver` with `loadForContext` output |
| Leaf `LEARN` (diagnose → edit → validate) | `Diagnoser`, `KnowledgeEditor`, `RevisionValidator`, `LeafLearner` |
| Recursive `LEARN` (split → children → merge → reflect) | `SplitStrategies`, `RecursiveLearner`, `ChildKnowledgeOverlay`, `RevisionMerger`, `LearningReflector` |
| Learning trace `T` | `learning_trace` entities (`LearningTrace`), `child_of` relations |
| Bootstrapping on a new corpus | `CorpusMapper`, `BoundaryRecorder`, `ExplorationNotes`, `PracticeTaskGenerator`, `Bootstrapper` |

Rules that hold across the loop:

- Children never write live `K`; only the parent's merged, validated revision is applied (OCC on the round snapshot).
- A recursive round's result is measured on live `K` after the apply, not taken from the children.
- A skill learned for a task carries `task:<id>` in `scope.tasks` and is always loaded for that task.
- Reflections (`scope: 'learning'`) carry the split hint `prefer-split:<name>` that steers the next `auto` split.

## Verification

Two tools measure this repository. The two tools use different scopes.

The table holds `repo-tools map` metrics. `repo-tools map` parses the whole repository. The gate compares each row with a fresh parse.
Regenerate: `repo-tools map . --out=<dir>` · Check: `repo-tools check . --docs=docs/architecture`

| Claim | Value | Source |
|---|---|---|
| totalSourceFiles | 1014 | repo-tools map |
| totalModules | 7 | repo-tools map |
