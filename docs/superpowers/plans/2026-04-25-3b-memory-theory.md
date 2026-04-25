# η.3B — Memory Theory Extensions Plan (§3B.4–3B.7)

> **Status (2026-04-25):** Plan only. No code. Targets Phase η of the dispatch runbook (`docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md`). §3B.1–3B.3 were implemented in Phase δ (`MemoryValidator`, `TrajectoryCompressor`, `ExperienceExtractor`). This plan covers the four remaining subsections.

**Source spec:** `docs/roadmap/ROADMAP.md` § Phase 3B.4–3B.7.

## Goal

Advance MemoryJS from the Reflection stage to the full Experience stage of memory evolution (Luo et al., 2026) by adding four capabilities: explicit procedural memory (skills/how-to sequences), active retrieval that queries the graph before each output, symbolic causal reasoning over a `causes`/`prevents`/`enables` relation layer, and a world-model orchestrator that cross-validates new facts against the agent's current world state.

## Out of scope

- Probabilistic Bayes-net causal inference (noted in §3B.6 risks; needs an external lib and is gated).
- Full simulation engine for world-model prediction (§3B.7 defers planning + action loops to a follow-on plan).
- Procedure code-generation / executable sandboxing (§3B.4 stores procedures as structured data only).
- LLM-summarization for procedure learning (pure symbolic; no LLM provider required).

---

## 3B.4 — Procedural Memory

### What exists today

`FailureDistillation` (`src/agent/FailureDistillation.ts`) extracts lessons from causal chains and promotes them to semantic memory as `lesson`-typed entities. `ExperienceExtractor.synthesizeExperience` (`src/agent/ExperienceExtractor.ts:335`) assigns the `procedure` experience type when a trajectory cluster is action-heavy. Neither persists a first-class, stepwise procedure structure nor provides an API to advance, skip, or replay individual steps.

### Architecture

```
src/agent/procedural/
├── ProcedureManager.ts        — primary API (addProcedure / executeStep / getNextStep / matchProcedure / refineProcedure)
├── ProcedureStore.ts          — thin wrapper over EntityManager; persists Procedure entities (type: 'procedure')
├── StepSequencer.ts           — stateful cursor for in-progress procedure execution
└── index.ts                   — barrel

src/types/procedure.ts         — Procedure / ProcedureStep / ProcedureParameter / ProcedureFeedback interfaces
```

`ManagerContext` gains a `procedureManager` lazy getter (same pattern as `memoryEngine`).

### Key interfaces (from spec)

```typescript
// src/types/procedure.ts
interface ProcedureStep {
  order: number;
  action: string;
  parameters: Record<string, string>;
  fallback?: ProcedureStep;
  timeout?: number;
}

// ProcedureManager public surface
addProcedure(proc: Partial<Procedure>): Promise<Procedure>;
executeStep(procedureId: string, stepOrder: number, params: Record<string, unknown>): Promise<ProcedureStep>;
getNextStep(procedureId: string, currentOrder: number): Promise<ProcedureStep | null>;
matchProcedure(contextDescription: string): Promise<ProcedureMatch[]>;
refineProcedure(procedureId: string, feedback: ProcedureFeedback): Promise<Procedure>;
```

`Procedure` entities are stored as `entityType: 'procedure'` with observations encoding the step list as JSON so they survive with the existing JSONL/SQLite backends. `successRate` and `executionCount` are updated on each `refineProcedure` call.

### Environment variables

| Variable | Default |
|---|---|
| `MEMORY_PROCEDURAL_ENABLED` | `false` |
| `MEMORY_PROCEDURE_MIN_OCCURRENCES` | `3` |
| `MEMORY_PROCEDURE_SUCCESS_THRESHOLD` | `0.6` |

### Integration points

- `ExperienceExtractor.synthesizeExperience` should call `procedureManager.addProcedure` when `type === 'procedure'` (wire in Phase δ follow-on).
- `FailureDistillation.distill` flags procedures whose `successRate` drops below threshold so `ConsolidationPipeline` can archive or mark them stale.

