# Procedural Graph Feature Plan

> **Status:** Audited implementation plan; no runtime implementation is included.
> **Audit date:** 2026-09-10 (third pass: paper-text re-read plus source re-inspection; see Section 3, A10-A14)
> **Audited repository baseline:** `danielsimonjr/MemoryJS`, `master` at `914324c` (`@danielsimonjr/memoryjs` 4.0.0).
> **Code baseline note:** every commit after `549ce11018e5ab2188173ae225c877705d50e453` (`d07b205`, `b518ed8`, `914324c`) touches only `docs/` and `CHANGELOG.md`; `549ce11` therefore remains the source-code baseline for every `[C#]` fact below.
> **Source:** Yuxing Lu, Yicheng Chen, Shanchan Wu, and Sercan O. Arik, *Procedural Graphs: Self-Evolving Execution Structures for LLM Agents*, supplied 36-page PDF, arXiv:2609.09153v1, 8 September 2026.
> **Companion:** the subagent-executable build plan derived from this document is [`superpowers/plans/2026-09-10-procedural-graph-implementation.md`](./superpowers/plans/2026-09-10-procedural-graph-implementation.md).

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
| PG-02 | The paper's implemented edge attribute schema is `condition`, `guidance`, and `pitfalls`. `condition` may be `null` (unconditional). Refiner-proposed `add_edges` entries must supply `guidance` and `pitfalls` (refiner prompt rules 3-4). Stored expert graphs are **not** fully populated: Appendix B.4 states that "most" edges carry the full triple and that `guidance` is only the "most consistently populated" field. [P1, P3] | Strict validation of refiner output (missing `guidance`/`pitfalls` on an added edge is a parse failure). Imported/expert edges may carry `null` for any of the three fields; missing fields normalize to `null` and are reported as a non-fatal diagnostic, never fabricated. Preserve nulls, Unicode, multiline text, and all three fields through persistence/export. |
| PG-03 | First-step localization uses `Start` (`a_0 = Start`, so `u_1 = Start`); later localization exactly matches the most recent procedure/action `a_{t-1}` to a node in `V`. The neighborhood `N_h(u_t)` contains `u_t` plus the outgoing transitions reached within `h` steps; the paper configuration uses `h = 2` and falls back to the complete selected PG when matching fails. [P2] | Exact string match against node `id` in paper-compatible mode. No similarity search may masquerade as localization. The paper is silent on a matched zero-outdegree node; MemoryJS treats it as a successful match with an empty neighborhood (design choice, reported as `matched: true, hops: []`), not as a miss that triggers full-graph fallback. |
| PG-04 | Guidance combines graph context, query/task context, and the recent trajectory; the paper experiments use `w = 3`. Guidance is appended to solver context and remains soft rather than execution-enforcing. [P2] | Return advisory output; never execute, advance, block, or authorize an action solely because the graph recommends it. |
| PG-05 | The graph remains fixed within each training, validation, or test episode. [P2, P3] | Sessions pin an immutable revision. A newly accepted revision affects only subsequently opened sessions. |
| PG-06 | Refinement uses four arrays: `add_nodes`, `delete_nodes`, `add_edges`, and `delete_edges`. Attribute changes are expressed by deleting and re-adding an edge. [P3] | Parse exact edit operations and apply them to a detached copy. Unsupported operations are rejected. |
| PG-07 | A `delete_edges` item contains only `source` and `target` and removes all edges between those endpoints regardless of relation; selected transitions can be re-added afterward. Candidate preparation applies deletions before additions. [P3] | Endpoint-pair deletion tests must cover multiple relation types. Re-add order must be deterministic. |
| PG-08 | Structural checks occur before validation rollout. Every edge endpoint must exist and every node must have a directed path to a zero-outdegree terminal; the terminal need not be named `End`. [P3] | Invalid candidates never call the validation evaluator. Reachability is computed over PG transition edges only. |
| PG-09 | The paper's cycle policy is effectively **allow cycles** or **disallow cycles with cycle-closing-edge repair**. When cycles are allowed, repair and the acyclicity check are skipped. [P3] | Paper-compatible modes reproduce these two behaviors. A separate MemoryJS `reject` policy may exist but must be labeled as an extension. |
| PG-10 | In the refiner prompt, every `ACTION` node must match an available action/tool name (rule 1), and in static modes existing node IDs must be preserved (rule 6). Appendix B.6 states explicitly that "the generic structural validator does not independently enforce tool-catalog membership". [P3] | Tool-catalog membership is a **prompt** requirement in the paper. MemoryJS offers structural enforcement behind `enforceToolCatalog` (default `true` for production profiles, forced `false` under `paperCompatible: true`); a catalog mismatch is then reported as a warning diagnostic rather than a structural failure `d_k`. Static-mode renames (delete + re-add under a new ID) are rejected in both profiles because rule 6 forbids them. |
| PG-11 | Refiner guidance should remain general and avoid overfitting/leaking trajectory-specific details. [P3] | Include the paper's generality/leak-prevention instruction in the refiner prompt and add regression fixtures for copied task-specific literals. |
| PG-12 | The initial validation score is cached. A valid candidate is accepted when `candidateMean >= retainedMean`, including equality. [P3] | Test lower, equal, and higher scores. Paper-compatible mode cannot silently add epsilon, strict-improvement, or secondary tie-break rules. |
| PG-13 | Each round starts from the last retained graph, never from a rejected candidate. Rejection history includes unsuccessful proposals and diagnostic evidence. [P3] | Persist retained/rejected identity separately. Restart after rejection must resume from the retained checkpoint and matching cached score. |
| PG-14 | Refiner trajectory context retains the final `Lmax` tokens of concatenated training trajectories, dropping excess tokens from the beginning while preserving final-token order. [P3] | Use a supplied tokenizer for token-exact reproduction. Parallel rollout results must be concatenated in deterministic batch/task order, not completion order. |
| PG-15 | Training, validation, and test data remain separate. Promotion depends on validation, and the final test must evaluate the last retained checkpoint rather than selecting the best observed test round. [P3, P5] | Test labels/outcomes cannot enter refinement or promotion. Record split fingerprints in the experiment manifest. |
| PG-16 | Construction strategies differ materially: Modes 1/2/4 are fixed or one-time alternatives; Modes 3/5 perform incremental between-batch evolution with validation gating. Modes 2/4 directly commit their one-time update without a validation safeguard in the paper. [P4] | Do not mislabel one-time ungated modes as safe gated evolution. Production auto-promotion stays gated unless a research-only paper-reproduction mode is explicitly requested. |

