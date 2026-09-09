# Procedural Graph Feature Plan

> **Status:** Proposed feature; planning only. No runtime implementation is included.
> **Date:** 2026-09-09
> **Repository baseline:** `danielsimonjr/MemoryJS`, `master` at `549ce11018e5ab2188173ae225c877705d50e453` (`@danielsimonjr/memoryjs` 4.0.0).
> **Source:** Yuxing Lu, Yicheng Chen, Shanchan Wu, and Sercan Ö. Arık, *Procedural Graphs: Self-Evolving Execution Structures for LLM Agents*, supplied 36-page PDF, arXiv:2609.09153v1, 8 September 2026.

## 1. Feature objective and boundaries

Add an explicit, editable **Procedural Graph (PG)** that answers what an agent should do next. Preserve the paper's two distinct phases:

1. **Online inference:** localize the current procedure, retrieve its connected outgoing neighborhood, and generate situational guidance. Freeze the graph throughout an episode; the caller's solver still chooses and executes actions.
2. **Offline self-evolution:** contrast scored training trajectories, propose graph edits, structurally validate a candidate, and retain it only when its measured held-out validation score does not decrease. Keep rejected proposals as negative evidence. [P1-P3]

This is an additive extension of MemoryJS's existing procedural memory, not a replacement. Today, `ProcedureManager` stores ordered procedures, `StepSequencer` advances through steps and fallbacks, and `refineProcedure()` updates an exponentially weighted success rate. Those mechanisms do not implement the paper's connected-neighborhood guidance or validation-gated topology evolution. `invoke()` deliberately resolves and prepares a procedure rather than executing it. Preserve that action-agnostic boundary. [C1-C3]

**Product value:** inspectable next-step advice, explicit transition conditions and pitfalls, reproducible graph revisions, and an auditable learning loop that does not update model weights.

**Not in scope:** a new autonomous agent runtime, hard state-machine enforcement, executing graph text as code, model fine-tuning, replacing factual knowledge-graph search, automatic mutation during a live episode, or silently converting existing procedures. A PG is not a permission system. The host must continue enforcing tool permissions, user authorization, and application constraints.

Throughout this plan, **paper behavior** is referenced as `[P#]`, **inspected repository behavior** as `[C#]`, and new implementation choices are explicitly described as **MemoryJS design**. Proposed APIs and files below do not exist yet.

## 2. Paper-to-feature requirements

| ID | Paper behavior to preserve | Implementation consequence and acceptance test |
|---|---|---|
| PG-01 | Directed attributed graph `G = (V, R, E, Phi)`; procedural triplets, not factual entity triplets. [P1] | Store distinct procedure nodes and directed transitions. Test multiple relation labels between the same endpoints without collapsing them. |
| PG-02 | Edge attributes are `condition`, `guidance`, and `pitfalls`; an unconditional condition may be `null`. [P1, P3] | Typed, validated attributes. Newly added edges require guidance. Preserve nulls, Unicode, multiline text, and empty pitfalls through persistence. |
| PG-03 | Start initialization; exact matching of the latest procedure; outgoing neighborhood with `h = 2`; full-graph fallback when matching fails. [P2] | No similarity search masquerading as localization. Test first step, known action, unknown action, directionality, and hop boundaries. |
| PG-04 | Guidance uses the query and recent trajectory window, with `w = 3` in the experiments; solver integration is soft. [P2] | Return guidance to the caller. Never execute, block, or advance an action merely because an edge exists. |
| PG-05 | Graph is frozen within every training, validation, and test episode. [P2, P3] | Sessions pin immutable revision snapshots. A concurrent accepted revision affects only newly opened sessions. |
| PG-06 | Refiner returns `add_nodes`, `delete_nodes`, `add_edges`, and `delete_edges`. Attribute revisions delete and re-add an edge. [P3] | Parse a strict edit document; apply deletions before additions to a copy. Reject unsupported operations instead of guessing. |
| PG-07 | `delete_edges: [{source, target}]` removes every relation between those endpoints. [P3] | Implement endpoint-pair deletion literally. Preserve selected parallel relations only when explicitly re-added. |
| PG-08 | Structural checks precede evaluation. Every node must reach a zero-outdegree terminal, not necessarily the node named `End`. Cycles follow the configured policy. [P3] | Validate only PG transition edges. Test valid cyclic graphs with exits, closed cycles, dangling references, and terminals with names other than `End`. |
| PG-09 | Initial validation score is cached. Accept candidate mean score `>=` retained mean, including ties. [P3] | Test lower, equal, and higher scores. Invalid candidates perform no validation rollout and leave both retained graph and score unchanged. |
| PG-10 | The next round starts from the last retained graph. Rejections include diagnostic evidence. [P3] | Never seed the next round from a rejected candidate. Persist the reason and reproducible revision/edit references. |
| PG-11 | Refiner context retains the final `Lmax` tokens of concatenated training trajectories, in original order. [P3] | Tail truncation, not prefix truncation. Supply an explicit tokenizer adapter for token-exact reproduction. |
| PG-12 | Train, validation, and test are separate; return the last retained checkpoint rather than selecting by test performance. [P3-P5] | Validate split identities and record the experiment manifest. Test outcomes cannot enter the refiner or promotion decision. |

