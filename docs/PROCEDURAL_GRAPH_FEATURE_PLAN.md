# Procedural Graph Feature Plan

> **Status:** Audited implementation plan; no runtime implementation is included.
> **Audit date:** 2026-09-09
> **Audited repository baseline:** `danielsimonjr/MemoryJS`, `master` at `d07b205662fce96ba699571562ea78ce87f8e923` (`@danielsimonjr/memoryjs` 4.0.0).
> **Code baseline note:** `d07b205...` is the documentation merge that contains this plan; its parent `549ce11018e5ab2188173ae225c877705d50e453` is the unchanged source-code baseline used for the original code inspection.
> **Source:** Yuxing Lu, Yicheng Chen, Shanchan Wu, and Sercan O. Arik, *Procedural Graphs: Self-Evolving Execution Structures for LLM Agents*, supplied 36-page PDF, arXiv:2609.09153v1, 8 September 2026.

## 1. Feature objective and design boundary

Add an explicit, editable **Procedural Graph (PG)** that answers what an agent should do next while preserving the paper's separation between:

1. **Online inference:** localize the current procedure, retrieve a connected outgoing neighborhood, and generate situational guidance from that graph context plus the recent trajectory. The graph is frozen for the episode and guidance biases rather than dictates the solver's action.
2. **Offline self-evolution:** run training trajectories against the retained graph, propose graph edits, structurally validate a detached candidate, evaluate valid candidates on a held-out validation split, and retain only candidates whose measured validation mean does not decrease. Rejected candidates become negative evidence for later refinement.

This is an additive extension of MemoryJS's existing procedural memory. `ProcedureManager`, `ProcedureStore`, and `StepSequencer` remain supported and unchanged in semantics. A PG is not a new autonomous agent runtime, permission system, or replacement for the factual knowledge graph. MemoryJS remains action-agnostic: the host solver owns action selection and execution, and the host authorization layer remains authoritative.

The plan distinguishes three categories throughout:

- **Paper requirement (`[P#]`)** - behavior directly supported by the supplied paper.
- **Repository fact (`[C#]`)** - behavior verified against the audited MemoryJS source tree.
- **MemoryJS design** - a production hardening or integration choice introduced by this plan, not attributed to the paper.

## 2. Paper fidelity requirements

The implementation must satisfy the following requirements before it can be called a paper-faithful PG implementation.

| ID | Requirement | Acceptance consequence |
|---|---|---|
| PG-01 | Represent procedural knowledge as a directed attributed graph `G = (V, R, E, Phi)`, where an edge is `(source, relation, target)`. Nodes may abstract tool functions, skills, reasoning steps, or task status. [P1] | Preserve node identity, direction, relation type, and edge attributes. Parallel edges with different relation labels must not collapse. |
| PG-02 | The paper's implemented edge attribute schema is `condition`, `guidance`, and `pitfalls`. `condition` may be `null`; newly proposed edges must supply guidance and pitfalls. [P1, P3] | Strict edit validation. Preserve nulls, Unicode, multiline text, and all three fields through persistence/export. Do not silently invent missing fields. |
| PG-03 | First-step localization uses `Start`; later localization exactly matches the most recent procedure/action. The default paper configuration extracts the outgoing `h = 2` neighborhood and falls back to the complete selected PG when matching fails. [P2] | Exact match only in paper-compatible mode. No similarity search may masquerade as localization. A matched terminal is not a localization miss. |
| PG-04 | Guidance combines graph context, query/task context, and the recent trajectory; the paper experiments use `w = 3`. Guidance is appended to solver context and remains soft rather than execution-enforcing. [P2] | Return advisory output; never execute, advance, block, or authorize an action solely because the graph recommends it. |
| PG-05 | The graph remains fixed within each training, validation, or test episode. [P2, P3] | Sessions pin an immutable revision. A newly accepted revision affects only subsequently opened sessions. |
| PG-06 | Refinement uses four arrays: `add_nodes`, `delete_nodes`, `add_edges`, and `delete_edges`. Attribute changes are expressed by deleting and re-adding an edge. [P3] | Parse exact edit operations and apply them to a detached copy. Unsupported operations are rejected. |
| PG-07 | A `delete_edges` item contains only `source` and `target` and removes all edges between those endpoints regardless of relation; selected transitions can be re-added afterward. Candidate preparation applies deletions before additions. [P3] | Endpoint-pair deletion tests must cover multiple relation types. Re-add order must be deterministic. |
| PG-08 | Structural checks occur before validation rollout. Every edge endpoint must exist and every node must have a directed path to a zero-outdegree terminal; the terminal need not be named `End`. [P3] | Invalid candidates never call the validation evaluator. Reachability is computed over PG transition edges only. |
| PG-09 | The paper's cycle policy is effectively **allow cycles** or **disallow cycles with cycle-closing-edge repair**. When cycles are allowed, repair and the acyclicity check are skipped. [P3] | Paper-compatible modes reproduce these two behaviors. A separate MemoryJS `reject` policy may exist but must be labeled as an extension. |
| PG-10 | In the refiner prompt, every `ACTION` node must match an available action/tool name. In static refinement modes, existing node IDs must be preserved. [P3] | MemoryJS additionally enforces tool-catalog membership structurally before execution; static-mode renames are rejected. |
| PG-11 | Refiner guidance should remain general and avoid overfitting/leaking trajectory-specific details. [P3] | Include the paper's generality/leak-prevention instruction in the refiner prompt and add regression fixtures for copied task-specific literals. |
| PG-12 | The initial validation score is cached. A valid candidate is accepted when `candidateMean >= retainedMean`, including equality. [P3] | Test lower, equal, and higher scores. Paper-compatible mode cannot silently add epsilon, strict-improvement, or secondary tie-break rules. |
| PG-13 | Each round starts from the last retained graph, never from a rejected candidate. Rejection history includes unsuccessful proposals and diagnostic evidence. [P3] | Persist retained/rejected identity separately. Restart after rejection must resume from the retained checkpoint and matching cached score. |
| PG-14 | Refiner trajectory context retains the final `Lmax` tokens of concatenated training trajectories, dropping excess tokens from the beginning while preserving final-token order. [P3] | Use a supplied tokenizer for token-exact reproduction. Parallel rollout results must be concatenated in deterministic batch/task order, not completion order. |
| PG-15 | Training, validation, and test data remain separate. Promotion depends on validation, and the final test must evaluate the last retained checkpoint rather than selecting the best observed test round. [P3, P5] | Test labels/outcomes cannot enter refinement or promotion. Record split fingerprints in the experiment manifest. |
| PG-16 | Construction strategies differ materially: Modes 1/2/4 are fixed or one-time alternatives; Modes 3/5 perform incremental between-batch evolution with validation gating. Modes 2/4 directly commit their one-time update without a validation safeguard in the paper. [P4] | Do not mislabel one-time ungated modes as safe gated evolution. Production auto-promotion stays gated unless a research-only paper-reproduction mode is explicitly requested. |

