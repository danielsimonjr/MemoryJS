# 3B.8 Heuristic Guidelines Manager — Minimum-Viable Wiring Plan

**Status**: planning (not yet started)
**Owner**: agent-memory track
**Effort estimate**: 3 workflow turns (one per execution phase)
**Last updated**: 2026-05-15

---

## Goals

Close the last unshipped Phase 3B item by:

1. Promoting the existing in-memory `HeuristicManager` scaffold
   (`src/agent/HeuristicManager.ts`, 284 lines, `@experimental`) to a
   **storage-backed** facade so heuristics survive process restarts.
2. Wiring a `ctx.heuristicManager` lazy getter into `ManagerContext`.
3. Adding a `HeuristicExtractionStage` to `ConsolidationPipeline` that
   crystallises resolved failures + qualifying reflections into
   `HeuristicEntity` records.

After this, agents can call `ctx.heuristicManager.match(input)` at task
start to pull contextually-relevant guidelines, and reinforce / contradict
them based on outcomes — closing the "From Storage to Experience" loop.

## Non-goals

- **Semantic-similarity matching** (currently Jaccard) — out of scope;
  the existing `@experimental` tag stays.
- **Graph-induction of rules from execution traces** — separate effort.
- **Cross-agent heuristic sharing / visibility levels** — already
  covered by `VisibilityResolver`; we ride on the existing
  `AgentEntity` visibility surface.
- **Heuristic conflict auto-resolution** — `detectConflicts` exists
  and surfaces overlaps/contradictions; resolution remains caller-driven.

---

## Phase 3B.8a — Storage-backed `HeuristicEntity` + facade refactor

**One workflow turn.**

### Changes

1. **`src/types/agent-memory.ts`**
   - Add `'heuristic'` to the `MEMORY_TYPES` const tuple (additive — the
     literal-deduplication refactor #56 made this the single source of
     truth, so the `MemoryType` union expands automatically).
   - New `HeuristicId` branded type (mirrors `ReflectionId` / `PlanId`).
   - New `HeuristicEntity` interface extending `AgentEntity`:
     - `memoryType: 'heuristic'`
     - `heuristicRecord: Heuristic` (the same shape already exported
       from `HeuristicManager.ts` — promote it into `agent-memory.ts`
       so types live with their siblings).
   - New `isHeuristicMemory` type guard.