---

## 3B.5 — Active Retrieval

### What exists today

`ContextWindowManager.wakeUp()` (`src/agent/ContextWindowManager.ts`) assembles a 4-layer memory stack (working / episodic / semantic / artifact) on demand and returns it in ~600 tokens. `LLMQueryPlanner` (`src/search/LLMQueryPlanner.ts`) decomposes natural-language queries into a `StructuredQuery`. Neither performs iterative query-rewriting between planning and the final output assembly, nor decides autonomously when retrieval is worth the token cost.

### Architecture

```
src/agent/retrieval/
├── ActiveRetrievalController.ts  — shouldRetrieve / adaptiveRetrieve / learnRetrievalPattern
├── QueryRewriter.ts              — iterative query rewriting (expand → retrieve → evaluate → refine)
└── index.ts

src/types/retrieval.ts            — RetrievalContext / RetrievalDecision / AdaptiveResult / MemoryCategory / TaskType
```

`ManagerContext` gains an `activeRetrieval` lazy getter, behind `MEMORY_ACTIVE_RETRIEVAL_ENABLED=true`.

### Key interfaces (from spec)

```typescript
// ActiveRetrievalController public surface
shouldRetrieve(context: RetrievalContext): Promise<RetrievalDecision>;
selectMemoryTypes(task: TaskType): MemoryCategory[];
estimateRelevance(query: string, memoryType: MemoryCategory): Promise<number>;
adaptiveRetrieve(context: RetrievalContext): Promise<AdaptiveResult>;
learnRetrievalPattern(feedback: RetrievalFeedback): Promise<void>;
```

### Query-rewriting loop

`adaptiveRetrieve` runs up to `maxRounds` (default 3) of:

1. Rewrite current query via `QueryRewriter` (token-overlap expansion against the existing BM25 index — no LLM required).
2. Call `ContextWindowManager.wakeUp({ query: rewrittenQuery })`.
3. Score coverage: if salient memories are still missing (below `minCoverage` threshold), expand and retry.
4. Return the best-coverage `AdaptiveResult`.

This wires directly onto `ctx.contextWindowManager` (already lazy-initialized) and `ctx.rankedSearch`, with no new runtime dependencies.

### Integration points

- `ContextWindowManager.wakeUp` gains an optional `{ query?: string; iterative?: boolean }` parameter; if `iterative: true` it delegates to `activeRetrieval.adaptiveRetrieve` automatically.
- `RetrievalDecision.estimatedCost` is compared against the current `availableTokenBudget` from `ContextWindowManager` to decide whether to retrieve or skip.

### Environment variables

| Variable | Default |
|---|---|
| `MEMORY_ACTIVE_RETRIEVAL_ENABLED` | `false` |
| `MEMORY_RETRIEVAL_COST_THRESHOLD` | `0.3` |
| `MEMORY_RETRIEVAL_MAX_ROUNDS` | `3` |
| `MEMORY_RETRIEVAL_MIN_COVERAGE` | `0.6` |

---

## 3B.6 — Causal Reasoning

### What exists today

`FailureDistillation` already traverses `CAUSES`/`CAUSED_BY` relation strings using `EpisodicRelations` constants (`src/agent/EpisodicMemoryManager.ts`). `GraphTraversal.shortestPath` / `allPaths` (`src/core/GraphTraversal.ts`) provide path-finding over any relation type. Neither offers a dedicated interface for forward-inference (`findEffects`), backward-inference (`findCauses`), or counterfactual reasoning over causal chains.

### Architecture

```
src/agent/causal/
├── CausalReasoner.ts           — findCauses / findEffects / counterfactual / detectCycles
├── CausalRelationValidator.ts  — validateCausation / confirmationCount management
└── index.ts

src/types/causal.ts             — CausalRelation extends Relation / CausalChain / CausalCycle / Evidence
```