The paper reports the initial relation vocabulary `LEADS_TO`, `TRIGGERS`, `PROVIDES_INPUT_FOR`, and `CONVERGES_TO`. Use those as the built-in vocabulary for paper-compatible graphs. An explicitly declared extension vocabulary is allowed, but model-invented relation labels are rejected unless present in that graph's declared vocabulary. [P3]

The paper's `h = 2` and `w = 3` are experiment settings, not universal mathematical constraints. MemoryJS may expose bounded configuration, but `paperCompatible: true` fixes those defaults unless the caller deliberately overrides them and records the deviation.

## 3. Audit findings and corrections

A second-pass audit found concrete implementation issues that the first plan did not fully account for. This revision corrects them before implementation begins.

### A1 - Relation metadata is supported by the TypeScript type but rejected by current relation creation schemas

`Relation` supports arbitrary `metadata`, and SQLite persistence already serializes/deserializes it. However, `RelationManager.createRelations()` validates through `BatchCreateRelationsSchema`, whose strict `CreateRelationSchema` currently does **not** admit `metadata`; the strict `RelationSchema` also omits the newer relation metadata fields. Therefore the earlier statement that PG attributes could be written under `metadata.proceduralGraph` with "no schema expansion required" was incorrect. [C4]

**Correction:** Phase 2 must update and test the relevant runtime schemas before PG relations are written through `RelationManager`. The preferred stored shape is:

```typescript
metadata: {
  proceduralGraph: {
    schemaVersion: 1,
    condition: string | null,
    guidance: string,
    pitfalls: string,
  },
}
```

At minimum, `CreateRelationSchema`, the full `RelationSchema`, and any import/export relation schemas used by PG round-tripping must admit and preserve the namespaced metadata without weakening unrelated validation. Do not bypass `RelationManager` merely to evade schema validation, because doing so would also bypass endpoint checks and manager-level governance hooks.

### A2 - `ManagerContextOptions.storageType` is not currently honored by the constructor

The audited `ManagerContext` declares `storageType?: 'jsonl' | 'sqlite'`, but its constructor calls `createStorageFromPath()` and does not use `opts.storageType`. `StorageFactory` itself allows `MEMORY_STORAGE_TYPE` to override even an explicitly supplied backend type. [C6, C7]

**Correction:** a separate PG backing must not inherit that ambiguity. Introduce an explicit PG backing constructor that either:

- directly constructs the requested supported backend, or
- uses a new storage-factory path where an explicit PG backend cannot be silently overridden by `MEMORY_STORAGE_TYPE`.

Fail fast if the effective backend differs from the requested one. Do not copy the current ignored-`storageType` pattern into PG configuration.

### A3 - JSONL segment mode invalidates a naive single-file publication assumption

`GraphStorage` can switch into segmented storage via environment configuration. Its write path then uses segment routing and manifest-based publication rather than the ordinary single-file path. [C7]

**Correction:** first-release PG JSONL publication is supported only in non-segmented mode unless a dedicated segmented PG compare-and-swap publication primitive is implemented and passes the same crash/restart tests. Detect segment mode at PG backing creation and fail with a clear unsupported-mode error rather than claiming single-file atomicity.

### A4 - SQLite has two runtime drivers

`SQLiteStorage` prefers `better-sqlite3` but can fall back to Node's built-in `node:sqlite`; `MEMORY_SQLITE_DRIVER=node` explicitly exercises the fallback. Batch entity and relation writes are transactional individually, and full `saveGraph()` is transactional, but separate manager calls are not one cross-call transaction. [C7]

**Correction:** the PG SQLite publication contract must be tested against both drivers when the platform supports them. A retained revision, validation report, and head update must commit in one storage transaction; do not compose separate `EntityManager`/`RelationManager` calls and assume `graphMutex` turns them into an ACID transaction.

### A5 - Raw concatenated identifiers can exceed core entity-name constraints

Core entity validation caps entity names at 500 characters. Encoding unrestricted `graphId + revisionId + nodeId` directly into a storage entity name can violate that limit or create ambiguous escaping rules. [C4]

**Correction:** use bounded deterministic storage keys, for example `pg:<kind>:<sha256(canonicalTuple)>`, and store the original graph/revision/node identifiers as validated scalar fields in the entity observations. Hash the unambiguous canonical tuple rather than a delimiter-joined raw string.

### A6 - A separate backing requires explicit lifecycle ownership

`ManagerContext.close()` owns and closes its primary storage. A separate PG backing will not be closed automatically unless it is registered with the context. [C6]

**Correction:** prefer an explicit `ctx.createProceduralGraph(config)` factory over an ambiguous cached getter. Context-created PG managers/backings are registered for disposal and closed by `ManagerContext.close()`. Caller-supplied backing objects remain caller-owned. `ProceduralGraphManager` also exposes `dispose()`/`close()` for standalone use.

### A7 - Separate backing means ordinary context governance is not automatically inherited

