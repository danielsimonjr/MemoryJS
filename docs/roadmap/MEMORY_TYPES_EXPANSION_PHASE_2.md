# Memory Types Expansion — Phase 2 Planning

**Draft**: 2026-05-13 · **Status**: Proposal for review · **Companion to**: [`MEMORY_TYPES_EXPANSION.md`](./MEMORY_TYPES_EXPANSION.md)

This document applies the **Agentic Memory Library — Type Catalog & Design Reference** (the catalog henceforth) to MemoryJS's current shipped state to identify the next round of memory-type expansions. The catalog proposes 13 memory types organized around a 4-axis design space; this doc maps each type to MemoryJS's existing surface, identifies the genuine gaps, and ranks them by leverage.

Phase 1 (covered by [`MEMORY_TYPES_EXPANSION.md`](./MEMORY_TYPES_EXPANSION.md)) shipped the **prospective memory** addition (Sprint 1a/1b + Sprint 2 + Sprint 3 across commits `1efd905` → `69ec59d`). That closed the canonical Tulving-aligned taxonomy. This Phase 2 doc proposes the next gaps to close, derived from the catalog's design framework.

---

## 1. The catalog's 4-axis design space

Every memory record is a point in:

1. **Persistence** — `turn` / `session` / `project` / `global`
2. **Content type** — `episodic` / `semantic` / `procedural` / `declarative` / `reflective`
3. **Source** — `user-authored` / `tool-derived` / `agent-inferred` / `imported`
4. **Retrieval pattern** — `always-on` / `keyed` / `semantic-search` / `temporal-scan` / `conditional`

MemoryJS already has primitives for axes 1 (sessions / projects / global via visibility), 2 (`MemoryType` union), 3 (`Entity.source.method`), and 4 (`SearchManager` strategies). The axes themselves aren't the gap — the catalog's value is in identifying **which combinations** deserve a typed, schema'd, policy-bound memory type with its own facade.

---

## 2. Per-type cross-reference — all 13 catalog types vs. MemoryJS

| # | Catalog Type | Persistence × Content × Source × Retrieval | MemoryJS shipped state | Gap |
|---|------|-------------------------------------------|-----------------------|-----|
| 1 | **Identity Memory** | global · declarative · user · always-on | ✅ `ProfileManager` static facts, surfaced in `wakeUp` L0 | None |
| 2 | **Project Context** | project · semantic · user+tool · always-on | ⚠️ `Entity.projectId` + `MEMORY_DEFAULT_PROJECT_ID` for scoping. Structured `facts[]` / `conventions[]` / `commands[]` / `glossary[]` schema is missing | Schema for project-context entity |
| 3 | **User Profile** | global · semantic · user+agent · always-on | ✅ `ProfileManager` (dynamic facts) + Supermemory gap-closing PR | None |
| 4 | **Episodic Log** | session→project · episodic · tool+agent · temporal+semantic | ✅ `EpisodicMemoryManager`, `SessionManager`, `AuditLog`, consolidation pipeline | None |
| 5 | **Skill Library** | global+project · procedural · user-curated · conditional | ✅ Procedural memory (3B.4) — `ProcedureManager` + `ProcedureStore` + `StepSequencer`. Note: catalog explicitly says "this already exists in Claude Code — library should integrate not replicate" | None |
| 6 | **Plan / Goal Stack** | session · declarative+episodic · user+agent · always-on | ❌ **Not shipped.** Prospective memory just shipped (intentions-to-act) but that's distinct — a plan is a forward-looking goal *tree* with sub-tasks + acceptance criteria | **Major gap** |
| 7 | **Working Scratchpad** | turn→session · mixed · agent · always-on | ✅ `WorkingMemoryManager` (TTL-bounded short-term + session-scoped) | None |
| 8 | **Tool Affordance Memory** | session→project · semantic+reflective · tool+agent · conditional | ❌ **Not shipped.** No `ToolStatsManager`, no tool-success-rate tracking, no failure-mode log per tool | **Major gap** |
| 9 | **Failure Memory** | project · episodic+reflective · agent+tool · semantic-search | ⚠️ `FailureDistillation` (v1.7.0) extracts lessons from failed sessions, but no structured `FailureRecord` with `applicability_hint` for **pre-task lookup**. Catalog calls failure memory "the single biggest concrete win available to most agentic systems" | **High-value enhancement** |
| 10 | **Reflection Log** | project+global · reflective · agent · semantic+re-injection | ⚠️ `PatternDetector`, `TrajectoryCompressor`, `ExperienceExtractor` cover components. No explicit `ReflectionRecord` schema with `scope` / `evidence` / `generalization_confidence` and no **scheduled reflection pass** that produces them | Schema + scheduled pass |
| 11 | **Decision Rationale** | project · semantic+episodic · agent+user · keyed+semantic | ❌ **Not shipped at runtime.** ADRs live in `docs/development/ARCHITECTURE_DECISIONS.md` as a static file. No runtime memory type for agents to query past decisions | **Major gap** |
| 12 | **Provenance Memory (mixin)** | meta — every record | ⚠️ Has `Entity.source: MemorySource` (η.5.5.d), `confidence`, `ttl`, `AuditLog`, `CollaborationAuditEnforcer`. Missing: `trust_level: 'ground-truth' \| 'verified' \| 'inferred' \| 'unverified'` discriminated union as a typed mixin | Trust-level formalization |
| 13 | **Cache** | session/project · opaque · tool · keyed · TTL-bounded | ✅ `CompressedCache`, `SearchCache`, `EmbeddingCache`, `CachePressureCoordinator`, `CompressedMap` | None |

