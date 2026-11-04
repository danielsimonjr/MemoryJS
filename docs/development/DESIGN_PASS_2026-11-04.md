# MemoryJS Design Pass — 2026-11-04

**Status:** Planning document. Nothing below is applied yet. Every claim was re-verified against source at `HEAD = 1cfbb8c` (master `80f97c4` + merge) with `file:line` evidence and call-site greps; the 2026-11-04 audit (`docs/development/AUDIT_2026-11-04.md`) was used as input only, never trusted.

**Audience:** Builder (Haiku) / Challenger (Haiku) / Checker (Opus) / Fixer (Sonnet). Each item states files touched (with line refs), exact design, migration/compat notes, tests to add, risk (low / med / high), effort (S / M / L), and the invariants the Challenger should attack. Items marked **DEFER** need an owner decision and must not be built in this session.

**Hard constraints for every item:** additive-only public API (deprecate, never remove); no new runtime dependencies; no skipped or widened tests; new source files < 500 lines, new test files < 400 lines; new exported symbol names must not collide with any existing exported name anywhere in `src/` (`bun run tools:check-duplicates` gates against `docs/architecture/duplicate-baseline.json`); `bun run typecheck`, `bun run lint`, and the named test files must be green after each item. The `src/types` layer is a leaf (lint rule in `scripts/check-lint-rules.mjs`) — never import runtime code into `src/types`.

---

## 1. Executive summary

The codebase is structurally sound: delta persistence is the norm, both storage backends declare `implements IGraphStorage`, governance hooks reach all three core managers, and the event emitter is the backbone of every derived index. The strain is at the seams, not the core:

1. **The storage contract is narrower than the backends.** `IGraphStorage` (`src/types/types.ts:1200`) omits the five delta primitives every manager relies on (`appendEntities`, `appendRelations`, `updateEntities`, `deleteEntities`, `deleteRelations`) and `graphMutex`. Six call sites fall back to `typeof (this.storage as Partial<GraphStorage>).x === 'function'` probes, core managers are typed against the concrete `GraphStorage` class, and `ManagerContext` casts SQLite `as GraphStorage` (`ManagerContext.ts:299`). An explicit optional-member extension of the interface plus one capability helper removes the casts without breaking third-party/test fakes. **(DES-1)**
2. **Env parsing is implemented six different ways.** Strict `=== 'true'` (ManagerContext, ObservationManager, GraphStorage), case-insensitive (`ManagerContext.getEnvBool`, `AgentMemoryConfig.getEnvBool`), `'true' || '1'` (`PartialIndexAdvisor:76`), `parseInt` (`SQLiteStorage:2238`, `TFIDFEventSync:131`), strict-decimal regex (`GraphStorage:66`, `CachePressureCoordinator:69`) — and the segment-count parser is copy-pasted verbatim between `GraphStorage.ts:65-80` and `JsonlProceduralGraphBacking.ts:90-100`. A shared `src/utils/envConfig.ts` is warranted and partially present (`ManagerContext.getEnvNumber` at `:1829` is already the best implementation). **(DES-2)**
3. **Two declared graph events are never emitted.** `observation:added` / `observation:deleted` have typed emitters (`GraphEventEmitter.ts:379,397`) and five live subscribers (`ObserverPipeline.ts:209`, `TransitionLedger.ts:393,405`, `RankedSearch.ts:55-56`) but **zero** `emitObservationAdded`/`emitObservationDeleted` call sites in `src/`. The observer pipeline's observation routing is therefore dead in production. **(DES-3)**
4. **`ManagerContext` is 1874 lines / 69 lazy fields / 95 imports.** A cohesive, env-gated "optional storage infrastructure" cluster (column store, tiered index, compressed cache, bloom pre-screener, plus their teardown) can be extracted into a sub-facade with every public getter preserved as a one-line delegate. **(DES-4, DES-5)**
5. **Docs reference symbols that do not exist.** `RoleProfileManager` (README:93, CLAUDE.md:146,212) has no definition in `src/`; `MEMORY_AGENT_ROLE` is catalogued (`diag.ts:63`) but read nowhere; README advertises `ctx.queryNaturalLanguage(query, llmProvider?)` (actual: one argument, `ManagerContext.ts:1767`) and `ctx.prospectiveMemory.fire()` (private; public is `tick()`/`onObservation()`). **(DES-6)**

Of the five deferred audit items: **OPT-14 and OPT-15 are implementable now** with per-candidate isolation and a capability-checked delta path (DES-10, DES-11). **CMP-6 is retired** — full indexes on `entityType`/`projectId`/`isLatest`/`contentHash` already exist (`SQLiteStorage.ts:577-605,748-750`) and the only filtered SQL (`getSessionEntities`, `:1976`) is covered by `idx_entities_session_created_at`, so advisor-created partial indexes can accelerate nothing (DES-9). **CMP-8 is resolved as "diagnostics only, no write-path change"** (DES-12). **CMP-9 is split**: conditional predicates (DES-13) and warm-tier compaction (DES-14) are implementable; TieredIndex/CompressedMap consumers and segment consistent hashing stay deferred with specific owner questions.

Total: **16 implementable items** (DES-1..6, DES-8..15, DES-19 plus the docs item) in four batches, **6 owner questions** (§5).

---

## 2. Current architecture assessment

### 2.1 What is good (evidence)

- **Both backends implement the interface.** `GraphStorage implements IGraphStorage` (`GraphStorage.ts:218`), `SQLiteStorage implements IGraphStorage` (`SQLiteStorage.ts:203`). The method sets differ only in backend-specific extras (SQLite: embeddings, FTS, read pool, `close`/`flush`; JSONL: observation word index, `transaction()`).
- **Delta primitives exist on both backends with identical signatures**: `updateEntities(batch, {timestamp?}): Promise<Entity[]>` (`GraphStorage.ts:1240`, `SQLiteStorage.ts:1466`, all-or-nothing on missing names), `deleteEntities(names): Promise<{deletedEntities, deletedRelations}>` (`:1386` / `:1567`, cascades relations), `deleteRelations(keys, {touchEntities?, timestamp?})` (`:1473` / `:1658`), `appendRelations`, `appendEntities`, `renameEntity`.
- **Governance is wired at every write chokepoint.** `EntityManager.setGovernanceHooks` (`EntityManager.ts:374`), `RelationManager` ctor hooks (`RelationManager.ts:27`), `ObservationManager` ctor hooks plus `preflightGovernanceUpdate` before each delta write (`ObservationManager.ts:671,866`). `ManagerContext.getGovernanceHooks()` (`:405-425`) passes the same hooks object to all three.
- **Event-driven invalidation covers entity/relation/graph events consistently.** Both storages emit `entity:created/updated/deleted`, `relation:created/deleted`, `graph:saved/loaded` at the storage layer; `entity:renamed` (+ `deleted`/`created`) is emitted once at the manager layer (`EntityManager.ts:1154-1156`) because the storage-level `renameEntity` deliberately does not emit (`GraphStorage.ts:1607` comment).
- **Error hierarchy exists and is used in `core`/`features`**: `KnowledgeGraphError` + 17 subclasses (`src/utils/errors.ts`), `ErrorCode` enum; `core` throws typed errors 73:46, `features` 33:11.
- **Env catalogue exists** for operator tooling: `ENV_VAR_CATALOG` (27 entries, `src/cli/commands/diag.ts:44`) feeds `memory env` and `memory doctor`.
- **Write-lock discipline is consistent**: `graphMutex` on both storages (`SQLiteStorage.ts:220` mirrors `GraphStorage`), acquired by every manager mutation and by `TransactionManager`/`BatchTransaction` (`TransactionManager.ts:57`).

### 2.2 What is strained (evidence)

