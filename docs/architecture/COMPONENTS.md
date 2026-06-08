# MemoryJS - Component Reference

**Version**: 2.0.0 (Phases 0–11 performance & scale track via PR #34; Phase 2 memory-types expansion Sprints 4–6 + 8; v2.0.0 seven-theme function/API-call consistency & efficiency audit)
**Last Updated**: 2026-05-14

---

## Table of Contents

1. [Overview](#overview)
2. [Agent Components](#agent-components)
3. [Core Components](#core-components)
4. [Search Components](#search-components)
5. [Feature Components](#feature-components)
6. [Utility Components](#utility-components)
7. [Type Definitions](#type-definitions)
8. [Component Dependencies](#component-dependencies)

---

## Overview

MemoryJS follows a layered architecture with specialized components:

```
┌─────────────────────────────────────────────────────────────┐
│  adapters/         │  External-system adapters (4 files)    │
├─────────────────────────────────────────────────────────────┤
│  agent/            │  Agent memory system (66 files)        │
├─────────────────────────────────────────────────────────────┤
│  core/             │  Central managers + storage (25 files) │
├─────────────────────────────────────────────────────────────┤
│  search/           │  Search implementations (55 files)     │
├─────────────────────────────────────────────────────────────┤
│  features/         │  Advanced capabilities (20 files)      │
├─────────────────────────────────────────────────────────────┤
│  utils/            │  Shared utilities (34 files)           │
├─────────────────────────────────────────────────────────────┤
│  types/            │  TypeScript definitions (8 files)      │
├─────────────────────────────────────────────────────────────┤
│  security/         │  PII / ABAC / RLS / API keys (5 files) │
├─────────────────────────────────────────────────────────────┤
│  cli/              │  CLI binary commands (16 files)        │
├─────────────────────────────────────────────────────────────┤
│  entry/            │  Library entry point (1 file)          │
├─────────────────────────────────────────────────────────────┤
│  workers/          │  Web workers (2 files)                 │
└─────────────────────────────────────────────────────────────┘
```

**Total:** 236 TypeScript files | 79,841 LOC | 1,262 exports | 214 classes | 501 interfaces
(authoritative numbers from `docs/architecture/dependency-summary.compact.json`, regenerated 2026-05-14; see `TEST_COVERAGE.md` for test counts)

### New since v1.13: dedicated sub-modules under `agent/`

- `agent/causal/` — `CausalReasoner` (3B.6)
- `agent/procedural/` — `ProcedureManager` + `StepSequencer` (3B.4)
- `agent/retrieval/` — `ActiveRetrievalController` + `QueryRewriter` (3B.5)
- `agent/world/` — `WorldModelManager` + `WorldStateSnapshot` (3B.7)
- `agent/rbac/` — `RbacMiddleware` + `RoleAssignmentStore` + `PermissionMatrix` (η.6.1)
- `agent/collaboration/` — `CollaborationAuditEnforcer` (η.5.5.d)

### Dedicated sub-modules under `core/` and `utils/`

- `core/mmap/` — `IMmapBackend` + `FsReadMmapBackend`
- `core/segments/` — `FileSegmentStorage` (FNV-routed JSONL shards)
- `core/columns/` — `IColumnStore<T>` + `JsonlColumnStore` + `InMemoryColumnStore` + `ObservationColumn`
- `core/tiered/` — `ITieredIndex` + `LRUHotTier` + `DiskWarmTier` + `BrotliColdTier`
- `utils/compression/` — `ICompressionAdapter` + `ZlibCompressionAdapter` + `IdentityCompressionAdapter` + `CompressedMap`
- `features/BackupManager.ts` — extracted from `IOManager`

---

## Agent Components

### AgentMemoryManager (`agent/AgentMemoryManager.ts`)

**Purpose**: Unified facade for AI agent memory operations

```typescript
export class AgentMemoryManager {
  constructor(context: ManagerContext, config?: AgentMemoryConfig)

  // Session Management
  async startSession(options?: SessionOptions): Promise<SessionEntity>
  async endSession(sessionId: string): Promise<void>
  async getActiveSession(): Promise<SessionEntity | null>

  // Working Memory
  async addWorkingMemory(sessionId: string, content: string, options?): Promise<AgentEntity>
  async getWorkingMemories(sessionId: string): Promise<AgentEntity[]>
  async clearExpiredMemories(): Promise<number>

  // Memory Lifecycle
  async reinforceMemory(entityName: string): Promise<void>
  async promoteToLongTerm(entityName: string): Promise<void>
  async consolidateSession(sessionId: string, options?): Promise<ConsolidationResult>

  // Retrieval
  async retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage>
  async getMostSalient(context: SalienceContext, limit: number): Promise<ScoredEntity[]>

  // Lifecycle
  start(): void   // Start decay scheduler
  stop(): void    // Stop decay scheduler
}
```

---

### SessionManager (`agent/SessionManager.ts`)

**Purpose**: Session lifecycle management

```typescript
export class SessionManager {
  constructor(storage: IGraphStorage)

  async createSession(options?: SessionOptions): Promise<SessionEntity>
  async getSession(sessionId: string): Promise<SessionEntity | null>
  async getActiveSession(): Promise<SessionEntity | null>
  async endSession(sessionId: string): Promise<void>
  async listSessions(filter?: SessionFilter): Promise<SessionEntity[]>
}
```

---

### WorkingMemoryManager (`agent/WorkingMemoryManager.ts`)

**Purpose**: Short-term memory with TTL and promotion

```typescript
export class WorkingMemoryManager {
  constructor(storage: IGraphStorage, config?: WorkingMemoryConfig)

  async createWorkingMemory(sessionId: string, content: string, options?): Promise<AgentEntity>
  async getSessionMemories(sessionId: string): Promise<AgentEntity[]>
  async clearExpired(): Promise<number>
  async extendTTL(entityNames: string[], additionalHours: number): Promise<void>
  async markForPromotion(entityName: string): Promise<void>
  async getPromotionCandidates(sessionId: string): Promise<AgentEntity[]>
}
```

---

### DecayEngine (`agent/DecayEngine.ts`)

**Purpose**: Time-based importance decay calculations

```typescript
export class DecayEngine {
  constructor(config?: DecayConfig)

  calculateEffectiveImportance(entity: AgentEntity): number
  calculateDecayFactor(lastAccessedAt: string, halfLifeHours: number): number
  async getDecayedMemories(threshold: number): Promise<AgentEntity[]>
  async reinforceMemory(entityName: string, amount?: number): Promise<void>
}
```

**Decay Formula**:
```
effective_importance = base_importance × decay_factor × strength_multiplier
decay_factor = e^(-ln(2) × age_hours / half_life_hours)
```

---

### DecayScheduler (`agent/DecayScheduler.ts`)

**Purpose**: Scheduled decay cycle execution

```typescript
export class DecayScheduler {
  constructor(decayEngine: DecayEngine, config?: SchedulerConfig)

  start(): void
  stop(): void
  runDecayCycle(): Promise<DecayResult>
  setInterval(intervalMs: number): void
}
```

---

### SalienceEngine (`agent/SalienceEngine.ts`)

**Purpose**: Context-aware memory scoring

```typescript
export class SalienceEngine {
  constructor(storage: IGraphStorage, accessTracker: AccessTracker)

  calculateSalience(entity: AgentEntity, context: SalienceContext): number
  async getMostSalient(context: SalienceContext, limit: number): Promise<ScoredEntity[]>
  calculateNovelty(entity: AgentEntity): number
  calculateTaskRelevance(entity: AgentEntity, taskDescription: string): Promise<number>
}
```

**Salience Components**:
- Base importance
- Recency boost
- Frequency boost
- Context relevance
- Novelty bonus

---

### ContextWindowManager (`agent/ContextWindowManager.ts`)

**Purpose**: LLM context window optimization

```typescript
export class ContextWindowManager {
  constructor(config?: ContextWindowConfig)

  async retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage>
  estimateTokens(entity: AgentEntity): number
  prioritize(entities: AgentEntity[], maxTokens: number): AgentEntity[]
}
```

---

### MemoryFormatter (`agent/MemoryFormatter.ts`)

**Purpose**: Memory-to-prompt formatting

```typescript
export class MemoryFormatter {
  formatForPrompt(memories: AgentEntity[], options?: FormatOptions): string
  formatEntity(entity: AgentEntity): string
  formatObservations(observations: string[], limit?: number): string
}
```

---

### MultiAgentMemoryManager (`agent/MultiAgentMemoryManager.ts`)

**Purpose**: Multi-agent shared memory and conflict resolution

```typescript
export class MultiAgentMemoryManager {
  constructor(storage: IGraphStorage, config?: MultiAgentConfig)

  async registerAgent(agentId: string, metadata?: AgentMetadata): Promise<void>
  async createAgentMemory(agentId: string, entity: Partial<AgentEntity>): Promise<AgentEntity>
  async getVisibleMemories(agentId: string, filter?: MemoryFilter): Promise<AgentEntity[]>
  async shareMemory(entityName: string, targetAgents: string[] | 'all'): Promise<void>
  async resolveConflict(conflictingEntities: string[], strategy: ConflictStrategy): Promise<AgentEntity>
}
```

---

### ConflictResolver (`agent/ConflictResolver.ts`)

**Purpose**: Conflict resolution strategies

```typescript
export class ConflictResolver {
  resolve(entities: AgentEntity[], strategy: ConflictStrategy): AgentEntity
}

type ConflictStrategy = 'most_recent' | 'highest_confidence' | 'most_confirmations' | 'merge_all';
```

---

### ConsolidationPipeline (`agent/ConsolidationPipeline.ts`)

**Purpose**: Memory consolidation from working to long-term

```typescript
export class ConsolidationPipeline {
  constructor(storage: IGraphStorage, config?: ConsolidationConfig)

  async consolidateSession(sessionId: string, options?: ConsolidateOptions): Promise<ConsolidationResult>
  async promoteMemory(entityName: string, targetType: MemoryType): Promise<void>
  async runAutoConsolidation(rules: ConsolidationRule[]): Promise<ConsolidationResult>
}
```

---

### AccessTracker (`agent/AccessTracker.ts`)

**Purpose**: Memory access pattern tracking

```typescript
export class AccessTracker {
  async recordAccess(entityName: string, context?: AccessContext): Promise<void>
  getAccessStats(entityName: string): AccessStats     // v2.0.0: synchronous (was Promise)
  calculateRecencyScore(entityName: string, halfLifeHours?: number): number
  async getFrequentlyAccessed(limit: number): Promise<Entity[]>
  async getRecentlyAccessed(limit: number): Promise<Entity[]>
  flush(): void                                       // v2.0.0: synchronous (was Promise)
}
```

---

### EpisodicMemoryManager (`agent/EpisodicMemoryManager.ts`)

**Purpose**: Timeline-based episodic memory

```typescript
export class EpisodicMemoryManager {
  constructor(storage: IGraphStorage)

  async addEpisode(sessionId: string, content: string, metadata?: EpisodeMetadata): Promise<AgentEntity>
  async getSessionEpisodes(sessionId: string): Promise<AgentEntity[]>
  async getRecentEpisodes(limit: number): Promise<AgentEntity[]>
  async searchEpisodes(query: string, options?: SearchOptions): Promise<AgentEntity[]>
}
```

---

### SummarizationService (`agent/SummarizationService.ts`)

**Purpose**: Memory summarization for consolidation

```typescript
export class SummarizationService {
  constructor(config?: SummarizationConfig)

  async summarizeObservations(observations: string[]): Promise<string>
  async summarizeEntities(entities: AgentEntity[]): Promise<string>
}
```

---

### PatternDetector (`agent/PatternDetector.ts`)

**Purpose**: Pattern detection in memories

```typescript
export class PatternDetector {
  async detectPatterns(entities: AgentEntity[], minOccurrences: number): Promise<Pattern[]>
  async extractRules(patterns: Pattern[]): Promise<Rule[]>
}
```

---

### RuleEvaluator (`agent/RuleEvaluator.ts`)

**Purpose**: Rule-based memory evaluation

```typescript
export class RuleEvaluator {
  async evaluateRules(entity: AgentEntity, rules: ConsolidationRule[]): Promise<RuleResult[]>
  shouldPromote(entity: AgentEntity, rules: ConsolidationRule[]): boolean
}
```

---

### ArtifactManager (`agent/ArtifactManager.ts`)

**Purpose**: Create and track artifacts with stable, human-readable names

```typescript
export class ArtifactManager {
  constructor(context: ManagerContext)

  async createArtifact(options: CreateArtifactOptions): Promise<ArtifactEntity>
  async getArtifact(ref: string): Promise<ArtifactEntity | null>
  async listArtifacts(filter?: ArtifactFilter): Promise<ArtifactEntity[]>
}
```

**Name Format**: `toolName-YYYY-MM-DD-shortId` (e.g., `code-gen-2026-03-24-a1b2c3`)

Auto-registers each artifact in `RefIndex` for stable O(1) lookup.

---

### DistillationPolicy (`agent/DistillationPolicy.ts`)

**Purpose**: Post-retrieval filter that reduces memory sets before LLM formatting

```typescript
export interface IDistillationPolicy {
  distill(memories: AgentEntity[], context: SalienceContext): Promise<AgentEntity[]>
}

export class DefaultDistillationPolicy implements IDistillationPolicy {
  // Applies: relevance score threshold, freshness filter, deduplication
}

export class CompositeDistillationPolicy implements IDistillationPolicy {
  constructor(policies: IDistillationPolicy[])
}

export class NoOpDistillationPolicy implements IDistillationPolicy {
  // Pass-through; used when distillation is disabled

---

### SessionQueryBuilder (`agent/SessionQueryBuilder.ts`)

**Purpose**: Builder for constructing session queries with filtering

```typescript
export class SessionQueryBuilder {
  forSession(sessionId: string): SessionQueryBuilder
  forAgent(agentId: string): SessionQueryBuilder
  inDateRange(start: string, end: string): SessionQueryBuilder
  withStatus(status: SessionStatus): SessionQueryBuilder
  withLimit(limit: number): SessionQueryBuilder
  async execute(): Promise<SessionEntity[]>
}
```

---

### DistillationPipeline (`agent/DistillationPipeline.ts`)

**Purpose**: Orchestrates ordered distillation policy execution

```typescript
export class DistillationPipeline {
  constructor(policies: IDistillationPolicy[])

  async run(memories: AgentEntity[], context: SalienceContext): Promise<AgentEntity[]>
  addPolicy(policy: IDistillationPolicy): void
}
```

Wired into `ContextWindowManager.retrieveForContext()` — runs after salience scoring and before token budgeting.

---

### RoleProfiles (`agent/RoleProfiles.ts`)

**Purpose**: Role-aware salience weight presets and token budget splits (v1.7.0)

```typescript
type AgentRole = 'researcher' | 'planner' | 'executor' | 'reviewer' | 'coordinator';

export interface RoleProfile {
  role: AgentRole;
  salienceWeights: SalienceWeights;     // importanceWeight, recencyWeight, etc.
  budgetSplits: BudgetSplits;           // working / episodic / semantic proportions
}

export class RoleProfileManager {
  constructor(salienceEngine: SalienceEngine, contextWindowManager: ContextWindowManager)

  apply(role: AgentRole): void          // Sets weights + budget splits
  getProfile(role: AgentRole): RoleProfile
  listProfiles(): RoleProfile[]
}
```

Five built-in profiles ship with opinionated defaults — e.g. `researcher` boosts semantic weight, `executor` boosts working-memory budget.

---

### EntropyFilter (`agent/EntropyFilter.ts`)

**Purpose**: Shannon entropy gate that removes low-information memories before consolidation (v1.7.0)

```typescript
export class EntropyFilter {
  constructor(config?: EntropyFilterConfig)  // threshold: number (default 0.3)

  score(entity: AgentEntity): number          // 0–1 entropy score
  filter(entities: AgentEntity[]): AgentEntity[]  // drops below-threshold entries
}
```

Integrated as an early stage in `ConsolidationPipeline`. Entropy is computed from observation token diversity using the standard Shannon formula over unigram frequencies.

---

### ConsolidationScheduler (`agent/ConsolidationScheduler.ts`)

**Purpose**: Background recursive deduplication and merge scheduler (v1.7.0)

```typescript
export class ConsolidationScheduler {
  constructor(pipeline: ConsolidationPipeline, config?: SchedulerConfig)
  //   intervalMs: number  (default 3_600_000)
  //   maxIterations: number

  start(): void
  stop(): void
  runNow(): Promise<ConsolidationResult>   // Manual one-shot cycle
}
```

Each scheduled cycle calls `ConsolidationPipeline.runAutoConsolidation()` and repeats until the result reports zero merges (fixed-point convergence).

---

### MemoryFormatter (`agent/MemoryFormatter.ts`) — updated

**Purpose**: Memory-to-prompt formatting with salience-proportional budget allocation (v1.7.0)

```typescript
export class MemoryFormatter {
  formatForPrompt(memories: AgentEntity[], options?: FormatOptions): string
  formatEntity(entity: AgentEntity): string
  formatObservations(observations: string[], limit?: number): string

  // v1.7.0
  formatWithSalienceBudget(
    memories: AgentEntity[],
    scores: Map<string, number>,
    totalTokens: number
  ): string   // Proportionally allocates tokens across memory-type sections
}
```

---

### CollaborativeSynthesis (`agent/CollaborativeSynthesis.ts`)

**Purpose**: Graph-neighbourhood synthesis merging observations from multiple agents (v1.7.0)

```typescript
export class CollaborativeSynthesis {
  constructor(storage: IGraphStorage, config?: SynthesisConfig)
  //   hopDepth: number   (default 2)

  async synthesize(
    entityName: string,
    requestingAgentId: string
  ): Promise<SynthesisResult>
}

interface SynthesisResult {
  unified: AgentEntity;          // Merged entity with combined observations
  provenance: ProvenanceEntry[]; // Per-observation source agent + timestamp
  agentCount: number;
  hopDepth: number;
}
```

Walks the relation graph up to `hopDepth` hops, collects all agent-contributed observations for reachable entities, and returns a unified view. Visibility rules from `VisibilityResolver` are enforced during traversal.

---

### FailureDistillation (`agent/FailureDistillation.ts`)

**Purpose**: Causal chain lesson extraction from failed episodes (v1.7.0)

```typescript
export class FailureDistillation {
  constructor(storage: IGraphStorage, pipeline: ConsolidationPipeline)

  async distill(failureEntityName: string): Promise<DistillationResult>
}

interface DistillationResult {
  lessons: AgentEntity[];        // Promoted semantic memories
  causalChain: string[];         // Ordered entity names in the failure path
  contributionScores: Map<string, number>;  // Per-step causal weight
}
```

Reconstructs the event sequence leading to the failure entity via reverse causal relation traversal, scores each step by causal contribution, and promotes the highest-scoring observations to semantic memory as reusable lessons.

---

### CognitiveLoadAnalyzer (`agent/CognitiveLoadAnalyzer.ts`)

**Purpose**: Multi-dimensional cognitive load scoring for a memory set (v1.7.0)

```typescript
export class CognitiveLoadAnalyzer {
  analyze(memories: AgentEntity[]): CognitiveLoadReport
}

interface CognitiveLoadReport {
  tokenDensity: number;       // Average tokens per observation
  redundancyRatio: number;    // Fraction of near-duplicate observations
  diversityScore: number;     // Observation vocabulary diversity (0–1)
  loadIndex: number;          // Composite 0–1 score (higher = more loaded)
}
```

`ContextWindowManager` consults `loadIndex` before final prompt assembly and prunes the highest-load sections when the index exceeds `MEMORY_COGNITIVE_LOAD_MAX`.

---

### VisibilityResolver (`agent/VisibilityResolver.ts`)

**Purpose**: Five-level shared memory visibility model with group membership (v1.7.0)

```typescript
type VisibilityLevel = 'private' | 'team' | 'org' | 'shared' | 'public';

export interface GroupMembership {
  agentId: string;
  teams: string[];
  orgs: string[];
}

export class VisibilityResolver {
  constructor(memberships: GroupMembership[])

  resolve(
    requestingAgentId: string,
    memories: AgentEntity[]
  ): AgentEntity[]   // Returns only memories visible to the requesting agent

  canAccess(
    requestingAgentId: string,
    entity: AgentEntity
  ): boolean
}
```

Visibility rules: `private` → owner only; `team` → same team members; `org` → same org members; `shared` → any registered agent; `public` → unrestricted.

---

### ProspectiveMemoryManager (`agent/ProspectiveMemoryManager.ts`)

**Purpose**: Intentions-to-act at a future time / event / condition. Phase 1 prospective memory. Catalog Type 4.

```typescript
export class ProspectiveMemoryManager {
  constructor(storage: IGraphStorage, config?: ProspectiveMemoryConfig)

  async schedule(intention: ProspectiveInput, options?: ScheduleOptions): Promise<ProspectiveEntity>
  async fire(id: string, result?: unknown): Promise<MarkResolvedResult>
  async cancel(id: string, reason?: string): Promise<CancelResult>
  async expireDueIntentions(): Promise<number>
  async getPending(filter?: { sessionId?: string; agentId?: string }): Promise<ProspectiveEntity[]>
  async getFired(filter?: { sessionId?: string }): Promise<ProspectiveEntity[]>
}
```

`ProspectiveLifecycle` discriminated union (`pending` / `fired` / `cancelled` / `expired`); `ProspectivePromotionStage` promotes fired `inject-context` actions to `'episodic'` with `prospective-fulfilled` tag.

---

### FailureManager (`agent/FailureManager.ts`)

**Purpose**: Pre-task failure lookup. Catalog Type 9 — "the single biggest concrete win available to most agentic systems" per the Phase 2 catalog. Sprint 4.

```typescript
export class FailureManager {
  constructor(storage: IGraphStorage, config?: FailureManagerConfig)

  async record(input: FailureInput, options?: FailureEntityOptions): Promise<FailureRecord>
  async lookupForTask(taskContext: string, options?: LookupOptions): Promise<FailureRecord[]>
  async markResolved(id: string, reason?: string): Promise<MarkResolvedResult>
  async getAll(options?: GetAllOptions): Promise<FailureRecord[]>
}
```

`FailureRecord` carries `context` / `attempted` / `failure_mode` / `root_cause` / `alternative_taken?` / `applicability_hint` (the retrieval key) / `lifecycle` / `sourceSessionId?`. `markResolved` returns discriminated `MarkResolvedResult` (`'resolved' | 'already-resolved' | 'not-found' | 'vanished-mid-update'`).

---

### PlanManager (`agent/PlanManager.ts`)

**Purpose**: Hierarchical goal trees with sub-tasks + acceptance criteria. Catalog Type 6. Sprint 5.

```typescript
export class PlanManager {
  constructor(storage: IGraphStorage, config?: PlanManagerConfig)

  async createPlan(rootDescription: string, options?: CreatePlanOptions): Promise<PlanRecord>
  async pushSubGoal(planId: PlanId | string, parentNodeId: GoalNodeId | string, description: string, options?: PushSubGoalOptions): Promise<GoalNode>
  async transitionNode(planId: PlanId | string, nodeId: GoalNodeId | string, transition: GoalNodeTransition): Promise<void>
  async markPlanComplete(planId: PlanId | string, note?: string): Promise<MarkResolvedResult>
  async abandonPlan(planId: PlanId | string, reason?: string): Promise<MarkResolvedResult>
  async findPlan(planId: PlanId | string): Promise<Readonly<PlanRecord> | null>
  async findNode(planId: PlanId | string, nodeId: GoalNodeId | string): Promise<Readonly<GoalNode> | null>
  async getCurrentPath(planId: PlanId | string): Promise<Readonly<GoalNode>[]>
  async getActivePlan(sessionId: string): Promise<Readonly<PlanRecord> | null>
  async listPlans(options?: ListPlansOptions): Promise<Readonly<PlanRecord>[]>
}
```

`PlanRecord` carries `rootGoal: GoalNode` (recursive tree), `currentNodeId`, history array, discriminated `PlanLifecycle` (`active` / `blocked` / `complete` / `abandoned`) and `GoalNodeLifecycle` (`pending` / `active` / `complete` / `blocked`). Branded `PlanId` / `GoalNodeId`. `validatePlanInvariants` runs after every mutation; cycle-protected DFS in `findNodeInTree` / `findPathToNode`.

---

### ReflectionManager (`agent/ReflectionManager.ts`)

**Purpose**: Derived insights from pattern + trajectory + experience over a candidate set. Additive (no supersession of evidence). Catalog Type 10. Sprint 8. Publicly exported as `ReflectionMemoryManager` to avoid collision with `src/search/ReflectionManager` (progressive query refinement).

```typescript
export class ReflectionManager {
  constructor(storage: IGraphStorage, config?: ReflectionManagerConfig)

  async create(input: ReflectionInput, options?: ReflectionEntityOptions): Promise<ReflectionRecord>
  async list(options?: ListReflectionsOptions): Promise<ReflectionRecord[]>
  async getAll(): Promise<ReflectionRecord[]>
  async getRelevantForSession(sessionId: string, options?: RelevanceOptions): Promise<ReflectionRecord[]>
  async archive(id: ReflectionId | string): Promise<ArchiveReflectionResult>
}
```

`ReflectionRecord` carries `scope` (`session` / `project` / `global`), `evidence: string[]` (non-empty), `summary`, `keyInsights[]`, `generalization_confidence ∈ [0, 1]`, `evidenceHash` (SHA-256 of `scope|sorted(evidence)` for Tier-1 content-hash dedup). `archive` returns discriminated `ArchiveReflectionResult`.

---

### ReflectionStage (`agent/ConsolidationPipeline.ts`)

**Purpose**: Pipeline stage that produces `ReflectionEntity` records from candidate episodic + semantic memories. Mirrors `ProspectivePromotionStage`'s self-sufficient pattern. Sprint 8.

```typescript
export class ReflectionStage implements PipelineStage {
  readonly name = 'reflection';

  constructor(
    storage: IGraphStorage,
    reflectionManager: ReflectionManager,
    patternDetector: PatternDetector,
    trajectoryCompressor: TrajectoryCompressor,
    config?: ReflectionStageConfig
  )

  async process(_entities: AgentEntity[], _options: ConsolidateOptions): Promise<StageResult>
  async runOnSessionEnd(sessionId: string): Promise<StageResult>  // empty/whitespace sessionId throws
}
```

Pipeline: gather observations (max-per-run circuit breaker) → `PatternDetector.detectPatterns` → early-return with `[info]`-prefixed `StageResult.errors` entry when below `minConfidence` (default 0.4) → `TrajectoryCompressor.distill` → `generalization_confidence = clamp(min(1 - compressionRatio, maxPatternConfidence), 0, 1)` → `ReflectionManager.create` (content-hash dedup makes re-runs idempotent).

---

### ConflictResolver — `'trust_level'` strategy (Sprint 6)

**Purpose**: Sixth `ConflictStrategy` (alongside `most_recent` / `highest_confidence` / `most_confirmations` / `trusted_agent` / `merge_all`). Resolves by highest categorical `TrustLevel` on `MemorySource.trustLevel` (or `inferTrustLevel` backfill), with recency tiebreak.

```typescript
// New ConflictStrategy literal
type ConflictStrategy = ... | 'trust_level' | ...;

// Ordering: 'ground-truth' > 'verified' > 'inferred' > 'unverified'
// Ties broken by lastModified → createdAt
```

Backfill from existing `MemorySource` shape (`method` + `reliability`) via `inferTrustLevel(source)`; defensive NaN/non-finite-reliability guard returns `'unverified'`. `DEFAULT_TRUST_THRESHOLDS` exported for per-deployment tuning.

---

### GraphEventEmitter (`core/GraphEventEmitter.ts`)

**Purpose**: Event-driven updates for TF-IDF sync

```typescript
export class GraphEventEmitter {
  on(event: GraphEvent, listener: EventListener): void
  off(event: GraphEvent, listener: EventListener): void
  emit(event: GraphEvent, data: EventData): void
}

type GraphEvent = 'entity:created' | 'entity:updated' | 'entity:deleted' |
                  'relation:created' | 'relation:deleted' | 'graph:loaded';
```

---

## Search Components

### SearchManager (`search/SearchManager.ts`)

**Purpose**: Orchestrates all search types

```typescript
export class SearchManager {
  constructor(storage: IGraphStorage, options?: SearchManagerOptions)

  // Search methods
  async searchNodes(query: string, options?: SearchOptions): Promise<KnowledgeGraph>
  async searchNodesRanked(query: string, options?: RankedSearchOptions): Promise<SearchResult[]>
  async booleanSearch(query: string, options?: SearchOptions): Promise<KnowledgeGraph>
  async fuzzySearch(query: string, options?: FuzzySearchOptions): Promise<KnowledgeGraph>
  async autoSearch(query: string, limit?: number): Promise<KnowledgeGraph>

  // Node retrieval
  async openNodes(names: string[]): Promise<KnowledgeGraph>
  async searchByDateRange(options: DateRangeOptions): Promise<KnowledgeGraph>

  // Search utilities
  async getSearchSuggestions(query: string, limit?: number): Promise<string[]>
  async getSearchCostEstimates(query: string): Promise<CostEstimate>
  async clearAllCaches(): Promise<void>

  // Saved searches
  async saveSearch(search: SavedSearchInput): Promise<SavedSearch>
  async executeSavedSearch(name: string): Promise<KnowledgeGraph>
  async listSavedSearches(): Promise<SavedSearch[]>
  async getSavedSearch(name: string): Promise<SavedSearch | null>
  async deleteSavedSearch(name: string): Promise<boolean>
  async updateSavedSearch(name: string, updates: Partial<SavedSearchInput>): Promise<SavedSearch>
}
```

---

### BasicSearch (`search/BasicSearch.ts`)

**Purpose**: Simple text matching with filters

**Algorithm**: Case-insensitive substring matching across name, entityType, observations

```typescript
export class BasicSearch {
  constructor(storage: IGraphStorage)

  async search(query: string, options?: SearchOptions): Promise<KnowledgeGraph>
  async openNodes(names: string[]): Promise<KnowledgeGraph>
  async searchByDateRange(options: DateRangeOptions): Promise<KnowledgeGraph>
}
```

---

### RankedSearch (`search/RankedSearch.ts`)

**Purpose**: TF-IDF relevance scoring

```typescript
export class RankedSearch {
  constructor(storage: IGraphStorage)

  async search(
    query: string,
    options?: RankedSearchOptions
  ): Promise<SearchResult[]>
}

interface SearchResult {
  entity: Entity;
  score: number;
  matchedFields: string[];
}
```

---

### BM25Search (`search/BM25Search.ts`)

**Purpose**: BM25 ranking algorithm (improved TF-IDF)

```typescript
export class BM25Search {
  constructor(storage: IGraphStorage, options?: BM25Options)

  async search(query: string, limit?: number): Promise<SearchResult[]>
}
```

**BM25 Parameters**:
- `k1`: Term frequency saturation (default: 1.2)
- `b`: Document length normalization (default: 0.75)

---

### BooleanSearch (`search/BooleanSearch.ts`)

**Purpose**: Boolean query parsing and evaluation

**Syntax**: `AND`, `OR`, `NOT`, parentheses, field prefixes

```typescript
export class BooleanSearch {
  constructor(storage: IGraphStorage)

  async search(
    query: string,
    options?: SearchOptions
  ): Promise<KnowledgeGraph>
}
```

**Query Examples**:
- `Alice AND Bob`
- `name:Alice OR type:person`
- `NOT archived AND (project OR task)`

---

### FuzzySearch (`search/FuzzySearch.ts`)

**Purpose**: Typo-tolerant search using Levenshtein distance

```typescript
export class FuzzySearch {
  constructor(storage: IGraphStorage)

  async search(
    query: string,
    options?: FuzzySearchOptions
  ): Promise<KnowledgeGraph>
}

interface FuzzySearchOptions {
  threshold?: number;  // 0.0-1.0, default 0.7
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
}
```

---

### SemanticSearch (`search/SemanticSearch.ts`)

**Purpose**: Vector similarity search

```typescript
export class SemanticSearch {
  constructor(
    storage: IGraphStorage,
    embeddingService: EmbeddingService,
    vectorStore: VectorStore
  )

  async search(query: string, options?: SemanticSearchOptions): Promise<SearchResult[]>
  async findSimilar(entityName: string, limit?: number): Promise<SearchResult[]>
  async indexEntity(entity: Entity): Promise<void>
  async indexAll(): Promise<void>
}
```

---

### HybridSearchManager (`search/HybridSearchManager.ts`)

**Purpose**: Three-layer hybrid search combining semantic, lexical, and symbolic signals

```typescript
export class HybridSearchManager {
  constructor(
    storage: IGraphStorage,
    semanticSearch?: SemanticSearch,
    tfidfManager?: TFIDFIndexManager
  )

  async search(
    query: string,
    options?: HybridSearchOptions
  ): Promise<HybridSearchResult>
}

interface HybridSearchOptions {
  weights?: { semantic?: number; lexical?: number; symbolic?: number };
  filters?: SymbolicFilters;
  limit?: number;
  minScore?: number;
}
```

**Scoring Layers**:
- **Semantic**: Vector similarity via embeddings (default weight: 0.4)
- **Lexical**: TF-IDF/BM25 text matching (default weight: 0.4)
- **Symbolic**: Metadata filtering (default weight: 0.2)

---

### QueryAnalyzer (`search/QueryAnalyzer.ts`)

**Purpose**: Natural language query understanding

```typescript
export class QueryAnalyzer {
  analyze(query: string): QueryAnalysis
}

interface QueryAnalysis {
  extractedEntities: ExtractedEntity[];
  temporalReferences: TemporalRange[];
  questionType: string;  // who, what, when, where, why, how
  complexity: string;    // simple, moderate, complex
  suggestedSearchMethods: string[];
}
```

---

### EmbeddingService (`search/EmbeddingService.ts`)

**Purpose**: Embedding generation providers

```typescript
export interface EmbeddingService {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

// Implementations
export class OpenAIEmbeddingService implements EmbeddingService { }
export class LocalEmbeddingService implements EmbeddingService { }
export class MockEmbeddingService implements EmbeddingService { }
```

---

### VectorStore (`search/VectorStore.ts`)

**Purpose**: Vector storage and similarity search

```typescript
export interface VectorStore {
  add(id: string, vector: number[]): Promise<void>
  search(vector: number[], limit: number): Promise<VectorSearchResult[]>
  delete(id: string): Promise<void>
}

// Implementations
export class InMemoryVectorStore implements VectorStore { }
export class SQLiteVectorStore implements VectorStore { }
export class QuantizedVectorStore implements VectorStore { }  // Compressed
```

---

### SearchFilterChain (`search/SearchFilterChain.ts`)

**Purpose**: Unified filter logic for all search implementations

```typescript
export class SearchFilterChain {
  static applyFilters(entities: Entity[], filters: SearchFilters): Entity[]
  static entityPassesFilters(entity: Entity, filters: SearchFilters): boolean
  static hasActiveFilters(filters: SearchFilters): boolean
  static filterAndPaginate(entities, filters, offset?, limit?): Entity[]
}
```

---

### NGramIndex (`search/NGramIndex.ts`)

**Purpose**: Trigram index providing Jaccard-based pre-filtering for FuzzySearch

```typescript
export class NGramIndex {
  constructor(n?: number)  // default: 3 (trigrams)

  index(id: string, text: string): void
  query(text: string, topK?: number): string[]  // sorted by Jaccard similarity
  remove(id: string): void
}
```

Plugged into `FuzzySearch` to reduce candidate set before Levenshtein worker dispatch.

---

### TemporalQueryParser (`search/TemporalQueryParser.ts`)

**Purpose**: Parses natural language time expressions into structured date ranges

```typescript
export class TemporalQueryParser {
  parse(expression: string): TemporalRange | null
}

interface TemporalRange {
  start: Date;
  end: Date;
  label: string;  // e.g., "last hour", "10 minutes ago"
}
```

Uses `chrono-node` for expression parsing. Supports: "10 minutes ago", "last hour", "yesterday", "last week", ISO ranges.

---

### TemporalSearch (`search/TemporalSearch.ts`)

**Purpose**: Execute time-range entity searches using parsed temporal expressions

```typescript
export class TemporalSearch {
  constructor(storage: IGraphStorage, parser: TemporalQueryParser)

  async search(expression: string, options?: TemporalSearchOptions): Promise<KnowledgeGraph>
  async searchRange(range: TemporalRange, options?: TemporalSearchOptions): Promise<KnowledgeGraph>
}
```

Exposed as `SearchManager.searchByTime()` and `ManagerContext.temporalSearch`.

---

### LLMQueryPlanner (`search/LLMQueryPlanner.ts`)

**Purpose**: Decomposes natural language queries into structured search plans

```typescript
export interface LLMProvider {
  complete(prompt: string): Promise<string>
}

export class LLMQueryPlanner {
  constructor(provider?: LLMProvider)

  async plan(query: string): Promise<StructuredQuery>
}

interface StructuredQuery {
  keywords: string[];
  filters: SearchFilters;
  intent: string;
  suggestedMethods: string[];
}
```

Falls back to keyword extraction when no `LLMProvider` is configured. JSON response validated with recovery.

---

### LLMSearchExecutor (`search/LLMSearchExecutor.ts`)

**Purpose**: Executes a `StructuredQuery` produced by `LLMQueryPlanner`

```typescript
export class LLMSearchExecutor {
  constructor(searchManager: SearchManager, planner: LLMQueryPlanner)

  async execute(query: string): Promise<HybridSearchResult>
}
```

Exposed as `ManagerContext.queryNaturalLanguage(query, llmProvider?)`.

---

### Query Optimization

#### QueryParser (`search/QueryParser.ts`)
Parses query strings into AST nodes (TermNode, PhraseNode, BooleanNode, FieldNode). Used by BooleanSearch and QueryAnalyzer for structured query interpretation.

#### QueryPlanner (`search/QueryPlanner.ts`)
Generates execution plans from QueryAnalyzer output. Selects optimal search methods and ordering based on query characteristics.

#### QueryPlanCache (`search/QueryPlanCache.ts`)
LRU cache for query execution plans. Avoids re-planning identical or similar queries within a configurable TTL.

#### QueryCostEstimator (`search/QueryCostEstimator.ts`)
Estimates execution cost for different search methods based on graph size, query complexity, and index availability. Recommends the cheapest adequate method.

#### EarlyTerminationManager (`search/EarlyTerminationManager.ts`)
Monitors result quality during search execution and stops early when an adequacy threshold is met. Reduces latency for queries with obvious top results.

#### ParallelSearchExecutor (`search/ParallelSearchExecutor.ts`)
Executes multiple search layers (semantic, lexical, symbolic) concurrently and merges results. Used by HybridSearchManager.

### Search Infrastructure

#### ReflectionManager (`search/ReflectionManager.ts`)
Iterative result refinement with adequacy checking. Re-runs search with modified parameters when initial results are insufficient.

#### SavedSearchManager (`search/SavedSearchManager.ts`)
CRUD for saved search queries. Persists search definitions (query, filters, type) for later re-execution.

#### SearchSuggestions (`search/SearchSuggestions.ts`)
Query completion and suggestion generation based on entity names, types, tags, and prior queries.

#### SymbolicSearch (`search/SymbolicSearch.ts`)
Metadata-based filtering by importance range, tags, entity types, and date ranges. Provides the symbolic layer for hybrid search scoring.

#### HybridScorer (`search/HybridScorer.ts`)
Score fusion for hybrid search results. Normalizes and combines scores from semantic, lexical, and symbolic layers using configurable weights.

#### ProximitySearch (`search/ProximitySearch.ts`)
Scores entities based on term proximity within observations. Terms appearing closer together receive higher relevance scores.

#### QueryLogger (`search/QueryLogger.ts`)
Logs query performance metrics (latency, result count, method used) with configurable log levels. Writes to file or stdout.

### Indexing

#### TFIDFIndexManager (`search/TFIDFIndexManager.ts`)
Manages TF-IDF index lifecycle: build from scratch, incremental updates, and query interface. Provides term frequency and document frequency lookups.

#### TFIDFEventSync (`search/TFIDFEventSync.ts`)
Listens to GraphEventEmitter events and automatically updates the TF-IDF index when entities are created, modified, or deleted.

#### OptimizedInvertedIndex (`search/OptimizedInvertedIndex.ts`)
Memory-efficient inverted index with compressed posting lists. Supports fast term lookups and boolean intersection/union operations.

#### IncrementalIndexer (`search/IncrementalIndexer.ts`)
Batches incremental index updates to avoid rebuilding the full index on every change. Flushes pending updates on a configurable schedule or threshold.

#### EmbeddingCache (`search/EmbeddingCache.ts`)
LRU cache for embedding vectors with TTL expiration. Reduces redundant embedding API calls for recently seen text.

---

## Feature Components

### IOManager (`features/IOManager.ts`)

**Purpose**: Import, export, and backup functionality

```typescript
export class IOManager {
  constructor(storage: IGraphStorage, backupDir?: string)

  // Export
  async exportGraph(format: ExportFormat, options?: ExportOptions): Promise<string>

  // Import
  async importGraph(
    format: 'json' | 'csv' | 'graphml',
    data: string,
    options?: ImportOptions
  ): Promise<ImportResult>

  // Backup (delegated to BackupManager since Phase 5 / v1.15.0)
  async createBackup(options?: BackupOptions): Promise<BackupResult>
  async listBackups(): Promise<BackupInfo[]>
  async restoreFromBackup(backupPath: string): Promise<RestoreResult>
  async deleteBackup(backupPath: string): Promise<void>
  async cleanOldBackups(keepCount?: number): Promise<number>

  // Conversation ingestion (v1.9.0)
  async ingest(input: string | { messages: ChatMessage[] }, options?: IngestOptions): Promise<IngestResult>
  splitTranscript(content: string, options?: SplitOptions): SplitResult
}
```

Supported formats: `json`, `csv`, `graphml`, `gexf`, `dot`, `markdown`, `mermaid`, and (η.5.4) `turtle`, `rdf-xml`, `json-ld`. v1.15.0 hardens `splitTranscript()` with `MAX_SPLIT_LENGTH` (10 MB) and `MAX_PARTS` (10,000) guards against ReDoS.

---

### TagManager (`features/TagManager.ts`)

**Purpose**: Tag alias management and bulk operations

```typescript
export class TagManager {
  constructor(storage: IGraphStorage)

  addAlias(canonical: string, alias: string): Promise<void>
  removeAlias(alias: string): Promise<void>
  resolveAlias(tag: string): Promise<string>
  listAliases(): Promise<Map<string, string[]>>

  async addTags(entityName: string, tags: string[]): Promise<void>
  async removeTags(entityName: string, tags: string[]): Promise<void>
}
```

---

### CompressionManager (`features/CompressionManager.ts`)

**Purpose**: Duplicate detection and entity merging

```typescript
export class CompressionManager {
  constructor(storage: IGraphStorage)

  async findDuplicates(threshold?: number): Promise<DuplicateGroup[]>
  async mergeEntities(primary: string, duplicates: string[]): Promise<void>
  async compressGraph(): Promise<CompressionResult>
}
```

Similarity scoring uses observation content with configurable threshold (default 0.8). Compresses graph by merging high-similarity duplicates into a primary entity.

---

### AnalyticsManager (`features/AnalyticsManager.ts`)

**Purpose**: Graph statistics and validation

```typescript
export class AnalyticsManager {
  constructor(storage: IGraphStorage)

  async getStats(): Promise<GraphStats>
  async validateGraph(): Promise<ValidationResult>
  async findOrphanEntities(): Promise<Entity[]>
  async findDanglingRelations(): Promise<Relation[]>
}

export interface GraphStats {
  entityCount: number;
  relationCount: number;
  observationCount: number;
  averageObservationsPerEntity: number;
  entityTypeDistribution: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
}
```

---

### ArchiveManager (`features/ArchiveManager.ts`)

**Purpose**: Archive low-importance or old entities to compressed storage

```typescript
export class ArchiveManager {
  constructor(storage: IGraphStorage, archiveDir?: string)

  async archive(criteria: ArchiveCriteria): Promise<ArchiveResult>
  async restore(archiveId: string): Promise<void>
  async listArchives(): Promise<ArchiveInfo[]>
}

export interface ArchiveCriteria {
  minImportance?: number;
  olderThan?: number;  // milliseconds
  entityTypes?: string[];
}
```

---

### FreshnessManager (`features/FreshnessManager.ts`)

**Purpose**: TTL/confidence freshness reporting (v1.6.0)

```typescript
export class FreshnessManager {
  constructor(storage: IGraphStorage)

  calculateFreshness(entity: Entity, now?: Date): FreshnessScore
  async getStaleEntities(threshold?: number): Promise<Entity[]>
  async getExpiredEntities(): Promise<Entity[]>
  async generateReport(): Promise<FreshnessReport>
}

export interface FreshnessScore {
  score: number;        // 0-1, higher = fresher
  isExpired: boolean;
  reason: string;
}
```

Combines `Entity.ttl` (absolute time-to-live) and `Entity.confidence` (belief strength) into a single freshness score used by `SalienceEngine` and decay routines.

---

### AuditLog (`features/AuditLog.ts`)

**Purpose**: Immutable JSONL audit trail for all mutations (v1.6.0)

```typescript
export class AuditLog {
  constructor(logFilePath: string)

  async append(entry: AuditEntry): Promise<void>
  async query(filter: AuditQueryFilter): Promise<AuditEntry[]>
  async getEntityHistory(entityName: string): Promise<AuditEntry[]>
}

export interface AuditEntry {
  timestamp: string;
  operation: 'create' | 'update' | 'delete' | 'rollback' | 'archive';
  entityName?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}
```

---

### GovernanceManager (`features/GovernanceManager.ts`)

**Purpose**: Policy enforcement and transactional safety for memory mutations

```typescript
export interface GovernancePolicy {
  canCreate(entity: Partial<Entity>): boolean | Promise<boolean>
  canUpdate(entity: Entity, patch: Partial<Entity>): boolean | Promise<boolean>
  canDelete(entityName: string): boolean | Promise<boolean>
}

export class GovernanceManager {
  constructor(storage: IGraphStorage, policy?: GovernancePolicy, auditLog?: AuditLog)

  async withTransaction<T>(fn: () => Promise<T>): Promise<T>
  async rollback(): Promise<void>
}
```

Wraps `EntityManager` mutations with policy checks. `withTransaction` snapshots current state for rollback. Emits to `AuditLog` on every committed operation.

---

### BackupManager (`features/BackupManager.ts`) — Phase 5 (v1.15.0)

**Purpose**: Backup lifecycle extracted from `IOManager` — create / list / restore / delete / cleanOld

```typescript
export class BackupManager {
  constructor(storage: GraphStorage, backupDir: string)

  async create(options?: BackupOptions): Promise<BackupResult>
  async list(): Promise<BackupInfo[]>
  async restore(backupPath: string): Promise<RestoreResult>
  async delete(backupPath: string): Promise<void>
  async cleanOld(keepCount?: number): Promise<number>
}
```

All file-touching paths run through `validateFilePath(path, this.backupDir, true)` — paths must stay inside the backup directory. `restore()` and `delete()` both reject symbolic links via `fs.lstat().isSymbolicLink()` to prevent symlink-escape attacks. Metadata sidecar files (`.meta.json`) are derived via `path.basename()` and independently revalidated before unlink. `IOManager` delegates all backup operations to this class.

---

### ContradictionDetector (`features/ContradictionDetector.ts`)

**Purpose**: Semantic-similarity-based contradiction detection with entity versioning support

Compares observations across the same `rootEntityName` chain to find statements that contradict each other within a configurable threshold. Output feeds `EntityManager.invalidateEntity()` to create a successor entity.

---

## Utility Components

### schemas (`utils/schemas.ts`)

**Purpose**: Zod validation schemas

**Key Schemas**:
- `EntitySchema`, `CreateEntitySchema`
- `RelationSchema`, `CreateRelationSchema`
- `BatchCreateEntitiesSchema`, `BatchCreateRelationsSchema`
- `SearchQuerySchema`, `DateRangeSchema`

### constants (`utils/constants.ts`)

**Purpose**: Centralized configuration values

```typescript
export const SIMILARITY_WEIGHTS = { NAME: 0.4, TYPE: 0.3, OBSERVATIONS: 0.2, TAGS: 0.1 };
export const DEFAULT_DUPLICATE_THRESHOLD = 0.8;
export const SEARCH_LIMITS = { DEFAULT: 50, MAX: 1000 };
export const IMPORTANCE_RANGE = { MIN: 0, MAX: 10 };
```

### searchAlgorithms (`utils/searchAlgorithms.ts`)

**Purpose**: Text search algorithms

```typescript
export function levenshteinDistance(s1: string, s2: string): number
export function calculateTF(term: string, document: string): number
export function calculateIDF(term: string, documents: string[]): number
export function calculateTFIDF(term: string, doc: string, docs: string[]): number
export function tokenize(text: string): string[]
```

### entityUtils (`utils/entityUtils.ts`)

**Purpose**: Entity manipulation utilities

**Categories**:
- Entity lookup: `findEntityByName`, `entityExists`
- Tag utilities: `normalizeTag`, `normalizeTags`, `hasMatchingTag`
- Date utilities: `isWithinDateRange`, `getCurrentTimestamp`
- Filter utilities: `isWithinImportanceRange`, `filterByImportance`
- Path security: `validateFilePath(path, baseDir?, confineToBase?)` — default `confineToBase=true` since v1.15.0 (PR #38); throws on `..` segments unconditionally; opts out at explicit user-input call sites (CLI, `ensureMemoryFilePath`)

### logger (`utils/logger.ts`) — Phase 0 (v1.15.0)

**Purpose**: Structured logger replacing scattered `console.*` calls

Stderr-only by design (logger never writes to stdout — CLI commands keep their output channel clean). Honors `LOG_LEVEL=debug|info|warn|error`. Used by `GraphStorage`, `SQLiteStorage`, `TaskQueue`, `MemoryEngine`, and all `Phase 0+` components.

### taskScheduler (`utils/taskScheduler.ts`) — Phase 0 (v1.15.0)

**Purpose**: Priority task queue with bounded resource use

```typescript
export class TaskQueue {
  // Bounded — MAX_QUEUE = 100,000 pending, MAX_COMPLETED = 10,000 results retained
  enqueue<T, R>(task: Task<T, R>): Promise<TaskResult<R>>
  // ...
}
```

`enqueue` validates `task.fn` is a real function object (rejects strings to prevent code-injection via `new Function`). The `recordCompleted` helper centralizes eviction. v1.15.0 adds `kickProcessNext` for explicit-error logging on swallowed rejections.

### compression/ (`utils/compression/`) — Phase 10 (v1.15.0)

**Purpose**: Pluggable in-memory compression for entity caches and tiered storage

```typescript
export interface ICompressionAdapter {
  readonly name: string;
  compress(input: Buffer): Buffer;
  decompress(input: Buffer): Buffer;
}

export class ZlibCompressionAdapter implements ICompressionAdapter { /* zlib.deflateSync */ }
export class IdentityCompressionAdapter implements ICompressionAdapter { /* no-op test baseline */ }

export class CompressedMap<K, V> {
  // Map<K, V> implementation that compresses values at rest
  get(key: K): V | undefined
  set(key: K, value: V): this
  // ...
}
```

Sync API chosen deliberately — async would force `CompressedMap.get` to be async, rippling through every caller. Adapter errors wrap the underlying zlib/brotli message with the adapter `name` so multi-adapter callers can distinguish "wrong adapter" from "truncated input." Wired via `ctx.compressedEntityCache`.

---

## Type Definitions

### Entity Types (`types/types.ts`)

```typescript
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
  parentId?: string;
  tags?: string[];
  importance?: number;
  createdAt?: string;
  lastModified?: string;
  // v1.6.0: freshness governance
  ttl?: number;           // Time-to-live in milliseconds
  confidence?: number;    // Belief strength 0.0–1.0
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
  createdAt?: string;
  lastModified?: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}
```

### Agent Memory Types (`types/agent-memory.ts`)

```typescript
interface AgentEntity extends Entity {
  memoryType: 'working' | 'episodic' | 'semantic';
  sessionId?: string;
  expiresAt?: string;
  accessCount: number;
  lastAccessedAt?: string;
  confidence: number;
  agentId?: string;
  visibility: 'private' | 'shared' | 'public';
}

interface SessionEntity extends AgentEntity {
  entityType: 'session';
  memoryType: 'episodic';
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'completed' | 'abandoned';
  goalDescription?: string;
  memoryCount: number;
}

interface SalienceContext {
  currentTask?: string;
  currentSession?: string;
  recentEntities?: string[];
  queryText?: string;
  temporalFocus?: 'recent' | 'historical' | 'any';
}

interface ContextPackage {
  memories: AgentEntity[];
  totalTokens: number;
  excluded: string[];
}
```

### Artifact Types (`types/artifact.ts`)

```typescript
type ArtifactType =
  | 'code'
  | 'document'
  | 'image'
  | 'data'
  | 'analysis'
  | 'tool-output'
  | string;  // open union

interface ArtifactEntity extends AgentEntity {
  artifactType: ArtifactType;
  // name format: toolName-YYYY-MM-DD-shortId
}
```

---

### Search Types

```typescript
interface SearchResult {
  entity: Entity;
  score: number;
  matchedFields: string[];
}

interface SearchFilters {
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
  entityType?: string;
  createdAfter?: string;
  createdBefore?: string;
}

interface TemporalRange {
  start: Date;
  end: Date;
  label: string;
}

interface StructuredQuery {
  keywords: string[];
  filters: SearchFilters;
  intent: string;
  suggestedMethods: string[];
}
```

### Result Types (`types/result.ts`) — v2.0.0

```typescript
// Discriminated-union return type for expected domain failures.
// Per the error-handling policy (CONTRIBUTING.md): throw for programmer
// errors, return Result for failures the caller should branch on.
type Result<T, E = Error> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };

ok<T>(value: T): Result<T, never>
err<E>(error: E): Result<never, E>
isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T }
isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E }
unwrap<T, E>(result: Result<T, E>): T          // returns value, or throws error
unwrapOr<T, E>(result: Result<T, E>, fallback: T): T
mapOk<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E>
```

---

## Component Dependencies

```
┌──────────────────────────────────────────────────────────────┐
│  ManagerContext                                              │
│    │                                                         │
│    ├── AgentMemoryManager ─────────┐                         │
│    │     ├── SessionManager ───────┤                         │
│    │     ├── WorkingMemoryMgr ─────┤                         │
│    │     ├── DecayEngine ──────────┤  (TTL-aware)            │
│    │     ├── SalienceEngine ───────┤  (freshnessWeight)      │
│    │     ├── ContextWindowMgr ─────┤  (+ DistillationPipeline)│
│    │     ├── MultiAgentMemMgr ─────┤                         │
│    │     ├── ArtifactManager ──────┤  ──► RefIndex           │
│    │     └── DistillationPipeline ─┤                         │
│    │                               │                         │
│    ├── EntityManager ──────────────┤  ──► RefIndex           │
│    │                               │                         │
│    ├── RelationManager ────────────┤                         │
│    │                               │                         │
│    ├── ObservationManager ─────────┤                         │
│    │                               │                         │
│    ├── HierarchyManager ───────────┤                         │
│    │                               │                         │
│    ├── SearchManager ──────────────┼──► IGraphStorage        │
│    │     ├── BasicSearch ──────────┤        │                │
│    │     ├── RankedSearch ─────────┤        ▼                │
│    │     ├── BooleanSearch ────────┤   GraphStorage (JSONL)  │
│    │     ├── FuzzySearch ──────────┤   (+ NGramIndex)   OR   │
│    │     ├── SemanticSearch ───────┤   SQLiteStorage         │
│    │     ├── HybridSearchMgr ──────┤                         │
│    │     ├── TemporalSearch ───────┤                         │
│    │     └── LLMSearchExecutor ────┤                         │
│    │                               │                         │
│    ├── IOManager ──────────────────┤                         │
│    │                               │                         │
│    ├── TagManager ─────────────────► tag-aliases.jsonl       │
│    │                               │                         │
│    ├── FreshnessManager ───────────┤                         │
│    │                               │                         │
│    ├── GovernanceManager ──────────┤  ──► AuditLog (JSONL)   │
│    │                               │                         │
│    ├── RefIndex ───────────────────► refs.jsonl              │
│    │                               │                         │
│    └── GraphTraversal ─────────────┘                         │
└──────────────────────────────────────────────────────────────┘
```

**Shared Dependencies**:
- All managers receive `IGraphStorage` via dependency injection
- `SearchFilterChain` used by all search implementations
- `utils/schemas.ts` used for input validation across managers
- `utils/constants.ts` provides shared configuration
- `utils/searchAlgorithms.ts` provides Levenshtein + TF-IDF algorithms
- Agent components share `AccessTracker` for memory access patterns

---

**Document Version**: 2.0
**Last Updated**: 2026-05-14
**Maintained By**: Daniel Simon Jr.
