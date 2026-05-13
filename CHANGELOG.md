# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (Failure Memory — Phase 2 Sprint 4)

- **`MemoryType` union extended with `'failure'`**: closes Phase 2 Sprint 4 of the memory-types expansion (see [`docs/roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md`](docs/roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md) §4 Priority 1 / Type 9). The catalog frames failure memory as "the single biggest concrete win available to most agentic systems" because a structured pre-task lookup of "what failed when I tried similar work before" prevents the most common class of agentic regression.
- **New types** in `src/types/agent-memory.ts`:
  - `FailureLifecycle` — discriminated union (`{ status: 'open' }` | `{ status: 'resolved'; resolvedAt; resolvedReason? }`), mirrors the `ProspectiveLifecycle` pattern so illegal states like `{ status: 'open', resolvedAt: '...' }` are unrepresentable
  - `FailureRecord` — structured failure with `context` / `attempted` / `failure_mode` / `root_cause` / `alternative_taken?` / `applicability_hint` (the retrieval key) / `lifecycle` / `sourceSessionId?`
  - `FailureEntity` extending `AgentEntity`; `isFailureMemory` type guard; `FailureMemoryEntity` alias
  - `MarkResolvedResult` discriminated union (`'resolved' | 'already-resolved' | 'not-found' | 'vanished-mid-update'`) — mirrors `CancelResult` pattern; distinguishes 404 / 409 / TOCTOU race from successful resolve
- **`FailureManager`** in `src/agent/FailureManager.ts`:
  - `record(input, options?)` — validates non-empty strings on five required fields with received-type/value in error messages; wraps `storage.appendEntity` failures with the failure id so EPERM-style races are attributable (CLAUDE.md > Gotchas > Windows atomic writes)
  - `lookupForTask(taskContext, options?)` — substring-match MVP scoring (`applicability_hint` 3×, `context` 2×, `attempted` 1×); excludes resolved by default; `status: 'all'` includes both. JSDoc documents the MVP cliffs (single-char tokens dropped, no stemming) + the `SearchManager.semanticSearch` upgrade path
  - `markResolved(id, reason?)` — returns `MarkResolvedResult`; branches on `storage.updateEntity`'s `Promise<boolean>` return (Sprint 2's silent-failure pattern) to surface `'vanished-mid-update'` separately from `'not-found'` / `'already-resolved'`
  - `getAll(options?)` — filter by `status` and/or `sourceSessionId`
  - Embeddings deliberately NOT on the public `FailureRecord` surface (encapsulation per type-design review) — semantic similarity is delegated to the downstream `SearchManager` / `VectorStore` when the integration upgrade lands
- **`ctx.failureManager`** lazy getter on `ManagerContext` with `MEMORY_FAILURE_LOOKUP_LIMIT` env var (default `5`)
- **29 new tests** in `tests/unit/agent/FailureManager.test.ts`: `record()` (8 cases incl. validation, append-error wrapping, received-value error context) / `lookupForTask()` (6) / `markResolved()` (5 incl. all 4 discriminated returns) / `getAll()` (3) / type guard (3) / non-empty validation per required field
- **Reviewed**: pre-implementation type-design review reshaped the original draft (flat status → discriminated union; dropped `embedding` from public surface; dropped duplicated `tags`; mandatory non-empty validation). Post-implementation: code-reviewer flagged 1 BLOCKING (`ManagerContext` getter ordering — JSDoc detachment) + 1 HIGH (boolean → discriminated) + 2 MEDIUM/LOW; silent-failure-hunter flagged 1 HIGH (`updateEntity` boolean ignored) + 2 MEDIUM (error context, append wrapping) + 1 LOW (superfluous `await`). All applied; re-review clean. Code-simplifier flagged 8 cleanups; 6 applied (filter collapse, dead bindings, mock plumbing, type-guard cast), 2 deferred (`FailureMemoryEntity` alias retained for consistency with sibling memory-type aliases)
- **Verification**: 218/218 tests pass across `FailureManager` (29 new) + `ProspectiveMemoryManager` (51) + `FailureDistillation` (21) + `ManagerContext` (117); typecheck clean

### Added (ContextWindowManager.wakeUp — L1.5 prospective layer)

- **L1.5 layer in `ContextWindowManager.wakeUp()`** surfaces pending prospective intentions in the agent's wake-up context. Closes Sprint 3 of 3 for the prospective-memory integration; the full memory-type addition (manager → context wiring → consolidation stage → wake-up surface) is now complete.
- **`WakeUpOptions` extended** (backward-compatible — new fields are optional):
  - `maxL1_5Tokens?: number` (default 200) — token budget for the pending-intentions block
  - `includeL1_5?: boolean` (default true) — disable L1.5 entirely
  - `sessionId?: string` — filter L1.5 to one session (when omitted, all sessions)
- **`WakeUpResult` extended** (backward-compatible — new fields added, no existing fields renamed or removed):
  - `l1_5: string` — formatted pending-intentions block
  - `pendingIntentionCount: number` — count of intentions surfaced
- **Per-intention line format**: `[at <iso>] content` (time) / `[window <from> → <until>] content` (time-window) / `[event: text=... tags=... type=... session=...] content` (event — lists ALL populated condition fields per silent-failure-hunter review) / `[conditional: <predicate>] content` (conditional).
- **Token estimation reuses** the per-line `l1_5Tokens` accumulator rather than re-estimating the joined string in the total — saves one pass and matches the existing L1 pattern.
- **Error handling** mirrors L0 / L1 exactly: try/catch wraps the entire L1.5 block, missing-module errors are guarded (no noisy log when `ProspectiveMemoryManager` is absent from a partial build), all other errors are logged via `logger.error` and the layer falls back to empty defaults so wake-up continues to L1.
- **Future-safe formatting**: trigger-kind dispatch is an exhaustive `switch` with a `_exhaustive: never` check — adding a new trigger kind to the `ProspectiveTrigger` union becomes a compile-time error in `ContextWindowManager.ts`. `TriggerCondition` field-rendering is documented with a "keep in sync with `TriggerConditionFields`" comment for the same reason.
- **10 new tests** in `describe('L1.5 — pending prospective intentions')`: empty when no pending / surfaces time-based / sorts by next-fire-time / filters by sessionId / includes all sessions when sessionId omitted / respects `maxL1_5Tokens` budget / `includeL1_5: false` skips the block / excludes fired / cancelled / expired intentions / formats event-trigger prefix with all populated condition fields / `l1_5` token count contributes to `totalTokens`.
- **Reviewed**: code-reviewer found one MEDIUM (missing-module guard) + two LOWs (exhaustive switch, drop `void e1` workaround); silent-failure-hunter found one MEDIUM (lossy event prefix); re-review after fixes flagged one LOW (future-proof `formatCondition` against new fields) — all applied. Code-simplifier flagged token double-counting + repeated `amm` declarations — both applied; rejected the `never` removal and the `Partial<{...}>` inlining (would have removed compile-time safety / required exporting an internal type).
- **Verification**: 14/14 wake-up tests pass; 121/121 across the four ContextWindowManager + ProspectiveMemoryManager test files; typecheck clean.

### Added (ConsolidationPipeline.ProspectivePromotionStage)

