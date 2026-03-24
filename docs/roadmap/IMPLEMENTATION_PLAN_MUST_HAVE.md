# MemoryJS — MUST-HAVE Features Implementation Plan

Generated: 2026-03-24
Branch: `feature/must-have-8`
Covers: 8 features from FEASIBILITY_REPORT.md MUST-HAVE tier

---

## Branch & Commit Strategy

**Single branch**: `feature/must-have-8`
All 8 features live on one branch because features 1→2, 3→7, and 5→4 have hard
dependency chains. Merge to `main` as a single PR after all 8 pass tests.

**Commit cadence**: One commit per feature, gated on "all tests for that feature
pass + `npm run typecheck` exits 0". Do NOT squash — the 8 commits serve as
natural rollback points. Tag the final commit `v1.6.0-beta`.

Commit message convention:
```
feat(#N): <feature name>

- Files created: ...
- Files modified: ...
- Tests: <N> passing
```

**Integration test commit**: one additional commit after all 8, containing only
`tests/integration/must-have-pipeline.test.ts`.

---

## Testing Strategy

- **Unit tests**: Each feature gets its own test file under
  `tests/unit/<module>/<FeatureName>.test.ts`. Vitest, 30 s timeout inherited.
- **Mocking pattern**: Follow the existing `GraphStorage` duck-typing — create
  an `InMemoryStorage` test helper (one `beforeEach` reset) rather than mocking
  the whole storage layer.
- **Coverage gate**: `npm run test:coverage` must stay above the existing
  baseline. New files must reach 80 % branch coverage individually.
- **Skip-benchmarks**: All new test files must honor `SKIP_BENCHMARKS=true` for
  CI — wrap any timing-sensitive assertions in
  `if (!process.env.SKIP_BENCHMARKS)`.
- **Integration test** (`tests/integration/must-have-pipeline.test.ts`): End-to-
  end scenario — create artifact via `createArtifact()`, resolve via
  `resolveRef()`, query by temporal range, run distillation filter, verify TTL
  expiry, confirm n-gram prefilter fires, call LLM planner mock, and commit a
  transaction with audit log.

---

## Feature 1 — Stable Index Dereferencing

**Effort**: S | **Depends on**: nothing | **Commit**: first

### Rationale

`Entity.name` is already enforced unique by `EntityManager.createEntities` (the
`filter(e => !graph.entities.some(existing => existing.name === e.name))` guard
at line 135). What is missing is a *named reference* abstraction: a stable,
human-readable alias that maps `"ref:tool_output_step5"` → entity name, stored
separately from the entity so the entity name can change without breaking
callers.

### Files to Create

**`src/core/RefIndex.ts`**
Maintains the alias → entity-name map with O(1) lookups in both directions.
Persisted as a sidecar JSONL file alongside the main storage file.

```typescript
export interface RefEntry {
  /** The stable alias (e.g. "tool_output_step5") */
  ref: string;
  /** The entity name this alias resolves to */
  entityName: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Optional description */
  description?: string;
}

export interface RefIndexStats {
  totalRefs: number;
  orphanedRefs: number;   // refs whose entity no longer exists
  lastRebuiltAt: string;
}

export class RefIndex {
  constructor(private indexFilePath: string) {}

  /** Register a new alias. Throws RefConflictError if alias already exists. */
  async register(ref: string, entityName: string, description?: string): Promise<RefEntry>;

  /** Resolve alias → entity name. Returns null if not found. */
  async resolve(ref: string): Promise<string | null>;

  /** Reverse lookup: entity name → all aliases pointing to it. */
  async refsForEntity(entityName: string): Promise<string[]>;

  /** Remove an alias. Silent if not found. */
  async deregister(ref: string): Promise<void>;

  /** Remove all aliases pointing to a deleted entity. */
  async purgeEntity(entityName: string): Promise<number>;

  /** List all registered refs with optional filtering. */
  async listRefs(filter?: { entityName?: string }): Promise<RefEntry[]>;

  /** Return stats (total, orphaned). */
  async stats(): Promise<RefIndexStats>;
}
```

**`src/utils/errors.ts`** — add (modify existing file):
```typescript
export class RefConflictError extends KnowledgeGraphError {
  constructor(ref: string) {
    super(`Ref '${ref}' is already registered`, 'REF_CONFLICT');
  }
}

export class RefNotFoundError extends KnowledgeGraphError {
  constructor(ref: string) {
    super(`Ref '${ref}' not found`, 'REF_NOT_FOUND');
  }
}
```

### Files to Modify

**`src/core/EntityManager.ts`**
- Add `private refIndex?: RefIndex` field.
- Add `setRefIndex(index: RefIndex): void` (same pattern as `setAccessTracker`).
- Add `resolveRef(ref: string): Promise<Entity | null>` — calls
  `this.refIndex?.resolve(ref)`, then `getEntity(entityName)`. If no refIndex is
  set, throws `new ValidationError('RefIndex not configured', [])`.
- Extend `deleteEntities` to call `this.refIndex?.purgeEntity(name)` for each
  deleted entity.

**`src/core/ManagerContext.ts`**
- Add `private _refIndex?: RefIndex` field.
- Add `get refIndex(): RefIndex` lazy getter — derives path from storage path:
  `${basename}-refs.jsonl`.
- In `get entityManager()` init, call
  `this._entityManager.setRefIndex(this.refIndex)`.
- Expose `refIndex` in the public API.

### Interface Signatures

```typescript
// EntityManager additions
resolveRef(ref: string): Promise<Entity | null>;
registerRef(ref: string, entityName: string, description?: string): Promise<RefEntry>;
deregisterRef(ref: string): Promise<void>;
listRefs(filter?: { entityName?: string }): Promise<RefEntry[]>;
```

### Test File

**`tests/unit/core/RefIndex.test.ts`**

Key test cases:
1. `register()` persists to disk and `resolve()` returns entity name.
2. Duplicate `register()` throws `RefConflictError`.
3. `resolveRef()` on EntityManager retrieves the full entity.
4. Deleting an entity via `deleteEntities()` purges its refs.
5. `refsForEntity()` returns all aliases.
6. `resolve()` returns `null` for unknown ref (no throw).
7. `listRefs({ entityName: 'X' })` filters correctly.

### Dependencies

None — pure TypeScript using existing JSONL persistence pattern from
`GraphStorage`.

### Implementation Sequence

1. Create `src/core/RefIndex.ts` with in-memory Map + JSONL sidecar persistence
   (load-on-construct, append-on-register, rewrite-on-deregister/purge). Mirror
   the `GraphStorage` mutex pattern using `async-mutex` (already in
   `dependencies`).
2. Add `RefConflictError` and `RefNotFoundError` to `src/utils/errors.ts`.
3. Wire `setRefIndex` + `resolveRef` + `registerRef` into `EntityManager`.
4. Wire `refIndex` lazy getter into `ManagerContext`, inject into entityManager
   init.
