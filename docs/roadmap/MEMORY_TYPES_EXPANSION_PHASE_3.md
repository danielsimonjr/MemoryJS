# Phase 3 Memory-Types Expansion — Plan

**Status**: planning (not yet started)
**Owner**: agent-memory track
**Effort estimate**: ~3 workflow turns per type (9 total if all three ship)
**Last updated**: 2026-05-15

---

## Context

Phase 2 (Sprints 4–8) shipped: Failure Memory, Plan / Goal Stack, Trust
Hierarchy mixin, Reflection Log. Phase 3B closed the "From Storage to
Experience" loop with Heuristic Guidelines Manager (3B.8) plus
cross-entity observation dedup. The remaining Phase 2 P3/P4 items —
Decision Rationale, structured Project Context, and `do_not_remember` —
form **Phase 3** of the memory-types expansion.

Source design space: [`MEMORY_TYPES_EXPANSION_PHASE_2.md`](./MEMORY_TYPES_EXPANSION_PHASE_2.md)
§4 Priority 3–4 and the open Q discussions in §6.

## Why these three together

They are independent enough to ship in any order, but cluster naturally:

- **Decision Rationale** and **Project Context** are *write-heavy
  reference memories* — long-lived, low-churn, retrieved on task-start
  rather than continuously.
- **`do_not_remember`** is a *negative-space filter* — a different
  mechanism (write-block + hard-delete) that intersects with the same
  storage / governance layer the first two write through.

Shipping them as one Phase keeps the governance / PII-adjacent surface
in a single review pass.

---

## Type 1 — Decision Rationale — ✅ shipped (v2.0.x)

Closed via three workflow turns: Phase Dec A (`DecisionManager` +
discriminated lifecycle + `ctx.decisionManager`), Phase Dec B
(`exportAsAdrMarkdown` + static `parseAdrMarkdown`), Phase Dec C
(CLI `memory decision propose|accept|reject|supersede|list|find|export|import`
+ docs close).

### Catalog motivation

"Critical for multi-session agents — prevents re-litigating settled
choices." Today, ADRs live in markdown (`docs/development/` etc.) and
are not query-able at runtime. A runtime `decision` memory type would
let an agent answer "have we already decided X?" without scanning files.

### Surface

- **New `MemoryType: 'decision'`** — added to `MEMORY_TYPES` tuple
  (single source of truth, the literal-deduplication refactor #56 makes
  this trivially additive).
- **`DecisionId`** branded type (mirrors `PlanId` / `ReflectionId` /
  `HeuristicId`).
- **`DecisionRecord`** schema:
  ```typescript
  interface DecisionRecord {
    id: DecisionId;
    timestamp: IsoDateTime;
    status: 'proposed' | 'accepted' | 'superseded' | 'rejected';
    context: string;          // problem space description
    decision: string;         // the chosen path
    alternatives: string[];   // considered-but-not-chosen options
    consequences: string[];   // anticipated downstream effects
    relatedFiles?: string[];  // path strings — paths to ADRs / code
    supersedes?: DecisionId;  // backward link to the prior decision
    sourceSessionId?: string;
    sourceProjectId?: string;
  }
  ```
- **`DecisionLifecycle`** discriminated union matches `FailureLifecycle`'s
  pattern: `{ status: 'proposed' }` | `{ status: 'accepted', acceptedAt }` |
  `{ status: 'superseded', supersededAt, supersededBy: DecisionId }` |
  `{ status: 'rejected', rejectedAt, rejectedReason }`.
- **`DecisionEntity`** extends `AgentEntity` with
  `memoryType: 'decision'` and `decisionRecord: DecisionRecord`.
- **`isDecisionMemory`** type guard.

### Manager

`DecisionManager` (`src/agent/DecisionManager.ts`) — storage-backed,
takes `(storage, entityManager)`, mirrors `FailureManager` / `ReflectionManager`:

- `propose(input): Promise<DecisionRecord>` — creates a `'proposed'`
  decision.
- `accept(id, acceptedAt?): Promise<MarkResolvedResult-shape>` —
  transitions `'proposed' → 'accepted'`. Discriminated return: `'accepted'`,
  `'already-accepted'`, `'not-found'`, `'illegal-transition'` (e.g. from
  `'superseded'`), `'conflict'`, `'vanished-mid-update'`.
- `supersede(id, by: DecisionId): Promise<...>` — link a previous
  decision to its replacement.
- `reject(id, reason): Promise<...>` — transition `'proposed' → 'rejected'`.
- `findByContext(query, options?): Promise<DecisionRecord[]>` —
  substring + tag overlap (matches `FailureManager.lookupForTask` shape).
- `getChain(id): Promise<DecisionRecord[]>` — walks the `supersedes` link
  back to the original proposal.

OCC discipline: all mutations route through `EntityManager.updateEntity`
with `expectedVersion`, matching the #55 pattern.

### Pipeline integration

No automatic stage. Decisions are user-driven by design — the catalog
recommends "explicit user action only" for promotion (Phase 2 doc §4.7).

