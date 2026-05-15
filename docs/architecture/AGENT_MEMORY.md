# Agent Memory System Design

**Last reviewed**: 2026-05-15 (v2.0.x + Phase 2 memory-types expansion Sprints 4–6 + 8 + Phase 3B.8 Heuristic Guidelines Manager)

This document specifies the architectural design for transforming MemoryJS into a comprehensive memory system for AI agents, supporting both short-term (working memory) and long-term (persistent knowledge) memory patterns.

> **What's shipped on top of the original design** — the per-component
> sections below predate v1.9; this banner is the source of truth for
> what's in `src/agent/` today:
>
> - **v1.7.0** — Role profiles (`RoleProfiles`, 5 built-ins), entropy filter,
>   consolidation scheduler, collaborative synthesis, failure distillation,
>   cognitive load analyzer, visibility resolver (5-tier).
> - **v1.8.0** — Memory versioning (supersession), project scoping,
>   contradiction detector + semantic forget.
> - **v1.9.0** — Temporal relations (`invalidateRelation`/`queryAsOf`/`timeline`),
>   `ContextWindowManager.wakeUp` 4-layer memory stack, conversation ingest,
>   per-agent diary, local-embeddings default.
> - **v1.11.0** — `MemoryEngine` turn-aware conversation memory with
>   four-tier dedup (exact / prefix / Jaccard / semantic).
> - **v1.12.0** — Pluggable `IMemoryBackend` (in-memory / sqlite),
>   `DecayEngine.calculatePrdEffectiveImportance` PRD-scale scoring.
> - **v1.13.0 (Phase δ)** — `MemoryValidator` (consistency / contradictions /
>   reliability), `TrajectoryCompressor`, `ExperienceExtractor`. All
>   wrap-and-extend per ADR-011.
> - **Unreleased (η.4.4)** — Bitemporal validity for entities + observations
>   (`validFrom` / `validUntil` / `observationMeta[]`).
> - **Unreleased (η.5.5)** — Multi-agent conflict view, visibility expansion
>   (role + time-window gates), optimistic concurrency control, audit
>   attribution enforcer.
> - **Unreleased (η.6.1 / η.6.3)** — RBAC (Role / Permission / Matrix /
>   Middleware), `PiiRedactor` for export-time PII scrubbing.
> - **Unreleased (3B.4–3B.7)** — Procedural memory (`ProcedureManager` +
>   `StepSequencer`), active retrieval (`ActiveRetrievalController` with
>   iterative query rewriting), causal reasoning (`CausalReasoner`),
>   world-model orchestrator (`WorldModelManager` + `WorldStateSnapshot`).
> - **v1.15.0 (Phases 0–11 performance & scale)** — The agent memory subsystem
>   benefits transparently from infrastructure improvements in PR #34:
>   `EpisodicMemoryManager` and `WorkingMemoryManager` now sit on top of
>   `GraphStorage`'s optional mmap branch (`MEMORY_USE_MMAP`) for >100 MB
>   stores, segment-sharded JSONL (`MEMORY_STORAGE_SEGMENT_COUNT`) for
>   parallel reads, and the `JsonlColumnStore` columnar observation backend
>   for very-wide entity rows. `ContextWindowManager` retrieval results now
>   pass through `ctx.compressedEntityCache` (`CompressedMap` with
>   `BrotliCompressionAdapter`) so retrieved entities cost ~80% less RAM
>   at rest. No agent-memory API changes; opt-in via env vars.
> - **Phase 2 memory-types expansion (2026-05)** — Four new catalog-aligned
>   `MemoryType` slots and one provenance mixin:
>   - **Sprint 4** — `FailureManager` + `MemoryType: 'failure'`. Structured
>     `FailureRecord` (`context` / `attempted` / `failure_mode` / `root_cause` /
>     `applicability_hint`) for pre-task failure lookup. `markResolved` returns
>     discriminated `MarkResolvedResult`.
>   - **Sprint 5** — `PlanManager` + `MemoryType: 'plan'`. Hierarchical
>     `PlanRecord` with `GoalNode` tree, discriminated `PlanLifecycle` /
>     `GoalNodeLifecycle`, branded `PlanId` / `GoalNodeId`,
>     `validatePlanInvariants` after every mutation, cycle-protected DFS.
>   - **Sprint 6 (partial)** — `TrustLevel` discriminated mixin on
>     `MemorySource` (`ground-truth` / `verified` / `inferred` / `unverified`)
>     with `inferTrustLevel` backfill and `'trust_level'` `ConflictStrategy`.
>     `CollaborativeSynthesis.resolveConflicts` ordering integration deferred.
>   - **Sprint 8** — `ReflectionManager` + `MemoryType: 'reflection'` +
>     `ReflectionStage` pipeline stage. Additive (no supersession of evidence);
>     content-hash dedup at create; raw `PatternResult.confidence ≥ 0.4` gate;
>     session-end scheduling via `runOnSessionEnd(sessionId)` helper.
>     Aliased export `ReflectionMemoryManager` at the agent barrel to avoid
>     collision with `src/search/ReflectionManager` (progressive query
>     refinement).
>
>   Common conventions across all four sprints: branded ids, discriminated
>   lifecycle unions, `MarkResolvedResult`-style returns,
>   `validate*Invariants` after mutation, `storage.updateEntity:
>   Promise<boolean>` branched to surface `vanished-mid-update`. See
>   `docs/roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md` for design rationale.
> - **v2.0.0 (seven-theme function/API-call consistency & efficiency audit)** —
>   Two changes touch the agent-memory surface directly: `AccessTracker.getAccessStats`
>   and `AccessTracker.flush` dropped their needless `Promise` wrappers (now
>   synchronous — Theme 3, breaking), and the absent-value sentinel was
>   standardized to `undefined` across `AgentMemoryManager.copyMemory` /
>   `mergeCrossAgent` and `MultiAgentMemoryManager.transferMemory` / `copyMemory`
>   / `mergeCrossAgent` (were `T | null` — Theme 5, breaking). New shared
>   `Result<T, E>` discriminated union (`src/types/result.ts`) plus a documented
>   error-signalling policy (`CONTRIBUTING.md`): throw for programmer errors,
>   return `Result` for expected domain failures, never swallow silently.
> - **v2.0.x (Phase 3B.8 Heuristic Guidelines Manager)** — Last 3B item,
>   closes the "From Storage to Experience" series. Storage-backed
>   `HeuristicManager` (`@experimental` match algorithm) with new
>   `MemoryType: 'heuristic'`, `HeuristicEntity`, `HeuristicId`, and
>   `ctx.heuristicManager` lazy getter (3B.8a). Companion
>   `HeuristicExtractionStage` crystallises resolved `FailureRecord`s and
>   qualifying `ReflectionRecord`s into heuristics with content-hash
>   idempotency (3B.8b). Mutating writes use `EntityManager` OCC and surface
>   `'conflict'` via a new `HeuristicUpdateResult`, matching the #55 pattern.
>   Both constructors are breaking; the class was `@experimental`.
> - **v2.0.x (Entity-level observation dedup)** — `ObservationDedupManager`
>   surfaces cross-entity duplicate observation strings (the gap between
>   `MemoryEngine`'s turn-level dedup and `CompressionManager`'s
>   entity-grouping dedup). `findDuplicateObservations` (SHA-256 exact)
>   and `findJaccardDuplicates` (token Jaccard with union-find grouping)
>   take a `{entityType, projectId, sessionId, minOccurrences, maxGroups}`
>   filter. `ctx.observationDedupManager` lazy getter; companion
>   `ObservationDedupReportStage` emits `[info]`-prefixed diagnostic
>   entries when registered on a pipeline. Report-only; merge/strip
>   actions deferred as follow-ups.
> - **v2.0.x (Phase 3 Decision Rationale)** — `DecisionManager` ships a
>   runtime-queryable ADR-equivalent memory (`MemoryType: 'decision'`).
>   Lifecycle: proposed → accepted | rejected; accepted → superseded.
>   All lifecycle mutations are OCC-protected and return discriminated
>   results with `'conflict'` / `'illegal-transition'` arms.
>   `findByContext` substring search; `getChain` walks the supersedes
>   link. ADR markdown dual-write via `exportAsAdrMarkdown(id)` /
>   `DecisionManager.parseAdrMarkdown(text)` (static). CLI:
>   `memory decision propose|accept|reject|supersede|list|find|export|import`.
> - **v2.0.x (Phase 3 `do_not_remember`)** — `ExclusionManager` registers
>   content-pattern exclusion rules (`MemoryType: 'exclusion'`).
>   `add()` hard-deletes existing matches on past-scope; `check()` is
>   wired into `MemoryEngine.addTurn` (returns `blocked: true` result +
>   `memoryEngine:writeBlocked` event) and `WorkingMemoryManager.createWorkingMemory`
>   (throws `MemoryWriteBlockedError`). v1 ships substring matching only;
>   `regex` mode reserved on the `ExclusionMode` union as a future
>   widening point. CLI: `memory exclude add|list|remove`.

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
  confidence: number;           // Belief strength (0.0-1.0)
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
  reliability: number;          // Trust score (0.0-1.0)
  originalEntityId?: string;    // If consolidated from another memory
}
```

### Extended Observation Interface

```typescript
interface AgentObservation {
  content: string;