The paper's reported relation vocabulary is `LEADS_TO`, `TRIGGERS`, `PROVIDES_INPUT_FOR`, and `CONVERGES_TO`. Use this as the initial vocabulary; allow an explicitly declared extension vocabulary rather than accepting arbitrary model-invented relation types. [P3]

## 3. Existing code and integration strategy

| Existing surface | Observed behavior | Planned integration |
|---|---|---|
| `src/types/procedure.ts` | Ordered `ProcedureStep` records with action names, string parameters, optional recursive fallback and timeout. [C1] | Leave unchanged. Add separate PG contracts in `src/types/proceduralGraph.ts`. |
| `src/agent/procedural/ProcedureManager.ts` | Procedure storage, trigger/name matching, independent sequencers, feedback statistics, resolve-and-prepare invocation. [C2] | Keep all existing methods compatible. Offer an explicit one-way procedure-to-PG adapter. |
| `src/agent/procedural/ProcedureStore.ts` | Native `procedure`/`procedure-step` entities; `has_step`, `precedes`, `has_fallback` relations; scalar observations; legacy-load migration. [C3] | Reuse the graph-first representation principle, not its multi-write replacement path for checkpoint publication. |
| `src/agent/procedural/StepSequencer.ts` | In-memory cursor; fallback replaces the current step, then execution resumes at the next main step. [C3] | Preserve behavior. Import these semantics explicitly; do not infer arbitrary workflow branches. |
| `src/types/types.ts` and `src/core/RelationManager.ts` | Relations already support metadata and are identified by `(from, to, relationType)`; relation creation validates endpoints and acquires `graphMutex`. [C4] | Put PG attributes in namespaced relation metadata and scope stored endpoints by graph/revision. No global `Relation` schema expansion is required. |
| `src/search/LLMQueryPlanner.ts` | Existing `LLMProvider.complete(prompt): Promise<string>` abstraction. [C5] | Accept structurally compatible providers; do not assume model options, token usage, or cancellation are available. |
| `src/core/ManagerContext.ts` | Lazy procedural manager composition. [C6] | Add an explicit `ctx.proceduralGraph(config)` factory; retain `ctx.procedureManager` unchanged. |
| `src/core/StorageFactory.ts` | JSONL, SQLite, and PostgreSQL construction; environment can override configured storage type. [C7] | First release: explicit JSONL/SQLite PG backing with validated effective backend. PostgreSQL publication needs its own conformance work. |
| `src/core/TransactionManager.ts` | Staged operations with backup-based rollback and a whole-graph save. [C7] | Do not assume it supplies compare-and-swap or isolation across manager calls. Implement and test a PG publication boundary. |
| Existing barrels and package exports | Procedural module exported through agent; root/agent/types package surfaces have dual ESM/CJS declarations. [C8] | Extend existing barrels and verify built exports. Do not introduce a new package subpath in the first release. |

### Proposed module layout

```text
src/types/proceduralGraph.ts                    # Leaf contracts and result unions
src/agent/procedural/graph/
  ProceduralGraph.ts                            # Snapshot, indexes, localization, traversal
  ProceduralGraphValidator.ts                   # Schema, topology, catalog checks
  ProceduralGraphStore.ts                       # Native graph encoding and publication facade
  backing/                                     # JSONL/SQLite atomic backing adapters
  ProceduralGraphSession.ts                     # Pinned revision and ordered action/observation log
  ProceduralGuidance.ts                         # Serialization and optional generation
  ProceduralGraphRefiner.ts                     # Prompt, edit parsing, candidate preparation
  ProceduralGraphEvolution.ts                   # Rollout, gate, rejection history, resume
  ProceduralGraphManager.ts                     # Public orchestration facade
  ProcedureGraphAdapter.ts                      # Explicit legacy procedure import
  prompts.ts
  index.ts
```

Keep pure graph operations independent of storage and providers. Put completion, tokenizer, rollout, evaluation, and backing contracts in the leaf type module so `src/types/` never imports `agent`, `core`, or `search`, including type-only imports. Use `.js` import specifiers and the current lint/build tooling. Prefer existing utilities and native collections over adding a graph framework dependency. [C8]