5. Write and pass tests.
6. `npm run typecheck` — commit.

---

## Feature 2 — Artifact-Level Granularity

**Effort**: S | **Depends on**: Feature 1 | **Commit**: second

### Rationale

Tool outputs (API responses, code snippets, search results) need stable,
human-readable names so agents can refer to them across turns. This wraps
Feature 1's `registerRef` + `createEntities` into a single atomic factory
method with a naming convention enforced at the type level.

### Files to Create

**`src/core/ArtifactManager.ts`**

```typescript
/** Discriminated union of artifact types. */
export type ArtifactType =
  | 'tool_output'
  | 'code_snippet'
  | 'api_response'
  | 'search_result'
  | 'document_chunk'
  | 'custom';

export interface ArtifactInput {
  /** Human-readable label (becomes the ref alias, e.g. "weather_api_step3") */
  label: string;
  /** Artifact category — maps to entityType */
  artifactType: ArtifactType;
  /** Content observations */
  content: string[];
  /** Session context */
  sessionId?: string;
  /** Task context */
  taskId?: string;
  /** Source tool or service name */
  sourceId?: string;
  /** Optional importance 0-10 */
  importance?: number;
  /** Tags for search */
  tags?: string[];
}

export interface ArtifactRecord {
  /** Stable ref alias */
  ref: string;
  /** The created entity */
  entity: Entity;
  /** The RefEntry */
  refEntry: RefEntry;
}

export class ArtifactManager {
  constructor(
    private entityManager: EntityManager,
    private refIndex: RefIndex
  ) {}

  /**
   * Create an artifact entity and register a stable ref in a single call.
   *
   * Entity name is auto-generated as `artifact_<label>_<timestamp_ms>`.
   * Ref is registered as `label` (enforces uniqueness via RefIndex).
   * If label collision: appends `_v2`, `_v3`, etc. up to 99 — then throws.
   */
  async createArtifact(input: ArtifactInput): Promise<ArtifactRecord>;

  /**
   * Retrieve an artifact by its stable ref label.
   * Returns null if ref not found.
   */
  async getArtifact(label: string): Promise<ArtifactRecord | null>;

  /**
   * List all artifacts, optionally filtered by artifactType or sessionId.
   */
  async listArtifacts(filter?: {
    artifactType?: ArtifactType;
    sessionId?: string;
  }): Promise<ArtifactRecord[]>;

  /**
   * Update artifact content (appends observations, updates lastModified).
   */
  async appendToArtifact(label: string, content: string[]): Promise<Entity>;
}
```

### Files to Modify

**`src/core/ManagerContext.ts`**
- Add `private _artifactManager?: ArtifactManager` field.
- Add `get artifactManager(): ArtifactManager` lazy getter that injects
  `this.entityManager` and `this.refIndex`.

**`src/agent/AgentMemoryManager.ts`**
- Add `get artifactManager(): ArtifactManager` that delegates to the underlying
  storage-level `ArtifactManager` via `ManagerContext`. (Requires
  `AgentMemoryManager` to hold a `ManagerContext` reference, which it does via
  `storage` — inject at construction or accept a factory callback.)

### Test File

**`tests/unit/core/ArtifactManager.test.ts`**

Key test cases:
1. `createArtifact()` creates entity + ref in one call.
2. Auto-generated entity name contains the label substring.
3. Duplicate label gets `_v2` suffix.
4. `getArtifact('label')` retrieves entity via ref resolution.
5. `listArtifacts({ artifactType: 'tool_output' })` filters by entityType.
6. `appendToArtifact()` adds observations without creating a new ref.
7. Deleting the underlying entity makes `getArtifact()` return null.

### Dependencies

None — builds on Feature 1.

### Implementation Sequence

1. Create `src/core/ArtifactManager.ts`.
2. Wire lazy getter into `ManagerContext`.
3. Wire delegation into `AgentMemoryManager`.
4. Write and pass tests.
5. `npm run typecheck` — commit.

---

## Feature 3 — Temporal Range Queries

**Effort**: S-M | **Depends on**: nothing | **Commit**: third

### Rationale

`QueryAnalyzer` already parses a static `temporalKeywords` list
(`src/search/QueryAnalyzer.ts` lines 34–39) into a `TemporalRange` with a
`relative` string field but never converts that string to actual `Date`
boundaries. This feature adds `chrono-node` to convert arbitrary natural
language time expressions into `{ start: Date, end: Date }` pairs and then
filters entity `createdAt`/`lastModified` against those boundaries.

### Files to Create

**`src/search/TemporalQueryParser.ts`**

```typescript
import * as chrono from 'chrono-node';

export interface AbsoluteTemporalRange {
  /** Inclusive lower bound */
  start: Date;
  /** Inclusive upper bound */
  end: Date;
  /** The original text expression */
  expression: string;
  /** Confidence in the parse (0-1) */
  confidence: number;
}

export interface TemporalParseResult {
  /** Resolved absolute range, null if unparseable */
  range: AbsoluteTemporalRange | null;
  /** Remaining query text with temporal expression removed */
  remainingQuery: string;
}

export class TemporalQueryParser {
  /**
   * Parse a natural language query for a temporal expression.
   * Uses chrono-node for parsing; falls back to keyword matching.
   *
   * @example
   * parser.parse('meetings 10 minutes ago')
   * // { range: { start: <now-10min>, end: <now> }, remainingQuery: 'meetings' }
   */
  parse(query: string, referenceDate?: Date): TemporalParseResult;

  /**
   * Filter entities whose createdAt or lastModified falls within range.
   * Uses lastModified when present, falls back to createdAt.
   */
  filterByRange(entities: Entity[], range: AbsoluteTemporalRange): Entity[];

  /**
   * Convert a relative TemporalRange.relative string (from QueryAnalyzer)
   * to an AbsoluteTemporalRange. Returns null if unparseable.
   */
  resolveRelative(relative: string, referenceDate?: Date): AbsoluteTemporalRange | null;
}
```

### Files to Modify

**`src/search/QueryAnalyzer.ts`**
- Import `TemporalQueryParser`.
- Add `private temporalParser = new TemporalQueryParser()` field.
- In `analyze()`, after the existing `extractTemporalRange(query)` call, add:
  ```typescript
  const temporalParseResult = this.temporalParser.parse(query);
  if (temporalParseResult.range) {
    // Store resolved range on QueryAnalysis
    analysis.resolvedTemporalRange = temporalParseResult.range;
    // Strip temporal expression from query before passing to keyword extractors
  }
  ```
- Add `resolvedTemporalRange?: AbsoluteTemporalRange` to `QueryAnalysis` type
  in `src/types/types.ts`.

