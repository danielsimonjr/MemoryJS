# Agent-Driven Task Dispatch Runbook

> **Companion to** [`2026-04-24-backlog-execution-phases.md`](./2026-04-24-backlog-execution-phases.md). The phase plan describes *what* and *why*; this file is the *how* — every remaining unchecked task in the backlog as a single dispatchable Agent invocation with prompt template, dependencies, and verification gate.
>
> **Generated:** 2026-04-24 from `master` at commit `996262e`. Re-run RLM cross-reference any time this file feels stale; in particular, after each task is marked DONE, run `npm test && git grep <symbol>` for the next dependent task to confirm its blockers cleared.

---

## How to dispatch

Each task block contains a ready-to-paste `Agent({...})` invocation. Pick the next 🟢 READY task, dispatch it via Claude Code's `Agent` tool, then update the task's **Status** in this file when verification passes.

```ts
Agent({
  description: "Short 3-5 word description",
  subagent_type: "general-purpose",   // or feature-dev:*, superpowers:*, etc.
  prompt: "..."                       // full prompt copied from the task block
})
```

**Cardinal rules** (apply to every task):
1. **TDD** — failing test first, then implementation, then refactor (`superpowers:test-driven-development`).
2. **Verify before claiming done** (`superpowers:verification-before-completion`) — each task block lists its gate.
3. **No `--no-verify`** unless the user explicitly authorizes.
4. **One task = one commit** (or a clean atomic series). Use the `commit-commands:commit` skill or write the commit by hand following CHANGELOG.md style.
5. **Update this file** — flip 🟢 → ✅ and bump the runbook header date when a task completes.

---

## Status legend

| Glyph | Meaning |
|---|---|
| 🟢 READY | No blockers; can dispatch now |
| 🟡 BLOCKED | Waiting on a prior task — see *Blockers* row |
| ⏸️ DEFERRED | Long-horizon (Phase η); needs its own dated plan first |
| 🚧 IN PROGRESS | Currently being worked |
| ✅ DONE | Verified shipped |

---

## Up Next (top 3 ready to dispatch)

Phase β.1 (T11) shipped 2026-04-25 — `IMemoryBackend` interface + parameterized contract suite live. Phase ε mostly complete (T43 baselines.json still pending). Phase ζ T48 hook still pending. Next ready streams:

1. **T12** — Phase β.2: implement `InMemoryBackend` adapter (parallel with T13). Wire `runMemoryBackendContract('InMemoryBackend', () => new InMemoryBackend(...))`.
2. **T13** — Phase β.3: implement `SQLiteBackend` adapter (parallel with T12). Wraps `SQLiteStorage` + `MemoryEngine`.
3. **T48** — Phase ζ.3: Claude Code hook in `.claude/settings.local.json` for `audit:plans`.

T12 + T13 are independent and parallelizable. T48 is independent of either.

---

## Phase summary

| Phase | Tasks | Effort | Status |
|---|---|---|---|
| **v1.11.0 close-out** | T03–T09 | M (1 week) | 🟢 ready |
| **α — release prep** | merged into T09 | — | merged |
| **β — IMemoryBackend** | T10–T17 | M (3–5d) | 🟡 blocked on T09 |
| **γ — Backend expansion** | T18–T27 | L (2 wk × 2 parallel) | 🟡 blocked on T17 |
| **δ — Memory Intelligence** | T28–T40 | L (3–4 wk) | 🟡 blocked on T17 (or earlier if MemoryValidator skips backend dep) |
| **ε — Perf benchmarks** | T41–T45 | S (2–3d) | 🟢 ready (independent) |
| **ζ — Plan-doc audit tool** | T46–T49 | S (1–2d) | 🟢 ready (independent) |
| **η — Long horizon** | T50–T63 | XL (months) | ⏸️ each needs its own dated plan |

---

## Tasks T03–T09 — v1.11.0 close-out

These ship `MemoryEngine` from "skeleton + dedup tiers" to "consumable feature". They block the v1.11.0 release tag.

---

### T03 — Implement `MemoryEngine.addTurn` happy path with events