## 4. Representation and storage

### 4.1 Proposed contracts

The node-kind names beyond `ACTION`, revision identifiers, catalog hashes, and lifecycle fields are **MemoryJS design**, not a claim that the paper specifies these API names.

```typescript
export type PGRelation =
  | 'LEADS_TO' | 'TRIGGERS'
  | 'PROVIDES_INPUT_FOR' | 'CONVERGES_TO';

export type PGNode = { id: string; description: string } & (
  | { type: 'ACTION'; actionName: string }
  | { type: 'SKILL' | 'REASONING' | 'STATE' }
);

export interface PGEdge {
  source: string;
  relation: string; // Must belong to the graph's declared vocabulary.
  target: string;
  condition: string | null;
  guidance: string;
  pitfalls: string;
}

export interface PGSnapshot {
  schemaVersion: 1;
  graphId: string;
  revisionId: string;
  parentRevisionId?: string;
  entryNodeId: string;
  relationVocabulary: readonly string[];
  cyclePolicy: 'allow' | 'repair' | 'reject';
  toolCatalogHash: string;
  nodes: readonly PGNode[];
  edges: readonly PGEdge[];
}
```

Use graph-local node IDs, not entity display names, as localization identities. Paper-shaped action nodes can normalize `actionName` to their exact tool-name ID. Imported procedures may need distinct node IDs for repeated uses of one action; `actionName` is an explicit compatibility extension.

Store immutable snapshots and return defensive copies or deeply frozen views. TypeScript `readonly` alone is insufficient because callers can still mutate nested values at runtime. Validate nonempty IDs, duplicate node/triplet keys, allowed types, attribute lengths, graph-size limits, and finite numeric configuration at ingress. Use unambiguous encoded tuples for keys rather than delimiter concatenation on unrestricted input.

### 4.2 Native graph backing, isolated by default

**MemoryJS design:** use an explicitly configured, separate procedural backing file/database built on the existing storage backends. This keeps candidate graphs, historic revisions, and failure logs out of ordinary factual search, summarization, decay, and consolidation. Do not automatically mirror them into the main memory graph.

Represent graph headers, revisions, and nodes as native entities, for example `procedural-graph`, `procedural-graph-revision`, and `procedural-graph-node`. Store small scalar fields as round-trippable observation records, following the existing decomposed procedure precedent. Store actual transitions as native relations, with attributes under `metadata.proceduralGraph`. Do not flatten the entire procedural graph into one opaque observation. [C3-C4]

Storage endpoint names must encode graph ID, revision ID, and local node ID. Keep bookkeeping links such as revision membership separate from the transition vocabulary. Terminal detection and neighborhood traversal must ignore bookkeeping links. Maintain an explicit retained-head record containing the revision, cached validation report reference, evaluation fingerprint, and monotonically increasing publication version.

The separate backing is an isolation boundary, not authentication. Authorize graph access and writes through explicit host policy hooks. Copying a graph across projects requires explicit authorization. A retained-graph projection into the primary knowledge graph can be a later, opt-in feature; it must not expose rejected candidates as trusted memory.

### 4.3 Atomic publication and recovery

Define a new narrow backing capability, conceptually:

```text
commitRetainedRevision(expectedHeadVersion, preparedRevision, validationReport)
  -> committed(newHead) | conflict(currentHead)
```

This is **new work**, not an existing `IGraphStorage` guarantee. The durable boundary must publish a complete revision, its report, and the head together. Reject a stale head rather than overwriting another accepted revision. Provider calls and evaluation must happen outside storage locks.

For JSONL, implement a locked read/check/write using the backend's atomic file-publication mechanism. First-release JSONL is single-writer per backing file; do not claim an in-process mutex provides multi-process isolation. For SQLite, perform the expected-head check and revision/head writes in one database transaction; the backing adapter may require a focused core extension. Existing manager methods acquire locks independently, so calling them while holding the same non-reentrant lock is not a valid transaction strategy. [C4, C7]

Require fault-injection tests for failure before publication, partial staging, head conflict, restart, and rollback. Incomplete staged revisions must never become readable as retained. An operational rollback selects a previously published immutable revision and invalidates or restores its matching evaluation cache; it does not rewrite a running session's snapshot. Unsupported backends must fail explicitly for durable evolution rather than falling back to unsafe writes.

## 5. Online guidance lifecycle

### 5.1 Session contract

