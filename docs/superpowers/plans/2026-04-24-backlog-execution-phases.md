# Backlog Execution Phases — Agent-Driven Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended for parallelizable tasks) or `superpowers:executing-plans` (sequential, with review gates) to implement this plan phase-by-phase. Tasks use checkbox (`- [ ]`) syntax. Each phase ends with a verification gate.

**Goal:** Tackle the verified backlog (`docs/roadmap/ROADMAP.md` § *Backlog Audit (2026-04-24)*) in dependency order, smallest blast-radius first. Each phase has a clear agent dispatch pattern, verification gate, and exit criteria.

**Source list:** Generated from RLM cross-reference of plan docs vs. `src/` symbol presence on 2026-04-24 (current branch `master` at `57cdb13`). See ROADMAP § Backlog Audit for the enumerated catalogue.

**Sequencing principle:** Each phase either (a) closes a release that's already in flight, (b) unblocks a dependency chain for the next phase, or (c) reduces operational risk before higher-cost work. Greek letters (α…η) are used to disambiguate from the numeric Phase 1–6 sequence in ROADMAP.

**Tech stack:** TypeScript 5.7, Vitest 4, better-sqlite3 11. No new runtime dependencies introduced before Phase γ.

---

## Agent Dispatch Reference

Each task below names a default agent type. Use these via the `Agent` tool with the matching `subagent_type`:

| Pattern | Agent | When |
|---|---|---|
| **Architecture design** | `feature-dev:code-architect` or `Plan` | Multi-file feature with non-trivial cross-cutting concerns. Returns blueprint, no code. |
| **Codebase exploration** | `feature-dev:code-explorer` or `Explore` | Trace existing patterns before adding to them. |
| **Implementation (TDD)** | `superpowers:subagent-driven-development` orchestrator | Multiple independent tasks within a phase that can run in parallel. |
| **Single-task implementation** | `general-purpose` | One bounded change, no parallelism needed. |
| **Code review** | `feature-dev:code-reviewer` or `pr-review-toolkit:code-reviewer` | Before each phase verification gate. |
| **Test coverage check** | `test-coverage-analyzer:analyze-coverage` | After implementation, before merge. |
| **Validation** | `superpowers:verification-before-completion` | Mandatory before claiming phase complete. |

**TDD invariant:** Every implementation task follows `superpowers:test-driven-development` — failing test → minimal implementation → green → refactor.

---

## Phase α — Hygiene & v1.11.0 Release Prep

**Why first:** v1.11.0 Memory Engine Core is partially shipped on `master` (commits `2c3a10d`…`1d74a08`). Before adding more features, close the release loop and stop the plan-doc rot. Smallest blast radius, biggest signal-to-noise improvement.

**Estimated effort:** S (1–2 days, 1 agent)
**Dispatch:** Single `general-purpose` agent. No parallelism needed.

### Tasks
- [ ] **α.1** Run `superpowers:verification-before-completion` against the Memory Engine Core spec (`docs/superpowers/specs/2026-04-16-memory-engine-core-design.md`) — confirm every spec'd symbol exists in `src/agent/MemoryEngine.ts` + `src/agent/ImportanceScorer.ts` and the `Entity.contentHash` migration ran.
- [ ] **α.2** Walk `docs/superpowers/plans/2026-04-16-memory-engine-core-plan.md` checkboxes; mark `[x]` for items now confirmed shipped against `src/`. Keep `[ ]` only for genuinely-pending items.
- [ ] **α.3** Walk `docs/superpowers/plans/2026-04-09-supermemory-gap-closing.md` (153 unchecked) — most are shipped per CHANGELOG 1.8.0. Update checkboxes to reflect reality.
- [ ] **α.4** Walk `docs/superpowers/plans/2026-04-10-mempalace-gap-closing.md` (44 unchecked) — most are shipped per CHANGELOG 1.9.0. Update checkboxes.
- [ ] **α.5** Bump `package.json` version `1.10.0` → `1.11.0`; promote `## [Unreleased]` → `## [1.11.0] - <today>` in `CHANGELOG.md`; populate with the Memory Engine Core feature notes from the 5 in-flight commits (`2c3a10d`, `5cb4da0`, `0ff0dc0`, `b10e248`, `1d74a08`).
- [ ] **α.6** Move the v1.12.0 spec entry under a fresh `## [Unreleased]` header.
- [ ] **α.7** Run the `RELEASE` skill (`/RELEASE`) end-to-end: typecheck → tests → tag → publish.

