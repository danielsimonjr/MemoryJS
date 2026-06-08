# Entity-level Observation Dedup — Plan

**Status**: planning (not yet started)
**Owner**: agent-memory track
**Effort estimate**: 3 workflow turns
**Last updated**: 2026-05-15

---

## The problem

`MemoryEngine.checkDuplicate` (v1.11.0) covers **incremental, turn-level** dedup:
before adding a new turn, does this content already exist in this session?
Four tiers — exact hash, prefix, Jaccard, optional semantic.

`CompressionManager.findDuplicates` covers **batch entity-level** dedup: do
*entities* exist whose overall content is similar enough to merge?
Bucketed by entityType + name prefix, similarity over the prepared whole.

**The gap**: cross-entity *observation* duplication. Distinct entities A and
B (different `name`, possibly different `entityType`) can both contain
literally the same observation string. Today nothing surfaces this. Example:

```
Entity Alice (person):    observations: ["Prefers Italian food", ...]
Entity Bob   (person):    observations: ["Prefers Italian food", ...]
```

Neither `CompressionManager` (entity-level) nor `MemoryEngine`
(turn-/session-scoped) catches it.

---

## Design choices

### 1. Algorithm scope

Reuse the `MemoryEngine` four-tier vocabulary, but only what makes sense at
the observation granularity:

- **Exact** (SHA-256 of normalized observation text) — primary, cheap,
  finds verbatim copies. Always on.
- **Jaccard** (token set overlap) — secondary, finds near-duplicates with
  word-order or filler-word variation. Configurable threshold (default
  `0.85` — stricter than `MemoryEngine`'s `0.72` because we're comparing
  whole observations, not whole turns).
- **Semantic** (embedding similarity) — opt-in, mirrors
  `semanticDedupEnabled` on `MemoryEngine`. Requires a `SemanticSearch`
  instance.
- **Prefix overlap** — *skip*. The prefix-tier in `MemoryEngine` catches
  "user typing the same thing twice with a trailing edit". At observation
  granularity that signal is weaker than just running Jaccard.

### 2. Action on duplicate

**Report only** for v1. The new `ObservationDedupManager` exposes a
`findDuplicateObservations(options?)` API that returns groups of
`{ observation, occurrences: Array<{ entityName, observationIndex }> }`. No
mutations.

Out of scope for v1 — file as follow-ups when v1 ships:
- *Merge into a shared semantic entity* — needs a relation-design decision
  (who owns the shared observation, what relation type connects the
  individual entities to it).
- *Strip from individual entities* — destructive, needs governance hook.

Report-only is the lowest-risk surface that lets consumers decide.

### 3. Trigger

- **Manual API** — `ctx.observationDedupManager.findDuplicateObservations()`.
  Primary surface. Caller-driven, no side effects.
- **Optional `PipelineStage`** — `ObservationDedupReportStage`. Runs the
  finder, emits a diagnostic `StageResult` with `transformed=0` and
  one `[info]`-prefixed entry per duplicate group (matches the
  `ReflectionStage` diagnostic convention). No mutations. Not
  auto-registered.
- **Scheduled** — out of scope for v1. If a user wants periodic reports
  they can register the stage and trigger it on their own schedule.

### 4. Cross-cuts

`findDuplicateObservations(options?)` takes an optional filter:

```typescript
interface ObservationDedupFilter {
  entityType?: string | string[];
  projectId?: string;
  sessionId?: string;
  /** Minimum group size to report (default 2 — i.e. any duplicate). */
  minOccurrences?: number;
  /** Cap on groups returned (default 100 — circuit-breaker). */
  maxGroups?: number;
}
```

Default: scan all entities. Scope-narrowing is per-call.

---

## Implementation phases

### Phase A — `ObservationDedupManager`

**One workflow turn.**

**Changes:**

