# η.5.5 — Collaboration Features Plan

> **Status (2026-04-25):** Plan only. No code. Targets Phase η of the dispatch runbook (`docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md`). Promote via `superpowers:writing-plans` to a dated implementation plan when ready.

**Source spec:** `docs/roadmap/ROADMAP.md` § Phase 5.5 — "Multi-user graph editing / Change conflict resolution / Real-time collaboration via WebSockets".

## Goal

Extend memoryjs into a properly collaborative multi-agent knowledge graph: agents write concurrently without silently overwriting each other, visibility is expressible with precision (role-gated, time-boxed), every mutation is attributed to the agent that made it, and the existing `CollaborativeSynthesis` merge is promoted from a read-path aggregator to a conflict-presenting write-path reconciler.

## What exists today (shipped)

- `CollaborativeSynthesis.synthesize()` (v1.7.0) — BFS neighbourhood merge, salience-scored, grouped by `entityType`. Read-only; `SynthesisResult` carries no per-agent conflict view.
- `VisibilityResolver.canAccess()` (v1.7.0) — five-level model backed by `GroupMembership`. No role predicates; no temporal window.
- `AuditLog.append({ agentId? })` (v1.6.0) — field exists; `GovernanceManager` passes it when supplied via `GovernanceOperationOptions.agentId`. Direct `EntityManager` callers (incl. `SemanticForget`) produce unattributed entries.
- `Entity.version` (v1.8.0) — integer field; incremented by `ContradictionDetector` on supersession. No caller checks it before writing.

## Out of scope

- Full RBAC/ABAC policy engine (Phase 6.1). This plan adds lightweight role predicates to `VisibilityResolver` only.
- WebSocket real-time push. Defer to a follow-on plan after η.4.2 REST API.
- Distributed locking across processes. OCC is sufficient for embedded / single-server deployment.
- PostgreSQL multi-tenant row isolation (Phase γ / MEM-05).

## Architecture

```
src/agent/
├── CollaborativeSynthesis.ts          — extend: add ConflictView[] to SynthesisResult;
│                                        new method resolveConflicts(policy).
├── VisibilityResolver.ts              — extend: role predicate + visibleFrom/visibleUntil
│                                        time-window gate.
└── collaboration/
    ├── OptimisticConcurrencyGuard.ts  — NEW: compare Entity.version before write;
    │                                    throw VersionConflictError on mismatch.
    ├── CollaborationAuditEnforcer.ts  — NEW: proxy EntityManager writes to AuditLog
    │                                    with mandatory agentId.
    └── CrdtBridge.ts                  — NEW (stub until 5.5.e approved).

src/types/agent-memory.ts              — extend AgentEntity: visibleFrom?, visibleUntil?,
                                         allowedRoles?: string[].
src/features/GovernanceManager.ts      — wire CollaborationAuditEnforcer; propagate agentId.
src/features/SemanticForget.ts         — pass agentId: 'system:semantic-forget'.
```

## Runtime deps

**No-new-deps subset (5.5.b/c/d):** zero new deps.

**Decision gate — 5.5.e (CRDT):** `yjs` (~50 KB gz) + `y-protocols` (~15 KB gz) as optional peer deps. **Needs Daniel's go-ahead.**

## Sub-plans

### 5.5.a — Multi-agent merge conflict presentation

`CollaborativeSynthesis.synthesize()` groups observations by entity type but does not surface contradictions between agents. Add `conflicts: ConflictView[]` to `SynthesisResult`. A `ConflictView` names the entity, lists competing `AgentEntity` versions per `agentId`, scores by `confidence × source.reliability`. Add `resolveConflicts(policy)` applying caller-supplied strategy (`most_recent` / `highest_confidence` / `trusted_agent` / `merge_all`).

```typescript
interface ConflictView {
  entityName: string;
  candidates: Array<{ agentId: string; entity: AgentEntity; score: number }>;
  recommendedWinner: string;
}
```

**Depends on:** 5.5.d (attribution must be populated). **Effort:** 2–3d.

### 5.5.b — Visibility hierarchy expansion

1. **Role-based predicates** — `allowedRoles?: string[]` on `AgentEntity`. Tightens, never widens; AND'd with the level check.
2. **Time-boxed visibility** — `visibleFrom?: string` and `visibleUntil?: string`. Resolver checks current clock against window before any other rule. Useful for shared entities that should expire.

Type changes: extend `AgentEntity` in `src/types/agent-memory.ts`. No storage schema change.

New env vars: `MEMORY_DEFAULT_VISIBLE_FROM` / `MEMORY_DEFAULT_VISIBLE_UNTIL` (ISO, unset = unbounded).

**Effort:** 1–2d.