**Summary**: 6 of 13 fully shipped, 4 partial / enhancement candidates, 3 not shipped.

---

## 3. Operational policies — gap check

The catalog explicitly says the policies are the actual system; types are scaffolding. Cross-reference:

| Policy area | Shipped | Gap |
|-------------|---------|-----|
| **Write policy** | `GovernanceManager` + `AuditLog` + per-type managers | Catalog's per-type **decision matrix** (auto / curated / explicit-only) isn't formalized as a single policy surface |
| **Trust hierarchy** | `Entity.source` + `confidence`. Conflict resolution via `CollaborativeSynthesis.resolveConflicts` | Catalog's explicit `user > tool-verified > agent-inferred-high > imported > agent-inferred-low` ordering isn't encoded; **`trust_level` field is missing** |
| **Consolidation pipeline** | `ConsolidationPipeline` + `ConsolidationScheduler` + `ProspectivePromotionStage` (just shipped) | Catalog's specific pipeline `scratchpad → episodic → reflection → (selective) project context` — the reflection arrow isn't wired |
| **Decay & pruning** | `DecayEngine` + `forgetWeakMemories` + Phase 11 mmap for cold storage | Catalog's per-type retention policies (e.g. "Failure: never auto-delete; mark resolved if root cause fixed") aren't encoded; **decay policy is uniform across types** |
| **Retrieval budget** | `ContextWindowManager` token budgets, `wakeUp` L0/L1.5/L1 layering | Catalog's per-class budget guideline (~2k identity+context, ~500 plan, ~1k pre-task failure search) isn't a typed config; tuning is global |
| **Privacy** | `PiiRedactor` (η.6.3) | Catalog's **`do_not_remember` list** is missing — no hard-delete + write-block mechanism keyed on user-supplied patterns |

**Summary**: All five policy areas have shipped components but lack the **per-type formalization** the catalog argues is the core design discipline.

---

## 4. Ranked expansion candidates

Ordered by the catalog's MVP sequence + leverage:

### Priority 1 — Plan / Goal Stack (Type 6) — **new memory type**

**Why it's P1**: Catalog's MVP step 1 lists it alongside Identity + Project Context + Provenance as the *foundational* set. MemoryJS has the rest of that set; Plan is the lone gap. Without it, agents have intentions (prospective) and history (episodic) but no **active goal decomposition** — the structural backbone for multi-turn work.

**Distinct from prospective memory**: prospective is "I will do X when condition Y holds." A plan is "the current goal G decomposes into sub-goals G1/G2/G3; G2 is active; here are the acceptance criteria."

**Effort**: medium — ~10 days, mirrors the prospective-memory sprint shape:
- New `MemoryType: 'plan'`
- `PlanEntity` extending `AgentEntity` with `rootGoal`, `stack: GoalNode[]`, `currentNodeId`, recursive children, `history: GoalEvent[]`
- New `PlanManager` with `createPlan`, `pushSubGoal`, `completeNode`, `blockNode`, `getCurrentPath`, `acceptCriteriaMet`
- Integration: `ctx.plan` lazy getter, wakeUp injection of current plan stack (top-N tokens in a new L0.5 layer or extension to L0)
- 25–30 tests

### Priority 1 — Failure Memory hardening (Type 9 enhancement) — **highest single-feature ROI**

**Why it's P1**: The catalog explicitly calls this "the single biggest concrete win available to most agentic systems." MemoryJS has `FailureDistillation` extracting lessons but no structured `FailureRecord` for pre-task lookup. The catalog's design pinpoints the missing piece: an `applicability_hint` field that lets a semantic search before a task surface "we tried this before, it failed because X, alternative Y worked."

**Effort**: small — ~5 days:
- New `FailureRecord` interface with `failure_mode`, `root_cause`, `alternative_taken`, `applicability_hint`, `embedding`
- New `FailureManager` facade with `record(failure)`, `lookupForTask(context)` (semantic search), `markResolved(id)`
- Wiring: `FailureDistillation` already outputs causal-chain lessons — adapt to populate `FailureRecord`
- Pre-task retrieval hook in `ContextWindowManager` (optional L1.7 layer or via `mustInclude`)
- 15–20 tests

