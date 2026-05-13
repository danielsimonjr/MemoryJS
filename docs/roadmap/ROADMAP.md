# MemoryJS Future Features Development Roadmap

**Last refreshed**: 2026-05-13 (v1.15.0 — Phases 0–11 performance & scale track shipped via PR #34)

This document outlines the strategic development roadmap for MemoryJS, organized by priority phases and feature categories. **The dispatch runbook in [docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md](../superpowers/plans/2026-04-24-task-dispatch-runbook.md) is the source-of-truth for execution status; this file is the strategic narrative.** The per-phase task ledger lives in [`docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md`](../planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md) and tracks the Phase 0–11 performance & scale work end-to-end.

> **Status at a glance (v1.15.0, regenerated from `dependency-summary.compact.json` 2026-05-13):**
>
> - **Codebase:** 231 source files, 76,495 LOC, 1,203 exports, 7,098 passing tests, 11 modules
> - **Shipped phases:** 1 (Foundation), 2 (Developer Experience), 3 (Agent Memory), 3B (Memory Intelligence — incl. 3B.1–3B.7), 3C (Must-Have Infrastructure), 3D (Should-Have Agent Intelligence), η.4.4 / η.5.4 / η.5.5.a–d / η.6.1 / η.6.3 (collaboration + RBAC + PII), δ (v1.13 memory intelligence services), β (v1.12 pluggable backends), plus all of **Phases 0–11 of the performance & scale track** (mmap, segments, columns, tiered index, compression adapters, SPARQL subset, WAL, BackupManager extraction, CRDT, ABAC + RLS + API keys, HITS / clique / Louvain graph algorithms, structured logger, bounded task queue, BM25 incrementality, SQLite read pool)
> - **Open work:** Elasticsearch integration (4.3), distributed architecture (6.2), cloud-native deployment (6.4), GPU acceleration (6.5), `PostgreSQLBackend` (MEM-05), `VectorMemoryBackend` (MEM-06) — these remain the genuine forward-looking items in 2026.

## Phase Overview

| Phase | Name | Timeline | Status |
|-------|------|----------|--------|
| 1 | Foundation | Months 1-2 | ✅ **Shipped** (v1.0–v1.5) |
| 2 | Developer Experience | Months 2-3 | ✅ **Shipped** (v1.5–v1.6) |
| 3 | Agent Memory System | Months 3-5 | ✅ **Shipped** (v1.2.0) |
| 3B | Memory Intelligence | Months 5-7 | ✅ **Shipped** — 3B.1–3B.3 v1.13.0 (Phase δ); 3B.4 / 3B.5 / 3B.6 / 3B.7 Unreleased |
| 3C | Must-Have Infrastructure | — | ✅ **Shipped** (v1.6.0) |
| 3D | Should-Have Agent Intelligence | — | ✅ **Shipped** (v1.7.0) |
| 4 | Integration & Scale (η) | Months 9-11 | 🟡 **Partial** — η.4.4 (bitemporal), η.4.6 (visualize) shipped; η.4.1 (DB adapters), η.4.2 (REST), η.4.3 (Elastic), η.4.5 (scalability) gated on deps |
| 5 | Advanced Features (η.5) | Months 11-14 | 🟡 **Partial** — η.5.4 RDF/Turtle/JSON-LD export (sub-features 1+2) + η.5.5.a-d Collaboration shipped Unreleased; η.5.1 Vector DB / η.5.2 Graph Embeddings / η.5.3 ML / η.5.4 SPARQL / η.5.5.e CRDT gated on deps |
| 6 | Enterprise (η.6) | Months 14+ | 🟡 **Partial** — η.6.1 RBAC + η.6.3 PiiRedactor shipped Unreleased; η.6.2 Distributed (Redis), η.6.3 InputValidator (Zod) / EncryptionAdapter (SQLCipher), η.6.4 Cloud-native (devops), η.6.5 GPU gated on deps |

> See `docs/superpowers/plans/2026-04-25-eta-*.md` for detailed plans on each
> η sub-section. Decision gates and effort estimates per item.

---

## Current State Assessment

### Production-Ready Features
- Entity-Relation-Observation data model with full CRUD operations
- Dual storage backends (JSONL & SQLite with FTS5)
- Comprehensive search: TF-IDF, BM25, Boolean, Fuzzy (N-gram pre-filtered), Semantic, Hybrid, Temporal, LLM-planned
- Semantic search with embedding provider abstraction (OpenAI, local, mock)
- Vector quantization for memory-efficient embeddings
- Reflection-based query refinement with progressive search
- Early termination for search result optimization
- Graph algorithms: shortest path, centrality (degree/betweenness/PageRank), connected components
- Import/Export: JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid with Brotli compression
- Hierarchical entity nesting with parent-child relationships
- Tag management with aliases and bulk operations
- Streaming exports for large graphs (>5000 entities)
- Transaction management with batch processing
- Stable reference index (`RefIndex`) for O(1) named entity lookups
- Artifact management with stable human-readable names (`ArtifactManager`)
- Memory distillation policies (`IDistillationPolicy`) in context retrieval pipeline
- Entity freshness governance (`FreshnessManager`, `Entity.ttl`, `Entity.confidence`)
- Immutable audit logging (`AuditLog`) and governance policies (`GovernanceManager`)
- Role-aware memory customization (`RoleProfiles`, five built-in profiles)
- Entropy-aware filtering (`EntropyFilter`, Shannon entropy gate in consolidation)
- Recursive memory consolidation (`ConsolidationScheduler`, fixed-point background scheduler)
- Visual salience budget allocation (`MemoryFormatter.formatWithSalienceBudget`)
- Collaborative memory synthesis (`CollaborativeSynthesis`, graph-neighbourhood multi-agent merge)
- Failure-driven memory distillation (`FailureDistillation`, causal lesson extraction)
- Cognitive load metrics (`CognitiveLoadAnalyzer`, token density + redundancy + diversity)
- Shared memory visibility hierarchies (`VisibilityResolver`, five-level model + `GroupMembership`)

### Areas for Documentation/Testing Expansion
- Semantic search configuration guides
- Performance tuning documentation for vector operations
- Advanced query refinement tutorials

---

## Phase 1: Foundation (Months 1-2)

High value, low effort improvements to establish a stronger base.

### 1.1 CLI Interface
- Command-line operations for create, query, export, import
- Interactive mode for exploration
- Pipe support for scripting workflows

### 1.2 Relation Properties
- Extend core Relation type with metadata object (WeightedRelation interface exists but not integrated)
- Support arbitrary key-value pairs on relations
- Integrate with storage backends and CRUD operations
- Backward-compatible with existing relations

### 1.3 Search Enhancements
- Query logging and tracing for debugging
- Search result explanation (show signal contributions)
- Full-text search operators (phrase search, wildcards, proximity)

### 1.4 Developer Experience
- Entity validation helpers with custom field support
- Batch import progress callbacks
- Improved error messages with recovery suggestions

---

## Phase 2: Developer Experience (Months 2-3)

Medium effort improvements focused on usability and observability.

### 2.1 GraphQL Support
- Auto-generated GraphQL schema from entity types
- Query and mutation resolvers
- Subscription support for real-time updates

### 2.2 Advanced Analytics
- Graph density metrics
- Clique detection algorithms
- Authority/hub scores (HITS algorithm)
- Network modularity analysis

### 2.3 Entity Lifecycle
- Draft/published/archived states
- State transition rules and hooks
- Bulk state change operations

### 2.4 Search Intelligence
- Spell correction with context awareness
- Query expansion with synonyms
- Search suggestions ("Did you mean?")

### 2.5 Performance Profiling
- Operation latency metrics
- Cache hit rate monitoring
- Query plan visualization
- Memory usage dashboard

---

## Phase 3: Agent Memory System (Months 3-5) ✅ COMPLETED

**Status**: Implemented in v1.2.0

**Priority Track**: Transform MemoryJS into a comprehensive memory system for AI agents supporting short-term (working memory) and long-term (persistent knowledge) memory patterns.

> See [Agent Memory Architecture](../architecture/AGENT_MEMORY.md) for detailed specifications.

### 3.1 Memory Lifecycle Foundation

**Data Model Extensions**:
- Add `accessCount`, `lastAccessedAt` fields to Entity for access tracking
- Add `sessionId`, `conversationId`, `taskId` for session/context grouping
- Add `expiresAt`, `isWorkingMemory` for TTL-based working memory
- Add `confidence` (0.0-1.0), `confirmationCount` for memory strength
- Add `memoryType` enum: `working`, `episodic`, `semantic`, `procedural`

**Access Tracker Service**:
```typescript
interface AccessTracker {
  recordAccess(entityName: string, context?: AccessContext): Promise<void>;
  calculateRecencyScore(entityName: string, halfLifeHours?: number): number;
  getFrequentlyAccessed(limit: number): Promise<Entity[]>;
  getRecentlyAccessed(limit: number): Promise<Entity[]>;
}
```

**Implementation**:
- Track every entity retrieval with timestamp and context
- Calculate access patterns (frequent/occasional/rare)
- Integrate recency scoring into search ranking
- Add access statistics to entity metadata

### 3.2 Working Memory Manager

**Purpose**: Session-scoped, TTL-based short-term memory for current task context.

**Working Memory Service**:
```typescript
interface WorkingMemoryManager {
  createWorkingMemory(sessionId: string, content: string, options?: WorkingMemoryOptions): Promise<AgentEntity>;
  getSessionMemories(sessionId: string): Promise<AgentEntity[]>;
  clearExpired(): Promise<number>;
  extendTTL(entityNames: string[], additionalHours: number): Promise<void>;
  markForPromotion(entityName: string): Promise<void>;
}
```

**Implementation**:
- Default 24-hour TTL for working memories
- Session-scoped queries (retrieve only current session memories)
- Automatic cleanup of expired memories (background job)
- Promotion candidates tracking for consolidation

### 3.3 Decay Engine

**Purpose**: Implement natural memory decay with importance modulation.

**Decay Formula**:
```
effective_importance = base_importance * decay_factor * strength_multiplier

decay_factor = e^(-ln(2) * age_hours / half_life_hours)
strength_multiplier = 1 + (confirmation_count * 0.1) + (access_count * 0.01)
```

**Decay Engine Service**:
```typescript
interface DecayEngine {
  calculateEffectiveImportance(entity: AgentEntity): number;
  calculateDecayFactor(lastAccessedAt: string, halfLifeHours: number): number;
  getDecayedMemories(threshold: number): Promise<AgentEntity[]>;
  applyDecay(options?: DecayOptions): Promise<DecayResult>;
  reinforceMemory(entityName: string, amount?: number): Promise<void>;
  forgetWeakMemories(options: ForgetOptions): Promise<ForgetResult>;
}
```

**Implementation**:
- Exponential decay based on time since last access
- High-importance memories decay slower (importance modulation)
- Frequently accessed memories decay slower (access modulation)
- Configurable forgetting threshold (archive or delete below threshold)
- Memory reinforcement on access (reset decay, increment confirmation)

### 3.4 Consolidation Pipeline

**Purpose**: Transition short-term memories to long-term storage with summarization.

**Consolidation Service**:
```typescript
interface ConsolidationPipeline {
  consolidateSession(sessionId: string, options?: ConsolidateOptions): Promise<ConsolidationResult>;
  summarizeObservations(entityName: string, similarityThreshold: number): Promise<SummarizationResult>;
  promoteMemory(entityName: string, targetType: 'episodic' | 'semantic'): Promise<void>;
  extractPatterns(entityType: string, minOccurrences: number): Promise<PatternResult[]>;
  mergeMemories(entityNames: string[], strategy: MergeStrategy): Promise<Entity>;
  runAutoConsolidation(rules: ConsolidationRule[]): Promise<ConsolidationResult>;
}
```

**Consolidation Rules**:
```typescript
interface ConsolidationRule {
  trigger: 'session_end' | 'time_elapsed' | 'confirmation_threshold' | 'manual';
  conditions: {
    minConfidence?: number;      // Minimum confidence to promote
    minConfirmations?: number;   // Minimum confirmations required
    minAccessCount?: number;     // Minimum access frequency
  };
  action: 'promote' | 'summarize' | 'merge' | 'archive';
}
```

**Implementation**:
- Observation clustering and summarization (LLM-powered)
- Pattern extraction from repeated observations
- Automatic promotion based on configurable rules
- Session-end consolidation workflow
- De-duplication during merge

### 3.5 Salience & Context-Aware Retrieval

**Purpose**: Dynamic relevance scoring based on current task context.

**Salience Engine**:
```typescript
interface SalienceEngine {
  calculateSalience(entity: AgentEntity, context: SalienceContext): number;
  getMostSalient(context: SalienceContext, limit: number): Promise<ScoredEntity[]>;
  calculateNovelty(entity: AgentEntity): number;
  calculateTaskRelevance(entity: AgentEntity, taskDescription: string): Promise<number>;
}

interface SalienceContext {
  currentTask?: string;
  currentSession?: string;
  recentEntities?: string[];
  queryText?: string;
  temporalFocus?: 'recent' | 'historical' | 'any';
}
```

**Salience Scoring**:
```
salience = (
  base_importance * decay_factor +
  recency_boost * recency_weight +
  frequency_boost * frequency_weight +
  context_relevance * context_weight +
  novelty_bonus * novelty_weight
)
```

**Implementation**:
- Context-aware importance (same fact, different salience per context)
- Task relevance via semantic similarity to current goal
- Novelty scoring (unexpected/surprising facts boosted)
- Recent entity boosting for conversation continuity

### 3.6 Context Window Manager

**Purpose**: Optimize memory retrieval for LLM context window constraints.

**Context Window Service**:
```typescript
interface ContextWindowManager {
  retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage>;
  estimateTokens(entity: AgentEntity): number;
  prioritize(entities: AgentEntity[], maxTokens: number): AgentEntity[];
  handleSpillover(included: AgentEntity[], excluded: AgentEntity[]): SpilloverResult;
}

interface ContextPackage {
  memories: AgentEntity[];
  totalTokens: number;
  breakdown: { workingMemory: number; episodic: number; semantic: number };
  excluded: string[];
  suggestions: string[];
}
```

**Implementation**:
- Token budget-aware retrieval
- Priority-based inclusion (working > recent episodic > relevant semantic)
- Spillover handling (what to store for next context window)
- Must-include entity support (always include specified memories)

### 3.7 Session & Episodic Memory

**Purpose**: Group memories by conversation/session with temporal ordering.

**Session Entity**:
```typescript
interface SessionEntity extends Entity {
  entityType: 'session';
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'completed' | 'abandoned';
  goalDescription?: string;
  taskType?: string;
  memoryCount: number;
  previousSessionId?: string;
}
```

**Implementation**:
- Session lifecycle management (start, update, end)
- Session-scoped queries
- Session continuation (link related sessions)
- Episodic timeline generation
- Event sequencing within sessions

### 3.8 Multi-Agent Memory Support

**Purpose**: Enable shared memory spaces and agent identity tracking.

**Multi-Agent Extensions**:
```typescript
interface AgentEntity extends Entity {
  agentId?: string;
  visibility: 'private' | 'shared' | 'public';
  source?: {
    agentId: string;
    timestamp: string;
    method: 'observed' | 'inferred' | 'told' | 'consolidated';
    reliability: number;
  };
}

interface MultiAgentMemoryManager {
  registerAgent(agentId: string, metadata?: AgentMetadata): Promise<void>;
  createAgentMemory(agentId: string, entity: Partial<AgentEntity>): Promise<AgentEntity>;
  getVisibleMemories(agentId: string, filter?: MemoryFilter): Promise<AgentEntity[]>;
  shareMemory(entityName: string, targetAgents: string[] | 'all'): Promise<void>;
  resolveConflict(conflictingEntities: string[], strategy: ConflictStrategy): Promise<AgentEntity>;
}
```

**Conflict Resolution Strategies**:
- `most_recent` - Latest timestamp wins
- `highest_confidence` - Highest confidence score wins
- `most_confirmations` - Most confirmed memory wins
- `trusted_agent` - Higher trust agent wins
- `merge_all` - Combine all observations

**Implementation**:
- Agent registration and trust levels
- Visibility-based query filtering
- Memory sharing protocols
- Conflict detection and resolution
- Cross-agent memory merge with trust weighting

### 3.9 Environment Configuration

**New Environment Variables**:
```bash
# Memory Lifecycle
MEMORY_WORKING_TTL_HOURS=24
MEMORY_DECAY_HALF_LIFE_HOURS=168
MEMORY_DECAY_MIN_IMPORTANCE=0.1
MEMORY_FORGET_THRESHOLD=0.05

# Consolidation
MEMORY_AUTO_CONSOLIDATE=true
MEMORY_CONSOLIDATE_MIN_CONFIDENCE=0.7
MEMORY_CONSOLIDATE_MIN_CONFIRMATIONS=2
MEMORY_SUMMARIZATION_PROVIDER=openai

# Context Window
MEMORY_DEFAULT_TOKEN_BUDGET=4000
MEMORY_TOKEN_ESTIMATOR=tiktoken

# Multi-Agent
MEMORY_MULTI_AGENT_ENABLED=false
MEMORY_DEFAULT_VISIBILITY=private
```

### 3.10 Testing Requirements

**Unit Tests**:
- Decay calculations (exponential decay, modulation)
- Access tracking (frequency, recency scoring)
- Salience scoring (context relevance, novelty)
- Token estimation accuracy
- Consolidation rule evaluation

**Integration Tests**:
- Full memory lifecycle (create → access → decay → forget)
- Session management (start → memories → consolidate → end)
- Multi-agent scenarios (visibility, sharing, conflicts)
- Context window optimization

**Performance Tests**:
- Decay processing at scale (10k+ entities)
- Retrieval latency with token budgeting
- Consolidation throughput
- Concurrent multi-agent access

---

## Phase 3C: Must-Have Infrastructure Features ✅ COMPLETED

**Status**: Implemented in v1.6.0 (2026-03-24)

Eight high-priority features identified as critical infrastructure gaps, implemented on branch `feature/must-have-8`.

### 3C.1 Stable Index Dereferencing ✅

**Implemented**: `src/core/RefIndex.ts`

Named reference system that provides O(1) entity lookup decoupled from entity names. A `RefIndex` JSONL sidecar persists `ref → entityName` mappings. Integrated into `EntityManager` (auto-deregister on delete) and `ManagerContext` (`ctx.refIndex`).

**API**: `register(ref, entityName)` / `resolve(ref)` / `deregister(ref)`

---

### 3C.2 Artifact-Level Granularity ✅

**Implemented**: `src/agent/ArtifactManager.ts`

`createArtifact()` generates stable human-readable artifact names in the format `toolName-YYYY-MM-DD-shortId` and auto-registers them in `RefIndex`. Introduces `ArtifactEntity` type extending `AgentEntity` with an `artifactType` discriminant field (`ArtifactType` union).

---

### 3C.3 Temporal Range Queries ✅

**Implemented**: `src/search/TemporalQueryParser.ts`, `src/search/TemporalSearch.ts`

Natural language time expression parsing via `chrono-node` ("10 minutes ago", "last hour", "yesterday"). Exposed as `SearchManager.searchByTime(expression)` and `ManagerContext.temporalSearch` accessor.

---

### 3C.4 Memory Distillation Policy ✅

**Implemented**: `src/agent/DistillationPolicy.ts`, `src/agent/DistillationPipeline.ts`

Post-retrieval filter applied in `ContextWindowManager` before LLM formatting. `IDistillationPolicy` interface ships with three implementations: `DefaultDistillationPolicy` (relevance threshold + freshness + deduplication), `CompositeDistillationPolicy` (chain multiple policies), `NoOpDistillationPolicy` (pass-through).

---

### 3C.5 Temporal Governance & Freshness ✅

**Implemented**: `src/features/FreshnessManager.ts`

`Entity.ttl` (ms) and `Entity.confidence` (0–1) added as optional fields. `FreshnessManager` exposes `calculateFreshness`, `getStaleEntities`, `getExpiredEntities`, and `generateReport`. `DecayEngine` enhanced with TTL-aware decay logic. `SalienceEngine` gains a `freshnessWeight` scoring component.

---

### 3C.6 N-gram Hashing ✅

**Implemented**: `src/search/NGramIndex.ts`

Trigram index with Jaccard similarity used as a pre-filter in `FuzzySearch`. Reduces the candidate set passed to Levenshtein worker pool, improving fuzzy search performance on large graphs.

---

### 3C.7 LLM Query Planner ✅

**Implemented**: `src/search/LLMQueryPlanner.ts`, `src/search/LLMSearchExecutor.ts`

Optional module decomposing natural language queries into a `StructuredQuery` (keywords, filters, intent, suggested methods) via an `LLMProvider` interface. Falls back to keyword extraction when no provider is configured. JSON responses are validated with recovery via regex fallback. Exposed as `ManagerContext.queryNaturalLanguage(query, provider?)`.

---

### 3C.8 Dynamic Memory Governance ✅

**Implemented**: `src/features/AuditLog.ts`, `src/features/GovernanceManager.ts`

`AuditLog` persists an immutable operation history as JSONL. `GovernanceManager` wraps entity mutations with `GovernancePolicy` checks (`canCreate`/`canUpdate`/`canDelete`) and provides `withTransaction`/`rollback` semantics. Exposed as `ManagerContext.governanceManager`.

---

## Phase 3D: Should-Have Agent Intelligence Features ✅ COMPLETED

**Status**: Implemented in v1.7.0 (2026-03-24)

Eight high-priority features that add role awareness, information-theoretic filtering, background maintenance, collaborative reasoning, failure learning, cognitive load control, and fine-grained visibility to the Agent Memory System.

### 3D.1 Role-Aware Memory Customization ✅

**Implemented**: `src/agent/RoleProfiles.ts`

`RoleProfileManager` ships five built-in role profiles (`researcher`, `planner`, `executor`, `reviewer`, `coordinator`), each defining distinct `SalienceEngine` weight configurations and `ContextWindowManager` token budget splits. Apply a profile at agent instantiation to tune memory behaviour for the role without manual weight adjustment.

**API**: `RoleProfileManager.apply(role)` / `getProfile(role)` / `listProfiles()`

---

### 3D.2 Entropy-Aware Filtering ✅

**Implemented**: `src/agent/EntropyFilter.ts`

`EntropyFilter` computes Shannon entropy over observation token distributions and rejects memories below a configurable threshold (default 0.3). Integrated as an early stage in `ConsolidationPipeline` to discard low-information entries before deduplication.

**API**: `EntropyFilter.score(entity)` / `filter(entities)`

---

### 3D.3 Recursive Memory Consolidation ✅

**Implemented**: `src/agent/ConsolidationScheduler.ts`

`ConsolidationScheduler` runs `ConsolidationPipeline.runAutoConsolidation()` on a configurable interval and repeats until a fixed-point (zero new merges) is reached. Deduplication and merge passes are therefore fully automatic and converge without manual intervention.

**API**: `ConsolidationScheduler.start()` / `stop()` / `runNow()`

---

### 3D.4 Visual Salience Budget Allocation ✅

**Implemented**: `src/agent/MemoryFormatter.ts` (new method)

`formatWithSalienceBudget()` on `MemoryFormatter` accepts a salience score map and total token budget, then proportionally allocates tokens across the working / episodic / semantic memory sections, producing balanced LLM prompt blocks.

**API**: `MemoryFormatter.formatWithSalienceBudget(memories, scores, totalTokens)`

---

### 3D.5 Collaborative Memory Synthesis ✅

**Implemented**: `src/agent/CollaborativeSynthesis.ts`

`CollaborativeSynthesis.synthesize()` walks the relation graph up to `hopDepth` hops from a target entity, collects all agent-contributed observations for reachable nodes, and returns a unified `AgentEntity` with per-observation provenance metadata. Visibility rules from `VisibilityResolver` are enforced during traversal.

**API**: `CollaborativeSynthesis.synthesize(entityName, requestingAgentId)`

---

### 3D.6 Failure-Driven Memory Distillation ✅

**Implemented**: `src/agent/FailureDistillation.ts`

`FailureDistillation.distill()` reconstructs the causal event chain leading to a failure entity via reverse relation traversal, scores each step by causal contribution, and promotes the highest-scoring observations to semantic memory as reusable lessons.

**API**: `FailureDistillation.distill(failureEntityName)` → `DistillationResult`

---

### 3D.7 Cognitive Load Metrics ✅

**Implemented**: `src/agent/CognitiveLoadAnalyzer.ts`

`CognitiveLoadAnalyzer.analyze()` returns a `CognitiveLoadReport` with three dimensions — token density, redundancy ratio, and observation diversity — and a composite `loadIndex`. `ContextWindowManager` uses `loadIndex` to prune high-load sections before final prompt assembly.

**API**: `CognitiveLoadAnalyzer.analyze(memories)` → `CognitiveLoadReport`

---

### 3D.8 Shared Memory Visibility Hierarchies ✅

**Implemented**: `src/agent/VisibilityResolver.ts`

`VisibilityResolver` enforces a five-level visibility model (`private` | `team` | `org` | `shared` | `public`) using a `GroupMembership` registry. `resolve()` filters a memory set to only the entries visible to the requesting agent based on its team/org memberships.

**API**: `VisibilityResolver.resolve(requestingAgentId, memories)` / `canAccess(agentId, entity)`

---

## Phase 3B: Memory Intelligence - Reflection & Experience — ✅ shipped (3B.1–3B.7)

**SHIPPED**: All seven Phase 3B services have full implementations under `src/agent/`. The remaining 3B.8 (Heuristic Guidelines Manager) is the only open item; `HeuristicManager` exists as a scaffold awaiting consumer wiring.

| Sub-phase | Status | Class | Location |
|-----------|--------|-------|----------|
| 3B.1 Memory Validator | ✅ shipped (v1.13) | `MemoryValidator` | `src/agent/MemoryValidator.ts` |
| 3B.2 Trajectory Compressor | ✅ shipped (v1.13) | `TrajectoryCompressor` | `src/agent/TrajectoryCompressor.ts` |
| 3B.3 Experience Extractor | ✅ shipped (v1.13) | `ExperienceExtractor` | `src/agent/ExperienceExtractor.ts` |
| 3B.4 Procedural Memory | ✅ shipped | `ProcedureManager`, `ProcedureStore`, `StepSequencer` | `src/agent/procedural/` |
| 3B.5 Active Retrieval | ✅ shipped | `ActiveRetrievalController`, `QueryRewriter` | `src/agent/retrieval/` |
| 3B.6 Causal Reasoning | ✅ shipped | `CausalReasoner` | `src/agent/causal/` |
| 3B.7 World Model | ✅ shipped | `WorldModelManager`, `WorldStateSnapshot` | `src/agent/world/` |
| 3B.8 Heuristic Guidelines | ⏳ remaining | `HeuristicManager` (scaffold, not wired) | `src/agent/HeuristicManager.ts` |

**Design context** (preserved for historical reference): Phase 3B was framed around the evolutionary framework from "From Storage to Experience: A Survey on the Evolution of LLM Agent Memory Mechanisms" (Luo et al., 2026). The phase elevated MemoryJS from the **Storage** stage to the **Reflection** and **Experience** stages of memory evolution. The sub-sections below preserve the original design specs as reference for the shipped implementations.

> **Key Insight**: Memory evolution is about increasing abstraction level and information density, not just storage capacity. These features transform raw trajectories into validated, compressed, and transferable knowledge.

### 3B.1 Memory Validation & Error Rectification (Reflection Stage)

**Purpose**: Prevent hallucinations and logical errors from contaminating memory through self-critique before storage.

**Memory Validator Service**:
```typescript
interface MemoryValidator {
  // Check new observation against existing entity knowledge
  validateConsistency(newObs: Observation, existing: Entity): Promise<ValidationResult>;

  // Detect contradictory observations within an entity
  detectContradictions(entity: Entity): Promise<Contradiction[]>;

  // Repair memory based on feedback (self-critique or external)
  repairMemory(entity: Entity, feedback: string): Promise<Entity>;

  // Validate temporal consistency (e.g., event ordering)
  validateTemporalOrder(observations: Observation[]): ValidationResult;

  // Score memory reliability based on source and confirmation
  calculateReliability(entity: Entity): number;
}

interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: ValidationIssue[];
  suggestions: string[];
}

interface Contradiction {
  observation1: Observation;
  observation2: Observation;
  conflictType: 'factual' | 'temporal' | 'logical';
  severity: 'low' | 'medium' | 'high';
  resolution?: string;
}
```

**Implementation**:
- Pre-storage validation hooks
- Semantic consistency checking via embeddings
- Temporal logic validation
- Contradiction detection and resolution strategies
- Integration with ConflictResolver for automated repair

### 3B.2 Trajectory Compression (Reflection Stage)

**Purpose**: Distill verbose interaction histories into compact, reusable representations to prevent memory bloat.

**Trajectory Compressor Service**:
```typescript
interface TrajectoryCompressor {
  // Compress long observation sequences into summaries
  distill(observations: Observation[], options?: DistillOptions): Promise<CompressedMemory>;

  // Multi-granularity abstraction
  abstractAtLevel(
    memories: Entity[],
    granularity: 'fine' | 'medium' | 'coarse'
  ): Promise<Entity[]>;

  // Context folding for working memory (fit into token budget)
  foldContext(working: WorkingMemory, maxTokens: number): Promise<WorkingMemory>;

  // Identify redundant observations across entities
  findRedundancies(entities: Entity[]): Promise<RedundancyGroup[]>;

  // Merge redundant information preserving key details
  mergeRedundant(group: RedundancyGroup, strategy: MergeStrategy): Promise<Entity>;
}

interface CompressedMemory {
  summary: string;
  keyFacts: string[];
  originalCount: number;
  compressionRatio: number;
  preservedDetails: string[];
  discardedDetails: string[];
}

interface DistillOptions {
  preserveTemporalOrder: boolean;
  maxLength: number;
  importanceThreshold: number;
  preserveEntities: string[]; // Always keep these
}
```

**Compression Strategies**:
- `semantic_clustering` - Group similar observations, keep representative
- `temporal_windowing` - Summarize by time periods
- `importance_filtering` - Keep only high-importance items
- `hierarchical` - Multi-level summaries (detail → overview)

**Implementation**:
- LLM-powered summarization (optional)
- Embedding-based clustering for grouping
- Information-theoretic redundancy detection
- Configurable compression ratios
- Integration with ContextWindowManager

### 3B.3 Experience Extraction (Experience Stage)

**Purpose**: Abstract universal patterns from clusters of trajectories to enable zero-shot transfer to new scenarios.

**Experience Extractor Service**:
```typescript
interface ExperienceExtractor {
  // Learn from contrasting successful vs failed trajectories
  extractFromContrastivePairs(
    success: Trajectory[],
    failure: Trajectory[]
  ): Promise<Rule[]>;

  // Detect recurring patterns across similar trajectories
  abstractPattern(
    trajectories: Trajectory[],
    similarityThreshold: number
  ): Promise<HeuristicGuideline>;

  // Extract decision boundaries from trajectory outcomes
  learnDecisionBoundary(
    trajectories: Trajectory[],
    outcomeField: string
  ): Promise<DecisionRule>;

  // Cluster trajectories by structural similarity
  clusterTrajectories(
    trajectories: Trajectory[],
    method: 'semantic' | 'structural' | 'outcome'
  ): Promise<TrajectoryCluster[]>;

  // Generate transferable insights from trajectory cluster
  synthesizeExperience(cluster: TrajectoryCluster): Promise<Experience>;
}

interface Trajectory {
  id: string;
  sessionId: string;
  observations: Observation[];
  actions: Action[];
  outcome: 'success' | 'failure' | 'partial' | 'unknown';
  context: Record<string, unknown>;
  timestamp: string;
}

interface Rule {
  condition: string;  // When this applies
  action: string;     // What to do
  confidence: number;
  supportCount: number; // How many trajectories support this
  contraCount: number;  // How many trajectories contradict this
}

interface Experience {
  id: string;
  type: 'heuristic' | 'procedure' | 'constraint' | 'preference';
  content: string;
  applicability: string[]; // Task types this applies to
  confidence: number;
  sourceTrajectories: string[];
  createdAt: string;
  validatedAt?: string;
}
```

**Abstraction Mechanisms** (from paper):
- **Contrastive Induction**: Learn from success/failure pairs
- **Action Distillation**: Compress action sequences into patterns
- **Code Encapsulation**: Convert patterns to executable procedures
- **Gradient Internalization**: (Future) Fine-tune models on experience

**Implementation**:
- Trajectory storage and indexing
- Similarity computation for clustering
- Pattern mining algorithms
- Rule confidence scoring
- Experience lifecycle management

### 3B.4 Procedural Memory Manager (Experience Stage)

**Purpose**: Encapsulate recurring action patterns into reusable procedures (skills).

**Procedural Memory Service**:
```typescript
interface ProceduralMemoryManager {
  // Learn a procedure from observed action sequences
  learnProcedure(trajectories: Trajectory[], name?: string): Promise<Procedure>;

  // Match current context to known procedures
  matchProcedure(context: Context): Promise<ProcedureMatch[]>;

  // Execute a procedure (return action sequence)
  instantiate(procedure: Procedure, parameters: Record<string, unknown>): Action[];

  // Refine procedure based on execution feedback
  refineProcedure(procedure: Procedure, feedback: ProcedureFeedback): Promise<Procedure>;

  // Compose procedures into higher-level skills
  composeProcedures(procedures: Procedure[], name: string): Promise<Procedure>;

  // Get all procedures for a task type
  getProceduresForTask(taskType: string): Promise<Procedure[]>;
}

interface Procedure {
  id: string;
  name: string;
  description: string;
  trigger: string;           // When to invoke (natural language condition)
  preconditions: string[];   // Required state before execution
  steps: ProcedureStep[];
  parameters: ProcedureParameter[];
  postconditions: string[];  // Expected state after execution
  successRate: number;
  executionCount: number;
  lastExecuted?: string;
  sourceTrajectories: string[];
}

interface ProcedureStep {
  order: number;
  action: string;
  parameters: Record<string, string>; // Can reference procedure params
  fallback?: ProcedureStep;
  timeout?: number;
}

interface ProcedureParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'entity' | 'list';
  required: boolean;
  default?: unknown;
  description: string;
}

interface ProcedureFeedback {
  procedureId: string;
  executionId: string;
  success: boolean;
  failedAtStep?: number;
  errorMessage?: string;
  suggestions?: string[];
}
```

**Implementation**:
- Action sequence alignment (find common subsequences)
- Parameter extraction and generalization
- Procedure composition and nesting
- Success rate tracking and decay
- Procedure versioning

### 3B.5 Heuristic Guidelines Manager (Experience Stage)

**Purpose**: Crystallize implicit patterns into explicit natural language strategies for interpretable self-evolution.

**Heuristic Manager Service**:
```typescript
interface HeuristicManager {
  // Create a new heuristic from experience
  createHeuristic(heuristic: Partial<HeuristicGuideline>): Promise<HeuristicGuideline>;

  // Find applicable heuristics for current context
  getApplicableHeuristics(context: Context): Promise<ScoredHeuristic[]>;

  // Update heuristic based on outcome
  reinforceHeuristic(id: string, outcome: 'success' | 'failure'): Promise<void>;

  // Merge similar heuristics
  mergeHeuristics(ids: string[]): Promise<HeuristicGuideline>;

  // Detect conflicting heuristics
  findConflicts(): Promise<HeuristicConflict[]>;

  // Generate heuristics from trajectory analysis
  induceHeuristics(trajectories: Trajectory[]): Promise<HeuristicGuideline[]>;
}

interface HeuristicGuideline {
  id: string;
  name: string;
  condition: string;      // When to apply (natural language)
  action: string;         // What to do
  rationale: string;      // Why (explanation)
  priority: number;       // Ordering when multiple apply
  confidence: number;
  applicableTasks: string[];
  contraindications: string[]; // When NOT to apply
  sourceTrajectories: string[];
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ScoredHeuristic {
  heuristic: HeuristicGuideline;
  relevanceScore: number;
  confidenceScore: number;
  combinedScore: number;
}

interface HeuristicConflict {
  heuristic1: HeuristicGuideline;
  heuristic2: HeuristicGuideline;
  conflictType: 'contradictory_action' | 'overlapping_condition' | 'priority_ambiguity';
  resolution?: string;
}
```

**Implementation**:
- Natural language condition parsing
- Context matching via semantic similarity
- Conflict detection and resolution
- Heuristic generalization (broader applicability)
- Integration with ExperienceExtractor

### 3B.6 Active Retrieval Controller (Experience Stage)

**Purpose**: Transform memory from passive storage to autonomous, context-aware resource invocation.

**Active Retrieval Service**:
```typescript
interface ActiveRetrievalController {
  // Decide if current task requires memory retrieval
  shouldRetrieve(context: RetrievalContext): Promise<RetrievalDecision>;

  // Select which memory types to query
  selectMemoryTypes(task: TaskType): MemoryCategory[];

  // Estimate relevance before full retrieval
  estimateRelevance(query: string, memoryType: MemoryCategory): Promise<number>;

  // Adaptive retrieval based on task complexity
  adaptiveRetrieve(context: RetrievalContext): Promise<AdaptiveResult>;

  // Learn retrieval patterns from feedback
  learnRetrievalPattern(feedback: RetrievalFeedback): Promise<void>;
}

interface RetrievalContext {
  currentTask: string;
  taskType: TaskType;
  currentSession: string;
  recentActions: string[];
  currentGoal?: string;
  availableTokenBudget: number;
  urgency: 'low' | 'medium' | 'high';
}

interface RetrievalDecision {
  shouldRetrieve: boolean;
  confidence: number;
  recommendedTypes: MemoryCategory[];
  estimatedBenefit: number;
  estimatedCost: number; // tokens, latency
  rationale: string;
}

interface AdaptiveResult {
  memories: Entity[];
  retrievalStrategy: string;
  tokenUsage: number;
  latencyMs: number;
  confidence: number;
  suggestions: string[]; // What else might be relevant
}

type MemoryCategory =
  | 'working'      // Current session context
  | 'episodic'     // Past events/experiences
  | 'semantic'     // Facts and knowledge
  | 'procedural'   // Skills and procedures
  | 'heuristic';   // Guidelines and rules

type TaskType =
  | 'recall'       // Direct fact retrieval
  | 'reasoning'    // Multi-step inference
  | 'planning'     // Future action sequence
  | 'creative'     // Novel generation
  | 'diagnostic';  // Problem identification
```

**Implementation**:
- Task type classification
- Cost-benefit analysis for retrieval
- Retrieval pattern learning
- Dynamic budget allocation
- Integration with ContextWindowManager

### 3B.7 Causal Relations (Reflection Stage)

**Purpose**: Extend relations to capture causal dependencies with delayed effects and cascading impacts.

**Causal Relation Extensions**:
```typescript
interface CausalRelation extends Relation {
  relationType: 'causes' | 'enables' | 'prevents' | 'precedes' | 'correlates';

  // Causal properties
  causalStrength: number;     // 0-1, how strongly A causes B
  delay?: number;             // Time steps between cause and effect
  probability?: number;       // P(effect | cause)

  // Validation
  observed: boolean;          // Directly observed vs inferred
  confirmationCount: number;  // How many times validated
  contradictionCount: number; // How many times contradicted

  // Context
  conditions?: string[];      // Conditions under which causation holds
  mechanism?: string;         // How the causation works (explanation)
}

interface CausalGraphManager {
  // Add causal relation with validation
  addCausalRelation(relation: CausalRelation): Promise<CausalRelation>;

  // Infer potential causes for an observation
  inferCauses(effect: Entity, maxDepth?: number): Promise<CausalChain[]>;

  // Predict effects of an action/event
  predictEffects(cause: Entity, maxDepth?: number): Promise<CausalChain[]>;

  // Find causal paths between two entities
  findCausalPaths(from: Entity, to: Entity): Promise<CausalChain[]>;

  // Validate causal relation with new evidence
  validateCausation(relationId: string, evidence: Evidence): Promise<void>;

  // Detect causal cycles (potential inconsistencies)
  detectCycles(): Promise<CausalCycle[]>;

  // Build causal model from observations
  learnCausalStructure(observations: Observation[]): Promise<CausalRelation[]>;
}

interface CausalChain {
  path: CausalRelation[];
  totalStrength: number;      // Product of individual strengths
  totalDelay: number;         // Sum of delays
  confidence: number;
}
```

**Implementation**:
- Extend Relation type in `src/types/types.ts`
- Add CausalGraphManager to `src/core/`
- Causal inference algorithms (basic causal discovery)
- Integration with GraphTraversal for causal path finding
- Temporal reasoning support

### 3B.8 World Model Manager (Environment Reflection)

**Purpose**: Build and maintain internal models of the environment from observations.

**World Model Service**:
```typescript
interface WorldModelManager {
  // Infer environment rules from observations
  inferRule(observations: Observation[]): Promise<EnvironmentRule>;

  // Validate rule against new observation
  validateRule(rule: EnvironmentRule, observation: Observation): ValidationResult;

  // Update model based on environmental feedback
  updateModel(feedback: EnvironmentFeedback): Promise<void>;

  // Predict outcome of action in current state
  predictOutcome(state: WorldState, action: Action): Promise<PredictionResult>;

  // Get current world state estimate
  getCurrentState(): Promise<WorldState>;

  // Detect state changes
  detectStateChange(before: WorldState, after: WorldState): StateChange[];
}

interface EnvironmentRule {
  id: string;
  name: string;
  condition: string;          // When rule applies
  effect: string;             // What happens
  confidence: number;
  observationCount: number;
  validationCount: number;
  lastValidated?: string;
  exceptions: string[];       // Known exceptions
}

interface WorldState {
  timestamp: string;
  entities: Record<string, EntityState>;
  activeRelations: string[];
  environmentVariables: Record<string, unknown>;
  confidence: number;
}

interface PredictionResult {
  predictedState: WorldState;
  confidence: number;
  uncertainties: string[];
  alternativeOutcomes?: WorldState[];
}
```

**Implementation**:
- State tracking and versioning
- Rule learning from observation sequences
- Prediction confidence calibration
- Integration with CausalGraphManager

### 3B.9 Environment Configuration

**New Environment Variables**:
```bash
# Memory Validation
MEMORY_VALIDATION_ENABLED=true
MEMORY_VALIDATION_STRICTNESS=medium  # low, medium, high
MEMORY_AUTO_REPAIR=false

# Trajectory Compression
MEMORY_COMPRESSION_ENABLED=true
MEMORY_COMPRESSION_RATIO=0.5
MEMORY_COMPRESSION_MIN_OBSERVATIONS=10

# Experience Extraction
MEMORY_EXPERIENCE_EXTRACTION_ENABLED=true
MEMORY_EXPERIENCE_MIN_TRAJECTORIES=5
MEMORY_EXPERIENCE_CONFIDENCE_THRESHOLD=0.7

# Procedural Memory
MEMORY_PROCEDURAL_ENABLED=true
MEMORY_PROCEDURE_MIN_OCCURRENCES=3
MEMORY_PROCEDURE_SUCCESS_THRESHOLD=0.6

# Active Retrieval
MEMORY_ACTIVE_RETRIEVAL_ENABLED=false
MEMORY_RETRIEVAL_COST_THRESHOLD=0.3

# Causal Relations
MEMORY_CAUSAL_INFERENCE_ENABLED=false
MEMORY_CAUSAL_MIN_OBSERVATIONS=5

# World Model
MEMORY_WORLD_MODEL_ENABLED=false
MEMORY_STATE_TRACKING_INTERVAL_MS=60000
```

### 3B.10 Testing Requirements

**Unit Tests**:
- Memory validation (consistency, contradiction detection)
- Trajectory compression (ratio, information preservation)
- Experience extraction (pattern detection, rule confidence)
- Procedural memory (learning, matching, refinement)
- Heuristic management (conflict detection, relevance scoring)
- Causal relations (inference, path finding, cycle detection)

**Integration Tests**:
- Full experience lifecycle (trajectory → abstraction → application)
- Validation → compression → experience pipeline
- Multi-memory type retrieval scenarios
- Causal chain reasoning

**Performance Tests**:
- Compression at scale (1000+ observations)
- Experience extraction from large trajectory sets
- Active retrieval decision latency
- Causal inference depth limits

---

## Phase 4: Integration & Scale (Months 9-11) — 5 of 6 shipped

Medium-high effort features for broader ecosystem integration. Mostly shipped via PR #34's Phases 4–11 of the performance & scale track plus η.4.4.

### 4.1 Database Adapters — ✅ scaffolded (concrete drivers pending)
- [x] `IDatabaseAdapter` interface + `NullDatabaseAdapter` + `InMemoryDatabaseAdapter` (`src/adapters/IDatabaseAdapter.ts`)
- [x] `IVectorDBAdapter` interface + `InMemoryVectorAdapter` (`src/adapters/IVectorDBAdapter.ts`)
- [ ] Concrete PostgreSQL adapter (pg_trgm for text search; covered in MEM-05)
- [ ] Concrete MongoDB integration
- [x] Connection pooling pattern available — `SQLiteStorage` already uses a read-connection pool (`MEMORY_SQLITE_READ_POOL_SIZE`); extend pattern to external adapters when concrete drivers land

### 4.2 REST API Generation — ✅ scaffolded
- [x] `RestRouter` (`src/adapters/RestRouter.ts`) — routing skeleton
- [ ] Fastify plugin wrapper around `RestRouter`
- [ ] OpenAPI/Swagger generation from `RestRouter` routes
- [ ] Rate limiting + pagination middleware

### 4.3 Elasticsearch Integration — ⏳ not started
- [ ] Offload advanced full-text search to Elasticsearch
- [ ] Sync entities to Elasticsearch index
- [ ] Hybrid local + Elasticsearch queries

> *Note: SQLite FTS5 + BM25 covers most of the original motivation; Elasticsearch is now an optional add-on for very-large or cross-process search.*

### 4.4 Temporal Versioning — ✅ shipped
- [x] Entity/relation change history — `RelationManager.timeline()`, `EntityManager.entityTimeline()`
- [x] Point-in-time queries — `RelationManager.queryAsOf(date)`, `EntityManager.entityAsOf(date)`, `ObservationManager.observationsAsOf(date)`
- [x] Audit trail with user attribution — `AuditLog` (v1.6.0) + `CollaborationAuditEnforcer` (η.5.5.d) strict-mode `agentId` requirement
- [x] Rollback capabilities — `GovernanceManager.withTransaction()` + `rollback()` (v1.6.0)
- [x] Bitemporal axis — `Entity.validFrom` / `validUntil` / `observationMeta[]` (η.4.4)

### 4.5 Scalability Improvements — ✅ shipped (PR #34 Phases 7–11)
- [x] Streaming exports for 100k+ entities — `StreamingExporter` with Brotli compression
- [x] Lazy entity loading — `JsonlColumnStore` (Phase 8) reads observation columns on-demand
- [x] Memory-mapped file support for large graphs — `IMmapBackend` + `BufferMmapBackend` + `FsReadMmapBackend` (Phase 11); `GraphStorage.loadFromDisk` mmap branch gated by `MEMORY_USE_MMAP` + `MEMORY_MMAP_THRESHOLD_BYTES`
- [x] Index partitioning by entity type — `PartitionedInvertedIndex` (`src/search/`) + `FileSegmentStorage` FNV-routed shards (Phase 7, `MEMORY_STORAGE_SEGMENT_COUNT` 1–1024)
- [x] Tiered index — `LRUHotTier` → `DiskWarmTier` → `BrotliColdTier` via `TieredIndex` (Phase 9)
- [x] In-memory entry compression — `CompressedMap` + `BrotliCompressionAdapter` (Phase 10)

### 4.6 Graph Visualization — ✅ shipped
- [x] Interactive HTML visualization — `IOManager.visualizeGraph()` (v1.9.1)
- [x] Export to standard graph formats — DOT, GraphML, GEXF, Mermaid via `IOManager.exportGraph(format)`
- [ ] Browser-based interactive explorer (live filtering/search UI) — out of scope for core library

---

## Phase 5: Advanced Features (Months 11-14) — mostly shipped

High effort features for sophisticated use cases. Largely shipped via PR #34's Phase 5 (Advanced features) and η.5.x series.

### 5.1 Vector Database Integration — ✅ scaffolded (external drivers pending)
- [x] `IVectorDBAdapter` interface + `InMemoryVectorAdapter` (`src/adapters/IVectorDBAdapter.ts`)
- [x] In-process vector stores — `InMemoryVectorStore`, `SQLiteVectorStore`, `QuantizedVectorStore` (`src/search/`)
- [x] Multi-vector embeddings — `EmbeddingService` per-collection support
- [x] Automatic embedding synchronization — `MEMORY_AUTO_INDEX_EMBEDDINGS=true` + `EmbeddingCache`
- [ ] Concrete external adapters — Weaviate / Pinecone / pgvector (covered by MEM-06)

### 5.2 Graph Embeddings — ✅ shipped
- [x] node2vec — `BiasedRandomWalk` + `SkipGramTrainer` (`src/search/Node2Vec.ts`)
- [x] Embedding-based entity similarity — `SemanticSearch` + `HybridSearchManager`
- [ ] GraphSAGE for inductive learning — out of scope (node2vec covers the common case; GraphSAGE adds a TF/PyTorch dependency)

### 5.3 ML-Powered Features — ✅ shipped
- [x] Anomaly detection in relationships — `AnomalyDetector` (LSH-based, `src/features/AnomalyDetector.ts`)
- [x] Locality-Sensitive Hashing — `LSHIndex` (`src/search/`)
- [x] Pattern detection — `PatternDetector` (`src/agent/`)
- [x] Bloom-filter pre-screening — `BloomFilter` + `BloomPreScreener` (`src/search/`)
- [x] Entity clustering — `ExperienceExtractor.clusterTrajectories()` + `synthesizeExperience()`
- [ ] Auto-tagging based on observations — partial (`KeywordExtractor` extracts but no auto-apply step)
- [ ] Knowledge graph completion (predict missing relations) — not started

### 5.4 Standards Compliance — ✅ shipped
- [x] SPARQL query support — `SparqlExecutor` minimal BGP / FILTER / OPTIONAL / UNION subset (Phase 6 of perf track)
- [x] RDF import/export — Turtle, RDF/XML, JSON-LD via `IOManager.exportGraph()` (η.5.4)
- [x] Linked Data compatibility — W3C RDF 1.1 with reification fallback for non-NCName predicates
- [x] Query DSL — `QueryParser` + `QueryDslError` + `QueryAnalyzer` + `QueryPlanner` (Phase 5 of perf track)

### 5.5 Collaboration Features — ✅ shipped (real-time WS out of scope)
- [x] Multi-user graph editing with attribution — `CollaborationAuditEnforcer` strict-mode (η.5.5.d)
- [x] Optimistic concurrency control — `EntityManager.updateEntity(name, updates, { expectedVersion })` (η.5.5.c)
- [x] Change conflict resolution — `CollaborativeSynthesis.resolveConflicts(result, policy)` with policies (`most_recent` / `highest_confidence` / `highest_score` / `trusted_agent`) (η.5.5.a)
- [x] Visibility expansion — `AgentEntity.visibleFrom` / `visibleUntil` / `allowedRoles[]` (η.5.5.b)
- [x] CRDT primitives — `VectorClock`, `LWWRegister`, `ORSet`, `CRDTGraph` (`src/features/CRDT.ts`) for eventual-consistency merge
- [ ] Real-time collaboration via WebSockets — out of scope for core library (transport layer; build on top via MCP server)

---

## Phase 6: Enterprise (Months 14+) — 2 of 5 shipped

Very high effort features for enterprise deployments. Access control and security/compliance fully shipped; distributed / cloud-native / GPU remain.

### 6.1 Access Control — ✅ shipped
- [x] Role-Based Access Control (RBAC) — `RbacMiddleware`, `RoleAssignmentStore`, permission matrix (η.6.1, `src/agent/rbac/`)
- [x] Attribute-Based Access Control (ABAC) — `ABACPolicy` + `ABACPolicyError` (`src/security/abac.ts`, Phase 5 of perf track)
- [x] Row-level security — `RowLevelFilter` (`src/security/rls.ts`)
- [x] API key management — `APIKeyStore` (`src/security/apiKeys.ts`)

### 6.2 Distributed Architecture — ⏳ partial (single-process building blocks shipped; multi-node coordinator pending)
- [x] Write-ahead log for consistency — `WriteAheadLog` + `EntityProxy` (`src/core/`, Phase 6 of perf track)
- [x] Conflict-free replicated data types (CRDTs) — `VectorClock`, `LWWRegister`, `ORSet`, `CRDTGraph` (`src/features/CRDT.ts`, Phase 5 of perf track)
- [x] Sharding primitives — `FileSegmentStorage` + `FnvSegmentRouter` (single-process FNV-routed JSONL shards; Phase 7 of perf track)
- [ ] **Multi-node sharding coordinator** — not started (no cross-process / cross-host routing layer; current `FileSegmentStorage` is in-process)
- [ ] **Read replicas for query scaling** — not started (SQLite read-pool covers in-process concurrent reads via `MEMORY_SQLITE_READ_POOL_SIZE`; cross-host replication pending)
- [ ] **Cross-host replication transport** — not started

### 6.3 Security & Compliance — ✅ shipped
- [x] PII detection and masking — `PiiRedactor` + DEFAULT_PII_PATTERNS (email / SSN / CC / phone / IP); `redactWithStats()` for audit trails (η.6.3)
- [x] Complete audit logging — `AuditLog` (immutable JSONL, v1.6.0) + `CollaborationAuditEnforcer` (strict-mode attribution, η.5.5.d)
- [x] Governance + transactional rollback — `GovernanceManager.withTransaction()` + `GovernancePolicy` (canCreate / canUpdate / canDelete, v1.6.0)
- [x] Path-traversal hardening — `validateFilePath` defaults to `confineToBase=true` (PR #38); symlink-attack guards in `BackupManager.delete()` (PR #39)
- [x] Secure defaults — `crypto.randomBytes` for ID generation (replaces `Math.random`), ReDoS-resistant regex escapes, bounded `TaskQueue` (`MAX_QUEUE` 100k, `MAX_COMPLETED` 10k)
- [ ] **GDPR right-to-deletion tooling** — partial (`ctx.semanticForget` two-tier deletion with audit logs; formal GDPR-export and erasure-confirmation workflows pending)
- [ ] **Encryption at rest (AES-256)** — out of scope for library (delegate to OS filesystem encryption or SQLite Encryption Extension)
- [ ] **Encryption in transit (TLS)** — N/A for library; consumer concern

### 6.4 Cloud-Native Deployment — ⏳ not started
- [ ] Kubernetes manifests and Helm charts
- [ ] Docker images for containerization
- [ ] Serverless adapters (AWS Lambda, Cloud Functions)
- [ ] Cloud storage backends (S3, GCS, Azure Blob)

> *These are deployment-artefact deliverables that may live in a sibling repo or downstream packaging project once API stability is declared.*

### 6.5 GPU Acceleration — ⏳ deferred
- [ ] CUDA-accelerated similarity search
- [ ] Batch embedding generation on GPU
- [ ] Parallel graph algorithm execution on GPU

> *`src/search/Node2Vec.ts` source comments explicitly defer GPU acceleration. The current CPU-only Levenshtein worker pool + native `better-sqlite3` + Brotli compression handles the practical performance envelope for graphs up to ~10 M entities.*

---

## Backlog Audit — Verified Status

**Last refreshed:** 2026-05-13 (against `dependency-summary.compact.json` 2026-05-13, `src/` HEAD, and CHANGELOG.md). The 2026-04-24 audit identified 6 execution phases (α → η); **α through η plus Phases 0–11 of the performance & scale track are now shipped or partially shipped** (see breakdown below). Most items previously marked "0 hits in src/" now have full implementations.

> **Method:** RLM cross-reference of plan/spec docs against actual `src/` symbol presence. Classes are verified by name in the dependency-graph compact JSON; behavioural completeness is verified per CHANGELOG.md.

### A. v1.11.0 Memory Engine Core — ✅ shipped

- [x] Tier 1 exact-equality dedup (`Entity.contentHash` SHA-256 + SQLite `idx_entities_content_hash`)
- [x] Tier 2 50% prefix overlap dedup
- [x] Tier 3 Jaccard ≥ 0.72 dedup
- [x] Optional semantic-tier dedup (gated by `MEMORY_ENGINE_SEMANTIC_DEDUP`)
- [x] `MemoryEngine` (`src/agent/MemoryEngine.ts`) + `ImportanceScorer`
- [x] `Entity.contentHash` field
- [x] Self-review checklist + verification gates
- [x] CHANGELOG + version tag through v1.15.0

→ **Phase α complete.**

### B. v1.12.0 Memory Engine — ✅ shipped (B1) / outstanding (B2 partial)

#### B1. Decay extensions + pluggable backend — ✅ shipped

- [x] `IMemoryBackend` interface (`src/agent/MemoryBackend.ts`)
- [x] `InMemoryBackend` adapter (`src/agent/InMemoryBackend.ts`)
- [x] `SQLiteBackend` adapter (`src/agent/SQLiteBackend.ts`)
- [x] `DecayEngine.calculatePrdEffectiveImportance()` — exists per CLAUDE.md "PRD Decay Extensions (v1.12.0 — Phase β.5/β.6)"
- [x] PRD `MEM-01` configurable decay parameters via env vars: `MEMORY_PRD_DECAY_RATE`, `MEMORY_PRD_FRESHNESS_COEFFICIENT`, `MEMORY_PRD_RELEVANCE_WEIGHT`, `MEMORY_PRD_MIN_IMPORTANCE_THRESHOLD`
- [x] PRD importance range `[1.0, 3.0]` mapping (auto-translates from `[0, 10]` scale)

→ **Phase β complete.**

#### B2. PRD §8 functional requirements

- [x] MEM-01 — configurable decay parameters via env vars
- [x] MEM-02 — auto-importance scoring (`ImportanceScorer`)
- [x] MEM-03 — three-tier dedup (`MemoryEngine`)
- [x] MEM-04 — `IMemoryBackend` interface
- [ ] **MEM-05** — `PostgreSQLBackend` for multi-user deployment with tenant isolation *(not started)*
- [ ] **MEM-06** — `VectorMemoryBackend` for cross-session semantic recall *(partial: `IVectorDBAdapter` + `InMemoryVectorAdapter` exist as scaffolding; concrete pgvector/Pinecone wiring pending)*

→ MEM-05/06 remain in **Phase γ** (backend expansion).

### C. ROADMAP Phase 3B — ✅ shipped (3B.1–3B.7 complete)

All seven Phase 3B services have full implementations under `src/agent/`:

- [x] **3B.1 Memory Validator Service** — `MemoryValidator` class with `validateConsistency`, `detectContradictions`, `repairWithResolver`, `validateTemporalOrder`, `calculateReliability`
- [x] **3B.2 Trajectory Compressor Service** — `TrajectoryCompressor` class with `distill`, `abstractAtLevel`, `findRedundancies`, `mergeRedundant`
- [x] **3B.3 Experience Extractor Service** — `ExperienceExtractor` class with `extractFromContrastivePairs`, `clusterTrajectories`, `synthesizeExperience`
- [x] **3B.4 Procedural Memory** — `ProcedureManager`, `ProcedureStore`, `StepSequencer` (`src/agent/procedural/`)
- [x] **3B.5 Active Retrieval** — `ActiveRetrievalController`, `QueryRewriter` (`src/agent/retrieval/`)
- [x] **3B.6 Causal Reasoning** — `CausalReasoner` (`src/agent/causal/`)
- [x] **3B.7 World Model** — `WorldModelManager`, `WorldStateSnapshot` (`src/agent/world/`)

→ **Phase δ and Phase η.1 complete.**

### D. ROADMAP Phase 4 — Integration & Scale — mostly shipped

- [x] **4.1 Database Adapters** — `IDatabaseAdapter`, `NullDatabaseAdapter`, `InMemoryDatabaseAdapter`, `IVectorDBAdapter`, `InMemoryVectorAdapter` (`src/adapters/`)
- [x] **4.2 REST API Generation** — `RestRouter` (`src/adapters/RestRouter.ts`)
- [ ] **4.3 Elasticsearch Integration** — **not started** (no Elasticsearch class in src/)
- [x] **4.4 Temporal Versioning** — `RelationManager.invalidateRelation` / `queryAsOf` / `timeline` (v1.9.0); `EntityManager.invalidateEntity` / `entityAsOf` / `entityTimeline` and `ObservationManager.invalidateObservation` / `observationsAsOf` (η.4.4)
- [x] **4.5 Scalability Improvements** — Phases 7–11 shipped via PR #34: `FileSegmentStorage` (FNV-routed JSONL shards), `JsonlColumnStore`, `TieredIndex` (hot/warm/cold), `CompressedMap`, `IMmapBackend` + `FsReadMmapBackend`
- [x] **4.6 Graph Visualization** — `IOManager.visualizeGraph` (v1.9.1)

→ **Mostly Phase η.2 complete**; Elasticsearch is the lone outstanding item.

### E. ROADMAP Phase 5 — Advanced Features — partial / mostly shipped

- [x] **5.1 Vector Database Integration** — `IVectorDBAdapter` + `InMemoryVectorStore` + `SQLiteVectorStore` + `QuantizedVectorStore`; pgvector/Pinecone-specific adapters still pending (overlap with MEM-06)
- [x] **5.2 Graph Embeddings** — node2vec components shipped: `BiasedRandomWalk`, `SkipGramTrainer` (`src/search/Node2Vec.ts`)
- [x] **5.3 ML-Powered Features** — `AnomalyDetector` (LSH-based), `LSHIndex`, `PatternDetector`, `BloomFilter` + `BloomPreScreener`
- [x] **5.4 Standards Compliance** — Turtle / RDF/XML / JSON-LD export (η.5.4); minimal SPARQL subset via `SparqlExecutor` (Phase 6 of perf track)
- [x] **5.5 Collaboration Features** — `CollaborativeSynthesis` + `ConflictResolver` + `CollaborationAuditEnforcer` + OCC (`EntityManager.updateEntity` with `expectedVersion`); CRDT primitives `VectorClock` / `LWWRegister` / `ORSet` / `CRDTGraph` (`src/features/CRDT.ts`)

→ **Phase η.3 complete**; concrete external-vector-DB adapters remain.

### F. ROADMAP Phase 6 — Enterprise — partial

- [x] **6.1 Access Control** — `RbacMiddleware` + `RoleAssignmentStore` + permission matrix (η.6.1); `ABACPolicy` + `RowLevelFilter` + `APIKeyStore` (Phase 5 of perf track, `src/security/`)
- [ ] **6.2 Distributed Architecture** — **not started** (no clustering / sharding-coordinator class in src/; segment storage is single-process)
- [x] **6.3 Security & Compliance** — `PiiRedactor` + DEFAULT_PII_PATTERNS (η.6.3); `AuditLog` + `GovernanceManager` + `GovernanceTransaction` (v1.6.0); path-traversal hardening (PRs #38 + #39 in v1.15.0)
- [ ] **6.4 Cloud-Native Deployment** — **not started** (no Helm chart / K8s operator / Docker image in repo)
- [ ] **6.5 GPU Acceleration** — **not started** (the one source mention of "GPU" in `src/search/Node2Vec.ts` is a comment ruling it out; CPU-only Levenshtein worker pool stands)

→ **Half of Phase η.4 complete**; 6.2 / 6.4 / 6.5 remain the genuine outstanding enterprise items.

### G. `future_features.md` performance/optimization tracks — ✅ mostly shipped

15 sections from `future_features.md` covering Search Latency, Write Throughput, Memory Footprint, Query Execution, Storage Backend, Observability, Search Intelligence, Graph Analytics, Entity Lifecycle, CLI Enhancements, Memory Intelligence, Query Language, Integration & Ecosystem, Advanced Features, Enterprise — see [`future_features.md`](./future_features.md) for the per-section ship state. Major shipments via PR #34: BM25 incrementality (1.1), batch coalescing window (1.3), bounded `TaskQueue` (2.x), `CompressedMap` (3.x), `QueryPlanner` + `QueryCostEstimator` + `QueryPlanCache` (4.x), `FileSegmentStorage` + mmap branch + `JsonlColumnStore` + `TieredIndex` (5.x), structured `logger` + `IndexHealthMonitor` + `explainPlan` diagnostics (6.x), `SparqlExecutor` minimal subset (11B.x), HITS / Louvain / clique (8.x).

### H. Explicitly skipped performance benchmarks

The 10 previously-skipped `it.skip` benchmarks across `tests/performance/embedding-benchmarks.test.ts` and `tests/performance/foundation-benchmarks.test.ts` were **un-skipped 2026-04-25** after the "codebase split" event completed. CLAUDE.md's "Gotchas > Performance benchmark flakiness" section now governs them with widened thresholds for Windows + Dropbox file-locking variance.

- [x] Cache operations performance — un-skipped
- [x] Batch embedding efficiency — un-skipped
- [x] Incremental indexing throughput — un-skipped
- [x] Linear scaling, entity deletion — un-skipped
- [x] Linear scaling, relation deletion — un-skipped
- [x] `findDuplicates` with pre-computed data — un-skipped
- [x] Linear scaling, compression — un-skipped
- [x] Tag operations scaling — un-skipped
- [x] Bulk tag operations scaling — un-skipped
- [x] Complex workflow time limit — un-skipped

→ **Phase ε complete.** Gated from default `npm test` by `SKIP_BENCHMARKS=true` env-var support inside individual tests.

### I. Out of scope / deferred

- **Clawvault** (separate concept, 4-phase plan) — **out of scope** per `GAP_ANALYSIS_VS_SUPERMEMORY.md` ("Out of scope for core library; better suited as separate packages or MCP tools"). Spin out as `memoryjs-clawvault` sibling repo when there's pull.

### J. Source-level TODOs/FIXMEs

**0 real source TODOs** as of 2026-05-13. The one regex hit in `src/agent/ObserverPipeline.ts` is a *regex pattern definition* used to detect TODO-shaped observations in incoming text — not a code TODO itself.

### Plan-doc rot — addressed

The 2026-04-24 audit found 476 unchecked checkboxes vs. ~10 actually-pending items. **Phase ζ** of the execution plan introduced `tools/plan-doc-audit/` and `npm run audit:plans` (PostToolUse hook) to keep plan-doc state in sync with `src/` going forward.

### Summary table (2026-05-13)

| Category | Status | Notes |
|---|---|---|
| A. v1.11.0 Memory Engine | ✅ shipped | MemoryEngine + 4-tier dedup + contentHash |
| B1. v1.12.0 backend foundation | ✅ shipped | IMemoryBackend + InMemoryBackend + SQLiteBackend + PRD decay |
| B2. MEM-05/06 | ⏳ outstanding | PostgreSQL + concrete vector backends |
| C. Phase 3B.1–3B.7 | ✅ shipped | All 7 services in src/agent/ |
| D. Phase 4 (4.1–4.6) | ✅ 5 of 6 shipped | Elasticsearch (4.3) remains |
| E. Phase 5 (5.1–5.5) | ✅ shipped | Node2Vec + LSH + RDF/SPARQL + CRDT + collaborative synthesis |
| F. Phase 6 (6.1–6.5) | ⚠️ 2 of 5 shipped | Access control + security/compliance done; distributed / cloud-native / GPU pending |
| G. future_features.md 1–15 | ✅ mostly shipped | Phases 0–11 of perf & scale track absorbed most items |
| H. Skipped benchmarks | ✅ all unskipped | Phase ε complete |
| I. Clawvault | ⛔ out of scope | Sibling repo if/when pulled |
| J. Source TODOs | ✅ zero | No real TODOs in src/ |

**Outstanding work in priority order:**
1. **MEM-05** — `PostgreSQLBackend` (multi-user deployment with tenant isolation)
2. **MEM-06** — Concrete external `VectorMemoryBackend` (pgvector or Pinecone)
3. **4.3** — Elasticsearch integration
4. **6.2** — Distributed architecture (clustering / replication / sharding coordinator)
5. **6.4** — Cloud-native deployment artefacts (Helm chart / K8s operator / Docker image)
6. **6.5** — GPU acceleration (deferred — Node2Vec already declines it in code comments)

---

## Feature Categories

### Query Language Enhancements
- Domain-specific query language (DSL)
- SQL-like syntax for familiarity
- Visual query builder

### Integration Possibilities

| Integration | Purpose | Priority |
|-------------|---------|----------|
| PostgreSQL | Production-grade backend | High |
| Elasticsearch | Advanced text search | High |
| Neo4j | Graph database bridge | Medium |
| Redis | Distributed caching | Medium |
| OpenAI/Anthropic | Embeddings and reasoning | High |
| LangChain | LLM memory backend | High |
| Llama Index | Data connector | Medium |

### Framework Integrations

| Framework | Integration Type | Priority |
|-----------|------------------|----------|
| NestJS | Module with decorators | Medium |
| Fastify | REST API plugin | High |
| Express | Middleware | Medium |
| Next.js | API routes support | Medium |

---

## Performance Optimization Roadmap

### Quick Wins
- Incremental index updates (only reindex changes)
- Search result caching with TTL
- Lazy loading for relations
- Connection pooling

### Architectural Improvements
- Graph partitioning strategies
- Bloom filters for negative lookups
- Approximate algorithms (LSH for fuzzy search)
- Columnar storage for observations

### Long-term Redesign
- Distributed multi-node architecture
- GPU acceleration for similarity
- Time-series optimized indexes
- Adaptive indexing based on query patterns

---

## Test Coverage Expansion

### Current Coverage
- 90 test files with comprehensive unit, integration, and performance tests
- Strong coverage of core functionality

### Planned Test Additions
- CLI tool testing
- GraphQL resolver tests
- Property-based testing for search algorithms
- Chaos engineering for concurrency
- Load testing for scaling scenarios
- Security fuzzing for input validation

---

## Dependency Strategy

### Current Dependencies (Minimal)
- `@danielsimonjr/workerpool` - Worker pool management
- `async-mutex` - Concurrency control
- `better-sqlite3` - SQLite backend
- `zod` - Runtime validation

### Recommended Additions
| Purpose | Library | Rationale |
|---------|---------|-----------|
| GraphQL | `graphql`, `graphql-tools` | Standard GraphQL support |
| CLI | `commander` | CLI argument parsing |
| REST | `fastify` | High-performance HTTP |
| Vector DB | `@weaviate/weaviate-client` | Semantic search |
| Embeddings | `@xenova/transformers` | Local embedding fallback |

### Principles
- Keep the core library lean
- Add integrations as optional peer dependencies
- Maintain backward compatibility
- Prefer well-maintained, actively developed libraries

---

## Breaking Change Policy

### Avoid Breaking
- Core Entity/Relation/KnowledgeGraph interfaces
- Search result ranking algorithms (without deprecation)
- JSONL storage format (backward compatibility)

### Gradual Rollout
- Feature flags for experimental features (env vars)
- Deprecation periods (2 minor versions minimum)
- Beta releases for major features
- Migration guides for breaking changes

---

## Contributing to the Roadmap

This roadmap is a living document. To propose features:

1. Open an issue with the `roadmap` label
2. Describe the use case and expected benefits
3. Indicate preferred priority tier
4. Include implementation considerations if known

The maintainers will review proposals quarterly and update this roadmap accordingly.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-12 | Initial roadmap creation |
| 1.1 | 2025-01-13 | Added Phase 3: Agent Memory System with comprehensive short-term and long-term memory support for AI agents. Includes memory lifecycle, decay engine, consolidation pipeline, salience scoring, context window management, session/episodic memory, and multi-agent support. See [Agent Memory Architecture](../architecture/AGENT_MEMORY.md) for detailed specifications. |
| 1.2 | 2026-01-19 | Marked Phase 3 as COMPLETED (v1.2.0). Added Phase 3B: Memory Intelligence based on "From Storage to Experience: A Survey on the Evolution of LLM Agent Memory Mechanisms" (Luo et al., 2026). New features include: Memory Validation & Error Rectification, Trajectory Compression, Experience Extraction (cross-trajectory abstraction), Procedural Memory Manager, Heuristic Guidelines Manager, Active Retrieval Controller, Causal Relations, and World Model Manager. Adjusted Phase 4-6 timelines accordingly. |
| 1.3 | 2026-03-24 | Added Phase 3C: Must-Have Infrastructure Features — marked COMPLETED (v1.6.0). Eight features implemented: Stable Index Dereferencing (RefIndex), Artifact-Level Granularity (ArtifactManager), Temporal Range Queries (TemporalQueryParser + TemporalSearch), Memory Distillation Policy (DistillationPolicy + DistillationPipeline), Temporal Governance & Freshness (FreshnessManager, Entity.ttl/confidence), N-gram Hashing (NGramIndex), LLM Query Planner (LLMQueryPlanner + LLMSearchExecutor), Dynamic Memory Governance (AuditLog + GovernanceManager). |
| 1.4 | 2026-03-24 | Added Phase 3D: Should-Have Agent Intelligence Features — marked COMPLETED (v1.7.0). Eight features implemented: Role-Aware Memory Customization (RoleProfiles), Entropy-Aware Filtering (EntropyFilter), Recursive Memory Consolidation (ConsolidationScheduler), Visual Salience Budget Allocation (MemoryFormatter.formatWithSalienceBudget), Collaborative Memory Synthesis (CollaborativeSynthesis), Failure-Driven Memory Distillation (FailureDistillation), Cognitive Load Metrics (CognitiveLoadAnalyzer), Shared Memory Visibility Hierarchies (VisibilityResolver + GroupMembership). |
| 1.5 | 2026-04-24 | Added **Backlog Audit (2026-04-24) — Verified Status** section consolidating in-flight/spec-only/not-started items via RLM cross-reference of plan docs against `src/` symbol presence. Companion execution plan in `docs/superpowers/plans/2026-04-24-backlog-execution-phases.md` defines an agent-driven 7-phase sequence (α through η) with explicit verification gates, dispatch patterns, and dependency ordering. Findings: 0 real source TODOs, 10 skipped perf benchmarks pending unskip, 476-vs-10 plan-checkbox-vs-reality drift addressed via new Phase ζ tooling. |

---

## References

### Research Papers

- **Luo, J., Tian, Y., Cao, C., et al. (2026)**. "From Storage to Experience: A Survey on the Evolution of LLM Agent Memory Mechanisms." *Preprints.org*, doi:10.20944/preprints202601.0618.v2. [Paper Link](https://www.preprints.org/manuscript/202601.0618/v2)
  - Proposes three-stage evolutionary framework: Storage → Reflection → Experience
  - Key concepts applied to Phase 3B: Error rectification, trajectory compression, cross-trajectory abstraction, procedural primitives, heuristic guidelines, active memory perception, causal structure modeling