MemoryJS's normal manager wiring injects governance hooks into context-owned mutation managers. A second storage instance is outside that wiring by default. [C6]

**Correction:** PG writes use an explicit `ProceduralGraphPolicy`/audit hook contract. A context-created PG manager may adapt the context's governance/RBAC policy, but the implementation must not claim that merely using MemoryJS storage automatically authorizes or audits PG mutations.

### A8 - Validation-result reuse must not silently change paper-compatible behavior

The first plan allowed identical no-op candidates to reuse an evaluation result. That is a reasonable optimization but is not part of the paper algorithm.

**Correction:** paper-compatible mode evaluates structurally valid candidates unless an explicit, manifest-recorded evaluation-cache optimization is enabled. Cache hits are visible in the round record and may only reuse a result when the complete evaluation fingerprint and graph digest match exactly.

### A9 - The repo's `src/types` layer has a hard import boundary

The custom lint rule rejects static and type-only imports from `src/types` into implementation directories such as `agent`, `core`, `search`, and `utils`. [C8]

**Correction:** PG leaf contracts may live in `src/types/proceduralGraph.ts`, but implementation-specific Zod schemas, hashing, serialization, storage adapters, and provider wrappers belong outside `src/types`. Leaf types may import only allowed external/type-layer dependencies.

## 4. Existing MemoryJS integration points

| Existing surface | Audited behavior | PG integration |
|---|---|---|
| `src/types/procedure.ts` | Ordered `ProcedureStep` values: `order`, action string, string parameters, recursive fallback, optional timeout. [C1] | Leave unchanged; add separate PG contracts. |
| `src/agent/procedural/ProcedureManager.ts` | Persists procedures, matches triggers/name, exposes fresh sequencers, updates EWMA feedback, and `invoke()` resolves/prepares rather than executing. [C2] | Preserve APIs and action-agnostic boundary. Add explicit one-way adapter only. |
| `src/agent/procedural/ProcedureStore.ts` | Stores procedure/step entities plus `has_step`, `precedes`, `has_fallback` relations and migrates legacy JSON blobs. [C3] | Reuse decomposed-graph precedent but not its multi-call replacement sequence for retained checkpoint publication. |
| `src/agent/procedural/StepSequencer.ts` | In-memory linear cursor with recursive fallback behavior and resume to next main step. [C3] | Adapter must preserve these semantics or return a conversion warning. |
| `src/types/types.ts` | `Relation` already has weight/confidence/properties/metadata. [C4] | No TypeScript `Relation` field expansion is required for PG metadata. |
| `src/utils/schemas.ts` | Strict relation schemas lag the richer `Relation` type and currently reject `metadata`. [C4] | Runtime schema work is mandatory before PG metadata uses `RelationManager`. |
| `src/core/RelationManager.ts` | Validates endpoints and relation batches under `graphMutex`; duplicate identity is `(from,to,relationType)`. [C4] | Use it for ordinary relation operations after schema fix; retained publication uses a narrower atomic backing primitive. |
| `src/search/LLMQueryPlanner.ts` | `LLMProvider.complete(prompt): Promise<string>`. [C5] | Accept a structural completion-provider contract; do not import search code into leaf types. |
| `src/agent/reconstruction/MemoryDistiller.ts` | Existing optional usage-reporting provider convention (`getLastUsage?`). [C5] | Reuse the convention where practical; distinguish exact provider usage from estimates. |
| `src/core/ManagerContext.ts` | Lazy agent-manager pattern, primary storage ownership, close lifecycle; declared `storageType` is currently ignored by constructor. [C6] | Add explicit factory and disposal registration; do not use the ignored option pattern. |
| `src/core/StorageFactory.ts` | Supports JSONL/SQLite/PostgreSQL; env may override explicit type. [C7] | PG backing selection must be explicit and verified. PostgreSQL retained publication is deferred until conformance exists. |
| `src/core/GraphStorage.ts` | Single-file JSONL plus optional segmented mode; internal mutex; append/delta paths and full-save path differ. [C7] | First-release PG JSONL requires non-segmented backing and PG-specific expected-head publication. |
| `src/core/SQLiteStorage.ts` | Transactional batch/full saves; private DB handle; better-sqlite3/node:sqlite driver options. [C7] | Add a narrow storage-level PG publication capability or equivalent internal primitive; test both drivers. |
| `scripts/lint-rules.mjs` | Enforces `src/types` as a leaf, including type-only imports. [C8] | Keep implementation logic outside leaf types. |
| Package exports/build | Root plus agent/types/etc. dual ESM/CJS exports; build performs declaration and export checks. [C8] | Re-export through existing agent/root/type barrels; no new package subpath in first release. |

## 5. Proposed module layout

```text
src/types/proceduralGraph.ts

src/agent/procedural/graph/
  ProceduralGraph.ts                 # immutable snapshot, indexes, exact localization, traversal
  ProceduralGraphValidator.ts        # PG schema/topology/catalog validation
  ProceduralGraphSchemas.ts          # Zod schemas; implementation layer, not src/types
  ProceduralGraphSerializer.ts       # canonical JSON + prompt serialization
  ProceduralGraphSession.ts          # frozen revision + ordered action/observation trace
  ProceduralGuidance.ts              # localized/full graph guidance orchestration
  ProceduralGraphRefiner.ts          # prompt + strict edit parsing
  ProceduralGraphEvolution.ts        # retained checkpoint loop + rejection history
  ProceduralGraphManager.ts          # public facade
  ProcedureGraphAdapter.ts           # explicit Procedure -> PG conversion
  prompts.ts
  index.ts

src/agent/procedural/graph/backing/
  IProceduralGraphBacking.ts         # narrow persistence/publication contract
  JsonlProceduralGraphBacking.ts
  SqliteProceduralGraphBacking.ts
```

Do not add a third-party graph framework. Traversal, reverse reachability, cycle detection, and adjacency indexes are small deterministic utilities and should use native collections.

## 6. Data contracts

### 6.1 Core graph types