2. **`src/agent/HeuristicManager.ts`** — convert from in-memory Map to a
   thin storage-backed facade:
   - Constructor: `new HeuristicManager(storage: IGraphStorage, entityManager: EntityManager, config?)`.
   - `add` writes a `HeuristicEntity` via `entityManager` (so OCC + version
     are paid in by default, matching the v2.0.x #55 race-fix pattern).
   - `get` / `list` / `size` / `match` / `detectConflicts` query through
     `storage.loadGraph().entities.filter(isHeuristicMemory)`.
   - `reinforce` / `recordContradiction` route through
     `entityManager.updateEntity` with `expectedVersion`; new result type
     `ReinforceResult = 'reinforced' | 'not-found' | 'conflict' | 'vanished-mid-update'`.
   - `remove` / `clear` use `EntityManager.deleteEntities`.
   - The `@experimental` tag stays — the match algorithm is unchanged.

3. **`src/core/ManagerContext.ts`**
   - New `private _heuristicManager?: HeuristicManager` + lazy getter
     `get heuristicManager(): HeuristicManager`.
   - Constructed with `(this.storage, this.entityManager)`.

### Migration impact

- **Breaking** (acceptable; the v1 in-memory class was `@experimental`).
- Existing tests in `tests/unit/agent/HeuristicManager.test.ts` need
  the new constructor signature + a mock storage / fake EntityManager —
  same pattern as the #55 fix.
- No `MEMORY_HEURISTIC_*` env vars yet — defer until extraction lands.

### Tests

- `HeuristicEntity` round-trips through storage (unit).
- `add` returns a `'created'` discriminated result on success.
- `reinforce` / `recordContradiction` return `'conflict'` on OCC mismatch.
- `match` against a graph of heuristic entities returns sorted Jaccard
  hits.
- `clear` removes only heuristic entities, leaving other memory types
  untouched.

### Acceptance gate

- `npm run typecheck` clean.
- `tests/unit/agent/HeuristicManager.test.ts` green.
- `tests/unit/core/ManagerContext.test.ts` adds a `heuristicManager`
  lazy-getter test; green.

---

## Phase 3B.8b — `HeuristicExtractionStage`

**One workflow turn.** Depends on 3B.8a.

### Trigger

Stage runs over recent `ReflectionEntity` + `FailureEntity` records that
have NOT yet produced heuristics. Triggered:

- On the standard `ConsolidationPipeline.runAutoConsolidation()` cycle
  (so the `ConsolidationScheduler` picks it up by default).
- On-demand via a `runOnResolution(failureId)` helper (mirrors
  `ReflectionStage.runOnSessionEnd`).

### Extraction rules (deliberately conservative)

1. **Resolved failures** (`failureRecord.lifecycle.status === 'resolved'`
   with non-empty `resolvedReason` and `alternative_taken`):
   - `condition` = `failureRecord.applicability_hint`
   - `action` = `"Avoid: ${failureRecord.attempted}. Prefer: ${failureRecord.alternative_taken}"`
   - `initialConfidence` = `0.6` (resolved failures are evidence-rich
     but single-instance).

2. **Reflections with `experienceType` set** (Sprint 8 follow-up #53
   wiring), with `generalization_confidence >= MEMORY_HEURISTIC_MIN_CONFIDENCE`:
   - Skip unless `keyInsights.length > 0`.
   - For each insight, derive `condition` from the
     `ReflectionRecord.summary` and `action` from the insight.
   - `initialConfidence` = `min(generalization_confidence, 0.7)` —
     reflections are aggregates so we trust them more, but cap to leave
     headroom for explicit reinforcement.

### Dedup

Content-hash dedup mirrors `ReflectionManager.create`:
`sha256(condition + '|' + action)` is the entity name suffix. Repeat
extractions on the same source observation are idempotent.

### Env vars

- `MEMORY_HEURISTIC_AUTO_EXTRACT` (`true` | `false`, default `false`) —
  gates whether `runAutoConsolidation` calls the stage.
- `MEMORY_HEURISTIC_MIN_CONFIDENCE` (number 0–1, default `0.4`).
- `MEMORY_HEURISTIC_MAX_PER_RUN` (integer, default `50`) — circuit-breaker.

### Tests

- Stage extracts heuristic from a resolved `FailureRecord`.
- Stage extracts heuristic from a high-confidence `ReflectionRecord`
  with keyInsights.
- Stage is idempotent: a second pass over the same source produces no
  duplicates.
- Stage respects `MEMORY_HEURISTIC_MAX_PER_RUN` circuit-breaker.
- `runOnResolution` only scopes to the named failure.

### Acceptance gate

- `npm run typecheck` clean.
- `tests/unit/agent/HeuristicExtractionStage.test.ts` green.
- `ConsolidationPipeline.test.ts` covers the stage registration path.

---

## Phase 3B.8c — Documentation + roadmap close

**One workflow turn.** Depends on 3B.8a, 3B.8b.

### Changes

1. **`docs/architecture/AGENT_MEMORY.md`** — new "Heuristic Guidelines"
   subsection under "Memory Types".
2. **`docs/architecture/COMPONENTS.md`** — `HeuristicManager` /
   `HeuristicExtractionStage` entries.
3. **`docs/architecture/API.md`** — public-API surface listing.
4. **`CLAUDE.md`** — new `MEMORY_HEURISTIC_*` env-var rows under the
   "Agent Memory" section.
5. **`docs/roadmap/ROADMAP.md`** — flip 3B.8 from outstanding to ✅
   shipped; update Status Summary table; close the "Genuinely active
   P1/P2 items: 8" line to reflect new count.
6. **`CHANGELOG.md`** — `[Unreleased]` entry under both `Breaking` (the
   constructor change) and `Added` (the storage-backed surface + new
   stage + env vars).

### Acceptance gate

- Dependency-graph tool re-run so module counts / new file numbers
  are accurate in the regenerated artefacts.
- `npm run typecheck` and `npm run test` clean from the project root.

---

## Risk / rollback

- **The `@experimental` tag stays through 3B.8.** Any consumer who
  depended on the in-memory v1 API was already opted in to breaking
  changes per `@experimental` semantics.
- Roll-back of 3B.8a alone is straightforward: the in-memory Map class
  is preserved in git history; a future release could revert to it if
  storage-backed perf becomes a bottleneck (it shouldn't — heuristics
  are O(< 100) per the docstring).
- If `HeuristicExtractionStage` produces noise, env-gate it
  (`MEMORY_HEURISTIC_AUTO_EXTRACT=false` is the default) — operators
  opt in.

## Out of scope (filed as follow-ups after 3B.8c ships)

- Semantic-similarity match algorithm.
- Heuristic-graph induction from execution traces.
- Cross-agent heuristic merge under `CollaborativeSynthesis`.
- LLM-grounded condition/action paraphrase (today both are verbatim
  from the source `FailureRecord` / `ReflectionRecord`).
