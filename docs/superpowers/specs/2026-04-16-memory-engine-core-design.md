# Design: Memory Engine Core

**Date:** 2026-04-16
**Status:** Approved (post-review fixes applied), not yet implemented
**Target branch:** `feature/memory-engine-core`
**Target version:** v1.11.0 (next minor after current v1.10.0)
**Supersedes:** `_archived-2026-04-16-context-engine-memory-engine-design.md` (split into Core + Decay Extensions per user decision B)
**Companion spec:** `2026-04-16-memory-engine-decay-extensions-design.md` (ships in a separate later release)
**Related:**
- `docs/roadmap/CONTEXT_ENGINE_PRD 2.md` §8 (Memory Engine)
- `docs/roadmap/CONTEXT_ENGINE_WHITEPAPER 2.md`
- Parent: Context Engine decomposition (7 sub-features; this is Sub-feature #3a)

## Goal

Ship the write-side of the Context Engine Memory Engine: **turn-aware ingestion with three-tier deduplication, auto-importance scoring, per-session isolation, and write event emission** — implemented as a thin composition layer over memoryjs's existing `EpisodicMemoryManager` and `WorkingMemoryManager`, with minimal schema changes.

This spec covers PRD `MEM-02` and `MEM-03`. Decay extensions (`MEM-01`) and the storage-backend interface (`MEM-04`) are in the companion spec. Core ships alone as v1.11.0; Decay Extensions build on Core and ship in a later release (v1.12.0).

## Non-Goals

- Decay formula changes — current `DecayEngine.calculateEffectiveImportance` stays untouched. The PRD's `effective = importance × recency × freshness + relevance_boost` is the companion spec's scope.
- `IMemoryBackend` interface (PRD `MEM-04`) — companion spec.
- `PostgreSQLBackend` / `VectorMemoryBackend` (PRD `MEM-05`, `MEM-06`) — explicitly not planned.
- The other 6 Context Engine sub-features — separate specs.
- Embedding generation / storage — reused from existing `EmbeddingService` + `SQLiteStorage.storeEmbedding` / `getEmbedding`.
- REST/MCP API surface — deferred to Observability sub-feature.
- New `MemoryTurn` type — turns are stored as `AgentEntity` via the existing `EpisodicMemoryManager`.
- PRD importance range `[1.0, 3.0]` mapping — `ImportanceScorer` emits memoryjs's native `[0, 10]` integer scale. Range-mapping is deferred to the Decay Extensions spec, where it is owned with a worked example.

## PRD Alignment

Direct implementations in this spec:

| PRD ID | Requirement (from PRD §8, verbatim where quoted) | This spec |
|---|---|---|
| `MEM-02` | "Auto-importance scoring evaluates: content length (log-scaled), domain keyword presence, **query token overlap with recent turns**" (PRD line 409) | `ImportanceScorer` with `recentTurns` option fulfils "with recent turns" literally |
| `MEM-03` | "Three-tier deduplication before storage: (1) exact containment, (2) 50% prefix overlap, (3) Jaccard token similarity ≥ threshold (default 0.72)" (PRD line 410) | `MemoryEngine.checkDuplicate()` — Tier 1 narrowed from "containment" to "equality" (see §Dedup) |

`GOAL-03` (exponential decay) and related decay semantics are not in this spec — see companion Decay Extensions spec for PRD §3 GOAL-03 and PRD §8 MEM-01 coverage.

## Codebase Integration Summary

Verified by direct file reads (line numbers current as of v1.10.0, commit baseline `d2eb7c0`):

| Area | Status | Evidence |
|------|--------|----------|
| Per-session entity storage | EXISTS | `EpisodicMemoryManager.createEpisode(content, { sessionId, importance, agentId, ... })` at `src/agent/EpisodicMemoryManager.ts:134` |
| Session index + working memory | EXISTS | `WorkingMemoryManager.sessionIndex` |
| Entity `importance` field (0–10) | EXISTS | `Entity.importance` |
| Embedding sidecar table in SQLite | EXISTS | `embeddings` table at `src/core/SQLiteStorage.ts:1070`; methods `storeEmbedding` / `getEmbedding` at `:1090` / `:1110` |
| `EmbeddingService.embed(text)` | EXISTS | Called via `this.embeddingService.embed(text)` at `src/search/SemanticSearch.ts:156, 186, 228`. **`SemanticSearch` itself does NOT expose a public `embed()` — access goes via its injected `embeddingService`.** |
| `storage.updateEntity(name, Partial<Entity>)` | EXISTS | `src/core/GraphStorage.ts:647` (JSONL), parallel in `SQLiteStorage` |
| `storage.events` on `GraphStorage` | EXISTS | `GraphStorage.events` getter — **`ManagerContext` itself has NO `events` getter; always route via `ctx.storage.events`** |
| Existing event union | CLOSED | `GraphEvent` is a discriminated union at `src/types/types.ts:1917`; does NOT accept new event types without extension |
| Semantic-similarity duplicate detection | EXISTS | `SemanticForget` two-tier (exact → 0.85 semantic fallback) v1.8.0 |
| Batch duplicate detection | EXISTS | `CompressionManager.findDuplicates()` uses Levenshtein + Jaccard |
| Entity create events | EXISTS | `storage.appendEntity()` fires `entity:created` synchronously; listener errors caught + logged by default (`GraphEventEmitter.invokeListener` `suppressListenerErrors = true`) |
| Write-time three-tier dedup with PRD tier definitions | MISSING | Existing dedup is batch-oriented |
| Auto-importance scoring on write | MISSING | `SalienceEngine.calculateSalience` is retrieval-context scoring, not intrinsic-content scoring |
| Per-session `MemoryEngine` facade | MISSING |
| `sessionId` column in SQLite | MISSING | `AgentEntity.sessionId` is a TypeScript field serialized into JSON blobs, NOT a SQL column. Session-scoped queries cannot use an SQL index today |

**Implication:** This spec is composition + one small scorer + minimal type additions — not new storage plumbing.

## Architecture

### Minimal type changes

One additive optional field on `Entity` (matches existing `tags`, `importance`, `projectId` pattern):

```typescript
// src/types/types.ts
export interface Entity {
  // ... existing fields ...
  /** SHA-256 of raw (pre-role-prefix) content. Populated by MemoryEngine. */
  contentHash?: string;
}
```

Role is stored as an **observation text prefix** (`[role=user] ...`) — no new `role` field on `Entity`. Rationale: keeps `Entity` schema stable, avoids Zod migration, matches how conversation metadata is encoded in memoryjs today.

### SQLite schema migration

Add one column + one index, following the exact idempotency pattern at `SQLiteStorage.migrateEntitiesTable` (`src/core/SQLiteStorage.ts:272`):

```typescript
// Inside migrateEntitiesTable(), guarded by PRAGMA:
const columnInfo = this.db.pragma('table_info(entities)') as Array<{ name: string }>;
const columnNames = new Set(columnInfo.map((c) => c.name));

if (!columnNames.has('contentHash')) {
  this.db.prepare(`ALTER TABLE entities ADD COLUMN contentHash TEXT`).run();
}
```

The index belongs in `createTables()` alongside the existing `idx_entities_*` indexes (lines 183–202), not in the migration step:

```sql
CREATE INDEX IF NOT EXISTS idx_entities_content_hash ON entities(contentHash);
```

**No `sessionId` column migration.** Session isolation is enforced in TypeScript (post-SQL filter), not SQL. For sessions with < ~1K turns this is acceptable. Future optimization possible via separate spec.

JSONL handles the new optional field via object-spread serialization (no migration needed).

### New class: `MemoryEngine`

**Location:** `src/agent/MemoryEngine.ts`
**Approx size:** ~300 lines including JSDoc.

```typescript
import type { IGraphStorage } from '../types/types.js';
import type { AgentEntity } from '../types/agent-memory.js';
import { SQLiteStorage } from '../core/SQLiteStorage.js';
import { EpisodicMemoryManager } from './EpisodicMemoryManager.js';
import { WorkingMemoryManager } from './WorkingMemoryManager.js';
import { EntityManager } from '../core/EntityManager.js';
import { SemanticSearch } from '../search/SemanticSearch.js';
import { EmbeddingService } from '../search/EmbeddingService.js';
import { ImportanceScorer } from './ImportanceScorer.js';
import { EventEmitter } from 'node:events';

export interface MemoryEngineConfig {
  jaccardThreshold?: number;        // PRD default 0.72
  prefixOverlapThreshold?: number;  // PRD default 0.50
  dedupScanWindow?: number;         // default 200
  maxTurnsPerSession?: number;      // default 1000
  semanticDedupEnabled?: boolean;   // default false
  semanticThreshold?: number;       // default 0.92
  recentTurnsForImportance?: number; // default 10
}

export interface AddTurnOptions {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  agentId?: string;
  projectId?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  queryContext?: string;
  recentTurns?: string[];
}

export type DedupTier = 'exact' | 'prefix' | 'jaccard' | 'semantic';

export interface AddTurnResult {
  entity: AgentEntity;
  duplicateDetected: boolean;
  duplicateOf?: string;
  duplicateTier?: DedupTier;
  importanceScore: number;
}

export type MemoryEngineEventName =
  | 'memoryEngine:turnAdded'
  | 'memoryEngine:duplicateDetected'
  | 'memoryEngine:sessionDeleted';

export class MemoryEngine {
  public readonly events = new EventEmitter();

  constructor(
    private readonly storage: IGraphStorage,
    private readonly entityManager: EntityManager,
    private readonly episodicMemory: EpisodicMemoryManager,
    private readonly workingMemory: WorkingMemoryManager,
    private readonly importanceScorer: ImportanceScorer,
    private readonly semanticSearch?: SemanticSearch,
    private readonly embeddingService?: EmbeddingService,
    private readonly config: MemoryEngineConfig = {}
  ) {
    if (config.semanticDedupEnabled && !semanticSearch) {
      throw new TypeError(
        'MemoryEngine: semanticDedupEnabled=true requires a SemanticSearch instance'
      );
    }
  }

  async addTurn(content: string, options: AddTurnOptions): Promise<AddTurnResult>;
  async getSessionTurns(
    sessionId: string,
    options?: { limit?: number; role?: 'user' | 'assistant' | 'system' }
  ): Promise<AgentEntity[]>;
  async checkDuplicate(
    content: string,
    sessionId: string
  ): Promise<{ isDuplicate: boolean; match?: AgentEntity; tier?: DedupTier }>;
  async deleteSession(sessionId: string): Promise<{ deleted: number }>;
  async listSessions(): Promise<string[]>;
}
```

**Event emitter choice:** `MemoryEngine` uses a **separate `node:events` `EventEmitter`** instance (exposed as `memoryEngine.events`) rather than the shared `GraphEventEmitter`. Rationale: `GraphEvent` in `src/types/types.ts:1917` is a closed discriminated union of the 9 existing graph-lifecycle events. Adding `memoryEngine:*` events to that union would expand its scope beyond graph-mutation events and force every `GraphEventListener` to handle them.

**Note on event dispatch semantics:**
- `storage.events` (`GraphEventEmitter`): synchronous; listener errors swallowed + logged by default.
- `memoryEngine.events` (`node:events`): synchronous; listener errors propagate by default. Consumers should wrap listeners if they want fault isolation. Documented on the public `events` field.

### Framing note: composition, not replacement

`MemoryEngine` does not replace `EpisodicMemoryManager`. It composes: every non-duplicate write ultimately calls `episodicMemory.createEpisode(content, { sessionId, importance, agentId })`. That call flows to `storage.appendEntity()` (not `entityManager.createEntities` — different code path), which fires the existing `entity:created` event synchronously. The engine adds three things:

1. Three-tier dedup before the write.
2. `contentHash` population + optional embedding storage after the write.
3. `memoryEngine:*` event emission via the separate emitter.

Callers who don't need dedup/scoring continue using `EpisodicMemoryManager` directly.

### New class: `ImportanceScorer`

**Location:** `src/agent/ImportanceScorer.ts`
**Approx size:** ~140 lines.

Rationale for a new class (not a `SalienceEngine` method): `SalienceEngine.calculateSalience` is retrieval-time context-aware scoring — reads `accessCount`, `lastAccessedAt`, caller-supplied context weights. Intrinsic creation-time scoring is a different operation with different inputs (raw content + recent turns). Mixing them in one class violates single responsibility.

```typescript
export interface ImportanceScorerConfig {
  domainKeywords?: Set<string>;
  lengthWeight?: number;   // default 0.30
  keywordWeight?: number;  // default 0.40
  overlapWeight?: number;  // default 0.30
}

export interface ScoreOptions {
  queryContext?: string;
  recentTurns?: string[];
}

export class ImportanceScorer {
  constructor(private readonly config: ImportanceScorerConfig = {}) {}
  score(content: string, options?: ScoreOptions): number;
}
```

**Formula:**

```
overlap_corpus = (queryContext ? [queryContext] : []) ∪ (recentTurns ?? [])

length_signal  = log10(max(content.length, 1)) / log10(10000)
keyword_signal = |content_tokens ∩ domain_keywords| / max(|domain_keywords|, 1)

if overlap_corpus.length > 0:
    corpus_tokens  = tokens(join(overlap_corpus, ' '))
    overlap_signal = |content_tokens ∩ corpus_tokens| / max(|content_tokens|, 1)
else:
    overlap_signal = 0.5    // neutral prior

raw        = lengthWeight * length_signal + keywordWeight * keyword_signal + overlapWeight * overlap_signal
importance = clamp(0, 10, Math.round(raw * 10))
```

### Dedup: three tiers aligned to PRD MEM-03

```
Tier 1 (exact equality, PRD narrowing):
  • Fast-path: SELECT name FROM entities WHERE contentHash = ? (SQLite index hit)
    then post-filter in TypeScript: candidates.filter(e => e.sessionId === sessionId)
  • JSONL-path: scan in-memory cache for entities where entity.contentHash === hash
    AND entity.sessionId === sessionId
  • Design note: PRD MEM-03 calls Tier 1 "exact containment" (substring containment).
    We narrow to "exact equality" because:
      - SHA-256 index gives O(1) equality; substring containment cannot
      - Substring containment over N turns of L chars is O(N·L), dominating Tier 2/3
      - Paraphrased duplicates are caught at Tier 3 (Jaccard)
    Deliberate narrowing — documented here so reviewers don't assume PRD drift.

Tier 2 (50% prefix overlap — matches PRD verbatim): O(n) over dedupScanWindow
  For each recent turn T in session (role prefix stripped):
    shared = longest_common_prefix(content, T.content)
    ratio  = length(shared) / max(length(content), length(T.content))
    if ratio >= 0.50 → duplicate

Tier 3 (Jaccard ≥ 0.72 — matches PRD verbatim): O(n) over dedupScanWindow
  For each recent turn T in session (role prefix stripped):
    jaccard = |tokens(content) ∩ tokens(T.content)| / |tokens(content) ∪ tokens(T.content)|
    if jaccard >= 0.72 → duplicate
```

**Tier 1 is session-scoped.** Cross-session Tier 1 dedup intentionally NOT supported. Callers wanting global dedup should use `CompressionManager.findDuplicates` batch-style.

**contentHash is computed from raw content (no role prefix).** `entity.observations[0]` equals `[role=${role}] ${content}` but `contentHash = sha256(content)` (raw). Tokens also stripped of role prefix at Tier 2/3 to match.

**Optional tier "semantic"** (not in PRD, opt-in flag):
When `config.semanticDedupEnabled === true` AND `semanticSearch` is provided, run a primary-path semantic check using `semanticSearch.search()`. Tier order becomes: `semantic → exact → prefix → jaccard`. First hit wins; remaining tiers short-circuit. `semanticDedupEnabled=true` without `semanticSearch` throws at **construction**, not on first call.

### Storage flow for `addTurn`

```typescript
// Inside addTurn, after dedup passes:

// 1. Compute auto-importance with recent turns
const recentTurns = options.recentTurns
  ?? (await this.workingMemory.getRecent(options.sessionId, this.config.recentTurnsForImportance ?? 10))
    .map(e => stripRolePrefix(e.observations[0] ?? ''));
const importance = options.importance
  ?? this.importanceScorer.score(content, {
    queryContext: options.queryContext,
    recentTurns,
  });

// 2. Create episode (existing path — fires entity:created via storage.appendEntity)
const observation = `[role=${options.role}] ${content}`;
const entity = await this.episodicMemory.createEpisode(observation, {
  sessionId: options.sessionId,
  agentId: options.agentId,
  importance,
});

// 3. Populate contentHash via existing updateEntity API
const hash = sha256(content);  // raw content, not role-prefixed
await this.storage.updateEntity(entity.name, { contentHash: hash });

// 4. Optional embedding via SQLiteStorage.storeEmbedding (narrow)
if (this.embeddingService && this.storage instanceof SQLiteStorage) {
  const vector = await this.embeddingService.embed(content);
  const model = this.embeddingService.getModelName();
  this.storage.storeEmbedding(entity.name, vector, model);
}

// 5. Fire engine-specific event (separate emitter — sync, errors propagate)
this.events.emit('memoryEngine:turnAdded', {
  entity, sessionId: options.sessionId, role: options.role, importance,
});
```

**Embedding-path caveat:** `SQLiteStorage.storeEmbedding` is backend-specific; `IGraphStorage` does not declare it. Embeddings in JSONL mode are a deferred concern. The `instanceof SQLiteStorage` narrow mirrors existing call sites in `SemanticSearch`.

### Wiring into `ManagerContext`

Lazy getter. Events route via `ctx.storage.events` (the `ManagerContext` has no `events` property of its own — verified at `src/core/ManagerContext.ts:282` which uses `this.storage.events`). `MemoryEngine`'s own separate emitter is accessed as `ctx.memoryEngine.events`.

```typescript
// src/core/ManagerContext.ts additions

private _memoryEngine?: MemoryEngine;

get memoryEngine(): MemoryEngine {
  if (!this._memoryEngine) {
    const agent = this.agentMemory();  // cached on _agentMemory
    const importanceScorer = new ImportanceScorer({
      lengthWeight: envFloat('MEMORY_ENGINE_LENGTH_WEIGHT', 0.30),
      keywordWeight: envFloat('MEMORY_ENGINE_KEYWORD_WEIGHT', 0.40),
      overlapWeight: envFloat('MEMORY_ENGINE_OVERLAP_WEIGHT', 0.30),
    });
    const semanticSearch = this.semanticSearch ?? undefined;
    const embeddingService = semanticSearch?.['embeddingService'] as EmbeddingService | undefined;
    this._memoryEngine = new MemoryEngine(
      this.storage,
      this.entityManager,
      agent.episodicMemory,
      agent.workingMemory,
      importanceScorer,
      semanticSearch,
      embeddingService,
      {
        jaccardThreshold: envFloat('MEMORY_ENGINE_JACCARD_THRESHOLD', 0.72),
        prefixOverlapThreshold: envFloat('MEMORY_ENGINE_PREFIX_OVERLAP', 0.50),
        dedupScanWindow: envInt('MEMORY_ENGINE_DEDUP_SCAN_WINDOW', 200),
        maxTurnsPerSession: envInt('MEMORY_ENGINE_MAX_TURNS_PER_SESSION', 1000),
        semanticDedupEnabled: envBool('MEMORY_ENGINE_SEMANTIC_DEDUP', false),
        semanticThreshold: envFloat('MEMORY_ENGINE_SEMANTIC_THRESHOLD', 0.92),
        recentTurnsForImportance: envInt('MEMORY_ENGINE_RECENT_TURNS', 10),
      }
    );
  }
  return this._memoryEngine;
}
```

**Caveat on initialization order:** Accessing `ctx.memoryEngine` eagerly instantiates `ctx.agentMemory()` with default config. Callers who need a custom `AgentMemoryConfig` must call `ctx.agentMemory(config)` before `ctx.memoryEngine`.

**Embedding service access:** Retrieved via `semanticSearch['embeddingService']` indexed access. This matches how memoryjs currently routes embeddings internally (verified at `src/search/SemanticSearch.ts:156`). A dedicated `public getEmbeddingService(): EmbeddingService` accessor on `SemanticSearch` is a minor follow-up worth adding during implementation — not a blocker.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MEMORY_ENGINE_JACCARD_THRESHOLD` | `0.72` | Tier 3 threshold (PRD MEM-03) |
| `MEMORY_ENGINE_PREFIX_OVERLAP` | `0.50` | Tier 2 threshold (PRD MEM-03) |
| `MEMORY_ENGINE_DEDUP_SCAN_WINDOW` | `200` | Max recent turns scanned for tiers 2/3 |
| `MEMORY_ENGINE_MAX_TURNS_PER_SESSION` | `1000` | Archival trigger |
| `MEMORY_ENGINE_SEMANTIC_DEDUP` | `false` | Enable semantic tier (requires embedding provider) |
| `MEMORY_ENGINE_SEMANTIC_THRESHOLD` | `0.92` | Cosine threshold for semantic tier |
| `MEMORY_ENGINE_LENGTH_WEIGHT` | `0.30` | ImportanceScorer weight |
| `MEMORY_ENGINE_KEYWORD_WEIGHT` | `0.40` | ImportanceScorer weight |
| `MEMORY_ENGINE_OVERLAP_WEIGHT` | `0.30` | ImportanceScorer weight |
| `MEMORY_ENGINE_RECENT_TURNS` | `10` | Recent-turn count passed to ImportanceScorer for MEM-02 |

No collisions with existing env vars in `CLAUDE.md`.

## Events (emitted on `memoryEngine.events`, separate from `GraphEventEmitter`)

| Event | Payload | When |
|---|---|---|
| `memoryEngine:turnAdded` | `{ entity: AgentEntity; sessionId: string; role: 'user'\|'assistant'\|'system'; importance: number }` | New non-duplicate turn written |
| `memoryEngine:duplicateDetected` | `{ existingEntity: AgentEntity; attemptedContent: string; sessionId: string; tier: DedupTier }` | Dedup tier fires |
| `memoryEngine:sessionDeleted` | `{ sessionId: string; deletedCount: number }` | `deleteSession()` completes |

These are independent of `entity:created` / `entity:updated` events that fire on `storage.events` (those continue to fire normally as a side effect of `episodicMemory.createEpisode` → `storage.appendEntity`).

## Testing

### Unit tests (`tests/unit/agent/`)

**`MemoryEngine.test.ts` (~28 tests):**
- `addTurn` creates entity with `sessionId`/`importance`/role-prefixed observation
- `addTurn` populates `contentHash` via `storage.updateEntity`
- Tier 1 exact equality: same raw content in same session → duplicate
- Tier 1 does NOT fire across sessions
- Tier 2 50% prefix overlap: fires; short-circuits tier 3
- Tier 3 Jaccard 0.72: fires when token overlap high but prefix differs
- Tier short-circuit: tier 1 hit skips tiers 2/3
- `semanticDedupEnabled=true` fires semantic first; disabled path never touches semanticSearch
- `semanticDedupEnabled=true` without `semanticSearch` → throws at construction
- `importance` option override respected
- `duplicateTier` field accurately reflects which tier fired
- `recentTurns` option overrides auto-fetched list
- `queryContext` is added to overlap corpus alongside recent turns
- `getSessionTurns` filters by role
- `deleteSession` removes all session turns; fires `memoryEngine:sessionDeleted`
- `listSessions` enumerates correctly
- Events fire on `memoryEngine.events` with correct payloads and field names
- Listener exceptions on the new emitter propagate (test via try/catch around `addTurn`)
- Multi-session isolation (session A's turn is NOT a dedup candidate for session B)
- `contentHash` is over raw content, not role-prefixed content

**`ImportanceScorer.test.ts` (~12 tests):**
- Returns integer in [0, 10]
- Log-scaled length: 100-char vs 10k-char content produces meaningfully different scores
- Keyword signal contributes (test with/without domain word)
- `recentTurns` overlap is computed (PRD MEM-02 compliance test)
- `queryContext` alone contributes
- `queryContext + recentTurns` combine (union of tokens)
- No overlap corpus → `overlap_signal = 0.5`
- Deterministic: identical input → identical output
- Weight-sum behaviour when weights sum > 1 (no crash, clamped to [0,10])

### Integration tests (`tests/integration/`)

- JSONL roundtrip: `addTurn` → close ctx → reopen → `getSessionTurns` returns turn; `contentHash` present
- SQLite roundtrip: same + `contentHash` column populated; index used
- Migration (pre-v1.11.0 SQLite DB): `migrateEntitiesTable()` adds `contentHash` idempotently; re-run is safe
- 100-turn session: P95 of `addTurn` < 50ms without semantic dedup
- Embedding-aware write: when `embeddingService` is wired, embedding goes into `embeddings` sidecar table (verified via `storage.getEmbedding`), NOT a new `entities` column
- `EntitySchema` (Zod) continues to validate entities that have `contentHash`

### Regression gate

All **5,759 existing tests** (memoryjs v1.10.0 baseline) must continue to pass.

## Error handling

- Storage read failure during dedup check → surface the error (don't silently skip to write)
- Invalid `role` → Zod rejection on Entity creation (existing `EntitySchema` unaffected; role is in the observation text, not a schema field)
- `semanticDedupEnabled=true` but no `semanticSearch` → throw at `MemoryEngine` construction
- Duplicate detected → NOT an error. Returns existing entity with `duplicateDetected: true`.
- `deleteSession` on unknown session → NOT an error. Returns `{ deleted: 0 }`.

## Performance targets

| Operation | Target | Assumption |
|---|---|---|
| `addTurn` end-to-end | P95 < 50ms | Session < 1,000 turns, no semantic tier |
| `addTurn` with semantic dedup | P95 < 200ms | Includes embedding generation |
| `checkDuplicate` (no write) | P95 < 30ms | |
| `getSessionTurns(limit=50)` | P95 < 20ms | |
| Tier 1 hit on SQLite | < 1ms | contentHash index + small post-filter |
| Tier 2/3 scan | Bounded by `dedupScanWindow` (default 200) | |

## Success criteria

- [ ] `MemoryEngine` class implemented matching the public surface above
- [ ] `ImportanceScorer` class implemented; `recentTurns` overlap verified (MEM-02)
- [ ] `contentHash` field added to `Entity` type in `src/types/types.ts`
- [ ] `contentHash` column added via idempotent `migrateEntitiesTable()` update (PRAGMA-guarded)
- [ ] `idx_entities_content_hash` created in `createTables()` alongside existing indexes
- [ ] JSONL field round-trips (`contentHash` present after close/reopen)
- [ ] `ManagerContext.memoryEngine` lazy getter wired; MemoryEngine has its own emitter (separate from `storage.events`)
- [ ] Three dedup tiers: Tier 1 equality (narrowed from PRD "containment" with rationale), Tier 2 50% prefix, Tier 3 Jaccard 0.72 — verified by name in tests
- [ ] Events fire synchronously on `memoryEngine.events`; payload TypeScript types exported and match the Events table
- [ ] All 5,759 existing tests pass (regression-proof — fixture run before/after)
- [ ] ~40 new tests added (unit + integration) — exact count documented in CHANGELOG entry
- [ ] `npm run typecheck` clean
- [ ] `CHANGELOG.md` v1.11.0 entry added
- [ ] Companion-spec cross-links resolve as relative paths (validated by markdown linter)

## Open questions (non-blocking)

1. Should `getSessionTurns` live on `MemoryEngine` or on `EpisodicMemoryManager`? **Decision: both** — `MemoryEngine` delegates; single-facade convenience is worth the duplication.
2. Should the role prefix be a full observation-level field instead of a text prefix? **Decision: text prefix** (no schema change, simpler rollback). Revisit if filtering cost proves measurable.
3. Should `contentHash` be over raw or role-prefixed content? **Decision: raw content** so `[role=user] hi` and `[role=assistant] hi` collide at Tier 1 within a session.
4. Should `SemanticSearch` expose a `public embed()` delegate? **Decision: follow-up during implementation**; bracket-access `['embeddingService']` works and mirrors existing patterns.

## Dependencies

- **Hard:** none (this spec ships first)
- **Blocks:** Companion Decay Extensions spec (`SQLiteBackend.add()` will compose `MemoryEngine.addTurn`)

## Next steps after approval

1. Implementation plan via `superpowers:writing-plans` skill → `docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md`
2. Implementation via `superpowers:subagent-driven-development` skill
3. PR review via `pr-review-toolkit`
4. Merge into master; release as v1.11.0
5. Companion Decay Extensions spec implementation (separate later release, v1.12.0)