### 5.5.c — Optimistic concurrency control

`OptimisticConcurrencyGuard` wraps `EntityManager.updateEntity`: reads live `version`, compares to caller-supplied `expectedVersion`. On mismatch throws `VersionConflictError extends KnowledgeGraphError` carrying `{ entityName, expected, actual, conflictingAgentId? }`. η.4.2 REST API translates to HTTP 409.

Opt-in per call: `updateEntity(name, updates, { expectedVersion: 3 })`. Omitting preserves last-write-wins. `GovernanceManager.updateEntity` gains the same param.

No new env vars. **Effort:** 1–2d.

### 5.5.d — Audit trail per-agent attribution

`AuditEntry.agentId?` exists; `GovernanceManager` passes it when supplied. Gaps: (a) direct `EntityManager` mutations bypass audit (e.g., `SemanticForget.ts:88` calls `deleteEntities` with no audit trail); (b) no enforcement layer.

`CollaborationAuditEnforcer`: proxy class accepting `requiredAgentId` + `EntityManager`, proxies `createEntity`/`updateEntity`/`deleteEntity`, appends to `AuditLog` unconditionally. Enforces attribution only — does not block on policy.

Wire via `ManagerContext`: when `MEMORY_AUDIT_ATTRIBUTION_REQUIRED=true`, `entityManager` accessor returns enforcer-wrapped instance. `SemanticForget` updated to pass `agentId: 'system:semantic-forget'`.

New env var: `MEMORY_AUDIT_ATTRIBUTION_REQUIRED` (default `false`). **Effort:** 1–2d.

### 5.5.e — CRDT exploration (speculative)

Yjs `Y.Map` / `Y.Array` could represent observations as a CRDT array; concurrent inserts merge without conflict. Tension with memoryjs: data model is append-only JSONL or WAL-mode SQLite — already handles concurrent readers. CRDTs add *offline-first* merge, valuable only when agents diverge without a shared connection.

Automerge 2.x requires WASM (~200 KB gz); Yjs is leaner (~50 KB gz + y-protocols ~15 KB gz). Incompatibility: `GovernanceManager.canUpdate` is sync; CRDT merges arrive as already-committed updates, bypassing policy.

**Recommendation:** ship 5.5.c (OCC) now. Land `CrdtBridge.ts` as stub. Revisit when concrete offline-diverge use case is validated.

## Tasks (when promoted)

1. Extend `AgentEntity` in `src/types/agent-memory.ts` (5.5.b).
2. Update `VisibilityResolver.canAccess()`: time-window then role-predicate (5.5.b).
3. Implement `OptimisticConcurrencyGuard` + `VersionConflictError` (5.5.c).
4. Implement `CollaborationAuditEnforcer`; wire via `ManagerContext`; update `SemanticForget` (5.5.d).
5. Extend `SynthesisResult` with `conflicts`; implement `resolveConflicts()` (5.5.a — after 5.5.d).
6. Add `CrdtBridge.ts` stub (5.5.e).
7. 15 unit tests: time-boxed visibility (3), role predicate (2), OCC (4), attribution enforcer (3), conflict-view (3).
8. Update CLAUDE.md env var table; CHANGELOG bump; cross-link `2026-04-25-eta-rest-api.md` for HTTP 409.

## Effort estimate

5.5.b + 5.5.c + 5.5.d (no deps): ~4–5d impl + 1–2d tests.
5.5.a (depends on 5.5.d): ~2–3d impl + 1d tests.
5.5.e (stub only): 0.5d.
**Total (excluding 5.5.e full wiring):** ~2 weeks.

## Decision gate

- **5.5.b / 5.5.c / 5.5.d:** no new deps, additive-only, backward-compatible. Promote when capacity available.
- **5.5.a:** additive only. Promote after 5.5.d so attribution exists to differentiate candidates.
- **5.5.e full CRDT wiring:** blocked on Daniel's go-ahead + `yjs` peer dep approval. Stub can land unconditionally.

## Risks

- **OCC false positives under `ConsolidationScheduler`**: background consolidation increments `version`; callers holding stale `expectedVersion` get spurious `VersionConflictError`. Document: fetch immediately before write, don't cache across scheduler cycles.
- **`allowedRoles` + level interaction**: invariant — both checks must pass. Enforce in JSDoc + unit test.
- **Attribution enforcer + `SemanticForget`**: must not ship 5.5.d without the `SemanticForget.ts:88` fix.
- **CRDT merge vs. governance policy incompatibility**: `canUpdate` is sync, pre-write; CRDT merges are post-commit. Cannot compose without blocking CRDT for policy or relaxing governance. This is the decisive reason 5.5.e stays gated.