The paper reports the initial relation vocabulary `LEADS_TO`, `TRIGGERS`, `PROVIDES_INPUT_FOR`, and `CONVERGES_TO`. Use those as the built-in vocabulary for paper-compatible graphs. An explicitly declared extension vocabulary is allowed, but model-invented relation labels are rejected unless present in that graph's declared vocabulary. [P3]

Node types: the only node type attested verbatim in the paper is `ACTION` (refiner output format and the serialized context header `(Type: ACTION)`). Section 3.1 says nodes abstract "a tool function, a skill, an internal reasoning step, or a task status"; the MemoryJS names `SKILL`, `REASONING`, and `STATE` for the other three are this plan's labels, not paper identifiers. The refiner output carries only `id`, `type`, and `description` per node; there is no separate action-name field, so for an `ACTION` node the binding to a tool is the node `id` itself (rule 6 lists "the tool names" among node IDs). MemoryJS's optional `actionName` field defaults to `id` and exists only so imported graphs can bind a display ID to a differently spelled tool name explicitly.

The paper's `h = 2` and `w = 3` are experiment settings, not universal mathematical constraints. MemoryJS may expose bounded configuration, but `paperCompatible: true` fixes those defaults unless the caller deliberately overrides them and records the deviation.

## 3. Audit findings and corrections

A second-pass audit found concrete implementation issues that the first plan did not fully account for, and a third pass (2026-09-10) re-read the paper text against this plan and re-inspected the source tree. Findings A1-A9 come from the second pass; A10-A14 from the third. All are corrected in the body of this document.

### A1 - Relation metadata is supported by the TypeScript type but rejected by current relation creation schemas