### Priority 2 — Trust Hierarchy formalization (Type 12 enhancement) — **lifts all other types**

**Why it's P2**: A meta-improvement that adds compile-time + runtime safety to every conflict-resolution / staleness / merge decision across the codebase. Currently `Entity.source.method` and `confidence` are unstructured; the catalog's `trust_level: 'ground-truth' | 'verified' | 'inferred' | 'unverified'` discriminated union makes the trust ordering explicit.

**Effort**: small — ~3 days:
- Add `TrustLevel` discriminated union to `Entity` (or as a `Provenance` mixin)
- Backfill mapping from current `source.method` → `trust_level`
- Update `CollaborativeSynthesis.resolveConflicts` to honor the explicit ordering: `user-authored > tool-verified (recent) > agent-inferred (high) > imported > agent-inferred (low)`
- Recency-as-tiebreaker within tier
- 10 tests

### Priority 2 — Tool Affordance Memory (Type 8) — **new memory type**

**Why it's P2**: No current support. High value for adaptive tool selection (catalog's example: "last 5 grep calls returned in 200ms; last 5 MCP calls timed out → bias next plan"). Distinct from existing facilities — `AccessTracker` tracks entity access, not tool-call outcomes.

**Effort**: medium — ~7 days:
- New `MemoryType: 'tool-affordance'`
- `ToolAffordanceRecord` schema with `tool_name`, `recent_success_rate`, `common_failure_modes`, `cost_estimate`, `last_used`, `notes`
- `ToolAffordanceManager` with rolling-window stats (last N invocations per tool)
- Optional middleware hook in MCP server / tool wrapper to auto-record
- 15–20 tests

### Priority 2 — Reflection Log scheduled pass (Type 10 enhancement) — **closes consolidation arrow**

**Why it's P2**: Has the components (`PatternDetector`, `TrajectoryCompressor`, `ExperienceExtractor`) but no explicit `ReflectionRecord` schema and no scheduled pass tying episodes → consolidated reflections. The catalog's framing: "scheduled reflection is what converts logging into learning."

**Effort**: small-medium — ~5 days:
- `ReflectionRecord` interface with `scope`, `observation`, `evidence: EpisodeRef[]`, `generalization_confidence`, `embedding`
- `ReflectionStage` PipelineStage (mirrors `ProspectivePromotionStage` pattern just shipped)
- Hook into `ConsolidationScheduler` for end-of-session pass
- Selective re-injection at wakeUp (new layer or extension to L1.5)
- 15 tests

### Priority 3 — Decision Rationale (Type 11) — **new memory type**

**Why it's P3**: Catalog calls it "critical for multi-session agents" (prevents re-litigating settled choices). But MemoryJS currently has ADRs in markdown — adding a *runtime* memory type for them is opt-in value, not foundational.