| Area | Evidence | Consequence |
|---|---|---|
| Storage typing | `IGraphStorage` lacks `updateEntities`/`deleteEntities`/`appendEntities`/`appendRelations`/`deleteRelations`/`graphMutex` (grep of `types.ts:1200-1460` → only `getRelations*`/`hasRelations`). Core managers declare `private storage: GraphStorage` (`EntityManager.ts:271`, `RelationManager.ts:26`, `ObservationManager.ts:69`, `HierarchyManager.ts:19`); `ManagerContext.ts:299` casts. Six `typeof … === 'function'` probes (`EntityManager.ts:297,311,333`, `RelationManager.ts:64,78`, `ObservationManager.ts:111`); `TransactionManager.ts:58` probes `graphMutex` through a `Partial<Pick<…>>` cast. | Agent-layer code typed against `IGraphStorage` (e.g. `ConsolidationPipeline`, `DecayEngine`) cannot see the delta primitives at all and keeps using `saveGraph`/N× `updateEntity`. Test fakes (`createMockStorage` in 33 test files) omit the primitives, so any delta rewrite must feature-detect. |
| Env parsing | 28 distinct direct `process.env.X` reads in `src/` outside `AgentMemoryConfig`; five parsing idioms (§1 ¶2); `MEMORY_STORAGE_SEGMENT_COUNT` parser duplicated verbatim (`GraphStorage.ts:65-80`, `JsonlProceduralGraphBacking.ts:90-100`); `MEMORY_SQLITE_AUTO_INDEX` accepts `'1'` (`PartialIndexAdvisor.ts:76`) while CLAUDE.md documents `true`/`false`; `getEnvBool` in `ManagerContext:1864` is case-insensitive while the inline gates at `:406,476,519,569,607` are strict. | Operators get different behaviour for `TRUE` vs `true` depending on which flag they set. Doc tables cannot be accurate without reading each site. |
| Event contract | `emitObservationAdded`/`emitObservationDeleted` have no callers (grep across `src/`); 5 subscribers exist. `TransitionLedger` would double-record once they are emitted because its `entity:updated` handler already diffs the `observations` field (`TransitionLedger.ts:330-345`). | `ObserverPipeline.attach()` is inert in production; `RankedSearch` relies on `entity:updated` only. |
| `ManagerContext` size | 1874 lines, 71 getters/methods, 69 `_private` lazy fields, 95 imports; sidecar-path derivation (`path.basename(filePath, path.extname(filePath))`) repeated 3× (`:288`, `:391`, `:525`); `close()` (`:1800`) hand-tears-down the bloom screener. | Every new subsystem adds ~30 lines and a teardown clause; getters for env-gated infra (`:473-590`, `:626-647`) have no dependency on the rest of the context except `storage`, `cachePressure`, and the file path. |
| Dead/duplicated abstractions | `CompressedCache` (`src/utils/compressedCache.ts:136`, Entity-only hot/cold) has zero `src/` users besides its barrel export and a type comment; `CompressedMap<K,V>` (`src/utils/compression/CompressedMap.ts:61`) is the generic successor already wired at `ManagerContext.ts:567`. `OptimizedInvertedIndex` (`src/search/OptimizedInvertedIndex.ts:66`) has zero `src/` constructors. `PartialIndexAdvisor.recordFilter` has zero callers (`SQLiteStorage.ts:2282`). | Barrel exports promise capabilities nothing uses; CMP-9's "wire TieredIndex into OII" has no consumer on either side. |
| Transaction semantics | `TransactionManager.commit` is full `getGraphForMutation`+`saveGraph` (`TransactionManager.ts:289-298`) — correct but O(graph), so it cannot serve as the "atomic delta" host the audit imagined for OPT-15. `GovernanceManager.withTransaction` (`GovernanceManager.ts:489-510`) is **not** a transaction: it runs `fn(tx)`, and on throw calls `tx.markRolledBack()` which only annotates audit entries; each `GovernanceTransaction.createEntity/updateEntity/deleteEntity` persists immediately. | Naming misleads; the atomic multi-op primitive in this codebase is `ctx.batch()`/`BatchTransaction` under `graphMutex`. |
| Docs drift | §1 ¶5. Also README:75 lists `ctx.diagnostics` (it is a method, `ManagerContext.ts:786`). | Quick-start readers hit `TypeError`s. |
| Test fixtures | 33 test files define their own `function createMockStorage` (e.g. `ConsolidationPipeline.test.ts:26`, `DecayEngine.test.ts:23`, `ProspectiveMemoryManager.test.ts`); 202 test files call `mkdtemp`/`tmpdir()` inline; no `tests/helpers/` directory exists. | Every new delta primitive must be re-mocked 33 times; drift between mocks (some return `null`, some `undefined` for missing entities — `DecayEngine.test.ts:27` vs `ConsolidationPipeline.test.ts:31`). |
| Stability tags | Per CLAUDE.md, pre-Phase-0 modules are implicitly `@public` and per-symbol tiering is deferred to v2.0.0. `features/` has 17 files with 1 `@public`, 0 `@experimental`; `agent/` 101 files, 0 `@public`, 30 `@experimental`. | No action this pass beyond tagging every **new** module `@experimental` or `@internal`; recorded as a finding. |

---

## 3. Design findings

Each finding is self-contained. "Files" lists every file a Builder may edit for that item; anything else is out of scope for the item.

### DES-1 — Promote the delta primitives into `IGraphStorage` and replace duck-typing probes with one capability helper

- **Evidence:** §2.2 row 1. Both backends implement all five primitives with identical signatures (`GraphStorage.ts:886,923,1240,1386,1473`; `SQLiteStorage.ts:1204,1273,1466,1567,1658`) and expose `readonly graphMutex` (`GraphStorage` — grep `graphMutex`; `SQLiteStorage.ts:220`).
- **Design:**
  1. In `src/types/types.ts` (inside `IGraphStorage`, after `renameEntity?` at `:1309`) add **optional** members, same precedent as `renameEntity?`/`events?`:
     ```ts
     appendEntities?(entities: Entity[]): Promise<void>;
     appendRelations?(relations: Relation[]): Promise<void>;
     updateEntities?(batch: Array<{ name: string; updates: Partial<Entity> }>, options?: { timestamp?: string }): Promise<Entity[]>;
     deleteEntities?(names: string[]): Promise<{ deletedEntities: Entity[]; deletedRelations: Relation[] }>;
     deleteRelations?(keys: Array<Pick<Relation, 'from' | 'to' | 'relationType'>>, options?: { touchEntities?: string[]; timestamp?: string }): Promise<Relation[]>;
     /** Manager-level write lock (see GraphStorage.graphMutex). Optional for third-party fakes. */
     readonly graphMutex?: { acquire(): Promise<() => void> };
     ```
     Verify the `AsyncMutex.acquire` return shape in `src/utils/AsyncMutex.ts` before writing the structural type; `types/` must stay a leaf, so do not import `AsyncMutex` there.
  2. New file `src/core/storageCapabilities.ts` (~60 lines, `@internal`):
     ```ts
     export type DeltaCapableStorage = IGraphStorage & Required<Pick<IGraphStorage,'appendEntities'|'appendRelations'|'updateEntities'|'deleteEntities'|'deleteRelations'>>;
     export function hasDeltaPrimitives(s: IGraphStorage): s is DeltaCapableStorage { /* typeof checks on the five */ }
     export function hasWriteLock(s: IGraphStorage): s is IGraphStorage & { graphMutex: NonNullable<IGraphStorage['graphMutex']> }
     export async function withStorageWriteLock<T>(s: IGraphStorage, fn: () => Promise<T>): Promise<T> // acquires graphMutex when present, else runs fn directly (same semantics as TransactionManager.acquireWriteLock minus the AbortSignal)
     ```
     Pick names that do not already exist as exports anywhere in `src/` (run `bun run tools:check-duplicates`).
  3. Replace the six probes: `EntityManager.ts:297,311,333`, `RelationManager.ts:64,78`, `ObservationManager.ts:111` → `if (hasDeltaPrimitives(this.storage))` (or per-method `typeof this.storage.updateEntities === 'function'` now that the member is on the interface — no cast). `TransactionManager.ts:57-58` → `hasWriteLock(storage)`.
  4. Widen `TransactionManager` and `BatchTransaction` constructor parameter from `GraphStorage` to `IGraphStorage` (`TransactionManager.ts:192,438`); both only call `getGraphForMutation`/`saveGraph`/`loadGraph` (verify by grep inside the file). Remove the `as GraphStorage` cast at `ManagerContext.ts:776`. **Do not** retype `EntityManager`/`RelationManager`/`ObservationManager`/`HierarchyManager` constructor params in this pass (they use `getLowercased`, observation-word indexes, etc. — audit separately; see §5 Q6).
  5. Export `hasDeltaPrimitives`, `withStorageWriteLock` from `src/core/index.ts`.
- **Compat:** Purely additive; optional members keep every existing `IGraphStorage` fake compiling. No runtime behaviour change.
- **Tests:** new `tests/unit/core/storageCapabilities.test.ts` (< 120 lines): real `GraphStorage` and real `SQLiteStorage` (temp files) satisfy `hasDeltaPrimitives` and `hasWriteLock`; a minimal fake lacking them does not; `withStorageWriteLock` serialises two concurrent callers on a real storage and runs immediately on a fake. Extend `tests/unit/exports-barrels.test.ts` with the two new names. Existing `EntityManager`/`RelationManager`/`ObservationManager`/`TransactionManager` tests must stay green unchanged.
- **Risk:** low. **Effort:** S/M.
- **Challenger invariants:** `types/` remains a leaf (lint rule); `tsc` dts emit still passes (`bun run build`); no fake in `tests/` starts failing because a member became required (none should — all optional); `TransactionManager` with a storage lacking `graphMutex` still commits.

### DES-2 — Shared env-var parsing helper (`src/utils/envConfig.ts`)