```typescript
export type PGBuiltInRelation =
  | 'LEADS_TO'
  | 'TRIGGERS'
  | 'PROVIDES_INPUT_FOR'
  | 'CONVERGES_TO';

export type PGNode = { id: string; description: string } & (
  | { type: 'ACTION'; actionName: string }
  | { type: 'SKILL'; skillName?: string }
  | { type: 'REASONING' | 'STATE' }
);

export interface PGEdge {
  source: string;
  relation: string;
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

`reject` is a MemoryJS extension. `allow` and `repair` map to the paper's cycle-policy behavior. The product default should be `reject`; the paper-reproduction profile uses the configured paper behavior.

### 6.2 Runtime validation

Validate at every external ingress:

- non-empty bounded graph/revision/node IDs;
- unique node IDs;
- unique edge triplets `(source, relation, target)`;
- allowed node types and declared relation vocabulary;
- all endpoints present;
- required `condition`/`guidance`/`pitfalls` fields on imported/refiner edges;
- bounded attribute lengths and total serialized graph size;
- finite numeric settings and positive budgets;
- action bindings against the provided tool catalog;
- static-mode node-ID preservation;
- entry node existence and terminal reachability;
- graph limits that permit at least the paper's largest reported main-experiment graph (131 nodes / 265 triplets) when using the reproduction profile. [P3]

Return structured diagnostics; do not throw away which edit/node/edge failed.

### 6.3 Canonical identity

Use a deterministic canonical JSON representation with sorted object keys and deterministic node/edge ordering for hashing. Compute:

- graph digest;
- tool-catalog digest;
- experiment/evaluation fingerprint;
- bounded storage keys.

Do not hash unstable timestamps into the semantic graph digest. Revision IDs may contain creation metadata separately.

## 7. Persistence and atomic publication

### 7.1 Separate procedural backing

Default to a separately configured PG file/database so retained graphs, rejected candidates, trajectory evidence, and refinement prompts do not pollute ordinary semantic search, decay, consolidation, or factual memory.

Recommended entity classes in that backing:

- `procedural-graph`
- `procedural-graph-revision`
- `procedural-graph-node`
- `procedural-graph-evaluation`
- `procedural-graph-rejection`
- `procedural-graph-run`

Transition relations store the PG edge attributes under `metadata.proceduralGraph` after the runtime relation-schema fix from A1. Bookkeeping relations use a private namespace such as `pg_contains_node`, `pg_revision_of`, or equivalent; traversal and terminal detection operate only on declared PG transition relations.

Use digest-based bounded entity names. Persist original IDs and human-readable descriptions as scalar observations. Never rely on the storage entity name as the only copy of a user-facing PG node ID.

### 7.2 Retained head

Each graph has one retained-head record containing at least:

```text
revisionId
headVersion
validationReportRef
validationMean
evaluationFingerprint
graphDigest
updatedAt
```

Historic revisions are immutable. Publishing does not rewrite an existing revision.

### 7.3 Required backing capability

```typescript
interface IProceduralGraphBacking {
  loadHead(graphId: string): Promise<PGHead | undefined>;
  loadRevision(graphId: string, revisionId: string): Promise<PGSnapshot | undefined>;
  commitRetainedRevision(input: {
    expectedHeadVersion: number;
    revision: PGSnapshot;
    validation: PGEvaluationReport;
    round: PGRoundRecord;
  }): Promise<
    | { status: 'committed'; head: PGHead }
    | { status: 'conflict'; currentHead: PGHead }
  >;
  appendRejection(record: PGRejectionRecord): Promise<void>;
  close?(): void | Promise<void>;
}
```

This is new behavior, not an existing `IGraphStorage` guarantee.

### 7.4 JSONL publication

For non-segmented JSONL backing, publication may use one PG-specific critical section that:

1. reads/verifies the current head version;
2. builds a complete next backing state containing the immutable revision/report/round plus new head;
3. persists through the backend's atomic whole-file publication path;
4. exposes the new head only after successful persistence.

Single-process locking does not provide multi-process compare-and-swap. First release documents JSONL PG backing as single-writer per file. If true multi-process concurrency is required, use SQLite or add an OS/file-locking protocol with its own tests.

Reject `MEMORY_STORAGE_SEGMENT_COUNT >= 2` for PG JSONL backing until segmented CAS semantics are deliberately implemented and tested.

### 7.5 SQLite publication

Use one database transaction that performs the expected-head predicate and inserts the revision, evaluation, round record, relations/nodes, and updated head atomically. No provider/refiner/evaluator call occurs while the storage transaction or graph lock is held.

Do not implement this as `EntityManager.createEntities()` followed by `RelationManager.createRelations()` followed by `updateEntity(head)`: those are separately locked/committed operations and can expose partial publication.

Run the backing contract suite using the default SQLite driver and `MEMORY_SQLITE_DRIVER=node` where available.

### 7.6 Backup, recovery, rollback

Define PG-level backup/export semantics rather than assuming the primary `IOManager` automatically covers the separate backing. A recovery test must demonstrate that, after injected failure or process restart, readers observe either the previous complete retained revision or the new complete retained revision, never a partial head.

`rollback(graphId, revisionId, expectedHeadVersion)` is a new audited head-pointer publication referencing an existing immutable revision. It affects future sessions only. If the selected revision was evaluated under a different fingerprint, its prior score cannot be reused as the current baseline without explicit re-evaluation.

## 8. Online guidance lifecycle

### 8.1 Session creation

`openSession()` pins:

- graph ID and revision ID;
- graph digest;
- task/query and task description;
- tool-catalog hash;
- guidance configuration;
- completion-provider identity when known;
- a unique run/session ID.

The session records only externally available trajectory data needed by PG: action/procedure identifiers, observations/tool results, explicit status/reasoning events if the host chooses to expose them, and outcome metadata. Private chain-of-thought is not required.

### 8.2 Locate -> extract -> generate

At each decision:

1. **Locate:** before the first action use `entryNodeId`; thereafter exact-match the most recently recorded procedure/action against the pinned graph. Repeated action names that map to multiple nodes require an explicit node/procedure ID or count as unmatched.
2. **Extract:** traverse only outgoing PG transition edges for at most `hopLimit` steps (paper default 2). Preserve direction, hop grouping, relation label, condition, guidance, and pitfalls. Bound cycles with visited-edge accounting.
3. **Fallback:** if localization fails, use the complete pinned PG if it fits the configured context budget. Do not substitute the entire MemoryJS factual graph.
4. **Generate:** combine task/query, graph context, and the last `trajectoryWindow` completed action/observation steps (paper default 3). The completion model returns situational guidance.
5. **Return:** return guidance plus diagnostics. The host solver independently selects and executes the next action, then records its real observation.

A recommendation must never mutate the session's localized node until the corresponding action is actually recorded.

### 8.3 Guidance modes

Support:

- `generative` - paper-style guidance model;
- `attributes-only` - deterministic serialized PG attributes, explicitly labeled as non-generative;
- `disabled` - no PG prompt contribution.

Provider absence does not pretend to implement the generative method. Configured provider failure may degrade to `attributes-only` only when the caller opted into that fallback, and the result reports the error and actual mode.

### 8.4 Serialization and prompt safety

Default MemoryJS serialization includes relation labels because they carry semantic information. A `paper-compatible` serializer reproduces the paper's demonstrated local serializer behavior, which omits stored relation labels from the human-readable subgraph text. [P3]

Treat graph text, observations, tool results, file paths, and prior model output as untrusted data sections. PG guidance remains subordinate to the host's system instructions, authorization checks, and tool schemas. Never execute command text embedded in `guidance` or `pitfalls`.

### 8.5 Budgets and usage accounting

Bound:

- graph nodes/edges;
- serialized graph/context bytes or tokens;
- per-step observation size;
- guidance calls per session;
- refiner calls/rounds;
- provider output length;
- wall-clock budget.

If a complete fallback graph does not fit, return a distinct `context-budget-exceeded` result; do not silently truncate and label it "full graph".

A plain `LLMProvider.complete()` exposes no exact usage, cancellation, model identity, or sampling controls. Optional adapters may expose those. Reuse the repository's optional usage-reporting convention where practical. A timeout can discard a late response but cannot guarantee that the external billable request was canceled.

## 9. Offline self-evolution

### 9.1 Caller-owned dependencies

MemoryJS orchestrates but does not provide a production solver. `evolve()` requires explicit dependencies:

```typescript
interface PGEvolutionDependencies {
  rollout(task: PGTask, graph: PGSnapshot, signal?: AbortSignal): Promise<PGTrajectory>;
  evaluate(task: PGTask, graph: PGSnapshot, signal?: AbortSignal): Promise<number>;
  refiner: PGCompletionProvider;
  tokenizer: PGTokenizer;
}
```

Callers provide resettable, isolated training/validation environments. Starting a session or recording feedback never starts evolution implicitly.

### 9.2 Experiment manifest and score cache identity

Persist an immutable manifest covering at least:

- task/split IDs and cryptographic fingerprints;
- evaluator version and metric definition;
- solver/model identity;
- guidance model identity;
- refiner model identity;
- prompts/serializer versions;
- tool catalog hash;
- graph digest/revision;
- sampling/decoding settings;
- seed(s) when applicable;
- `h`, `w`, `Lmax`, cycle policy;
- budgets and provider configuration.

The validation score cache key is the complete evaluation fingerprint plus graph digest. Any material change requires a new baseline evaluation.

For paper reproduction, record that the paper uses the same underlying LLM for solver, guidance, and refiner and greedy decoding; construction experiments additionally specify deterministic settings in Appendix D. Production deployments may differ, but the deviation must be visible in the manifest. [P3, P4]

### 9.3 Diagnostic rollout ordering

Each training trajectory records task ID, graph revision, ordered actions/observations, and finite score in `[0,1]`. Preserve high- versus low-scoring groups. If all scores fall into one group, report the absence of a contrast rather than fabricating one.

If tasks execute concurrently, sort completed trajectories back into deterministic batch order before concatenation and token-tail truncation. Tail truncation must preserve the final `Lmax` tokens exactly according to the configured tokenizer. [P3]

### 9.4 Refiner input and strict parsing

The refiner receives:

- task description/context;
- available tool actions;
- current retained graph;
- deterministic training trajectory block and scores;
- serialized rejection memory;
- refinement mode.

Its output is one raw JSON object with exactly the four paper arrays. Parse with Zod in the implementation layer. Reject code fences, surrounding prose, duplicate/conflicting operations, unknown fields, invalid relation vocabulary, oversized edits, missing required edge attributes, and references to absent/deleted nodes.

Store the raw model proposal separately from the normalized edit set and repair diagnostics.

### 9.5 Candidate preparation order

For a detached copy of the retained graph:

1. delete every edge whose `(source,target)` matches a `delete_edges` operation;
2. delete named nodes and all incident edges;
3. add nodes;
4. add edges;
5. apply configured cycle policy;
6. run endpoint, catalog, entry, and terminal-reachability validation.

Static modes reject an attempt to rename an existing node rather than treating delete+add with a new ID as a harmless rename.

### 9.6 Cycle policies

- `allow`: permit cycles and require every node to reach some sink.
- `repair`: paper-compatible disallow-cycles behavior; remove cycle-closing edges before validation. Because the paper does not define a deterministic ordering for multiple possible repairs, MemoryJS defines and records one stable ordering.
- `reject`: MemoryJS production hardening; any detected directed cycle rejects the candidate. This is not the paper's repair algorithm.

Every repair operation appears in diagnostics and the persisted round record.

### 9.7 Retained-checkpoint algorithm

```text
retained = load retained head
baseline = cached valid report for the exact evaluation fingerprint
if baseline is absent:
    baseline = evaluate(retained, validationSet)