**`src/types/types.ts`** (the `QueryAnalysis` interface)
```typescript
export interface QueryAnalysis {
  // ... existing fields ...
  /** Resolved absolute temporal range (populated by TemporalQueryParser) */
  resolvedTemporalRange?: AbsoluteTemporalRange;
}
```

**`src/search/HybridSearchManager.ts`**
- Accept an optional `temporalRange?: AbsoluteTemporalRange` in
  `HybridSearchOptions`.
- After collecting results, call
  `temporalParser.filterByRange(entities, options.temporalRange)` before scoring
  when `options.temporalRange` is set.

**`src/search/SearchManager.ts`**
- Plumb `resolvedTemporalRange` from `QueryAnalysis` through to
  `HybridSearchManager.search()` options.

### Test File

**`tests/unit/search/TemporalQueryParser.test.ts`**

Key test cases:
1. `parse('events 10 minutes ago')` returns start/end within 1 second of
   expected.
2. `parse('last hour')` returns 60-minute window ending now.
3. `parse('yesterday')` returns midnight-to-midnight window for previous day.
4. `parse('last week')` returns 7-day window.
5. `parse('no temporal expression here')` returns `{ range: null, remainingQuery: <original> }`.
6. `filterByRange()` excludes entities outside window.
7. `filterByRange()` includes entities exactly on boundary (inclusive).
8. `resolveRelative('last month')` works correctly.

### Dependencies

Add to `package.json` `dependencies`:
```json
"chrono-node": "^2.7.7"
```

Also add `@types/chrono-node` if not bundled — chrono-node v2 ships its own
types, so no separate `@types` package is needed.

### Implementation Sequence

1. `npm install chrono-node`.
2. Create `src/search/TemporalQueryParser.ts`.
3. Add `resolvedTemporalRange` to `QueryAnalysis` in `src/types/types.ts`.
4. Modify `QueryAnalyzer.ts` to invoke `TemporalQueryParser`.
5. Plumb through `HybridSearchManager` and `SearchManager`.
6. Write and pass tests.
7. `npm run typecheck` — commit.

---

## Feature 4 — Memory Distillation Policy

**Effort**: M | **Depends on**: nothing (integrates between HybridSearch output
and ContextWindowManager input) | **Commit**: fourth

### Rationale

The `FEASIBILITY_REPORT.md` notes this leverages `SummarizationService` +
`SearchFilterChain`. The architecture places it as a post-retrieval, pre-
reasoning filter: after `HybridSearchManager` produces ranked results and before
`ContextWindowManager` selects the token budget, a `DistillationPolicy` scores
and culls irrelevant memories. This keeps the context window clean.

### Files to Create

**`src/agent/DistillationPolicy.ts`**

```typescript
import type { Entity } from '../types/types.js';
import type { HybridSearchResult } from '../types/types.js';

/** A single scored memory after distillation. */
export interface DistilledMemory {
  entity: Entity;
  /** Original hybrid search score */
  rawScore: number;
  /** Post-distillation relevance score (0-1) */
  distilledScore: number;
  /** Human-readable reason this memory was kept or filtered */
  reason: string;
  /** Whether it survived distillation */
  kept: boolean;
}

/** Configuration for a distillation policy run. */
export interface DistillationConfig {
  /** Minimum distilled score to keep (default: 0.3) */
  minScore?: number;
  /** Maximum memories to return (default: 50) */
  maxMemories?: number;
  /** Current task description for relevance scoring */
  taskDescription?: string;
  /** Current session ID for recency weighting */
  sessionId?: string;
  /** Keywords from the query for term overlap scoring */
  queryKeywords?: string[];
  /** Weight for recency in distillation score (default: 0.3) */
  recencyWeight?: number;
  /** Weight for term overlap in distillation score (default: 0.4) */
  relevanceWeight?: number;
  /** Weight for base importance in distillation score (default: 0.3) */
  importanceWeight?: number;
}

/**
 * Interface for custom distillation policies.
 * Implement this to plug in domain-specific filtering logic.
 */
export interface IDistillationPolicy {
  /**
   * Distill a list of search results, returning scored+filtered memories.
   * Must be pure (no side-effects on storage).
   */
  distill(
    results: HybridSearchResult[],
    config: DistillationConfig
  ): Promise<DistilledMemory[]>;
}

/**
 * Default distillation policy using recency + term overlap + importance.
 *
 * Scoring formula:
 *   distilledScore = (recencyScore * recencyWeight)
 *                  + (termOverlapScore * relevanceWeight)
 *                  + (normalizedImportance * importanceWeight)
 */
export class DefaultDistillationPolicy implements IDistillationPolicy {
  async distill(
    results: HybridSearchResult[],
    config: DistillationConfig
  ): Promise<DistilledMemory[]>;

  private scoreRecency(entity: Entity): number;
  private scoreTermOverlap(entity: Entity, keywords: string[]): number;
  private scoreImportance(entity: Entity): number;
}

/**
 * Distillation pipeline that chains multiple policies.
 * Each policy receives the output of the previous one.
 */
export class DistillationPipeline {
  constructor(private policies: IDistillationPolicy[]) {}

  async run(
    results: HybridSearchResult[],
    config: DistillationConfig
  ): Promise<DistilledMemory[]>;
}
```

### Files to Modify

**`src/agent/ContextWindowManager.ts`**
- Add `private distillationPolicy?: IDistillationPolicy` field.
- Add `setDistillationPolicy(policy: IDistillationPolicy): void`.
- In `retrieveForContext()`: after fetching entities from storage but before
  salience scoring, if `distillationPolicy` is set, call
  `await this.distillationPolicy.distill(rawResults, config)` and filter to kept
  memories only. Pass `distilledScore` as a weight hint to `SalienceEngine`.

**`src/core/ManagerContext.ts`**
- Add `private _distillationPolicy?: DefaultDistillationPolicy`.
- Add `get distillationPolicy(): DefaultDistillationPolicy` lazy getter.
- After `_contextWindowManager` is initialized, call
  `this._contextWindowManager.setDistillationPolicy(this.distillationPolicy)`.

**`src/agent/AgentMemoryManager.ts`**
- Expose `setDistillationPolicy(policy: IDistillationPolicy): void` that
  delegates to the `ContextWindowManager` instance.

### Test File

**`tests/unit/agent/DistillationPolicy.test.ts`**

Key test cases:
1. `DefaultDistillationPolicy.distill()` with `minScore: 0.3` removes low-score
   items.
2. `maxMemories: 5` cap is respected.
3. Term overlap scoring: entity with matching keywords scores higher than entity
   without.
4. Recency: entity with `lastModified` 1 minute ago scores higher than entity
   from last year.
5. `DistillationPipeline` chains two policies — second policy receives first's
   output.
6. All items returned have `kept: true` (filtered items are excluded, not
   returned with `kept: false`).