`openSession()` binds graph ID, retained revision, task/query, tool-catalog fingerprint, provider configuration, and a new run ID. Record ordered, completed action/observation steps and outcome metadata. Private model chain-of-thought is not required. Externally reported reasoning/status steps can be recorded as explicit procedure events.

At each decision:

1. **Locate.** Before the first action, use `entryNodeId` (`Start` for the paper skeleton). Thereafter match an explicit procedure ID exactly, or an exact tool action name with a unique binding. Ambiguous imported action bindings are unmatched; never silently choose one or call `matchProcedure()` to approximate the current node.
2. **Extract.** Traverse outgoing edges for at most `h = 2` transitions, preserving connecting edges, attributes, and hop grouping. Deduplicate visited edges and bound traversal even when cycles are allowed. Do not include incoming edges simply because a generic graph traversal supports them.
3. **Fallback.** If localization fails, the paper path uses the complete selected PG, not the complete MemoryJS knowledge graph. A matched sink is not a localization failure.
4. **Generate.** Combine task description, query, graph context, and the last `w = 3` completed trajectory steps. Generate immediate next-step advice, pitfalls, and recovery guidance. Return text and diagnostics to the host for prompt insertion.
5. **Observe.** The host solver independently chooses and executes its action; the host records the resulting observation. Repeat without editing the pinned graph. [P2]

The result should include `revisionId`, matched node or fallback reason, selected edge keys, hop count, guidance mode, and budget/latency diagnostics. Do not let a guide recommendation mutate the session's current procedure before the action actually occurs.

### 5.2 Provider and budget behavior

Support `generative`, `attributes-only`, and `disabled` guidance modes. Only `generative` implements the paper's guidance model. Without a provider, return clearly labeled serialized attributes, not a fabricated model-generated recommendation. Explicit provider errors may degrade to attributes-only when configured; surface the error and mode change.

Reuse the shape of `LLMProvider.complete(prompt)` without importing the search module into leaf types. Optional adapters may provide token usage, model identity, and abort support. The existing provider interface guarantees none of these. A timeout can discard late output but cannot necessarily stop an in-flight billable request. Do not report estimates as provider-measured token usage. [C5]

Apply limits to graph size, serialized context, observations, output, and calls per session. If a full graph or connected neighborhood does not fit, return an explicit `context-budget-exceeded` result with a configured disabled-guidance fallback; never label a silently truncated graph as full-graph retrieval. The paper does not prescribe these production limits. Record them in experiment manifests.

Serialize direction, hop grouping, and all relevant edge fields. **Intentional extension:** include relation labels in MemoryJS context; the paper's example local serializer omits them despite storing them. Keep a paper-compatible serializer option for controlled reproduction. [P3]

Treat graph attributes, tool results, and trajectory text as untrusted data blocks. Guidance is subordinate to the host's instructions and authorization checks. Paths, commands, or tool arguments inside graph text are advice, never executable code.

## 6. Offline self-evolution

### 6.1 Caller-owned execution and evaluation

Require explicit `rollout`, `evaluate`, and `refiner` dependencies plus a round/cost budget. MemoryJS orchestrates callbacks; it does not supply a solver or autonomously invoke production tools. Training and validation callbacks must run in caller-provided resettable, sandboxed environments. Starting a session or recording feedback must never start evolution implicitly.

A diagnostic rollout returns task ID, split ID, pinned graph revision, ordered steps, and a finite task score in `[0, 1]`. Keep high- and low-scoring evidence identifiable; binary scores naturally produce success/failure groups. When one group is absent, report that limitation instead of inventing a contrast. Prepare the refiner context from the ordered concatenation of training traces, retaining its token tail as specified by the paper. [P3]

Maintain a manifest with task/split fingerprints, evaluator/metric version, solver and guidance configuration, tool-catalog hash, prompt versions, decoding configuration, seeds, budget settings, and graph digest. Cache validation scores only for that complete evaluation identity. A changed evaluator, split, solver, or guidance configuration requires a fresh baseline.

### 6.2 Edit preparation and structural validation

The refiner outputs the paper's four-array JSON document. Parse with existing Zod infrastructure and reject prose, malformed JSON, unknown fields, oversized edits, and invalid references. Apply edits to a detached copy in this order: delete endpoint-pair edges, delete nodes and incident edges, add nodes, add edges. Store the raw proposal separately from the normalized edit set and any repair operations. [P3]

Preserve existing node identities unless an explicit deletion removes them; do not rename them heuristically. Detect conflicting additions and references to deleted nodes. Attribute changes use delete/re-add; endpoint-pair deletions can remove multiple relation types.

Cycle behavior is explicit:

- `allow`: permit cycles but still require a path from every node to some zero-outdegree terminal.
- `repair`: reproduce the paper's repair category by removing detected cycle-closing edges before structural validation. MemoryJS must define deterministic ordering and record each removed edge; the paper does not specify that ordering.
- `reject`: recommended MemoryJS default; reject cyclic candidates rather than silently altering a proposed safety-relevant transition. This is a product extension, not the paper's repair behavior.

Require the entry node to exist. Compute terminal reachability by reverse traversal from PG sinks. Do not require every node to reach a specifically named `End`. Optional warnings may identify nodes unreachable from the entry, but must be distinguished from the paper's stated terminal check.

**Intentional hardening:** independently validate ACTION bindings against the caller's allowed tool catalog, and validate declared skill bindings. The paper requires ACTION membership in the refiner prompt but its generic structural validator does not enforce membership. Unknown actions must not reach validation execution in the product. [P3]

### 6.3 Retained-checkpoint algorithm

```text
retained = load selected graph
baseline = evaluate(retained, validationSet)  # once for this evaluation identity
rejections = load this evolution run's rejection history

for each training batch, up to the explicit round/cost budget:
    traces = rollout(retained, trainingBatch)  # pinned within each episode
    context = tokenTail(concatenate(traces), Lmax)
    edits = refine(retained, context, traceScores, serialize(rejections))
    candidate, diagnostics = prepareCopy(retained, edits, cyclePolicy)

    if preparation failed:
        record rejection(edits, traces, diagnostics, candidate when available)
        continue  # no validation call; retained and baseline are unchanged

    report = evaluate(candidate, validationSet)
    if report is incomplete or invalid:
        record evaluation error; retain the old graph and score
    else if report.meanScore >= baseline.meanScore:
        atomically publish(candidate, report, expectedHeadVersion)
        retained, baseline = candidate, report  # only after successful publication
    else:
        record rejection(candidate, edits, traces, report)

return retained
```

Equality is acceptance, not rejection. Do not quietly add a strict-improvement threshold, a secondary tie-breaker, or an epsilon rule to the paper-compatible gate. Optional stricter production gates must have separate names and reported configuration. No-op identical candidates may reuse an identical evaluation result, but their history must remain distinguishable from a newly evaluated improvement. [P3]

Never average only the successful validation callbacks. Missing scores, invalid values, evaluator exceptions, and timeouts must produce a documented evaluation error or an explicit task failure under the evaluator contract. They cannot silently change the denominator. No promotion occurs on incomplete evaluation, failed publication, stale-head conflict, or canceled work. After conflict, reload and rebase/revalidate in a new round; do not attach a stale candidate to the new head.

### 6.4 Rejection memory and construction modes

Persist candidate revision/digest when available, proposed edits, training-trace references, structural/parse diagnostics or complete validation outcome, retained reference score, and manifest identity. Feed rejected graphs and their failure evidence into subsequent refinement. Structural failures belong in rejection history even though no candidate validation score exists. Bound the refiner's rejection-context window and disclose omissions; data-retention/redaction policies are explicit MemoryJS additions. [P3]

Ship these modes first: fixed expert graph (paper Mode 1), expert-seeded gated incremental evolution (`static_incremental`, Mode 3), and skeleton-seeded gated incremental evolution (`scratch_incremental`, Mode 5). The scratch skeleton is `Start -> End` with no intermediate procedures. [P4]

Paper Modes 2 and 4 (`static_onetime`, `scratch_onetime`) directly commit a one-time update **without a validation gate**. Do not describe them as safe gated evolution. First release may expose one-time candidate preparation for research, but automatic production promotion still requires validation. That is an intentional deviation from those two experimental modes.

Appendix D's term "online evolution" means updates **between training batches**, not within an episode. Algorithm 1 is the implementation authority for retained state. Appendix E.2's Round 5 discussion carries forward a prior candidate's reported metrics; do not copy that reporting convention into the cached retained-score state machine. [P3-P5]

## 7. Public API and compatibility

**Proposed surface:** `ctx.proceduralGraph(config)` explicitly constructs a manager with a separate backing and optional host policy hooks. It does not replace a previously returned manager when a new configuration is supplied. Define ownership/disposal of context-created backings; caller-supplied backings remain caller-owned.