  // === Confidence & Verification ===
  confidence: number;           // How certain (0.0-1.0)
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
   * Get access statistics for an entity
   */
  getAccessStats(entityName: string): AccessStats; // v2.0.0: synchronous (Theme 3)

  /**
   * Calculate recency score (0.0-1.0) based on last access
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
  };
}
```

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
}

interface ContextPackage {
  memories: AgentEntity[];
  totalTokens: number;
  breakdown: {
    workingMemory: number;
    episodic: number;
    semantic: number;
  };
  excluded: string[];            // What didn't fit
  suggestions: string[];         // What to retrieve if more space
}
```

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
  ): Promise<AgentEntity | undefined>; // v2.0.0: undefined when < 2 inputs (Theme 5)
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

- **Purpose**: Skills, patterns, procedures (3B.4)
- **Lifetime**: Permanent
- **Manager**: `ProcedureManager` + `StepSequencer` + `ProcedureStore`
- **Characteristics**:
  - Extracted from repeated observations
  - Rule-based patterns
  - Action sequences executable via `invoke()`

### Prospective Memory (v1.14 / Phase 1)

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

### Failure Memory (Sprint 4)

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

### Plan Memory (Sprint 5)

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

### Reflection Memory (Sprint 8)

- **Purpose**: Derived insights from pattern + trajectory summary +
  experience extraction over a candidate set. Catalog Type 10
- **Lifetime**: Permanent; soft-delete via `archive`
- **Manager**: `ReflectionManager` (publicly aliased as
  `ReflectionMemoryManager`); `MemoryType: 'reflection'`
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

### Heuristic Guidelines (Phase 3B.8)

- **Purpose**: Crystallise implicit patterns into explicit
  natural-language `condition → action` strategies. Catalog Type 11 —
  the final 3B item, closes the "From Storage to Experience" memory
  evolution series
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

### Decision Rationale (Phase 3)

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

### Exclusion (`do_not_remember`, Phase 3)

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

### Trust Hierarchy Mixin (Sprint 6)

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
MEMORY_SUMMARIZATION_PROVIDER=openai  # For LLM summarization

# Context window
MEMORY_DEFAULT_TOKEN_BUDGET=4000
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

## Implementation Phases

### Phase 1: Memory Lifecycle Foundation
- Extend Entity with access tracking fields
- Implement AccessTracker service
- Add recency-weighted search scoring
- Implement basic decay calculations
- Add working memory TTL support

### Phase 2: Session & Episodic Memory
- Create Session entity type
- Implement WorkingMemoryManager
- Add session-scoped queries
- Implement memory expiration cleanup
- Add promotion pipeline basics

### Phase 3: Decay & Consolidation
- Implement full DecayEngine
- Add observation summarization
- Build ConsolidationPipeline
- Add pattern extraction
- Implement auto-consolidation rules

### Phase 4: Context-Aware Retrieval
- Implement SalienceEngine
- Build ContextWindowManager
- Add task relevance scoring
- Implement novelty detection
- Add context-optimized retrieval

### Phase 5: Multi-Agent Support
- Add agent identity fields
- Implement visibility controls
- Build MultiAgentMemoryManager
- Add conflict resolution
- Implement cross-agent memory merge

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
