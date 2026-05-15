# Tool Affordance Memory — Plan

**Status**: planning (not yet started)
**Owner**: agent-memory track
**Effort estimate**: 4 workflow turns
**Last updated**: 2026-05-15

---

## Context

Catalog Type 8 — "what tools work / fail for which task patterns,
including success rates, common failure modes, and cost estimates."
Catalog calls this "high adaptive-tool-selection value."

The open scope question from
[`MEMORY_TYPES_EXPANSION_PHASE_2.md`](./MEMORY_TYPES_EXPANSION_PHASE_2.md)
§6 Q4 has been resolved: **MemoryJS will ship both the memory type
AND a built-in observation pipeline**. MemoryJS is no longer
"storage + retrieval primitives only" — it now also tracks
tool-call outcomes for the affordance feedback loop. Consumers
(MCP server, agent wrapper, custom runtime) call into the observer
API rather than building their own producer.

This is an explicit scope expansion. Documented above the line so
future scope-creep arguments don't lean on "Tool Affordance set
precedent."

---

## Surface overview

```
┌─ Caller (MCP server / agent wrapper / custom code) ──┐
│                                                       │
│  observer.observeStart('shell.run', { args: ... })   │
│      → returns callId                                 │
│  observer.observeComplete(callId, 'success')          │
│                                                       │
└──────────────┬────────────────────────────────────────┘
               │ writes to ToolAffordanceManager
               ▼
┌─ ToolAffordanceManager (memory layer) ───────────────┐
│                                                       │
│  recordOutcome(toolName, outcome, meta?)              │
│  rollingStats(toolName) → success_rate, failures      │
│  suggestTool(taskHint) → ranked candidates            │
│                                                       │
└──────────────┬────────────────────────────────────────┘
               │ persisted as
               ▼
┌─ 'tool_affordance' memory type ──────────────────────┐
│  one record per tool_name                             │
│  tracks rolling success/failure outcomes              │
└───────────────────────────────────────────────────────┘
```

## Per-phase design

### Phase Tool A — `'tool_affordance'` memory type + `ToolAffordanceManager`

**One workflow turn.**

#### Types (`src/types/agent-memory.ts`)

- Add `'tool_affordance'` to `MEMORY_TYPES`.
- `ToolAffordanceId` branded type (entity name is
  `tool-affordance-${toolName}`).
- `ToolCallOutcome`: `{ outcome: 'success' | 'failure' | 'partial';
  errorMessage?: string; durationMs?: number; timestamp: IsoDateTime }`.
- `ToolAffordanceRecord`:
  ```typescript
  interface ToolAffordanceRecord {
    id: ToolAffordanceId;          // == 'tool-affordance-${toolName}'
    toolName: string;
    timestamp: IsoDateTime;         // first observation
    lastUpdated: IsoDateTime;
    /** Rolling window of recent outcomes. Capped by manager config. */
    outcomes: ToolCallOutcome[];
    /** Pre-computed common failure-mode strings, top-N. */
    commonFailureModes: string[];
    /** Optional rolling-mean duration in ms. */
    avgDurationMs?: number;
    /** Computed on each `recordOutcome`. */
    successRate: number;
    totalCalls: number;
  }
  ```
- `ToolAffordanceEntity` + `isToolAffordanceMemory` type guard.

#### Manager (`src/agent/ToolAffordanceManager.ts`)

- Constructor `(storage, entityManager, config?)`.
- `config?: { rollingWindowSize?: number; topFailureModes?: number }`.
  Defaults: window 100, top failures 5.
- `recordOutcome(toolName, outcome, meta?): Promise<ToolAffordanceRecord>` —
  creates the record on first call; on subsequent calls, appends to
  `outcomes` (dropping oldest beyond window), recomputes
  `successRate`, refreshes `commonFailureModes` (top-N by frequency
  among `errorMessage`s), updates `avgDurationMs`.
- `rollingStats(toolName): { success_rate, total_calls,
  common_failure_modes, avg_duration_ms } | undefined` — sync via
  name index.
- `suggestTool(taskHint, opts?): Array<{ toolName, score }>` —
  substring-matches `taskHint` against tool names + recent outcome
  metadata; ranks by `successRate × recencyFactor`. Conservative for
  v1; semantic re-rank deferred.
- `get(toolName)`, `list()`, `remove(toolName)`.

All writes OCC-protected via `EntityManager.updateEntity({expectedVersion})`,
matching the v2.0.x pattern.

#### Wiring

- `ctx.toolAffordanceManager` lazy getter.

#### Tests

- First `recordOutcome` creates the record.
- Subsequent calls update `outcomes`, recompute `successRate`.
- Rolling window: outcomes past `rollingWindowSize` are dropped.
- `commonFailureModes` ranks top-N error strings by frequency.
- `suggestTool` returns tools matching the hint, sorted by success
  rate.
- OCC conflict via `VersionConflictError`.

---

### Phase Tool B — `ToolCallObserver` (producer pipeline)

**One workflow turn.** Depends on Tool A.

#### Surface (`src/agent/ToolCallObserver.ts`)