### Phases

- **Decision A** — types + `DecisionManager` + `ctx.decisionManager`
- **Decision B** — ADR markdown dual-write (the catalog's
  "schema rigidity vs. flexibility" §7.4 recommendation):
  `DecisionManager.exportAsAdrMarkdown(id)` and a complementary
  `IOManager.importAdrs(dir)` so existing `docs/adrs/*.md` flow into the
  runtime store on first read.
- **Decision C** — docs + roadmap close

### Open questions

- **Default importance**: decisions are high-importance by nature.
  Default `8` (matches `FailureRecord`'s `7` with a one-step bump for
  the "settled-choice" finality)?
- **ADR id format**: catalog mentions ADR-NNN numbering. Use sequential
  in-store (`decision-001`, `decision-002`) or hash-of-context? Sequential
  is humans-friendlier; hash is collision-free across forks.

---

## Type 2 — Project Context structured schema

### Catalog motivation

`Entity.projectId` already exists as a scoping mechanism, and CLAUDE.md
carries unstructured project documentation. The catalog's structured
schema (`facts[]` / `conventions[]` / `commands[]` / `glossary[]`)
unlocks runtime-queryable project knowledge.

### Surface

- **New `MemoryType: 'project_context'`** — additive.
- **`ProjectContextRecord`** schema:
  ```typescript
  interface ProjectContextRecord {
    id: string;               // == projectId (one-to-one)
    timestamp: IsoDateTime;
    projectId: string;
    facts: string[];          // "Built with TypeScript", "Uses Vitest"
    conventions: string[];    // "Prefer Result<T,E> over throw"
    commands: Array<{         // documented project-specific commands
      name: string;
      command: string;
      purpose: string;
    }>;
    glossary: Array<{         // domain terms
      term: string;
      definition: string;
    }>;
    lastUpdated: IsoDateTime;
  }
  ```
- **`ProjectContextEntity`**, **`isProjectContextMemory`** — usual pattern.
- **One context per `projectId`** — uniqueness enforced at manager level.

### Manager

`ProjectContextManager` (`src/agent/ProjectContextManager.ts`):

- `upsert(projectId, partial: Partial<ProjectContextRecord>): Promise<ProjectContextRecord>`
  — merge semantics; arrays append (dedup); scalars overwrite.
- `get(projectId): ProjectContextRecord | undefined` — sync via name index.
- `appendFact(projectId, fact): Promise<...>` / `appendConvention(...)` /
  `appendCommand(...)` / `appendGlossaryTerm(...)` — typed targeted appenders.
- `removeFact(projectId, fact): Promise<boolean>` — etc.
- `clear(projectId): Promise<boolean>` — wipe all four arrays but keep
  the entity.
- `forContext(projectId, budget?: number): Promise<string>` — format
  the record as a prose summary fit for `ContextWindowManager.wakeUp`.

OCC discipline applies to all mutations.

### Pipeline integration

Optional `ProjectContextDistillationStage` that reads CLAUDE.md and
appends `facts[]` it doesn't already have — out of scope for the first
shipped phase. Manual entry is the v1 path.

### Phases

- **PC A** — types + `ProjectContextManager` + `ctx.projectContextManager`
- **PC B** — `wakeUp` integration: `ContextWindowManager.wakeUp` consults
  the active project's `ProjectContextRecord` and prepends it as a new
  L0 layer (above session memories)
- **PC C** — docs + roadmap close

### Open questions

- **CLAUDE.md as canonical source vs. runtime store** — if both exist
  and disagree, which wins? Recommendation: runtime store wins (it's
  the "what the agent learned"); CLAUDE.md is the seed.
- **Project deletion** — what happens to the project context when all
  entities for a project are removed? Cascade vs. orphan. Recommendation:
  orphan + `findOrphans()` query for cleanup.

---

## Type 3 — `do_not_remember` list — ✅ shipped (v2.0.x)

Closed via three workflow turns: Phase Excl A (`ExclusionManager` + types
+ `ctx.exclusionManager`), Phase Excl B (`MemoryEngine.addTurn` +
`WorkingMemoryManager.createWorkingMemory` integration with
`memoryEngine:writeBlocked` event and `MemoryWriteBlockedError` throw),
Phase Excl C (CLI `memory exclude add|list|remove` + docs close).
v1 ships `substring` matching only; `regex` deferred.

### Catalog motivation

User-supplied content exclusions: hard-delete existing memories matching
a pattern AND write-block future ones. Distinct from `PiiRedactor`
(structural redaction of credit cards / SSNs); `do_not_remember` is
free-form, content-pattern-based.

### Surface

- **New `MemoryType: 'exclusion'`** — but actually the entity is the
  *rule*, not the excluded memory. The rule's `appliesTo` field is
  matched against new writes and existing observations.