| Proposed method | Contract |
|---|---|
| `createGraph(input)` | Import an explicitly approved expert graph or minimal skeleton; validate before persistence. No model calls. |
| `getGraph(graphId, revisionId?)` | Read retained or explicitly requested immutable revision. |
| `openSession(graphId, options)` | Pin a revision and create an isolated trajectory recorder. |
| `session.getGuidance()` | Locate/extract/generate or return a labeled degradation result. |
| `session.recordStep(step)` | Append a completed host action/observation in order; no graph mutation. |
| `prepareCandidate(graphId, edits)` | Pure candidate preparation plus diagnostics; no publication. |
| `evolve(graphId, options)` | Explicit bounded offline evolution with caller callbacks and manifest. |
| `listRevisions()` / `listRejections()` | Authorized, paginated inspection; no raw sensitive trace bodies by default. |
| `rollback(graphId, revisionId, expectedHeadVersion)` | Audited pointer change for future sessions; existing sessions remain pinned. |
| `exportGraph()` / `importGraph()` | Versioned canonical JSON with validated metadata and integrity checks. |

The first integration example should show a host-owned solver loop that requests guidance, injects it as advisory context, executes exactly the solver-selected action through the host's permission layer, and records the observation. It must not imply that `StepSequencer` is the new graph solver.

The `ProcedureGraphAdapter` is explicit and one-way initially. Convert each original step into a distinct node, preserve parameters/timeouts as non-executable compatibility metadata, connect sequential success transitions, and represent failure/fallback transitions with textual conditions. Match `StepSequencer`'s nested fallback and resume behavior. Repeated action names must not collapse nodes; ambiguous localization requires an explicit step/procedure ID or the full-graph fallback. Return conversion warnings where the ordered executor's semantics cannot be represented faithfully. Never call an approximate reverse conversion lossless. [C1-C3]

No automatic rewrite of existing `procedure` or `procedure-step` entities. Existing `addProcedure`, `invoke`, `matchProcedure`, `refineProcedure`, and `openSequencer` continue to behave as before. Native backup/restore and canonical PG JSON export must preserve attributes, head/report linkage, and schema version. Unsupported export formats should reject or explicitly warn about lost procedural metadata rather than silently stripping it.

## 8. Delivery phases and acceptance gates

All work is proposed. Implement in dependency order, with separate reviewable changes rather than one large feature commit. Phase numbers are delivery stages, not promised calendar estimates.

### Phase 1 - Contracts and deterministic graph core

**Files:** new leaf types, `ProceduralGraph.ts`, `ProceduralGraphValidator.ts`; unit tests under `tests/unit/agent/proceduralGraph/`.

- [ ] Define snapshot/edit/result schemas, explicit vocabulary and cycle policies.
- [ ] Implement exact localization, immutable snapshots, outgoing bounded traversal, deterministic serialization and candidate preparation.
- [ ] Add paper-example fixtures plus synthetic parallel-edge and cyclic cases.

**Exit:** PG-01 through PG-03 and PG-06 through PG-08 pass without any provider or storage. Mutation attempts do not alter snapshots. Unknown tools and malformed edits fail closed. Every repair is reproducible and inspectable.

### Phase 2 - Persistence, publication, and compatibility

**Files:** `ProceduralGraphStore.ts`, backing adapters, `ProcedureGraphAdapter.ts`; narrowly scoped storage changes only where needed; integration tests.

- [ ] Implement native entity/relation encoding, separate backing, schema-version handling and canonical JSON round-trip.
- [ ] Implement atomic expected-head publication and revision/report recovery.
- [ ] Add explicit procedure conversion and preserve existing procedural tests.
- [ ] Verify effective backend selection; prevent an environment override from silently selecting an unsupported PG writer.

**Exit:** JSONL and SQLite pass the same storage contract suite. Concurrent stale publication is rejected. Injected failures expose either the prior complete revision or the new complete revision, never a partial one. Existing `tests/unit/agent/ProcedureStore.test.ts` and the surrounding procedural suite remain unchanged in behavior. PostgreSQL support is explicitly unsupported for publication until equivalent tests pass. [C7-C8]

### Phase 3 - Frozen sessions and guidance

**Files:** `ProceduralGraphSession.ts`, `ProceduralGuidance.ts`, `prompts.ts`; provider-fake unit and integration tests.

- [ ] Implement session pinning, recent completed-step window, localized/full-graph context, and advisory outputs.
- [ ] Add compatible completion-provider adapters and explicit no-provider/error modes.
- [ ] Implement context, latency, call-count, and output limits; mark measured versus estimated tokens.
- [ ] Add prompt-injection and unknown/ambiguous-action fixtures.

**Exit:** PG-04 and PG-05 pass. Publishing a new graph during a session cannot change that session's guidance input. Provider absence requires no network access. Terminal handling does not execute or prematurely stop the host. Budget degradation is explicit.

### Phase 4 - Refiner and offline evolution

**Files:** `ProceduralGraphRefiner.ts`, `ProceduralGraphEvolution.ts`; rejection storage and fake-runner integration tests.