rejections = load this evolution run's rejection history

for batch in trainingBatches until round/cost budget is exhausted:
    traces = rollout(retained, batch)            # retained revision pinned per episode
    traces = restoreDeterministicBatchOrder(traces)
    context = tokenTail(concatenate(traces), Lmax)
    proposal = refine(retained, context, scores(traces), serialize(rejections))
    candidate, diagnostics = prepareCandidate(retained, proposal, cyclePolicy)

    if diagnostics.hasFatalError:
        appendRejection(proposal, traces, diagnostics)
        continue                                # no validation call

    report = evaluateCompleteValidationSet(candidate)
    if report is incomplete or invalid:
        recordRoundError(report.error)
        continue                                # retained + baseline unchanged

    if report.meanScore >= baseline.meanScore:
        publication = commitRetainedRevision(expectedHeadVersion, candidate, report)
        if publication is committed:
            retained = candidate
            baseline = report
        else:
            recordConflict(publication.currentHead)
            stopOrStartExplicitRebaseRound()
    else:
        appendRejection(candidate, proposal, traces, report)

return retained
```

Validation aggregation uses the declared full validation set. Evaluator error, timeout, cancellation, `NaN`, infinity, out-of-range score, or missing task result cannot silently disappear from the denominator. The run either applies the caller's explicit task-failure policy or marks evaluation incomplete and refuses promotion.

Equality is acceptance in paper-compatible mode. A stricter production gate may be added only as a separately named policy whose manifest clearly shows the deviation.

### 9.8 Rejection memory

Persist, subject to redaction policy:

- raw proposal digest and normalized edits;
- candidate digest/revision if preparation reached that point;
- training trace references and scores;
- structural/parse diagnostics or full validation result;
- retained reference score and revision;
- manifest/fingerprint identity;
- rejection reason and timestamp.

Structural failures enter rejection memory even though they have no candidate validation score. Bound how much rejection history is supplied to the refiner; record omitted/truncated history so runs remain explainable.

### 9.9 Construction modes

First production-facing release:

- `fixed_expert` - paper Mode 1, no mutation;
- `static_incremental` - expert-seeded Mode 3 behavior, validation-gated between batches;
- `scratch_incremental` - `Start -> End` skeleton, Mode 5 behavior, validation-gated between batches.

Research-only reproduction may expose:

- `static_onetime` - Mode 2, one global update, no paper validation gate;
- `scratch_onetime` - Mode 4, one global update from skeleton, no paper validation gate.

Automatic production promotion for the one-time modes should still be gated unless the caller explicitly enables paper-reproduction semantics.

## 10. Public API and compatibility

Prefer a factory with explicit ownership semantics:

```typescript
const pg = ctx.createProceduralGraph({
  backing: { type: 'sqlite', path: './procedures.db' },
  policy,
  guidanceProvider,
});
```

This avoids implying singleton/reconfiguration semantics from a getter-like `ctx.proceduralGraph(config)` call.

Proposed facade:

| Method | Contract |
|---|---|
| `createGraph(input)` | Validate and persist an expert graph or minimal skeleton. No model call. |
| `getGraph(graphId, revisionId?)` | Return retained or specifically requested immutable revision. |
| `openSession(graphId, options)` | Pin one revision and return isolated trajectory/guidance session. |
| `prepareCandidate(graphId, edits, options?)` | Pure detached candidate preparation plus diagnostics; no publication. |
| `evolve(graphId, options)` | Explicit bounded offline evolution using caller callbacks and manifest. |
| `listRevisions(graphId, page)` | Authorized paginated revision metadata. |
| `listRejections(graphId, page)` | Authorized paginated rejection metadata; raw trace bodies excluded by default. |
| `rollback(graphId, revisionId, expectedHeadVersion)` | Audited retained-head move for future sessions. |
| `exportGraph(graphId, revisionId?)` | Canonical versioned PG JSON. |
| `importGraph(document, options)` | Validate schema/integrity/catalog before persistence. |
| `dispose()` | Close context-owned backing/provider resources that this manager owns. |

A standalone `new ProceduralGraphManager(...)` remains possible for callers that do not use `ManagerContext`.

### Procedure adapter

`ProcedureGraphAdapter` is one-way initially:

- each original step becomes a distinct PG node;
- repeated action names never collapse distinct steps;
- parameters and timeout remain non-executable compatibility metadata;
- main sequence becomes explicit transitions;
- fallback semantics are represented with explicit failure-conditioned transitions and a resume path matching `StepSequencer`;
- if nested fallback/resume cannot be represented without extra synthetic nodes, create them deterministically and return conversion notes;
- approximate reverse conversion is never labeled lossless.

No existing `procedure` or `procedure-step` entity is silently migrated. `addProcedure`, `invoke`, `matchProcedure`, `refineProcedure`, and `openSequencer` retain current behavior. [C1-C3]

## 11. Delivery phases

### Phase 1 - Pure contracts and graph core

**Files:** `src/types/proceduralGraph.ts`, `ProceduralGraph.ts`, `ProceduralGraphSchemas.ts`, `ProceduralGraphValidator.ts`, serializer; unit tests.

- [ ] Define types, Zod schemas, canonical ordering/digest, result unions, limits.
- [ ] Implement exact localization, outgoing bounded traversal, full-graph selection, immutable snapshots.
- [ ] Implement edit preparation, endpoint-pair deletion, terminal reachability, catalog validation, static-ID preservation, cycle policies.
- [ ] Add paper-derived and synthetic fixtures for parallel edges, sinks, cycles, duplicate IDs, malformed edits, repeated action bindings.

**Exit:** PG-01 through PG-11 structural/inference prerequisites pass without storage or a model provider. `src/types` leaf lint passes.

### Phase 2 - Runtime relation schema and backing publication

**Files:** relation schemas/tests; backing interfaces/adapters; narrowly scoped storage internals; persistence contract tests.

- [ ] Extend strict relation runtime schemas to preserve namespaced PG metadata without weakening unrelated fields.
- [ ] Add bounded digest storage keys and native graph encoding.
- [ ] Implement explicit backend selection independent of silent env override.
- [ ] Implement JSONL non-segmented expected-head publication.
- [ ] Implement SQLite transactional expected-head publication.
- [ ] Reject unsupported PostgreSQL and segmented-JSONL publication modes clearly.
- [ ] Run SQLite backing tests against both drivers where available.

**Exit:** JSONL and SQLite pass the same retained-head/revision/report/rejection round-trip and crash/conflict contract. No partial retained publication is observable.

### Phase 3 - Frozen sessions and guidance

- [ ] Implement session pinning and ordered trace recorder.
- [ ] Implement paper-compatible local/full graph serializers and default richer serializer.
- [ ] Add completion-provider adapter, usage reporting, timeout/error/degradation results.
- [ ] Implement h/w/context/call/output budgets and prompt data isolation.
- [ ] Add unknown/ambiguous action, sink, provider failure, injection, and concurrent-publication fixtures.

**Exit:** PG-03 through PG-05 pass end-to-end. A session is unaffected by a concurrently published head.

### Phase 4 - Refiner and self-evolution

- [ ] Implement paper prompt semantics including tool membership, generality, static node-ID compatibility, and rejection memory.
- [ ] Implement deterministic trajectory concatenation and exact tail tokenization.
- [ ] Implement complete-validation aggregation, cached baseline identity, equality acceptance, cancellation/error handling.
- [ ] Implement retained state, rejection records, resume, stale-head conflict behavior, and explicit rebase policy.
- [ ] Add fixed expert, static incremental, and scratch incremental modes; keep one-time ungated modes research-only by default.

**Exit:** PG-06 through PG-16 pass. Invalid candidates never evaluate; rejected candidates never become the next retained graph; test data cannot influence promotion.

### Phase 5 - Facade, lifecycle, security, exports, compatibility

- [ ] Add `createProceduralGraph()` factory and standalone manager.
- [ ] Register/dispose context-owned backings; preserve caller ownership for injected backings.
- [ ] Add explicit PG authorization/audit hooks and safe inspection defaults.
- [ ] Add `ProcedureGraphAdapter` with fallback/resume tests.
- [ ] Update procedural/agent/root/type barrels, README/API docs, and built export tests.
- [ ] Define PG-specific export/backup/rollback/recovery guide.

**Exit:** built ESM/CJS runtime and type imports pass; existing procedure APIs/tests remain compatible; unused PG adds no model calls or background work.

### Phase 6 - Controlled evaluation and experimental release

- [ ] Run no-PG, raw-full-graph, generative-full-graph, and localized-generative comparisons on fixed tasks/graph/solver.
- [ ] Separately compare fixed expert, expert incremental, and scratch incremental construction so inference and construction are not confounded.
- [ ] Record complete manifests, graph hashes, all candidate decisions, quality/cost metrics, and failures.
- [ ] Evaluate only the last retained graph on the untouched final test split.
- [ ] Release opt-in/experimental and document workload-specific overhead/benefit rather than claiming universal gains.

**Exit:** no paper metric is presented as a MemoryJS result unless actually reproduced under a declared configuration.

## 12. Test and evaluation matrix

### 12.1 Deterministic tests

Cover at least:

- empty/missing entry node;
- duplicate IDs and duplicate triplets;
- null condition and required guidance/pitfalls;
- Unicode/multiline attributes;
- canonical digest determinism;
- relation metadata schema acceptance + rejection of unknown unrelated keys;
- bounded digest storage keys;
- endpoint-pair deletion across multiple relation types;
- deleted-node incident-edge cleanup;
- cycle allow/repair/reject behavior;
- every-node-to-terminal reachability;
- terminal name other than `End`;
- action catalog mismatch and static-mode rename;
- exact localization, repeated action ambiguity, localization miss, sink match;
- h=2 boundary and bounded cyclic traversal;
- full-graph fallback budget failure;
- session revision pinning;
- provider error/timeout/late response;
- exact token-tail preservation and deterministic parallel rollout ordering;
- structural rejection with zero validation calls;
- equal/lower/higher validation scores;
- evaluator exceptions, missing result, NaN/infinity/out-of-range values;
- cancellation and round/cost budget exhaustion;
- stale-head competing publishers;
- restart after accepted/rejected/structurally invalid rounds;
- evaluation fingerprint invalidation;
- JSONL segment-mode rejection;
- SQLite both-driver publication conformance;
- context-owned versus caller-owned disposal;
- old `ProcedureManager`/`StepSequencer` regression suites.

Evolution tests assert both retained graph **and cached retained score** after every round. A structural rejection has no new validation score and must not inherit a rejected candidate's result.

### 12.2 Paper-inspired behavioral fixtures

Use Appendix F examples only as fixtures, not universal guarantees:

- quote-only task guidance should discourage continuing into booking/payment;
- a dialogue task should preserve the user's response objective instead of answering an evaluator/meta question.

### 12.3 Controlled model evaluation

For the four inference variants, hold the graph, solver, task set, tools, prompt template, and decoding settings constant. Report:

- task success / mean rubric score;
- invalid tool/action calls;
- repeated unproductive actions;
- solver steps;
- solver, guidance, and refiner input/output tokens separately;
- exact vs estimated token accounting;
- end-to-end latency;
- model call counts;
- localization misses and full-graph fallback rate;
- budget-degradation rate;
- graph nodes/edges and serialized context size;
- structural rejection, validation rejection, acceptance, and conflict rates;
- total evolution cost.

The paper's experiments show that localized guidance can reduce graph-context cost relative to full-graph generative guidance while still increasing total tokens relative to no graph. Do not promise lower total cost merely because trajectories or tool calls become shorter. [P6]

The default paper gate guarantees only a nondecreasing **measured validation mean** under the chosen evaluator. It does not prove production safety, statistical significance, or generalization. Keep an untouched final test set and record every candidate considered. [P5]

## 13. Repository verification

Implementation PRs should run the active scripts from `package.json`:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun run test:ci
bun run test:coverage
```