- **`ExclusionRule`** schema:
  ```typescript
  interface ExclusionRule {
    id: string;
    timestamp: IsoDateTime;
    pattern: string;          // substring or regex (see `mode`)
    mode: 'substring' | 'regex';
    /**
     * Whether the rule applies to existing matches (hard-delete on
     * `add`) or only to future writes. Default `'both'`.
     */
    scope: 'future-only' | 'past-only' | 'both';
    /** Optional restriction by entityType. */
    entityType?: string;
    /** Free-text reason. */
    reason?: string;
    /** Number of past memories deleted when the rule was added. */
    deletedCount?: number;
    /** Number of future writes blocked by this rule. */
    blockedCount: number;
  }
  ```
- **`ExclusionEntity`**, **`isExclusionMemory`** — same shape.

### Manager

`ExclusionManager` (`src/agent/ExclusionManager.ts`):

- `add(rule: Omit<ExclusionRule, 'id' | 'timestamp' | 'blockedCount' | 'deletedCount'>): Promise<ExclusionRule>`
  — creates the rule, runs the past-scan if scope includes
  `'past-only' | 'both'`, returns the rule with `deletedCount` filled in.
- `list(): Promise<ExclusionRule[]>` — all active rules.
- `remove(id): Promise<boolean>` — drops the rule but does NOT restore
  deleted memories (they're gone — that's the contract).
- `check(content: string, entityType?: string): { blocked: boolean; ruleId?: string }`
  — synchronous, called by write paths to filter incoming writes.
- `findMatchingMemories(rule): Promise<Entity[]>` — pre-check before
  `add` (dry-run support).

### Write-path integration

This is where the design gets interesting. The catalog's vision is "any
write path consults the exclusion list before persisting." The honest
options:

- **Manager-level guards** — each agent-memory manager
  (`WorkingMemoryManager.add`, `MemoryEngine.addTurn`, etc.) calls
  `exclusionManager.check()` before writing.
- **Storage-level guard** — `IGraphStorage.appendEntity` wrapper that
  inspects `observations[]` and rejects matches. More universal but
  more invasive; also less obvious to consumers what got blocked.
- **Hybrid** — the manager-level guards are the documented path; the
  storage-level wrap is an opt-in `ExclusionStorage` decorator.

**Recommendation for v1**: manager-level guards in the top-2 hot paths
(`MemoryEngine.addTurn`, `WorkingMemoryManager.add`). Other entry
points (direct `storage.appendEntity`, import paths) get a documented
warning but no automatic enforcement. A follow-up phase adds the
storage decorator if user demand materialises.

### Phases

- **Excl A** — `ExclusionRule` types + `ExclusionManager` +
  `ctx.exclusionManager`
- **Excl B** — wire `exclusionManager.check()` into `MemoryEngine.addTurn`
  and `WorkingMemoryManager.add`; emit
  `memoryEngine:writeBlocked` / `workingMemory:writeBlocked` events
- **Excl C** — docs + roadmap close, plus a CLI command
  (`memory exclude <pattern>` / `memory exclude --list`) for the
  hand-typed-rule use case

### Open questions

- **Audit-log integration** — when a write is blocked, do we log it
  (yes — by design, so the user knows what was filtered) and *where*?
  Recommend: `AuditLog` if `MEMORY_GOVERNANCE_ENABLED=true`; otherwise
  the new event emitter.
- **Regex injection / ReDoS** — `mode: 'regex'` opens an attack surface.
  Compile with a timeout? Disallow regex when the manager runs under
  governance? Recommendation: timeout via `vm.runInNewContext` with a
  hard limit; reject regexes longer than a config'd `maxRegexLength`
  (default 200).

---

## Implementation order

These three types are independent; the user may pick any order. The
recommended sequence — by smallest-incremental-value first:

1. ~~**`do_not_remember`**~~ — ✅ shipped (v2.0.x).
2. ~~**Decision Rationale**~~ — ✅ shipped (v2.0.x).
3. **Project Context** — medium effort, touches `wakeUp` integration.
   Best done after the wakeUp layer surface is otherwise quiet.

Each type is independently ship-able. The recommended pace is one type
per planning + 3 implementation turns.

---

## Out of scope (deferred to Phase 4 if ever needed)

- **Cross-project skill promotion** — catalog explicitly recommends
  "explicit user action only," matching MemoryJS's current state.
- **Per-type decay policy** — incremental; can be added per-manager as
  needed.
- **Per-type retrieval budget config** — current global budget is
  sufficient for v1.
- **`ProjectContextDistillationStage`** auto-extraction from CLAUDE.md —
  defer until v1 lands and the manual-entry friction is measurable.

## Cross-references

- Source motivation: [`MEMORY_TYPES_EXPANSION_PHASE_2.md`](./MEMORY_TYPES_EXPANSION_PHASE_2.md) §4 P3–P4
- Prior plan template: [`HEURISTIC_3B8_PLAN.md`](./HEURISTIC_3B8_PLAN.md)
- Same-shape companion: [`OBSERVATION_DEDUP_PLAN.md`](./OBSERVATION_DEDUP_PLAN.md)