- **Evidence:** §2.2 row 2; full site list in §1 ¶2. `ManagerContext.getEnvNumber` (`:1829-1858`) is already the strongest implementation (finite check, integer/min/max bounds, logged fallback).
- **Design:** New `src/utils/envConfig.ts` (~120 lines, `@public`, documented contract per helper):
  - `readEnvStrictFlag(name): boolean` — `=== 'true'` (the documented "strict literal" contract used by `MEMORY_GOVERNANCE_ENABLED`, `MEMORY_OBSERVATIONS_COLUMNAR`, `MEMORY_TIERED_INDEX`, `MEMORY_CACHE_COMPRESS`, `MEMORY_FUZZY_BLOOM_PRESCREEN`, `MEMORY_OBSERVATION_DEDUP`, `MEMORY_AUTO_LINK`, `MEMORY_VALIDATE_ON_STORE`, `MEMORY_USE_MMAP`, `MEMORY_QUERY_LOGGING`).
  - `readEnvLooseFlag(name, defaultValue): boolean` — case-insensitive `'true'` (preserves `ManagerContext.getEnvBool` / `AgentMemoryConfig.getEnvBool` behaviour).
  - `readEnvNumber(name, defaultValue, bounds?: { min?, max?, integer? }): number` — verbatim port of `ManagerContext.getEnvNumber`, including the `logger.warn` messages (tests may assert them).
  - `readEnvNumberOrUndefined(name): number | undefined` — port of `ManagerContext.envNumberOrUndefined` (`:1531`).
  - `readEnvStrictInt(name, { min, max }): number | undefined` — the `^[1-9][0-9]*$` pattern + range used by the segment-count parser; returns `undefined` on any rejection (never throws).
  - `parseSegmentCount(raw: string | undefined): number | null` — the exact logic of `GraphStorage.resolveSegmentStorage` (`:66-78`) so both copies call one function.
  - `readEnvPositiveIntOrDefault(name, defaultValue): number` — replaces the two `parseInt` sites (`SQLiteStorage.ts:2238-2240`, `TFIDFEventSync.ts:130-132`) **preserving** their lenient `parseInt` semantics (document that `'10abc'` → 10 there; do not silently tighten).
  - Migrate in this item: `GraphStorage.ts:65-80` and `:665-667`, `JsonlProceduralGraphBacking.ts:90-100` (delete the duplicated regex/const), `SQLiteStorage.ts:2238-2240`, `TFIDFEventSync.ts:130-132`, `CachePressureCoordinator.ts:69-78`, `QueryLogger.ts:57`, `ObservationManager.ts:419,568,697`. **Do not** touch `ManagerContext.ts` or `PartialIndexAdvisor.ts` here (owned by DES-4/DES-9); DES-4 makes `ManagerContext.getEnvNumber/getEnvBool/envNumberOrUndefined` thin delegates afterwards. `AgentMemoryConfig.ts` helpers may delegate (same semantics) — optional.
  - Export from `src/utils/index.ts`.
- **Compat:** Zero semantic change per site — the item is a consolidation. Each migrated site must keep its previous accept/reject behaviour; the test file encodes the matrix.
- **Tests:** new `tests/unit/utils/envConfig.test.ts` (< 250 lines) with a table per helper: strict flag rejects `TRUE`/`1`/`yes`; loose flag accepts `TRUE`; `readEnvStrictInt` rejects `007`, `1e3`, `0x10`, `-5`, ` 5`, `3.7`; `parseSegmentCount` returns `null` for `1`, `1025`, and the same rejects; `readEnvNumber` logs and falls back on `NaN`/`Infinity`/out-of-bounds/non-integer when `integer: true`; `readEnvPositiveIntOrDefault('10abc')` → 10 (documented leniency). Existing tests covering the migrated sites must stay green (`tests/unit/core/GraphStorage*`, `tests/unit/search/TFIDFEventSync*`, `tests/unit/utils/CachePressureCoordinator*`, procedural backing tests, `ObservationManager.dedup.test.ts`).
- **Risk:** low/med (many files, trivial edits). **Effort:** M.
- **Challenger invariants:** every migrated site has a test that sets the env var to a previously-accepted and a previously-rejected value and observes identical behaviour; `vi.stubEnv`/restore discipline so tests do not leak env; no new exported name collides with the 33-file `getEnv*` test helpers or `AgentMemoryConfig`'s private `getEnvNumber` (private functions are not counted, exported ones are).

### DES-3 — Emit `observation:added` / `observation:deleted` from `ObservationManager`

- **Evidence:** §1 ¶3. Emission points: `ObservationManager.addObservationsLocked` after `updateEntitiesCompat` at `:680` — `results[i].addedObservations` already holds the per-entity delta (`:684-688`); `deleteObservationsLocked` after `:872` — the loop at `:838-852` computes `entity.observations.filter(o => !d.observations.includes(o))` but does not retain the removed list, so it must be captured.
- **Design:**
  1. `addObservationsLocked`: after `fireGovernanceAudits(...)` at `:681`, `const emitter = this.storage.events; if (emitter) for (const r of results) if (r.addedObservations.length > 0) emitter.emitObservationAdded(r.entityName, r.addedObservations);`. Event order per entity: `entity:updated` (from storage) → `observation:added`.
  2. `deleteObservationsLocked`: while filtering, record `removedByEntity: Map<string, string[]>` of observations actually present and removed; after the compat write emit `emitObservationDeleted(name, removed)` for each non-empty entry. Requested-but-absent observations are **not** reported.
  3. `TransitionLedger.ts:391-412`: delete the two `observation:*` subscriptions (dead today; keeping them would double-record because `:330-345` already records the `observations` field diff from `entity:updated`). Leave a one-line comment pointing here. `tests/unit/core/TransitionLedger.test.ts` has no `observation:*` assertions (verified by grep), so no test changes.
  4. `RankedSearch` double invalidation (`entity:updated` + `observation:added`) is idempotent — no change.
- **Compat:** Additive events. Subscribers that already handle `entity:updated` see no change in that event. CHANGELOG `### Added`: "ObservationManager now emits `observation:added` / `observation:deleted`".
- **Tests:** extend `tests/unit/core/ObservationManager.test.ts` (currently 385 lines; add ≤ 60 or create `ObservationManager.events.test.ts`): (a) `addObservations` emits once per entity with exactly the new strings; (b) adding an already-present observation emits nothing; (c) `deleteObservations` emits only the strings actually removed; (d) deleting absent strings emits nothing; (e) order `entity:updated` before `observation:added` for the same entity; (f) same five on `SQLiteStorage`. Integration: `tests/unit/agent/ObserverPipeline.test.ts` add one test that attaches to a real `ManagerContext` emitter and observes routing after `ctx.observationManager.addObservations` (today the test suite only drives the emitter directly, `:301-358`). `TransitionLedger.test.ts` must stay green (assert one ledger entry per observation write, not two).
- **Risk:** low/med (new events reach `ObserverPipeline` auto-routing when `MEMORY_OBSERVER_PIPELINE` is on). **Effort:** S.
- **Challenger invariants:** with `MEMORY_OBSERVATIONS_COLUMNAR=true` the column-store shadow write still happens and the event fires exactly once; with `MEMORY_OBSERVATION_DEDUP=true` the emitted list equals what was persisted (post-dedup); `createEntities` with initial observations does **not** emit `observation:added` (only `entity:created`) — document that choice in the JSDoc; bulk import via `saveGraph` emits nothing new.

### DES-4 — Extract env-gated storage infrastructure into `StorageInfraFacade`

- **Evidence:** `ManagerContext.ts:473-481` (`observationColumnStore`), `:517-547` (`tieredPostingsIndex`), `:567-588` (`compressedEntityCache`), `:626-647` (`bloomPreScreener` + `_bloomPreScreenerUnsubscribe`), `:608-611` (searchManager wiring of the screener), `:1809-1814` (teardown), `:800-810` (diagnostics peek at `_tieredPostingsIndex`). Dependencies: `this.storage`, `this.cachePressure`, `this.storage.getFilePath()`, `this.observationColumnStorePath`, and a callback to attach the screener to an already-built `SearchManager`.
- **Design:** New `src/core/context/StorageInfraFacade.ts` (~170 lines, `@internal`):
  ```ts
  export class StorageInfraFacade {
    constructor(deps: { storage: IGraphStorage; cachePressure: CachePressureCoordinator; columnStorePath: string; onBloomScreenerReady?: (s: BloomPreScreener) => void })
    get observationColumnStore(): IColumnStore<ObservationColumn> | null
    get tieredPostingsIndex(): TieredIndex<unknown> | null
    get compressedEntityCache(): CompressedMap<string, Entity> | null
    get bloomPreScreener(): BloomPreScreener | null
    /** Side-effect-free peeks for diagnostics(): never construct. */
    peekTieredPostingsIndex(): TieredIndex<unknown> | null
    peekBloomPreScreener(): BloomPreScreener | null
    close(): void   // unsubscribes bloom listeners; does not close storage
  }
  ```
  Bodies move verbatim (including the env gates, which switch to `readEnvStrictFlag` from DES-2). `ManagerContext` keeps the four public getters as one-line delegates, deletes the four `_` fields + `_bloomPreScreenerUnsubscribe`, `close()` calls `this.infra.close()` then the existing `setBloomPreScreener(null)` if a search manager exists, and `diagnostics()` uses `peekTieredPostingsIndex()`. The `searchManager` getter keeps its `if (readEnvStrictFlag('MEMORY_FUZZY_BLOOM_PRESCREEN'))` wiring. Also make `getEnvNumber`/`getEnvBool`/`envNumberOrUndefined` (`:1531,1829,1864`) delegate to DES-2 helpers (same signatures, private).
- **Compat:** Public API identical (same getter names/types on `ManagerContext`). Construction laziness identical (facade getters are lazy). `close()` ordering identical.
- **Tests:** existing wiring tests must pass unchanged: `tests/unit/search/tiered/TieredIndex-wiring.test.ts`, `tests/unit/core/bloom-prescreener-wiring.test.ts`, `tests/unit/core/columns/ObservationColumnStore-wiring.test.ts`, `tests/unit/core/columns/columns-review-fixes.test.ts`, `tests/unit/utils/compression/compressedEntityCache-wiring.test.ts`, `tests/unit/core/ManagerContext.test.ts`. New `tests/unit/core/context/StorageInfraFacade.test.ts` (< 150 lines): each getter returns `null` when its flag is unset and an instance when `'true'`; `peek*` never constructs; `close()` unsubscribes exactly the listeners it registered (count via emitter listener count before/after).
- **Risk:** med (teardown ordering; `diagnostics()` must not construct). **Effort:** M.
- **Challenger invariants:** `ctx.diagnostics()` on a fresh context with `MEMORY_TIERED_INDEX=true` reports `tieredIndexStats: undefined` (not constructed) — same as today; accessing `ctx.bloomPreScreener` before `ctx.searchManager` and after both wire the screener; `ManagerContext.ts` line count drops by ≥ 120; no import of `ManagerContext` from the facade (no cycle; check `bun run tools:deps` cycle report).