- [ ] Implement strict four-array edit parsing and tokenizer-tail context preparation.
- [ ] Implement manifest-bound baseline evaluation, sequential retained checkpoints, rejection memory, and resumable round records.
- [ ] Add fixed, expert-incremental, and scratch-incremental modes.
- [ ] Add cancellation, evaluator failure, publication conflict, and budget-exhaustion paths.

**Exit:** PG-09 through PG-12 pass. An equal-score candidate is accepted; a lower-score candidate is rejected; a structurally invalid candidate never calls validation. Restart after a rejection resumes the retained graph and matching baseline. Test-split labels and outcomes cannot be consumed by refinement.

### Phase 5 - Facade, packaging, security, and documentation

**Files:** `ProceduralGraphManager.ts`, `src/core/ManagerContext.ts`, procedural/agent/root/type barrels, README and a new usage guide; package-export tests.

- [ ] Add the explicit factory and lifecycle management without altering existing procedure APIs.
- [ ] Enforce host policy hooks, safe import limits, redaction and authorized inspection.
- [ ] Keep full trajectory/candidate bodies out of default diagnostics and the main memory search store.
- [ ] Add an end-to-end host-solver example, migration boundaries, reproduction notes and operational rollback guide.

**Exit:** Root and agent runtime imports plus type imports work in built ESM and CJS consumers. Disabled/unconstructed PG adds no model calls or scheduler work. Existing tests and security policy behavior remain compatible.

### Phase 6 - Evaluation and experimental release

**Files:** new opt-in PG benchmark runner/fixtures, performance tests, evaluation report documentation.

- [ ] Run the controlled comparisons in Section 9 on declared splits and budgets.
- [ ] Publish complete quality/cost metrics, failed cases, graph hashes and acceptance history.
- [ ] Select the last retained graph before final test evaluation; never choose a checkpoint using test results.
- [ ] Release as opt-in/experimental; review workload-specific benefit and overhead before considering default use.

**Exit:** Correctness, isolation, recovery, and compatibility gates pass. The report makes no claim that the paper's numerical gains have been reproduced unless the experiment actually supports it. Rollback and disable paths are exercised.

## 9. Test and evaluation matrix

### Deterministic correctness and robustness

Cover empty/missing entry nodes; duplicate IDs/triplets; null conditions; multiline attributes; relation-preserving round-trips; endpoint-pair deletion across several relation types; deleted-node incident edges; bounded loops; terminal reachability; deterministic cycle repair; catalog mismatch; repeated action bindings; session revision pinning; Unicode and malformed imports; provider timeouts and late responses; and token-tail preservation.

Evolution fixtures must assert both the returned graph **and the cached score** after each round. Include score equality, a worsening candidate following an improvement, structural rejection after a scored rejection, evaluator exceptions, NaN/out-of-range scores, cancellation, restart, competing writers, and evaluation-fingerprint changes. A structural rejection has no new validation result; it must not inherit a rejected candidate's score.

Use paper-inspired behavioral fixtures without treating the paper's examples as general guarantees: a quote-only request must not turn into a booking, and retained dialogue constraints must guide answering the user's request rather than answering an evaluator's meta-question. These cases come from Appendix F, page 36. [P5]

### Controlled agent comparison

Replicate the paper's four-way guidance comparison on the same graph, solver, tasks, tools, prompts, and decoding settings: no PG; raw full-graph injection; full-graph generative guidance; localized generative guidance. Compare fixed expert, expert-incremental, and scratch-incremental construction separately so initialization and inference method are not confounded. [P4, P6]

Report task success/mean rubric score, invalid tool calls, repeated unproductive actions, solver steps, guidance/refiner/solver tokens separately, end-to-end latency, call counts, localization misses, fallback/degradation rate, graph size, structural rejection rate, acceptance rate, and total evolution cost. Include per-task outcomes and paired uncertainty estimates for model-based studies. Set workload-specific latency/token ceilings before running the experiment, not after seeing results.

The default evolution gate guarantees only nondecreasing **measured validation mean** under the chosen evaluator. It does not prove generalization, statistical significance, or production safety. Small validation sets, nondeterministic APIs, and repeated validation selection can mislead. Keep a final untouched test set and record every candidate considered. [P5]

The paper explicitly observes extra token cost even when solver trajectories shorten. Do not promise lower total cost merely because localization reduces graph context or tool calls. [P6]

### Repository verification commands