**Phase:** v1.11.0 Task 9 (`docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md`, line 1274)
**Status:** ✅ DONE (2026-04-24)
**Blockers:** none
**Parallel with:** T41, T46 (different files)
**Agent type:** `general-purpose` (or `superpowers:executing-plans` for the parent plan)
**Files touched:** `src/agent/MemoryEngine.ts`, `tests/unit/agent/MemoryEngine.test.ts`
**Done when:**
- `MemoryEngine.addTurn(content, options)` no longer throws `"Not implemented"`.
- Adds an `AgentEntity` of type `memory_turn`, runs the four-tier dedup chain, fires the `turn_added` / `turn_deduped` event on the engine's emitter.
- Test file covers: happy-path add, dedup hit per tier, importance score persistence, event payload shape.
- `npm test tests/unit/agent/MemoryEngine.test.ts` green; `npm run typecheck` clean.

```ts
Agent({
  description: "Implement MemoryEngine.addTurn",
  subagent_type: "general-purpose",
  prompt: `Implement Task 9 of docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md (line 1274) — \`MemoryEngine.addTurn\` happy path with events.

Required reading first:
- docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md sections "Task 4" through "Task 9" (lines ~483–1495)
- docs/superpowers/specs/2026-04-16-memory-engine-core-design.md (full)
- src/agent/MemoryEngine.ts (current state — addTurn is a stub that throws "Not implemented — Task 9")
- src/agent/ImportanceScorer.ts
- src/agent/EpisodicMemoryManager.ts (the underlying entity creator)
- src/types/types.ts AgentEntity definition

TDD: open tests/unit/agent/MemoryEngine.test.ts (it exists), write failing tests for the four scenarios above (happy add, exact dedup, prefix dedup, jaccard dedup), then implement.

Cardinal rules: TDD strict, no --no-verify, one commit at the end with body matching CHANGELOG.md style. Use the existing event emitter pattern in MemoryEngine (the node:events EventEmitter in the constructor). Do NOT replace the existing checkTier* methods — call them from addTurn.

Done when: \`npm test tests/unit/agent/MemoryEngine.test.ts\` green, \`npm run typecheck\` clean, \`grep "Not implemented — Task 9" src\` returns nothing, plan checkbox at line 1274 flipped to [x].`
})
```

---

### T04 — Implement `getSessionTurns`, `deleteSession`, `listSessions`

**Phase:** v1.11.0 Task 10 (line 1496)
**Status:** ✅ DONE (2026-04-24)
**Parallel with:** none (touches same file as T03)
**Agent type:** `general-purpose`
**Files touched:** `src/agent/MemoryEngine.ts`, `tests/unit/agent/MemoryEngine.test.ts`
**Done when:**
- All three methods no longer throw `"Not implemented"`.
- `getSessionTurns(sessionId, opts)` returns turns from the underlying episodic memory filtered by `sessionId`, with optional `limit` and `role` filters.
- `deleteSession(sessionId)` deletes all turns and returns `{ deleted: count }`.
- `listSessions()` returns unique session IDs from the storage.
- Round-trip test: addTurn × N, listSessions reflects them, deleteSession removes them, getSessionTurns is empty after.

```ts
Agent({
  description: "Implement session turn methods",
  subagent_type: "general-purpose",
  prompt: `Implement Task 10 of docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md (line 1496) — three session methods on MemoryEngine.

Prerequisites: T03 must be DONE (addTurn working). Verify by reading src/agent/MemoryEngine.ts and confirming addTurn does not throw.

Required reading: same as T03, plus the existing session methods in src/agent/EpisodicMemoryManager.ts and src/agent/SessionManager.ts to understand session-id propagation.

TDD: extend tests/unit/agent/MemoryEngine.test.ts with the round-trip test described in the task block. Failing tests first, then minimum implementation, then refactor.

Cardinal rules apply. One commit at the end. Update plan checkbox at line 1496 to [x].`
})
```

---

### T05 — Wire `MemoryEngine` into `ManagerContext`

**Phase:** v1.11.0 Task 11 (line 1691)
**Status:** ✅ DONE (2026-04-24)
**Agent type:** `general-purpose`
**Files touched:** `src/core/ManagerContext.ts`, `src/index.ts` (barrel export), `tests/unit/core/ManagerContext.test.ts`
**Done when:**
- `git grep MemoryEngine src/core/ManagerContext.ts` returns ≥ 1 hit.
- `ctx.memoryEngine` accessor exists, lazy-initialized like the existing agent managers.
- Constructor signature unchanged for backwards compatibility.
- Test asserts `ctx.memoryEngine` is the same instance on repeat access (lazy memoization).
- CLAUDE.md `ManagerContext` lazy-managers section updated to list `memoryEngine`.

```ts
Agent({
  description: "Wire MemoryEngine into ManagerContext",
  subagent_type: "general-purpose",
  prompt: `Implement Task 11 of docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md (line 1691) — expose MemoryEngine via ManagerContext.

Prerequisites: T03, T04 must be DONE. Verify with: grep -n "Not implemented" src/agent/MemoryEngine.ts → should be empty.

Required reading: src/core/ManagerContext.ts (whole file — note the lazy-init pattern for agent managers like semanticSearch, agentMemory()), CLAUDE.md "ManagerContext" section.

Pattern to match: how semanticSearch is exposed (lazy getter pattern with backing private field). Follow the same.

Update CLAUDE.md ManagerContext block to include the new accessor under "Lazy agent managers".

Cardinal rules apply. One commit. Update plan checkbox at line 1691 to [x].`
})
```

---

### T06 — Integration tests: JSONL + SQLite roundtrip + migration

**Phase:** v1.11.0 Task 12 (line 1849)
**Status:** ✅ DONE (2026-04-24) — JSONL + SQLite both passing. T06 follow-on (T06b) shipped the SQLite-side AgentEntity round-trip via a new `agentMetadata` JSON-blob column with idempotent migration. All 7 integration tests in the file pass; 5551/5551 unit + integration green.
**Agent type:** `general-purpose`
**Files touched:** new file `tests/integration/MemoryEngine.integration.test.ts`
**Done when:**
- One test runs the full happy path against `MEMORY_STORAGE_TYPE=jsonl`, another against `sqlite`.
- Migration test: open an old SQLite DB without the `contentHash` column, run `MemoryEngine`, verify column was added by migration code.
- Cleanup uses `tmp` dirs, not the real `memory.db` / `memory.jsonl`.

```ts
Agent({
  description: "Memory Engine integration tests",
  subagent_type: "general-purpose",
  prompt: `Implement Task 12 of docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md (line 1849) — integration tests covering both storage backends and the SQLite migration path.

Prerequisites: T03–T05 DONE. Verify ctx.memoryEngine works in REPL.

Required reading: tests/integration/* (existing integration test patterns, especially how MEMORY_STORAGE_TYPE is toggled in tests), src/core/StorageFactory.ts.

Use temp dirs (Node \`os.tmpdir()\` + cleanup in \`afterEach\`). Do NOT touch repo-root memory.db or memory.jsonl.

Cardinal rules apply. One commit. Update plan checkbox at line 1849.`
})
```

---

### T07 — Performance smoke test

**Phase:** v1.11.0 Task 13 (line 1952)
**Status:** ✅ DONE (2026-04-24)
**Agent type:** `general-purpose`
**Files touched:** new `benchmarks/memory-engine-bench.ts`, possibly `package.json` scripts
**Done when:**
- Bench file exists; runs ≥ 1000 `addTurn` calls with each of the four dedup tiers exercised.
- Reports p50/p95 latency to stdout.
- Honors `SKIP_BENCHMARKS=true` per CLAUDE.md gotcha.
- Numbers committed to a baseline file under `benchmarks/baselines/` (or noted in CHANGELOG entry for T09).

```ts
Agent({
  description: "Memory Engine perf smoke",
  subagent_type: "general-purpose",
  prompt: `Implement Task 13 of docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md (line 1952) — performance smoke test.

Prerequisites: T06 DONE.

Pattern to match: benchmarks/summarization-bench.ts (added in v1.10.0 — concurrent group calls).

Cardinal rules apply. Document the baseline numbers in the commit body. Update plan checkbox at line 1952.`
})
```

---

### T08 — Update `CLAUDE.md` with new env vars + architecture notes

**Phase:** v1.11.0 Task 14 (line 2032)
**Status:** ✅ DONE (2026-04-24)
**Agent type:** `general-purpose`
**Files touched:** `CLAUDE.md`
**Done when:**
- `## Architecture > Module Organization > src/agent/` block lists `MemoryEngine` and `ImportanceScorer`.
- Any new env vars added during T03–T07 are documented under `## Environment Variables`.
- `## Common Commands` section adds the new bench script if T07 added one.

