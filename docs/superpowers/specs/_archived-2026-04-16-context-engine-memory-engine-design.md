# [SUPERSEDED] Design: Context Engine — Memory Engine Sub-Feature

> **⚠️ SUPERSEDED 2026-04-16**
> This spec was split into two after two independent subagent reviews (Opus + Sonnet) surfaced 39 findings — 8 of them blockers against the actual memoryjs codebase. Do not implement from this file. Follow the replacement specs:
>
> 1. **`2026-04-16-memory-engine-core-design.md`** — dedup (PRD MEM-03), auto-importance (PRD MEM-02), turn storage, events, composition over `EpisodicMemoryManager`. Ships first as v1.11.0.
> 2. **`2026-04-16-memory-engine-decay-extensions-design.md`** — PRD MEM-01 decay parameters (`decay_rate`, `freshness_coefficient`, `relevance_weight`, `min_importance_threshold`), PRD decay formula, PRD §3 GOAL-03, PRD MEM-04 `IMemoryBackend` + `InMemoryBackend` + `SQLiteBackend`, PRD importance-range `[1.0, 3.0]` mapping. Ships after Core as v1.12.0.
>
> Key changes that drove the split and rewrite:
> - **Dedup tiers realigned with PRD MEM-03 verbatim**: exact equality (narrowed from PRD "containment" with explicit rationale) / 50% prefix overlap / Jaccard ≥ 0.72. The original spec used Levenshtein + semantic-cosine, not PRD semantics.
> - **Removed `entities.embedding BLOB` migration** — the existing `embeddings` sidecar table at `src/core/SQLiteStorage.ts:1070` is the source of truth; adding a parallel column would create two sources.
> - **One new persisted column remains (`entities.contentHash TEXT`)** — added via the existing PRAGMA-guarded `migrateEntitiesTable()` pattern; gives O(1) Tier 1 lookup. The original `embedding BLOB` and `role TEXT` additions are both gone.
> - **`role` stored as an observation-text prefix**, not a schema field — no Entity schema change, no Zod migration.
> - **Reframed `MemoryEngine` as composition** over `EpisodicMemoryManager` + `WorkingMemoryManager` instead of a new storage paradigm.
> - **Replaced the proposed `SalienceEngine.scoreOnCreation`** with a focused `ImportanceScorer` class (single responsibility).
> - **`MemoryEngine` uses its own `node:events` `EventEmitter`** (not the shared `GraphEventEmitter`), because `GraphEvent` in `src/types/types.ts:1917` is a closed discriminated union that would reject new event types.
> - **PRD MEM-02 "with recent turns" is now implemented literally** — `ImportanceScorer.score(content, { recentTurns })` takes an explicit list; `ManagerContext` auto-fetches from `WorkingMemoryManager`.
> - **PRD importance range `[1.0, 3.0]` is explicitly owned by the Decay Extensions spec** (formerly unowned).
> - **Decay formula additions (PRD `recency × freshness + relevance_boost`) live on a NEW `calculatePrdEffectiveImportance` method** — the legacy `calculateEffectiveImportance` semantics are preserved for every existing caller (`DecayScheduler`, `SearchManager`, `SemanticForget`).
> - **PostgreSQLBackend / VectorMemoryBackend (PRD MEM-05/MEM-06) explicitly out of scope** for both successor specs; no migration path claimed.
> - **Code-reality fixes** applied to TypeScript snippets: correct import paths (`IGraphStorage` from `types/types.js`, `AgentEntity` from `agent-memory.js`), correct method names (`storage.updateEntity` not `updateEntityMetadata`), correct event routing (`ctx.storage.events` not `ctx.events`), correct embedding access (`embeddingService.embed` not `semanticSearch.embed`), correct `DecayEngineConfig` field list (no `enabled` field; includes `accessModulation` / `confidenceDecayRate` / `applyConfidenceToImportance`), correct ISO-string parsing for timestamp arithmetic.

---