### Verification gate (α)
```
□ git log shows v1.11.0 tag on a commit reachable from origin/master
□ npm view memoryjs version returns 1.11.0
□ Plan-doc checkbox totals dropped from ~476 unchecked to <100
□ CHANGELOG.md [Unreleased] now contains only v1.12.0 entries
□ npm test passes; npm run typecheck clean
```

---

## Phase β — `IMemoryBackend` Foundation (PRD MEM-04)

**Why second:** β unblocks γ (alternate backends), parts of δ (validator can target a specific backend), and is the smallest spec'd-but-unshipped feature. The interface itself is small; the value is in *not* coupling future backends to one storage path.

**Estimated effort:** M (3–5 days, 1–2 agents in parallel)
**Dispatch:** `feature-dev:code-architect` for interface design → `superpowers:subagent-driven-development` for implementation (split InMemoryBackend + SQLiteBackend wiring across two subagents).

### Pre-flight
- [ ] **β.0** `feature-dev:code-explorer` traces current `WorkingMemoryManager` + `EpisodicMemoryManager` storage paths. Output: data-flow doc identifying every place that currently knows about `GraphStorage` or `SQLiteStorage` directly. This locates every wire-up point β must cover.

### Tasks
- [ ] **β.1** Define `IMemoryBackend` interface in `src/agent/IMemoryBackend.ts` per spec `docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md`. Methods: `add`, `get`, `getWeighted`, `delete_session`, `list_sessions`, plus the decay-related read/write hooks. Write the failing test first.
- [ ] **β.2** Implement `InMemoryBackend` adapter wrapping the existing in-memory `Map` path. (Parallel with β.3.)
- [ ] **β.3** Implement `SQLiteBackend` adapter wrapping the existing `SQLiteStorage` path. Reuse — do not duplicate — the FTS5/WAL setup. (Parallel with β.2.)
- [ ] **β.4** Wire `MemoryEngine` constructor to accept an `IMemoryBackend` (default: `InMemoryBackend`). Preserve current default behavior for existing callers.
- [ ] **β.5** Add `DecayEngine.calculatePrdEffectiveImportance()` parallel to existing `calculateEffectiveImportance` per spec.
- [ ] **β.6** Add configurable decay parameter loading (`decay_rate`, `freshness_coefficient`, `relevance_weight`, `min_importance_threshold`) — read from `AgentMemoryConfig`, fall through to existing defaults.
- [x] **β.7** `pr-review-toolkit:code-reviewer` reviews the diff for backwards-compatibility regressions (existing `DecayScheduler` / `SearchManager` / `SemanticForget` semantics preserved).

### Verification gate (β)
```
□ git grep IMemoryBackend src returns >0 hits
□ git grep "InMemoryBackend\|SQLiteBackend" src returns ≥2 file hits each
□ MemoryEngine accepts custom backend without breaking existing constructor calls
□ DecayEngine.calculatePrdEffectiveImportance covered by tests
□ All v1.11.0 tests still green (no regression)
□ pr-review-toolkit:code-reviewer reports zero blockers
```

---

## Phase γ — Backend Expansion (PRD MEM-05, MEM-06)

**Why third:** Now that `IMemoryBackend` exists (β), each new backend is a leaf change. PostgreSQL and Vector are independent and can run in parallel.

**Estimated effort:** L (1–2 weeks per backend, 2 agents in parallel)
**Dispatch:** Two parallel `superpowers:subagent-driven-development` orchestrators, one per backend.

### Pre-flight
- [ ] **γ.0** Decide hosting/dependency strategy: `pg` for PostgreSQL? Which vector store (pgvector? hnswlib? in-process?)? Document in an ADR (`docs/development/ARCHITECTURE_DECISIONS.md`). Bring to user before adding runtime deps.