`ManagerContext` gains a `causalReasoner` lazy getter, behind `MEMORY_CAUSAL_INFERENCE_ENABLED=false`.

### CausalRelation shape

Extends the existing `Relation` type (no schema migration needed for JSONL; stored in `relationType` plus a `metadata` bag):

```typescript
// src/types/causal.ts
interface CausalRelation extends Relation {
  relationType: 'causes' | 'enables' | 'prevents' | 'precedes' | 'correlates';
  causalStrength: number;   // 0–1
  delay?: number;           // time steps
  probability?: number;     // P(effect | cause)
  observed: boolean;
  confirmationCount: number;
  contradictionCount: number;
  conditions?: string[];
  mechanism?: string;
}
```

### Key interfaces

```typescript
// CausalReasoner public surface
findCauses(effectEntityName: string, maxDepth?: number): Promise<CausalChain[]>;
findEffects(causeEntityName: string, maxDepth?: number): Promise<CausalChain[]>;
counterfactual(scenario: { remove: string; predict: string }): Promise<CausalChain[]>;
detectCycles(): Promise<CausalCycle[]>;
```

`findCauses` and `findEffects` delegate to `GraphTraversal.allPaths` filtered to causal relation types, then score each path by `product(causalStrength)`. `counterfactual` temporarily removes the named causal edge from an in-memory copy of the graph and re-runs `findCauses`, returning the delta.

### Speculative extension (gated, not in this plan)

Probabilistic Bayes-net inference (`learnCausalStructure`) would require a library such as `bayes-net` or `jsbayes`. Deferred until there is concrete pull — noted in ROADMAP for Phase 5.

### Environment variables

| Variable | Default |
|---|---|
| `MEMORY_CAUSAL_INFERENCE_ENABLED` | `false` |
| `MEMORY_CAUSAL_MIN_OBSERVATIONS` | `5` |
| `MEMORY_CAUSAL_MAX_DEPTH` | `6` |

---

## 3B.7 — World Model

### What exists today

No `WorldModel` or `WorldState` type exists in `src/`. The closest primitives are `ContextWindowManager.wakeUp` (snapshot of active memory), `CognitiveLoadAnalyzer.analyze` (structural snapshot of memory health), and `ContradictionDetector` (`src/features/`), which flags semantic conflicts. There is no cross-validation hook that rejects a new entity or observation when it contradicts the current world state.

### Architecture

The world model is an orchestrator — it composes existing services rather than reimplementing them.

```
src/agent/world/
├── WorldModelManager.ts        — getCurrentState / predictOutcome / detectStateChange / updateModel / validateFact
├── WorldStateSnapshot.ts       — lightweight immutable value object; serializable to/from JSON
└── index.ts

src/types/world.ts              — WorldState / WorldStateEntity / EnvironmentRule / PredictionResult / StateChange
```

`ManagerContext` gains a `worldModel` lazy getter, behind `MEMORY_WORLD_MODEL_ENABLED=false`. Most actual reasoning delegates into already-wired managers:

| `WorldModelManager` method | Delegates to |
|---|---|
| `getCurrentState()` | `contextWindowManager.wakeUp()` + compact entity map |
| `validateFact(obs, entity)` | `MemoryValidator.validateConsistency` (Phase δ) |
| `predictOutcome(state, action)` | `causalReasoner.findEffects(action)` |
| `detectStateChange(before, after)` | diff over `WorldStateSnapshot` entity maps |
| `updateModel(feedback)` | `entityManager.updateEntity` + `causalReasoner` weight adjustment |

`WorldStateSnapshot` is stored as a special `entityType: 'world-state'` entity so history is queryable via `temporalSearch`.

### Cross-validation hook

`GovernanceManager` gains an optional `worldModelGuard` policy that calls `worldModel.validateFact` before any `createEntity` or `updateEntity` mutation. Enabled only when both `MEMORY_GOVERNANCE_ENABLED=true` and `MEMORY_WORLD_MODEL_ENABLED=true`.

### Deferred to follow-on plans