**Date:** 2026-04-16
**Status:** Superseded (do not implement)
**Target branch:** `feature/context-engine-memory` (unused)
**Target version:** was v1.10.0 (replaced by Core v1.11.0 + Decay Extensions v1.11.1/v1.12.0)
**Related:**
- `docs/roadmap/CONTEXT_ENGINE_PRD 2.md` §8 (Memory Engine component)
- `docs/roadmap/CONTEXT_ENGINE_WHITEPAPER 2.md` (rationale)
- Parent: Context Engine decomposition (7 sub-features total; this is #3)

## Goal

Ship the **Memory Engine** sub-feature of the Context Engine: a turn-aware conversation memory layer with write-time three-tier deduplication, exponential decay with importance weighting, per-session isolation, and auto-importance scoring. Extends existing memoryjs managers rather than creating a new storage paradigm.

## Non-Goals

- ❌ PostgreSQL backend (`GOAL-05`) — deferred to separate spec
- ❌ The other 6 Context Engine sub-features (Hybrid Retriever, Re-ranker, Compressor, Budget Enforcer, Orchestrator, Observability) — separate specs
- ❌ New `MemoryTurn` type — reuses existing `Entity` type with new optional fields
- ❌ REST/MCP API surface — deferred to Observability sub-feature
- ❌ Embedding generation logic — consumed from existing `SemanticSearch`/`EmbeddingService`, not reimplemented

## PRD Alignment

Implements these PRD requirements directly:

- `GOAL-03` (🔴 Must): "Implement exponential memory decay with configurable parameters; high-importance turns must survive longer than low-importance turns without manual annotation"
- `GOAL-05` (🟡 Should, partial): "Persist memory state across sessions (SQLite single-user)" — PostgreSQL half deferred
- `MEM-01`–`MEM-N` from PRD §8: three-tier dedup, decay model, storage backend architecture

## Codebase Integration Summary (from deep audit)

| Area | Status |
|------|--------|
| Exponential decay formula with half-life | ✅ EXISTS — `DecayEngine.calculateDecayFactor()` |
| Importance weighting in decay | ✅ EXISTS — `(1 + importance/10)` multiplier |
| Background decay scheduling | ✅ EXISTS — `DecayScheduler` with `setInterval()` |
| Session-scoped storage | ✅ EXISTS — `WorkingMemoryManager.sessionIndex`, `AgentEntity.sessionId` |
| Entity importance field | ✅ EXISTS — `Entity.importance` (0-10) |
| Three-tier dedup (exact + fuzzy + semantic) | ⚠️ PARTIAL — `CompressionManager.findDuplicates()` has Levenshtein + Jaccard; no semantic tier |
| Write-time dedup integration | ❌ MISSING — existing dedup is batch-oriented |
| `role` field on entities | ❌ MISSING |
| `embedding` field on entities | ❌ MISSING (embeddings stored in VectorStore, not Entity) |
| Auto-importance scoring on write | ❌ MISSING |
| Env var configuration for decay | ❌ MISSING — only constructor config |

## Architecture

### Entity Model Changes

Add two universal optional fields to `Entity` (matches existing pattern of optional fields like `tags`, `importance`, `projectId`):

```typescript
export interface Entity {
  // ... existing fields (name, entityType, observations, etc.) ...

  /**
   * Role classification for conversational context.
   * Only populated for conversation turns; other entity types leave undefined.
   */
  role?: 'user' | 'assistant' | 'system';

  /**
   * Dense vector embedding for semantic similarity.
   * Optional — populated when embedding provider is configured and entity is
   * indexed for semantic retrieval. Not required for all entity types.
   */
  embedding?: number[];
}
```

**Rationale**: Universal fields (not a `MemoryTurn` subtype) because:
1. Matches existing optional-field pattern on `Entity`
2. Enables future features (e.g., `role: 'system'` for system-defined entities)
3. Avoids type-casting at every boundary
4. Single Entity type reduces API surface complexity

### SQLiteStorage Schema Migration

Extend the existing `entities` table:

```sql
ALTER TABLE entities ADD COLUMN role TEXT;
ALTER TABLE entities ADD COLUMN embedding BLOB;  -- stored as Float32Array bytes
CREATE INDEX IF NOT EXISTS idx_entities_role ON entities(role);
```

Follow the existing `migrateEntitiesTable()` pattern (SQLiteStorage.ts) — additive migrations, idempotent via PRAGMA table_info check. JSONL persistence handles new fields automatically (object spread serialization).

### New Class: `MemoryEngine`

Location: `src/agent/MemoryEngine.ts` (~250 lines).

```typescript
export interface MemoryEngineConfig {
  /** Dedup threshold for fuzzy tier (Levenshtein). Default 0.85. */
  fuzzyDedupThreshold?: number;
  /** Dedup threshold for semantic tier (cosine similarity). Default 0.92. */
  semanticDedupThreshold?: number;
  /** Skip semantic dedup if embedding provider not available. Default true. */
  gracefulSemanticDegrade?: boolean;
  /** Max turns per session before auto-archival. Default 1000. */
  maxTurnsPerSession?: number;
}

export interface AddTurnOptions {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  agentId?: string;
  projectId?: string;
  importance?: number;  // override auto-scoring
  metadata?: Record<string, unknown>;
}

export interface AddTurnResult {
  entity: Entity;
  duplicateDetected: boolean;
  duplicateOf?: string;       // entity name of existing duplicate
  duplicateTier?: 'exact' | 'fuzzy' | 'semantic';
  importanceScore: number;
}

export class MemoryEngine {
  constructor(
    private storage: IGraphStorage,
    private entityManager: EntityManager,
    private salienceEngine: SalienceEngine,
    private semanticSearch?: SemanticSearch,
    private config: MemoryEngineConfig = {}
  ) {}

  /**
   * Write a conversation turn. Runs three-tier dedup; if duplicate found,
   * returns the existing entity without creating a new one.
   */
  async addTurn(content: string, options: AddTurnOptions): Promise<AddTurnResult>;

  /**
   * Retrieve turns for a session, optionally weighted by decay score.
   */
  async getSessionTurns(
    sessionId: string,
    options?: { weighted?: boolean; limit?: number }
  ): Promise<Entity[]>;

  /**
   * Run three-tier duplicate check without writing.
   * Tier 1: exact content match (O(n) scan of session)
   * Tier 2: fuzzy match via Levenshtein (threshold 0.85)
   * Tier 3: semantic match via cosine similarity (threshold 0.92, requires embeddings)
   */
  async checkDuplicate(
    content: string,
    sessionId: string
  ): Promise<{ isDuplicate: boolean; match?: Entity; tier?: 'exact' | 'fuzzy' | 'semantic' }>;
}
```

### SalienceEngine Extension

Add one method to existing `SalienceEngine`:

```typescript
/**
 * Compute importance score for a new entity at creation time.
 * Unlike calculateSalience() (context-aware retrieval scoring), this is
 * intrinsic scoring based on content features alone.
 *
 * Formula: log-scaled content length (30%) + domain keyword presence (40%)
 *        + query token overlap if context provided (30%)
 * Returns integer 0-10.
 */
scoreOnCreation(content: string, context?: SalienceContext): number;
```

### Environment Variables

Add support in `MemoryEngineConfig` resolution:

```
MEMORY_ENGINE_FUZZY_THRESHOLD=0.85
MEMORY_ENGINE_SEMANTIC_THRESHOLD=0.92
MEMORY_ENGINE_MAX_TURNS_PER_SESSION=1000
MEMORY_ENGINE_GRACEFUL_SEMANTIC_DEGRADE=true
```

Decay-related env vars already exist from prior work:
```
MEMORY_DECAY_HALF_LIFE_HOURS=168
MEMORY_DECAY_INTERVAL_MS=3600000
MEMORY_DECAY_AUTO_FORGET=false
MEMORY_DECAY_MIN_IMPORTANCE=0.1
```
(These need wiring into `DecayEngine`/`DecayScheduler` construction — currently constructor-only.)

### Wiring

Expose via `ManagerContext` lazy getter:

```typescript
private _memoryEngine?: MemoryEngine;

get memoryEngine(): MemoryEngine {
  return (this._memoryEngine ??= new MemoryEngine(
    this.storage,
    this.entityManager,
    this.agentMemory().salienceEngine,
    this.semanticSearch ?? undefined,
    { /* config from env vars */ }
  ));
}
```

## Data Flow

### Write path (`addTurn`)

```
addTurn(content, { sessionId, role }) →
  1. Three-tier dedup check:
     a. Tier 1 (exact): scan session entities for observations.includes(content)
        → if hit, return existing entity, tier='exact'
     b. Tier 2 (fuzzy): Levenshtein against recent N turns (threshold 0.85)
        → if hit, return existing entity, tier='fuzzy'
     c. Tier 3 (semantic): cosine similarity via SemanticSearch (threshold 0.92)
        → skip gracefully if no embedding provider
        → if hit, return existing entity, tier='semantic'
  2. If no duplicate:
     a. Compute importance: salienceEngine.scoreOnCreation(content)
     b. Build Entity with role, sessionId, importance, embedding (if available)
     c. entityManager.createEntities([entity])
  3. Return AddTurnResult
```

### Read path (`getSessionTurns`)

```
getSessionTurns(sessionId, { weighted: true }) →
  1. Load all entities with matching sessionId (via existing storage filter)
  2. If weighted:
     a. For each: decayScore = decayEngine.calculateEffectiveImportance(entity)
     b. Sort by decayScore descending
  3. Apply limit
  4. Return entities
```

## Testing

### Unit tests

- `MemoryEngine.addTurn()` creates entity with correct role/sessionId/importance
- Three-tier dedup: each tier triggers correctly, tier attribution accurate
- Semantic tier gracefully degrades when no embedding provider
- `importance` defaults to auto-score when not provided
- `importance` override respected when provided
- `SalienceEngine.scoreOnCreation()` returns 0-10 integer
- Content length contributes correctly (log-scaled)
- Env var parsing produces expected config

### Integration tests

- Turn with identical content is deduplicated (tier 1)
- Turn with 95%-similar content is deduplicated (tier 2)
- Turn with semantically-equivalent content is deduplicated (tier 3) when embeddings available
- `role`/`embedding` fields round-trip through SQLite migration
- `role`/`embedding` fields round-trip through JSONL storage
- `getSessionTurns(sessionId, { weighted: true })` returns decay-sorted results
- DecayScheduler respects env var `MEMORY_DECAY_INTERVAL_MS`
- Multi-session isolation: turns from session A invisible in session B

### Migration test

- Open pre-v1.10 SQLite DB → `migrateEntitiesTable()` adds `role`, `embedding` columns without data loss
- Existing entities get `role = NULL, embedding = NULL` post-migration

## Error Handling

- **Missing embedding provider + semantic tier configured**: skip tier 3 with single debug log (not warn/error). Controlled by `gracefulSemanticDegrade` (default true).
- **Duplicate content on write**: NOT an error — returns existing entity with `duplicateDetected: true`. Callers inspect `duplicateTier` if needed.
- **Invalid role value**: Zod schema rejection at Entity creation (existing `EntitySchema` must add `role` enum).
- **Dedup check failure (e.g., storage read error)**: Surface the error — do not silently skip to write (better to fail fast than create inconsistent state).

## Performance Targets

Aligned with PRD §14 (NFRs):

- `addTurn()` end-to-end: P95 < 50ms (session < 1000 turns, no semantic tier)
- `addTurn()` with semantic tier: P95 < 200ms (includes embedding generation)
- Three-tier dedup short-circuits: if tier 1 hits, skip tier 2/3
- `getSessionTurns(weighted: true)` with 1000 turns: P95 < 100ms

## Success Criteria

- [ ] `role` and `embedding` fields on Entity, round-trip through both storage backends
- [ ] `MemoryEngine.addTurn()` creates valid entity with auto-importance
- [ ] Three-tier dedup demonstrably prevents duplicate storage (test corpus)
- [ ] `SalienceEngine.scoreOnCreation()` produces non-trivial score distribution (not all 5)
- [ ] `ManagerContext.memoryEngine` lazy getter works
- [ ] Env var configuration parsed and applied
- [ ] All 4,674+ existing tests still pass (no regressions)
- [ ] ~40 new tests added covering the areas listed above
- [ ] Typecheck clean
- [ ] CHANGELOG.md v1.10.0 entry added

## Open Questions (deferred — not blocking implementation)

1. Should `getSessionTurns()` also support cross-session retrieval by `agentId`? (Probably yes, but out of MVP scope)
2. Should embedding storage in SQLite use BLOB (binary) or TEXT (JSON array)? (BLOB is smaller; TEXT is debuggable — pick BLOB, provide a debug helper)
3. Should the three-tier dedup be configurable per-tier (e.g., disable tier 2 but keep 1 and 3)? (Not MVP; add if user pain emerges)

## Next Steps After Approval

1. Implementation plan via `superpowers:writing-plans` skill
2. Implementation via `superpowers:subagent-driven-development` skill
3. PR with `pr-review-toolkit:review-pr` before merge
4. Then tackle Sub-feature 1 (Hybrid Retriever) as next Context Engine piece