### Tasks (parallel tracks)

**Track γ.A — PostgreSQLBackend (MEM-05)**
- [ ] γ.A.1 Add optional `pg` peer dependency.
- [ ] γ.A.2 Implement schema migration runner (`SQLiteBackend` pattern, adapted).
- [ ] γ.A.3 Implement `PostgreSQLBackend` against `IMemoryBackend`. Tenant isolation: `session_id` row-level filter + optional schema-per-tenant mode.
- [ ] γ.A.4 Integration tests against a Dockerized Postgres (CI: ephemeral container; local: docker-compose).
- [ ] γ.A.5 Migration guide in `docs/guides/MIGRATION_GUIDE.md`.

**Track γ.B — VectorMemoryBackend (MEM-06)**
- [ ] γ.B.1 Choose vector store (per γ.0 ADR).
- [ ] γ.B.2 Implement `VectorMemoryBackend`: stores turn embeddings; `getWeighted` issues a semantic recall query, falls through to lexical when embeddings unavailable.
- [ ] γ.B.3 Cross-session recall test (write turn in session A, query in session B, assert recall).
- [ ] γ.B.4 Document the cost/latency trade-off in `docs/guides/PERFORMANCE_TUNING.md`.

### Verification gate (γ)
```
□ Each backend has a dedicated integration test file passing in CI
□ Each backend documented in MIGRATION_GUIDE.md and CONFIGURATION.md
□ No backend forced as default (existing users unchanged)
□ ADR committed to docs/development/ARCHITECTURE_DECISIONS.md
```

---

## Phase δ — Memory Intelligence Services (ROADMAP Phase 3B.1–3B.3)