Also run targeted new PG unit/integration/storage contract suites in each phase. Real-model evaluation remains explicitly opt-in and budgeted.

`bun run audit:plans` currently scans plan files under `docs/superpowers/plans` and `docs/roadmap`; this root-level plan is **not** covered by that tool. Do not cite `audit:plans` as validation of this document unless the tool scope is deliberately expanded. [C8]

## 14. Security, privacy, and operations

The PG is advisory knowledge, not executable policy. Required safeguards:

- validate all imported/refiner-generated nodes, relations, attributes, and tool bindings;
- authorize graph read/write/evolution separately from factual-memory authorization;
- keep rejected candidates and raw traces out of ordinary memory search by default;
- redact or reference sensitive trajectory bodies according to host retention policy;
- isolate external-provider payload construction and document what trace data leaves the process;
- make full graph fallback, rejection memory, and diagnostic exports subject to the same authorization policy;
- enforce bounded graph/edit/context sizes before model calls;
- never interpret graph text as shell, SQL, file, or tool commands without the normal host execution layer;
- log publication/rejection/rollback identity without dumping secret trace bodies into default diagnostics.

Operationally, expose head version, revision digest, graph size, last validation fingerprint, rejection count, and degradation/conflict counters. Do not expose raw prompt/trace content in health diagnostics.