7. Empty input returns empty output without throwing.

### Dependencies

None — pure TypeScript scoring logic.

### Implementation Sequence

1. Create `src/agent/DistillationPolicy.ts` with all interfaces and
   `DefaultDistillationPolicy`.
2. Modify `ContextWindowManager` to accept and invoke the policy.
3. Wire lazy getter into `ManagerContext`.
4. Expose delegation in `AgentMemoryManager`.
5. Write and pass tests.
6. `npm run typecheck` — commit.

---

## Feature 5 — Temporal Governance & Freshness

**Effort**: M | **Depends on**: nothing (extends Entity type and DecayEngine)
**Commit**: fifth

### Rationale

The `FEASIBILITY_REPORT.md` rates this Easy-Medium alongside `DecayEngine`.
The existing `AgentEntity` has `expiresAt` and `confidence` fields but there is
no enforcement: expired entities are never refused, confidence never decays, and
there is no freshness score surfaced to callers. This feature adds hard TTL
enforcement, per-entity confidence decay, and a `FreshnessAuditor` that reports
stale entities.

### Files to Create

**`src/agent/FreshnessAuditor.ts`**

```typescript
import type { Entity } from '../types/types.js';
import type { IGraphStorage } from '../types/types.js';

export type FreshnessStatus =
  | 'fresh'       // within TTL, high confidence
  | 'aging'       // within TTL, confidence below 0.7
  | 'stale'       // past TTL but not yet deleted
  | 'expired';    // TTL = 0 or explicitly expired

export interface FreshnessReport {
  entity: Entity;
  status: FreshnessStatus;
  /** Normalized freshness score 0-1 (1 = perfectly fresh) */
  freshnessScore: number;
  /** ISO 8601 timestamp when entity becomes/became stale */
  staleSince?: string;
  /** Recommended action */
  recommendation: 'keep' | 'refresh' | 'archive' | 'delete';
}

export interface AuditSummary {
  total: number;
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
  reports: FreshnessReport[];
}

export class FreshnessAuditor {
  constructor(private storage: IGraphStorage) {}

  /**
   * Compute freshness report for a single entity.
   * Uses entity.ttl (seconds), entity.confidence, entity.lastModified.
   */
  auditEntity(entity: Entity): FreshnessReport;

  /**
   * Audit all entities in storage.
   */
  async auditAll(): Promise<AuditSummary>;

  /**
   * Return entities that are stale or expired.
   */
  async getStaleEntities(): Promise<FreshnessReport[]>;

  /**
   * Enforce TTL: delete all expired entities from storage.
   * Returns names of deleted entities.
   */
  async enforceExpiry(): Promise<string[]>;

  /**
   * Compute a freshness score for an entity:
   *   freshnessScore = timeRemainingFraction * confidenceScore
   * where timeRemainingFraction = max(0, (expiresAt - now) / ttl).
   */
  private computeFreshnessScore(entity: Entity, now: Date): number;
}
```

### Files to Modify

**`src/types/types.ts`** — extend `Entity` interface:
```typescript
export interface Entity {
  // ... existing fields ...

  /** Time-to-live in seconds. Null = immortal. */
  ttl?: number;

  /**
   * Confidence that this entity's observations are still accurate (0.0-1.0).
   * Distinct from importance. Decays over time when DecayEngine runs.
   */
  confidence?: number;

  /**
   * ISO 8601 timestamp after which this entity is considered expired.
   * Set automatically when ttl is provided on creation.
   */
  expiresAt?: string;
}
```

Note: `AgentEntity` already has `expiresAt` and `confidence`. Promoting these
to the base `Entity` type makes them available for non-agent use cases and
ensures the `FreshnessAuditor` works on both plain and agent entities.

**`src/core/EntityManager.ts`**
- In `createEntities()`: if `entity.ttl` is set and `entity.expiresAt` is not,
  compute `expiresAt = new Date(Date.now() + entity.ttl * 1000).toISOString()`.
- In `getEntity()` and any single-entity fetch: if `entity.expiresAt` is set
  and the current time is past it, throw `EntityExpiredError` (new error class).

**`src/agent/DecayEngine.ts`**
- In `calculateEffectiveImportance()`: incorporate `entity.confidence` if
  present. Effective importance = `baseImportance * confidence` when confidence
  is defined.
- Add `decayConfidence(entity: Entity, elapsedHours: number): number`: returns
  `confidence * exp(-ln2 / halfLifeHours * elapsedHours)`, clamped to
  `[minConfidence, 1.0]`.
- In `applyDecay()` (the batch method): update `confidence` alongside
  `importance`.

**`src/utils/errors.ts`**
```typescript
export class EntityExpiredError extends KnowledgeGraphError {
  constructor(name: string, expiredAt: string) {
    super(
      `Entity '${name}' expired at ${expiredAt}`,
      'ENTITY_EXPIRED'
    );
  }
}
```

**`src/core/ManagerContext.ts`**
- Add `private _freshnessAuditor?: FreshnessAuditor`.
- Add `get freshnessAuditor(): FreshnessAuditor` lazy getter.

### Test File

**`tests/unit/agent/FreshnessAuditor.test.ts`**

Key test cases:
1. Entity with `ttl: 3600` created 1 hour ago → status `'stale'`.
2. Entity with `ttl: 3600` created 30 minutes ago → status `'fresh'`.
3. Entity with no TTL → status `'fresh'` regardless of age.
4. Entity with `confidence: 0.4` → status `'aging'`.
5. `enforceExpiry()` deletes expired entities and returns their names.
6. `enforceExpiry()` does NOT delete non-expired entities.
7. `getEntity()` throws `EntityExpiredError` for an expired entity.
8. `createEntities()` auto-sets `expiresAt` when `ttl` is provided.
9. `DecayEngine.decayConfidence()` returns value strictly between 0 and initial
   confidence.

### Dependencies

None — extends existing patterns.

### Implementation Sequence

1. Add `ttl`, `confidence`, `expiresAt` to `Entity` in `src/types/types.ts`.
2. Add `EntityExpiredError` to `src/utils/errors.ts`.
3. Update `EntityManager.createEntities()` to set `expiresAt`.
4. Update `EntityManager.getEntity()` to throw on expiry.
5. Update `DecayEngine` to incorporate confidence.
6. Create `src/agent/FreshnessAuditor.ts`.
7. Wire lazy getter into `ManagerContext`.
8. Write and pass tests.
9. `npm run typecheck` — commit.

---

## Feature 6 — N-gram Hashing

**Effort**: M | **Depends on**: nothing | **Commit**: sixth

### Rationale