**Effort**: small-medium — ~5 days:
- New `MemoryType: 'decision'`
- `DecisionRecord` schema with `status`, `context`, `decision`, `alternatives`, `consequences`, `related_files`, `supersedes?`
- `DecisionManager` with `propose`, `accept`, `supersede`, `findByContext`
- ADR-NNN markdown / JSON dual-write (catalog's "schema rigidity vs. flexibility" §7.4 recommendation)
- 15 tests

### Priority 3 — Project Context structured schema (Type 2 enhancement) — **medium value**

**Why it's P3**: `Entity.projectId` covers scoping but the catalog's structured `facts[]` / `conventions[]` / `commands[]` / `glossary[]` schema would unlock a richer "what does this codebase know" memory type. The unstructured CLAUDE.md handles most of this today.

**Effort**: small — ~3 days. Mostly schema + a `ProjectContextManager` facade.

### Priority 4 — `do_not_remember` list — **privacy hardening**

**Why it's P4**: Has `PiiRedactor` for pattern-based redaction. Catalog's `do_not_remember` is user-supplied content exclusions (hard-delete + write-block) — a different mechanism. Low effort but only meaningful once users start asking "forget that."

**Effort**: small — ~2 days. Extension to `PiiRedactor` or new `ExclusionManager`.

### Out of scope / deferred

- **Per-type decay policy** — incremental; can be added per-manager as needed.
- **Per-type retrieval budget config** — current global budget is sufficient for v1.
- **Cross-project skill promotion automation** — catalog explicitly recommends "explicit user action only," matching MemoryJS's current state.

---

## 5. Recommended next sprint sequence

Ordered for maximum compound value:

| Sprint | Item | Effort | Rationale |
|--------|------|--------|-----------|
| **Sprint 4** | **Failure Memory hardening** (Type 9 enhancement) — ✅ shipped | ~5 days | Highest single-feature ROI per the catalog. Existing `FailureDistillation` becomes the producer of structured `FailureRecord`s; pre-task lookup hook delivers immediate user-visible value. Doesn't depend on any other planned work. |
| **Sprint 5** | **Plan / Goal Stack** (Type 6, new memory type) — ✅ shipped | ~10 days | Foundational per the catalog's MVP sequence. Closed via `PlanManager` + `MemoryType: 'plan'` + `ctx.plan`. Pairs structurally with prospective memory (intentions × goals × episodes is the full forward-time triplet). Consolidation stage + wakeUp injection deferred to a follow-up sprint per the prospective-memory pattern. |
| **Sprint 6** | **Trust Hierarchy formalization** (Type 12 enhancement) — ✅ shipped (partial) | ~3 days | Meta-improvement. Closed via `TrustLevel` union on `MemorySource` + `inferTrustLevel` backfill + `'trust_level'` `ConflictStrategy` with recency tiebreak. `CollaborativeSynthesis.resolveConflicts` ordering integration deferred to a follow-up sprint per scope cut. Sets up the discriminated-union pattern for future provenance-related work. |
| **Sprint 7** | **Tool Affordance Memory** (Type 8, new memory type) | ~7 days | High adaptive-tool-selection value. Could wait if MCP-server integration isn't a near-term priority. |
| **Sprint 8** | **Reflection Log scheduled pass** (Type 10 enhancement) — ✅ shipped | ~5 days | Closed via `ReflectionManager` + `MemoryType: 'reflection'` + `ReflectionStage` (additive; raw confidence gate; session-end scheduling via explicit `runOnSessionEnd` helper; content-hash dedup). `ExperienceExtractor` wiring and `PatternResult.sourceEntities` narrowing deferred to follow-ups. |

**Sprints 4 + 5 + 6 alone (~18 days)** deliver the catalog's MVP set (Failure + Plan + formalized Provenance). That's the recommended Phase-2 cut.

---

## 6. Open questions

These are real decisions, not paperwork — pick deliberately before implementation:

### Q1 — Plan vs. Prospective: where's the line?
Prospective memory (just shipped) covers "intentions to act at a future time/event." Plans cover "current goal decomposition + sub-goals + acceptance criteria." Both are forward-looking. The catalog distinguishes them by:
- **Mutability**: plans are mutable (sub-goals update as understanding refines); intentions are append-only-until-fired
- **Decomposition**: plans have hierarchical structure; intentions are flat
- **Retrieval pattern**: plans are `always-on` while a session is active; intentions are `conditional` + `temporal`

**Worth confirming**: does this split match your intuition, or should Plan absorb Prospective as a special case of "intentions with sub-structure"?

### Q2 — Failure Memory: pre-task lookup as `mustInclude` or new wakeUp layer?
The catalog's retrieval hook says "before any non-trivial plan execution, semantic-search failures for `applicability_hint` matches." Two implementations:
- (a) Extend `ContextWindowManager.retrieveForContext` with a `failureLookup: true` flag that uses the existing `mustInclude` machinery
- (b) Add a dedicated `wakeUp.l1_7` layer (between L1.5 prospective and L1 entities) populated on demand

**Recommendation**: (a) — it's cheaper, and the failure-lookup is task-scoped rather than session-scoped. The wakeUp layers are for session bootstrap.

### Q3 — Trust hierarchy formalization: where does `trust_level` live?
Three options:
- (a) On `AgentEntity` directly as a top-level field (`AgentEntity.trustLevel`)
- (b) On `Entity.source` (extending `MemorySource`)
- (c) Computed from existing fields via a `getTrustLevel(entity)` function — no new persistent field

**Recommendation**: (b) — matches the catalog's "provenance as mixin" framing; round-trips through the `agentMetadata` JSON blob; no schema migration needed.

### Q4 — Tool Affordance: scope of "tool"?
The catalog implies tool calls broadly — file edits, command runs, MCP responses. MemoryJS doesn't currently observe tool calls; it lives at the entity layer. Building `ToolAffordanceMemory` means **adding a tool-observation pipeline** (the producer) before the memory type can be useful. That doubles the effort.

**Worth confirming**: is this in scope for MemoryJS, or does it belong in a downstream MCP-server / agent wrapper that *uses* MemoryJS as the storage?

---

## 7. Companion documents

- [`MEMORY_TYPES_EXPANSION.md`](./MEMORY_TYPES_EXPANSION.md) — Phase 1 (prospective memory)
- [`ROADMAP.md`](./ROADMAP.md) — main forward-looking work tracker
- [`future_features.md`](./future_features.md) — proposal-level detail per item
- [`CHANGELOG.md`](../../CHANGELOG.md) — per-version history
- *Source*: the user-provided **Agentic Memory Library — Type Catalog & Design Reference** document