- Rule induction (`learnCausalStructure` / `inferRule`) — depends on §3B.6 probabilistic extension.
- Long-horizon state prediction chains — needs a planning loop; separate plan.
- Per-session world-state forking — relevant for multi-agent simulation; out of scope here.

### Environment variables

| Variable | Default |
|---|---|
| `MEMORY_WORLD_MODEL_ENABLED` | `false` |
| `MEMORY_STATE_TRACKING_INTERVAL_MS` | `60000` |
| `MEMORY_WORLD_MODEL_GUARD_ENABLED` | `false` |

---

## Build sequence

- [ ] **Step 1** — Type definitions: create `src/types/procedure.ts`, `src/types/retrieval.ts`, `src/types/causal.ts`, `src/types/world.ts`; re-export from `src/types/index.ts`. Run `npm run typecheck`.
- [ ] **Step 2** — §3B.4 core: `ProcedureStore` → `StepSequencer` → `ProcedureManager`. Unit tests. Wire `procedureManager` lazy getter in `ManagerContext`.
- [ ] **Step 3** — §3B.4 integration: patch `ExperienceExtractor.synthesizeExperience` and `FailureDistillation.distill` cross-links. Integration test.
- [ ] **Step 4** — §3B.5 core: `QueryRewriter` → `ActiveRetrievalController`. Unit tests. Patch `ContextWindowManager.wakeUp` signature. Wire `activeRetrieval` lazy getter.
- [ ] **Step 5** — §3B.6 core: `CausalRelationValidator` → `CausalReasoner`. Unit tests (include cycle detection + counterfactual). Wire `causalReasoner` lazy getter.
- [ ] **Step 6** — §3B.7 core: `WorldStateSnapshot` → `WorldModelManager`. Unit tests. Wire `worldModel` lazy getter. Patch `GovernanceManager` with optional guard.
- [ ] **Step 7** — Integration test `memory-theory-pipeline.test.ts` spanning all four features end-to-end.
- [ ] **Step 8** — Env-var documentation: update `CLAUDE.md` env-var table for all twelve new variables.
- [ ] **Step 9** — CHANGELOG bump; update ROADMAP §3B.4–3B.7 status.

---

## Effort estimate

| Subsection | Impl | Tests | Total |
|---|---|---|---|
| 3B.4 Procedural Memory | 3–4d | 1d | ~5d |
| 3B.5 Active Retrieval | 2–3d | 1d | ~4d |
| 3B.6 Causal Reasoning | 3–4d | 1–2d | ~5d |
| 3B.7 World Model | 2–3d | 1d | ~4d |
| Integration + docs | — | 1–2d | ~2d |
| **Total** | | | **~3 weeks** |

---

## Risks

- **Causal cycle correctness:** A naive DFS `detectCycles` over `causes`/`enables`/`prevents` edges can miss mixed-type cycles. Use a colour-marked DFS that treats `prevents` as a directed edge in the same graph, not a negating arc. Document the limitation clearly.
- **Procedure step storage format:** Storing steps as a JSON observation inside an entity is compact but makes individual step queries awkward. If the graph grows beyond ~10K procedures, consider a dedicated `procedureStep` entity type with parent/child links. Flag as a migration path in the `ProcedureStore` docblock.
- **Active retrieval token explosion:** Each `adaptiveRetrieve` round can double the token spend if `minCoverage` is set too high. Default `maxRounds=3` and `minCoverage=0.6` are conservative; document the knobs prominently.
- **World model guard and governance coupling:** The `worldModelGuard` policy must not run inside `GovernanceManager.withTransaction` recursively (causes a deadlock on the SQLite write-lock). Guard must execute before the transaction opens, not inside it.
- **`better-sqlite3` sync + world model snapshot writes:** `WorldStateSnapshot` triggered on every `MEMORY_STATE_TRACKING_INTERVAL_MS` tick will hold a write lock. Keep snapshots small (entity names + importance, no observations) and consider offloading to the worker pool if interval < 10s.