`FuzzySearch` computes Levenshtein distance against every entity in the graph,
even with the worker pool. The `OptimizedInvertedIndex` already uses sorted
`Uint32Array` posting lists for exact-term intersection. An `NGramIndex` adds a
pre-filter layer: before dispatching to workers, intersect the query's character
n-grams against a posting list to produce a candidate set, then compute
Levenshtein only against candidates. For a graph of 10,000+ entities with a
threshold of 0.7, trigram prefiltering typically reduces the candidate set by
90 %.

### Files to Create

**`src/search/NGramIndex.ts`**

```typescript
/**
 * Character n-gram index for O(1) candidate lookup per gram.
 *
 * Uses the same integer-ID + Uint32Array pattern as OptimizedInvertedIndex.
 * Default gram size: 3 (trigrams).
 */

export interface NGramIndexStats {
  gramCount: number;
  documentCount: number;
  avgPostingListLength: number;
  totalPostingEntries: number;
  memoryBytes: number;
}

export interface NGramPrefilterResult {
  /** Candidate entity names that share at least minGramOverlap grams */
  candidates: string[];
  /** Number of grams in the query */
  queryGrams: number;
  /** Number of entities checked (before gram filter) */
  totalEntities: number;
  /** Number of candidates after filter */
  candidateCount: number;
}

export class NGramIndex {
  constructor(private readonly gramSize: number = 3) {}

  /**
   * Add a document to the index.
   * Tokenizes text into character n-grams and updates posting lists.
   *
   * @param id - Numeric document ID (use OptimizedInvertedIndex's ID map pattern)
   * @param name - Entity name string to index
   */
  addDocument(id: number, name: string): void;

  /**
   * Remove a document from the index.
   */
  removeDocument(id: number, name: string): void;

  /**
   * Find candidate entity names sharing at least `minOverlap` grams with query.
   *
   * @param query - Query string
   * @param allEntityNames - Full entity name → ID map for ID→name reverse lookup
   * @param minOverlapFraction - Minimum fraction of query grams that must match
   *                             (default: 0.3 — i.e. 30% of query grams)
   */
  findCandidates(
    query: string,
    allEntityNames: Map<string, number>,
    minOverlapFraction?: number
  ): NGramPrefilterResult;

  /**
   * Extract character n-grams from a string.
   * Pads with '#' sentinels at start/end to anchor boundary grams.
   *
   * @example
   * extractGrams('cat', 3) → ['##c', '#ca', 'cat', 'at#', 't##']
   */
  extractGrams(text: string): string[];

  /** Rebuild the entire index from an array of [id, name] pairs. */
  rebuild(documents: Array<[number, string]>): void;

  /** Return memory usage statistics. */
  stats(): NGramIndexStats;
}
```

### Files to Modify

**`src/search/FuzzySearch.ts`**
- Add `private ngramIndex: NGramIndex` field, initialized in constructor.
- Add `private entityIdMap: Map<string, number>` field.
- In `search()` (before dispatching to worker pool or inline Levenshtein):
  1. If `this.ngramIndex` has been built (document count > 0), call
     `this.ngramIndex.findCandidates(query, this.entityIdMap)`.
  2. If `candidateCount / totalEntities < 0.9` (i.e., filter is effective),
     restrict the entity list to `candidates` before Levenshtein.
  3. Otherwise (sparse index or near-total candidates), skip prefilter to avoid
     overhead.
- Add `buildNgramIndex(entities: Entity[]): void` — called at the end of any
  method that rebuilds the main cache, or lazily on first search.
- Update entity add/remove to incrementally update the n-gram index.

### Test File

**`tests/unit/search/NGramIndex.test.ts`**

Key test cases:
1. `extractGrams('hello', 3)` returns expected sentinel-padded trigrams.
2. `addDocument` + `findCandidates` returns entity with overlapping grams.
3. Entity with no gram overlap is not in candidates.
4. `minOverlapFraction: 0` returns all documents (edge case).
5. `removeDocument` removes entity from all gram posting lists.
6. `rebuild` from scratch produces same index as incremental adds.
7. `stats()` returns correct gram count and document count.
8. Prefilter integration: `FuzzySearch` on 1000-entity corpus calls Levenshtein
   on ≤ 20% of entities for a highly specific query (benchmark, gated behind
   `SKIP_BENCHMARKS`).

### Dependencies

None — pure TypeScript data structure.

### Implementation Sequence

1. Create `src/search/NGramIndex.ts`.
2. Modify `FuzzySearch.ts` to initialize `NGramIndex`, build it on first search
   or on explicit `buildIndex()`, and use it as a prefilter.
3. Write and pass unit tests.
4. Write the performance integration test (skippable via `SKIP_BENCHMARKS`).
5. `npm run typecheck` — commit.

---

## Feature 7 — LLM Query Planner

**Effort**: M | **Depends on**: Feature 3 (TemporalQueryParser already resolves
ranges) | **Commit**: seventh

### Rationale

`QueryAnalyzer` is rule-based. The `LLMQueryPlanner` is an **optional** module:
it requires an API key (`MEMORY_LLM_PLANNER_API_KEY`) and wraps a single
function-calling request to decompose a complex natural language query into a
`StructuredRetrievalPlan` — a list of typed sub-operations. When no API key is
configured, callers fall back to `QueryAnalyzer` transparently.

### Files to Create

**`src/search/LLMQueryPlanner.ts`**

```typescript
import type { AbsoluteTemporalRange } from './TemporalQueryParser.js';

/** A single typed retrieval sub-operation. */
export type RetrievalOp =
  | { kind: 'entity_lookup'; entityName: string }
  | { kind: 'tag_filter'; tags: string[]; operator: 'AND' | 'OR' }
  | { kind: 'type_filter'; entityType: string }
  | { kind: 'temporal_range'; range: AbsoluteTemporalRange }
  | { kind: 'ref_lookup'; ref: string }
  | { kind: 'semantic_search'; query: string; limit: number }
  | { kind: 'hybrid_search'; query: string; limit: number }
  | { kind: 'relation_traverse'; from: string; relationType?: string; depth: number };

export interface StructuredRetrievalPlan {
  /** Original natural language query */
  originalQuery: string;
  /** Ordered list of retrieval operations */
  operations: RetrievalOp[];
  /** LLM-assigned confidence in this plan (0-1) */
  confidence: number;
  /** Human-readable explanation of the plan */
  rationale: string;
  /** Whether to execute operations in parallel (true) or sequentially (false) */
  parallelizable: boolean;
}

export interface LLMQueryPlannerConfig {
  /** API key for the LLM service */
  apiKey: string;
  /** Model endpoint (default: 'https://api.openai.com/v1/chat/completions') */
  endpoint?: string;
  /** Model name (default: 'gpt-4o-mini') */
  model?: string;
  /** Request timeout ms (default: 10000) */
  timeoutMs?: number;
  /** Maximum retries on 429/529 (default: 3) */
  maxRetries?: number;
}

export class LLMQueryPlanner {
  constructor(private config: LLMQueryPlannerConfig) {}

  /**
   * Decompose a natural language query into a StructuredRetrievalPlan.
   * Makes a single function-calling request with retry on 429/529.
   * Returns null on unrecoverable error (caller falls back to QueryAnalyzer).
   */
  async plan(query: string): Promise<StructuredRetrievalPlan | null>;

  /**
   * Execute a StructuredRetrievalPlan against a ManagerContext.
   * Returns merged, deduplicated entities.
   */
  async execute(
    plan: StructuredRetrievalPlan,
    context: PlanExecutionContext
  ): Promise<Entity[]>;

  /** True if this planner is usable (API key set, endpoint reachable). */
  isAvailable(): boolean;
}

/** Context supplied to plan execution — avoids circular import of ManagerContext. */
export interface PlanExecutionContext {
  getEntity(name: string): Promise<Entity | null>;
  searchByTag(tags: string[], operator: 'AND' | 'OR'): Promise<Entity[]>;
  searchByType(entityType: string): Promise<Entity[]>;
  filterByTemporalRange(range: AbsoluteTemporalRange): Promise<Entity[]>;
  resolveRef(ref: string): Promise<Entity | null>;
  semanticSearch(query: string, limit: number): Promise<Entity[]>;
  hybridSearch(query: string, limit: number): Promise<Entity[]>;
  traverseRelations(from: string, relationType?: string, depth?: number): Promise<Entity[]>;
}
```