`Relation` supports arbitrary `metadata`, and SQLite persistence already serializes/deserializes it. However, `RelationManager.createRelations()` validates through `BatchCreateRelationsSchema`, whose strict `CreateRelationSchema` currently does **not** admit `metadata`; the strict `RelationSchema` also omits the newer relation metadata fields. Therefore the earlier statement that PG attributes could be written under `metadata.proceduralGraph` with "no schema expansion required" was incorrect. [C4]

**Correction:** Phase 2 must update and test the relevant runtime schemas before PG relations are written through `RelationManager`. The preferred stored shape is:

```typescript
metadata: {
  proceduralGraph: {
    schemaVersion: 1,
    condition: string | null,
    guidance: string | null,
    pitfalls: string | null,
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

### A10 - Tool-catalog membership was mislabeled as a paper structural check

Sections 6.2 and 9.5 of the previous revision listed "action bindings against the provided tool catalog" among the structural checks whose failure sends a candidate to rejection memory without validation. Appendix B.6 states the opposite: catalog matching "is a refiner-prompt requirement; the generic structural validator does not independently enforce tool-catalog membership". [P3]

**Correction:** catalog enforcement is a MemoryJS option (`enforceToolCatalog`), off under the paper-compatible profile. See PG-10, Section 6.2, and Section 9.5.

### A11 - Required attribute triple was over-constrained for imported graphs

The previous revision required `condition`/`guidance`/`pitfalls` on every imported edge. Appendix B.4 reports that only "most" paper edges carry the full triple. Requiring all three on import would reject the paper's own graphs. [P3]

**Correction:** see PG-02. Only refiner `add_edges` entries must carry `guidance` and `pitfalls`; imported edges normalize absent fields to `null` with a diagnostic.

### A12 - The SQLite driver resolver is module-private

`SQLiteStorage.ts` resolves `better-sqlite3` versus `node:sqlite` inside a non-exported `loadDatabaseCtor()`; only `__resetDatabaseCtorForTests()` is exported. `src/core/nodeSqliteAdapter.ts` exports `isNodeSqliteAvailable()` and `createNodeSqliteDatabaseCtor()`. A separate PG SQLite backing cannot reuse the resolver without an export. [C7]

**Correction:** Phase 2 exports the resolver from `SQLiteStorage.ts` (as `resolveSQLiteDatabaseCtor()`, keeping the private name as an alias) so the PG backing honors `MEMORY_SQLITE_DRIVER` identically and both drivers are exercised by the same test seam. Do not duplicate the fallback logic.

### A13 - `IGraphStorage` and relation-schema usage sites were imprecisely located

`IGraphStorage` is declared in `src/types/types.ts` (there is no `src/core/IGraphStorage.ts`). `RelationSchema` (strict, no `metadata`) is the validator used by `IOManager` JSON import; `DeleteRelationsSchema` is built from `CreateRelationSchema`, so relation deletion input carrying `metadata` is also rejected today. Existing procedural tests live at `tests/unit/agent/ProcedureManager.test.ts` and `tests/unit/agent/ProcedureStore.test.ts` (not a `procedural/` subdirectory). [C4, C8]

**Correction:** Phase 2 schema work covers `CreateRelationSchema`, `RelationSchema`, and `DeleteRelationsSchema` together, with an `IOManager` import/export round-trip test. Section 4 and Section 16 paths are corrected.

### A14 - Toolchain facts the implementation must match

Verified from `package.json` / `tsconfig.json` at the baseline: Zod `^4.4.3` (v4 API), TypeScript `^7.0.2`, Vitest `^5.0.0` (`globals: true`, `include: tests/**/*.test.ts`), `module`/`moduleResolution` `NodeNext` (relative imports carry a `.js` suffix), `exactOptionalPropertyTypes: false`, `noUncheckedIndexedAccess: false`. `bun run lint` is `oxlint --type-aware src && node scripts/check-lint-rules.mjs` (the `CLAUDE.md` mention of ESLint 9 is stale). `bun run build` runs `tsup`, `scripts/emit-dts.mjs`, and `scripts/check-exports.mjs`; the last only checks that every `package.json` `exports` target file exists, so re-exporting through existing barrels needs no export-map change. [C8]

## 4. Existing MemoryJS integration points

| Existing surface | Audited behavior | PG integration |
|---|---|---|
| `src/types/procedure.ts` | Ordered `ProcedureStep` values: `order`, action string, string parameters, recursive fallback, optional timeout. [C1] | Leave unchanged; add separate PG contracts. |
| `src/agent/procedural/ProcedureManager.ts` | Persists procedures, matches triggers/name, exposes fresh sequencers, updates EWMA feedback, and `invoke()` resolves/prepares rather than executing. [C2] | Preserve APIs and action-agnostic boundary. Add explicit one-way adapter only. |
| `src/agent/procedural/ProcedureStore.ts` | Stores procedure/step entities plus `has_step`, `precedes`, `has_fallback` relations and migrates legacy JSON blobs. [C3] | Reuse decomposed-graph precedent but not its multi-call replacement sequence for retained checkpoint publication. |
| `src/agent/procedural/StepSequencer.ts` | In-memory linear cursor with recursive fallback behavior and resume to next main step. [C3] | Adapter must preserve these semantics or return a conversion warning. |
| `src/types/types.ts` | `Relation` already has weight/confidence/properties/metadata. [C4] | No TypeScript `Relation` field expansion is required for PG metadata. |
| `src/utils/schemas.ts` | `CreateRelationSchema` (strict; admits `weight`/`confidence`/`properties` but not `metadata`), `RelationSchema` (strict; only `from`/`to`/`relationType`/timestamps), and `DeleteRelationsSchema` (array of `CreateRelationSchema`) all reject `metadata`. `RelationSchema` is what `IOManager` JSON import validates with. [C4] | Runtime schema work on all three is mandatory before PG metadata uses `RelationManager` or round-trips through `IOManager`. |
| `src/core/RelationManager.ts` | Validates endpoints and relation batches under `graphMutex`; duplicate identity is `(from,to,relationType)`. [C4] | Use it for ordinary relation operations after schema fix; retained publication uses a narrower atomic backing primitive. |
| `src/search/LLMQueryPlanner.ts` | `LLMProvider.complete(prompt): Promise<string>`. [C5] | Accept a structural completion-provider contract; do not import search code into leaf types. |
| `src/agent/reconstruction/MemoryDistiller.ts` | Existing optional usage-reporting provider convention: `getLastUsage?(): { inputTokens, outputTokens } | undefined`, surfaced as `tokenUsage: { input, output, approximate }` where `approximate: true` marks the chars/4 heuristic. [C5] | Reuse the same shape; distinguish exact provider usage from estimates. |
| `src/core/ManagerContext.ts` | Lazy agent-manager pattern, primary storage ownership, close lifecycle; declared `storageType` is currently ignored by constructor. [C6] | Add explicit factory and disposal registration; do not use the ignored option pattern. |
| `src/core/StorageFactory.ts` | Supports JSONL/SQLite/PostgreSQL; env may override explicit type. [C7] | PG backing selection must be explicit and verified. PostgreSQL retained publication is deferred until conformance exists. |
| `src/core/GraphStorage.ts` | Single-file JSONL plus optional segmented mode (`MEMORY_STORAGE_SEGMENT_COUNT` in `[2, 1024]`, strict integer regex); `graphMutex: AsyncMutex`; whole-file writes go through the shared `durableWriteFile()` in `src/utils/durableWriteFile.ts` (temp file + rename, with Windows EPERM fallback). [C7] | The PG JSONL backing does not reuse `GraphStorage`; it owns its own sidecar file and writes it through the same `durableWriteFile()` utility under its own `AsyncMutex`. Segment mode is detected from the same env var and rejected. |
| `src/core/SQLiteStorage.ts` | Transactional batch/full saves (`this.db.transaction(...)`); private DB handle; driver resolution in non-exported `loadDatabaseCtor()` (better-sqlite3, then `node:sqlite`; `MEMORY_SQLITE_DRIVER=node` forces the fallback); `metadata` column already exists on the relations table. [C7] | PG SQLite backing owns its **own** connection to a separate database file, obtained through an exported driver resolver (A12); publication is one `db.transaction`. Test both drivers. |
| `scripts/lint-rules.mjs` | Enforces `src/types` as a leaf: no static, `export ... from`, or inline `import('...')` type references into `agent`, `core`, `utils`, `search`, `features`, `adapters`, `security`, `cli`, or `workers`. [C8] | Keep implementation logic (Zod, hashing, serialization, storage, providers) outside `src/types`. `src/types/proceduralGraph.ts` may import only from sibling `src/types` modules. |
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

export type PGNodeType = 'ACTION' | 'SKILL' | 'REASONING' | 'STATE';

export interface PGNode {
  id: string;
  type: PGNodeType;
  description: string;
  /**
   * ACTION nodes only. Tool/action name this node binds to. Defaults to `id`
   * when omitted (the paper's refiner output carries no separate field; the
   * node ID *is* the tool name). Ignored for other node types.
   */
  actionName?: string;
}

export interface PGEdge {
  source: string;
  relation: string;
  target: string;
  /** `null` = unconditional (paper rule 2). */
  condition: string | null;
  /** `null` only on imported/expert edges (Appendix B.4 coverage); required on refiner `add_edges`. */
  guidance: string | null;
  pitfalls: string | null;
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
- refiner `add_edges` entries carry `guidance` and `pitfalls` strings and a `condition` that is a string or `null`; imported edges may carry `null` in any field, and an absent field normalizes to `null` with a `missing-attribute` diagnostic;
- bounded attribute lengths and total serialized graph size;
- finite numeric settings and positive budgets;
- action bindings (`actionName ?? id`) against the provided tool catalog, **only when `enforceToolCatalog` is enabled** (forced off under `paperCompatible: true`, where a mismatch is a warning, per A10);
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

The PG SQLite backing opens its own connection to the configured PG database file through the exported driver resolver (A12) and owns a small dedicated schema (`pg_graphs`, `pg_heads`, `pg_revisions`, `pg_evaluations`, `pg_rounds`, `pg_rejections`); it does not share `SQLiteStorage`'s `entities`/`relations` tables. Use one `db.transaction(...)` that performs the expected-head predicate (`UPDATE pg_heads ... WHERE graph_id = ? AND head_version = ?` and check `changes === 1`) and inserts the revision, evaluation, and round record atomically; a `changes === 0` result rolls back and returns `conflict`. No provider/refiner/evaluator call occurs while the storage transaction is open.

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

1. **Locate:** before the first action use `entryNodeId`; thereafter exact-match the most recently recorded procedure/action identifier against node `id` in the pinned graph. If no `id` matches, MemoryJS additionally tries `actionName` bindings (design extension); if that yields more than one node, the step counts as unmatched. Case-folding or other normalization is never applied under `paperCompatible: true`.
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

Default MemoryJS serialization includes relation labels because they carry semantic information. A `paper-compatible` serializer reproduces the paper's demonstrated local serializer (Appendix B.5 "Serialized Local Graph Context"), which omits stored relation labels. Its shape, reconstructed from the paper's HotpotQA excerpt, is: [P3]

```text
Active Cognitive Node: [<node id>] (Type: <node type>)
Description: <node description>