```ts
Agent({
  description: "Update CLAUDE.md for v1.11.0",
  subagent_type: "general-purpose",
  prompt: `Implement Task 14 of docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md (line 2032) — refresh CLAUDE.md.

Prerequisites: T03–T07 DONE.

Read the current CLAUDE.md and the diffs from T03–T07 commits (\`git log --since="3 days ago" -p\`). Update only the sections that need new content. Do NOT restructure CLAUDE.md.

Cardinal rules apply. Update plan checkbox at line 2032.`
})
```

---

### T09 — Version bump + CHANGELOG finalization (= ship v1.11.0)

**Phase:** v1.11.0 Task 15 (line 2087) + execution-plan α.5/α.6/α.7
**Status:** ✅ DONE (2026-04-24)
**Agent type:** `general-purpose`
**Files touched:** `package.json`, `CHANGELOG.md`, git tag
**Done when:**
- `package.json` version → `1.11.0`.
- `## [Unreleased]` heading replaced with `## [1.11.0] - 2026-MM-DD`; entries reflect every commit from T03–T08.
- v1.12.0 spec entries moved under a fresh `## [Unreleased]` section.
- `git tag v1.11.0` created and pushed.
- `npm view memoryjs version` (after publish) returns `1.11.0`. *(Skip publish if Daniel hasn't authorized; just stop at the tag.)*

```ts
Agent({
  description: "Ship v1.11.0",
  subagent_type: "general-purpose",
  prompt: `Implement Task 15 of docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md AND execution-plan tasks α.5/α.6/α.7.

Prerequisites: T03–T08 DONE. \`npm test\` green, \`npm run typecheck\` clean, \`npm run build\` succeeds.

Steps:
1. Bump package.json version 1.10.0 → 1.11.0.
2. In CHANGELOG.md, change "## [Unreleased]" header to "## [1.11.0] - <today's date YYYY-MM-DD>". Populate entries from \`git log v1.10.0..HEAD --oneline\` filtered to MemoryEngine commits. Match the style of [1.10.0] above.
3. Above [1.11.0], insert a new empty "## [Unreleased]" with the v1.12.0 design-spec entries that were under the previous Unreleased.
4. Commit "release: v1.11.0".
5. Tag: git tag v1.11.0.
6. Run the RELEASE skill end-to-end OR stop here and tell the user "publish gated on your /release approval".

Cardinal rules apply. Update plan checkbox at line 2087.`
})
```

---

## Tasks T10–T17 — Phase β: `IMemoryBackend` Foundation

Unblocks γ, δ. Smallest spec'd-but-unshipped feature.

| ID | Task | Status | Blockers | Parallel with |
|---|---|---|---|---|
| T10 | β.0: code-explorer trace storage paths | ✅ | — | done 2026-04-25 |
| T11 | β.1: define `IMemoryBackend` interface (TDD) | ✅ | — | done 2026-04-25 |
| T12 | β.2: implement `InMemoryBackend` | 🟡 | T11 | T13 |
| T13 | β.3: implement `SQLiteBackend` | 🟡 | T11 | T12 |
| T14 | β.4: wire `MemoryEngine` to backend (default In-Memory) | 🟡 | T12, T13 | — |
| T15 | β.5: `DecayEngine.calculatePrdEffectiveImportance` | 🟡 | T11 | T16 |
| T16 | β.6: configurable decay params (`AgentMemoryConfig`) | 🟡 | T11 | T15 |
| T17 | β.7: code review pass | 🟡 | T14, T15, T16 | — |

### T10 — Phase β.0: trace storage wire-up points

**Agent type:** `feature-dev:code-explorer` or `Explore` (read-only).
**Done when:** Markdown report listing every place that imports `GraphStorage` / `SQLiteStorage` / `WorkingMemoryManager` / `EpisodicMemoryManager`, with file:line. Saved to `docs/superpowers/specs/2026-04-24-storage-wireup-trace.md`. No code changes.

```ts
Agent({
  description: "Trace storage wire-up points",
  subagent_type: "feature-dev:code-explorer",
  prompt: `Read-only investigation. Goal: produce a complete map of every place IMemoryBackend will need to plug into.

Search src/ for every import or direct reference to:
- GraphStorage
- SQLiteStorage
- WorkingMemoryManager (its private store field)
- EpisodicMemoryManager (its private store field)

For each hit, record file path, line number, and a one-line summary of how the type is used (constructor injection? direct property access? composition?).

Output: write findings to docs/superpowers/specs/2026-04-24-storage-wireup-trace.md as a markdown table. Do NOT modify any other file.

Done when: that file exists and lists ≥ 10 wire-up points.`
})
```

### T11 — Phase β.1: define `IMemoryBackend` interface

**Agent type:** `general-purpose` (TDD, single file).
**Done when:** `src/agent/IMemoryBackend.ts` exists with the spec'd interface; `tests/unit/agent/IMemoryBackend.contract.test.ts` defines a contract test suite that any backend must pass; `npm run typecheck` green.

```ts
Agent({
  description: "Define IMemoryBackend interface",
  subagent_type: "general-purpose",
  prompt: `Implement task β.1 of docs/superpowers/plans/2026-04-24-backlog-execution-phases.md.

Required reading:
- docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md (the IMemoryBackend section)
- docs/superpowers/specs/2026-04-24-storage-wireup-trace.md (from T10)

TDD: write the contract test first (a parameterized suite that takes a backend constructor and exercises add/get/getWeighted/deleteSession/listSessions plus the decay hooks). Then write the interface so the test compiles.

DO NOT implement any backend yet — that's T12/T13.

Cardinal rules. One commit. Plan checkbox β.1 → [x].`
})
```

### T12 — Phase β.2: `InMemoryBackend` (parallel with T13)

```ts
Agent({
  description: "Implement InMemoryBackend",
  subagent_type: "general-purpose",
  prompt: `Implement task β.2 — InMemoryBackend adapter.

Prereq: T11 DONE.

The contract test from T11 should be parameterized; instantiate it with InMemoryBackend.

Reuse the existing in-memory Map path from WorkingMemoryManager (do not duplicate; refactor into the new file or compose).

Cardinal rules. One commit. Plan checkbox β.2 → [x].`
})
```

### T13 — Phase β.3: `SQLiteBackend` (parallel with T12)

```ts
Agent({
  description: "Implement SQLiteBackend",
  subagent_type: "general-purpose",
  prompt: `Implement task β.3 — SQLiteBackend adapter.

Prereq: T11 DONE.

Wrap (do NOT duplicate) the existing SQLiteStorage path. Reuse the FTS5/WAL setup. Confirm the contract test from T11 passes when parameterized with this backend.

Cardinal rules. One commit. Plan checkbox β.3 → [x].`
})
```

### T14 — Phase β.4: wire `MemoryEngine` to accept `IMemoryBackend`

```ts
Agent({
  description: "Wire MemoryEngine to IMemoryBackend",
  subagent_type: "general-purpose",
  prompt: `Implement task β.4. Make MemoryEngine constructor accept an IMemoryBackend, default InMemoryBackend.

Prereq: T12 AND T13 DONE.

Backwards compatibility: existing callers of \`new MemoryEngine(...)\` must continue to work without changes. Add a new optional parameter at the end of the constructor signature OR an options-object overload.

Run all existing MemoryEngine tests to confirm zero regression.

Cardinal rules. One commit. Plan checkbox β.4 → [x].`
})
```

### T15 — Phase β.5: `DecayEngine.calculatePrdEffectiveImportance`

```ts
Agent({
  description: "Add PRD effective-importance method",
  subagent_type: "general-purpose",
  prompt: `Implement task β.5. Add \`DecayEngine.calculatePrdEffectiveImportance(entity, now)\` per docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md.

Prereq: T11 DONE (interface defined).

PRESERVE the existing calculateEffectiveImportance for current callers (DecayScheduler, SearchManager, SemanticForget). Add the new method side-by-side; do not replace.

TDD: failing tests first covering the spec's PRD importance range [1.0, 3.0] mapping.

Cardinal rules. One commit. Plan checkbox β.5 → [x].`
})
```

### T16 — Phase β.6: configurable decay params

```ts
Agent({
  description: "Configurable decay params",
  subagent_type: "general-purpose",
  prompt: `Implement task β.6. Make decay_rate, freshness_coefficient, relevance_weight, min_importance_threshold readable from AgentMemoryConfig with sensible defaults preserved.

Prereq: T11 DONE.

Read existing AgentMemoryConfig pattern in src/agent/AgentMemoryConfig.ts. Match its env-var → config-field convention. Document new env vars in CLAUDE.md.

Cardinal rules. One commit. Plan checkbox β.6 → [x].`
})
```

### T17 — Phase β.7: review pass

```ts
Agent({
  description: "Review β phase diff",
  subagent_type: "pr-review-toolkit:code-reviewer",
  prompt: `Review the cumulative diff from T11–T16 (range \`v1.11.0..HEAD\`).

Scope: backwards-compatibility regressions in DecayScheduler / SearchManager / SemanticForget; interface coherence (IMemoryBackend contract); test coverage on new code paths.

Output: structured review per pr-review-toolkit:code-reviewer conventions. Block on real issues; OK with style suggestions noted.

If clean → flip plan checkbox β.7 → [x] and post summary.`
})
```

---

## Tasks T18–T27 — Phase γ: Backend Expansion (MEM-05 + MEM-06)

| ID | Task | Status | Blockers | Track |
|---|---|---|---|---|
| T18 | γ.0: ADR for Postgres + Vector deps | 🟡 | T17 | shared |
| T19 | γ.A.1: add `pg` peer dep | 🟡 | T18 | A |
| T20 | γ.A.2: schema migration runner | 🟡 | T19 | A |
| T21 | γ.A.3: `PostgreSQLBackend` impl | 🟡 | T20 | A |
| T22 | γ.A.4: dockerized integration tests | 🟡 | T21 | A |
| T23 | γ.A.5: migration guide | 🟡 | T22 | A |
| T24 | γ.B.1: choose vector store (per ADR) | 🟡 | T18 | B |
| T25 | γ.B.2: `VectorMemoryBackend` impl | 🟡 | T24 | B |
| T26 | γ.B.3: cross-session recall test | 🟡 | T25 | B |
| T27 | γ.B.4: perf-tuning doc | 🟡 | T26 | B |

Track A and Track B are independent after T18 — dispatch in parallel.

```ts
// T18 example
Agent({
  description: "γ.0 hosting/deps ADR",
  subagent_type: "feature-dev:code-architect",
  prompt: `Write an ADR for docs/development/ARCHITECTURE_DECISIONS.md covering:
1. PostgreSQL adapter library choice (pg vs postgres.js vs Drizzle).
2. Vector store choice (pgvector embedded vs hnswlib vs in-process FAISS port vs none — punt to user).
3. Default vs opt-in behavior per backend.
4. Tenant isolation strategy (row-level vs schema-per-tenant).

Stop and ASK THE USER before adding any runtime dep. Output ADR draft only; do not modify package.json.

Plan checkbox γ.0 → [x] when ADR draft is committed.`
})
```

*(Tasks T19–T27 follow the same pattern; copy from the phase plan and parameterize. Each task block in execution-plan §γ already contains enough detail for the agent prompt — the runbook deliberately doesn't duplicate them once the pattern is established.)*

---

## Tasks T28–T40 — Phase δ: Memory Intelligence Services

| ID | Track | Task | Blockers |
|---|---|---|---|
| T28 | δ.0 | design ADR comparing existing detectors to ROADMAP §3B interfaces | T17 (or T11 if proceeding without backends) |
| T29 | δ.1.1 | `MemoryValidator` interface | T28 |
| T30 | δ.1.2 | impl using existing `ContradictionDetector` | T29 |
| T31 | δ.1.3 | pre-storage validation hook in `ObservationManager` | T30 |
| T32 | δ.1.4 | integration with `ConflictResolver` | T31 |
| T33 | δ.2.1 | `TrajectoryCompressor` interface | T28 |
| T34 | δ.2.2 | impl wrapping `compressForContext` | T33 |
| T35 | δ.2.3 | strategies (semantic_clustering / temporal_windowing / importance_filtering / hierarchical) | T34 |
| T36 | δ.2.4 | wire into `ContextWindowManager` | T35 |
| T37 | δ.3.1 | `ExperienceExtractor` interface | T28 |
| T38 | δ.3.2 | `extractFromContrastivePairs` | T37 |
| T39 | δ.3.3 | `clusterTrajectories` | T38 |
| T40 | δ.3.4 | `synthesizeExperience` | T39 |

T29 / T33 / T37 can run in parallel after T28. Within each track the order is sequential.

```ts
// Example T29 prompt
Agent({
  description: "MemoryValidator interface",
  subagent_type: "general-purpose",
  prompt: `Implement task δ.1.1 of docs/superpowers/plans/2026-04-24-backlog-execution-phases.md — MemoryValidator interface per ROADMAP §3B.1.

Prereq: T28 ADR DONE.

Required reading: docs/roadmap/ROADMAP.md §3B.1, src/agent/ContradictionDetector.ts (the existing infrastructure to extend).

Define interface only in this task; impl is T30. Contract test like T11 pattern.

Cardinal rules. One commit. Plan checkbox δ.1.1 → [x].`
})
```

---

## Tasks T41–T45 — Phase ε: Unskip Performance Benchmarks

🟢 **All independent of v1.11.0 chain. Can dispatch immediately in parallel with T03 / T46.**

| ID | Task | File |
|---|---|---|
| T41 | inventory the 10 `it.skip` blocks; categorize ready vs still-blocked | both perf test files | ✅ done 2026-04-25 |
| T42 | unskip the ready ones; for blockers, file follow-up issues | both perf test files | ✅ done 2026-04-25 (10/10 unskipped, 48/48 green) |
| T43 | establish baselines (`tests/performance/baselines.json`) | new file | 🟡 pending — recommend per-platform rows |
| T44 | add `npm run bench` script | `package.json` | ✅ done 2026-04-25 |
| T45 | document Windows/Dropbox noise floor in CLAUDE.md | CLAUDE.md | ✅ done 2026-04-25 |

```ts
// T41 prompt
Agent({
  description: "Inventory skipped perf tests",
  subagent_type: "test-coverage-analyzer:analyze-coverage",
  prompt: `Read-only inventory. For each of the 10 \`it.skip(\` blocks in tests/performance/embedding-benchmarks.test.ts and tests/performance/foundation-benchmarks.test.ts, determine:
1. The exact "pending code" the original SKIPPED reason references (look at the skip comment).
2. Whether that code now exists in src/.
3. Whether the test would plausibly pass today.

Output: docs/superpowers/specs/2026-04-24-skip-inventory.md as a table with columns [test path, line, reason for skip, current status, recommended action].

Do not modify the test files themselves — that's T42.

Plan checkbox ε.1 → [x] when the inventory file exists.`
})
```

---

## Tasks T46–T49 — Phase ζ: Plan-Doc Audit Tool

🟢 **All independent of every other chain.** Tooling task — once shipped, prevents future regressions.

| ID | Task |
|---|---|
| T46 | `tools/plan-doc-audit/audit.ts` — symbol-presence checker that suggests `[x]` flips | ✅ done 2026-04-25 |
| T47 | `npm run audit:plans` script | ✅ done 2026-04-25 |
| T48 | Claude Code hook in `.claude/settings.local.json` | 🟡 pending |
| T49 | `tools/plan-doc-audit/README.md` | ✅ done 2026-04-25 |

```ts
// T46 prompt
Agent({
  description: "Build plan-doc audit tool",
  subagent_type: "general-purpose",
  prompt: `Implement Phase ζ task ζ.1 of docs/superpowers/plans/2026-04-24-backlog-execution-phases.md.

Build tools/plan-doc-audit/audit.ts:
- Walks docs/superpowers/plans/**/*.md and docs/roadmap/**/*.md.
- For each \`- [ ]\` line, extracts code symbols (regex: capitalized identifiers, methods like \`X.y(\`, file paths).
- For each symbol, runs \`git grep\` against src/. CRITICAL: read the surrounding code body too — a stub that throws "Not implemented" must NOT count as shipped (this lesson came from the 2026-04-24 reconciliation).
- Outputs a diff-style report: which checkboxes look ready to flip, which look pending.

Modes: --dry-run (default, just report) and --apply (rewrite the plan files).

CLI entry: tools/plan-doc-audit/index.ts. Build via tsup (existing tools/* convention).

TDD: tests/unit/tools/plan-doc-audit.test.ts with synthetic plan + src fixtures.

Cardinal rules. One commit. Plan checkbox ζ.1 → [x].`
})
```

*(T47–T49 follow standard "tooling polish" pattern; agent can write them in one combined dispatch if T46 is solid.)*

---

## Tasks T50–T63 — Phase η: Long Horizon

⏸️ **Each item below earns its own dated plan file when promoted to "next up" via the `superpowers:writing-plans` skill.** Do NOT dispatch from this runbook directly.

| ID | Item | Source |
|---|---|---|
| T50 | η.4.1 Database Adapters | ROADMAP Phase 4.1 |
| T51 | η.4.2 REST API Generation | ROADMAP Phase 4.2 |
| T52 | η.4.3 Elasticsearch Integration | ROADMAP Phase 4.3 |
| T53 | η.4.4 Temporal Versioning expansion | ROADMAP Phase 4.4 |
| T54 | η.4.5 Scalability Improvements | ROADMAP Phase 4.5 |
| T55 | η.4.6 Graph Visualization expansion | ROADMAP Phase 4.6 |
| T56 | η.5.1 Vector Database Integration | ROADMAP Phase 5.1 |
| T57 | η.5.2 Graph Embeddings | ROADMAP Phase 5.2 |
| T58 | η.5.3 ML-Powered Features | ROADMAP Phase 5.3 |
| T59 | η.5.4 Standards Compliance | ROADMAP Phase 5.4 |
| T60 | η.5.5 Collaboration Features | ROADMAP Phase 5.5 |
| T61 | η.6.x Enterprise (RBAC / Distributed / Security / Cloud / GPU) | ROADMAP Phase 6 |
| T62 | 3B.4–3B.7 (Procedural / Active Retrieval / Causal / World Model) | ROADMAP Phase 3B |
| T63 | future_features.md categories not subsumed by η.4–η.6 | future_features.md |

**Promotion ritual** (when the user says "let's tackle T5x"):
1. Dispatch `superpowers:writing-plans` skill with the source spec excerpt.
2. New plan file lands in `docs/superpowers/plans/<date>-<slug>.md`.
3. Add new T## entries to this runbook for that plan's tasks.
4. Flip the η entry from ⏸️ → 🚧 with a pointer to the new plan.

---

## Out of scope (do not dispatch)

| Item | Why |
|---|---|
| Clawvault | Separate sibling repo per `GAP_ANALYSIS_VS_SUPERMEMORY.md` and `mempalace-gap-closing.md` self-review. Spin out as `memoryjs-clawvault` if/when there's pull. |

---

## Self-review checklist for this runbook

- [x] Every remaining unchecked task in the backlog has a T## entry OR is explicitly listed under η/out-of-scope
- [x] Each task has agent type, prompt template, blockers, done-criteria
- [x] Parallelism is explicit
- [x] Long-horizon items aren't over-specified
- [x] Top 3 ready-to-dispatch surfaced at the top
- [x] Status legend keeps the diff small (one glyph + glanceable table)

---

*Runbook generated 2026-04-24 from `master` at `996262e`. Re-run a fresh RLM cross-reference before dispatching if more than ~7 days have passed since this header date — plan-doc rot accumulates fast and Phase ζ tooling isn't shipped yet.*