Use the scripts in the inspected `package.json`, not older documentation that still mentions ESLint:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun run test:ci
bun run test:coverage
```

Run targeted new PG unit/integration suites during each phase. Run existing opt-in performance commands separately from deterministic CI; real-model evaluations must also be explicitly enabled and budgeted. `bun run build` includes declaration generation and export checks. These are implementation acceptance commands, **not a claim that they were run for this planning-only change**. [C8]

## 10. Decisions, risks, and release checklist

**Recommended decisions:** additive module; explicit factory; separate native-graph backing; JSONL/SQLite first; no new graph dependency; provider-neutral callbacks; exact localization with `h=2`, `w=3`; explicit cycle policy with product default `reject`; immutable run revisions; validation-gated automatic promotion; experimental opt-in release.

Before implementation approval, the storage maintainer must confirm the narrow atomic backing extension and supported writer concurrency. The agent integration owner must supply a resettable runner, evaluator, split manifest, tool bindings, and workload budgets. The security owner must approve trace retention, redaction, and external-provider data handling. The paper does not supply MemoryJS-specific answers to those questions.

Primary risks are incomplete atomic publication, accidental exposure of rejected instructions, model-generated unknown tools, prompt injection through observations, ambiguous action localization, token/cost inflation, and validation overfitting. The required mitigations are explicit backing isolation, catalog checks, untrusted-data treatment, immutable sessions, bounded execution, and independent evaluation. None replaces the host's authorization layer.

### Definition of done

- [ ] All twelve paper-derived requirements have passing tests and traceable implementation coverage.
- [ ] Existing procedural APIs, stored procedures, and caller-owned execution semantics remain compatible.
- [ ] Durable graph publication and recovery pass JSONL/SQLite fault-injection and conflict tests.
- [ ] Generative, attributes-only, disabled, and budget-degraded modes are distinguishable to callers.
- [ ] Training, validation, and test data are isolated; rejection and acceptance history is reproducible.
- [ ] Public exports, documentation, examples, permissions, lifecycle cleanup, and rollback are verified.
- [ ] An evaluation report states actual quality/cost outcomes and limitations; no paper result is presented as a MemoryJS measurement.

## 11. Sources and traceability

### Supplied paper

All page numbers below refer to the supplied PDF. The paper was used as the requested design source; this plan is not an independent verification of its benchmark claims.

- **P1:** Section 3.1, pp. 3-4: formal graph representation and edge attributes.
- **P2:** Section 3.2 and Figure 2, pp. 4-5; configuration in Section 4, p. 6: exact localization, directed neighborhood, full-graph fallback, recent trajectory window and soft guidance.
- **P3:** Section 3.3, pp. 5-6; Appendices B.4-B.6, pp. 21-24: relation vocabulary, prompts, edit semantics, rejection memory, Algorithm 1 and structural checks.
- **P4:** Section 5.3, p. 9; Appendix D.2, pp. 30-31: five graph-construction modes and the meaning of between-batch evolution.
- **P5:** Section 5.4, pp. 9-10; Appendix E.2, p. 33; Appendix F, p. 36: retained-versus-test-selected checkpoints, screening caveats, and behavioral examples.
- **P6:** Section 5.5 and Table 3, p. 10; conclusion, p. 11: localized versus full-graph guidance and quality/cost tradeoffs.

### Inspected repository sources

Links resolve to the source files accompanying this plan's baseline; the exact inspected commit is recorded at the top.

- **C1:** [Procedure types](../src/types/procedure.ts).
- **C2:** [ProcedureManager](../src/agent/procedural/ProcedureManager.ts).
- **C3:** [ProcedureStore](../src/agent/procedural/ProcedureStore.ts) and [StepSequencer](../src/agent/procedural/StepSequencer.ts).
- **C4:** [Entity/relation/storage types](../src/types/types.ts) and [RelationManager](../src/core/RelationManager.ts).
- **C5:** [LLMQueryPlanner and LLMProvider](../src/search/LLMQueryPlanner.ts).
- **C6:** [ManagerContext](../src/core/ManagerContext.ts).
- **C7:** [StorageFactory](../src/core/StorageFactory.ts) and [TransactionManager](../src/core/TransactionManager.ts).
- **C8:** [Package scripts and exports](../package.json), [procedural barrel](../src/agent/procedural/index.ts), [agent barrel](../src/agent/index.ts), [existing procedure storage tests](../tests/unit/agent/ProcedureStore.test.ts), and [latest baseline tooling change](https://github.com/danielsimonjr/MemoryJS/commit/549ce11018e5ab2188173ae225c877705d50e453).

Documentation conventions were also checked against [the existing opt-in feature plan](superpowers/plans/2026-04-25-eta-ml-features.md). Where prose documentation and active scripts differ, this plan follows the inspected implementation and `package.json`.