Immediate Transition Options (Hop 1):
- Transition: [<source>] → [<target>] (Condition: <condition or "null">)
  * Guidance: <guidance>
  * Pitfalls to Avoid: <pitfalls>

Subsequent Horizon (Hop 2):
- Transition: [<source>] → [<target>] (Condition: ...)
  * Guidance: ...
  * Pitfalls to Avoid: ...
```

Transitions are grouped by hop distance from the active node; within a hop, MemoryJS orders them by `(source, target, relation)` so serialization is deterministic (the paper does not state an order). The full-graph variant binds the complete graph into the same slot with the header text given in Section 8.5.

Treat graph text, observations, tool results, file paths, and prior model output as untrusted data sections. PG guidance remains subordinate to the host's system instructions, authorization checks, and tool schemas. Never execute command text embedded in `guidance` or `pitfalls`.

### 8.5 Prompt templates (verbatim from the paper, Appendix B.5)

Implementations ship these two templates in `prompts.ts` with the placeholders below. Text outside `{...}` must match the paper; MemoryJS-specific additions go in a clearly separated trailing "Data handling" block, never interleaved. [P3]

**Guidance generation prompt (local subgraph; default).** Placeholders: `{task_description}`, `{graph_context_desc}`, `{subgraph_summary}`, `{query}`, `{recent_context}`, `{graph_source}`.

```text
You are an expert cognitive architect and execution guide for an AI agent solving the task: {task_description}
Here is {graph_context_desc}: {subgraph_summary}
Here is the current active query / observation: {query}
Here is the agent's recent execution trajectory: {recent_context}
Analyze this {graph_source} in the context of the agent's current progress. Using the condition, guidance, and pitfalls attributes carried by the edges in the graph context, generate clear, detailed, and actionable guidance advising the agent on exactly what step or strategy to pursue next, what pitfalls to avoid, and how to recover from recent failures if any. You must include any specific command patterns, file paths, tools, or arguments defined in the graph context if they are relevant to the next steps.
```

Local binding: `{graph_context_desc}` = "the localized Procedural Graph neighborhood around the agent's active node" (MemoryJS wording; the paper prints only the full-graph string), `{graph_source}` = "local subgraph". Full-graph binding (paper text): `{graph_context_desc}` = "the complete Procedural Graph governing the task structure and strategic guidance", `{subgraph_summary}` = the serialized full graph, `{graph_source}` = "complete Procedural Graph". The two variants differ only in these bindings.

**Refiner prompt (self-evolution).** Placeholders: `{task_description}`, `{mode}`, `{available_tools_list}`, `{attempts_block}`, `{current_graph_json}`, `{rejected_block}`.

```text
You are an expert cognitive architect optimizing a Procedural Graph for an intelligent agent. The Procedural Graph encodes structured procedural guidance.
Task context: {task_description}
Refinement mode: {mode}
Available Tool Actions (the agent can only execute these actions): {available_tools_list}
Recent execution trajectories: {attempts_block}
Current Procedural Graph representation: {current_graph_json}
Previously rejected candidates: {rejected_block}
Your job is to refine the Procedural Graph. Follow these guidelines based on the mode:
• static_onetime / static_incremental: Prune edges/nodes that lead to loops, deadlocks, or failures. Add missing nodes and edges that could fix the failures and improve performance for future tasks.
• scratch_onetime / scratch_incremental: If starting from scratch (the graph contains only Start → End), synthesize a brand new, complete Procedural Graph using the Available Tool Actions list, Status, and successful patterns in the trajectories. Otherwise, prune edges/nodes that lead to loops, deadlocks, or failures, and add missing nodes and edges based on the given graph.
Rules for nodes and edges.
1. Action Nodes. Any node of type ACTION must match one of the action/tool names in the "Available Tool Actions" list above.
2. Transition Conditions. If an edge has a condition, provide a natural-language semantic precondition under which this transition should fire (e.g., "When dialogue history has been parsed but target constraints are unknown"). Use null if the transition is unconditional.
3. Execution Guidance. For every edge added in add_edges, you MUST provide a guidance string detailing exactly what action to take next and the strategic rationale behind it.
4. Pitfalls. Provide a pitfalls string warning about premature actions, forbidden words, or common formatting pitfalls to avoid during this step.
5. Generality & Leak Prevention. The updated Procedural Graph must guide the agent effectively without overfitting to specific details of a single trajectory. Use high-level conceptual descriptions.
6. Node ID Compatibility. If refining an existing graph (static modes), you MUST preserve the existing node IDs (such as Month_Start, Decide_Capital, and the tool names) so they remain compatible with the environment's state tracker. Do not rename them.
7. Graph Structure. Follow the task's configured cycle policy. Every edge must reference existing nodes, and every node must have a directed path to a terminal node. The environment loop handles repetition across simulation cycles.
Please propose the exact set of edits to perform. You must output your edits as a single valid JSON block containing four arrays: add_nodes, delete_nodes, add_edges, and delete_edges. Output format must be exactly:
{
"add_nodes": [{"id":..., "type": "ACTION", "description":...}],
"delete_nodes": ["node_id"],
"add_edges": [{"source":..., "target":..., "relation":..., "condition":..., "guidance":..., "pitfalls":...}],
"delete_edges": [{"source":..., "target":...}]
}
Make sure to output ONLY the raw JSON block. Each entry in delete_edges removes all edges with the specified source and target, regardless of relation. To retain selected transitions between the same endpoints, include them in add_edges, which is applied after deletion.
```

`{attempts_block}` is the token-tailed concatenation `C_k` (PG-14) with each trajectory's score; `{rejected_block}` is `SerializeRejections(H_rejected)` (Section 9.8); `{current_graph_json}` is the canonical JSON of Section 6.3. The solver's own ReAct prompt (paper B.5, "Solver Execution Prompt") is **host-owned**; MemoryJS only returns the string bound to `{procedural_graph_guidance}`.

### 8.6 Budgets and usage accounting

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

Each training trajectory records task ID, graph revision, ordered actions/observations, and finite score in `[0,1]`. Training batches are sequential strides of the training split (paper: `S = 100` for HotpotQA, `S = 20` for MultiChallenge; MemoryJS exposes `batchSize`). The refiner "compares high-scoring traces with low-scoring ones; for tasks with binary outcomes, this reduces to successes versus failures" (Section 3.3). The paper does not define the partition threshold for non-binary scores; MemoryJS uses `successThreshold` (default `1.0`, i.e. only a perfect score counts as high; callers set it per metric) and records the value in the manifest. If all scores fall into one group, report the absence of a contrast rather than fabricating one.

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
6. run endpoint, entry-node, and terminal-reachability validation (paper structural checks); then, only when `enforceToolCatalog` is on, catalog validation (A10).

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

- `fixed_expert` - paper Mode 1, no mutation (the paper assigns no refinement-mode string to Mode 1; this name is MemoryJS's);
- `static_incremental` - expert-seeded Mode 3 behavior, validation-gated between batches;
- `scratch_incremental` - `Start -> End` skeleton, Mode 5 behavior, validation-gated between batches.

The skeleton is `nodes: [Start (STATE), End (STATE)]`, `edges: [(Start, LEADS_TO, End)]` with `condition: null`, `guidance: ''`, `pitfalls: ''`; the paper specifies only "Start → End with no intermediate nodes or additional transitions", so the relation label and empty attributes are MemoryJS defaults. "Starting from scratch" in the refiner prompt is detected structurally as exactly that skeleton.

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

- [ ] Extend `CreateRelationSchema`, `RelationSchema`, and `DeleteRelationsSchema` to preserve namespaced PG metadata without weakening unrelated fields; add an `IOManager` JSON round-trip test.
- [ ] Export the SQLite driver resolver (`resolveSQLiteDatabaseCtor`) from `SQLiteStorage.ts` (A12).
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
- action catalog mismatch as a warning under `paperCompatible` and as a rejection with `enforceToolCatalog`; static-mode rename;
- imported edge with absent `pitfalls` normalizes to `null` with a diagnostic; refiner `add_edges` entry missing `guidance` or `pitfalls` is a parse failure;
- paper-compatible serializer output matches the Appendix B.5 excerpt shape byte-for-byte on a fixture;
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

Also run targeted new PG unit/integration/storage contract suites in each phase. Real-model evaluation remains explicitly opt-in and budgeted. Toolchain facts the code must match are listed in A14 (Zod v4, TypeScript 7, Vitest 5, NodeNext `.js` import suffixes, oxlint).

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
- [ ] Relation runtime schemas (`CreateRelationSchema`, `RelationSchema`, `DeleteRelationsSchema`) preserve PG metadata through `RelationManager`, storage, and `IOManager` JSON round-trip.
- [ ] Tool-catalog enforcement is off under `paperCompatible` and on by default otherwise; the profile is recorded in the manifest.
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
- **C4:** [`src/types/types.ts`](../src/types/types.ts) (`Relation.metadata?: Record<string, unknown>`; `IGraphStorage` declared here), [`src/utils/schemas.ts`](../src/utils/schemas.ts), [`src/core/RelationManager.ts`](../src/core/RelationManager.ts), [`src/features/IOManager.ts`](../src/features/IOManager.ts)
- **C5:** [`src/search/LLMQueryPlanner.ts`](../src/search/LLMQueryPlanner.ts), [`src/agent/reconstruction/MemoryDistiller.ts`](../src/agent/reconstruction/MemoryDistiller.ts)
- **C6:** [`src/core/ManagerContext.ts`](../src/core/ManagerContext.ts)
- **C7:** [`src/core/StorageFactory.ts`](../src/core/StorageFactory.ts), [`src/core/GraphStorage.ts`](../src/core/GraphStorage.ts), [`src/core/SQLiteStorage.ts`](../src/core/SQLiteStorage.ts), [`src/core/TransactionManager.ts`](../src/core/TransactionManager.ts)
- **C8:** [`package.json`](../package.json), [`tsconfig.json`](../tsconfig.json), [`vitest.config.ts`](../vitest.config.ts), [`scripts/lint-rules.mjs`](../scripts/lint-rules.mjs), [`scripts/check-exports.mjs`](../scripts/check-exports.mjs), [`tools/plan-doc-audit/audit.ts`](../tools/plan-doc-audit/audit.ts), [`src/agent/procedural/index.ts`](../src/agent/procedural/index.ts), [`src/agent/index.ts`](../src/agent/index.ts), [`tests/unit/agent/ProcedureManager.test.ts`](../tests/unit/agent/ProcedureManager.test.ts), [`tests/unit/agent/ProcedureStore.test.ts`](../tests/unit/agent/ProcedureStore.test.ts).
- **C7 (addendum):** [`src/core/nodeSqliteAdapter.ts`](../src/core/nodeSqliteAdapter.ts), [`src/utils/durableWriteFile.ts`](../src/utils/durableWriteFile.ts), [`src/utils/AsyncMutex.ts`](../src/utils/AsyncMutex.ts).

Where documentation prose and active code differ, implementation decisions in this plan follow the audited source and `package.json`. Any future source change that materially alters the cited behavior should trigger a plan re-audit before implementation.

## 17. Post-build review (2026-09-11)

The implementation landed on `master` between `cbb25e6` and `68618eb` (PRs #127–#141). A review of the built code against this plan found the following gaps, all closed in the follow-up hardening change:

| Plan item | Gap in the build | Resolution |
|---|---|---|
| §14 operational diagnostics | No health surface for head version / digest / counts | `ProceduralGraphManager.stats(graphId)` |
| §8.6 wall-clock budget | Only `AbortSignal` and `maxRounds` bounded `evolve` | `PGEvolutionOptions.maxWallClockMs` → `'wall-clock-exhausted'` |
| §9.1 caller-owned callbacks | A throwing `rollout` escaped `evolve()` with no round record | Caught per task; `'fail-round'` records `rollout-failed`, `'score-zero'` substitutes an empty zero trajectory |
| §9.8 rejection memory | Records had no `graphId`; unattributable rejections fell back to the alphabetically first graph | `PGRejectionRecord.graphId` written by the loop; fallback kept only for legacy records |
| PG-02 / A11 | Absent import attributes normalized silently | `missing-attribute` warnings on `parseSnapshot` / `importGraph` / `createGraph` |
| §8.4 prompt safety | No untrusted-data section in prompts | `DATA_HANDLING_NOTE` appended outside `paperCompatible` |
| §8.6 output budget | Truncation at `maxOutputChars` was inferable only from length | `completeWithBudget.truncated`; `output-truncated` refiner diagnostic |
| A2 / §14 path handling | PG backing paths skipped the traversal check the primary path gets | `validateFilePath(..., false)` in `createProceduralGraphBacking` |
| A6 lifecycle | `close()` detached `dispose()` with `void`, so a failure became an unhandled rejection | Logged and swallowed |
| §10 result contract | Missing graph and policy denial both reported as `'conflict'` / `'aborted'` | `'not-found'` and `'policy-denied'` stop reasons |

Performance and stability changes made in the same pass (no contract change): append-only JSONL persistence with torn-tail compaction, SQLite prepared-statement cache and indexes, iterative cycle detection, elimination of redundant clone+digest passes in candidate preparation and session pinning, rolling-hash leak detection, single Zod pass per refiner edge. A Wave 1 test that wrote stub `.ts` files into `src/` at test time was removed; tests no longer write outside temp directories.