- **`ProspectivePromotionStage`** exported from `src/agent/ConsolidationPipeline.ts`: new `PipelineStage` that scans storage for fired prospective intentions whose `action.kind === 'inject-context'` and promotes them to `memoryType: 'episodic'` with a `prospective-fulfilled` tag. Closes Sprint 2 of 3 for the prospective-memory integration; see `docs/roadmap/MEMORY_TYPES_EXPANSION.md` §4.3 row "ConsolidationPipeline".
- **Semantics**: only `inject-context` actions get promoted — they have content payload worth archiving as episodic memory. `invoke` and `tag-related` actions are side-effect-only and stay untouched (the user can still query them via `getFired()` for audit; they just don't appear in episodic search).
- **Idempotent**: `isProspectiveMemory()` rejects entities whose `memoryType` is already `'episodic'`, so re-running the stage on a fulfilled entity is a no-op. The `prospective-fulfilled` tag is also deduped via `Array.from(new Set(...))`.
- **Self-sufficient**: the stage's `entities` argument from the pipeline is intentionally unused — prospective intentions aren't in the working-memory candidate set, so the stage scans storage directly. The pattern mirrors the existing `executeRuleStage` self-sufficiency.
- **Failure semantics**: per-entity try/catch surfaces all errors on `StageResult.errors` and the batch continues. `storage.updateEntity` returning `false` (entity vanished mid-batch — concurrent delete / governance rollback / segment flush) is also surfaced as an error rather than being silently counted as transformed. Error messages include `fireCount` and `action.kind` for debuggability.
- **12 new tests** (`tests/unit/agent/ConsolidationPipeline.test.ts > ProspectivePromotionStage`): promotes inject-context fires / does NOT promote invoke / does NOT promote tag-related / does NOT promote pending / does NOT promote expired or cancelled / idempotent on re-run / preserves existing tags / processes multiple in one pass / aggregates throw errors / aggregates vanished-mid-batch errors / error messages include context / stage `name` contract.
- **Mock-storage update**: the shared `createMockStorage` helper in this test file now returns `boolean` from `updateEntity` matching real `GraphStorage.updateEntity` and `SQLiteStorage.updateEntity` semantics. Existing 78 tests in this file unaffected.
- **Reviewed**: code-reviewer "ship it" (one LOW on JSDoc verbosity — within local convention, deferred); silent-failure-hunter caught HIGH (`updateEntity` boolean return ignored) + MEDIUM (error-message context) — both fixed and re-reviewed clean; code-simplifier flagged dynamic `import()` in tests as over-engineering — replaced with static import.
- **Verification**: 90/90 ConsolidationPipeline tests pass; typecheck clean.

### Added (ManagerContext.prospectiveMemory lazy getter)

- **`ctx.prospectiveMemory`** lazy getter on `ManagerContext` (`src/core/ManagerContext.ts`): closes D1 of [`docs/roadmap/MEMORY_TYPES_EXPANSION.md`](docs/roadmap/MEMORY_TYPES_EXPANSION.md) §6 — wires `ProspectiveMemoryManager` with a `procedureInvoker` closure that delegates to `procedureManager.invoke()` and throws on `found: false`, so the rejection surfaces via `FiredEvent.invocationError` per the existing contract.
- **Two new env vars** (consumed by the getter):
  - `MEMORY_PROSPECTIVE_DEFAULT_EXPIRY_HOURS` (default `168`)
  - `MEMORY_PROSPECTIVE_MAX_PENDING_PER_SESSION` (default `100`)
- **8 new tests** (`tests/unit/core/ManagerContext.test.ts > prospectiveMemory lazy getter`): lazy memoization, deferred construction (no `_prospectiveMemory` until first access), end-to-end schedule + read-back, both env vars honoured individually, defaults when env vars are unset, DI fire-success when procedure exists, DI not-found surfaces as `FiredEvent.invocationError` while the entity still transitions through the fire path.
- **Idiomatic conformance**: getter uses `this.getEnvNumber()` private helper (matches the 30+ sibling call sites in the same file); closure captures `this.procedureManager` lazily so the procedural manager doesn't materialize until first fire, not first prospective-getter access.
- **Reviewed**: code-reviewer flagged one MEDIUM (`getEnvNumber` swap) — applied + re-reviewed clean; code-simplifier suggested three concrete cleanups (drop dead local binding, trim JSDoc, drop test comment cruft) — all applied; `withEnv` test helper deferred to match the existing `cachePressure` block convention in the same file.
- **Verification**: 168/168 tests pass across `ManagerContext` (117 incl. 8 new) and `ProspectiveMemoryManager` (51); typecheck clean.

### Added (ProcedureManager.invoke — bridge for ProspectiveMemoryManager)

- **`ProcedureManager.invoke(procedureId): Promise<InvocationResult>`** (`src/agent/procedural/ProcedureManager.ts`): resolves a procedure id to an `InvocationResult` discriminated union — `{ found: false, procedureId, invokedAt }` or `{ found: true, procedureId, procedure, invokedAt, openSequencer }`. Used by `ProspectiveMemoryManager`'s `procedureInvoker` callback (D1 in [`docs/roadmap/MEMORY_TYPES_EXPANSION.md`](docs/roadmap/MEMORY_TYPES_EXPANSION.md) §6): the wired invoker calls `invoke()`, throws on `found: false`, and the throw surfaces via `FiredEvent.invocationError` per the existing contract.
- **`InvocationResult` discriminated union** — narrowing makes `procedure` and `openSequencer` non-optional on the `found: true` branch without caller-side non-null assertions. `openSequencer` is a factory (not a stateful field) so multiple sequencers per invocation are explicit.
- **Semantics — "resolve-and-prepare", NOT "execute"**: `ProcedureStep.action` is a string identifier (e.g. `"http.get"`), not executable code. The library is action-agnostic; the caller drives downstream iteration via `result.openSequencer()`. JSDoc on both `invoke()` and `InvocationResult` calls this out so a future reader doesn't assume "invoke = run all steps".
- **6 new tests** (`tests/unit/agent/ProcedureManager.test.ts`): `found: true` with sequencer factory / `found: false` for unknown id / valid `invokedAt` timestamp / fresh sequencer at cursor 0 / independent sequencers per `openSequencer()` call / independent invocations on repeated `invoke()`.
- **Reviewed**: pre-implementation type-design review reshaped the original optional-fields proposal into the discriminated union; post-implementation code-reviewer and silent-failure-hunter both passed clean across all severities; code-simplifier found nothing material.
- **Verification**: 28/28 `ProcedureManager` tests pass; typecheck clean.

### Changed (Prospective memory — review-batch hardening)

Follow-up to the initial `ProspectiveMemoryManager` commit, driven by parallel review agents (`code-reviewer`, `type-design-analyzer`, `silent-failure-hunter`, `pr-test-analyzer`). All BLOCKING / HIGH / MEDIUM / LOW findings addressed in one batch — no items deferred.

**Types** (`src/types/agent-memory.ts`):
- **Branded `IsoDateTime`** with `toIsoDateTime()` factory — throws on invalid input, catches malformed-timestamp bugs at the boundary instead of `NaN`-comparisons silently returning false
- **Branded `PositiveInt`** with `toPositiveInt()` factory — rejects 0, negatives, and non-integers for `maxFireCount` and `checkIntervalMs`
- **`AtLeastOne<>` constraint helper** + reshaped `TriggerCondition` — empty `{}` conditions are now un-constructable at compile time (was: caught at runtime by the `anyFieldPopulated` guard)
- **`ProspectiveLifecycle` discriminated state machine** replacing the flat `status` / `firedAt` / `fireCount` fields on `ProspectiveEntity`. Variants: `pending` / `fired` / `expired` / `cancelled`. Each carries exactly the fields valid for its state — illegal combinations like `{ status: 'pending', firedAt: '...' }` are unrepresentable (type-design Invariant Expression axis: 2/5 → 4/5)
- **`CancelResult` discriminated union** (`'cancelled' | 'not-found' | 'already-fired' | 'already-cancelled' | 'already-expired'`) — `cancel()` now distinguishes typo from already-fired from successful cancellation
- **`FiredEvent.invocationError?: Error`** — surfaces procedureInvoker rejections without unwinding the fire; callers observe partial-success state
- **`FiredEvent.taggedEntityNames?: string[]`** — names of entities that received tags from `action: 'tag-related'`
- `isProspectiveMemory` type guard now verifies the discriminated `lifecycle` field

**Manager** (`src/agent/ProspectiveMemoryManager.ts`):
- **Implemented `action: 'tag-related'`** — previously declared in the union but `fire()` silently no-op'd (pr-test-analyzer BLOCKING finding). Scans entities matching `relatedEntityFilter`, appends `tagsToAdd`, returns names in `FiredEvent.taggedEntityNames`
- **NaN guards via `safeIsoToMs()`** in `expireOverdue` / `shouldFireOnTick` / `getFired.sinceDate` — malformed `expiresAt` or `trigger.at` strings now produce a `logger.warn` and skip the entity, preventing the "silently never expires" path
- **`scheduleConditional` JSDoc warning** + one-time `logger.warn` per instance noting predicate evaluation is deferred
- **Recurring event-based triggers correctly stay `pending`** after fire (was: incorrectly transitioned to `fired` after first match)
- **`cancel()` returns `CancelResult`** — discriminated status; `_reason` parameter dropped (was unused per code-reviewer)
- **`fire()` return type tightened** to `Promise<FiredEvent>` (was misleadingly `| undefined`); `if (event)` guards at callers dropped
- **Procedure invoker errors** surfaced on `FiredEvent.invocationError` + `logger.warn`; no longer swallowed silently via `console.warn` + a forward-comment
- **Structured `logger`** replaces `console.warn` for all warnings
- **`confidence?` added to `ScheduleOptions`** — parity with `EpisodicMemoryManager.CreateEpisodeOptions`
- Config typing simplified to three plain class fields (`defaultExpiryHours`, `maxPendingPerSession`, `procedureInvoker`) — was a complex `Required<Omit<...>> & Pick<...>` intersection
- Forward-compat shim `// Future: add to AuditLog` removed (CLAUDE.md "don't add half-finished implementations")
- Best-effort session-cap race noted with a one-line comment

**Tests** (`tests/unit/agent/ProspectiveMemoryManager.test.ts`):
- Test count: 31 → **51** (+20 net)
- New cases: `time-window` trigger fires within `[from, until)`, `time-window` does not fire past `until`, session-cap rejection, session-cap is per-session, schedule with `maxFireCount=0` rejects (positive-int brand), negative `maxFireCount` rejects, `scheduleConditional` warns exactly once, `getFired` with `sinceDate` filter, `tick` fires multiple in chronological order, `cancel` returns `'not-found'` for typos, `cancel` returns `'already-fired'` / `'already-cancelled'`, `expireOverdue` with undefined `expiresAt`, `expireOverdue` skips and warns on malformed `expiresAt`, `onObservation` matches on `sessionId` field, `tag-related` action tags matching entities and reports names, `tag-related` does not re-tag, procedureInvoker rejection surfaces on `FiredEvent.invocationError`, `tick` propagates `updateEntity` rejection cleanly, custom `confidence` / `importance` honoured, type guard rejects entities missing the discriminated lifecycle
- **Test-design refactor**: all 5 prior `setTimeout(100)` sleeps replaced with explicit `tick(new Date(...))` injection — removed Windows-flake risk per `CLAUDE.md > Gotchas > Performance benchmark flakiness`. Zero timer-based tests remain
- Logger spies updated to `console.warn` (was incorrectly `console.error`)

**Verification**: typecheck clean; 51/51 prospective tests pass; 1573/1573 agent-memory directory tests pass; zero regressions in adjacent managers (`WorkingMemoryManager` 58, `EpisodicMemoryManager` 30, `AgentMemoryManager` 74).

### Added (Prospective memory — new memory type)

- **`MemoryType` union extended with `'prospective'`** (`src/types/agent-memory.ts`): closes the canonical Tulving-aligned taxonomy alongside `'working' | 'episodic' | 'semantic' | 'procedural'`. Type guard `isProspectiveMemory(entity)` mirrors the other four guards. Design rationale + competitive lens in [`docs/roadmap/MEMORY_TYPES_EXPANSION.md`](docs/roadmap/MEMORY_TYPES_EXPANSION.md) — no competing library (MemPalace / Supermemory / mem0 / LangChain / LlamaIndex / Letta) ships prospective memory as a typed tier, so this is green-field design space.
- **`ProspectiveEntity` extending `AgentEntity`** with `trigger` (time / time-window / event / conditional), `action` (inject-context / invoke / tag-related), and lifecycle fields (`status`, `firedAt`, `fireCount`, `maxFireCount`, `cancelOnEvent`). New shared `TriggerCondition` type used by both firing and cancellation. Persists transparently through both JSONL and SQLite backends via the standard `agentMetadata` round-trip — no migration needed.
- **`ProspectiveMemoryManager`** (`src/agent/ProspectiveMemoryManager.ts`): 11 public methods covering schedule (`scheduleAt` / `scheduleOnEvent` / `scheduleConditional`), read (`getPending` / `getFired`), lifecycle (`tick` / `onObservation` / `cancel` / `expireOverdue`). Sorts pending by next-fire time. `tick` fires past-due time triggers and is idempotent via the `status` field. `onObservation` checks `cancelOnEvent` first (cancel-precedence-over-fire is deterministic).
- **Design decisions D1–D4 locked** (`docs/roadmap/MEMORY_TYPES_EXPANSION.md` §6):
  - **D1**: `action: 'invoke'` fires procedures via **dependency-injected callback** (`procedureInvoker` in constructor), not a direct `ProcedureManager` import. Same pattern as `LLMQueryPlanner` + `LLMProvider`. Falling back to no-op when no invoker is wired so the manager is usable without procedural memory.
  - **D2**: `cancelOnEvent` uses **OR (first-match) semantics** — matches `TriggerCondition` firing semantics. AND-style cancellation is composable from OR + chaining; OR is not recoverable from AND without negation (De Morgan).
  - **D3**: Default visibility is `'private'` — matches every other memory type. The user's existing `MEMORY_DEFAULT_VISIBILITY` env var remains the global lever.
  - **D4**: CLI surface ships with library release (`memory prospective schedule`/`list`/`cancel`); MCP follow-up in `@danielsimonjr/memory-mcp` next minor.
- **31 new tests** (`tests/unit/agent/ProspectiveMemoryManager.test.ts`): coverage of all three schedule paths, `getPending` sort order + session filtering, `tick` idempotency, `onObservation` matching across text / tags / entityType, `maxFireCount` cap, `cancel` semantics, `expireOverdue`, D1 invoker callback (3 cases), D2 OR semantics (3 cases including cancel-precedence-over-fire), type guard.
- **Note**: this is the manager itself — wiring into `ManagerContext` (lazy getter), `ConsolidationPipeline` (new `ProspectivePromotion` stage), `ContextWindowManager.wakeUp` (new L1.5 layer), CLI commands, and MCP tools ships in follow-up PRs per the 10-day estimate breakdown in [`MEMORY_TYPES_EXPANSION.md`](docs/roadmap/MEMORY_TYPES_EXPANSION.md) §4.7.

---

Phases 0–11 of the long-running `claude/recommend-improvements-5Jly9` branch — see `docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md`. **All 12 of 12 Phase 3 items now closed** (step 39 — memory-mapped file support — landed in Phase 11). All Phase 0–2 items + all 12 Phase 3 items + 4 of 7 Phase 4 items + 6 of 10 Phase 5 items + all 5 Phase 7 tasks + all 5 Phase 8 tasks + all 6 Phase 9 tasks + all 5 Phase 10 tasks + all 7 Phase 11 tasks. **All 5 multi-month engineering features from the original deferral list are complete.** Remaining deferrals (Phase 4 steps 42/43/45 and Phase 5 steps 55–58) are all blocked on user-side decisions (external dep approval / strategy decisions), not engineering. No SemVer-breaking changes.

### Added (Phase 11 — Memory-mapped file support)

- **`IMmapBackend` interface + `streamLines` async iterator** (`src/core/mmap/IMmapBackend.ts`): async `open` / `close` / `readRange` / `size` contract for "open a file, read arbitrary byte ranges, close." `streamLines` helper iterates lines as `Buffer`s using a configurable `chunkSize` (default 64 KB) and `maxLineBytes` guard (default 16 MB) — the guard prevents OOM on pathological no-newline files. Uses a `Buffer[]` accumulator pattern that avoids the O(N²) repeated-concat hazard.
- **`BufferMmapBackend`** (`src/core/mmap/BufferMmapBackend.ts`): reads the entire file into a single `Buffer` at open time. Useful for small files, tests, and as a known-good reference. Defensive copy on `readRange`; idempotent `close`; `openHandleCount()` for test visibility.
- **`FsReadMmapBackend`** (`src/core/mmap/FsReadMmapBackend.ts`): portable no-deps mmap-equivalent. Pins a `FileHandle` open and services range reads via `fileHandle.read(buffer, offset, length, position)`. Short-read retry loop handles legitimate partial reads (NFS, FUSE, signal-interrupted). Stats the open fd (TOCTOU-safe). Closes the fd before deleting from the map on `close` so no fd leak even if bookkeeping throws. `handle.id` is the resolved absolute path (consistent with `BufferMmapBackend`).
- **`GraphStorage.loadFromDisk` mmap branch**: routes through `FsReadMmapBackend + streamLines` when `MEMORY_USE_MMAP='true'` AND file size > `MEMORY_MMAP_THRESHOLD_BYTES` (default 100 MB). Strict regex parsing on the threshold accepts `0` to mean "always use mmap". Parse errors include line number + underlying SyntaxError message for debuggable failures on huge files. Segment-storage mode (`MEMORY_STORAGE_SEGMENT_COUNT >= 2`) short-circuits the mmap check.
- **Benchmark** (`tests/performance/mmap-load-benchmark.test.ts`): always-on sanity check + two perf-gated assertions. Measured on a 50k-entity (~12 MB) synthetic JSONL: `fs.readFile` 710ms / 150 MB heap; `FsReadMmapBackend` 984ms / 117 MB heap. Trade-off confirmed: mmap loses on speed at small sizes (per-chunk syscall overhead) but uses ~22% less peak memory. Advantage flips at multi-GB file sizes where `fs.readFile`'s whole-file string spike dominates.
- **Decision-gate doc** (`docs/architecture/mmap-binding-decision-gate.md`): surveys native mmap binding options (mmap-io / node-mmap / custom node addon), recommends `mmap-io` if user approves a native dep. The shipped `FsReadMmapBackend` is the default until that decision lands; the native binding plugs in as a third `IMmapBackend` impl via the same env vars.
- **Two new env vars**: `MEMORY_USE_MMAP` (strict `'true'` literal-match) + `MEMORY_MMAP_THRESHOLD_BYTES` (strict-decimal integer, default 100 MB, `0` accepted to force-on). Documented in `CLAUDE.md`.
- **72 new tests**: `IMmapBackend` x15 (interface contract + `streamLines` edge cases), `BufferMmapBackend` x16, `FsReadMmapBackend` x17 (incl. 100-concurrent-reads + resource-leak), `GraphStorage` wiring x13 (env-gate resolution + round-trip parity + threshold parsing), benchmark x3 (1 always-on + 2 perf-gated), review-fix regression x8 (max-line guard + parse-error context + threshold-0 + truncation + segment-precedence + handle.id consistency).

### Known issues (Phase 11 — flagged but deferred)

- **Pre-existing concurrent-`loadGraph()` race** (review #3). Two concurrent `loadGraph()` calls both see `cache === null`, both invoke `loadFromDisk()`, both build entity maps, the second clobbers the first. Pre-existing — not introduced by Phase 11 — but mmap mode amplifies the cost (two backend handles = 2× kernel page-cache pressure on a 1 GB file). Documented as a known issue; fix path: cache an in-flight promise in `ensureLoaded`. Out of Phase 11 scope.
- **Native mmap binding** (task 82 decision gate): `mmap-io` recommended once user approves the external native dep. `FsReadMmapBackend` covers the common case in the meantime.

### Added (Phase 10 — In-memory compression)

- **Compression adapter interface** (`src/utils/compression/ICompressionAdapter.ts`): synchronous `compress(Buffer) → Buffer` + `decompress(Buffer) → Buffer` contract. Sync chosen deliberately — async would force `CompressedMap.get` to be async, rippling through every caller. Reference impls: `ZlibCompressionAdapter` (Node's built-in `zlib.deflateSync`/`inflateSync`, level 0-9 validated) + `IdentityCompressionAdapter` (test baseline). Adapter errors wrap the underlying zlib/brotli message with the adapter name so multi-adapter callers can distinguish "wrong adapter" from "truncated input."
- **`CompressedMap<K, V>` data structure** (`src/utils/compression/CompressedMap.ts`): Map-like with hot/cold tiering. Hot `Map<K, V>` capped at `hotThreshold` (default 1000); overflow demotes LRU to cold `Map<K, Buffer>`. `get` on cold decompresses + promotes + may cascade-demote. **Compress-then-mutate** in the demotion loop ensures a compression failure (custom adapter, BigInt-in-default-JSON) throws cleanly instead of silently dropping the just-inserted hot entry. Iterator order is **hot insertion order, then cold insertion order — NOT global insertion order**; iteration does NOT promote cold entries (decompresses on-the-fly without touching the LRU). Documented on every iterator method.
- **`BrotliCompressionAdapter`** (`src/utils/compression/BrotliCompressionAdapter.ts`): Node's built-in `zlib.brotliCompressSync` / `brotliDecompressSync`. Quality 0-11 (default 6) + mode `'generic' | 'text' | 'font'`. Self-contained — does not import `compressionUtil.ts` (that's async; would break the synchronous `ICompressionAdapter` contract). Same error-wrapping pattern as `ZlibCompressionAdapter`.
- **Compression benchmark** (`tests/performance/compression-adapter-benchmarks.test.ts`): zlib (levels 1/6/9) vs brotli (quality 1/6/11, generic + text modes) on a 50-entity JSON payload. Gated on `SKIP_BENCHMARKS=true`. **Recommendation**: zlib for hot caches (~35% faster compress, ratio diff <15%); brotli for cold storage shards (35% better ratio at quality 11). LZ4 deferred to a future caller-implemented adapter — `ICompressionAdapter` is open to it.
- **`ctx.compressedEntityCache`** (`src/core/ManagerContext.ts`): lazy getter returning `CompressedMap<string, Entity>` when `MEMORY_CACHE_COMPRESS='true'`. Default: hot threshold 1000, Zlib level 6. **Marked `@internal`** — `GraphStorage.cache` holds a single `KnowledgeGraph` snapshot, not per-entity entries, so direct integration is deferred until that cache is restructured (parallel to Phase 9's `tieredPostingsIndex` deferral).
- **Decision-gate resolution (task 77)**: shipped without pausing for user approval — `lz4` would require an external dep approval not yet granted; zlib + brotli are both Node built-ins. The future LZ4 adapter is a 1-file additive change against the existing interface.
- **New env var:** `MEMORY_CACHE_COMPRESS` (strict literal-match on `'true'`). Documented in `CLAUDE.md`. Cached at first `compressedEntityCache` access — restart the process to change. Matches Phase 7/8/9 env-var precedent.
- **72 new tests**: `ICompressionAdapter` x12 (interface + Zlib + Identity), `CompressedMap` x30 (round-trip, hot/cold tiering, LRU semantics, iteration, generic V, custom serializers, 1000-entry stress), `BrotliCompressionAdapter` x11, benchmark x4 (1 always-on round-trip + 3 perf-gated), wiring x8 (env-var resolution, hot/cold transition past 1000 threshold), review-fix regression x10 (compress-failure rollback x2 + iterator non-promotion x2 + cross-adapter error wrapping x4 + Entity-shape round-trip lock x2).

### Added (Phase 9 — Tiered index architecture)

- **Tier interfaces + reference** (`src/search/tiered/ITieredIndex.ts`): generic `IIndexTier<K, V>` (per-tier contract) + `ITieredIndex<K, V>` (composer) + `TierAccessStats` (hits/misses/promotions/demotions/perTierHits). `InMemoryTier` reference for tests. `HotOnlyIndex` single-tier composer.
- **`LRUHotTier<K, V>`** (`src/search/tiered/LRUHotTier.ts`): RAM-resident LRU. Map insertion order = LRU order; `get`-hits do delete-then-reinsert for O(1) promotion. `maxEntries` + `maxBytes` bounds with `onEvict` callback (wires to next tier). Per-entry byte estimates cached so delete/replace can subtract precisely. **Oversized-value short-circuit**: values larger than `maxBytes` are demoted directly via `onEvict` instead of nuking the whole hot tier to make room.
- **`DiskWarmTier<V>`** (`src/search/tiered/DiskWarmTier.ts`): JSONL-sidecar-backed `IIndexTier<string, V>`. Whole-file rewrite per mutation via temp+fsync+rename with Windows EPERM fallback (matches `JsonlColumnStore`). **Whole-map snapshot rollback** on flush failure preserves the exact pre-mutation LRU order (entry-by-entry reconstruction would lose the original position of replaced keys). Per-line malformed tolerance on load. `maxEntries` LRU bound with `onEvict` chain.
- **`BrotliColdTier<V>`** (`src/search/tiered/BrotliColdTier.ts`): single Brotli-compressed JSONL shard for the long tail. The whole concatenated JSONL stream feeds one `compress()` call so brotli's dictionary spans every entry — vs per-line compression that would lose the size benefit. Configurable quality (0-11, default 6). Whole-shard rewrite per mutation with snapshot-restore rollback.
- **`TieredIndex<V>`** (`src/search/tiered/TieredIndex.ts`): 3-tier composer. Get-from-warm/cold auto-promotes to hot (write to hot, delete from colder); put always lands in hot AND clears colder tiers so each key exists at exactly one tier. **Per-key serialization** via `Map<key, Promise>` chain — concurrent operations on the same key serialize but different keys still proceed in parallel; prevents stale-write races between concurrent `put(NEW)` + `get(promotes-OLD-back-to-hot)`. **Demotion failure logging** — fire-and-forget `warm.put`/`cold.put` failures during the eviction chain log via `logger.error` instead of silently dropping the evictee. `buildTieredIndex(options)` factory uses deferred construction so eviction callbacks can reference the next tier.
- **`ctx.tieredPostingsIndex`** (`src/core/ManagerContext.ts`): lazy getter that returns a configured 3-tier composer when `MEMORY_TIERED_INDEX='true'`, otherwise `null`. Sidecars at `<basename>-tiered-warm.jsonl` and `<basename>-tiered-cold.jsonl.br`. Read once at first access (cached for the life of the `ManagerContext`). **Marked `@internal`** until a concrete consumer wires up — `OptimizedInvertedIndex`'s tightly-coupled `Uint32Array` posting layout doesn't map cleanly onto `ITieredIndex<V>`, so the property has loose typing (`TieredIndex<unknown>`) and no in-tree caller today. The integration is intentionally a follow-up phase.
- **Diagnostics roll-up** (`src/utils/Diagnostics.ts`): new optional `DiagnosticsReport.tieredIndexStats` field exposes per-tier hit rates + counters. `ctx.diagnostics()` populates it when the composer has been initialized (not just env-set — an uninitialized composer reports nothing).
- **New env var:** `MEMORY_TIERED_INDEX` (strict `'true'` literal-match). Documented in `CLAUDE.md`.
- **136 new tests**: `ITieredIndex` x19 (interface + reference), `LRUHotTier` x20 + 3 oversized regression, `DiskWarmTier` x30 + 1 LRU-order-after-rollback regression, `BrotliColdTier` x28, `TieredIndex` composer x18 + 4 concurrency regression, wiring + diagnostics x11, `tiered-review-fixes` x10 (covers all 5 substantive review findings).

### Added (Phase 8 — Columnar observation storage)

- **Column store interface** (`src/core/columns/IColumnStore.ts`): generic `IColumnStore<T>` with `get / has / put / delete / batchPut / keys / entries / size / clear / reload`. `ObservationColumn = string[]` named alias. `InMemoryColumnStore<T>` reference impl distinguishes "absent key" from "explicit empty value" via `has()`.
- **JSONL sidecar backend** (`src/core/columns/JsonlColumnStore.ts`): whole-file rewrite per mutation via temp+fsync+rename (with Windows EPERM fallback). **Snapshot-restore rollback** on flush failure — `put / delete / batchPut / clear` capture pre-mutation cache state and restore it if the disk flush throws, honoring the `IColumnStore.batchPut` "all-or-nothing" contract. Per-line tolerance on load. `reload()` method drops the in-memory cache so external sidecar edits (the migration tool) become visible to long-running processes.
- **`ObservationManager.getObservationsFor(name)`** (read-path integration): reads column store first when attached, falls back to inline `entity.observations` via `storage.getEntityByName`. Returns a defensive copy. `[]` for unknown entities — no throw.
- **Event-driven shadow-write fan-out**: `ObservationManager.setColumnStore` subscribes to `entity:created` / `entity:updated` / `entity:deleted` / `graph:saved` on `GraphEventEmitter`. Observation writes from `EntityManager.createEntities`, `updateEntity` with `observations` patch, the v1.8.0 supersede branch, bulk imports, and any other path going through `storage.saveGraph` are mirrored to the column store. `entity:deleted` drops the column entry so `getObservationsFor` doesn't return ghost data for deleted entities. `graph:saved` triggers a full resync from storage for bulk-save paths that don't emit per-entity events.
- **Shadow-write failure handling**: column-store writes are best-effort — a failure logs a warning but never rejects the calling write. The inline state is already durable via `saveGraph` before the shadow-write runs.
- **Migration tool** (`tools/observations-to-columns/`): CLI for `extract` / `reinline` over an existing JSONL store. Strict `--segments`-style parsing rejects floats / exponents. `--force` flag protects against clobbering. **Double-extract refusal** — refuses to overwrite a populated sidecar with an empty one (the "already extracted, run reinline instead" footgun). **Orphan recovery** — sidecar entries with no matching entity get written to `<output>.orphans.jsonl` plus a loud `console.warn` so wrong-pairing accidents are recoverable.
- **New env var:** `MEMORY_OBSERVATIONS_COLUMNAR` (strict literal-match on `'true'`; everything else falls back to inline-only mode). Documented in `CLAUDE.md`. Cached at first `observationManager` access — restart the process to change. Matches Phase 7's `MEMORY_STORAGE_SEGMENT_COUNT` precedent.
- **Sidecar naming**: `<basename>-observations.jsonl` (hyphen-delimited, matches the convention used by `<basename>-saved-searches.jsonl` / `-tag-aliases.jsonl` / `-ref-index.jsonl`).
- **84 new tests**: `IColumnStore` x14 (reference impl + interface contract), `JsonlColumnStore` x16 (round-trip, malformed-line tolerance, batchPut single-flush via fs.rename spy), migration tool x29 (`runExtract` + `runReinline` + `parseArgs` + bidirectional round-trip), wiring x13 (`setColumnStore` accessors, `getObservationsFor` fallback, `addObservations` / `deleteObservations` shadow-mirror, env-gated activation, end-to-end through `ManagerContext`), 12 review-fix regression tests (5 rollback × 2 reload × 1 deleted-ghost × 3 bypass-paths × 1 hyphen-path).

### Known issues (Phase 8 — deferred)

- **Pre-existing concurrency hole in `ObservationManager.addObservations`** (review #9). The method calls `storage.getGraphForMutation` (snapshot) → mutate in-memory → `await saveGraph` (mutex-protected) → shadow-write column store (unmutexed). Concurrent `addObservations` calls for the same entity can interleave between save and shadow-write, producing a column-store value that disagrees with the inline value. The race exists pre-Phase-8 at the inline level; Phase 8 makes it observable through the column store. **Fix path:** wrap `addObservations`/`deleteObservations` in `storage.graphMutex.acquire()` like `invalidateObservation` already does. Deferred to a follow-up commit to keep Phase 8 scoped.

### Added (Phase 7 — JSONL segment files)

- **Segment storage interface** (`src/core/segments/ISegmentStorage.ts`): `Segment` / `SegmentId` / `SegmentRouter` / `ISegmentStorage` types. `FnvSegmentRouter` (FNV-1a 32-bit modulo `segmentCount` — deterministic, well-distributed, matches `BloomFilter`'s existing hash). Pure helpers `splitGraphIntoSegments` / `mergeSegmentsIntoGraph` for callers that need the routing logic without I/O. `InMemorySegmentStorage` reference impl with ownership validation (rejects misrouted entities/relations at save time to surface caller bugs early).
- **File-backed segment storage** (`src/core/segments/FileSegmentStorage.ts`): per-segment JSONL files under `<rootDir>/segments/<id>.jsonl`. Per-file atomic writes via temp+fsync+rename (matches `GraphStorage.durableWriteFile` including the Windows EPERM fallback). **Manifest-based crash-atomic `saveAll`** — writes a `segments/_manifest.json` sidecar listing the staged rename moves, then a crash mid-rename is recovered forward on the next `loadAll`. Loaders never observe a torn snapshot. Per-line malformed-JSONL tolerance (corrupt tail or hand-edit doesn't take down the whole segment). `findOutgoingRelations(name)` reads one segment; `findIncomingRelations(name)` scans every segment (asymmetric by design — documented).
- **`GraphStorage` wiring** (`src/core/GraphStorage.ts`): new `segmentStorage` field populated from `MEMORY_STORAGE_SEGMENT_COUNT` env. Strict regex parsing (`^[1-9][0-9]*$`) rejects floats, exponents, hex, leading zeros, signs; upper bound `MAX_SEGMENT_COUNT = 1024`. Unset / invalid → single-file mode (byte-identical to pre-Phase-7 behavior). Append paths (`appendEntity`, `appendRelation`, `updateEntity`) fall back to a full saveAll via `appendViaSegmentSave` — less efficient than the single-file per-line append but correct. Per-segment append is a follow-up optimization. Reload-failure path catches the secondary error and surfaces both errors as an aggregated "desynced state" message so callers can detect the corner case.
- **Migration tool** (`tools/segment-jsonl/`): CLI for splitting an existing single-file JSONL into N segments and merging back. `--force` flag protects against silently clobbering existing segment files or output paths. Strict numeric `--segments` parsing rejects floats/exponents. Bidirectional round-trip survives `split → merge` cycles.
- **New env var:** `MEMORY_STORAGE_SEGMENT_COUNT` (unset = single-file mode, default). Integer in `[2, 1024]` enables segment mode; anything else falls back to single-file mode rather than throwing (graceful degradation for misconfigured deployments).
- **90 new tests**: `ISegmentStorage` x20 (FNV determinism + distribution, router validation, split/merge purity, in-memory backend round-trip + ownership), `FileSegmentStorage` x25 (round-trip, on-disk layout, missing-file tolerance, ownership validation, atomicity, stress to 100 entities × 16 segments, findOutgoing/findIncoming with `loadSegment` call-count assertions), migration tool x20 (parseArgs, runSplit, runMerge, round-trip), `GraphStorage` wiring x12 (env-var resolution including non-integer fallback, round-trip parity at =1 / =4, append paths in segment mode), review-fix regression tests x13 (manifest forward-recovery x3, malformed-line tolerance x1, strict-regex parsing x5, save+reload-failure path x1, migration overwrite protection x3).

### Notes (Phase 7 — orchestration pattern)

Phase 7 piloted the agent-driven orchestration pattern from the plan's Phase 7–11 breakdown: the orchestrator writes the foundation task (the interface contract) sequentially in main; parallel agents in git worktrees handle independent file backends + tools; orchestrator reconciles their output and writes the integration task (wiring) itself in main; one general-purpose review subagent on the cumulative diff; orchestrator applies substantive fixes and closes out. Pattern: 1 sequential interface task + 2 parallel worktree tasks + 1 sequential wiring task + 1 review + 1 close-out = ~30 min of orchestrator time on top of agent wall-clock. Saved ~10 min vs sequential execution of tasks 60+63. Pattern carries over directly to Phases 8–11.

The Phase 7 review surfaced 13 findings: 3 critical + 9 substantive + 1 nit. The critical-and-substantive 9 were applied; nit #10 (path-traversal defense-in-depth on `FileSegmentStorage` constructor) and #14 (Windows pathToFileURL heuristic in the CLI) are noted but not actioned. Notable fixes worth flagging:

- **Manifest sidecar for `saveAll`** (review #4): replaces a misleading "two-phase staging" docstring with actual crash-atomicity. Forward recovery on `loadAll` completes any pending renames from a crashed save.
- **`appendViaSegmentSave` reload-failure handling** (review #1): originally a single `try/catch` that would mask the original save error with a reload error and leave the cache desynced. Now wraps the reload in its own try/catch and throws an aggregated error.
- **Strict env-var parsing** (review #8): `parseInt('3.7')` silently truncating to `3` was a real footgun. Now uses a `^[1-9][0-9]*$` regex.

### Added (Phase 6)

- **SPARQL minimal subset** (`src/search/SPARQL.ts`): hand-rolled tokenizer + recursive-descent parser + brute-force triple-matching evaluator for SPARQL 1.1 SELECT. Supports `PREFIX`, `SELECT [DISTINCT]`, `WHERE { triples }` with `?var` / `<iri>` / `prefix:local` / `"literal"` terms, `FILTER (?v op rhs)` with `= != < > <= >= LIKE`, `LIMIT`, `OFFSET`. `graphToTriples()` exposes the RDF view of any `KnowledgeGraph` matching the convention `IOManager.exportAsTurtle` already uses. Brute-force join is reordered by selectivity (bound IRIs/literals first), then bounded by `maxSolutions` (default 100k) — protects against CPU-DoS queries when exposed over a network. `FILTER LIKE` patterns are length-capped (default 256 chars) and pre-compiled once per query. Out of scope: OPTIONAL/UNION/MINUS/BIND/GROUP BY, property paths, CONSTRUCT/ASK/DESCRIBE, SPARQL Update — callers needing those should defer to a real engine.
- **Lazy entity hydration** (`src/core/EntityProxy.ts`): `EntityProxy` carries `(name, entityType)` eagerly; `observations` / `tags` / `importance` / `parentId` / `createdAt` / `lastModified` are loaded via a single `getEntityByName` on first access and cached. `EntityProxyFactory.fromPair / fromIndex / fromName` builders; `seed()` lets a factory pre-populate the cache from an already-loaded record (avoids the second read `hydrate()` would otherwise perform in `fromName`). Returned `observations` / `tags` arrays are `Object.freeze`'d so caller `.push()` fails fast instead of silently corrupting the storage-layer cache. Enables filter-then-hydrate patterns over large entity lists without paying full observation-deserialization cost.
- **Write-ahead log for JSONL** (`src/core/WriteAheadLog.ts`): append-only `<file>.wal` companion. Synchronous `openSync` / `writeSync` / `fsyncSync` / `closeSync` per append (when `fsyncOnAppend: true`, default) to guarantee durability ordering before the main-file write. First-write does a POSIX directory fsync so a fresh WAL's dirent is durable across crashes. `replay()` reads entries with malformed-tail tolerance (the crash-during-append fingerprint) but throws on mid-log malformed lines unless `{ tolerateGaps: true }` — silent state divergence is worse than an explicit recovery error. `checkpoint()` removes the WAL after the main store has durably absorbed the entries. `applyWALToGraph()` helper applies a replayed sequence to an in-memory `KnowledgeGraph` snapshot. Wiring into `GraphStorage.saveGraph` is intentionally a follow-up — this commit ships the scaffolding so any caller can pick up durability without rebuilding the machinery.
- **72 new tests** for Phase 6 modules: `SPARQL` x32 (parser edge cases, evaluator joins, FILTER ops including the `<` / `<=` regression fix, LIKE cap, `maxSolutions` cap, selectivity reorder), `EntityProxy` x16 (lazy/cache invariant, factory builders, frozen-array mutation safety), `WriteAheadLog` x24 (append + fsync, hasPending, replay-tail vs replay-middle policy, `tolerateGaps`, checkpoint idempotence, stats, end-to-end recovery, `applyWALToGraph` for every op kind).

### Notes (Phase 6 — remaining deferrals)

- **Phase 3 steps 35 / 37 / 38 / 39 / 41**: columnar observation storage, LZ4 cold tier, JSONL segment files, mmap, tiered index — each is a multi-month feature on its own. None tractable for inclusion in a single phase iteration.
- **Phase 4 steps 42 / 43 / 45**: NestJS/Express/Next.js framework integrations, GraphQL, Elasticsearch sync — all gated on user dep approval.
- **Phase 5 steps 55 / 56 / 57 / 58**: encryption at rest (needs key-management strategy), distributed architecture (multi-month, depends on Phase 4 adapter rollout), cloud-native deployment (operations not source-code work), GPU acceleration (needs CUDA/WebGPU dep approval).

### Added (Phase 5)

- **Query Language DSL** (`src/search/QueryLanguage.ts`): SQL-flavored entity/relation DSL with hand-rolled tokenizer + recursive-descent parser + AST executor over `KnowledgeGraph`. Grammar: `FROM entities|relations [WHERE expr] [ORDER BY field [ASC|DESC]] [LIMIT n [OFFSET n]]`. Operators: `= != < > <= >= LIKE CONTAINS`, `value IN field`, `AND / OR / NOT` with parentheses, dotted attribute paths. No external parser dep. `QueryDslError` raised on syntax / unknown source / trailing garbage.
- **Graph embeddings via node2vec** (`src/search/Node2Vec.ts`): biased-random-walk + Skip-Gram-with-Negative-Sampling embedding builder. `BiasedRandomWalk` with second-order `(p, q)` parameters (1/p toward return, 1/q toward exploration; `p=q=1` reduces to DeepWalk). `SkipGramTrainer` with negative sampling — O(log V) per negative via cumulative-prefix binary search (was O(V) before review fix); excludes both context and center index from negative pool. Deterministic when seeded (mulberry32 PRNG). L2-normalized output embeddings; `topKSimilar` helper. GraphSAGE deferred to a follow-up phase.
- **Locality-Sensitive Hashing** (`src/search/LSH.ts`): random-hyperplane LSH for cosine-ANN over embeddings. Gaussian hyperplanes via Box-Muller; signed-but-stable bucket keys via unsigned hex packing. Validates `dimensions > 0` and `hyperplanesPerTable ≤ 63` at construction. Diagnostic `bucketStats()` for tuning.
- **Anomaly detection** (`src/features/AnomalyDetector.ts`): `detectStructuralAnomalies` (z-score on `in` / `out` / `total` degree — surfaces hub nodes + disconnected ones); `detectSemanticAnomalies` (k-NN cosine-distance z-score on embeddings; L2-norm-aware so callers passing un-normalized vectors don't silently produce negative distances); `detectAllAnomalies` combiner. Auto-tag and KG completion deferred.
- **CRDT collaboration scaffolding** (`src/features/CRDT.ts`): `VectorClock` (with `compare` returning `'concurrent'` on incomparable clocks), `LWWRegister<T>` (ts → replicaId tie-break), `ORSet<T>` (observed-remove set; CSPRNG add-tags via `crypto.randomBytes` so collisions don't corrupt OR-Set semantics under load), `CRDTGraph` (composes the primitives + tombstones for deletes). **Hybrid Logical Clock** ensures strict per-replica monotonicity even when many ops land in the same wall-clock ms — without it, fast back-to-back ops share a ts and tie-break only on replicaId, losing LWW. `merge()` is commutative + associative + idempotent (proved by tests).
- **Access control — ABAC** (`src/security/ABACPolicy.ts`): attribute-based rule engine. Combining algorithm: highest-priority match wins, ties resolve to deny-overrides, final tie-break on rule id (deterministic for audit logs). Wildcard `*` action support. 11 operators: `eq / neq / in / not-in / contains / starts-with / lt / lte / gt / gte / present / absent`. Nested attribute paths (e.g. `subject.team.name`) flattened with depth cap and `WeakSet` cycle protection. Malformed conditions (e.g. `op: 'in'` with non-array value) throw `ABACPolicyError` rather than silently denying.
- **Row-level filtering** (`src/security/RowLevelFilter.ts`): composable predicates AND-ed together. Built-ins: `byAttribute` (deny-on-missing by default), `byTenant` (sugar for tenant isolation), `byClassificationCap` (subject clearance ≥ row classification using a ranked vocabulary), `byTagOverlap` (label-based row security).
- **API key store** (`src/security/APIKeyStore.ts`): in-memory store with SHA-256-hashed records + constant-time validation via `crypto.timingSafeEqual`. `issue` returns plaintext exactly once; later calls only see hashes. Scopes per key; TTL via `ttlSeconds` or explicit `expiresAt`. Revocation is idempotent and preserves the record for audit. `serialize` / `load` round-trip contains no plaintext. JSDoc notes the residual timing leak in the `reason` field — callers should collapse to a single "invalid" before serializing over a network if revocation/expiry status must remain confidential.
- **147 new tests** for Phase 5 modules: `QueryLanguage` x33, `Node2Vec` x15, `LSH` x11, `AnomalyDetector` x11, `CRDT` x20, `ABACPolicy` x18, `RowLevelFilter` x11, `APIKeyStore` x18.

### Added (Phase 2 — deferred items closed alongside Phase 5)

- **API stability tiers (Phase 2 step 24)**: 19 Phase 0–4 modules tagged in their `@module` JSDoc with `@public` or `@experimental`. Modules: `IIndexHealth`, `Diagnostics`, `IndexHealthMonitor`, `CachePressureCoordinator`, `BackgroundIndexer`, `BloomFilter`, `BloomPreScreener`, `MaterializedViews`, `PartialIndexAdvisor`, `PartitionedInvertedIndex`, `QueryPlanFormatter`, `SearchStream`, `SynonymManager`, `HeuristicManager`, `EntityStateMachine`, `ObservationStore`, `IDatabaseAdapter`, `IVectorDBAdapter`, `LangChainMemoryAdapter`, `RestRouter`. Added a corresponding policy section to `CLAUDE.md`. Took the plan's alt path — tag only Phase 0–4 additions, leave pre-existing modules at the implicit `@public` level — so this is not a SemVer-breaking change. A full audit + per-symbol tiering of pre-Phase-0 modules is deferred to a v2.0.0 cut.
- **`BackupManager` extraction (Phase 2 step 29, first pass)**: extracted backup lifecycle from `IOManager` into `src/features/BackupManager.ts` (~313 LOC: `create` / `list` / `restore` / `delete` / `cleanOld` + `getDir`). `IOManager` keeps a private `BackupManager` instance and delegates the 6 backup methods to it; pre-extraction public API unchanged. New `IOManager.backupManager` getter exposes the smaller surface for callers who want to avoid the larger `IOManager` dependency. 15 unit tests covering extraction wiring, the full lifecycle, and delegation parity with `IOManager`. The remaining `IOManager` sub-modules (export, import, ingest, visualize) will be extracted in follow-up commits.

### Notes (Phase 5 — deferred items)

- **Step 52 (§13.4 SPARQL)**: full SPARQL 1.1 parser + algebra evaluator is a multi-month project on its own. Deferred to a dedicated phase. Note the RDF half (Turtle / RDF-XML / JSON-LD export) is already shipped in `IOManager`.
- **Steps 55–58**: §14.3 encryption at rest + GDPR tooling (needs key-management strategy + crypto-library decisions), §14.2 distributed architecture (multi-month, depends on Phase 4 adapter rollout), §14.4 cloud-native deployment (operations work, not source-code), §14.5 GPU acceleration (needs CUDA/WebGPU dep approval). All require user-side decisions before implementation can begin.

### Added (Phase 4)

- **`IDatabaseAdapter` interface** (`src/adapters/IDatabaseAdapter.ts`): contract for backing the knowledge graph with an external database. CRUD methods plus `applyBatch` (atomic — `InMemoryDatabaseAdapter` snapshot-restores on throw), `streamEntities` (AsyncIterable for cursor-style backends), `withTransaction`. Includes `NullDatabaseAdapter` (every method including `connect()` rejects so misconfigured callers fail loud) and `InMemoryDatabaseAdapter` (test-only reference impl). Real Postgres/Mongo adapters live in companion packages — no external dep added.
- **`IVectorDBAdapter` interface** (`src/adapters/IVectorDBAdapter.ts`): contract for offloading semantic search to an external vector database. `connect` / `upsert` / `query` / `remove` / `stats`. Includes `InMemoryVectorAdapter` (linear-scan cosine reference impl). Zero-magnitude vectors return `NaN` from the similarity helper and are filtered out in `query` rather than silently scoring as 0. Real Weaviate/Pinecone/Qdrant adapters live in companion packages.
- **`RestRouter`** (`src/adapters/RestRouter.ts`): framework-agnostic dispatch table. `:name`-pattern routes, `RestRequest` / `RestResponse` envelopes, `dispatch(req)` for any framework, plus a built-in Node `http` `serve(req, res)` adapter (auto-parses JSON bodies, writes JSON responses). `RestRouter.withDefaults(ctx)` mounts entity + search routes; the POST handler validates Entity shape (rejects with 400 on malformed body — replaced an unsafe `as never` cast with a real shape check).
- **`LangChainMemoryAdapter`** (`src/adapters/LangChainMemoryAdapter.ts`): structurally matches LangChain's `BaseChatMemory` contract without taking a `langchain` dep. `loadMemoryVariables` (with defensive timestamp sort against future `MemoryEngine` ordering changes) + `saveContext` + `clear` + configurable input/output/memory keys. Foreign turns (without the `[role=...]` prefix) fall back to `'unknown'` rather than being silently relabeled as `user`.
- **45 new tests** for adapters and wiring follow-ups: `IDatabaseAdapter` x10, `IVectorDBAdapter` x9, `RestRouter` x8, `LangChainMemoryAdapter` x7, `makeTFIDFUpdater` x3, `setBloomPreScreener` x3, `ctx.observationStore` x3, `applyBatch` atomicity x1, `withTransaction` round-trip x1.

### Changed (Phase 4)

- **`BackgroundIndexer.makeTFIDFUpdater`** (Phase 3 follow-up wiring): the factory's `applyUpsert` now uses `IGraphStorage.getEntityByName` (O(1) via the NameIndex) instead of `loadGraph().find()` (O(n) per upsert). Major perf improvement at scale.
- **`ObservationStore`** gains `internEntityObservations(entity)` and `releaseEntityObservations(hashes)` convenience helpers; exposed via lazy `ctx.observationStore` getter on `ManagerContext`. JSDoc clarifies the store is per-`ManagerContext` and per-process — no on-disk persistence, no seed from existing graph entities.
- **`FuzzySearch.setBloomPreScreener` / `hasBloomPreScreener`**: opt-in candidate pre-screen that intersects with the Bloom filter's output BEFORE the Levenshtein scan. Correctness preserved — the pre-screen falls back to the unfiltered candidate set when the screener returns zero matches (regression test verifies "Alise" still finds "Alice" through fuzzy search even though "alise" isn't in any entity's bloom filter).

### Notes (Phase 4 — deferred items)

- **Steps 42 / 43 / 45**: §12.5 NestJS / Express / Next.js framework integrations, §12.4 GraphQL support, §12.3 Elasticsearch sync. Each requires a real external dep (`@nestjs/common`, `graphql`, `@elastic/elasticsearch`) that the plan flags as "gated on dep approval." Skipped pending consumer / dep-approval decisions.
- **Phase 2 step 24** (API tiering) remains blocked on the v2.0 SemVer cut decision.
- **Phase 2 step 29** (split `IOManager.ts` 1934 LOC) still pending its own dedicated commit.

### Added (Phase 3)

- **Query result streaming** (`src/search/SearchStream.ts`): `streamArrayInChunks` (chunked yield with `setImmediate` between chunks for early-break responsiveness), `streamMergedByScore` (priority-queue merge over multiple `AsyncIterable<ScoredItem>` sources — precondition: per-source descending order, documented), `collectStream` helper.
- **Background index maintenance** (`src/search/BackgroundIndexer.ts`): decouples index updates from the write path. Gated on `MEMORY_INDEX_UPDATE_MODE=async`. Per-entity coalescing rules with explicit merge matrix. Concurrent `flush()` calls share an in-flight promise + chain a follow-up drain when the queue grows during a flush — no starvation under sustained writes. Force-flush on max-batch dispatched via `setImmediate` to avoid re-entering the emit handler synchronously.
- **Observation deduplication** (`src/core/ObservationStore.ts`): content-addressable SHA-256 store with reference counting. `release()` returns tri-state `'removed' | 'decremented' | 'unknown'` so callers distinguish no-ops from successful decrements. `intern` / `get` / `refCount` / `stats` / `internAll` / `getAll`. Entity shape unchanged; wiring into `EntityManager` is a follow-up.
- **Index partitioning by entity type** (`src/search/PartitionedInvertedIndex.ts`): per-entityType partitioned router over `OptimizedInvertedIndex`. `searchPartition(type, terms)` for typed queries (proportional to per-type document count rather than full graph), `searchAcrossAll(terms)` snapshots the partition list before iterating to protect against concurrent `dropPartition`. `IIndexHealth.health()` rolls partitions up.
- **Heuristic Guidelines Manager** (`src/agent/HeuristicManager.ts`): closes the **last unshipped Phase 3B item**. `add` / `match` (Jaccard token-overlap × confidence — symmetric so a 1-token query against a 10-token condition isn't penalised out of proportion) / `reinforce` (asymptotic toward 1) / `recordContradiction` (asymptotic toward 0) / `detectConflicts` (overlap vs literal-negation contradiction). Stopword-aware tokeniser keeps short tokens like "PR", "AI", "go".
- **3 of 4 deferred Phase 2 wirings:** `PartialIndexAdvisor` wired into `SQLiteStorage.recordFilter()` (deferred DDL via `setImmediate` so the calling search returns first); `EmbeddingCache` and `QueryPlanCache` now `implements PressureAwareCache` with single-sort O(n log n) `evictTo`; `ctx.materializedViews` lazy getter exposed on `ManagerContext`. The remaining `BloomPreScreener` → `FuzzySearch` wiring requires FuzzySearch restructuring and stays deferred.
- **75 new tests** (58 from Phase 3 modules + 17 from review-driven wiring tests): `ObservationStore` x10, `SearchStream` x8, `BackgroundIndexer` x7, `PartitionedInvertedIndex` x8, `HeuristicManager` x8, `PressureAwareCache` interface tests on both caches x10, `recordFilter` round-trip x2, `ctx.materializedViews` + `ctx.cachePressure` x4, plus inline. `test:ci` total now 6150 / 6150 passing.

### Notes (Phase 3 — deferred items)

- **Steps 35–41**: §4.3 columnar storage, §3.2 lazy hydration, §3.4 compressed in-memory (LZ4 cold tier), §5.3 JSONL segments, §5.4 mmap, §2.1 WAL for JSONL, §1.5 tiered index. Each is months of dedicated work — they warrant standalone phases rather than being bundled into a single commit.
- **Wiring follow-ups still outstanding**: `BloomPreScreener` → `FuzzySearch` (needs FuzzySearch restructuring), `BackgroundIndexer` ↔ `TFIDFEventSync` (no production caller registers a real `IndexUpdater` yet), `ObservationStore` → `EntityManager` (Entity write path still stores full strings).
- **Phase 2 step 24** (API tiering) remains blocked on the v2.0 SemVer cut decision.
- **Phase 2 step 29** (split `IOManager.ts` 1934 LOC) still pending its own dedicated commit.

### Added (Phase 2)

- **Pre-execution spell correction** (`src/search/SearchSuggestions.ts`): new `getVocabulary()` (cached Set built from entity names + types + observation tokens), `correctQuery(q, options)` with conservative defaults (skip <4-char tokens, skip exact matches, only substitute on unique closest match within `maxDistance`). New `attachInvalidator(events)` wires the cache to a `GraphEventEmitter` for automatic invalidation on entity create/update/delete.
- **Synonym expansion** (`src/search/SynonymManager.ts`): new module gated on `MEMORY_SYNONYM_EXPANSION` (default off). `add(group)` registers symmetric mappings; `expand(query)` returns OR-grouped tokens; `autoDetectFromGraph()` adds frequent co-occurrence pairs above `minSupport` (per-entity dedup so a single entity with repeated observations doesn't inflate counts).
- **SQLite partial-index advisor** (`src/search/PartialIndexAdvisor.ts`): tracks `entityType` / `projectId` filter frequency; recommends `idx_advisor_*` partial indexes; `apply(db)` creates/drops via DDL with runtime column-whitelist re-validation. Indexes the filter column itself (not `entities(name)`). Gated on `MEMORY_SQLITE_AUTO_INDEX`.
- **`QueryCostEstimator` adaptive feedback** (`src/search/QueryCostEstimator.ts`): new `recordExecution(method, count, ms)` updates a per-method EWMA (alpha=0.2). `getBaseTimeForMethod` prefers the EWMA once seeded; falls back to the configured constant otherwise. Min-bound floor on observed time (`1e-6` ms/entity) prevents zero-sample seeding.
- **Batch mutation API** (`src/core/ManagerContext.ts`): new `ctx.batch(async (b) => {...}, options?)` wraps the existing `BatchTransaction` builder with a callback-style API. Aborts the batch when the callback throws (clears the queue + propagates).
- **Materialized search views** (`src/search/MaterializedViews.ts`): `MaterializedViewsManager` registers named views (filter predicates), caches members, auto-invalidates via `entity:created/updated/deleted` events. Race-safe `query()` re-checks `dirty` after `await loadGraph()`.
- **Bloom filter pre-screening** (`src/search/BloomFilter.ts` + `src/search/BloomPreScreener.ts`): pure-TS `BloomFilter` (FNV-1a + double-hash; `h2` forced odd to prevent subgroup collapse on even-`bitCount` filters). `BloomPreScreener` builds per-entity term filters (dynamic capacity sized to actual token count) plus global type/tag filters. Designed as a candidate-set pre-screen before fuzzy / semantic search.
- **Cache pressure coordinator** (`src/utils/CachePressureCoordinator.ts`): caches register via `PressureAwareCache { name, currentEntries, evictTo }` interface. Proportional eviction (with `minRetentionEntries` floor) when total exceeds `MEMORY_CACHE_BUDGET_ENTRIES`. Gated — disabled when the env var is unset.
- **63 new tests** covering DistillationPipeline (6, closing the test gap), SearchSuggestions vocab + correctQuery (6), SynonymManager (8), PartialIndexAdvisor (6), QueryCostEstimator EWMA (6), BloomFilter + BloomPreScreener (12), MaterializedViewsManager (7), CachePressureCoordinator (6), and `ctx.batch()` (3). `test:ci` total now 6092 / 6092 passing.

### Changed (Phase 2)

- **`zod ^3.24.1 → ^4.4.3`**, **`commander ^12.1.0 → ^14.0.3`**, **`chrono-node ^2.9.0 → ^2.9.1`**. All major bumps landed with zero source changes — codebase usage was conservative enough that the test suite (6028 tests) passed before any review fixes were applied.
- **`CLAUDE.md` env-var matrix** gained `MEMORY_SQLITE_AUTO_INDEX`, `MEMORY_SYNONYM_EXPANSION`, and `MEMORY_CACHE_BUDGET_ENTRIES`.

### Notes (Phase 2 — deferred items)

- **Step 24 (§15.8 API tiering)** — blocked per the plan's risk: marking previously-public symbols `@internal` is itself a SemVer-breaking change, regardless of whether `api-extractor` removes them at build time. Needs an explicit v2.0 cut decision before starting; deferred until that decision is made.
- **Step 29 (§15.1 split god-object `IOManager.ts` at 1934 LOC)** — too large to bundle into the Phase 2 commit alongside everything else. Will be addressed in a dedicated follow-up commit.
- **Caller wiring** — the four new infrastructure modules (`PartialIndexAdvisor`, `MaterializedViewsManager`, `BloomPreScreener`, `CachePressureCoordinator`) ship with smoke-test coverage but are NOT yet wired into the search / cache hot paths. Wiring each into the appropriate caller is a follow-up. The contracts were chosen to make wiring straightforward (e.g., `PressureAwareCache` matches the existing `EmbeddingCache` / `QueryPlanCache` shape).

### Added (Phase 1)

- **`SECURITY.md`** — top-level threat model and controls inventory: path confinement (`validateFilePath`), FTS5 query sanitisation (`SQLiteStorage.fullTextSearch`), LIKE wildcard escaping (`simpleSearch`), XML entity encode/decode (`IOManager`), prototype-pollution guard (`sanitizeObject`), PII redaction (`PiiRedactor`), CLI input flow, known limitations, and a maintainer checklist.
- **`searchManager` graph-analytics additions** (`src/core/GraphTraversal.ts`):
  - `calculateHITS(maxIter?, tolerance?, topN?)` — Kleinberg's hubs-and-authorities with power iteration and L2 normalisation. Returns `{ hubs, authorities, iterations, converged }`.
  - `findCliques({ minSize?, maxCliques? })` — Bron-Kerbosch with the Tomita-Tanaka-Takahashi pivot optimisation. Returns maximal cliques sorted longest-first.
  - `findCommunities({ maxIter?, tolerance? })` — two-phase Louvain (greedy moves → community contraction → repeat). Returns `{ communities, modularity, levels }`. Edge-doubling fix for self-loops.
- **SQLite read connection pool** (`src/core/SQLiteStorage.ts`): new `MEMORY_SQLITE_READ_POOL_SIZE` env var (default 4). Round-robin read connections via `pickReadConnection()`; reads through `fullTextSearch` and `simpleSearch` use the pool. Pool readers open with `readonly: true`. `closeReadPool()` invoked from both `clearCache` and `close`.
- **BM25 incrementality** (`src/search/BM25Search.ts`): `addDocument`/`removeDocument`/`updateDocument` mirror the `TFIDFIndexManager` API with O(1) running-average doc-length updates. `addDocument` is a no-op until `buildIndex()` runs (matches TF-IDF semantics).
- **TFIDFEventSync coalescing** (`src/search/TFIDFEventSync.ts`): index events for the same entity within `MEMORY_INDEX_COALESCE_MS` (default 50 ms) collapse into a single update via a per-entity-name pending Map with explicit merge rules (`create + update → create`, `create + delete → cancel`, etc.). New `flushNow()` for tests, new `{ coalesceMs }` constructor override, `process.on('beforeExit')` drain on shutdown, `disable()` flushes synchronously before unsubscribing.
- **Entity state machine** (`src/core/EntityStateMachine.ts`): new `Entity.lifecycleStatus?: 'draft' | 'published' | 'archived'` field (named to avoid clashing with the pre-existing `SessionEntity.status` union). `EntityStateMachine` validates transitions; `EntityManager.updateEntity` enforces them. Persisted by both backends. `SearchFilterChain` defaults to `[DEFAULT_ENTITY_STATUS]` (= `'published'`) — drafts and archived entities are excluded from search unless callers opt in.
- **`AbortSignal` cancellation in `ParallelSearchExecutor`**: new `ParallelSearchOptions.signal?: AbortSignal`. Each layer wrapped in a `withCancel` helper that races against the abort event — already-aborted skips synchronously, mid-flight abort drops results without waiting. Existing executor behaviour unchanged when `signal` is omitted.
- **`ctx.diagnostics()`** (`src/utils/Diagnostics.ts`): single-call snapshot composing over `ctx.indexHealth()` plus an entity-counts panel. Side-effect-free — uses the new `IGraphStorage.cachedGraph` getter rather than forcing a load.
- **`IGraphStorage.cachedGraph`** — new public read-only getter on the storage interface (implemented by both `GraphStorage` and `SQLiteStorage`).
- 23 new smoke tests covering HITS, Bron-Kerbosch, Louvain, `EntityStateMachine`, BM25 incrementality, and `ParallelSearchExecutor` AbortSignal cancellation.

### Changed (Phase 1)

- **Pre-existing latent XML decode-order bug fixed** (`src/features/IOManager.ts`): the import-side `decodeXmlEntities` helper now runs `&amp;` LAST so double-encoded entities like `&amp;lt;` decode to `&lt;` (literal) rather than `<`. The `SECURITY.md` audit surfaced the divergence.
- **CLAUDE.md env-var matrix** gained the two new Phase 1 vars (`MEMORY_SQLITE_READ_POOL_SIZE`, `MEMORY_INDEX_COALESCE_MS`).
- **`SearchFilterChain.hasActiveFilters`** now reports `lifecycleStatus` when explicitly set (only the implicit default-to-published is silent).

### Notes

- The previous `[Unreleased]` "Fixed (follow-up — pre-existing issues surfaced during Phase 0)" section already addressed Phase 1 step 10 (`§15.3 Eliminate as any`) early. That work landed in commit `9d19e87`.

## Phase 0 (hygiene + scaffolding)

All seven items in Phase 0 landed plus three review rounds. No SemVer-breaking changes.

### Added

- **ESLint flat config** at `eslint.config.mjs`. Enforces `@typescript-eslint/no-explicit-any`, `no-console`, and `@typescript-eslint/no-floating-promises` at error severity. Logger implementations (`src/utils/logger.ts`, `src/search/QueryLogger.ts`) and the CLI bin entry are excepted from `no-console`. New scripts: `npm run lint` and `npm run lint:fix`.
- **`searchManager.explainPlan(query)`** — returns `{ ascii, json }`, where `ascii` is a tree-formatted view of the underlying `QueryPlan` (from the existing `QueryPlanner` pipeline) and `json` is the raw plan. New module: `src/search/QueryPlanFormatter.ts`.
- **`ctx.indexHealth()`** — aggregate health snapshot over `RankedSearch`'s TF-IDF index and the embedding subsystem. Side-effect-free (does not force lazy construction). New modules: `src/utils/IIndexHealth.ts`, `src/utils/IndexHealthMonitor.ts`. Future `ctx.diagnostics()` will compose over this shape.
- **CLI pipe support** — when stdin is piped (non-TTY) and no positional subcommand is on argv, `memoryjs` reads stdin line-by-line via `readline` and runs each line as a command. Lines starting with `#` are comments; quoted args (single or double, with backslash escapes) are respected. Global flags (`--storage`, `--output-format`, etc.) come from the outer invocation: `cat commands.txt | memoryjs --output-format=table`.
- **`TFIDFIndexManager.health()`** and **`OptimizedInvertedIndex.health()`** — both now `implements IIndexHealth`. **`RankedSearch.getIndexHealth()`** delegates to its index manager and returns a "disabled" snapshot when no `storageDir` was supplied.

### Changed

- **`package-lock.json` is now committed.** Previously gitignored per the "use `npm ci` in CI" comment, but the same gotcha in `CLAUDE.md` acknowledged "dependencies may drift between machines". Reproducible builds win.
- **Centralised logging.** 19 `console.*` call sites in non-CLI / non-logger code now route through the existing `src/utils/logger.ts` facade. The 4 `console.*` calls inside `src/utils/logger.ts` itself and the 4 inside `src/search/QueryLogger.ts` are intentional — those modules ARE the logger implementations.
- **`DecayScheduler.start()`** now `.unref()`s its `setInterval` (mirrors the existing `ConsolidationScheduler` pattern) so the scheduler does not by itself keep the Node.js process alive.
- **`taskScheduler` floating-promise fixes.** Two `processNext()` callsites that were fire-and-forget without explicit handling now go through a new `kickProcessNext()` helper that wraps each call with `.catch(logger.error)`. Errors that escape `processNext`'s internal try/catch surface in the logger instead of being silently dropped.
- **`AgentMemoryManager.recordAccess`** and **`registerAgent`** — both now wrap their async-called-from-sync-wrapper invocations in `.catch(logger.error)`. Public signatures unchanged (still `void`); errors that previously rode the unhandled-rejection path now log and continue. Documented as a known limitation; tightening the contract requires an API change deferred to Phase 2 (API tiering).
- **`DistillationPipeline`, `DistillationStats`, `DistillationResult` marked `@internal`.** No internal consumers; not wired through `ManagerContext`. The symbols remain exported for forward compatibility but are not part of the stable public surface.
- **CLI safety nets.** New `process.on('unhandledRejection' | 'uncaughtException')` handlers at module load. Both route through the logger and **do not** call `process.exit(1)` — so other handlers (notably `WorkerPoolManager.uncaughtExceptionHandler`'s worker shutdown) get to run and Node's default exit semantics apply.
- **Migration logging messages.** `entityUtils.ensureMemoryFilePath`'s "Found legacy memory.json" / "Successfully migrated" messages now go through `logger.info` (which writes to stderr like the rest of the logger and prefixes `[INFO]` itself). The duplicate `[INFO]` prefix in the message string was dropped. Visible to anyone scraping these messages from stdout — they now appear on stderr.

### Notes

- A follow-up commit (same `[Unreleased]`) cleared all 18 pre-existing `as any` casts (Phase 1 step 10 done early), removed 4 unused `eslint-disable` directives, and resolved the 10 pre-existing test failures (9 plan-doc-audit signing, 1 entityUtils Windows-path test). `npm run lint` exits 0; `npm run test:ci` passes 6008/6008.

### Fixed (follow-up — pre-existing issues surfaced during Phase 0)

- **All 18 `no-explicit-any` lint errors** (§15.3 / Phase 1 step 10). ENOENT casts now use `NodeJS.ErrnoException`. `(e: any)` filter/sort callback annotations dropped in favour of TS inference. `(this.storage as any)` in `ContextWindowManager.wakeUp` replaced with `as GraphStorage` plus a TODO comment about the deeper storage-abstraction issue (`EntityManager` and `ObservationManager` are typed for the concrete `GraphStorage`, not `IGraphStorage`). `ProfileManager.extractFromSession`'s load-bearing `as any` (it was passing observation strings to `SalienceEngine.calculateSalience` which expects an `AgentEntity`) replaced with `as unknown as AgentEntity` and a TODO documenting the underlying call-signature mismatch. Two `GraphEventListener<any>` cases in `GraphEventEmitter` retained behind explicit `eslint-disable` + comments noting that TS function-parameter contravariance prevents the heterogeneous listener Set from being typed precisely.
- **4 unused `eslint-disable` directives removed** from `src/features/IOManager.ts` (no-template-curly-in-string block disable + matching enable), `src/utils/parallelUtils.ts` (x2 `no-new-func`), `src/utils/taskScheduler.ts` (`no-new-func`). The `SECURITY NOTE` JSDoc above each kept-line `new Function()` site stays.
- **`tests/unit/tools/plan-doc-audit.test.ts`** — three `beforeEach` hooks now call `git config commit.gpgsign false` and `git config tag.gpgsign false` after `git init` so the temp-repo commits no longer hit the sandboxed signing server. Restores 9 tests.
- **`tests/unit/utils/entityUtils.test.ts:769–783`** (`validateFilePath > rejects absolute paths outside baseDir`) — fixtures are now platform-aware (`/etc/test/memory.jsonl` vs `/base` on POSIX; `C:\Users\test\memory.jsonl` vs `C:\base` on Windows). The original hard-coded `C:\` paths were treated as relative on Linux which silently passed the confinement check.

## [1.15.0] - 2026-04-26

Adds the `PiiRedactor` sub-feature, extends `CreateEntitySchema` and `ExtendedExportFormatSchema` for the η.6.3 / η.4.4 / η.5.4 surfaces, surfaces RDF formats through the CLI, and resolves the global vs subcommand `--format` flag clash. Picked up smoke-test fixes (`b1672c8`, `4b6382a`) discovered during memory-mcp v12.2.0 pre-publish testing on 2026-04-25.

### Added (Phase η.6.3 — `PiiRedactor` sub-feature)

Pluggable regex-based redactor for personally identifiable information. Applied on export only — does not mutate storage. New module: `src/security/`.

- **`PiiRedactor`** — apply via `redact(text)` / `redactWithStats(text)` / `redactGraph(graph)`. The `*WithStats` variant returns per-pattern counts for compliance audit trails (proves N PII items were stripped without surfacing values).
- **`DEFAULT_PII_PATTERNS`** — bundled patterns for email, U.S. SSN, credit card (13-19 digits in 4-digit groups OR unbroken), North American phone, IPv4. Conservative; false-positive bias preferred over false-negative for PII.
- **Caller customization** via `{ patterns, additionalPatterns }` constructor options: `patterns` replaces the bank entirely, `additionalPatterns` layers on top of defaults.
- **No new deps.** Pure TS regex.
- Out of scope (deferred per the plan): `InputValidator` (zod gated), `EncryptionAdapter` (SQLCipher gated).

14 new tests in `tests/unit/security/PiiRedactor.test.ts`. Closes T61 sub-section η.6.3 PII subset.

### Added (Phase 3B.5 — Active Retrieval)

Iterative query-rewriting retrieval loop. New module: `src/agent/retrieval/`.

- **`QueryRewriter`** — pure token-overlap expansion. Given a base query and a set of result snippets, extracts the highest-co-occurring tokens (excluding the query's own tokens and a stopword set) and emits an expanded query. No LLM required.
- **`ActiveRetrievalController`** — wraps `RankedSearch` for the search step and `QueryRewriter` for the expansion step.
  - `shouldRetrieve(context)` — cost heuristic. Rejects empty queries; denies when estimated cost exceeds `costThreshold` (default 1000 tokens) or per-call `budgetTokens`.
  - `adaptiveRetrieve(context)` — runs up to `maxRounds` (default 3) of (search → score coverage → rewrite). Stops early when coverage reaches `minCoverage` (default 0.6) or no expansion tokens are available. Returns the highest-coverage round's results plus the full per-round trace.
  - Coverage estimate: average of top-3 result scores, clamped to [0, 1].
- **`ctx.activeRetrieval`** — new lazy getter on `ManagerContext`. Wires `rankedSearch` automatically.
- Distinct from `LLMQueryPlanner` (which decomposes via LLM) — `ActiveRetrievalController` is purely symbolic and works without any LLM provider.

15 new tests in `tests/unit/agent/ActiveRetrieval.test.ts`. Closes T62 sub-section 3B.5 — **all four 3B.4-3B.7 sub-sections of the Memory Theory plan are now shipped**.

### Added (Phase 3B.7 — World Model)

Orchestrator that composes existing services into a single facade for "what does the agent think the world looks like?" New module: `src/agent/world/`.

- **`WorldStateSnapshot`** — immutable value object. `entitiesByName: ReadonlyMap<string, WorldStateEntity>`, `takenAt: ISO8601`. Each `WorldStateEntity` carries `{ name, entityType, importance?, confidence?, observationCount, tags, lastModified? }` — only the fields that drive change detection.
- **`snapshot.diffTo(next)`** — pure: returns `{ removed[], added[], modified[] }`. `modified[i].fields` lists the differing field names. Tag comparison is set-based (order-insensitive).
- **`snapshot.toJSON()` / `WorldStateSnapshot.fromJSON()`** — JSON serialization roundtrip.
- **`WorldModelManager`** — composer.
  - `getCurrentState()` — fresh snapshot from the live graph; capped at `maxSnapshotSize` (default 1000); over-cap, prefers high-importance entities.
  - `validateFact(observation, entityName)` — delegates to `MemoryValidator.validateConsistency` if wired, returns `null` otherwise (caller must distinguish "not checked" from "passed").
  - `predictOutcome(actionEntity, candidates)` — delegates to `CausalReasoner.findEffects` if wired, returns `[]` otherwise.
  - `detectStateChange(before, after)` — direct passthrough to `WorldStateSnapshot.diffTo`.
- **`ctx.worldModelManager`** — new lazy getter on `ManagerContext`. Wires `entityManager`, `causalReasoner`, and `memoryValidator` automatically.

13 new tests in `tests/unit/agent/WorldModel.test.ts`. Closes T62 sub-section 3B.7 — only 3B.5 (Active Retrieval) remains in the 3B.4-3B.7 cluster.

### Added (`ManagerContext` lazy getters for new managers)

Four new managers shipped this round are now reachable from the public `ManagerContext` facade:

- `ctx.procedureManager` — `ProcedureManager` (3B.4) backed by `ctx.entityManager`.
- `ctx.causalReasoner` — `CausalReasoner` (3B.6) backed by `ctx.graphTraversal`.
- `ctx.roleAssignmentStore` — `RoleAssignmentStore` (η.6.1), in-memory only by default.
- `ctx.rbacMiddleware` — `RbacMiddleware` (η.6.1), backed by `ctx.roleAssignmentStore`.

All four follow the existing lazy-getter pattern: same instance returned on re-access; constructed on first call. They depend only on stable core managers (entity, graphTraversal) — no `agentMemory()` reset is needed when the agent-memory facade is reconstructed.

6 new wiring tests in `tests/unit/core/manager-context-new-managers.test.ts`.

### Added (Phase 3B.4 — Procedural Memory)

First-class executable-procedure storage and execution. Distinct from semantic facts (what's true) and episodic events (what happened) — procedures are *how* to do things. New module: `src/agent/procedural/` + types in `src/types/procedure.ts`.

- **`ProcedureManager`** — primary API. `addProcedure({ steps, ... })` auto-generates an id, persists; `getProcedure(id)`, `getStep(id, order)`, `getNextStep(id, currentOrder)`, `openSequencer(id)`, `matchProcedure(context, candidates, threshold?)`, `refineProcedure(id, feedback)`.
- **`ProcedureStore`** — thin wrapper over `EntityManager`. Persists each procedure as `entityType: 'procedure'`. Steps + metadata encoded as JSON observations (`[procedure-steps]:<json>` + `[procedure-meta]:<json>`); description as a plain observation. Roundtrips through both JSONL and SQLite without schema changes.
- **`StepSequencer`** — pure stateful cursor for execution. `current()` / `next()` advance through steps; `branchToFallback()` redirects to the current step's `fallback` chain (single-level; nest fallbacks via `step.fallback.fallback` for deeper recovery). `next()` after a fallback advances past the original step so main-track flow resumes correctly.
- **Token-overlap matching** — `matchProcedure` scores candidates by Jaccard-like overlap between context tokens and the union of (`name`, `triggers`). Sorted by score descending; threshold cutoff supported.
- **EWMA refinement** — `refineProcedure` increments `executionCount` and updates `successRate` with `α = 0.2` (configurable). First feedback initializes from a 0.5 neutral baseline; subsequent feedback smooths toward the observed signal. Successful runs converge toward 1.0; failures toward 0.0.
- **Storage contract**: empty descriptions are skipped (the storage layer rejects empty observations). Free-form caller-defined steps; no LLM/sandboxing.
- Barrel-exported from `src/agent/index.ts`.

22 new tests in `tests/unit/agent/ProcedureManager.test.ts`. Closes T62 sub-section 3B.4.

### Added (Phase 3B.6 — Causal Reasoning)

Symbolic forward / backward / counterfactual inference over a causal-relation subgraph. New module: `src/agent/causal/`.

- **`CausalReasoner`** — wraps `GraphTraversal.findAllPaths` filtered to causal relation types (default set: `causes`, `enables`, `prevents`, `precedes`, `correlates`; caller-overridable). Scores each chain by the product of per-edge `causalStrength` (read from `Relation.metadata.causalStrength`; defaults to 1 when absent).
- **`findEffects(cause, candidates, maxDepth?)`** — chains starting at `cause` reaching any of `candidates`. Sorted by score descending.
- **`findCauses(effect, candidates, maxDepth?)`** — symmetric: chains from any candidate cause to `effect`.
- **`counterfactual({ seed, removeFrom, removeTo, predict, maxDepth? })`** — chains from `seed` to `predict` that DO NOT use the named edge. Pure: doesn't mutate the underlying graph. Compare against `findEffects` to see which chains the removal kills.
- **`detectCycles(seed, maxDepth?)`** — depth-bounded DFS over the causal subgraph. Each cycle returned as `{ cycle: [n0, n1, ..., n0], relations: [...] }`. JSDoc'd caveat: treats `prevents` as a directed edge (NOT a logical negation), so prevents+enables triangles are flagged as cycles.
- Configurable: `{ causalTypes, maxDepth }` constructor options. Default `maxDepth: 6`.
- Probabilistic Bayes-net inference deferred — needs an external lib; gated per the plan.

15 new tests in `tests/unit/agent/CausalReasoner.test.ts`. Closes T62 sub-section 3B.6.

### Added (Phase η.6.1 — Role-Based Access Control)

Named-role permission system layered above the η.5.5.b visibility model. New module: `src/agent/rbac/`.

- **`RbacTypes.ts`** — `Role` (`reader | writer | admin | owner | string`), `Permission` (`read | write | delete | manage`), `ResourceType` (`entity | relation | observation | session | artifact`), `RoleAssignment`, `RbacPolicy` interface.
- **`PermissionMatrix.ts`** — `DEFAULT_PERMISSION_MATRIX`: monotonic role hierarchy where reader→read; writer→read+write; admin→read+write+delete; owner→all four. `permissionsForRole(role, resourceType, matrix?, overrides?)` looks up grants, with optional per-resource-type overrides. Unknown roles return empty (fail-safe).
- **`RoleAssignmentStore.ts`** — in-process `Map<agentId, RoleAssignment[]>` with optional JSONL sidecar persistence. `assign` / `revoke` / `list` / `listActive(agentId, now?)`. `listActive` filters by `validFrom`/`validUntil` window. `hydrate()` replays the JSONL file on construction; tolerant of missing files and corrupt lines.
- **`RbacMiddleware.ts`** — `RbacPolicy` implementation. `checkPermission(agentId, action, resourceType, resourceName?, now?)` consults the store for active assignments matching resourceType (exact OR universal/undefined) and `scope` prefix, then checks the matrix. Falls back to `defaultRole` (default `'reader'`) when no assignment matches; pass `defaultRole: undefined` to deny unregistered agents entirely.
- **Three matching dimensions** per assignment: resource type (exact or universal), name scope (prefix match), validity window. Multiple grants compose — any matching grant that includes `action` suffices.
- Barrel-exported from `src/agent/index.ts`.

22 new tests in `tests/unit/agent/rbac.test.ts`. Closes T61 sub-section η.6.1 (no-deps subset of Enterprise plan).

### Added (Phase η.5.5.a — Multi-Agent Conflict View on `CollaborativeSynthesis`)

`SynthesisResult` gains a `conflicts: ConflictView[]` field. After BFS-traversing neighbors and salience-scoring them, the synthesizer groups by *logical entity identity* (`rootEntityName`, falling back to `name`) and reports any group containing 2+ candidates from distinct `agentId`s as a conflict.

- **`ConflictView`** — `{ entityName, candidates[], recommendedWinner }`. Each candidate carries `{ agentId, entity, score }` where `score = (confidence ?? 0.5) × salienceScore`. `recommendedWinner` is the highest-scored agentId (advisory).
- **`CollaborativeSynthesis.resolveConflicts(result, policy)`** — pure function returning a `Map<entityName, AgentEntity>` of winners per the supplied policy. Does not mutate the synthesis result or persist anything; callers feed winners back through their write path.
- **Four resolution policies**: `most_recent` (latest `lastModified`), `highest_confidence`, `highest_score` (the recommendation), `trusted_agent` (named agent wins if present, else fallback to `highest_score`).
- **Skips entities with no `agentId`** — they can't participate in multi-agent conflict (no attribution to disagree with). A single-agent version chain (multiple versions, same author) is also NOT a conflict.

11 new tests (28 total) in `tests/unit/agent/CollaborativeSynthesis.test.ts`. All 1370 agent unit tests pass. Closes T60 sub-feature 5.5.a — every no-deps subset of η.5.5 (b/c/d/a) is now shipped; only 5.5.e (CRDT, gated) remains.

### Added (Phase η.5.5.d — Audit Attribution Enforcer)

- **`CollaborationAuditEnforcer`** (`src/agent/collaboration/`) — thin proxy over `EntityManager` that forces every mutation to carry an `agentId` and appends an `AuditLog` entry on success.
  - Distinct from `GovernanceManager`: enforces *attribution only* — never blocks writes on policy grounds.
  - Three operations: `createEntities(entities, agentId)`, `updateEntity(name, updates, agentId, options?)`, `deleteEntities(names, agentId)`.
  - **Two modes** via `{ mode: 'strict' | 'lenient' }` constructor option:
    - `strict` (default) — empty/undefined/whitespace `agentId` throws `AttributionRequiredError`.
    - `lenient` — accepts calls without agentId; audit entry omits the field. Useful for back-compat wrapping around legacy callers.
  - **Composes with η.5.5.c OCC** — `updateEntity` forwards `expectedVersion` option to `EntityManager.updateEntity`; `VersionConflictError` propagates and prevents the audit entry from being written (failed writes don't pollute the trail).
  - **Captures full snapshots** — `update` audit entries include `before` (pre-update read) and `after` (post-update result); `delete` entries include `before`. `delete` skips audit entries for non-existent names (no-op match).
- **`AttributionRequiredError`** (`src/utils/errors.ts`) — extends `KnowledgeGraphError`; raised by the enforcer in strict mode. Carries the operation name in context.
- Barrel-exported from `src/agent/index.ts`.

11 new tests in `tests/unit/agent/CollaborationAuditEnforcer.test.ts`. Closes T60 sub-feature 5.5.d.

### Added (Phase η.5.5.c — Optimistic Concurrency Control)

`EntityManager.updateEntity` now accepts an optional `{ expectedVersion: number }` parameter. When supplied, the live entity's `Entity.version` (v1.8.0 supersession field) must match or `VersionConflictError` is thrown.

- **Opt-in per call** — omitting `expectedVersion` preserves legacy last-write-wins semantics (default; backwards-compat).
- **Auto-increment on success** — OCC-guarded writes bump `version` so subsequent OCC writers can detect their predecessor. Non-OCC writes leave `version` untouched (legacy behavior unchanged).
- **Composes with v1.8.0 supersession** — both increment the same `version` field; `ContradictionDetector` and OCC interleave correctly.
- **HTTP 409 mapping** — `VersionConflictError extends KnowledgeGraphError`; carries `{ entityName, expected, actual, conflictingAgentId? }`. The η.4.2 REST API plan translates it to HTTP 409 Conflict.
- **Background-scheduler caveat** — `ConsolidationScheduler` can increment `version` between caller-fetch and write, producing spurious conflicts. JSDoc warns: don't cache `expectedVersion` across scheduler cycles; fetch immediately before writing.

7 new tests in `tests/unit/core/optimistic-concurrency.test.ts`. Closes T60 sub-feature 5.5.c.

### Added (Phase η.5.5.b — Visibility Hierarchy Expansion)

`VisibilityResolver` gains two AND-combined gates beyond the five-tier visibility model:

- **Time-window gate** (evaluated FIRST, before owner/level rules):
  - `AgentEntity.visibleFrom?: string` — ISO 8601 — memory becomes visible at this instant. Absent ⇒ visible since creation.
  - `AgentEntity.visibleUntil?: string` — memory stops being visible at this instant. Absent ⇒ visible indefinitely. Useful for shared drafts that should expire on a known handoff date — the entity is still stored, just hidden after.
  - **Denies even the owner** when current time is outside the window. (Rationale: a "draft until 2026-12-31" should not be readable by anyone after that date, including its author. This is the unusual-but-correct behavior; documented in JSDoc.)

- **Role predicate** (evaluated AFTER level check, AND-combined):
  - `AgentEntity.allowedRoles?: string[]` — when set, the requesting agent's `AgentMetadata.role` (new field) must appear in the list. Tightens, never widens.
  - **Owner exempt** — an agent never locks itself out of its own data, even if its role isn't in the list.
  - Empty array ⇒ no gate (matches absent field).
  - Free-form role strings; aligns with built-in `RoleProfiles` but accepts any caller value.

- New `AgentMetadata.role?: string` — distinct from `roleProfile` (which tunes salience weights); a single agent can have `roleProfile: 'researcher'` while bearing `role: 'admin'` for visibility.

- `canAccess()` accepts an optional `now?: string` parameter for evaluating access at a hypothetical time (mainly for tests).

14 new tests in `tests/unit/agent/VisibilityResolver.test.ts` (46 total).

Closes T60 sub-feature 5.5.b. Plan: [`2026-04-25-eta-collaboration.md`](docs/superpowers/plans/2026-04-25-eta-collaboration.md). Sub-features 5.5.a/c/d remain (no-deps); 5.5.e (CRDT) gated.

### Added (Phase η.4.4 — Temporal Versioning expansion)

Lifts the v1.9.0 `RelationManager` temporal surface (`invalidateRelation` / `queryAsOf` / `timeline`) to entities and observations. Orthogonal to v1.8.0 supersession (which answers "which version is current?"); temporal validity answers "was this true at time T?".

- **Entity fields** (opt-in, all optional, backwards-compat):
  - `Entity.validFrom?: string` — ISO 8601 — entity is valid from this instant. Absent ⇒ always-valid since creation.
  - `Entity.validUntil?: string` — ISO 8601 — entity is valid until this instant. Absent ⇒ still valid.
  - `Entity.observationMeta?: Array<{ content, validFrom?, validUntil?, recordedAt? }>` — per-observation temporal metadata, indexed parallel to `observations[]` by content match. Absent or partial ⇒ those observations are unbounded.

- **`EntityManager` methods**:
  - `invalidateEntity(name, ended?)` — sets `validUntil`. Idempotent. Throws `EntityNotFoundError` on missing entity.
  - `entityAsOf(name, asOf)` — returns the entity at a point in time, or `null` if invalid then. Validates `asOf` is an ISO 8601 string.
  - `entityTimeline(name)` — returns the v1.8.0 supersession chain (or just the named entity) sorted by `validFrom` ascending, with unbounded entities last.

- **`ObservationManager` methods**:
  - `invalidateObservation(entity, content, ended?)` — creates or updates the parallel `observationMeta[]` entry for the named observation. Throws `ValidationError` if observation not on entity.
  - `observationsAsOf(entity, asOf)` — filters observations by `validFrom`/`validUntil` window. Observations with no meta entry treated as unbounded (preserves backwards-compat).

- Persisted in JSONL (`OPTIONAL_PERSISTED_ENTITY_FIELDS` extended) and SQLite (added to `EXTENSION_FIELDS` JSON blob — no schema migration needed).
- `UpdateEntitySchema` Zod schema gains the three new optional fields plus previously-undeclared `rootEntityName`/`parentEntityName`/`version` (these were already settable via direct field assignment but blocked by `.strict()` on `updateEntity`).

22 tests in `tests/unit/core/temporal-versioning.test.ts`. Closes T53 (η.4.4 entity + observation expansion). Plan: [`2026-04-25-eta-temporal-versioning.md`](docs/superpowers/plans/2026-04-25-eta-temporal-versioning.md).

### Added (Phase η plan drafts)

Eight plans now drafted, covering remaining no-code Phase η work:

- **`docs/superpowers/plans/2026-04-25-eta-database-adapters.md`** — η.4.1. PostgreSQL/MongoDB/MySQL/Redis adapters, each gated on its peer dep. T0 (interface hardening) is unblocked and ships without deps.
- **`docs/superpowers/plans/2026-04-25-eta-temporal-versioning.md`** — η.4.4 (now SHIPPED above).
- **`docs/superpowers/plans/2026-04-25-eta-collaboration.md`** — η.5.5. Visibility expansion, OCC, attribution enforcement, conflict-view synthesis (no-deps subset). CRDT (Yjs) gated.
- **`docs/superpowers/plans/2026-04-25-eta-enterprise.md`** — η.6.1–6.5. RBAC + Distributed + Security + Cloud-native + GPU. Five separate decision gates.
- **`docs/superpowers/plans/2026-04-25-3b-memory-theory.md`** — 3B.4–3B.7. Procedural Memory + Active Retrieval + Causal Reasoning + World Model. All no-deps.

Runbook (`2026-04-24-task-dispatch-runbook.md`) updated with cross-links.

### Added (Phase η.5.4 — Standards Compliance, sub-features 1+2)

- **RDF/Turtle export** (`IOManager.exportGraph(graph, 'turtle')`) — emits W3C RDF 1.1 Turtle. Maps `entity → urn:memoryjs:entity:<name>` IRI, `entityType → rdf:type` (custom class IRI under `urn:memoryjs:type:`), `observations[] → rdfs:comment`, `tags[] → dcterms:subject`, `createdAt → dcterms:created`. Relations emit as direct triples (`<from> <urn:memoryjs:rel:<type>> <to>`).
- **RDF/XML export** (`IOManager.exportGraph(graph, 'rdf-xml')`) — XML serialization of the same triples. Relations use **`rdf:Statement` reification** so arbitrary predicate IRIs (free-form relation types like `"works at"` or `"causes-then"`) serialize correctly without forcing the relation type into a valid XML local name.
- **JSON-LD export** (`IOManager.exportGraph(graph, 'json-ld')`) — JSON-LD 1.1 with `@context` mapping memoryjs schema to RDFS + DCTerms. `observations` declared as `@list` (preserves order), `tags` as `@set` (unordered). Compatible with any JSON-LD parser.
- All three formats percent-encode reserved characters in IRIs (`AT&T` → `urn:memoryjs:entity:AT%26T`, spaces → `%20`).
- 23 unit tests in `tests/unit/features/IOManager.rdf-export.test.ts`.

Closes T59 sub-features 1+2 (η.5.4 plan, [`2026-04-25-eta-standards-compliance.md`](docs/superpowers/plans/2026-04-25-eta-standards-compliance.md)). Sub-feature 3 (SPARQL SELECT translation) deferred — requires `sparqljs` runtime dep, gated on user approval.

## [1.14.0] - 2026-04-25

### Fixed (Phase δ code-reviewer findings)

- **Critical: T31 hook no longer silently disables v1.8.0 supersede branch.** Reviewer caught that filtering `semantic-contradiction` flagged observations at the validator hook would drop them before the existing supersede branch (which creates a proper version chain). Contract tightened: only `duplicate-observation` is now blocking at the validator layer; `semantic-contradiction` is advisory and falls through to the v1.8.0 supersede pipeline. Documented as the canonical contract in both `setMemoryValidator` JSDoc and the hook body. New test in `observation-validate-hook.test.ts` enforces the contract: a stub validator that flags every observation as a contradiction must still allow the observation through (where supersede / append handles it downstream).
- **Lazy-provider wiring for `setMemoryValidator`.** Was eager (constructed validator at `ManagerContext` construction time, which broke the lazy-getter contract). Now accepts either an instance or a thunk; `ManagerContext` wires `() => this.memoryValidator` so the validator is built only on the first observation that exercises the hook. Side effect: runtime toggling of `MEMORY_VALIDATE_ON_STORE` now works in BOTH directions (was previously OFF-only at runtime).
- **`mergeRedundant` `keep-newest` epoch fallback.** `Date.parse('0')` is timezone-dependent (V8 parses it as a local-time year-2000 date); replaced with a pinned `1970-01-01T00:00:00Z` fallback that matches `ConflictResolver.resolveMostRecent`'s convention. Also adds `createdAt` as a secondary fallback before the epoch.
- **Type-collision aliases dropped.** `MemoryValidationResult` / `MemoryValidationIssue` / `TrajectoryMergeStrategy` are now the source-of-truth names exported directly from their modules (was previously aliased in the barrel — created a "two ways to import" pitfall). Old un-aliased names removed; barrel re-exports the canonical names.
- **`repairWithResolver` parameterized.** `detectionMethod` (defaults `'similarity'`), `strategy` (overrides the 24h-delta heuristic), and `agents` (defaults empty Map) are now caller-controllable via an options object. Backwards compat: the previous positional-args call signature was reshaped, but the only call site in tests was updated in this commit.
- **JSDoc caveats added.** `findRedundancies` and `clusterTrajectories` both document the greedy-single-link order-dependence — results depend on input order when an item could qualify for multiple seeds. Cohesion field surfaces the issue for downstream filtering.

### Added (Phase δ — closing T31, T32, T35)

- **Pre-storage validation hook in `ObservationManager`** (T31, Phase δ.1) — opt-in via `MEMORY_VALIDATE_ON_STORE=true` env var. When enabled AND a `MemoryValidator` is wired through `setMemoryValidator(...)`, `addObservations` runs `validateConsistency` on each new observation against its target entity before persisting. Blocking issues (`semantic-contradiction` or `duplicate-observation`) cause the observation to be skipped with a `console.warn` listing the validator's suggestions. Default off — preserves backwards-compat. `ManagerContext` auto-wires when the env var was truthy at construction time. 3 unit tests in `tests/unit/core/observation-validate-hook.test.ts`.
- **`MemoryValidator.repairWithResolver(entity, competing, resolver, contradiction?, agents?)`** (T32, Phase δ.1) — closes the `ConflictResolver` integration loop spec'd in ROADMAP §3B.1. Constructs the minimal `ConflictInfo` from a `Contradiction` finding and delegates to `ConflictResolver.resolveConflict`. Picks the strategy heuristically (`most_recent` when timestamps are >24h apart, else `highest_confidence`). Caller can override by setting up a default on the resolver. 2 new tests in `tests/unit/agent/MemoryValidator.test.ts`. 16/16 validator tests green.
- **T35 closed-as-shipped** — re-read of ROADMAP §3B.2 confirmed the four "compression strategies" (`semantic_clustering` / `temporal_windowing` / `importance_filtering` / `hierarchical`) are descriptive guidance for `distill` behavior, not separate methods on the public interface. The shipped `distill` uses token-overlap (semantic-clustering shape); `mergeRedundant` exposes the explicit choice points. No additional surface required.

### Added (Phase η — dated plans drafted)

- **`docs/superpowers/plans/2026-04-25-eta-rest-api.md`** — η.4.2 REST API Generation plan. Fastify-based wrapper over `ManagerContext`; covers entities/relations/search/memory routes. Decision gate: Fastify peer dep. Effort estimate ~1 week.
- **`docs/superpowers/plans/2026-04-25-eta-graph-visualization.md`** — η.4.6 Graph Visualization expansion plan. Builds on the v1.9.1 `IOManager.visualizeGraph`; adds 4 layouts (force / hierarchical / circular / timeline), interactive filtering, search-as-you-type, PNG export. Effort ~1 week.
- **`docs/superpowers/plans/2026-04-25-eta-ml-features.md`** — η.5.3 ML-Powered Features plan. Four sub-features (auto-tagging, relation anomaly detection, entity clustering, missing-relation prediction), all opt-in behind a feature flag. No required runtime deps. Effort ~3 weeks total.
- **`docs/superpowers/plans/2026-04-25-eta-standards-compliance.md`** — η.5.4 Standards Compliance plan. Three sub-features: RDF/Turtle export, JSON-LD context, SPARQL SELECT translation. First two need no new deps; SPARQL needs `sparqljs`. Effort ~2 weeks.
- Runbook (`2026-04-24-task-dispatch-runbook.md`) updated to link each Phase η item with a plan-drafted to its dated plan file.

## [1.13.0] - 2026-04-25

### Added (Phase δ — Memory Intelligence Services)

- **`docs/development/ARCHITECTURE_DECISIONS.md` ADR-011** — "Phase δ Memory Intelligence service shape (wrap-and-extend)". Decides each new service wraps the matching existing primitive (`ContradictionDetector` / `compressForContext` / `PatternDetector`) rather than renaming or reimplementing. Closes T28 (Phase δ.0).
- **`src/agent/MemoryValidator.ts`** (Phase δ.1) — `validateConsistency` (composite duplicate/semantic/low-confidence check), `detectContradictions` (delegates to `ContradictionDetector` with symmetric-pair dedup + severity bucketing), `repairMemory` (appends `[repair]`-prefixed observation), `validateTemporalOrder` (synchronous `[T=ISO]` ordering check), `calculateReliability` (composite of confidence + confirmation count + age penalty, clamped to `[0, 1]`). 14 unit tests. Closes T29 + T30.
- **`src/agent/TrajectoryCompressor.ts`** (Phase δ.2) — `distill` (token-overlap-based summarization with `maxLength` truncation), `abstractAtLevel` (`fine` / `medium` / `coarse` granularity), `foldContext` (delegates to `ContextWindowManager.compressForContext` with adaptive level), `findRedundancies` (Jaccard-clustered groups), `mergeRedundant` (3 strategies: `keep-newest` / `keep-most-confident` / `union-observations`). 12 unit tests. Closes T33 + T34 + T36.
- **`src/agent/ExperienceExtractor.ts`** (Phase δ.3) — `extractFromContrastivePairs` (token-frequency-bias rules with confidence + support/contra counts), `abstractPattern` (delegates to `PatternDetector` with trajectory provenance), `learnDecisionBoundary` (positive/negative token separation), `clusterTrajectories` (`semantic` / `structural` / `outcome` methods with greedy single-link Jaccard), `synthesizeExperience` (procedure-vs-heuristic typing based on action density). 11 unit tests. Closes T37 + T38 + T39 + T40.
- **`ctx.memoryValidator` / `ctx.trajectoryCompressor` / `ctx.experienceExtractor` / `ctx.patternDetector`** — four new lazy accessors on `ManagerContext` wiring the δ services. `MemoryValidator` builds a no-op `ContradictionDetector` when no semantic-search backend is configured, so its other methods (reliability, temporal-order) work without a provider. 5 wiring tests. Closes T36 wiring portion + barrel exports under `src/agent/index.ts` (with disambiguating re-exports for `ValidationResult`, `ValidationIssue`, and `MergeStrategy` to avoid collisions with existing `features/` and `utils/` exports).

### Deferred (Phase δ — out-of-scope for this commit)

- **T31** — pre-storage validation hook in `ObservationManager`. The validator is exposed via `ctx.memoryValidator` for opt-in by orchestrators; no automatic hook to keep behavior backwards-compatible.
- **T32** — full `ConflictResolver` integration in `repairMemory`. `ConflictResolver.resolveConflict` requires upstream `ConflictInfo` construction (primary memory + competing memories + agent metadata) which is the orchestrator's job, not the validator's. `MemoryValidator.repairMemory` currently appends a `[repair]`-prefixed observation; orchestrator can call `ConflictResolver.resolveConflict` separately and feed the result back as `feedback`.
- **T35** — compression-clustering strategies (`semantic_clustering` / `temporal_windowing` / `importance_filtering` / `hierarchical`) per ROADMAP §3B.2 prose. Re-read the spec: these are *descriptive* — they describe how `distill` should behave under different conditions, not separate methods on the public interface. The shipped `distill` uses token-overlap (semantic-clustering-like behavior). The 3 `mergeRedundant` strategies are the explicit per-spec choice points.

## [1.12.0] - 2026-04-25

### Added (Phase ζ.3 — audit:plans commit hook)

- **`.claude/settings.local.json` PostToolUse hook** — second hook in the `Edit|Write` matcher chain runs `npm run audit:plans` whenever `CLAUDE_FILE_PATH` matches a plan-doc or src path (`docs/superpowers/plans/**`, `docs/roadmap/**`, or `src/**`, `.md`/`.ts` files). Hook runs in <30s timeout; non-blocking. Logs flip-eligible items so plan-doc rot is caught the same edit it appears, not weeks later. Closes T48 (Phase ζ.3).

### Added (Phase ε.3 — perf baselines)

- **`tests/performance/baselines.json`** — Per-platform performance baseline file keyed by `${process.platform}-${cpuModelSlug}`. Schema documented in `_meta`. Currently empty — first run on each host populates rows manually. Closes T43 (Phase ε.3).
- **`tests/performance/baselineHelper.ts`** — `platformKey()` builds the deterministic host key (slug from first CPU model, lowercased + dashed); `getBaseline(testName)` returns the row or `null` (absent baselines = log-only mode); `assertOrLogP95(testName, p95)` is the call-site helper that asserts within `noise_floor_pct` tolerance when a baseline exists, or logs the captured P95 for manual seeding when not. 3 unit tests in `tests/unit/performance/baselineHelper.test.ts` cover key stability + null-baseline default.

### Added (Phase β.3 + β.4 + β.7 — SQLiteBackend, wiring, review pass)

- **`src/agent/SQLiteBackend.ts`** — Durable `IMemoryBackend` adapter wrapping `MemoryEngine` + `DecayEngine`. `add()` delegates to the four-tier dedup chain; `get_weighted` reuses `getSessionTurns` then re-scores via `DecayEngine.calculatePrdEffectiveImportance`. Options: `dedupOnAdd` (default `true`; `false` throws — bypass path is future work) and `preserveCallerIds` (default `false`; `true` throws — needs a `storage.renameEntity` primitive). Closes T13 (Phase β.3).
- **`tests/unit/agent/SQLiteBackend.test.ts`** — 19 tests: contract suite + 4 backend-specific (role round-trip, exact-tier dedup, both option-throw paths, real-SQLite path test gated on `better-sqlite3` ABI compat).
- **`ctx.memoryBackend` lazy getter on `ManagerContext`** — selects `SQLiteBackend` (default) or `InMemoryBackend` via `MEMORY_BACKEND` env var. Wraps `ctx.memoryEngine` + `ctx.decayEngine` so backend selection is transparent. `agentMemory(config)` re-instantiation now also invalidates `_memoryBackend`, `_consolidationScheduler`, and `_dreamEngine` (the previous diff's invalidation block was incomplete — closed under T17 review). Closes T14 (Phase β.4).
- **`tests/unit/agent/memoryBackend-wiring.test.ts`** — 6 tests covering default selection, env-var aliases (`memory`/`inmemory`/`in-memory`), lazy caching, end-to-end round-trip, and the `agentMemory(config)` invalidation hook.
- **`MEMORY_BACKEND` env var** documented in CLAUDE.md (Phase β.4 selector). The PRD-decay docs now also explicitly cross-link `MEMORY_DECAY_HALF_LIFE_HOURS` as feeding `MEMORY_PRD_DECAY_RATE` when the latter is unset.

### Changed (Phase β.7 — review-pass fixes)

- **`InMemoryBackend.add()` now dedups by `(sessionId, content)`** — match `SQLiteBackend`'s four-tier-exact behavior so the contract suite enforces uniform semantics. Without this, two backends could pass the same contract while behaving oppositely on duplicate adds. Reviewer Finding #1.
- **`IMemoryBackend` contract suite gained 2 tests** — explicit dedup assertion and a full lifecycle sequence (`add → get → delete → add → get`) to catch stale-index bleed-through after delete. Reviewer Finding #5.
- **`MemoryTurn` field docs tightened** — `id`, `createdAt`, and `metadata` are now explicit about per-backend honoring vs. silent override (`SQLiteBackend` overrides `id`/`createdAt` and drops `metadata`; `InMemoryBackend` honors all). Reviewer Finding #3 — closing the gap between documented and actual behavior.
- **`agentMemory(config)` invalidation extended** to also reset `_consolidationScheduler` and `_dreamEngine`, both of which capture references through `agentMemory().consolidationPipeline` at construction time. Reviewer Finding #4 — pre-existing partial-invalidation bug fixed opportunistically.

### Added (Phase β.2 — InMemoryBackend adapter)

- **`src/agent/InMemoryBackend.ts`** — Ephemeral, process-lifetime `IMemoryBackend` adapter. Stores turns in an in-process `Map<sessionId, MemoryTurn[]>`; no persistence. Scoring delegates to `DecayEngine.calculatePrdEffectiveImportance` so `get_weighted` returns the same PRD-formula scores any future backend produces. Inverse-translates `MemoryTurn.importance` (PRD scale `[1.0, 3.0]`) back to memoryjs scale `[0, 10]` before passing to the decay engine, which then internally re-translates — net round-trip is identity. `get_weighted` applies the threshold filter (defaulting to `decayEngine.prdMinImportanceThreshold = 0.1`) before sort-by-score-descending and limit. Closes T12 (Phase β.2).
- **`tests/unit/agent/InMemoryBackend.test.ts`** — Wires `runMemoryBackendContract` from T11's parameterized suite (9 contract tests) plus 4 backend-specific tests (cross-session isolation, list_sessions add+delete, score-tie ordering, metadata round-trip).

### Added (Phase β.5/β.6 — PRD decay extensions)

- **`DecayEngine.calculatePrdEffectiveImportance(entity, queryContext?, now?)`** — Parallel scoring method using the Context Engine PRD formula (`importance × recency × freshness + relevance_boost`) per `docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md`. Auto-scales memoryjs's `[0, 10]` importance to PRD's `[1.0, 3.0]`. The legacy `calculateEffectiveImportance` method is unchanged so existing callers (`DecayScheduler`, `SearchManager`, `SemanticForget`) preserve their semantics; this is a strictly additive parallel method. Closes T15 (Phase β.5). 8 new unit tests in `tests/unit/agent/DecayEngine.test.ts`.
- **`DecayEngineConfig` extension** — Four new optional fields (`decayRate`, `freshnessCoefficient`, `relevanceWeight`, `minImportanceThreshold`) per PRD MEM-01. `decayRate` is auto-derived from `halfLifeHours` (`ln(2) / (halfLifeHours × 3600)`) when not given. Closes T16 (Phase β.6).
- **Four new env vars** wired through `ctx.decayEngine`: `MEMORY_PRD_DECAY_RATE` (auto-derived), `MEMORY_PRD_FRESHNESS_COEFFICIENT` (default `0.01`), `MEMORY_PRD_RELEVANCE_WEIGHT` (default `0.35`), `MEMORY_PRD_MIN_IMPORTANCE_THRESHOLD` (default `0.1`). Distinct from the legacy `MEMORY_DECAY_*` set — see CLAUDE.md § Environment Variables for the side-by-side. New `envNumberOrUndefined` helper added to `ManagerContext` so the `decayRate` auto-derive isn't masked when the env var is unset.
- **`DecayEngine.prdMinImportanceThreshold`** read-only accessor — exposes the configured PRD threshold for downstream filters (e.g., `IMemoryBackend.get_weighted` in T14+).

### Added (Phase β.1 — IMemoryBackend interface)

- **`src/agent/MemoryBackend.ts`** — Defines `IMemoryBackend` interface plus `MemoryTurn`, `WeightedTurn`, and `GetWeightedOptions` types per `docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md` (PRD MEM-04). Naming preserves the PRD's snake_case (`get_weighted`, `delete_session`, `list_sessions`) — the only place in the codebase that does so. Distinct from `IGraphStorage`: `IGraphStorage` is the durable graph-store contract (entities + relations + indexes + transactions); `IMemoryBackend` is the agent-memory-flavored contract (turn-level ingest, weighted retrieval, session lifecycle). Both coexist; this is purely additive. No backend implementations yet — `InMemoryBackend` lands in T12, `SQLiteBackend` in T13.
- **`tests/unit/agent/IMemoryBackend.contract.test.ts`** — Parameterized contract test suite. Exports `runMemoryBackendContract(name, factory)` so T12/T13 backends can call `runMemoryBackendContract('InMemoryBackend', () => new InMemoryBackend(...))` and inherit a 9-test conformance suite covering `add`/`get_weighted`/`delete_session`/`list_sessions` semantics, sessionId scoping, limit/threshold options, and metadata round-trip. Plus 4 type-shape tests verifying the public TS surface compiles. Closes T11 (Phase β.1).

### Added (Phase ε — performance benchmarks unskip)

- **`tests/performance/embedding-benchmarks.test.ts` + `tests/performance/foundation-benchmarks.test.ts`** — All 10 `it.skip` blocks un-skipped. The blocking event ("codebase split") happened (memoryjs is the post-split repo); every named subject under test (`EmbeddingCache`, `MockEmbeddingService`, `IncrementalIndexer`, `EntityManager.deleteEntities`, `RelationManager.removeRelations`, `CompressionManager.findDuplicates` / `compress`, `TagManager.*` per-entity + bulk paths, complex-workflow e2e) is shipped in `src/`. Verified pass: 48/48 perf tests green. Closes T41 + T42 + T45 of `docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md` (Phase ε.1, ε.2, ε.5).
- **`docs/superpowers/specs/2026-04-24-skip-inventory.md`** — Per-test catalog of the 10 unskipped benchmarks with SKIPPED reason, SUT location in `src/`, and recommended action. Used as input for T42; retained as historical record.
- **`npm run bench`** script — wraps `vitest run tests/performance`. Closes T44 (Phase ε.4).
- **CLAUDE.md** — Performance-benchmark-flakiness gotcha entry expanded to cover the unskipped benchmarks and document the `SKIP_BENCHMARKS=true` gate. Closes T45 (Phase ε.5).

### Added (Phase ζ — plan-doc rot prevention)

- **`tools/plan-doc-audit/`** — Static-analysis tool that walks every `docs/superpowers/plans/**/*.md` and `docs/roadmap/**/*.md`, extracts code symbols from `- [ ]` task lines (backtick-quoted code spans only — PascalCase in prose intentionally ignored to suppress noise), runs `git grep` against `src/`, and reads function bodies to filter stubs. The load-bearing lesson from the 2026-04-24 reconciliation is baked into the design: a stub that throws `"Not implemented"` must NOT count as shipped, even though `git grep` finds the symbol. Window for stub detection is intentionally tight (matched line + 2 lines after) so multi-class files don't false-positive on adjacent class declarations. Future-work-verb filter (Implement / Wire / Add / Create / Build / etc.) leaves tasks unchecked even when their named symbols are shipped, because such tasks usually reference the symbols as the *target* of new work, not as evidence the task is complete. Modes: `--dry-run` (default — report only, exit 1 if flips eligible) and `--apply` (rewrite plan files). Programmatic API: `runAudit({ planRoots, srcRoot, apply, cwd })` for tests/CI integration. 20 unit tests with synthetic git fixtures cover symbol extraction, stub detection, file auditing, flip application, future-work-verb gating, file-path filtering, and the prose-stop-word list. Closes T46, T47, T49 of `docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md` (Phase ζ.1, ζ.2, ζ.4).
- **`npm run audit:plans`** script — wraps `tsx tools/plan-doc-audit/audit.ts`.
- **`tools/plan-doc-audit/README.md`** — design notes + usage.

### Added (Phase β.0 prep — read-only investigation)

- **`docs/superpowers/specs/2026-04-24-storage-wireup-trace.md`** — Maps all 232 wire-up points across 56 source files where the storage layer types (`GraphStorage`, `SQLiteStorage`, `IGraphStorage`, `StorageFactory`, `WorkingMemoryManager`, `EpisodicMemoryManager`) are imported or referenced. Categorized by role (storage layer, manager/coordinator, type-only-import, concrete-class direct reference) and analyzed for `IMemoryBackend` impact. Closes T10 of `docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md` (Phase β.0). Direct conclusion: only 3 files (`ManagerContext`, `AgentMemoryManager`, `MemoryEngine`) need wiring changes for `IMemoryBackend`; the other 53 type-import sites stay unchanged.

### Removed

- **`src/agent/ContextWindowManager.ts.tmp.44728.1775826871762`** — stale 35KB editor cruft from 2026-04-10. Was tracked in git but fully superseded by the real `ContextWindowManager.ts`. Drive-by cleanup spotted during T10.

### Specs added (no code changes — design docs only)

- **`docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md`** — Context Engine sub-feature #3b. Covers PRD §3 `GOAL-03`, §8 `MEM-01` (configurable decay parameters: `decay_rate`, `freshness_coefficient`, `relevance_weight`, `min_importance_threshold`), §8 `MEM-04` (`IMemoryBackend` with `InMemoryBackend` + `SQLiteBackend` adapters), and the deferred PRD importance-range `[1.0, 3.0]` mapping. Adds a new parallel `DecayEngine.calculatePrdEffectiveImportance` method; legacy `calculateEffectiveImportance` semantics preserved for `DecayScheduler` / `SearchManager` / `SemanticForget`. Target release: **v1.12.0** (after Core).
- **`docs/superpowers/specs/_archived-2026-04-16-context-engine-memory-engine-design.md`** — previous single-spec version of the v1.11.0 + v1.12.0 split, kept with SUPERSEDED banner describing the split rationale and all 11 design changes driven by the review.

## [1.11.0] - 2026-04-24

### Added

- **`MemoryEngine.addTurn` happy path with events** — Implements turn-aware conversation memory ingestion (`src/agent/MemoryEngine.ts`). On each turn: runs the four-tier dedup chain (`checkTierExact` / `checkTierPrefix` / `checkTierJaccard` / optional `checkTierSemantic`); on duplicate, emits `memoryEngine:duplicateDetected` with the existing entity + matched tier and returns it without creating a new record. On non-duplicate: scores importance via `ImportanceScorer` (with optional `queryContext` + `recentTurns` for overlap signal — recent turns auto-loaded from session window if not provided), calls `EpisodicMemoryManager.createEpisode` with role-prefixed observation `[role=...] content`, populates `Entity.contentHash` via `storage.updateEntity`, opportunistically stores the embedding via duck-typed `storeEmbedding` when both an `EmbeddingService` and a SQLite-backed storage are wired, and emits `memoryEngine:turnAdded`. Closes Task 9 of `docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md` and unblocks the v1.11.0 release chain (Tasks 10–15). 5 new unit tests under `describe('MemoryEngine — addTurn')`.

- **`MemoryEngine.getSessionTurns` / `deleteSession` / `listSessions`** — Session lifecycle operations on the engine (`src/agent/MemoryEngine.ts`). `getSessionTurns(sessionId, { role?, limit? })` returns turns in chronological order (oldest first) with optional role filter (`user` / `assistant` / `system`) and optional row limit applied after role filtering. `deleteSession(sessionId)` batch-deletes via `entityManager.deleteEntities`, returns `{ deleted: count }`, and emits `memoryEngine:sessionDeleted` with payload `{ sessionId, deletedCount }`; on unknown session returns `{ deleted: 0 }` without firing the event. `listSessions()` enumerates distinct session IDs across the graph. Closes Task 10 of `docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md`. 6 new unit tests under `describe('MemoryEngine — session operations')` covering all three methods plus event-payload shape assertion.

- **`CLAUDE.md` refreshed for v1.11.0** (closes Task 14 / T08). New `MemoryEngine` architecture block enumerates the public API, four-tier dedup chain, event names, and the `ImportanceScorer` companion. New `Memory Engine (v1.11.0)` env-var subsection lists all ten `MEMORY_ENGINE_*` knobs with defaults. `Entity.contentHash` field added under Data Model. The `agent/` module-line in Module Organization mentions `MemoryEngine + ImportanceScorer`. Gotchas section gained a `npm rebuild better-sqlite3` note for the Node-version ABI-mismatch failure mode that bit the v1.11.0 integration test run.

- **`MemoryEngine` performance smoke tests** — New `tests/performance/memory-engine-perf.test.ts` (closes Task 13 / T07). Three tests gated by `SKIP_BENCHMARKS=true`: P95 latency on `addTurn` over 100 turns (Windows-adjusted threshold of 100ms; spec target was 50ms but Dropbox/antivirus jitter on this dev box requires headroom), P95 latency on `checkDuplicate` Tier-1 over 100 calls (<30ms), and a 1000-call smoke test exercising all four dedup tiers (exact / prefix / Jaccard / no-match) without latency assertions.

- **`MemoryEngine` SQLite round-trip + path-validation widening + stale-test refresh** — Closes T06b follow-on. SQLite side now fully round-trips `MemoryEngine` data:
  - **`agentMetadata` JSON-blob column on `entities`** with idempotent ALTER-TABLE migration. Subsumes every `AgentEntity` / `SessionEntity` / `ArtifactEntity` extension field that doesn't have a native column (memoryType, sessionId, agentId, accessCount, confidence, confirmationCount, visibility, etc., plus SessionEntity timeline fields, plus ArtifactEntity tool fields). Future schema additions extend the `EXTENSION_FIELDS` list — no further migrations needed.
  - **`contentHash` column wiring** — the column existed since the v1.11.0 migration but was missing from `appendEntity` / `saveGraph` / `updateEntity` SQL statements; INSERT/UPDATE now persist it consistently.
  - **`rowToEntity` reads both** — the new column and the JSON blob — and merges parsed extension fields into the returned `Entity`. Tolerant `parseExtensionFields(null|"")` returns `{}`; rejects arrays/primitives masquerading as objects.
  - **3 `it.skip` SQLite tests un-skipped + a 4th added**: contentHash round-trips through SQLite close/reopen, exact-tier dedup hits across reopen, migration is idempotent across multiple opens, and AgentEntity-extension fields survive close/reopen via the blob.
- **Path-validation regression continues to be widened** (started in T03's surgical `ManagerContext`/`GraphStorage`/`SQLiteStorage` fix). Three additional internal call sites identified by code review now pass `confineToBase: false` with rationale comments: `ensureMemoryFilePath` (the `MEMORY_FILE_PATH` env var is explicit user configuration), `StreamingExporter` constructor (export targets are user-supplied), `IOManager.streamExport` (same), and the two CLI export/import sites in `src/cli/commands/io.ts` (CLI-supplied paths are user-explicit). The `..` defense-in-depth check at the top of `validateFilePath` continues to run unconditionally on every site.
- **`tests/unit/utils/entityUtils.test.ts` — 5 stale tests refreshed for the post-`d005821` contract**. The original tests asserted pre-security-fix behavior (default `confineToBase: false`, `..` segments normalized); they were silently failing since the security fix landed. Rewritten to lock in the new contract: default confines to `baseDir`, eager `..` rejection, and an explicit `confineToBase: false` test asserts the escape hatch.

- **`MemoryEngine` integration tests + JSONL field-drift fix** — New `tests/integration/MemoryEngineStorage.test.ts` covers `MemoryEngine` round-trips across `ManagerContext` close/reopen against the JSONL backend: `contentHash` persists, exact-tier dedup hits across reopen, and AgentEntity-extension fields (`sessionId`, `agentId`, `memoryType`, `visibility`, `accessCount`, `confidence`, `confirmationCount`, `contentHash`) all survive serialization. The integration tests surfaced a real persistence bug — `GraphStorage`'s three serialization sites (`appendEntity`, `saveGraphInternal`, `updateEntity`) each enumerated a hardcoded subset of optional fields that had drifted out of date with the type system, silently dropping `contentHash`, `ttl`, `confidence`, and every `AgentEntity` / `SessionEntity` / `ArtifactEntity` extension field on disk write. Centralized into a single `OPTIONAL_PERSISTED_ENTITY_FIELDS` module-level constant + `copyOptionalPersistedFields(src, dst)` helper that all three sites now share, so future schema additions only need to update one list. SQLite-side tests for the same round-trip are gated with `it.skip` and a detailed inline rationale: `SQLiteStorage`'s `rowToEntity` mapper and schema both lack the AgentEntity-extension columns, which needs a parallel SQLite migration + mapper update before the SQLite half can pass. Closes Task 12 of `docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md`.

- **`ctx.memoryEngine` lazy accessor on `ManagerContext`** — Wires `MemoryEngine` into the central facade as a lazy-initialized getter (`src/core/ManagerContext.ts`). Reads ten `MEMORY_ENGINE_*` env vars for dedup thresholds, scorer weights, scan window, and recent-turns budget: `MEMORY_ENGINE_JACCARD_THRESHOLD` (default `0.72`), `MEMORY_ENGINE_PREFIX_OVERLAP` (`0.5`), `MEMORY_ENGINE_DEDUP_SCAN_WINDOW` (`200`), `MEMORY_ENGINE_MAX_TURNS_PER_SESSION` (`1000`), `MEMORY_ENGINE_SEMANTIC_DEDUP` (`false`), `MEMORY_ENGINE_SEMANTIC_THRESHOLD` (`0.92`), `MEMORY_ENGINE_RECENT_TURNS` (`10`), `MEMORY_ENGINE_LENGTH_WEIGHT` / `_KEYWORD_WEIGHT` / `_OVERLAP_WEIGHT` (`0.3 / 0.4 / 0.3`). Pulls the embedding service from `semanticSearch?.getEmbeddingService()` for opportunistic semantic-tier dedup when configured. `agentMemory(config)` now invalidates `_memoryEngine` on re-instantiation so derived caches stay consistent with the underlying `episodicMemory` / `workingMemory` references. `MemoryEngine`, `ImportanceScorer`, and their public types are now exported through `src/agent/index.ts` (and therefore the library's top-level barrel). Closes Task 11 of `docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md`. 3 new unit tests under `describe('MemoryEngine — ManagerContext wiring')`.

### Fixed

- **Path-validation regression breaking ~1700 unit tests** — Commit `d005821` flipped `validateFilePath`'s `confineToBase` default from `false` to `true`, causing every test that passed an `os.tmpdir()` path through `ManagerContext` / `GraphStorage` / `SQLiteStorage` to throw `FileOperationError: Path is outside the allowed directory`. Fixed surgically: the three internal-storage call sites now pass `confineToBase: false` explicitly with rationale comments — their input is application-controlled and was already validated upstream. The defense-in-depth `..`-segment check at the top of `validateFilePath` (the actual security improvement from `d005821`) is preserved unchanged. Public API of `validateFilePath` and the strict default for external callers (CLI, IOManager backup paths) are unchanged. Test suite recovery: 1716 → 87 failures (1629 tests un-broken).

### Notes

- Two design specs reviewed during this cycle by two independent subagents (Opus + Sonnet, each armed with the RLM skill) produced 39 findings. All 8 blockers were validated against the actual memoryjs codebase via the HonestClaude discipline before fixes were applied. The v1.11.0 core spec landed as the implementation in this release; the v1.12.0 decay-extensions spec remains as a design doc only and is tracked under `[Unreleased]` above.
- Test-suite recovery during this cycle: the v1.10.0 path-validation security fix had introduced a regression breaking ~1700 tests (every `os.tmpdir()`-based test). T03 + T06b widened the surgical fix across all internal storage call sites and one CLI site; the defense-in-depth `..` segment check at the top of `validateFilePath` continues to run unconditionally on every site. End state: 5551/5551 unit + integration tests passing.
- Persistence drift was discovered and fixed in BOTH backends during this cycle. JSONL: `GraphStorage`'s three serialization sites had drifted out of sync with the type system; centralized into `OPTIONAL_PERSISTED_ENTITY_FIELDS` constant. SQLite: schema lacked AgentEntity-extension columns and `rowToEntity` lacked the mapping; resolved via single `agentMetadata` JSON-blob column with idempotent migration. Affects every `AgentEntity` / `SessionEntity` / `ArtifactEntity` write — pre-v1.11 data round-trips correctly via the migration path.

## [1.10.0] - 2026-04-14

### Added

- **ObservableDataModel Adapter** (`src/features/ObservableDataModelAdapter.ts`) — bridges memoryjs into JSON-UI's `DataProvider` for the Neural Computer runtime's Path C integration (React renderer + headless renderer sharing one durable-state source).
  - **`createObservableDataModelFromGraph(storage, { projection, onError? })`** — async factory that warms the storage cache once via `loadGraph()` and returns a synchronous adapter satisfying JSON-UI's `ObservableDataModel` structural shape (`get` / `set` / `delete` / `snapshot` / `subscribe` plus an additional `dispose` method).
  - **Pluggable `GraphProjection`** — caller-provided function `(entities, relations) => Record<string, JSONValue>` that decides which entities and observations surface at which paths. memoryjs does not force a projection rule; the consumer (NC) provides one that matches its UI's needs.
  - **Read-only at the JSON-UI boundary.** `set()` and `delete()` throw `ReadOnlyMemoryGraphDataError`. Durable-state writes in the NC architecture go through `ctx.governanceManager.withTransaction` / `ctx.entityManager` / `ctx.observationManager` directly, not through `DataProvider`, so the adapter enforces that boundary at runtime with a clear error message pointing at the alternative.
  - **Synchronous subscribe notification.** The adapter subscribes to `storage.events.onAny` and fires its own subscribers synchronously with the graph mutation event — `GraphEventEmitter.emit` iterates listeners in a plain `for` loop, so the adapter's notifier chain runs before the mutating call returns. Matches JSON-UI's `useSyncExternalStore` tearing-protection contract.
  - **Identity-stable cached snapshot.** The adapter caches the projection result and invalidates it only on mutation. Two `snapshot()` calls with no intervening mutation return the same reference (`Object.is(a, b) === true`), matching the tearing-protection invariant. The cached value is top-level frozen to prevent consumer mutation from corrupting future renders.
  - **`Map<symbol, callback>` listener storage** — registering the same callback twice produces two independent subscriptions, matching JSON-UI runtime-types spec. Unsubscribing one has no effect on the other.
  - **Error isolation.** A throwing projection is logged via `onError` and falls back to an empty snapshot rather than crashing the renderer. A throwing listener is logged and skipped — other listeners continue to fire.
  - **Idempotent `dispose()`** — releases the storage subscription and makes the adapter inert. Safe to call twice. Not required for normal use (the adapter is long-lived) but useful for hot-reload and teardown paths.
  - **21 unit tests** in `tests/unit/features/ObservableDataModelAdapter.test.ts`: factory warm-up, initial-state projection, identity stability (with and without mutation), path walking (top-level, nested objects, array indices, missing keys), synchronous fire on all six graph event types, two-subscriber independence, duplicate-callback independent subscription, unsubscribe isolation, read-only enforcement, projection error fallback, listener error isolation, `dispose` idempotency, and an NC-shaped user+messages projection exercising a realistic flow.

- **`GraphStorage.cachedGraph`** — new synchronous getter returning the in-memory cached graph (or `null` if the cache is not yet warm). Added to support the `ObservableDataModelAdapter`'s synchronous `snapshot()` path — `loadGraph()` is async and cannot be awaited inside `useSyncExternalStore`'s `getSnapshot` callback. Consumers should call `loadGraph()` once to warm the cache, then use `cachedGraph` for subsequent sync reads. The returned reference is the live cache object; do not mutate it.

### Upgrading from 1.9.1

No breaking changes. Existing consumers of the features barrel do not need to do anything. The adapter is opt-in — if you do not import `createObservableDataModelFromGraph`, nothing in your existing pipeline changes.

To use the adapter with JSON-UI's `@json-ui/react` v0.1.0+:

```typescript
import { ManagerContext, createObservableDataModelFromGraph } from '@danielsimonjr/memoryjs';
import { DataProvider } from '@json-ui/react';

const ctx = new ManagerContext('./memory.jsonl');
const adapter = await createObservableDataModelFromGraph(ctx.storage, {
  projection: (entities) => ({
    userName: entities.find((e) => e.entityType === 'user')?.name ?? null,
    messageCount: entities.filter((e) => e.entityType === 'message').length,
  }),
});

// React tree:
<DataProvider store={adapter}>{children}</DataProvider>
```

## [1.9.1] - 2026-04-10

### Added
- **Context Compression**: `ContextWindowManager.compressForContext()` and `compressEntitiesForContext()` — n-gram abbreviation with §-code legend, three compression levels (light/medium/aggressive). `wakeUp()` accepts optional `compress` parameter for token-efficient context loading.
- **Smart Priority Dedup**: `CompressionManager.priorityDedup()` — priority-based deduplication (importance > recency > observation count > tags). Keeps highest-scored entity per duplicate group.
- **Interactive Graph Visualization**: `IOManager.visualizeGraph()` — generates self-contained HTML with D3.js force-directed graph. Nodes colored by type, sized by importance.
- **Mega-File Splitting**: `IOManager.splitTranscript()` — splits concatenated multi-session transcripts into per-session chunks via delimiter detection.
- **Benchmarking Suite**: `benchmarks/synthetic-bench.ts` — synthetic R@5/R@10 recall benchmark across basic, fuzzy, and boolean search modes.

### Fixed
- Resolved 30 merge conflict markers from PR #14 squash merge across 14 files
- Fixed 9 compressForContext review findings (n-gram overcounting, abbreviation code cap, wakeUp try-catch, Map size cap, Entity type cast, edge-case tests)
- Fixed 12 v1.9.0 review findings (wakeUp error logging, DreamEngine failure logging, ingest EntityManager reuse, writeDiary TOCTOU handling, topic filter precision, SHA-256 dedup keys)
- Exported WakeUp types from agent barrel
- Fixed ArtifactManager test mock (graphMutex)

## [1.9.0] - 2026-04-10

### Added — MemPalace Gap-Closing

- **Temporal KG Methods**: `RelationManager.invalidateRelation()`, `queryAsOf()`, `timeline()` — temporal validity convenience methods over existing Relation properties. Time-travel queries and chronological entity stories.
- **Memory Stack Wake-up**: `ContextWindowManager.wakeUp()` — 4-layer memory stack inspired by mempalace. L0 (~100 tokens) loads profile identity, L1 (~500 tokens) loads top entities by importance. Total wake-up cost ~600 tokens.
- **Conversation Ingestion**: `IOManager.ingest()` — format-agnostic pipeline accepting pre-normalized messages. Exchange-pair chunking, dedup, dryRun support. Creates entities with verbatim observations.
- **Agent Diary**: `AgentMemoryManager.writeDiary()` / `readDiary()` — per-agent persistent journal with timestamped, topic-tagged entries. `diary-*` namespace reserved in EntityManager.
- **Zero-Config Semantic Search**: Default embedding provider changed from `none` to `local`. Semantic search works out of the box with bundled ONNX MiniLM model, no API keys needed.
- **Context Compression**: `ContextWindowManager.compressForContext()` and `compressEntitiesForContext()` — n-gram abbreviation with §-code legend, three compression levels (light/medium/aggressive). `wakeUp()` accepts optional `compress` parameter.
- **Auto-Save Hooks**: `hooks/memoryjs_save_hook.sh` and `hooks/memoryjs_precompact_hook.sh` for Claude Code session preservation.

### Related
- Gap analysis: `docs/roadmap/GAP_ANALYSIS_VS_MEMPALACE.md`
- Design spec: `docs/superpowers/specs/2026-04-10-mempalace-gap-closing-design.md`

## [1.8.0] - 2026-04-09

### Added — Supermemory Gap-Closing (Sprint 1)

**Feature 1: Project Scoping**
- New `projectId?: string` field on Entity enables multi-tenant/project isolation.
- `SearchFilterChain` propagates `projectId` filter to all search methods.
- `ManagerContext` accepts `defaultProjectId` option for auto-stamping new entities.
- New `EntityManager.listProjects()` method returns distinct project IDs.
- New `EntityManagerOptions` interface exported from `src/core`.

**Feature 2: Memory Versioning / Contradiction Resolution**
- New Entity fields: `version`, `parentEntityName`, `rootEntityName`, `isLatest`, `supersededBy`.
- New `ContradictionDetector` class uses semantic similarity (default threshold 0.85) to detect contradicting observations.
- On contradiction, `addObservations()` creates a new entity version (`alice-v2`, `alice-v3`, ...) via `supersede()` instead of mutating.
- New `EntityManager.getVersionChain()` and `getLatestVersion()` methods navigate version chains.
- `CompressionManager.findDuplicates` excludes superseded entities; `mergeEntities` throws on superseded entities.
- `SearchFilterChain` excludes entities with `isLatest=false` by default; use `includeSuperseded: true` to see history.
- Opt-in via `enableContradictionDetection` and `contradictionThreshold` options on `ManagerContext`.
- New `SemanticSearch.calculateSimilarity(a, b)` helper method.

**Feature 3: Semantic Forget**
- New `SemanticForget` class with `forgetByContent(content, options)` method.
- Two-tier deletion: exact match first, then semantic search fallback at configurable threshold (default 0.85).
- Supports `dryRun`, `projectId` scoping, and optional audit logging.
- Auto-deletes entities with zero remaining observations.
- New `SemanticForgetResult` and `SemanticForgetOptions` exported types.
- Exposed via `ManagerContext.semanticForget` lazy getter.

**Feature 4: User Profile (Entity-backed)**
- New `ProfileManager` class exposed via `AgentMemoryManager.profileManager`.
- Profiles stored as Entity instances with `entityType='profile'`; observations tagged `[static]` / `[dynamic]`.
- Methods: `getProfile`, `addFact`, `promoteFact`, `extractFromSession`, `getProfileEntityName`.
- Auto-extraction from session observations classified via `SalienceEngine` (static vs dynamic based on baseImportance + recencyBoost).
- Project-scoped profiles via sanitized entity names (`profile-{projectId}` or `profile-global`).
- Session:ended event hook auto-extracts profile facts when `config.profile.autoExtract !== false`.
- New `ProfileEntity` type and `isProfileEntity()` guard.
- `EntityManager.createEntities` reserves the `profile-*` namespace and throws `ValidationError` for non-profile entities using it.

### Changed
- `Entity` interface gains 6 optional fields (`projectId`, `version`, `parentEntityName`, `rootEntityName`, `isLatest`, `supersededBy`). All backwards-compatible.
- `ManagerContext` constructor now accepts either a string path (legacy) or a `ManagerContextOptions` object with `defaultProjectId`, `enableContradictionDetection`, `contradictionThreshold`.
- `SearchFilterChain` early-return optimization removed (always runs filter loop to ensure versioning filter applies).
- `CreateEntitySchema` and `UpdateEntitySchema` extended to allow new Entity fields.

### Storage
- SQLite: 6 new columns added to entities table with indexes on `projectId` and `isLatest`. Existing databases are migrated additively via `ALTER TABLE ADD COLUMN` in `migrateEntitiesTable()`.
- JSONL: New fields serialized alongside existing optional fields in all three serialization paths.

### Related
- Design spec: `docs/superpowers/specs/2026-04-09-supermemory-gap-closing-design.md`
- Gap analysis: `docs/roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md`
- Implementation plan: `docs/superpowers/plans/2026-04-09-supermemory-gap-closing.md`

## [1.7.0] - 2026-03-24

### Added

- **Role-Aware Memory Customization** (`src/agent/RoleProfiles.ts`): Five built-in role profiles (`researcher`, `planner`, `executor`, `reviewer`, `coordinator`) each with distinct salience weight configurations and token budget splits. `RoleProfileManager` selects and applies profiles to `SalienceEngine` and `ContextWindowManager` at agent instantiation.
- **Entropy-Aware Filtering** (`src/agent/EntropyFilter.ts`): Shannon entropy gate that drops low-information memories before distillation. `EntropyFilter` computes per-entity entropy scores from observation diversity and rejects entries below a configurable threshold. Integrated as an early stage in `ConsolidationPipeline`.
- **Recursive Memory Consolidation** (`src/agent/ConsolidationScheduler.ts`): Background scheduler that runs deduplication and merge passes on long-term memory at configurable intervals. `ConsolidationScheduler` invokes `ConsolidationPipeline.runAutoConsolidation()` recursively, merging near-duplicate entities until a fixed point is reached.
- **Visual Salience Budget Allocation** (`src/agent/MemoryFormatter.ts`): `formatWithSalienceBudget()` method on `MemoryFormatter` that proportionally allocates token budget across memory types (working / episodic / semantic) based on their aggregate salience scores, producing balanced prompt sections.
- **Collaborative Memory Synthesis** (`src/agent/CollaborativeSynthesis.ts`): Graph-neighbourhood synthesis that merges observations from all agents within N hops of a target entity. `CollaborativeSynthesis.synthesize()` walks the relation graph, collects agent-contributed observations, and returns a unified view with provenance metadata.
- **Failure-Driven Memory Distillation** (`src/agent/FailureDistillation.ts`): Causal chain analysis that extracts lessons from failed episodes. `FailureDistillation.distill()` reconstructs the event sequence leading to a failure entity, scores each step by causal contribution, and promotes high-scoring observations to semantic memory as reusable lessons.
- **Cognitive Load Metrics** (`src/agent/CognitiveLoadAnalyzer.ts`): Token density, redundancy ratio, and observation diversity scoring for a memory set. `CognitiveLoadAnalyzer.analyze()` returns a `CognitiveLoadReport` with per-dimension scores and an overall load index, used by `ContextWindowManager` to prune high-load sections before prompting.
- **Shared Memory Visibility Hierarchies** (`src/agent/VisibilityResolver.ts`): Five-level visibility model (`private` | `team` | `org` | `shared` | `public`) with `GroupMembership` registry. `VisibilityResolver.resolve()` filters memory sets for a requesting agent based on its group memberships and the target entity's visibility level.

## [1.6.0] - 2026-03-24

### Added

- **Stable Index Dereferencing** (`src/core/RefIndex.ts`): Named reference system for O(1) entity lookup. `RefIndex` class with JSONL sidecar persistence, `register`/`resolve`/`deregister` operations. Integrated into `EntityManager` and `ManagerContext`.
- **Artifact-Level Granularity** (`src/agent/ArtifactManager.ts`): `createArtifact()` generates stable human-readable names (`toolName-date-shortId`) and auto-registers refs. Introduces `ArtifactEntity` type and `ArtifactType` union.
- **Temporal Range Queries** (`src/search/TemporalQueryParser.ts`, `src/search/TemporalSearch.ts`): Natural language time expression parsing via `chrono-node` ("10 minutes ago", "last hour", "yesterday"). `SearchManager.searchByTime()` and `ManagerContext.temporalSearch` accessor.
- **Memory Distillation Policy** (`src/agent/DistillationPolicy.ts`, `src/agent/DistillationPipeline.ts`): Post-retrieval filter with `IDistillationPolicy` interface. Ships with `DefaultDistillationPolicy` (relevance + freshness + dedup), `CompositeDistillationPolicy`, and `NoOpDistillationPolicy`. Wired into `ContextWindowManager`.
- **Temporal Governance & Freshness** (`src/features/FreshnessManager.ts`): `Entity.ttl` and `Entity.confidence` fields. `FreshnessManager` with `calculateFreshness`, `getStaleEntities`, `getExpiredEntities`, and `generateReport`. `DecayEngine` enhanced with TTL-aware decay. `SalienceEngine` adds `freshnessWeight` scoring component.
- **N-gram Hashing** (`src/search/NGramIndex.ts`): Trigram index with Jaccard similarity for `FuzzySearch` pre-filtering. Reduces Levenshtein candidate set before worker dispatch.
- **LLM Query Planner** (`src/search/LLMQueryPlanner.ts`, `src/search/LLMSearchExecutor.ts`): Optional module that decomposes natural language queries into a `StructuredQuery`. `LLMProvider` interface, keyword fallback when no provider configured, JSON validation with recovery. `ManagerContext.queryNaturalLanguage()` entry point.
- **Dynamic Memory Governance** (`src/features/AuditLog.ts`, `src/features/GovernanceManager.ts`): `AuditLog` with JSONL persistence for immutable operation history. `GovernanceManager` with `withTransaction`/`rollback` semantics. `GovernancePolicy` interface (`canCreate`/`canUpdate`/`canDelete`).

## [Pre-1.6.0 CLI hardening — legacy unreleased section]

> Historical entry: this block was previously labeled `[Unreleased]` but the work described here landed before v1.6.0 was tagged. Retained as-is for changelog continuity. Cross-references the [1.6.0] section above for the full feature set that shipped in that release.

### Added
- **CLI: New commands**: Added hierarchy (set-parent, children, ancestors, descendants, roots), graph (shortest-path, centrality, components), maintenance (stats, archive, compress, validate), and tag management (add, remove, aliases) commands
- **CLI: New formatters**: Added `formatPath`, `formatCentrality`, `formatComponents`, `formatValidation` with json/table/csv support
- **CLI: Interactive mode commands**: Added tags, path, observe, delete, and export commands to the REPL
- **CLI: Search modes**: Added `--ranked`, `--boolean`, `--fuzzy`, `--suggest` flags to search command
- **CLI: Import/export formats**: Added gexf and dot format support to import/export commands

### Changed
- **CLI: Modular command structure**: Split monolithic `commands/index.ts` into 9 focused files (entity, relation, search, observation, tag, hierarchy, graph, io, maintenance) with shared helpers
- **CLI: Search uses autoSearch**: Default search now uses `autoSearch()` with real relevance scores instead of `searchNodes()` with fake scoring
- **Simplify ManagerContext**: Replaced 12 lazy-initialized getter properties with eagerly initialized `readonly` fields for core managers (EntityManager, RelationManager, ObservationManager, HierarchyManager, GraphTraversal, SearchManager, RankedSearch, IOManager, TagManager, AnalyticsManager, CompressionManager, ArchiveManager). Agent memory managers retain lazy initialization due to conditional creation and dependency chains. Moved env var helpers to module-level functions.
- **Inline StorageFactory in ManagerContext**: ManagerContext now creates storage directly instead of going through StorageFactory. StorageFactory remains available as a public API export for external consumers.
- **Simplify SearchManager**: Expose sub-managers as `readonly` properties for direct access, trim verbose JSDoc examples (~200 lines reduced), remove `getQueryEstimator()` method (use `queryEstimator` property directly).
- **Simplify AgentMemoryManager**: Trim verbose JSDoc comments and interface docs (~280 lines reduced). Component managers remain accessible via public getters.
- **Simplify QueryCostEstimator**: Trim verbose JSDoc and remove Phase/Sprint references (826 -> 680 lines). All functionality preserved.
- **Consolidate validation to Zod schemas**: Rewrite manual `validateEntity`, `validateRelation`, `validateTags` functions in schemas.ts as thin wrappers around Zod schemas, eliminating ~70 lines of duplicate hand-rolled validation logic.
- **Trim search class JSDoc**: Reduce verbose JSDoc in BasicSearch, SymbolicSearch, and SearchSuggestions. Classes retained (public API) with trimmed documentation.
- **Simplify hybrid search JSDoc**: Trim verbose JSDoc and Phase/Sprint references in HybridSearchManager, HybridScorer, and QueryPlanner (~120 lines reduced).
- **Trim AgentMemoryConfig JSDoc**: Remove field-level comments and verbose module docs (~40 lines reduced). Config structure and validation preserved.
- **Trim index class JSDoc**: Remove verbose JSDoc from NameIndex, TypeIndex, LowercaseCache, RelationIndex, and ObservationIndex (~120 lines reduced). All index classes retained with functionality preserved.
- **Trim IOManager JSDoc**: Remove verbose method-level JSDoc, @example blocks, @param tags, Phase/Sprint references, and interface field comments (~130 lines reduced). Splitting deferred to avoid breaking public API.
- **Trim TransactionManager JSDoc**: Remove @example blocks, @param/@returns tags, and Phase references from TransactionManager and BatchTransaction (~250 lines reduced).
- **Trim WorkerPoolManager JSDoc**: Remove @example blocks, @param/@returns tags, Phase references, and interface field comments (~130 lines reduced).
- **Trim errors.ts JSDoc**: Remove Phase/Sprint references, @example blocks, and multi-line JSDoc from error classes and ErrorOptions interface (~60 lines reduced). Suggestions system retained (public API).

### Fixed
- **CLI: Path traversal in import/export**: File paths now resolved with `path.resolve()` and formats validated via `commander Option.choices()`
- **CLI: CSV injection in tag aliases**: Tag alias CSV output now uses shared `escapeCSV` function
- **CLI: CSV escaping in observation list**: Observation CSV output now uses shared `escapeCSV` instead of inline escaping that missed newlines
- **CLI: Observation remove on non-existent entity**: Now checks entity existence before attempting removal
- **CLI: Unused --force flag on entity delete**: Removed declared but never-used flag
- **CLI: Fake search scoring**: Boolean/fuzzy search results now use constant `1.0` score instead of misleading `1.0 - idx * 0.01`
- **CLI: Interactive export format validation**: Export format validated against allowlist before use
- **Benchmark flakiness**: Increased task-scheduler overhead threshold from 100% to 150% to account for Windows/Dropbox timing variance
- **SearchCache TTL=0 race condition**: Fixed TTL expiration check using `>=` instead of `>`, so entries with TTL=0 expire immediately on the next `get()` call rather than persisting when accessed within the same millisecond.

## [1.5.0] - 2026-02-06

### Fixed
- **Build: SchemaValidator ajv type error**: Fixed `import('ajv')` breaking `typecheck` and DTS generation since ajv is an optional peer dependency not in package.json. Applied type assertion for the dynamic import.
- **Git repository corruption recovery**: Recovered from Dropbox-induced git object corruption by re-syncing with remote origin.

### Improved
- **CLAUDE.md overhaul**: Restructured documentation for better Claude Code productivity
  - Added Node.js >= 18.0.0 requirement
  - Added CLI module documentation (`memory` / `memoryjs` binaries)
  - Reorganized search system into layered architecture groupings (text, ranked, semantic, hybrid, optimization, retrieval, infrastructure)
  - Reorganized agent memory into concern groupings (facade, sessions, memory types, decay/salience, multi-agent, processing, context)
  - Documented all 3 tsup entry points (library, CLI, workers) and `prepublishOnly` workflow
  - Consolidated verbose env var tables into compact format
  - Added Gotchas section with 5 non-obvious issues

## [1.4.0] - 2026-01-20 - Agent Memory System

### Added

#### Sprint 1: Extended Type Definitions
- **AgentEntity Interface**: Extended Entity with 20+ fields for AI agent memory systems
  - Memory classification (working/episodic/semantic/procedural)
  - Session and task context (sessionId, conversationId, taskId)
  - Lifecycle management (expiresAt, promotedAt, markedForPromotion)
  - Access tracking (accessCount, lastAccessedAt, accessPattern)
  - Memory strength (confidence, confirmationCount, decayRate)
  - Multi-agent support (agentId, visibility, source)
- **AgentObservation Interface**: Extended observations with confidence, temporal validity, provenance
- **SessionEntity Interface**: Session tracking with status, goals, and session linking
- **MemorySource Interface**: Provenance tracking for memory origin
- **Type Guards**: isAgentEntity, isSessionEntity, isWorkingMemory, isEpisodicMemory, isSemanticMemory, isProceduralMemory
- **AccessContextBuilder**: Fluent builder for access context construction
- **Utility Types**: WorkingMemoryEntity, EpisodicMemoryEntity, SemanticMemoryEntity, ProceduralMemoryEntity

#### Sprint 2: Access Tracking Foundation
- **AccessTracker Class**: Tracks memory access patterns for decay and ranking
  - recordAccess() with context (session, task, query, retrieval method)
  - getAccessStats() with pattern classification (frequent/occasional/rare)
  - calculateRecencyScore() using exponential decay formula
  - getFrequentlyAccessed() and getRecentlyAccessed() with time filtering
  - Static utility calculateRecencyScoreFromTimestamp()
- **AccessStats Interface**: Statistics including access counts, patterns, intervals
- **AccessTrackerConfig**: Configurable buffer size, half-life, frequency thresholds

#### Sprint 3: Access Tracking Integration
- **SearchManager Integration**: Optional access tracking via SearchOptionsWithTracking
- **EntityManager Integration**: Optional access tracking via GetEntityOptions for getEntity()
- **GraphTraversal Integration**: Optional access tracking via TraversalOptionsWithTracking for findShortestPath() and findAllPaths()
- **ManagerContext Integration**: AccessTracker lazy-initialized and wired to all managers

#### Sprint 4: Decay Engine Foundation
- **DecayEngine Class**: Time-based memory importance decay with exponential decay formula
  - calculateDecayFactor() with configurable half-life and importance modulation
  - calculateEffectiveImportance() combining base importance, decay, and strength multiplier
  - getDecayedMemories() to find memories below threshold
  - getMemoriesAtRisk() to identify at-risk memories
  - reinforceMemory() to strengthen memories against decay
  - applyDecay() for batch decay analysis
  - Static calculateDecayFactorStatic() utility
- **DecayEngineConfig**: Configurable half-life, modulation settings, minimum floor
- **Strength Multiplier**: Confirmations (+10% each) and accesses (+1% per 100)

#### Sprint 5: Decay Engine Operations
- **forgetWeakMemories() Method**: Delete or archive memories below effective importance threshold
  - Support for age filtering (olderThanHours)
  - Tag exclusion protection (excludeTags)
  - Dry-run mode for preview
  - Removes related relations when forgetting
- **DecayScheduler Class**: Scheduled periodic decay and forget operations
  - Configurable decay interval (decayIntervalMs)
  - Optional auto-forget with forgetOptions
  - Callbacks for monitoring (onDecayComplete, onForgetComplete, onError)
  - Manual cycle execution via runNow()
- **ManagerContext Integration**: DecayEngine and DecayScheduler accessible via context
  - Environment variable configuration (MEMORY_DECAY_*, MEMORY_AUTO_DECAY, etc.)
  - Lazy initialization with proper dependency wiring

#### Sprint 6: Working Memory Manager Foundation
- **WorkingMemoryManager Class**: Session-scoped, TTL-based short-term memory management
  - createWorkingMemory() with auto-generated unique names
  - getSessionMemories() with filtering by entityType, taskId, importance
  - clearExpired() for automatic cleanup of TTL-expired memories
  - extendTTL() to extend memory lifetime
  - markForPromotion() and getPromotionCandidates() for promotion workflow
- **WorkingMemoryConfig**: Configurable defaults (TTL, max per session, auto-promote thresholds)
- **SessionMemoryFilter**: Filter options for session memory queries
- **Session Index**: In-memory index for O(1) session lookups

#### Sprint 7: Working Memory Promotion
- **Enhanced markForPromotion()**: Added PromotionMarkOptions for target type and priority
  - targetType option to specify 'episodic' or 'semantic' destination
  - Adds promote_to_{type} tag for promotion workflow tracking
- **Enhanced getPromotionCandidates()**: Added PromotionCriteria for flexible candidate selection
  - Priority-based sorting (marked candidates get +100 priority)
  - Customizable thresholds for confidence, confirmations, and access count
  - includeMarked option to filter marked-only candidates
- **promoteMemory() Method**: Convert working memory to long-term storage
  - Supports promotion to episodic or semantic memory types
  - Clears TTL-related fields (expiresAt, isWorkingMemory, markedForPromotion)
  - Sets promotion tracking metadata (promotedAt, promotedFrom)
  - Removes entity from session index after promotion
- **confirmMemory() Method**: Strengthen memories with confirmation tracking
  - Increments confirmationCount on each call
  - Optional confidence boost parameter
  - Auto-promotion trigger when thresholds met (if enabled)
- **New Interfaces**: PromotionMarkOptions, PromotionCriteria, PromotionResult, ConfirmationResult

#### Sprint 8: Session Management
- **SessionManager Class**: Full session lifecycle management for conversations and tasks
  - startSession() with auto-generated or custom session IDs
  - Support for goal description, task type, and user intent metadata
  - Session continuation via previousSessionId linking
  - endSession() with configurable cleanup and promotion
  - getActiveSession() and getActiveSessions() for current session queries
  - getSessionHistory() with filtering by status, taskType, agentId, date range
  - Pagination support for session history
- **Session Linking**: Bidirectional session relationship management
  - linkSessions() for relating multiple sessions
  - getSessionChain() for traversing session continuity chains
  - Automatic linking when continuing from previous session
- **End Session Options**: Configurable behavior on session end
  - promoteOnEnd: Promote high-confidence memories to long-term storage
  - cleanupOnEnd: Delete remaining working memories
  - EndSessionResult with promotion and cleanup statistics
- **New Interfaces**: SessionConfig, StartSessionOptions, SessionHistoryOptions, EndSessionResult

#### Sprint 9: Session-Scoped Queries
- **SessionQueryBuilder Class**: Fluent interface for building session-scoped queries
  - forSession() to restrict to single session
  - forSessions() to search across multiple sessions
  - withRelatedSessions() to include related session memories
  - fromCurrentSession() and fromLastNSessions() for common patterns
  - Chainable filter methods for task, importance, and memory types
- **Temporal Query Helpers**: Easy date-based filtering
  - createdToday() for today's memories only
  - createdInLastHours(n) and createdInLastDays(n) for relative time
  - inTimeRange(start, end) for explicit date ranges
- **Cross-Session Search**: Search across multiple sessions with ranking
  - searchWithRecencyRanking() applies recency boost to recent sessions
  - Deduplication across session boundaries
- **Entity With Context**: Retrieve entities with session metadata
  - getEntityWithContext() returns entity with session and related sessions
  - EntityWithContext interface for typed context access
- **New Interfaces**: SessionSearchOptions, EntityWithContext, SearchFunction

#### Sprint 10: Episodic Memory Structure
- **EpisodicMemoryManager Class**: Temporal and causal organization of event history
  - createEpisode() for creating episodic memories with session/task context
  - createEventSequence() for batch creation of linked events
  - linkSequence() for linking existing events in temporal order
- **Temporal Relations**: Bidirectional event sequencing
  - EpisodicRelations constants (PRECEDES, FOLLOWS, CAUSES, CAUSED_BY, PART_OF_SEQUENCE)
  - Automatic linking when previousEventId specified
  - getNextEvent() and getPreviousEvent() for navigation
- **Timeline Queries**: Chronological retrieval of episodic memories
  - getTimeline() with ascending/descending order and time range filtering
  - iterateForward() and iterateBackward() async generators
  - Pagination support with limit/offset
  - getAllEpisodes() for cross-session retrieval
- **Causal Relationship Tracking**: Cause-effect chains between events
  - addCausalLink() creates bidirectional causes/caused_by relations
  - getCausalChain() traverses causal chains with cycle detection
  - getDirectCauses() and getDirectEffects() for immediate relationships
- **Session Integration**: Automatic session summaries on end
  - SessionManager creates episodic summary when session ends
  - Summary includes goal, timestamps, status, and memory count
  - has_summary relation links session to summary
  - createSummaryOnEnd config option (default: true when EpisodicMemoryManager provided)
- **New Interfaces**: EpisodicMemoryConfig, CreateEpisodeOptions, TimelineOptions

#### Sprint 11: Consolidation Pipeline Foundation
- **ConsolidationPipeline Class**: Orchestrates memory transformation to long-term storage
  - consolidateSession() processes all working memories for a session
  - consolidateSessions() for batch processing multiple sessions
  - Filters candidates by confidence and confirmation thresholds
  - Configurable summarization and pattern extraction flags
- **Promotion System**: Convert working memory to long-term storage
  - promoteMemory() with target type (episodic/semantic)
  - Clears TTL fields and sets promotion metadata
  - Reinforces memory against decay after promotion
  - getPromotionCandidates() for candidate evaluation
  - isPromotionEligible() for eligibility checks
- **Pipeline Stages**: Pluggable processing architecture
  - PipelineStage interface for custom processors
  - registerStage() to add processors
  - Stages executed in registration order
  - StageResult aggregation across all stages
- **Consolidation Types**: New type definitions for consolidation
  - ConsolidateOptions for operation configuration
  - ConsolidationResult for statistics tracking
- **New Interfaces**: ConsolidationPipelineConfig, PipelineStage, StageResult

#### Sprint 12: Observation Summarization
- **SummarizationService Class**: Text summarization with LLM fallback
  - summarize() with optional LLM provider or algorithmic fallback
  - calculateSimilarity() using TF-IDF cosine similarity
  - groupSimilarObservations() for clustering related observations
  - summarizeGroups() for batch summarization
  - Pluggable ISummarizationProvider interface for LLM integration
- **ConsolidationPipeline Summarization**: Memory observation compression
  - summarizeObservations() groups and summarizes entity observations
  - applySummarizationToEntity() updates storage with compressed observations
  - Configurable similarityThreshold for grouping control
  - Compression ratio tracking in SummarizationResult
- **New Interfaces**: SummarizationConfig, GroupingResult, SummarizationResult, ISummarizationProvider

#### Sprint 13: Pattern Extraction
- **PatternDetector Class**: Token-based pattern detection for observations
  - detectPatterns() identifies recurring templates with variable slots
  - extractTemplate() creates patterns with {X} variable markers
  - matchesPattern() checks if observation matches a template
  - calculatePatternSpecificity() measures pattern specificity
  - mergeConsecutiveVariables() for pattern normalization
- **ConsolidationPipeline Pattern Methods**: Pattern-based semantic memory creation
  - extractPatterns() analyzes entity observations by type
  - createSemanticFromPattern() converts patterns to semantic memories
  - extractAndCreateSemanticPatterns() end-to-end pattern processing
  - Creates derived_from relations to source entities
  - getPatternDetector() accessor for advanced operations
- **New Types**: PatternResult interface with pattern template, variables, occurrences, confidence, sourceEntities

#### Sprint 14: Memory Merging
- **ConsolidationPipeline Merge Methods**: Duplicate detection and memory consolidation
  - mergeMemories() with three strategies: newest, strongest, merge_observations
  - findDuplicates() for similarity-based duplicate detection using TF-IDF
  - autoMergeDuplicates() for automatic merging above similarity threshold
  - getMergeHistory() retrieves audit trail for entity merge operations
  - Automatic relation retargeting when entities are merged
  - Audit trail creation via merge_audit entities
- **New Types**: MemoryMergeStrategy type, MergeResult interface, DuplicatePair interface

#### Sprint 15: Auto-Consolidation Rules
- **RuleEvaluator Class**: Condition evaluation with caching and AND/OR logic
  - evaluate() checks conditions against entity properties
  - calculateAgeHours() for age-based condition evaluation
  - Caching with cache key based on entity name, lastModified, and conditions
  - clearCache() and getCacheSize() for cache management
- **ConsolidationPipeline Rule Management**: Rule-based automatic consolidation
  - addRule() to register consolidation rules
  - removeRule() to delete rules by name
  - getRules() returns readonly list of registered rules
  - clearRules() removes all rules
  - getRuleEvaluator() accessor for advanced operations
- **Auto-Consolidation Methods**: Trigger-based rule execution
  - runAutoConsolidation() processes rules matching trigger type
  - executeRule() evaluates entities against rule conditions and executes actions
  - triggerManualConsolidation() convenience method for manual trigger
  - Priority-based rule processing (higher priority first)
- **New Types**: ConsolidationTrigger, ConsolidationAction, RuleConditions, ConsolidationRule, RuleEvaluationResult

#### Sprint 16: Salience Engine Foundation
- **SalienceEngine Class**: Context-aware memory relevance scoring
  - calculateSalience() computes multi-factor score with component breakdown
  - rankEntitiesBySalience() for sorting entities by relevance
  - getTopSalient() retrieves highest-salience entities from storage
  - Configurable weights for importance, recency, frequency, context, and novelty
- **Salience Components**: Five-factor scoring model
  - baseImportance: DecayEngine effective importance normalized to 0-1
  - recencyBoost: Exponential decay from last access time with temporal focus
  - frequencyBoost: Log-normalized access count from AccessTracker
  - contextRelevance: Task/session/query/intent matching
  - noveltyBoost: Inverse recency to surface less recently accessed items
- **Temporal Focus Support**: Adjustable behavior for recent vs historical focus
  - recent: Boosts recently accessed, reduces novelty
  - historical: Boosts novelty, reduces recency
  - balanced: Default equal weighting
- **New Types**: SalienceContext, SalienceWeights, SalienceComponents, ScoredEntity, TemporalFocus

#### Sprint 17: Context Relevance Scoring
- **Enhanced Task Relevance**: TF-IDF similarity for semantic task matching
  - calculateTaskRelevance() uses SummarizationService for cosine similarity
  - Falls back to keyword matching when semantic similarity disabled
  - Returns 1.0 for exact task ID match
- **Query Text Matching**: Semantic query matching via TF-IDF
  - calculateQueryRelevance() for query text similarity scoring
  - Uses buildEntityText() to combine name, type, and observations
- **Session Context Scoring**: Configurable session boost factor
  - calculateSessionRelevance() with configurable boost factor
  - recentEntityBoostFactor for recent entity context boost
- **Intent Relevance**: User intent matching via semantic similarity
  - calculateIntentRelevance() for user intent scoring
- **Enhanced Novelty Calculation**: Multi-factor novelty scoring
  - Time-based novelty (50%): Inverse of recency
  - Access frequency novelty (30%): Rare access = more novel
  - Observation uniqueness (20%): Diverse observations = more novel
  - calculateObservationUniqueness() measures observation diversity
- **Configuration Options**: New configurable parameters
  - sessionBoostFactor: Boost for session match (default: 1.0)
  - recentEntityBoostFactor: Boost for recent entities (default: 0.7)
  - useSemanticSimilarity: Enable TF-IDF matching (default: true)
  - uniquenessThreshold: Threshold for observation uniqueness (default: 0.5)

#### Sprint 18: Context Window Manager Foundation
- **ContextWindowManager Class**: Token-budgeted memory retrieval
  - estimateTokens() using word count heuristic (words * 1.3 multiplier)
  - estimateTotalTokens() for batch estimation
  - prioritize() greedy algorithm maximizing salience/token efficiency
  - retrieveForContext() main retrieval method with options
- **Token Budget Management**: Stay within LLM context limits
  - Configurable maxTokens with reserve buffer
  - Greedy selection by salience/token ratio
  - Must-include entities bypass budget constraints
- **Memory Type Filtering**: Selective retrieval options
  - includeWorkingMemory, includeEpisodicRecent, includeSemanticRelevant
  - minSalience threshold filtering
- **Result Package**: Detailed retrieval results
  - Token breakdown by memory type (working, episodic, semantic, procedural)
  - Excluded entities with reasons (budget_exceeded, low_salience, filtered)
  - Suggestions for high-salience excluded entities
- **New Types**: ContextRetrievalOptions, TokenBreakdown, ContextPackage, ExcludedEntity

#### Sprint 19: Context-Optimized Retrieval
- **Budget Allocation Configuration**: Configurable budget percentages per memory type
  - workingBudgetPct: Working memory allocation (default: 30%)
  - episodicBudgetPct: Episodic memory allocation (default: 30%)
  - semanticBudgetPct: Semantic memory allocation (default: 40%)
  - recentSessionCount: Number of recent sessions for episodic (default: 3)
- **Type-Specific Retrieval Methods**: Specialized retrieval per memory type
  - retrieveWorkingMemory() with session filtering and budget constraints
  - retrieveEpisodicRecent() sorted by recency with session limiting
  - retrieveSemanticRelevant() prioritized by context salience
  - retrieveMustInclude() with warning generation for missing/exceeding budget
- **Budget Allocation Retrieval**: Coordinated multi-type retrieval
  - retrieveWithBudgetAllocation() allocates budget across memory types
  - Must-include entities subtracted from total budget first
  - Deduplication across memory type sources
  - Minimum salience filtering with must-include protection

#### Sprint 20: Spillover and Diversity
- **Spillover Handling**: Track and paginate content that exceeds budget
  - handleSpillover() tracks excluded entities with suggestions
  - retrieveSpilloverPage() pagination for follow-up retrieval
  - Cursor-based pagination with salience priority preservation
  - Generates suggestions for high-salience excluded content
- **Diversity Enforcement**: Prevent redundant context
  - enforceDiversity() detects and replaces similar entities
  - calculateDiversityScore() measures content variety
  - Configurable diversityThreshold (default: 0.8)
  - findDiverseReplacement() finds unique alternatives
- **Heap-Based Selection**: Efficient top-N retrieval
  - getMostSalient() uses min-heap for O(n log k) selection
  - calculateEntitySimilarity() for diversity checking
- **MemoryFormatter Class**: Format memories for LLM consumption
  - formatForPrompt() human-readable text output
  - formatAsJSON() structured data for tool use
  - formatCompact() minimal token format
  - formatByType() grouped by memory type
  - formatSummary() context package summary
  - Customizable templates and token limits
- **ManagerContext Integration**: Unified access to agent memory components
  - salienceEngine property with env var configuration
  - contextWindowManager property with env var configuration
  - memoryFormatter property with env var configuration
- **New Types**: SpilloverResult, MemoryFormatterConfig

#### Sprint 21: Agent Identity
- **AgentMetadata Type**: Agent identity and capability tracking
  - AgentType enum: llm, tool, human, system, default
  - trustLevel: Normalized 0-1 trust score
  - capabilities: String array for access control
  - createdAt/lastActiveAt: Activity timestamps
  - Optional custom metadata extension
- **MultiAgentMemoryManager Class**: Multi-agent memory coordination
  - registerAgent() with ID validation and metadata defaults
  - unregisterAgent() with default agent protection
  - getAgent() and hasAgent() for agent lookup
  - listAgents() with filtering by type, trust level, capability
  - getAgentCount() for registered agent count
- **Agent Memory Operations**: Ownership tracking
  - createAgentMemory() with automatic ownership assignment
  - getAgentMemories() for agent-owned memory retrieval
  - getVisibleMemories() respecting visibility rules
  - transferMemory() for ownership transfer
  - setMemoryVisibility() to change visibility level
- **Visibility Controls**: Cross-agent access control
  - private: Only visible to owning agent
  - shared: Visible to all registered agents
  - public: Visible to all including unregistered
  - allowCrossAgent config option for isolation
  - requireRegistration config option for strict mode
- **Event System**: Agent and memory lifecycle events
  - agent:registered, agent:unregistered events
  - memory:created, memory:transferred, memory:visibility_changed events
- **New Types**: MultiAgentConfig, AgentMetadata, AgentType

#### Sprint 22: Memory Visibility
- **Visibility Convenience Methods**: Simplified visibility changes
  - shareMemory() sets visibility to 'shared' for all registered agents
  - makePublic() sets visibility to 'public' for all including unregistered
  - makePrivate() sets visibility to 'private' for owner only
- **Visibility Filtering**: Filter entities by agent permissions
  - filterByVisibility() filters entity array by agent visibility rules
  - isMemoryVisible() checks if specific memory is visible to agent
  - getVisibleMemoriesByType() retrieves visible memories of specific type
- **Visibility-Aware Search**: Search with automatic visibility filtering
  - searchVisibleMemories() searches across visible memories only
  - Case-insensitive matching on name and observations
  - Respects private/shared/public visibility rules

#### Sprint 23: Cross-Agent Operations
- **Shared Memory Queries**: Find memories accessible to multiple agents
  - getSharedMemories() returns memories visible to all specified agents
  - Optional filtering by entity type and date range
  - Respects private/shared/public visibility rules
- **Cross-Agent Search**: Search across multiple agents with trust weighting
  - searchCrossAgent() searches visible memories from multiple agents
  - Optional trust-weighted scoring (useTrustWeighting, trustWeight)
  - Filter by specific agent IDs and entity type
  - Ranked results by combined relevance and trust score
- **Memory Copying**: Copy shared memories to private store
  - copyMemory() creates owned copy with source tracking
  - Tracks original entity ID and acquisition method
  - Optional custom name and annotation
  - Configurable visibility for the copy
- **Collaboration Events**: Audit trail for cross-agent operations
  - memory:cross_agent_search event for search operations
  - memory:copied event for memory copy operations
  - memory:cross_agent_access event for access tracking
  - recordCrossAgentAccess() for manual access recording
- **Collaboration Statistics**: Track sharing and access patterns
  - getCollaborationStats() returns sharing metrics
  - Counts shared, public, and accessible memories

#### Sprint 24: Conflict Resolution
- **ConflictResolver Class**: Detect and resolve memory conflicts
  - detectConflicts() finds contradictions using similarity and negation
  - Configurable similarityThreshold (default: 0.7)
  - Negation pattern detection for contradictory observations
- **Resolution Strategies**: Five strategies for conflict resolution
  - most_recent: Select by lastModified timestamp
  - highest_confidence: Select by confidence score
  - most_confirmations: Select by confirmation count
  - trusted_agent: Select by agent trustLevel
  - merge_all: Combine observations from all sources
- **resolveConflict() Method**: Apply strategy to conflicting memories
  - Returns resolution result with audit trail
  - Emits memory:conflict_resolved event
- **mergeCrossAgent() Method**: Merge memories from multiple agents
  - Trust-weighted confidence calculation
  - Preserves provenance from all sources
  - Optional conflict resolution with configurable strategy
- **Conflict Events**: Audit trail for conflict operations
  - memory:conflict event on detection
  - memory:conflict_resolved event on resolution
  - memory:merged event on cross-agent merge
- **New Types**: ConflictStrategy, ConflictInfo, ConflictResolverConfig, ResolutionResult

#### Sprint 25: Integration and Facade
- **AgentMemoryManager Class**: Unified facade for all agent memory operations
  - Session lifecycle: startSession(), endSession(), getActiveSession()
  - Working memory: addWorkingMemory(), getSessionMemories(), confirmMemory(), promoteMemory()
  - Episodic memory: createEpisode(), getTimeline()
  - Context retrieval: retrieveForContext(), formatForPrompt()
  - Decay management: getDecayedMemories(), forgetWeakMemories(), reinforceMemory()
  - Multi-agent: registerAgent(), getSharedMemories(), searchCrossAgent(), detectConflicts()
- **AgentMemoryConfig Interface**: Unified configuration for all components
  - Environment variable loading via loadConfigFromEnv()
  - Programmatic configuration with mergeConfig()
  - Configuration validation with validateConfig()
- **ManagerContext Integration**: agentMemory() accessor for facade
  - Optional configuration override parameter
  - Lazy initialization with proper dependency wiring
- **Component Lazy Loading**: All sub-managers initialized on demand
  - workingMemory, sessionManager, episodicMemory, consolidationPipeline
  - salienceEngine, contextWindowManager, memoryFormatter
  - multiAgentManager, conflictResolver
- **Event System**: Unified events for memory operations
  - session:started, session:ended, memory:created, memory:expired
  - consolidation:complete, memory:forgotten, agent:registered, manager:stopped

### Testing

- Added 67 unit tests for type guards and AccessContextBuilder
- Added 44 unit tests for AccessTracker
- Added 15 integration tests for access tracking across managers
- Added 36 unit tests for DecayEngine
- Added 14 unit tests for forgetWeakMemories
- Added 21 unit tests for DecayScheduler
- Added 4 integration tests for DecayEngine context access
- Added 58 unit tests for WorkingMemoryManager (32 Sprint 6 + 26 Sprint 7)
- Added 44 unit tests for SessionManager (39 Sprint 8 + 5 Sprint 10 integration)
- Added 20 unit tests for SessionQueryBuilder
- Added 30 unit tests for EpisodicMemoryManager
- Added 78 unit tests for ConsolidationPipeline (25 Sprint 11 + 12 Sprint 12 + 9 Sprint 13 + 18 Sprint 14 + 14 Sprint 15)
- Added 15 unit tests for RuleEvaluator
- Added 39 unit tests for SalienceEngine (24 Sprint 16 + 10 Sprint 17 + 5 Sprint 20)
- Added 44 unit tests for ContextWindowManager (18 Sprint 18 + 16 Sprint 19 + 10 Sprint 20)
- Added 19 unit tests for MemoryFormatter
- Added 41 unit tests for SummarizationService
- Added 25 unit tests for PatternDetector
- Added 13 unit tests for ConflictResolver
- Added 76 unit tests for MultiAgentMemoryManager (31 Sprint 21 + 19 Sprint 22 + 18 Sprint 23 + 8 Sprint 24)
- Added 23 unit tests for AgentMemoryManager facade

## [1.3.0] - 2026-01-20

### Added

#### Phase 1 Foundation: Sprints 6-10

##### Sprint 6: Query Logging and Tracing
- **QueryLogger Class**: Structured logging for search operations with configurable outputs
  - Console, file, and callback logging destinations
  - Log levels: debug, info, warn, error
  - `MEMORY_QUERY_LOGGING` and `MEMORY_QUERY_LOG_LEVEL` environment variables
  - `MEMORY_QUERY_LOG_FILE` for file-based logging
  - Query trace recording with timing and stage information
- **QueryTrace Interface**: Structured trace data for search operations
  - queryId, queryText, queryType tracking
  - Start/end timestamps with duration calculation
  - Stage-by-stage execution tracing
- **QueryTraceBuilder Class**: Fluent builder for constructing query traces

##### Sprint 7: Search Explanation
- **SearchExplanation Interface**: Detailed breakdown of search result scoring
  - finalScore with scoring signal breakdown
  - matchedTerms with positions and boost factors
  - scoreBoosts for bonus/penalty explanations
- **ScoringSignal Interface**: Individual signal contributions (TF-IDF, BM25, fuzzy, semantic)
- **ExplainedSearchResult Interface**: SearchResult extended with explanation data

##### Sprint 8: Full-Text Search Operators
- **QueryParser Class**: Advanced query syntax parsing
  - Phrase matching with quoted strings (`"exact phrase"`)
  - Wildcard patterns (`test*`, `*ing`, `te?t`)
  - Proximity search (`"word1 word2"~5`)
  - Field-specific queries (`name:value`, `type:Person`)
  - Boolean operators (AND, OR, NOT)
  - `hasAdvancedOperators()` for query classification
- **ProximitySearch Class**: Find entities where terms appear within N words
  - Configurable word distance threshold
  - Position-aware term matching
- **QueryNode Types**: AST representation for parsed queries
  - TermNode, PhraseNode, WildcardNode, ProximityNode, FieldNode, BooleanOpNode

##### Sprint 9: Entity Validation
- **EntityValidator Class**: Configurable validation rules for entities
  - `validate()` async validation with all rules
  - `validateSync()` for synchronous-only rules
  - `validateAll()` for batch entity validation
  - Per-field and cross-field validation support
- **Built-in Validators**: 15+ composable validation functions
  - `required()`, `minLength()`, `maxLength()`, `pattern()`
  - `range()`, `min()`, `max()`, `oneOf()`
  - `minItems()`, `maxItems()` for arrays
  - `email()`, `url()`, `isoDate()` format validators
  - `typeOf()` for type checking
  - `custom()` and `customSync()` for custom logic
  - `asWarning()` to convert errors to warnings
  - `all()` to combine multiple validators
  - `when()` for conditional validation
- **SchemaValidator Class**: JSON Schema validation support
  - Optional ajv integration via dynamic import
  - Schema registration and validation
  - Graceful fallback when ajv not installed

##### Sprint 10: Progress Callbacks and Error Handling
- **Progress Types**: Progress reporting for long-running operations
  - `ProgressInfo` interface with current, total, percentage, message
  - `ProgressCallback` type for progress handlers
  - `ProgressOptions` with phase, estimatedRemainingMs support
  - `createProgressInfo()` helper function
  - `createThrottledProgress()` for rate-limited callbacks
  - `createProgressReporter()` for standardized reporting
- **ErrorCode Enum**: Centralized error codes for programmatic handling
  - Validation: VALIDATION_FAILED, REQUIRED_FIELD_MISSING, INVALID_FIELD_VALUE, SCHEMA_VALIDATION_FAILED
  - Storage: STORAGE_READ_FAILED, STORAGE_WRITE_FAILED, ENTITY_NOT_FOUND, RELATION_NOT_FOUND, DUPLICATE_ENTITY, STORAGE_CORRUPTED, FILE_OPERATION_ERROR
  - Search: SEARCH_FAILED, INVALID_QUERY, INDEX_NOT_READY, EMBEDDING_FAILED
  - Configuration: INVALID_CONFIG, MISSING_DEPENDENCY, UNSUPPORTED_FEATURE
  - Operations: CYCLE_DETECTED, INVALID_IMPORTANCE, INSUFFICIENT_ENTITIES, OPERATION_CANCELLED, IMPORT_ERROR, EXPORT_ERROR
- **Enhanced KnowledgeGraphError**: Base error class with rich context
  - `code` property for programmatic handling
  - `context` property for debugging details
  - `suggestions` array with recovery hints
  - `getDetailedMessage()` for formatted output
  - `toJSON()` for serialization
- **Error Suggestion System**: Context-aware recovery suggestions
  - `generateSuggestions()` function for error-specific hints
  - `getQuickHint()` for single-line recovery hints
  - All error subclasses enhanced with suggestions

### Testing

- All existing 3604 tests continue to pass
- Query logging, parsing, and validation modules integrated with existing infrastructure

## [1.2.2] - 2026-01-18

### Fixed

- **Path Resolution Bug**: Fixed `defaultMemoryPath` and `ensureMemoryFilePath()` to use `process.cwd()` instead of `import.meta.url`
  - Previously, paths were resolved relative to the library's location in `node_modules/`, causing files to be created in wrong location when used as a dependency
  - Now correctly resolves paths relative to the consuming project's current working directory
  - Migration from `memory.json` to `memory.jsonl` now works correctly when library is consumed as npm package
- **Build Fix**: Rebuilt with fix included (v1.2.1 was published without rebuild)

## [1.1.0] - 2026-01-11

### Added

- **Dual Module Format**: Added tsup bundler for ESM and CommonJS output
  - `dist/index.js` - ES Module format
  - `dist/index.cjs` - CommonJS format
  - Proper `exports` field with `import` and `require` conditions
- **Test Reporter**: Added per-file-reporter for detailed test reports
  - JSON reports per test file in `tests/test-results/json/`
  - HTML reports per test file in `tests/test-results/html/`
  - Summary reports with coverage integration in `tests/test-results/summary/`
  - Configurable modes via `VITEST_REPORT_MODE` (all, summary, debug)
- **Build Scripts**:
  - `build` - tsup bundled build (ESM + CJS)
  - `build:watch` - tsup watch mode
  - `build:tsc` - original TypeScript compiler build
- **Worker Files**: Separate worker bundle for dynamic loading by workerpool
- **Tool Management Scripts**:
  - `tools:install` - install dependencies for all standalone tools
  - `tools:build` - build all standalone tool executables

### Changed

- Updated vitest.config.ts with `SKIP_BENCHMARKS` environment variable support
- Updated vitest.config.ts with `json-summary` coverage reporter for per-file-reporter integration
- Updated .gitignore to exclude tool build artifacts (`tools/*/node_modules/`, `tools/*/dist/`, `tools/*/*.exe`)

## [1.0.0] - 2026-01-10

### Added

Initial release - extracted core knowledge graph functionality from memory-mcp.

#### Core Features
- **Entity Management**: Full CRUD operations for entities with observations
- **Relation Management**: Create and manage typed relationships between entities
- **Hierarchical Organization**: Parent-child entity nesting with tree operations
- **Tag Management**: Tag aliasing, bulk operations, and filtering

#### Storage Backends
- **JSONL Storage**: Default file-based storage with in-memory caching
- **SQLite Storage**: Optional database backend with FTS5 full-text search
- **Storage Factory**: Automatic backend selection via configuration

#### Search Capabilities
- **Basic Search**: Name and observation content matching
- **Ranked Search**: TF-IDF relevance scoring
- **Boolean Search**: AND, OR, NOT operators
- **Fuzzy Search**: Levenshtein distance-based typo tolerance
- **BM25 Search**: Probabilistic ranking function
- **Semantic Search**: Vector similarity (requires embedding provider)
- **Hybrid Search**: Multi-signal fusion (semantic + lexical + symbolic)
- **Smart Search**: Reflection-based query refinement

#### Graph Algorithms
- **Shortest Path**: BFS-based pathfinding
- **All Paths**: DFS enumeration up to max depth
- **Centrality**: Degree, betweenness, and PageRank algorithms
- **Connected Components**: Graph connectivity analysis

#### Import/Export
- **Formats**: JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid
- **Compression**: Optional Brotli compression for large exports
- **Streaming**: Memory-efficient export for large graphs (>= 5000 entities)
- **Backup/Restore**: Full graph backup with compression support

#### Utilities
- **Zod Validation**: Schema validation for all inputs
- **Compression**: Brotli compression utilities with base64 support
- **Search Cache**: LRU caching with TTL for search results
- **Indexes**: Name, type, and relation indexes for O(1) lookups
- **Worker Pool**: Parallel processing for CPU-intensive operations

### Architecture

- **ManagerContext**: Central access point with lazy-initialized managers
- **Layered Design**: Protocol → Managers → Storage
- **Barrel Exports**: Clean module organization via index files

### Testing

- 2882 tests across 90 test files
- Unit, integration, and performance benchmarks
- Coverage for edge cases and error handling

---

## Implementation Notes

The original Phase 13 plan specified adapter interfaces (`IStorageAdapter`, `IWorkerAdapter`) for
pluggable storage and worker backends. The actual implementation used a direct code copy approach,
preserving the existing class structure (`GraphStorage`, `SQLiteStorage`, `StorageFactory`) without
introducing adapter abstractions. This simplified the extraction while maintaining full functionality.

Future versions may introduce adapter interfaces to enable Bun/Deno support.

---

## Extracted From

This library was extracted from [@danielsimonjr/memory-mcp](https://github.com/danielsimonjr/memory-mcp) v10.1.0 as Phase 13 of the memory-mcp project evolution.

The extraction separates the core knowledge graph functionality from the MCP server implementation, enabling:
- Standalone use without MCP dependencies
- Cleaner dependency tree
- Independent versioning and releases