1. **`src/agent/ObservationDedupManager.ts`** (new):
   - Constructor: `new ObservationDedupManager(storage, config?)`.
     `IGraphStorage` only — no `EntityManager` needed (no writes).
   - `async findDuplicateObservations(options?: ObservationDedupFilter):
     Promise<DuplicateObservationGroup[]>`.
   - Internal: build `Map<hash, Array<{ entityName, observationIndex }>>`;
     filter to groups with `>= minOccurrences`; sort by group size desc.
   - `config?: { jaccardThreshold?: number; semanticSearch?: SemanticSearch }`
     — optional knobs for the Jaccard and semantic tiers.
   - `async findJaccardDuplicates(options?)` — separate method for the
     Jaccard pass (more expensive). Two-method split keeps the exact-hash
     fast path uncoupled from the O(n²) Jaccard pass.

2. **`src/types/types.ts`** — new public types:
   ```typescript
   interface DuplicateObservationOccurrence {
     entityName: string;
     observationIndex: number;
   }
   interface DuplicateObservationGroup {
     /** Canonical (normalized) observation text. */
     observation: string;
     occurrences: DuplicateObservationOccurrence[];
     /** Detection tier: 'exact' | 'jaccard' | 'semantic'. */
     tier: 'exact' | 'jaccard' | 'semantic';
   }
   interface ObservationDedupFilter {
     entityType?: string | string[];
     projectId?: string;
     sessionId?: string;
     minOccurrences?: number;
     maxGroups?: number;
   }
   ```

3. **`src/core/ManagerContext.ts`** — `ctx.observationDedupManager` lazy
   getter.

**Tests** (`tests/unit/agent/ObservationDedupManager.test.ts`):
- Exact-tier finds verbatim duplicates across entities.
- Filters by entityType / projectId / sessionId.
- `minOccurrences` threshold respected.
- `maxGroups` circuit-breaker respected.
- Empty input → empty output (no crash).
- Jaccard pass finds near-duplicates that exact misses.

**Acceptance**: typecheck clean, new test file green, no regression in
existing test suites.

### Phase B — `ObservationDedupReportStage`

**One workflow turn.** Depends on Phase A.

**Changes:**

1. **`src/agent/ConsolidationPipeline.ts`** — new
   `ObservationDedupReportStage implements PipelineStage`:
   - Constructor: `(observationDedupManager, config?)`.
   - `process()` calls `findDuplicateObservations()` with the configured
     filter, emits one `[info] ObservationDedupReportStage: ${groupSummary}`
     entry per group, returns `transformed: 0`.
   - Not auto-registered.

2. **Tests** (`tests/unit/agent/ObservationDedupReportStage.test.ts`):
   - Emits one `[info]` errors-entry per duplicate group.
   - `transformed === 0` always.
   - Respects pass-through filter options.

**Acceptance**: typecheck clean, new test file green.

### Phase C — Docs + roadmap close

**One workflow turn.** Depends on A + B.

1. **`docs/architecture/AGENT_MEMORY.md`** — new "Observation Dedup"
   subsection.
2. **`docs/architecture/COMPONENTS.md`** — `ObservationDedupManager` +
   `ObservationDedupReportStage` entries.
3. **`docs/architecture/API.md`** — public API surface listing.
4. **`docs/roadmap/ROADMAP.md`** — flip Priority 1 item #5 (entity-level
   observation dedup) from outstanding to ✅ shipped; trim "Dedup" row of
   Status Summary; decrement "Genuinely active P1/P2 items" count.
5. **`CHANGELOG.md`** — `[Unreleased]` > `Added` entries.

**Acceptance**: docs review reads cleanly; ROADMAP cross-references match
implementation.

---

## Risk / rollback

- **Phase A is additive** — new manager, new types, new getter. No
  existing behavior changes. Trivially revertable.
- **Phase B** is also additive — new pipeline stage, not auto-registered.
  Consumers opt in.
- The Jaccard pass is `O(n²)` in worst case. The `maxGroups`
  circuit-breaker + the early-exit on exact-tier matches keep it bounded
  in practice. We document this in the manager JSDoc.

## Out of scope (file as follow-ups after Phase C ships)

- Auto-merge into a shared semantic entity.
- Auto-strip from individual entities (destructive — needs governance).
- Scheduled / background reporting (operators can register the stage on
  their own schedule).
- Cross-graph dedup (across different `MEMORY_FILE_PATH` instances).