**`src/search/QueryPlannerFactory.ts`**
```typescript
/**
 * Returns an LLMQueryPlanner when MEMORY_LLM_PLANNER_API_KEY is set,
 * otherwise returns null (callers use QueryAnalyzer fallback).
 */
export function createQueryPlanner(): LLMQueryPlanner | null;
```

### Files to Modify

**`src/core/ManagerContext.ts`**
- Add `private _llmQueryPlanner?: LLMQueryPlanner | null`.
- Add `get llmQueryPlanner(): LLMQueryPlanner | null` lazy getter that calls
  `createQueryPlanner()`.
- Expose a `buildPlanExecutionContext(): PlanExecutionContext` method that
  delegates to the managers already on the context.

**`src/search/SearchManager.ts`**
- At the top of the main `search()` method, if
  `this.llmQueryPlanner?.isAvailable()` is true, call `plan()` and `execute()`.
  If the plan returns results, return them. Otherwise fall through to existing
  logic. The entire LLM path is wrapped in a try/catch so any failure is silent
  and falls back to the rule-based path.

**`.env.example`** (create if it doesn't exist):
```
MEMORY_LLM_PLANNER_API_KEY=
MEMORY_LLM_PLANNER_MODEL=gpt-4o-mini
MEMORY_LLM_PLANNER_ENDPOINT=https://api.openai.com/v1/chat/completions
```

### Test File

**`tests/unit/search/LLMQueryPlanner.test.ts`**

Key test cases (all mocked — no real API calls in CI):
1. `plan()` with a mocked response returns a valid `StructuredRetrievalPlan`.
2. `plan()` on HTTP 429 retries up to `maxRetries` and succeeds on third attempt.
3. `plan()` on unrecoverable error (HTTP 500) returns null.
4. `execute()` calls `PlanExecutionContext` methods matching the op types in the
   plan.
5. `execute()` deduplicates entities that appear in multiple op results.
6. `isAvailable()` returns false when `apiKey` is empty.
7. `createQueryPlanner()` returns null when `MEMORY_LLM_PLANNER_API_KEY` is
   unset.
8. `SearchManager` falls back to rule-based path when planner returns null.

### Dependencies

No new npm packages. Uses `https` (built-in Node.js) for HTTP calls — mirrors
the `rlm_query.py` pattern of pure-platform HTTP with retry, as noted in project
memory. Do NOT use `node-fetch` or `axios`.

### Implementation Sequence

1. Create `src/search/LLMQueryPlanner.ts`.
2. Create `src/search/QueryPlannerFactory.ts`.
3. Modify `ManagerContext` to expose planner and execution context.
4. Modify `SearchManager` to attempt LLM planning with fallback.
5. Write tests with mocked HTTP responses using `vi.spyOn(https, 'request')`.
6. `npm run typecheck` — commit.

---

## Feature 8 — Dynamic Memory Governance Foundation

**Effort**: M-L | **Depends on**: nothing (builds on existing TransactionManager)
**Commit**: eighth

### Rationale

`TransactionManager` (`src/core/TransactionManager.ts`) already provides ACID-
like batch operations with a backup-based rollback. What is missing is: (a) a
durable **audit log** that records every committed operation with actor and
timestamp, (b) point-in-time **rollback** to a named checkpoint (not just the
pre-transaction backup), and (c) an **admission gate** — a callback hook that
can veto operations before they are staged. The SQLite WAL is the right
persistence target for the audit log; for JSONL mode, a separate JSONL sidecar
is used.

### Files to Create

**`src/core/AuditLog.ts`**

```typescript
import type { TransactionOperation } from './TransactionManager.js';

export type AuditEventType =
  | 'transaction_begin'
  | 'transaction_commit'
  | 'transaction_rollback'
  | 'operation_staged'
  | 'operation_vetoed'
  | 'checkpoint_created'
  | 'checkpoint_restored';

export interface AuditEvent {
  /** Unique event ID (UUID v4) */
  id: string;
  /** Event category */
  eventType: AuditEventType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Actor identifier (agent ID, user, system) */
  actor: string;
  /** Transaction ID this event belongs to */
  transactionId: string;
  /** The operation being recorded (for operation_staged/vetoed) */
  operation?: TransactionOperation;
  /** Human-readable description */
  description: string;
  /** Checkpoint name (for checkpoint events) */
  checkpointName?: string;
}

export interface AuditQuery {
  /** Filter by actor */
  actor?: string;
  /** Filter by event type */
  eventType?: AuditEventType;
  /** ISO 8601 start of range */
  since?: string;
  /** ISO 8601 end of range */
  until?: string;
  /** Maximum entries to return */
  limit?: number;
}

export class AuditLog {
  constructor(private logFilePath: string) {}

  /** Append a single audit event. */
  async append(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent>;

  /** Query the audit log with optional filters. */
  async query(filter: AuditQuery): Promise<AuditEvent[]>;

  /** Return the N most recent events. */
  async recent(n: number): Promise<AuditEvent[]>;

  /** Compact the log (rewrite, removing duplicates). */
  async compact(): Promise<void>;
}
```

**`src/core/CheckpointManager.ts`**

```typescript
import type { KnowledgeGraph } from '../types/types.js';
import type { GraphStorage } from './GraphStorage.js';
import type { AuditLog } from './AuditLog.js';

export interface Checkpoint {
  /** Human-readable name */
  name: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** Actor who created this checkpoint */
  actor: string;
  /** Path to the serialized graph snapshot */
  snapshotPath: string;
  /** Entity count at checkpoint time */
  entityCount: number;
  /** Relation count at checkpoint time */
  relationCount: number;
}

export class CheckpointManager {
  constructor(
    private storage: GraphStorage,
    private auditLog: AuditLog,
    private checkpointDir: string
  ) {}

  /**
   * Save the current graph state as a named checkpoint.
   * Stores a gzip-compressed JSON snapshot in checkpointDir.
   */
  async create(name: string, actor: string): Promise<Checkpoint>;

  /**
   * List all checkpoints ordered by creation time (newest first).
   */
  async list(): Promise<Checkpoint[]>;

  /**
   * Restore graph to a named checkpoint.
   * Writes an audit event for the restore operation.
   * Returns the restored Checkpoint metadata.
   */
  async restore(name: string, actor: string): Promise<Checkpoint>;

  /**
   * Delete a checkpoint by name.
   */
  async delete(name: string): Promise<void>;

  /** Return the most recent checkpoint, or null if none exist. */
  async latest(): Promise<Checkpoint | null>;
}
```

**`src/core/AdmissionGate.ts`**

```typescript
import type { TransactionOperation } from './TransactionManager.js';

export interface AdmissionResult {
  /** Whether the operation is permitted */
  allowed: boolean;
  /** Reason for veto, if denied */
  reason?: string;
}

/**
 * Implement this interface to plug custom admission rules into TransactionManager.
 *
 * @example
 * class MaxEntityGate implements IAdmissionGate {
 *   async evaluate(op) {
 *     if (op.type === 'CREATE_ENTITY' && currentCount >= limit)
 *       return { allowed: false, reason: 'Entity limit reached' };
 *     return { allowed: true };
 *   }
 * }
 */
export interface IAdmissionGate {
  evaluate(op: TransactionOperation): Promise<AdmissionResult>;
}

/** Chains multiple gates — first denial wins. */
export class CompositeAdmissionGate implements IAdmissionGate {
  constructor(private gates: IAdmissionGate[]) {}
  async evaluate(op: TransactionOperation): Promise<AdmissionResult>;
}
```

### Files to Modify

**`src/core/TransactionManager.ts`**
- Add `private auditLog?: AuditLog` and `private admissionGate?: IAdmissionGate`
  fields.
- Add `setAuditLog(log: AuditLog): void` and
  `setAdmissionGate(gate: IAdmissionGate): void`.
- In `begin()`: generate a `transactionId` (UUID), record
  `transaction_begin` audit event.
- In the staging methods (`createEntity`, `createRelation`, etc.): if
  `admissionGate` is set, call `await this.admissionGate.evaluate(op)`. If
  `allowed: false`, record `operation_vetoed` audit event and throw
  `AdmissionVetoError`.
- When `allowed: true`, record `operation_staged` audit event.
- In `commit()`: record `transaction_commit` on success, `transaction_rollback`
  on failure.
- Add `transactionId` to `TransactionResult`.

**`src/core/ManagerContext.ts`**
- Add `private _auditLog?: AuditLog` and `private _checkpointManager?:
  CheckpointManager`.
- Add lazy getters for both. Audit log path: `${basename}-audit.jsonl`.
  Checkpoint dir: `${dir}/${basename}-checkpoints/`.
- After `TransactionManager` init, wire in the audit log.

**`src/utils/errors.ts`**
```typescript
export class AdmissionVetoError extends KnowledgeGraphError {
  constructor(operationType: string, reason: string) {
    super(
      `Operation '${operationType}' vetoed by admission gate: ${reason}`,
      'ADMISSION_VETO'
    );
  }
}
```

### Test File

**`tests/unit/core/AuditLog.test.ts`**

Key test cases:
1. `append()` writes an event with auto-generated `id` and `timestamp`.
2. `query({ actor: 'agent1' })` returns only events from that actor.
3. `query({ since: T1, until: T2 })` returns events within range.
4. `recent(3)` returns at most 3 events in reverse chronological order.
5. Events survive a process restart (written to disk).

**`tests/unit/core/CheckpointManager.test.ts`**

Key test cases:
1. `create()` persists a snapshot and returns a Checkpoint.
2. `list()` returns checkpoints newest-first.
3. `restore()` overwrites current graph with checkpoint state.
4. `restore()` writes an audit event.
5. `delete()` removes the checkpoint file.
6. `latest()` returns null when no checkpoints exist.

**`tests/unit/core/AdmissionGate.test.ts`**

Key test cases:
1. `CompositeAdmissionGate` with two always-allow gates returns `allowed: true`.
2. First gate denies → `allowed: false`, second gate not called.
3. TransactionManager with veto gate throws `AdmissionVetoError` on staged op.
4. `operation_vetoed` audit event is written when gate denies.
5. `transaction_begin` and `transaction_commit` events appear in audit log after
   successful transaction.

### Dependencies

Uses `crypto.randomUUID()` (built-in Node >= 15) for UUID generation. Uses
`zlib` (built-in) for gzip compression of checkpoint snapshots. No new npm
packages.

### Implementation Sequence

1. Add `AdmissionVetoError` to `src/utils/errors.ts`.
2. Create `src/core/AuditLog.ts`.
3. Create `src/core/AdmissionGate.ts`.
4. Modify `TransactionManager` to accept audit log + admission gate, generate
   `transactionId`, record events.
5. Create `src/core/CheckpointManager.ts`.
6. Wire lazy getters into `ManagerContext` and inject into `TransactionManager`.
7. Write and pass tests for all three new files.
8. `npm run typecheck` — commit.

---

## Integration Test

**File**: `tests/integration/must-have-pipeline.test.ts`

This single test exercises the complete feature chain end-to-end using an
`InMemoryStorage` fixture:

```
createArtifact('weather_api_step3', ...) [Feature 2]
  → entity created + ref registered [Feature 1]

resolveRef('weather_api_step3') [Feature 1]
  → entity returned in O(1)

hybridSearch('weather events last 10 minutes') [Feature 3]
  → TemporalQueryParser resolves range, results filtered

distillationPolicy.distill(searchResults, { queryKeywords: ['weather'] }) [Feature 4]
  → low-relevance memories filtered out

createEntity({ ttl: 1 }) [Feature 5]
  → after 2-second sleep, getEntity() throws EntityExpiredError

FuzzySearch on 200-entity corpus [Feature 6]
  → NGramIndex prefilter fires (logged via stats())

SearchManager with mocked LLMQueryPlanner [Feature 7]
  → plan decomposed, execute() called, results returned

transactionManager.begin() [Feature 8]
  → createEntity staged, veto gate blocks second entity
  → commit() writes audit events, auditLog.recent(5) returns them
```

---

## Implementation Map Summary

| # | Feature | New Files | Modified Files |
|---|---------|-----------|----------------|
| 1 | Stable Index Dereferencing | `src/core/RefIndex.ts` | `src/core/EntityManager.ts`, `src/core/ManagerContext.ts`, `src/utils/errors.ts` |
| 2 | Artifact-Level Granularity | `src/core/ArtifactManager.ts` | `src/core/ManagerContext.ts`, `src/agent/AgentMemoryManager.ts` |
| 3 | Temporal Range Queries | `src/search/TemporalQueryParser.ts` | `src/search/QueryAnalyzer.ts`, `src/types/types.ts`, `src/search/HybridSearchManager.ts`, `src/search/SearchManager.ts` |
| 4 | Memory Distillation Policy | `src/agent/DistillationPolicy.ts` | `src/agent/ContextWindowManager.ts`, `src/core/ManagerContext.ts`, `src/agent/AgentMemoryManager.ts` |
| 5 | Temporal Governance & Freshness | `src/agent/FreshnessAuditor.ts` | `src/types/types.ts`, `src/core/EntityManager.ts`, `src/agent/DecayEngine.ts`, `src/utils/errors.ts`, `src/core/ManagerContext.ts` |
| 6 | N-gram Hashing | `src/search/NGramIndex.ts` | `src/search/FuzzySearch.ts` |
| 7 | LLM Query Planner | `src/search/LLMQueryPlanner.ts`, `src/search/QueryPlannerFactory.ts` | `src/core/ManagerContext.ts`, `src/search/SearchManager.ts` |
| 8 | Dynamic Memory Governance | `src/core/AuditLog.ts`, `src/core/CheckpointManager.ts`, `src/core/AdmissionGate.ts` | `src/core/TransactionManager.ts`, `src/core/ManagerContext.ts`, `src/utils/errors.ts` |

**New test files** (9 total):
- `tests/unit/core/RefIndex.test.ts`
- `tests/unit/core/ArtifactManager.test.ts`
- `tests/unit/search/TemporalQueryParser.test.ts`
- `tests/unit/agent/DistillationPolicy.test.ts`
- `tests/unit/agent/FreshnessAuditor.test.ts`
- `tests/unit/search/NGramIndex.test.ts`
- `tests/unit/search/LLMQueryPlanner.test.ts`
- `tests/unit/core/AuditLog.test.ts` + `CheckpointManager.test.ts` + `AdmissionGate.test.ts`
- `tests/integration/must-have-pipeline.test.ts`

**New npm dependency**: `chrono-node@^2.7.7` (Feature 3 only).

---

## Critical Details

### Error Handling

- All new error classes extend `KnowledgeGraphError` from `src/utils/errors.ts`
  with a string error code. This preserves the existing error handling contract.
- `LLMQueryPlanner.plan()` never throws — it returns `null` and logs via the
  existing `logger` utility. Callers must not assume the planner is always
  available.
- `FreshnessAuditor.enforceExpiry()` calls `EntityManager.deleteEntities()` in
  batches, not individual deletes, to respect the existing graph-size-limit
  validation.

### State Management

- `RefIndex` and `AuditLog` use the same mutex pattern as `GraphStorage`
  (`async-mutex`) to prevent concurrent write races.
- `NGramIndex` is rebuilt in memory — no persistence needed. It is invalidated
  and rebuilt whenever `FuzzySearch` detects its entity count has changed (the
  existing `entityCount` pattern from `FuzzyCacheEntry`).
- `CheckpointManager` creates its `checkpointDir` on first use via
  `fs.mkdir(..., { recursive: true })`.

### Performance

- `NGramIndex.findCandidates()` must complete in < 5 ms for 10,000-entity
  corpus. Use `Map<string, Uint32Array>` for posting lists (same pattern as
  `OptimizedInvertedIndex`).
- `DistillationPolicy.distill()` is synchronous scoring math — no I/O. Wrap in
  `Promise.resolve()` only at the interface boundary.
- `LLMQueryPlanner` imposes a 10-second timeout. Do not block the main search
  path; the fallback must fire within the same request latency envelope.

### Security

- `LLMQueryPlanner` reads the API key only from environment variable
  (`MEMORY_LLM_PLANNER_API_KEY`), never from query parameters or entity content.
  The existing `block-env-edits.py` PreToolUse hook already prevents `.env`
  edits.
- `AuditLog` paths and `CheckpointManager` paths are validated through the
  existing `validateFilePath` utility before any disk write.
- `AdmissionGate` vetoes are the only place where operations can be silently
  blocked. A veto always writes an audit event so no operation disappears without
  a trace.

### TypeScript Strictness

The `tsconfig.json` has `noUnusedLocals`, `noUnusedParameters`, and
`strictNullChecks` all enabled. Every optional field access in new code must use
`?.` or explicit null checks. All `async` functions that can fail must handle
the `unknown` catch type (`useUnknownInCatchVariables: true` is set).
```

---

The document above is ready to save. Here is the path it should go to:

`C:/Users/danie/Dropbox/Github/memoryjs/docs/roadmap/IMPLEMENTATION_PLAN_MUST_HAVE.md`

Key files referenced during analysis:

- `/C:/Users/danie/Dropbox/Github/memoryjs/src/core/EntityManager.ts` — lines 135 (duplicate-filter guard), 111–191 (createEntities body) — this is where TTL auto-set and ref purge hooks in Feature 1 and 5 land.
- `/C:/Users/danie/Dropbox/Github/memoryjs/src/core/TransactionManager.ts` — lines 28–73 (OperationType enum + TransactionOperation union) — Feature 8 extends these.
- `/C:/Users/danie/Dropbox/Github/memoryjs/src/search/QueryAnalyzer.ts` — lines 34–83 (temporalKeywords list, `analyze()`) — Feature 3 hooks here.
- `/C:/Users/danie/Dropbox/Github/memoryjs/src/search/OptimizedInvertedIndex.ts` — the `Uint32Array` posting-list pattern that Feature 6 (`NGramIndex`) mirrors exactly.
- `/C:/Users/danie/Dropbox/Github/memoryjs/src/agent/ContextWindowManager.ts` — lines 83–107 (constructor + config defaults) — Feature 4 adds the `distillationPolicy` injection point here.
- `/C:/Users/danie/Dropbox/Github/memoryjs/src/types/types.ts` — lines 35–59 (`Entity` interface) — Features 5 adds `ttl`, `confidence`, `expiresAt` directly to this interface; Feature 3 adds `resolvedTemporalRange` to `QueryAnalysis`.
- `/C:/Users/danie/Dropbox/Github/memoryjs/src/search/FuzzySearch.ts` — lines 27–57 (cache constants and `FuzzyCacheEntry`) — Feature 6 mirrors the `entityCount` invalidation pattern for the n-gram index rebuild trigger.