### DES-5 — `sidecarPath()` helper for `<basename>-<suffix><ext>` derivation

- **Evidence:** identical `path.dirname` + `path.basename(filePath, path.extname(filePath))` + `path.join` triplets at `ManagerContext.ts:286-294` (constructor: `-saved-searches`, `-tag-aliases`, `-ref-index`, `-observations`), `:388-394` (audit log), `:523-527` (tiered warm/cold).
- **Design:** `export function sidecarPath(storageFilePath: string, suffix: string, ext = '.jsonl'): string` in `src/utils/sidecarPath.ts` (~25 lines, `@internal`), exported from `src/utils/index.ts`. Replace the three sites (the `:523-527` site moves into DES-4's facade — coordinate: DES-4 Builder uses `sidecarPath` directly). Also check `src/agent/procedural/graph/backing/JsonlProceduralGraphBacking.ts` and `src/features/GovernanceManager.ts` for the same idiom and migrate if present (grep `extname(` in `src/`).
- **Compat:** none (byte-identical paths). **Tests:** `tests/unit/utils/sidecarPath.test.ts` (< 60 lines): `.jsonl`, `.db`, no-extension, nested dir, custom ext; and an assertion in `ManagerContext.test.ts` that the audit sidecar path for `x/memory.db` is `x/memory-audit.jsonl` (existing behaviour).
- **Risk:** low. **Effort:** S. Bundled into Batch 2 with DES-4 (same file).
- **Challenger invariants:** Windows separators via `path.join` (no string concatenation); a storage path like `memory.v2.jsonl` yields `memory.v2-audit.jsonl` exactly as before.

### DES-6 — Fix phantom/incorrect public-API references in README and CLAUDE.md

- **Evidence (all verified by grep against `src/`):**
  - `RoleProfileManager` — README:93, CLAUDE.md:146, CLAUDE.md:212. Not defined anywhere. Actual API: `getRoleProfile`, `listRoleProfiles`, `resolveRoleProfile`, `createCustomProfile` (`src/agent/RoleProfiles.ts:163-215`).
  - `MEMORY_AGENT_ROLE` — documented in CLAUDE.md env table and `ENV_VAR_CATALOG` (`diag.ts:63`), **read nowhere in `src/`**. (Wiring is §5 Q3; this item marks it "reserved, not yet read by the library" in the docs and the catalog description.)
  - `ctx.queryNaturalLanguage(query, llmProvider?)` — README:74 and :548. Actual: `queryNaturalLanguage(text: string)` (`ManagerContext.ts:1767`); the provider is configured via `ctx.llmQueryPlanner({ llmProvider })` (`:1749`).
  - `ctx.prospectiveMemory.fire()` — README:103. `fire` is private (`ProspectiveMemoryManager.ts:431`); public surface is `scheduleAt`/`scheduleOnEvent`/`scheduleConditional`/`tick`/`onObservation`/`cancel`.
  - `ctx.diagnostics` — README:75 → `ctx.diagnostics()`.
  - CLAUDE.md `MEMORY_SQLITE_AUTO_INDEX` row: values `true`,`false` → code also accepts `'1'` (`PartialIndexAdvisor.ts:76`); superseded by DES-9 wording.
- **Design:** Edit the lines above; add a short "Role profiles" snippet to README showing `resolveRoleProfile(agentType)` / `getRoleProfile('planner')`. Keep README quick-start code otherwise (verified: `autoSearch`, `searchNodes`, `booleanSearch`, `fuzzySearch(query, 0.7)`, `searchNodesRanked(q, undefined, undefined, undefined, 10)`, `activeRetrieval.adaptiveRetrieve` all match signatures).
- **Tests:** none runnable; Checker verifies each named symbol with `grep -rn` in `src/`. Optional guard (S, recommended): `tests/unit/docs/readme-symbols.test.ts` that extracts `ctx.<ident>` tokens from README tables and asserts each is a getter/method on `ManagerContext.prototype` or a documented exception list — keep the exception list empty.
- **Risk:** low. **Effort:** S. **Batch 4** (docs batch; shares README/CLAUDE.md with DES-9/DES-19).

### DES-7 — *(reserved; folded into §5 Q3 — `MEMORY_AGENT_ROLE` wiring needs owner decision)*

### DES-8 — Deprecate `CompressedCache` in favour of `CompressedMap`

- **Evidence:** `src/utils/compressedCache.ts:136` has no `src/` consumer (only `utils/index.ts:71` and a comment at `types.ts:692`); tests exist (`tests/unit/utils/compressedCache.test.ts`, two perf benches). `CompressedMap<K,V>` is the generic replacement already wired (`ManagerContext.ts:567`).
- **Design:** Add `@deprecated Use CompressedMap<string, Entity> (src/utils/compression/CompressedMap.ts). Scheduled for removal in v5.` to the class JSDoc and to the barrel line in `src/utils/index.ts`; do not change behaviour; CHANGELOG `### Deprecated`. No test changes (deprecation does not fail tests; confirm `oxlint` has no `deprecation` rule enabled that would flag the existing test imports — if it does, add a file-level disable in those two test files only).
- **Risk:** low. **Effort:** S.
- **Challenger invariants:** `tests/unit/utils/compressedCache.test.ts` still passes; `bun run lint` clean.

### DES-9 — Resolve CMP-6: formally retire the `MEMORY_SQLITE_AUTO_INDEX` flag

See §4 for the decision rationale. Code part:

- **Files:** `src/core/SQLiteStorage.ts:2282-2309` (`recordFilter`, `partialIndexAdvisorSnapshot`), `src/search/PartialIndexAdvisor.ts:74-78` (ctor env read) and its `@module` tag, `src/cli/commands/diag.ts:44+` (catalog entry), `src/core/ManagerContext.ts` **none**.
- **Design:** (1) `PartialIndexAdvisor` ctor: keep accepting `'true' | '1'` (unchanged), but mark the module `@experimental` → `@internal` *for the env coupling only*: add an explicit `enabled?: boolean` option so callers can construct it without env (additive). (2) `SQLiteStorage`: when the advisor is enabled at construction, `logger.warn` once: "MEMORY_SQLITE_AUTO_INDEX is deprecated and has no effect on query plans: full indexes already cover entityType/projectId/isLatest/contentHash and no in-tree read path records filters. The flag will be removed in v5." (3) Tag `recordFilter` and `partialIndexAdvisorSnapshot` `@internal @deprecated`. (4) `ENV_VAR_CATALOG` description → "Deprecated — no effect (see DESIGN_PASS_2026-11-04 DES-9)". Docs (CLAUDE.md row, README:992, `docs/guides/CONFIGURATION.md`) in Batch 4.
- **Tests:** `tests/unit/search/PartialIndexAdvisor.test.ts` stays green; add "constructs enabled via option without env"; new assertion in an existing SQLiteStorage test file (or new `tests/unit/core/SQLiteStorage.autoIndexDeprecation.test.ts` < 60 lines): with the env set, exactly one warning is logged per storage instance and `close()` still drops `idx_advisor_*` indexes.
- **Risk:** low. **Effort:** S.
- **Challenger invariants:** no warning when the env is unset; warning text names the variable; `recordFilter` still functions (not removed) so any out-of-tree caller is unaffected.

### DES-10 — Resolve OPT-14: batch promotion with per-candidate isolation

- **Evidence:** `ConsolidationPipeline.consolidateSession` (`:282-289`) loops `promoteMemory` per candidate inside try/catch, pushing `Promotion failed for ${name}: ${msg}` and continuing. `promoteMemory` (`:324-367`) does `requireWorkingMemoryEntity` → `storage.updateEntity` (`:362`) → `decayEngine.reinforceMemory` (`:365`), which itself does `accessTracker.recordAccess` (`AccessTracker.ts:115` → `updateEntity` at `:380`) **and** `storage.updateEntity` (`DecayEngine.ts:576`) — **three writes per candidate**. `updateEntities` is all-or-nothing on unknown names (`GraphStorage.ts:1250-1254`). `AccessTracker.recordAccessBatch` (`:155`) is `Promise.all` of singles. The test mock (`ConsolidationPipeline.test.ts:26-54`) has no `updateEntities`.
- **Design:**
  1. Pure helper in `ConsolidationPipeline.ts` (module-private): `buildPromotionUpdates(entity: AgentEntity, targetType: MemoryType, now: string): Partial<AgentEntity>` — the object literal currently at `:331-346`. `promoteMemory` uses it (no behaviour change).
  2. New public method `async promoteMemories(entityNames: string[], targetType: MemoryType): Promise<{ promoted: AgentEntity[]; errors: Array<{ entityName: string; error: string }> }>`:
     - Phase A (validate, isolated): for each name, `try { requireWorkingMemoryEntity(...) } catch (e) { errors.push(...) }`.
     - Phase B (write): compute `now` once; `batch = valid.map(e => ({ name, updates: { ...buildPromotionUpdates(e, targetType, now), ...reinforcementFields } }))` where `reinforcementFields` = exactly what `DecayEngine.reinforceMemory` would write with default options: `lastAccessedAt: now`, `confirmationCount: (e.confirmationCount ?? 0) + 1`. If `hasDeltaPrimitives(this.storage)` (DES-1): `try { await storage.updateEntities(batch, { timestamp: now }) } catch (e) { if (e instanceof EntityNotFoundError) → fall through to per-item loop for the remaining names (one vanished entity must not fail the rest); else rethrow }`. Else per-item `updateEntity` in try/catch (same isolation as today).
     - Phase C (access tracking): `await this.decayEngine.reinforceMemories(promotedNames)` — **new** `DecayEngine.reinforceMemories(names, options?)` that (a) calls `accessTracker.recordAccessBatch(names, { retrievalMethod: 'direct' })` and (b) **skips** the per-entity reinforce write when the caller passes `{ alreadyApplied: true }` (additive option) — because Phase B already wrote the reinforcement fields. Without the flag, `reinforceMemories` applies the reinforcement fields in one `updateEntities` (capability-checked, per-item fallback) so it is a general batch API.
     - `AccessTracker.recordAccessBatch` (`:155`): compute all records in memory, then one `updateEntities` when available (per-item fallback). Keep the in-memory `accessRecords` update identical.
  3. `consolidateSession` `:282-289` → `const { promoted, errors } = await this.promoteMemories(candidates.map(c => c.name), effectiveOptions.targetType); result.memoriesPromoted += promoted.length; result.errors.push(...errors.map(e => \`Promotion failed for ${e.entityName}: ${e.error}\`));` (identical string format).
  4. `executeRule` (`:1305,1312`) keeps calling `promoteMemory` (single) — out of scope.
- **Compat:** `promoteMemory` single-entity signature and semantics unchanged. Event stream changes from 3× `entity:updated` per candidate to 1× (merged update) + 1× (access tracker) per candidate, and with delta-capable storage all candidates' updates arrive as one `updateEntities` call (fsyncs: 2 per session instead of 3N). Document in CHANGELOG `### Changed`. Per-candidate error isolation preserved (Phase A + fallback). Error-string format preserved.
- **Tests:** extend `tests/unit/agent/ConsolidationPipeline.test.ts` or add `ConsolidationPipeline.promoteBatch.test.ts` (< 300 lines): (a) with a real `GraphStorage` (pattern at `:552`) spy `updateEntities` called once for N candidates; (b) one non-working-memory candidate → `errors` has exactly one entry with the legacy string and the others are promoted; (c) mock storage without `updateEntities` (existing `createMockStorage`) → per-item path, same results; (d) `updateEntities` throwing `EntityNotFoundError` mid-batch → remaining names promoted via fallback; (e) resulting entity has `memoryType`, `isWorkingMemory:false`, `promotedAt`, `promotedFrom`, `lastAccessedAt`, `confirmationCount` = old+1 (exactly +1, not +2); (f) `promoteMemory` single path still issues reinforce (existing tests at `:513` etc. stay green). `tests/unit/agent/DecayEngine.test.ts` add: `reinforceMemories([a,b])` equals two `reinforceMemory` calls field-for-field; `{ alreadyApplied: true }` writes nothing but records access. `AccessTracker` tests: batch path writes once on a delta-capable storage.
- **Risk:** med (touches three agent modules; confirmationCount double-increment is the classic bug). **Effort:** M.
- **Challenger invariants:** `confirmationCount` increments by exactly 1 per promotion; `promotedFrom` is the **pre-promotion** `sessionId`; `expiresAt` cleared (`undefined` must actually remove/clear on both backends — check how `updateEntities` treats `undefined` values vs `updateEntity`, both backends); no promotion event ordering regression for `ConsolidationScheduler`; empty candidate list → no storage call; the SQLite backend path.

### DES-11 — Resolve OPT-15: `mergeMemories` delta path with capability fallback

- **Evidence:** `ConsolidationPipeline.mergeMemories` (`:788-910`): updates survivor via `updateEntity` (`:844`), `recordMerge` (`:857`, `appendEntity`), then `loadGraph` + full filter/retarget + `saveGraph` (`:860-894`). `TransactionManager.commit` is also full-graph (`TransactionManager.ts:289-298`), so it is **not** a delta host. The needed primitives exist on both backends: `getRelationsFor(name)` (interface), `deleteEntities(names)` cascading relations and returning them, `appendRelations(relations)`.
- **Design:** inside `mergeMemories`, after `recordMerge`, branch on `hasDeltaPrimitives(this.storage)`:
  ```
  await withStorageWriteLock(this.storage, async () => {
    const mergedNames = entityNames.filter(n => n !== survivor.name);
    const mergedSet = new Set(mergedNames);
    // 1. collect & retarget relations touching merged entities
    const survivorKeys = new Set(storage.getRelationsFor(survivor.name).map(relKey));
    const retargeted: Relation[] = [];
    for (const name of mergedNames) for (const r of storage.getRelationsFor(name)) {
      const from = mergedSet.has(r.from) ? survivor.name : r.from;
      const to   = mergedSet.has(r.to)   ? survivor.name : r.to;
      if (from === to) continue;                       // self-loop
      const key = `${from}|${to}|${r.relationType}`;
      if (survivorKeys.has(key)) continue;             // already on survivor
      survivorKeys.add(key);                           // dedupe within batch
      retargeted.push({ ...r, from, to });
    }
    // 2. delete merged entities (storage cascades their relations)
    await storage.deleteEntities(mergedNames);
    // 3. re-add the retargeted relations
    if (retargeted.length) await storage.appendRelations(retargeted);
  });
  ```
  Else keep the existing `loadGraph`/`saveGraph` block verbatim (mock-storage tests keep passing). `relKey` = existing `relationKeyOf` if exported from `src/utils/relationHelpers.ts` (check; otherwise local).
- **Compat / behaviour notes (document in JSDoc + CHANGELOG):** (a) the legacy path incidentally de-duplicated *unrelated* duplicate relations elsewhere in the graph because it rebuilt the whole relation list through `seenRelations`; the delta path only touches relations incident to merged entities — this is the correct scope. (b) Events: delta path emits `entity:deleted` ×k, `relation:deleted` (cascade), `relation:created` (retargeted), instead of a single `graph:saved`. Subscribers (`TFIDFEventSync`, `GraphRankPrior`, `MaterializedViews`, `BloomPreScreener`) all handle both. (c) Retargeted relations keep their original `createdAt`/metadata (same as before). (d) Not atomic across primitives, same as today's `updateEntity`→`saveGraph` sequence; the write lock prevents interleaving with manager writes in-process.
- **Tests:** new `tests/unit/agent/ConsolidationPipeline.mergeDelta.test.ts` (< 350 lines), parametrised over real `GraphStorage` and `SQLiteStorage` temp files: survivor observations are the union; merged entities gone; relation `A→merged` becomes `A→survivor`; `merged1→merged2` dropped (self-loop); duplicate after retarget collapses to one; a relation already present on the survivor is not duplicated; `saveGraph` spy **not** called; `graph:saved` not emitted, `entity:deleted`/`relation:created` emitted; parity: run legacy path (force via a fake lacking primitives wrapping the real storage) and delta path on identical fixtures and compare `loadGraph()` sorted output. Existing `mergeMemories` tests (`ConsolidationPipeline.test.ts:1106-1400`, mock-based) stay green via fallback.
- **Risk:** med. **Effort:** M. **Depends on DES-1** (helpers) and must land **after DES-10** (same file).
- **Challenger invariants:** three-way merge where survivor is in the middle of a chain; `preserveOriginals`-style callers; segment mode (`MEMORY_STORAGE_SEGMENT_COUNT=4`) where merged entities live in different segments; relation with `from` merged and `to` merged into the *same* survivor → dropped; `autoMergeDuplicates` (`:1019`) still works end-to-end.

### DES-12 — Resolve CMP-8: `ObservationStore` as read-side dedup diagnostics (no write-path change)

- **Evidence:** `ObservationStore` (`src/core/ObservationStore.ts`, `@public`) is a refcounted intern table; `ctx.observationStore` (`ManagerContext.ts:723`) just instantiates it; nothing calls `intern`. The Phase-8 column store already provides the "shadow store" template and a hash-in-place change would alter what `Entity.observations` holds (see §4).
- **Design:** additive `diagnostics(options?: { observationDedup?: boolean })` on `ManagerContext` (`:786`) and `buildDiagnosticsReport` (`src/utils/Diagnostics.ts:70`): when `observationDedup: true` and `storage.cachedGraph` is non-null, build a throwaway `ObservationStore`, `internAll` every entity's observations, and attach `report.observationDedup = store.stats()` (`ObservationStoreStats`: uniqueObservations, totalReferences, dedupRatio, bytesSaved). Default off (O(total observations) cost). Add the field as optional on `DiagnosticsReport`. Update `ObservationStore` header comment (`:9-12`) from "Wiring into EntityManager is a follow-up" to "used by `ctx.diagnostics({ observationDedup: true })`; write-path wiring is an owner decision (DESIGN_PASS §5 Q2)".
- **Tests:** `tests/unit/utils/Diagnostics.test.ts` (extend or new < 100 lines): report has no `observationDedup` by default; with the flag and a 3-entity fixture sharing one string, `totalReferences`=N, `uniqueObservations`=N-2, `dedupRatio` > 1; with no cached graph the field is `undefined`.
- **Risk:** low. **Effort:** S. **After DES-4** (same `diagnostics()` region).
- **Challenger invariants:** `diagnostics()` with no args is byte-identical to today's report shape; the throwaway store does not leak into `ctx.observationStore`.

### DES-13 — CMP-9 subset: pluggable predicate evaluator for conditional prospective memory

- **Evidence:** `ProspectiveMemoryManager.scheduleConditional` (`:176-196`) warns and persists; `shouldFireOnTick` returns `false` for `'conditional'` (`:422-424`); `ProspectiveMemoryConfig` (`:61-65`) has `defaultExpiryHours`, `maxPendingPerSession`, `procedureInvoker`; trigger type `{ kind: 'conditional'; predicate: string; checkIntervalMs?: PositiveInt }` (`src/types/agent-memory.ts:1176`); lifecycle is a discriminated union (`agent-memory.ts:~1220-1226`).
- **Design:**
  1. `ProspectiveMemoryConfig.predicateEvaluator?: (predicate: string, ctx: { entity: ProspectiveEntity; now: Date }) => boolean | Promise<boolean>` (additive).
  2. `shouldFireOnTick` becomes async-capable for the conditional branch (or add a separate `evaluateConditional(entity, now)` called from `tick()` before `shouldFireOnTick`): if no evaluator → `false` (today's behaviour). If `checkIntervalMs` is set and `entity.lifecycle.status === 'pending'` with a new optional `lastCheckedAt?: IsoDateTime` on the **pending** variant only (additive) and `now - lastCheckedAt < checkIntervalMs` → skip. Otherwise call the evaluator; on `true` → fire; on `false` → persist `lastCheckedAt` only when `checkIntervalMs` is set (one `updateEntity`, avoid writes for interval-less predicates); on throw → `logger.warn` once per entity name per process, treat as `false`.
  3. `scheduleConditional` emits the existing warning **only when** no evaluator is configured; update JSDoc.
  4. `ctx.prospectiveMemory` getter (`ManagerContext.ts:1264`): read nothing new from env; evaluators are code-only (mirrors `llmProvider` precedent). Expose through `ManagerContextOptions.prospectivePredicateEvaluator?` (additive) so users of the lazy getter can supply one.
- **Compat:** without an evaluator, behaviour and warning are identical. `ProspectiveEntity` gains one optional field on one union variant.
- **Tests:** extend `tests/unit/agent/ProspectiveMemoryManager.test.ts` (721 lines → add ≤ 120, or new `ProspectiveMemoryManager.conditional.test.ts`): fires when evaluator returns `true`; does not fire on `false`; honours `checkIntervalMs` (two ticks inside the window → one evaluator call); evaluator throw → no fire, one warning, other pending entities unaffected; no evaluator → unchanged + warning on schedule; `maxFireCount`/lifecycle transitions same as time triggers; `ManagerContextOptions.prospectivePredicateEvaluator` reaches the manager.
- **Risk:** low/med. **Effort:** M.
- **Challenger invariants:** `tick()` must not throw when one evaluator rejects; `lastCheckedAt` never appears on `fired`/`expired`/`cancelled` variants; the type union remains exhaustive (`switch` default unreachable); the audit's doc pointer (`MEMORY_TYPES_EXPANSION.md §4.7`) is updated.

### DES-14 — CMP-9 subset: `DiskWarmTier` append + periodic compaction

- **Evidence:** `DiskWarmTier.put` (`src/search/tiered/DiskWarmTier.ts:94-140`) snapshots the whole map and calls `this.flush(cache)` (full rewrite, temp+fsync+rename) on **every** put; header `:7-8` says per-entry append with compaction is not implemented. Base class `MapFileTier<V>` (same dir) owns `ensureLoaded`/`flush`; file format is one `{"k","v"}` object per line.
- **Design:** additive option `DiskWarmTierOptions.compactEvery?: number` (default `undefined` = today's rewrite-every-put). When set: `put` appends one line `{"k":key,"v":value}` (last-wins on load; `MapFileTier` loader must be checked/adjusted to tolerate duplicate keys by overwriting); `delete` appends a tombstone `{"k":key,"d":1}`; a counter triggers a full `flush(cache)` rewrite every `compactEvery` appends and on `clear()`. Loader: skip tombstoned keys; a torn final line is already tolerated by `jsonlRecordFile`/`jsonlMapFile` utilities (verify in `src/utils/jsonlMapFile.ts`). Append uses `fs.appendFile` + optional fsync (match `flush`'s durability: document that between compactions the tail is not fsynced unless `appendSync: true` — or always fsync the append; pick "always fsync" for parity and measure in the test).
- **Compat:** default behaviour unchanged; file remains readable by the current loader because the line shape is identical (tombstones are new and only written when `compactEvery` is set).
- **Tests:** `tests/unit/search/tiered/DiskWarmTier.compaction.test.ts` (< 200 lines): N puts produce N+? lines before compaction and ≤ unique keys after; reload after appends yields last-wins values; tombstoned key absent after reload; crash simulation (truncate last line) still loads; `maxEntries` eviction still calls `onEvict` under append mode; existing `tests/unit/search/tiered/*` green.
- **Risk:** med (file format + base class). **Effort:** M. **Batch 3**.
- **Challenger invariants:** `TieredIndex` cascade (hot→warm→cold) still correct with append mode; `getEvictionCount` unchanged; two `put`s of the same key in one tick → one logical entry; cold-tier spill of an evicted key that also has a tombstone in warm.

### DES-15 — Shared test fixtures: `tests/helpers/`

- **Evidence:** §2.2 last row. 33 `createMockStorage` definitions; `ConsolidationPipeline.test.ts:26-54` and `DecayEngine.test.ts:23-60` differ in `getEntityByName` missing-value (`undefined` vs `null`) and in which methods exist.
- **Design:** new `tests/helpers/mockStorage.ts` (< 150 lines): `createInMemoryStorageFake(entities?, opts?: { withDeltaPrimitives?: boolean })` returning an `IGraphStorage` fake with `getEntityByName`/`hasEntity`/`updateEntity`/`appendEntity`/`appendRelation`/`loadGraph`/`saveGraph`/`getRelationsFor`/`events` (real `GraphEventEmitter`) and, when `withDeltaPrimitives`, `updateEntities`/`deleteEntities`/`appendRelations`/`deleteRelations` with faithful semantics (all-or-nothing on unknown names, cascade on delete). New `tests/helpers/tempStorage.ts` (< 80 lines): `makeTempDir(prefix)`, `makeTempJsonlPath()`, `makeTempSqlitePath()`, `withBothBackends(name, fn)` (vitest `describe.each` over `GraphStorage`/`SQLiteStorage` factories with cleanup). Migrate **only** the test files touched by this pass (DES-10, DES-11, DES-13 new tests use the helpers); do not mass-migrate the 33 files. Ensure `vitest.config` `include` does not match `tests/helpers/**` (files are not `*.test.ts`; confirm).
- **Compat:** tests only. **Tests:** `tests/helpers/__tests__/mockStorage.test.ts` (< 100 lines) asserting the fake's all-or-nothing and cascade semantics match the real backends on a tiny fixture (this is the fixture's own contract test).
- **Risk:** low. **Effort:** S/M. **Batch 1** (no src files).
- **Challenger invariants:** helper names do not collide with exported `src/` symbols (the duplicate check scans `src/` only — verify `tools/create-dependency-graph` scope; if it includes `tests/`, choose distinctive names); coverage config excludes `tests/helpers`.

### DES-16 — *(DEFER — agent-layer typed errors; see §5 Q4)*

### DES-17 — *(finding only — stability tags; see §2.2)*

### DES-18 — *(folded into DES-1 step 4 — `TransactionManager`/`BatchTransaction` accept `IGraphStorage`)*

### DES-19 — Document real transaction/rollback boundaries

- **Evidence:** §2.2 "Transaction semantics". `GovernanceManager.withTransaction` JSDoc (`:375`) and CLAUDE.md ("`withTransaction`/`rollback`") read as if atomic.
- **Design:** JSDoc on `withTransaction` (`GovernanceManager.ts:~370-488`): "Groups operations for audit attribution; each operation persists immediately. On throw, already-committed audit entries are marked `rolled_back` via `markRolledBack()`; storage is **not** reverted. For atomic multi-operation writes use `ctx.batch()` (`BatchTransaction`, holds `graphMutex` across load→apply→save) or `TransactionManager.commit()` (full-graph save with backup-based rollback)." Same paragraph in `docs/architecture/API.md` (governance section) and CLAUDE.md "Governance" bullet (`:203`). Add a one-line note to `TransactionManager.commit` JSDoc that it is O(graph) by design.
- **Tests:** none (docs/JSDoc). **Risk:** low. **Effort:** S. **Batch 4**.
- **Challenger invariants:** no code change; `repo-tools check` tables unaffected by comment edits (verify).

---

## 4. Resolution of the five deferred audit items

| Item | Decision | Where |
|---|---|---|
| **OPT-14** (batch `promoteMemory`) | **BUILD.** Per-candidate isolation is preserved by validating each candidate in its own try/catch *before* a single `updateEntities`, and by falling back to per-item writes if the batch throws `EntityNotFoundError` (the only all-or-nothing failure the primitive raises). Error strings are byte-identical. Event order changes from 3 writes per candidate to one merged write per candidate (+1 access-tracker write), all `entity:updated`; no subscriber depends on the 3-event cadence (grep `promotedAt` in `src/` subscribers → none). | DES-10 |
| **OPT-15** (`mergeMemories` delta) | **BUILD, not via `TransactionManager`.** `TransactionManager.commit` is itself a full `saveGraph` (`TransactionManager.ts:289-298`), so it cannot deliver O(k). The correct host is the existing primitives under `graphMutex`: `getRelationsFor` → `deleteEntities` (cascades) → `appendRelations`, with capability fallback to today's path for fakes. Atomicity across the three primitives is the same as today's `updateEntity`→`saveGraph` pair (not atomic across the boundary); the write lock excludes in-process interleaving. | DES-11 |
| **CMP-6** (`PartialIndexAdvisor`) | **RETIRE the flag; keep the class.** Verified: the only entity-filtering SQL is `getSessionEntities` (`SQLiteStorage.ts:1976-2010`, `WHERE sessionId … [AND role]`), covered by `idx_entities_session_created_at` (`:590`), plus `contentHash = ?` (`:1967`, `idx_entities_content_hash` `:750`). `getEntitiesByType` is in-memory (`:1928`). Full indexes on `entityType`, `projectId`, `isLatest` exist (`:577-580,748-749`). Partial indexes on hot `entityType`/`projectId` values would duplicate full indexes. Wiring `recordFilter` into `getSessionEntities` would only ever produce `sessionId` recommendations that the composite index already serves. → Deprecate `MEMORY_SQLITE_AUTO_INDEX` with a one-time warning; docs say "no effect"; owner question on v5 removal (§5 Q1). | DES-9 |
| **CMP-8** (`ObservationStore` → `EntityManager`) | **Neither shadow-store nor hash-in-place this pass.** Shadow-store already exists as `JsonlColumnStore` (Phase 8) and interning strings in RAM alongside the `GraphStorage` cache would not reduce the cache's own copies without restructuring `cache: KnowledgeGraph` (`GraphStorage.ts:240`). Hash-in-place changes the public `Entity.observations` contract. What *is* missing is the number that would justify either: the real dedup ratio. → Build the measurement (`ctx.diagnostics({ observationDedup: true })`) and ask the owner (§5 Q2). | DES-12 |
| **CMP-9** (architectural follow-ups) | **Split.** (a) Conditional prospective predicates → **BUILD** as a pluggable evaluator (DES-13); a built-in DSL is §5 Q5. (b) `DiskWarmTier` compaction → **BUILD** behind an opt-in `compactEvery` (DES-14). (c) `TieredIndex` ↔ `OptimizedInvertedIndex` → **DEFER**: `OptimizedInvertedIndex` has zero constructors in `src/` (grep), so there is no consumer to wire *either* side into; owner must decide whether OII is kept (§5 Q6). (d) `CompressedMap` ↔ `GraphStorage.cache` → **DEFER**: requires per-entity cache restructuring of `GraphStorage` (`:240`), a storage-internals change with broad blast radius. (e) Segment consistent hashing → **DEFER**: `ISegmentStorage.ts:21-24` states the routing rule is stable because changing it invalidates on-disk segments; a change needs a router-version field in `_manifest.json` plus a `tools/segment-jsonl` re-shard mode — owner scope (§5 Q6). | DES-13, DES-14, §5 |

---

## 5. Deferred items / owner questions

| # | Question | Context | Default if unanswered |
|---|---|---|---|
| Q1 | Remove `MEMORY_SQLITE_AUTO_INDEX`, `SQLiteStorage.recordFilter`, `partialIndexAdvisorSnapshot` in v5.0.0, keeping `PartialIndexAdvisor` as a standalone `@experimental` utility? | DES-9 deprecates with a warning only. | Keep deprecated indefinitely. |
| Q2 | After DES-12 ships, if `dedupRatio` on real workloads is > ~1.5, do you want (a) hash-in-place (`Entity.observations` stores hashes; breaking for readers of the raw field) or (b) an in-cache intern pool inside `GraphStorage` (invisible to the API, needs per-entity cache restructuring)? | CMP-8. | No write-path wiring. |
| Q3 | `MEMORY_AGENT_ROLE` is catalogued but never read. Wire it (apply `resolveRoleProfile(role).salienceWeights` as defaults in `ctx.salienceEngine` and budget splits in `ctx.contextWindowManager` when no explicit config is given), or drop it from the catalog and docs? | `RoleProfiles.ts:163-215` has the profiles; the shape vs `SalienceEngine` config needs verification before building. | DES-6 documents it as "reserved; not yet read". |
| Q4 | Convert the agent layer's `throw new Error(\`Entity not found: ${name}\`)` (8 sites: `workingMemoryGuard.ts:26`, `DecayEngine.ts:547`, `ConsolidationPipeline.ts:801` (variant text "Entity not found or not AgentEntity"), `SessionManager.ts` ×2, `SessionCheckpoint.ts`, `ProcedureManager.ts`, `FreshnessManager.ts`) to `EntityNotFoundError`? The message changes to `Entity "x" not found` and ≥ 10 tests assert the old text with exact regexes (`WorkingMemoryManager.test.ts:915,929,952`, `ConsolidationPipeline.test.ts:513`, `workingMemoryGuard.test.ts:65,90`, …). | Would unify error handling (`instanceof KnowledgeGraphError`, `code: ENTITY_NOT_FOUND`) but requires rewriting those assertions. Alternative: add an optional `message` override to `EntityNotFoundError` to keep text byte-identical. | Not built. |
| Q5 | Should conditional prospective predicates get a built-in evaluator (e.g. a tiny safe expression DSL over entity fields / observation substring match), or stay code-only (DES-13)? | A DSL is a new surface with security review implications. | Code-only. |
| Q6 | (a) `OptimizedInvertedIndex` has no `src/` consumer — keep, wire into `BM25Search`/`TFIDFIndexManager`, or deprecate? (b) Widen `EntityManager`/`RelationManager`/`ObservationManager`/`HierarchyManager` constructor types from `GraphStorage` to `IGraphStorage` (they use `getLowercased`, `getEntitiesByObservationWord`, etc. — some only on JSONL)? (c) Segment router versioning + re-shard tool? | DES-1 widens only `TransactionManager`/`BatchTransaction`. | Leave as-is. |

Also deferred from the audit and unchanged here: DOC-10 (tool sub-package `better-sqlite3` bump).

---

## 6. Implementation plan (parallel batches, disjoint files)

Within a batch items touch disjoint files and can run concurrently. Each Builder: read CLAUDE.md, read the item, implement, run `bun run typecheck && bun run lint && bunx vitest run <named tests>`. Do not edit CHANGELOG.md or docs in Batches 1-3 (Batch 4 owns them) — instead append your CHANGELOG line to the PR/commit description for the Batch 4 Builder.

### Batch 1 — Foundations (start immediately)

| Item | Files | Effort/Risk |
|---|---|---|
| **DES-1** | `src/types/types.ts` (IGraphStorage, ~`:1309`), new `src/core/storageCapabilities.ts`, `src/core/index.ts`, `src/core/EntityManager.ts:297,311,333`, `src/core/RelationManager.ts:64,78`, `src/core/TransactionManager.ts:57-58,192,438`, `src/core/ManagerContext.ts:776` (**one-line cast removal only**), new `tests/unit/core/storageCapabilities.test.ts`, `tests/unit/exports-barrels.test.ts`. *Leave `ObservationManager.ts:111` for DES-3's Builder to switch (same file).* | S/M, low |
| **DES-2** | new `src/utils/envConfig.ts`, `src/utils/index.ts`, `src/core/GraphStorage.ts:65-80,665-667`, `src/agent/procedural/graph/backing/JsonlProceduralGraphBacking.ts:90-100`, `src/core/SQLiteStorage.ts:2238-2240`, `src/search/TFIDFEventSync.ts:130-132`, `src/utils/CachePressureCoordinator.ts:69-78`, `src/search/QueryLogger.ts:57`, new `tests/unit/utils/envConfig.test.ts`. *Not `ManagerContext.ts`, not `PartialIndexAdvisor.ts`, not `ObservationManager.ts` (DES-3 switches `:419,568,697` to `readEnvStrictFlag`).* | M, low/med |
| **DES-8** | `src/utils/compressedCache.ts` (JSDoc), `src/utils/index.ts:71` (JSDoc on the export line — coordinate with DES-2, which adds a new export line to the same barrel; trivial merge). | S, low |
| **DES-15** | new `tests/helpers/mockStorage.ts`, `tests/helpers/tempStorage.ts`, `tests/helpers/__tests__/mockStorage.test.ts`; verify `vitest.config.*` include/exclude. | S/M, low |

Ordering constraint inside Batch 1: DES-2 and DES-8 both touch `src/utils/index.ts` — DES-8 only annotates an existing line; land DES-2 first or merge by hand.

### Batch 2 — Wiring (after Batch 1 is green)

| Item | Files | Effort/Risk |
|---|---|---|
| **DES-3** | `src/core/ObservationManager.ts` (`:111` probe → DES-1 helper; `:419,568,697` → `readEnvStrictFlag`; emit at `:681` and after `:872` with captured removed lists), `src/core/TransitionLedger.ts:391-412`, `tests/unit/core/ObservationManager*.test.ts` (or new `ObservationManager.events.test.ts`), `tests/unit/agent/ObserverPipeline.test.ts` (+1 integration test). | S, low/med |
| **DES-4 + DES-5** | new `src/core/context/StorageInfraFacade.ts`, new `src/utils/sidecarPath.ts`, `src/utils/index.ts` (add export), `src/core/ManagerContext.ts` (getters `:473-481,517-547,567-588,626-647`, `searchManager` wiring `:608-611`, `diagnostics()` `:800-810`, `close()` `:1809-1814`, constructor sidecar lines `:286-294`, governance sidecar `:388-394`, private env helpers `:1531,1829,1864` → delegate), new `tests/unit/core/context/StorageInfraFacade.test.ts`, new `tests/unit/utils/sidecarPath.test.ts`. | M, med |
| **DES-10** | `src/agent/ConsolidationPipeline.ts` (`:282-289`, `:324-367`, new `promoteMemories`, helper), `src/agent/DecayEngine.ts` (new `reinforceMemories`, `ReinforcementOptions.alreadyApplied?`), `src/agent/AccessTracker.ts:155-157,372-385`, `src/agent/index.ts` (types if new ones exported), tests: `tests/unit/agent/ConsolidationPipeline.promoteBatch.test.ts` (new), `tests/unit/agent/DecayEngine.test.ts`, `tests/unit/agent/AccessTracker*.test.ts`. | M, med |
| **DES-9 (code)** | `src/search/PartialIndexAdvisor.ts:60-80` (+ `enabled?` option, tags), `src/core/SQLiteStorage.ts` (one-time warning near advisor construction; `@internal @deprecated` on `:2282,2305`), `src/cli/commands/diag.ts` (catalog description), `tests/unit/search/PartialIndexAdvisor.test.ts`, new small SQLite deprecation test. | S, low |
| **DES-13** | `src/agent/ProspectiveMemoryManager.ts` (`:61-65` config, `:176-196`, `:237-245` tick, `:410-425`), `src/types/agent-memory.ts` (`lastCheckedAt?` on pending variant ~`:1221`), `src/core/ManagerContext.ts` **only** the `prospectiveMemory` getter `:1264-1287` and `ManagerContextOptions` (coordinate with DES-4: DES-4 owns all other MC regions; sequence DES-13's MC edit after DES-4 lands or hand-merge — the regions do not overlap), tests: `ProspectiveMemoryManager.conditional.test.ts` (new). | M, low/med |

Ordering constraints: DES-13's two-line `ManagerContext` edit lands after DES-4 (or is hand-merged; non-overlapping regions). DES-3 and DES-2 both edit `ObservationManager.ts` env gates — DES-2 was told not to, so no conflict.

### Batch 3 — Follow-ons (after Batch 2)

| Item | Files | Effort/Risk |
|---|---|---|
| **DES-11** | `src/agent/ConsolidationPipeline.ts:788-910` (after DES-10 in the same file), new `tests/unit/agent/ConsolidationPipeline.mergeDelta.test.ts` (uses `tests/helpers/tempStorage.ts`). | M, med |
| **DES-12** | `src/utils/Diagnostics.ts:50-80`, `src/core/ManagerContext.ts:786-812` (after DES-4), `src/core/ObservationStore.ts:9-12` (comment), `tests/unit/utils/Diagnostics*.test.ts`. | S, low |
| **DES-14** | `src/search/tiered/DiskWarmTier.ts`, `src/search/tiered/MapFileTier.ts` (or wherever `flush`/`ensureLoaded` live — Builder verifies), possibly `src/utils/jsonlMapFile.ts` (read-only unless tombstone parsing needs it), new `tests/unit/search/tiered/DiskWarmTier.compaction.test.ts`. | M, med |

### Batch 4 — Docs, changelog, gates (after Batch 3)

| Item | Files |
|---|---|
| **DES-6** | `README.md:74,75,93,103,548,992`, `CLAUDE.md:146,212` + env table rows (`MEMORY_SQLITE_AUTO_INDEX`, `MEMORY_AGENT_ROLE` "reserved"), optional `tests/unit/docs/readme-symbols.test.ts`. |
| **DES-9 (docs)** | `CLAUDE.md` row, `README.md:992`, `docs/guides/CONFIGURATION.md`. |
| **DES-19** | `src/features/GovernanceManager.ts` JSDoc (`withTransaction`), `src/core/TransactionManager.ts` JSDoc (`commit`), `docs/architecture/API.md` governance section, `CLAUDE.md:203`. |
| **CHANGELOG** | `CHANGELOG.md` `[Unreleased]`: `### Added` (DES-1 helpers + interface members, DES-2 `envConfig`, DES-3 events, DES-10 `promoteMemories`/`reinforceMemories`, DES-11 delta merge, DES-12 `diagnostics({observationDedup})`, DES-13 `predicateEvaluator`, DES-14 `compactEvery`), `### Changed` (DES-10 event cadence, DES-11 event stream), `### Deprecated` (DES-8, DES-9), `### Fixed` (DES-6 docs). |
| **Gates** | `bun run tools:deps` (regenerates `DEPENDENCY_GRAPH.md`, `file-inventory.json`), `bun run tools:check-census`, `bun run tools:check-duplicates`, then `repo-tools map . --out=<dir>` and refresh the `totalExports`/`totalSourceFiles` rows in the six `docs/architecture/*.md` verification tables (API.md:2293-2294 and the five others listed by `grep -l "repo-tools map" docs/architecture/*.md`), then `repo-tools check . --docs=docs/architecture`. New files from this pass: `src/core/storageCapabilities.ts`, `src/utils/envConfig.ts`, `src/utils/sidecarPath.ts`, `src/core/context/StorageInfraFacade.ts` (+ tests). |

---

## 7. Verification plan for the Checker

Run in this order; stop at the first red.

1. **Static gates:** `bun run typecheck`, `bun run lint` (both project rules: `src/types` leaf — DES-1 adds only type members and a structural `graphMutex` type, no imports; `storage.updateEntity()` results never discarded — DES-10/DES-11 call `updateEntities`/`updateEntity`, check every new call either uses the result or carries the documented `eslint-disable` comment with justification), `bun run build` (dts emit + `scripts/check-exports.mjs`).
2. **Duplicate/census gates:** `bun run tools:check-duplicates` (no new TRUE_DUPLICATE beyond `duplicate-baseline.json`); `bun run tools:check-census`; `repo-tools check . --docs=docs/architecture` after the Batch 4 table refresh.
3. **Full test run:** `SKIP_BENCHMARKS=true bun run test` — baseline 405 files / 10,270 tests must all pass; count must **increase** by the new files (expect ≥ 12 new test files). No `it.skip`/`describe.skip`/`.only` introduced (`grep -rn "\.skip(\|\.only(" tests/ | diff` against baseline).
4. **Per-item spot checks:**
   - DES-1: `grep -rn "as Partial<GraphStorage>" src/` → 0 hits; `grep -rn "as GraphStorage" src/core/ManagerContext.ts` → only `:302` (constructor) and `:704` (materializedViews) remain (not in scope).
   - DES-2: `grep -rn "SEGMENT_COUNT_PATTERN" src/` → exactly one definition; `grep -rn "parseInt(raw" src/` → 0; each migrated site's old behaviour pinned by `envConfig.test.ts` matrix.
   - DES-3: `grep -rn "emitObservationAdded\|emitObservationDeleted" src/` → ≥ 2 call sites in `ObservationManager.ts`; `grep -n "observation:" src/core/TransitionLedger.ts` → 0 subscriptions; run `tests/unit/core/TransitionLedger.test.ts`, `tests/unit/agent/ObserverPipeline.test.ts`, `tests/unit/search/RankedSearch*.test.ts` individually.
   - DES-4/5: `wc -l src/core/ManagerContext.ts` ≤ 1750; all five wiring tests listed in DES-4 pass unchanged (git diff on those test files must be empty); `ctx.diagnostics()` on a fresh context with all four flags `'true'` does not construct anything (spy on constructors or check private fields via the facade's `peek*`).
   - DES-9: with `MEMORY_SQLITE_AUTO_INDEX=true` exactly one `logger.warn` per `SQLiteStorage` instance; without it none.
   - DES-10: on real `GraphStorage`, spy `updateEntities` called once for 5 candidates; `confirmationCount` +1 exactly; one invalid candidate → `errors.length === 1` with text `Promotion failed for <name>: Entity is not working memory: <name>`; same suite on `SQLiteStorage`.
   - DES-11: parity test (legacy vs delta) passes on both backends; `saveGraph` spy not called on delta path; `MEMORY_STORAGE_SEGMENT_COUNT=4` variant passes.
   - DES-12: `ctx.diagnostics()` JSON shape unchanged (snapshot against pre-change report keys).
   - DES-13: without evaluator, `scheduleConditional` still warns once and `tick()` never fires conditionals (existing tests `ProspectiveMemoryManager.test.ts:163-171,297` green).
   - DES-14: default (no `compactEvery`) produces byte-identical files to pre-change for the same put sequence (hash compare in test).
   - DES-6: for each of `RoleProfileManager`, `prospectiveMemory.fire`, `queryNaturalLanguage(query, llmProvider`, `ctx.diagnostics |` run `grep -rn` across `README.md CLAUDE.md docs/` → 0 hits.
5. **Behavioural regression sweep:** run `tests/integration/**` and `tests/edge-cases/**` explicitly; run the four `*-wiring.test.ts` files with and without their env flags set in the shell to confirm env isolation.
6. **CHANGELOG completeness:** every DES id built appears exactly once under `[Unreleased]`; deprecated items under `### Deprecated`.