```typescript
class ToolCallObserver {
  constructor(toolAffordanceManager: ToolAffordanceManager);

  /** Begin an observation. Returns a call id the caller threads through. */
  observeStart(toolName: string, args?: Record<string, unknown>): string;

  /** Record successful completion. */
  observeComplete(callId: string, meta?: { result?: string }): Promise<void>;

  /** Record a failure with the error message. */
  observeError(callId: string, error: Error | string): Promise<void>;

  /** Record a partial result (mixed outcome). */
  observePartial(callId: string, reason: string): Promise<void>;

  /** Drop an in-flight observation without recording (e.g. user cancel). */
  cancel(callId: string): void;

  /** Diagnostics. */
  inFlightCount(): number;
}
```

#### Behaviour

- Tracks in-flight calls in an internal `Map<callId, { toolName,
  startedAt }>`.
- `observeComplete` / `observeError` / `observePartial` compute
  `durationMs = Date.now() - startedAt`, call
  `toolAffordanceManager.recordOutcome(toolName, ...)`, and drop the
  in-flight entry.
- On stale in-flight (orphan), `inFlightCount` reports the leak;
  manager-level rolling window absorbs eventual abandonment.
- Emits events on a small `node:events` EventEmitter so external
  systems (logging, telemetry) can subscribe:
  `toolCall:start` / `toolCall:complete` / `toolCall:error` /
  `toolCall:partial`.

#### Wiring

- `ctx.toolCallObserver` lazy getter (constructs the manager
  transitively).

#### Tests

- Round-trip: `observeStart` → `observeComplete` → manager has the
  outcome.
- Error path: `observeError` records `outcome: 'failure'` with the
  message.
- `cancel` drops without recording.
- Events fire with correct payloads.
- Concurrent observations don't cross wires (one tool's outcome
  doesn't get attributed to another).

---

### Phase Tool C — MCP-server protocol adapter

**One workflow turn.** Depends on Tool A + Tool B.

#### Surface (`src/adapters/MCPToolObserverAdapter.ts`)

Light adapter that wraps a generic MCP-style tool-call envelope and
calls into `ToolCallObserver`. MemoryJS doesn't ship an MCP server
itself — this adapter is a compatibility shim for callers building
on `@modelcontextprotocol/sdk` (or equivalent).

- `wrapToolCall(envelope: MCPToolCall, handler: () => Promise<unknown>):
  Promise<unknown>` — `observeStart` → run handler → on success
  `observeComplete`, on throw `observeError` + re-throw.
- Helper: `extractToolName(envelope)` — best-effort tool-name
  extraction (supports the common shapes: `{ name }`, `{ tool }`,
  `{ method: 'tools/call', params: { name } }`).

#### Tests

- Happy path: handler completes → observeComplete called with
  duration.
- Throw: handler throws → observeError called → re-throw preserved.
- Non-MCP envelope: `extractToolName` returns `'unknown'` and
  observation still runs.

#### Why this lives in `src/adapters/`

- Same neighborhood as `RestRouter`, `LangChainMemoryAdapter`,
  `RateLimiter` — framework-edge concerns.
- Doesn't add `@modelcontextprotocol/sdk` as a dep; uses structural
  typing on the envelope.

---

### Phase Tool D — Docs + CLI + roadmap close

**One workflow turn.** Depends on Tool A + B + C.

- `src/cli/commands/toolAffordance.ts`: `memory tool-affordance
  list|show|stats <toolName>` (read-only CLI; record happens via
  observer API, not CLI).
- `docs/architecture/AGENT_MEMORY.md`: new "Tool Affordance (Phase 4)"
  subsection under "Memory Types" + a v2.0.x changelog-style bullet.
- `docs/roadmap/ROADMAP.md`: flip #52 / Priority 2 #1 from outstanding
  to ✅ shipped. Update "Genuinely active P1/P2 items" count.
- `CHANGELOG.md`: `[Unreleased]` > `Added` entries.

---

## Risk / rollback

- **Scope-expansion risk**: MemoryJS now tracks tool-call outcomes,
  not just memories. Documented prominently in CHANGELOG and
  AGENT_MEMORY.md. Easy to argue future tool-related additions
  (planning, budgeting) belong in MemoryJS — defer those judgement
  calls explicitly via case-by-case design docs.
- **MCP-sdk drift risk** (Phase Tool C): the structural-typing
  approach means an MCP-protocol update may silently produce
  `toolName: 'unknown'` if envelope shape drifts. Acceptable for v1;
  add explicit MCP-SDK integration tests if/when a sibling repo
  needs them.
- **Rolling-window memory growth**: capped per `config.rollingWindowSize`
  (default 100 outcomes/tool). Multi-tool deployments need ~100KB-ish
  per 1000 tools — well within budget.

## Out of scope (file as follow-ups after Phase Tool D ships)

- Semantic similarity for `suggestTool` (substring v1 is conservative).
- Cross-tool affordance correlation ("tool X usually follows tool Y").
- Cost-budget tracking (catalog mentions cost_estimate; v1 stores
  `avgDurationMs` only — currency / token-cost integration TBD).
- Per-task-type rollups (cross-cut: tool stats by `applicability_hint`).