## 15. Definition of done

- [ ] All sixteen paper-fidelity requirements have traceable implementation and passing tests.
- [ ] Relation runtime schemas preserve PG metadata through `RelationManager` and storage round-trip.
- [ ] Explicit backing selection cannot be silently changed by `MEMORY_STORAGE_TYPE`.
- [ ] Unsupported segmented JSONL/PostgreSQL publication fails closed.
- [ ] JSONL and SQLite publication/recovery pass injected-failure and stale-writer tests; SQLite is tested with both supported drivers where available.
- [ ] No retained publication can expose a head whose revision/report is incomplete.
- [ ] Existing procedural APIs, entities, and sequencer behavior remain backward compatible.
- [ ] Frozen sessions stay pinned across concurrent head updates.
- [ ] Generative, attributes-only, disabled, provider-error, and context-budget outcomes are distinguishable.
- [ ] Train/validation/test isolation and evaluation fingerprinting are enforced.
- [ ] Rejection memory, equality acceptance, terminal checks, cycle behavior, exact localization, and tail-token semantics match the selected paper-compatible profile.
- [ ] Context-created backings are disposed; caller-owned backings are not unexpectedly closed.
- [ ] PG authorization/audit hooks and default trace redaction are reviewed.
- [ ] Built root/agent/types ESM and CJS imports plus declaration exports pass.
- [ ] Evaluation report states actual MemoryJS quality/cost results and limitations; paper numbers are never presented as reproduced measurements without evidence.