**Why fourth:** This is where memoryjs steps from *Storage* to *Reflection*/*Experience* per Luo et al. Each service has ~50% adjacent infrastructure already (`ContradictionDetector`, `compressForContext`, `PatternDetector`) — δ formalizes those into the spec'd interfaces and fills the missing methods.

**Estimated effort:** L (3–4 weeks total, 3 agents sequentially)
**Dispatch:** Three sequential `superpowers:executing-plans` runs, one per service. Use `feature-dev:code-architect` first for each to design the interface, then dispatch implementation.

### Pre-flight
- [ ] **δ.0** Design review pass: write a single ADR comparing the ROADMAP-spec'd interfaces (3B.1, 3B.2, 3B.3 in ROADMAP) against the existing `ContradictionDetector` / `compressForContext` / `PatternDetector` APIs. Decide: extend-and-rename vs. new-interface-wrapping-old vs. greenfield. Bring to user before coding.

### Tasks

**Track δ.1 — Memory Validator Service (Phase 3B.1)**
*Builds on existing `ContradictionDetector`.*
- [x] δ.1.1 `MemoryValidator` interface per ROADMAP §3B.1: `validateConsistency`, `detectContradictions`, `repairMemory`, `validateTemporalOrder`, `calculateReliability`, plus `ValidationResult` and `Contradiction` types.
- [ ] δ.1.2 Implementation: re-use `ContradictionDetector` for detection, add the three new methods (`repairMemory`, `validateTemporalOrder`, `calculateReliability`).
- [x] δ.1.3 Pre-storage validation hook in `ObservationManager` (gated by config flag).
- [x] δ.1.4 Integration with existing `ConflictResolver`.

**Track δ.2 — Trajectory Compressor Service (Phase 3B.2)**
*Builds on existing `compressForContext`.*
- [x] δ.2.1 `TrajectoryCompressor` interface per ROADMAP §3B.2: `distill`, `abstractAtLevel`, `foldContext`, `findRedundancies`, `mergeRedundant`.
- [ ] δ.2.2 Implementation: wrap `compressForContext` for the `foldContext` case; add the four new methods.
- [ ] δ.2.3 Compression strategies: `semantic_clustering`, `temporal_windowing`, `importance_filtering`, `hierarchical`.
- [ ] δ.2.4 Wire into `ContextWindowManager` as an optional pre-distillation step.

**Track δ.3 — Experience Extractor Service (Phase 3B.3)**
*Builds on existing `PatternDetector`.*
- [x] δ.3.1 `ExperienceExtractor` interface per ROADMAP §3B.3.
- [x] δ.3.2 `extractFromContrastivePairs` over success/failure trajectories.
- [x] δ.3.3 `clusterTrajectories` (semantic | structural | outcome).
- [x] δ.3.4 `synthesizeExperience` returning a transferable `Experience` entity.

### Verification gate (δ)
```
□ Each of MemoryValidator / TrajectoryCompressor / ExperienceExtractor has a dedicated test file
□ Existing ContradictionDetector / compressForContext / PatternDetector callers unchanged
□ At least one end-to-end test demonstrating the new flow (e.g., trajectory → compressed → experience)
□ pr-review-toolkit:code-reviewer reports zero blockers
□ TEST_COVERAGE.md updated
```

---

## Phase ε — Unskip Performance Benchmarks

**Why fifth:** 10 benchmarks marked `it.skip` (`tests/performance/embedding-benchmarks.test.ts`, `tests/performance/foundation-benchmarks.test.ts`). They were skipped *pending code* — that code is now in place. Unskipping closes the perf-regression-detection loop before γ adds two new backends.

**Estimated effort:** S (2–3 days, 1 agent)
**Dispatch:** Single `test-coverage-analyzer:analyze-coverage` agent for inventory + `general-purpose` for unskip + harness adjustments.

### Tasks
- [ ] **ε.1** For each of the 10 `it.skip` blocks, identify the "pending code" the original author was waiting for. Verify it now exists.
- [ ] **ε.2** Replace `it.skip(` with `it(` for the 6 confirmed benchmarks. For any that still depend on missing infrastructure, file a follow-up issue (don't silently re-skip).
- [ ] **ε.3** Establish baseline numbers; record in `tests/performance/baselines.json` (gitignored if too noisy on Windows).
- [ ] **ε.4** Add a `npm run bench` script wrapping `vitest run tests/performance` with `SKIP_BENCHMARKS=false`.
- [ ] **ε.5** Document the noise floor (per CLAUDE.md gotcha: "Performance benchmark flakiness on Windows/Dropbox").

### Verification gate (ε)
```
□ git grep "it.skip" tests/performance returns ≤ 0–4 (only ones with documented reasons)
□ npm run bench runs all unskipped benchmarks under 30s × n
□ Each benchmark has a baseline assertion (not just a wall-clock log)
```

---

## Phase ζ — Plan-Doc Rot Automation (Meta)

**Why sixth:** The 476-vs-10 plan-checkbox-vs-reality drift is the root cause this whole audit had to be done by hand. Without automation, ε will degrade the same way α just fixed.

**Estimated effort:** S (1–2 days, 1 agent)
**Dispatch:** Single `general-purpose` agent. Touches tooling only.

### Tasks
- [ ] **ζ.1** Write `tools/plan-doc-audit/audit.ts` — parses every `docs/superpowers/plans/**/*.md`, extracts each `- [ ]` task description, attempts to find any code symbol mentioned in the line (case-sensitive, word-boundary regex on `class X`, `function X`, `interface X`, `X(`). For matches, suggests checking the box.
- [ ] **ζ.2** Add `npm run audit:plans` script.
- [ ] **ζ.3** Add a Claude Code hook (`.claude/settings.local.json`) that runs `npm run audit:plans` after any commit touching `docs/superpowers/plans/**` or `src/**`. Output goes to `tools/plan-doc-audit/last-run.txt`.
- [ ] **ζ.4** Add a CHANGELOG entry under `## [Unreleased]` documenting the new tool.

### Verification gate (ζ)
```
□ npm run audit:plans produces a diff-style report in <10s
□ Hook fires on test commits
□ Tool respects --dry-run vs --apply modes
□ Documented in tools/plan-doc-audit/README.md
```

---

## Phase η — ROADMAP Phase 4–6 (Long Horizon)

**Why last:** These are major undertakings (database adapters, REST API, Elasticsearch, vector DB, ML, enterprise security, GPU). Most are larger than the entire α–ζ sequence combined and most have no spec yet. Listing here as a forward-looking sketch — each item should get its own dated plan file before execution.

**Estimated effort:** XL (per item — months)
**Dispatch:** Each Phase 4–6 item earns its own `superpowers:writing-plans` invocation when it's promoted to "next up". Do not dispatch as a single batch.

### Backlog (one plan file per item when promoted)

**ROADMAP Phase 4 — Integration & Scale**
- [ ] η.4.1 Database Adapters (beyond MEM-05/06)
- [ ] η.4.2 REST API Generation
- [ ] η.4.3 Elasticsearch Integration
- [ ] η.4.4 Temporal Versioning (extend the v1.9.0 `RelationManager` time-travel to other types)
- [ ] η.4.5 Scalability Improvements
- [ ] η.4.6 Graph Visualization (extend `IOManager.visualizeGraph`)

**ROADMAP Phase 5 — Advanced**
- [ ] η.5.1 Vector Database Integration (beyond γ.B `VectorMemoryBackend`)
- [ ] η.5.2 Graph Embeddings
- [ ] η.5.3 ML-Powered Features
- [ ] η.5.4 Standards Compliance
- [ ] η.5.5 Collaboration Features

**ROADMAP Phase 6 — Enterprise**
- [ ] η.6.1 Access Control
- [ ] η.6.2 Distributed Architecture
- [ ] η.6.3 Security & Compliance
- [ ] η.6.4 Cloud-Native Deployment
- [ ] η.6.5 GPU Acceleration

### `future_features.md` performance/optimization tracks (15 categories — folded into η)
*(Not duplicated as separate phases; each category is either already covered upstream of η or becomes a single-track plan when promoted.)*

---

## Out-of-scope: Clawvault

`docs/roadmap/CLAWVAULT_*.md` describes a separate concept (4-phase plan, 0 code symbols in `src/`). Per `GAP_ANALYSIS_VS_SUPERMEMORY.md`: *"Out of scope for core library; better suited as separate packages or MCP tools."* Per `2026-04-10-mempalace-gap-closing.md`: *"deferred to separate effort — it's an L-effort standalone tool, not a library change."*

**Recommendation:** Spin out as a sibling repo (`memoryjs-clawvault`) when there's pull. Do not embed in core.

---

## Cross-cutting agent rules

1. **TDD always.** Every task that touches `src/` follows `superpowers:test-driven-development`: red → green → refactor.
2. **Verify before claiming done.** Every phase ends with `superpowers:verification-before-completion` against its gate checklist.
3. **No skipped hooks.** `--no-verify` is forbidden unless the user explicitly authorizes it for a specific commit.
4. **One plan file per Phase η item.** When η.4.1 (or any other) is promoted to "next up," `superpowers:writing-plans` produces a fresh dated plan file in `docs/superpowers/plans/`.
5. **Update the audit.** Each completed phase should re-run `npm run audit:plans` (after Phase ζ exists) and post the delta to the user.
6. **Hygiene scheduling.** After Phase α and Phase ζ ship, schedule the next plan-doc audit (`/schedule`) for 30 days out. Recurring monthly cadence keeps drift under control.

---

## Self-review checklist

- [ ] Every phase has an explicit goal and a verification gate
- [ ] Every task is implementable by an agent without further clarification
- [ ] Each phase identifies its dispatch pattern (single agent vs. parallel subagents)
- [ ] Dependencies between phases are explicit
- [ ] Out-of-scope items (Clawvault) are clearly excluded with rationale
- [ ] Long-horizon items (η) are listed but not over-specified
- [ ] No phase touches more than ~10 source files in a single agent invocation

---

*Plan generated 2026-04-24 from RLM cross-reference of `docs/roadmap/` + `docs/superpowers/plans/` against `src/` symbol presence at commit `57cdb13`. Source list: `docs/roadmap/ROADMAP.md` § Backlog Audit (2026-04-24).*
