# Design: Memory Engine Decay Extensions

**Date:** 2026-04-16
**Status:** Approved (post-review fixes applied), not yet implemented
**Target branch:** `feature/memory-engine-decay-extensions`
**Target version:** v1.12.0 (next minor after Memory Engine Core ships as v1.11.0)
**Supersedes:** portion of `_archived-2026-04-16-context-engine-memory-engine-design.md`
**Companion spec:** `2026-04-16-memory-engine-core-design.md` (ships first)
**Related:**
- `docs/roadmap/CONTEXT_ENGINE_PRD 2.md` §8 (decay formula, MEM-01, MEM-04)
- `docs/roadmap/CONTEXT_ENGINE_PRD 2.md` §3 GOAL-03 (exponential memory decay with configurable parameters)
- `docs/roadmap/CONTEXT_ENGINE_WHITEPAPER 2.md`
- Parent: Context Engine decomposition (Sub-feature #3b)

Patch-bump (v1.11.1) is intentionally NOT chosen because this spec adds public API surface (new `DecayEngineConfig` fields, a new public method, a new interface, two new exported classes, new env vars) — those require a minor bump per semver.

## Goal

Extend memoryjs's decay system to match the Context Engine PRD formula exactly, and introduce the PRD's `IMemoryBackend` interface as a thin adapter layer over existing memoryjs storage — without altering the semantics of existing decay callers. Ships after Memory Engine Core.

Covers PRD `MEM-01` (decay parameters), `MEM-04` (backend interface), PRD §3 `GOAL-03` (configurable exponential decay), and the deferred PRD importance-range `[1.0, 3.0]` mapping that the Core spec leaves for this spec.

## Non-Goals

- Breaking change to `DecayEngine.calculateEffectiveImportance` — existing method's semantics preserved. New behaviour is opt-in via a separate method.
- Replacing `IGraphStorage` — the new `IMemoryBackend` is an adapter, not a replacement.
- `PostgreSQLBackend` / `VectorMemoryBackend` (PRD `MEM-05`, `MEM-06`) — out of scope.
- Write-path dedup / turn ingestion — companion Core spec.
- Embeddings generation — reused from existing `EmbeddingService` + `SQLiteStorage.storeEmbedding`.

## PRD Alignment

| PRD ID | Requirement (verbatim from PRD §8) | This spec |
|---|---|---|
| `MEM-01` | "All decay parameters (`decay_rate`, `freshness_coefficient`, `relevance_weight`, `min_importance_threshold`) configurable per instance" | New `DecayEngineConfig` fields + new method |
| `MEM-04` | "Storage backend interface with `InMemoryBackend` (default) and `SQLiteBackend` (persistent). Identical `add()` / `get_weighted()` API" | New `IMemoryBackend` + two adapters |

PRD decay formula (PRD §8 "Decay Formula Components" block, lines 395–402):

```
effective = importance × recency × freshness + relevance_boost

recency         = e^(−decay_rate × age_seconds)
freshness       = e^(−0.01 × seconds_since_last_access)       // freshness_coefficient configurable
relevance_boost = (|query_tokens ∩ turn_tokens| / |query|) × 0.35   // relevance_weight configurable
importance      = auto_score(content)  range: [1.0, 3.0]
```

### PRD importance range [1.0, 3.0] — owned here

The Core spec's `ImportanceScorer` emits memoryjs's native `[0, 10]` integer scale. Mapping to PRD's [1.0, 3.0] range is owned by this spec and implemented in the new method via explicit scaling:

```
prd_importance = 1.0 + (memoryjs_importance / 10.0) * 2.0    // maps 0..10 → 1..3
```

Worked example (§"Data Flow" below) shows concrete numbers.

### Legacy vs PRD formula comparison

memoryjs current formula (verified at `src/agent/DecayEngine.ts:231` method signature, formula at `:263`):

```
effective = base_importance × decay_factor × strength_multiplier × confidence_factor
```

Differences from PRD:
- `decay_factor` is exponential decay on age — maps 1:1 to PRD `recency` if parameterised by `decay_rate` (instead of `halfLifeHours`).
- `strength_multiplier` (confirmations × 0.1 + access × 0.01) is NOT PRD `freshness` (which is specifically time-since-last-access).
- `confidence_factor` has no PRD counterpart.
- PRD's `freshness` and `relevance_boost` have no memoryjs counterpart.
- `FreshnessManager` is instantiated inside `DecayEngine` (at `src/agent/DecayEngine.ts:113`) but is NOT called from `calculateEffectiveImportance`. The PRD `freshness` term therefore requires new computation (done inline in `calculatePrdEffectiveImportance`).

### Approach

Rather than replacing the existing formula (breaking change to every decay caller), add a new **parallel** method:

```typescript
class DecayEngine {
  // EXISTING — unchanged, keeps strength_multiplier + confidence_factor
  calculateEffectiveImportance(entity: AgentEntity): number;

  // NEW — PRD-aligned formula, used by MemoryEngine weighted-retrieval path
  calculatePrdEffectiveImportance(
    entity: AgentEntity,
    queryContext?: { tokens: string[] }
  ): number;
}
```

Existing memoryjs consumers (`DecayScheduler`, `SearchManager`, `SemanticForget`, etc.) continue using `calculateEffectiveImportance`. The Memory Engine uses `calculatePrdEffectiveImportance` when `queryContext` is available.

## Codebase Integration Summary

Verified by direct file reads (line numbers current as of v1.10.0):

| Area | Status | Evidence |
|------|--------|----------|
| Exponential decay formula | EXISTS | `DecayEngine.calculateDecayFactor()` at `src/agent/DecayEngine.ts:138` — `Math.exp(-Math.LN2/halfLife * ageHours)` |
| Half-life configuration | EXISTS | `DecayEngineConfig.halfLifeHours` (default 168) |
| `FreshnessManager` | EXISTS | `src/features/FreshnessManager.ts` — TTL + confidence |
| `freshnessManager` instantiated inside `DecayEngine` | EXISTS | `src/agent/DecayEngine.ts:113` — **but NOT used in `calculateEffectiveImportance`** |
| `strength_multiplier` | EXISTS | `src/agent/DecayEngine.ts:210` |
| `confidence_factor` in decay | EXISTS | Applied inside `calculateEffectiveImportance` when `applyConfidenceToImportance = true` |
| Current `DecayEngineConfig` fields | EXISTS | At `src/agent/DecayEngine.ts:23-50` — actual fields: `halfLifeHours`, `importanceModulation`, `accessModulation`, `minImportance`, `ttlExpiredDecayMultiplier`, `confidenceDecayRate`, `applyConfidenceToImportance`. **There is NO `enabled` field.** |
| `decay_rate` param (PRD name) | MISSING | Currently only `halfLifeHours`; `decay_rate = ln(2) / (halfLifeHours * 3600)` |
| `freshness_coefficient` param | MISSING | PRD default 0.01 |
| `relevance_weight` param | MISSING | PRD default 0.35 |
| `min_importance_threshold` param | PARTIAL | `minImportance` exists but used as a clamp, not a filter threshold |
| `IMemoryBackend` interface + two adapters | MISSING | |
| `sessionId` as SQL column | MISSING | Serialized as JSON blob; no SQL index. Session-scoped DELETE cannot use an index today |
| `deleteEntitiesBySessionId` method on storage | MISSING | |

## Architecture

### Part 1: Extended `DecayEngine` config

The real current `DecayEngineConfig` (`src/agent/DecayEngine.ts:23-50`):

```typescript
// EXISTING (do not change):
export interface DecayEngineConfig {
  halfLifeHours?: number;
  importanceModulation?: boolean;
  accessModulation?: boolean;
  minImportance?: number;
  ttlExpiredDecayMultiplier?: number;
  confidenceDecayRate?: number;
  applyConfidenceToImportance?: boolean;
}
```

Extended config (additive):

```typescript
export interface DecayEngineConfig {
  // ==== existing (preserved) ====
  halfLifeHours?: number;
  importanceModulation?: boolean;
  accessModulation?: boolean;
  minImportance?: number;
  ttlExpiredDecayMultiplier?: number;
  confidenceDecayRate?: number;
  applyConfidenceToImportance?: boolean;

  // ==== new (PRD MEM-01) ====
  /** PRD decay_rate: exponential decay rate per second for the recency term.
   *  When absent, derived from halfLifeHours: ln(2) / (halfLifeHours * 3600). */
  decayRate?: number;

  /** PRD freshness_coefficient: exponential coefficient for the freshness term.
   *  Default 0.01 (per second since last access). */
  freshnessCoefficient?: number;

  /** PRD relevance_weight: scaling factor for the relevance_boost term.
   *  Default 0.35. */
  relevanceWeight?: number;

  /** PRD min_importance_threshold: filter threshold for inclusion in context assembly.
   *  Entities with effective importance below this are pruned at retrieval time.
   *  DISTINCT from the existing `minImportance` clamp floor — see env-var naming
   *  comparison table below. Default 0.1. */
  minImportanceThreshold?: number;
}
```

### Part 2: New method `calculatePrdEffectiveImportance`

```typescript
/**
 * Calculate effective importance using the Context Engine PRD formula.
 *
 * Formula: effective = importance × recency × freshness + relevance_boost
 *   recency         = e^(−decay_rate × age_seconds)
 *   freshness       = e^(−freshness_coefficient × seconds_since_last_access)
 *   relevance_boost = (|query_tokens ∩ turn_tokens| / |query|) × relevance_weight
 *
 * `importance` is auto-scaled from memoryjs's [0,10] range to PRD's [1.0, 3.0]
 * range via: prd_importance = 1.0 + (memoryjs_importance / 10.0) * 2.0
 *
 * Distinct from `calculateEffectiveImportance` (legacy formula preserved
 * for existing callers: DecayScheduler, SearchManager, SemanticForget).
 *
 * @param entity - AgentEntity to score
 * @param queryContext - Optional; enables relevance_boost term
 * @returns Float in [0, ∞). Callers filter via `minImportanceThreshold`.
 */
calculatePrdEffectiveImportance(
  entity: AgentEntity,
  queryContext?: { tokens: string[] }
): number;
```

**Implementation notes:**

```typescript
// entity.createdAt and entity.lastAccessedAt are ISO 8601 STRINGS — not timestamps.
// Must parse via new Date(...).getTime() before arithmetic.

const now = Date.now();
const createdMs = entity.createdAt ? new Date(entity.createdAt).getTime() : now;
const lastAccessMs = entity.lastAccessedAt
  ? new Date(entity.lastAccessedAt).getTime()
  : createdMs;

const ageSec = (now - createdMs) / 1000;
const lastAccessSec = (now - lastAccessMs) / 1000;

const memoryjsImportance = entity.importance ?? 5;
const prdImportance = 1.0 + (memoryjsImportance / 10.0) * 2.0;   // [1.0, 3.0]

const decayRate = this.config.decayRate
  ?? Math.LN2 / ((this.config.halfLifeHours ?? 168) * 3600);
const freshnessCoef = this.config.freshnessCoefficient ?? 0.01;
const relevanceWeight = this.config.relevanceWeight ?? 0.35;

const recency = Math.exp(-decayRate * ageSec);
const freshness = Math.exp(-freshnessCoef * lastAccessSec);

let relevanceBoost = 0;
if (queryContext && queryContext.tokens.length > 0) {
  // Tokens come from the entity's first observation WITH role prefix stripped
  // (Core spec encodes turns as `[role=${role}] ${content}`).
  const obsRaw = entity.observations[0] ?? '';
  const content = obsRaw.replace(/^\[role=[a-z]+\]\s*/i, '');
  const turnTokens = tokenise(content);
  const intersection = new Set(queryContext.tokens.filter(t => turnTokens.has(t)));
  relevanceBoost = (intersection.size / queryContext.tokens.length) * relevanceWeight;
}

return prdImportance * recency * freshness + relevanceBoost;
```

**Worked example** (grounds the 0.1 default threshold):

- Entity with `importance = 5` (memoryjs default), created 1 hour ago, accessed 5 minutes ago.
- Query overlap: `|q ∩ t| / |q| = 0.4`
- `prd_importance = 1.0 + 5/10 * 2.0 = 2.0`
- `recency = exp(-(ln 2 / (168×3600)) × 3600) ≈ 0.996`
- `freshness = exp(-0.01 × 300) ≈ 0.050`
- `relevance_boost = 0.4 × 0.35 = 0.14`
- `effective = 2.0 × 0.996 × 0.050 + 0.14 ≈ 0.240`
- Passes threshold of 0.1 → included.

Same entity accessed 1 hour ago instead: `freshness ≈ e^(-36) ≈ 2.3e-16` → effective ≈ 0.14 → still passes because of relevance_boost. Without query overlap, it would be ≈ 4.6e-16 → below threshold → pruned.

### Part 3: Env vars — with naming-collision disambiguation

| New variable | Default | Maps to |
|---|---|---|
| `MEMORY_DECAY_RATE` | derived from `halfLifeHours` | `decayRate` |
| `MEMORY_FRESHNESS_COEFFICIENT` | `0.01` | `freshnessCoefficient` |
| `MEMORY_RELEVANCE_WEIGHT` | `0.35` | `relevanceWeight` |
| `MEMORY_PRD_MIN_IMPORTANCE_THRESHOLD` | `0.1` | `minImportanceThreshold` |

**Env var `minImportance*` disambiguation table** (prevents operator confusion):

| Variable | Config field | Role |
|---|---|---|
| `MEMORY_DECAY_MIN_IMPORTANCE` (existing) | `minImportance` | Clamp floor — `calculateEffectiveImportance` never returns below this |
| `MEMORY_PRD_MIN_IMPORTANCE_THRESHOLD` (new) | `minImportanceThreshold` | Retrieval filter — `MemoryBackend.get_weighted` prunes entries scoring below this |

The new variable uses the `PRD_` prefix to signal it is aligned to the Context Engine PRD, not to the existing decay clamp.

### Part 4: `IMemoryBackend` interface + two adapters

```typescript
// src/agent/MemoryBackend.ts

export interface MemoryTurn {
  id: string;
  sessionId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  importance: number;
  createdAt: string;
  lastAccessedAt?: string;
  accessCount?: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface IMemoryBackend {
  /** PRD MEM-04: persist a turn. `turn.sessionId` is authoritative. */
  add(turn: MemoryTurn): Promise<void>;

  /**
   * PRD MEM-04: return turns in weighted-by-decay order.
   * Uses DecayEngine.calculatePrdEffectiveImportance.
   */
  get_weighted(
    query: string,
    sessionId: string,
    options?: { limit?: number; threshold?: number }
  ): Promise<Array<{ turn: MemoryTurn; score: number }>>;

  delete_session(sessionId: string): Promise<void>;

  list_sessions(): Promise<string[]>;
}
```

Note: `sessionId` is NOT a separate parameter on `add()` — it is already on `MemoryTurn`. Redundant parameters were removed during review.

#### `InMemoryBackend`

Ephemeral, process-lifetime only. Uses an in-process `Map<sessionId, MemoryTurn[]>`. No storage persistence. Default when no persistent backend is available.

```typescript
export class InMemoryBackend implements IMemoryBackend {
  private turns = new Map<string, MemoryTurn[]>();
  constructor(private readonly decayEngine: DecayEngine) {}
  // ... methods
}
```

#### `SQLiteBackend`

Wraps an existing `SQLiteStorage` + `MemoryEngine` (from Core spec):

```typescript
export interface SQLiteBackendOptions {
  /** When true, call MemoryEngine.addTurn (runs dedup + events). Default true. */
  dedupOnAdd?: boolean;
  /** When true, preserve caller's turn.id / turn.createdAt by writing them
   *  onto the entity post-creation. Default false (engine-generated names win). */
  preserveCallerIds?: boolean;
}

export class SQLiteBackend implements IMemoryBackend {
  constructor(
    private readonly storage: SQLiteStorage,
    private readonly memoryEngine: MemoryEngine,
    private readonly decayEngine: DecayEngine,
    private readonly options: SQLiteBackendOptions = { dedupOnAdd: true, preserveCallerIds: false }
  ) {}

  async add(turn: MemoryTurn): Promise<void> {
    if (this.options.dedupOnAdd) {
      // Delegate to Core's MemoryEngine for dedup + scoring parity
      const result = await this.memoryEngine.addTurn(turn.content, {
        sessionId: turn.sessionId,
        role: turn.role,
        importance: turn.importance,
      });
      if (this.options.preserveCallerIds && !result.duplicateDetected) {
        // Optional: write caller's id as a rename
        await this.storage.renameEntity(result.entity.name, turn.id);
      }
    } else {
      // Direct write bypass (bulk import scenarios)
      // ... direct entityManager.createEntities path
    }
  }
  // ... other methods
}
```

**Caveat on caller-supplied IDs:** when `preserveCallerIds=false` (default), `turn.id` / `turn.createdAt` are silently overridden by engine-generated values. Callers who need stable IDs must set `preserveCallerIds: true`. This is a deliberate lossy translation — fully documented here.

### Part 5: New storage primitive `deleteEntitiesBySessionId`

Required to back `IMemoryBackend.delete_session`:

```typescript
// Added to IGraphStorage and both storage backends
deleteEntitiesBySessionId(sessionId: string): Promise<{ deleted: number }>;
```

- **JSONL (`GraphStorage`):** filter-in-memory + atomic rewrite. O(n) on total graph size.
- **SQLite (`SQLiteStorage`):** Because `sessionId` is NOT a SQL column (serialized as JSON inside the `data` blob), the implementation must use `json_extract(data, '$.sessionId') = ?` in the `WHERE` clause. This is **unindexed** and O(n). Acceptable for typical usage (< 100K entities). Documented explicitly — a future spec can add a `sessionId` column + index if needed.

### Wiring into `ManagerContext`

```typescript
private _memoryBackend?: IMemoryBackend;

get memoryBackend(): IMemoryBackend {
  if (!this._memoryBackend) {
    // Storage field is typed as GraphStorage on ManagerContext but at runtime
    // may be SQLiteStorage. Use storage-type env check rather than instanceof
    // to stay compatible with the existing MEMORY_STORAGE_TYPE convention.
    const isSqlite = process.env.MEMORY_STORAGE_TYPE === 'sqlite';
    if (isSqlite) {
      this._memoryBackend = new SQLiteBackend(
        this.storage as unknown as SQLiteStorage,
        this.memoryEngine,
        this.decayEngine,
      );
    } else {
      this._memoryBackend = new InMemoryBackend(this.decayEngine);
    }
  }
  return this._memoryBackend;
}
```

Callers who want PRD-style backend access use `ctx.memoryBackend`. Callers who want the richer memoryjs API keep using `ctx.memoryEngine` + `ctx.episodicMemory`.

## Data Flow

### Weighted retrieval path

```
MemoryBackend.get_weighted(query, sessionId, { limit: 20, threshold: 0.1 }):
  1. Fetch all turns for sessionId (via MemoryEngine.getSessionTurns or storage read)
  2. Tokenise query
  3. For each turn:
       score = decayEngine.calculatePrdEffectiveImportance(turn, { tokens: queryTokens })
  4. Filter: keep turns where score >= (options.threshold ?? config.minImportanceThreshold)
  5. Sort desc by score
  6. Apply limit
  7. Return [{ turn, score }]
```

## Testing

### Unit tests (`tests/unit/agent/`)

**`DecayEngine.prd.test.ts` (~17 tests):**
- `calculatePrdEffectiveImportance` with no query context uses `recency × freshness × prd_importance`
- With query context, `relevance_boost` is additive
- `decayRate = 0` → recency stays at 1.0
- `freshnessCoefficient = 0` → freshness stays at 1.0
- `relevanceWeight = 0` → boost is always 0
- Formula monotonicity: older entity has lower `recency`, all else equal
- Query overlap of 50% yields `relevance_boost = 0.5 × 0.35 = 0.175`
- Accessed-recently entity has higher `freshness` than never-accessed entity of same age
- ISO string parsing on `createdAt` / `lastAccessedAt` (regression for string-arithmetic bug)
- PRD importance mapping: `memoryjs=0 → prd=1.0`, `memoryjs=5 → prd=2.0`, `memoryjs=10 → prd=3.0`
- Worked-example reproduction: the exact numbers from §"Worked example" match within 1e-6
- Legacy `calculateEffectiveImportance` fixture unchanged (regression-proof for existing callers)
- `applyConfidenceToImportance` still works on legacy path, untouched by PRD path

**`InMemoryBackend.test.ts` (~9 tests):**
- `add` + `get_weighted` roundtrip
- `add(turn)` reads `turn.sessionId` (no separate parameter required)
- `delete_session` clears only that session
- `list_sessions` enumerates sessions with ≥1 turn
- `get_weighted` applies threshold correctly
- `get_weighted` returns sort-desc by score

**`SQLiteBackend.test.ts` (~12 tests):**
- Same contract as InMemoryBackend
- Persistence across storage reopen
- `dedupOnAdd=true` (default) delegates to `MemoryEngine.addTurn` (verify via spy)
- `preserveCallerIds=false` (default) ignores `turn.id` / `turn.createdAt`
- `preserveCallerIds=true` renames entity to `turn.id`
- `delete_session` uses `json_extract`-based WHERE (verify via query log)
- `deleteEntitiesBySessionId` respects transactional semantics when inside `governanceManager.withTransaction`

### Integration tests

- Decay parameters from env vars propagate to `DecayEngine`
- `MemoryBackend.get_weighted` returns same top-K on InMemory and SQLite for identical corpus — parity per PRD MEM-04 "identical API"
  - **Parity tolerance:** `score` matches within absolute 1e-6. Ordering identity only asserted when no two scores are within 1e-6 of each other.
- Legacy `calculateEffectiveImportance` behaviour unchanged on fixed fixture
- `deleteEntitiesBySessionId` respects transactional semantics

### Regression gate

All memoryjs v1.11.0-baseline tests (post-Core) must continue to pass. Specifically:
- `DecayScheduler` tests (still uses `calculateEffectiveImportance`)
- `SemanticForget` tests (same reason)

## Error handling

- `minImportanceThreshold` (filter) vs `minImportance` (clamp floor) — docs and env-var names disambiguate.
- `decayRate` not provided AND `halfLifeHours` not provided → fall back to built-in default (decayRate derived from 168h half-life).
- Storage backend mismatch: if caller explicitly constructs `SQLiteBackend` with a JSONL `GraphStorage`, construction throws `TypeError`.
- Cross-backend parity failure: if `get_weighted` top-K divergence exceeds tolerance on same corpus, treat as blocker.

## Performance targets

| Operation | Target |
|---|---|
| `calculatePrdEffectiveImportance` | < 0.1ms per call |
| `InMemoryBackend.get_weighted` (1,000 turns) | P95 < 20ms |
| `SQLiteBackend.get_weighted` (1,000 turns) | P95 < 50ms |
| `deleteEntitiesBySessionId` on SQLite | < 100ms for 1,000 rows (unindexed JSON scan) |

## Success criteria

- [ ] `DecayEngineConfig` extended with 4 PRD-aligned fields (without touching existing 7 fields)
- [ ] `calculatePrdEffectiveImportance` implemented; worked-example numbers reproduced in tests within 1e-6
- [ ] ISO-string parsing for `createdAt` / `lastAccessedAt` (regression test)
- [ ] Env vars parsed in `ManagerContext`; `MEMORY_PRD_MIN_IMPORTANCE_THRESHOLD` naming ships with disambiguation docs in `CLAUDE.md`
- [ ] `IMemoryBackend` + `InMemoryBackend` + `SQLiteBackend` implemented
- [ ] `SQLiteBackend.add` with default options delegates to `MemoryEngine.addTurn`
- [ ] `preserveCallerIds` option wired and tested
- [ ] `deleteEntitiesBySessionId` added to both storage backends
- [ ] `ctx.memoryBackend` lazy getter wired
- [ ] Existing `calculateEffectiveImportance` semantics unchanged (regression test suite passes)
- [ ] `docs/architecture/DECAY_FORMULA.md` created explaining both formulas side-by-side
- [ ] `CHANGELOG.md` v1.12.0 entry
- [ ] `npm run typecheck` clean
- [ ] ~38 new tests; all existing tests pass

## Open questions (non-blocking)

1. Should `get_weighted` update `accessCount` / `lastAccessedAt` on retrieved turns? PRD is silent. **Decision: no side effects** — access updates only fire on explicit read APIs to keep retrieval pure.
2. Should `SQLiteBackend` expose a direct `skipDedup` path for bulk import? **Decision: yes, via `dedupOnAdd=false` option** — already in the interface.
3. Should `sessionId` get its own SQL column with an index? **Decision: deferred** — follow-up spec, not blocking MVP.

## Dependencies

- **Hard:** `2026-04-16-memory-engine-core-design.md` must ship first. `SQLiteBackend` composes `MemoryEngine.addTurn`.
- **Soft:** Future `OrchestratorService` (Context Engine Sub-feature #6) will use `ctx.memoryBackend`, not `ctx.memoryEngine`, for PRD parity.

## Next steps after approval

1. Implementation plan via `superpowers:writing-plans` skill → `docs/superpowers/plans/2026-04-16-memory-engine-decay-extensions-plan.md`
2. Implementation via `superpowers:subagent-driven-development` skill
3. PR review via `pr-review-toolkit`
4. Merge; release as v1.12.0
5. Then proceed to remaining Context Engine sub-features (Hybrid Retriever, Re-ranker, Compressor, Budget Enforcer, Orchestrator, Observability)