## 16. Sources and traceability

### Supplied paper

All page references refer to the supplied PDF. The paper is the design source; its benchmark claims are not independently re-verified by this plan.

- **P1:** Section 3.1, pp. 3-4 - graph formalization, node abstractions, and condition/guidance/pitfalls attributes.
- **P2:** Section 3.2 and Figure 2, pp. 4-5; Section 4, p. 6 - exact localization, directed 2-hop neighborhood, full-PG fallback, recent trajectory window, and soft solver integration.
- **P3:** Section 3.3, pp. 5-6; Appendices B.4-B.6, pp. 21-24 - relation vocabulary, prompts, edit JSON, endpoint-pair deletion, rejection memory, retained checkpoint algorithm, cycle handling, terminal reachability, tool-catalog prompt rule, static node-ID compatibility, and generality requirement.
- **P4:** Section 5.3, p. 9; Appendix D.2, pp. 30-31 - five construction strategies and between-batch meaning of "online evolution".
- **P5:** Section 5.4, pp. 9-10; Appendix E.2, p. 33; Appendix F, p. 36 - retained-vs-intermediate test selection caveat, candidate screening, and behavioral cases.
- **P6:** Section 5.5/Table 3, p. 10; Conclusion, p. 11 - localized vs full-graph guidance and token/step tradeoffs.

### Audited repository sources

- **C1:** [`src/types/procedure.ts`](../src/types/procedure.ts)
- **C2:** [`src/agent/procedural/ProcedureManager.ts`](../src/agent/procedural/ProcedureManager.ts)
- **C3:** [`src/agent/procedural/ProcedureStore.ts`](../src/agent/procedural/ProcedureStore.ts), [`src/agent/procedural/StepSequencer.ts`](../src/agent/procedural/StepSequencer.ts)
- **C4:** [`src/types/types.ts`](../src/types/types.ts), [`src/utils/schemas.ts`](../src/utils/schemas.ts), [`src/core/RelationManager.ts`](../src/core/RelationManager.ts)
- **C5:** [`src/search/LLMQueryPlanner.ts`](../src/search/LLMQueryPlanner.ts), [`src/agent/reconstruction/MemoryDistiller.ts`](../src/agent/reconstruction/MemoryDistiller.ts)
- **C6:** [`src/core/ManagerContext.ts`](../src/core/ManagerContext.ts)
- **C7:** [`src/core/StorageFactory.ts`](../src/core/StorageFactory.ts), [`src/core/GraphStorage.ts`](../src/core/GraphStorage.ts), [`src/core/SQLiteStorage.ts`](../src/core/SQLiteStorage.ts), [`src/core/TransactionManager.ts`](../src/core/TransactionManager.ts)
- **C8:** [`package.json`](../package.json), [`scripts/lint-rules.mjs`](../scripts/lint-rules.mjs), [`tools/plan-doc-audit/audit.ts`](../tools/plan-doc-audit/audit.ts), [`src/agent/procedural/index.ts`](../src/agent/procedural/index.ts), [`src/agent/index.ts`](../src/agent/index.ts), and existing procedural tests.

Where documentation prose and active code differ, implementation decisions in this plan follow the audited source and `package.json`. Any future source change that materially alters the cited behavior should trigger a plan re-audit before implementation.