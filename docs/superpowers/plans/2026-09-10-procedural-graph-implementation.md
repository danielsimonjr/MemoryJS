# Procedural Graph — Subagent-Driven Implementation Plan

> **Generated:** 2026-09-10 from `master` at `914324c` (source baseline `549ce11`; see the feature plan header).
> **Design source:** [`docs/PROCEDURAL_GRAPH_FEATURE_PLAN.md`](../../PROCEDURAL_GRAPH_FEATURE_PLAN.md) (the "feature plan"). Every requirement ID (`PG-01`…`PG-16`) and audit finding (`A1`…`A14`) referenced below is defined there. This file is the *how*: four Haiku-class agents, three dependency waves, one dispatchable prompt per agent per wave.
> **Paper:** Lu, Chen, Wu, Arık, *Procedural Graphs: Self-Evolving Execution Structures for LLM Agents*, arXiv:2609.09153v1. Agents do **not** need the PDF; every paper-derived string they must reproduce is quoted verbatim in the feature plan (Sections 2, 8.4, 8.5, 9.7).

---

## 0. How to use this file

1. Dispatch agents wave by wave. Agents inside a wave run concurrently; a wave starts only when the previous wave's **gate** passes.
2. Each agent block is self-contained: the `prompt` field is what you paste into `Agent({ subagent_type: "general-purpose", model: "haiku", ... })`. Prepend the **Common preamble** (Section 1) to every prompt verbatim.
3. Agents never invent APIs. Section 2 lists every existing symbol they may touch, with its verified signature and file. If a needed symbol is not in Section 2 or in this plan's interface specs, the agent must stop and report rather than guess.
4. After each wave, the orchestrator runs the wave gate (Section 3) and flips `- [ ]` → `- [x]` here.
5. One agent = one commit series on the feature branch. Commit message prefix is fixed per agent (`feat(pg-core)`, `feat(pg-store)`, `feat(pg-guide)`, `feat(pg-evolve)`).

### Agent roster

| Agent | Codename | Owns (exclusively) | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|---|---|
| **A** | `pg-core` | `src/types/proceduralGraph.ts`, `src/agent/procedural/graph/{ProceduralGraph,ProceduralGraphSchemas,ProceduralGraphValidator,ProceduralGraphSerializer,canonical}.ts` + their tests | Types, schemas, graph core, validator, canonical digest, serializers | Candidate preparation + cycle policies | Fixtures for Appendix F cases; review pass |
| **B** | `pg-store` | `src/utils/schemas.ts` (relation schemas only), `src/core/SQLiteStorage.ts` (export only), `src/agent/procedural/graph/backing/**` + tests | Relation-schema fix + driver-resolver export | JSONL + SQLite backings + contract suite | Crash/recovery + conflict tests; `IOManager` round-trip |
| **C** | `pg-guide` | `src/agent/procedural/graph/{prompts,ProceduralGraphSession,ProceduralGuidance,CompletionProvider}.ts` + tests | Prompts + provider adapter + token tail util | Session + guidance orchestration | Behavioral fixtures; budget tests |
| **D** | `pg-evolve` | `src/agent/procedural/graph/{ProceduralGraphRefiner,ProceduralGraphEvolution,ProceduralGraphManager,ProcedureGraphAdapter,index}.ts`, barrels, `ManagerContext` factory, docs | Refiner parsing (pure) | Evolution loop | Facade, `ManagerContext.createProceduralGraph`, adapter, barrels, README/CLAUDE.md |

File ownership is exclusive. If an agent needs a change in a file it does not own, it writes the request into its final report; the orchestrator relays it. This is the single most effective hallucination guard: no agent edits code it has not read end to end.

---

## 1. Common preamble (prepend to every agent prompt)

```text
You are implementing part of the Procedural Graph (PG) feature in the MemoryJS TypeScript repository at /home/user/MemoryJS. Read docs/PROCEDURAL_GRAPH_FEATURE_PLAN.md Sections 1, 2, 6 and the section(s) named in your task BEFORE writing code. Read docs/superpowers/plans/2026-09-10-procedural-graph-implementation.md Section 1 and Section 2 in full.

HARD RULES (violating any of these fails the task):
1. Toolchain: TypeScript 7, Zod v4 (`import { z } from 'zod'`), Vitest 5 with `globals: true`, ESM with NodeNext resolution. Every relative import MUST end in `.js` (e.g. `import { X } from './ProceduralGraph.js'`). Use `import type` for type-only imports.
2. No new dependencies. Hashing uses `createHash('sha256')` from 'node:crypto'. Graph algorithms use native Map/Set/arrays.
3. `src/types/**` is a LEAF layer: files there may import ONLY from other `src/types/*` files or `zod`-free external types. Never import from agent/core/utils/search/features/adapters/security/cli/workers into src/types, not even `import type`. `node scripts/check-lint-rules.mjs` enforces this.
4. Only edit files listed under "Owns" for your agent. If you need a change elsewhere, describe it in your final report under "Requests for other agents" and continue with a local workaround only if the plan explicitly allows one.
5. Every public function/class you add must match the interface spec in the plan EXACTLY (names, parameter order, return types). Do not add "helpful" extra public methods. Private helpers are fine.
6. Never `throw` for expected validation outcomes; return the `PGResult`/diagnostics unions specified. Throw only for programmer errors (e.g. missing required constructor argument).
7. Tests: put them at the exact paths given. Use `describe`/`it`/`expect` from 'vitest'. Temp files go under `fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'))` and are removed in `afterEach`. Every test file must run green with `bunx vitest run <path>`.
8. Before reporting done run, in order: `bun run typecheck`, `bun run lint`, `bunx vitest run tests/unit/agent/procedural/graph`, and (if you touched src/utils/schemas.ts or src/core) `bunx vitest run tests/unit/utils tests/unit/core`. Paste the last 20 lines of each command's output into your report. If any command fails and the failure is in a file you do not own, report it; do not "fix" other agents' files.
9. Do not modify docs/PROCEDURAL_GRAPH_FEATURE_PLAN.md. Do not modify CHANGELOG.md unless your task says so.
10. Paper strings (prompt templates, serializer format, relation vocabulary) must be copied character-for-character from docs/PROCEDURAL_GRAPH_FEATURE_PLAN.md Sections 2, 8.4 and 8.5. Do not paraphrase them.
11. Commit after each green milestone with the prefix given in your task. Do not push; the orchestrator pushes.
12. Your final message must contain: files created/modified, test counts, the verification output from rule 8, open questions, and "Requests for other agents".
```

---

## 2. Verified repository facts agents may rely on

Everything below was read from the source tree at the baseline. Line numbers are approximate; names and signatures are exact.

### 2.1 Symbols agents may import

| Symbol | File | Verified signature / shape |
|---|---|---|
| `Relation` | `src/types/types.ts` | `{ from: string; to: string; relationType: string; createdAt?: string; lastModified?: string; weight?: number; confidence?: number; properties?: RelationProperties; metadata?: Record<string, unknown> }` |
| `Entity` | `src/types/types.ts` | `{ name: string; entityType: string; observations: string[]; ... }` (name ≤ 500 chars, validated by `entityNameSchema`) |
| `IGraphStorage` | `src/types/types.ts` (line ~1193) | interface; **not** in `src/core`. PG backings do NOT implement it. |
| `LLMProvider` | `src/search/LLMQueryPlanner.ts` | `interface LLMProvider { complete(prompt: string): Promise<string> }` |
| `UsageReportingLLMProvider` | `src/agent/reconstruction/MemoryDistiller.ts` | `extends LLMProvider { getLastUsage?(): { inputTokens: number; outputTokens: number } \| undefined }` |
| `durableWriteFile` | `src/utils/durableWriteFile.ts` | `async function durableWriteFile(target: string, content: string \| Buffer): Promise<void>` — temp file + fsync + rename; creates parent dir. |
| `AsyncMutex` | `src/utils/AsyncMutex.ts` | `class AsyncMutex { constructor(options?: AsyncMutexOptions); acquire(): Promise<() => void> }` — usage: `const release = await mutex.acquire(); try { ... } finally { release(); }` |
| `ValidationError` | `src/utils/errors.ts` | `class ValidationError extends KnowledgeGraphError` — constructor `(message: string, errors?: string[])` (check the file before use) |
| `logger` | `src/utils/logger.ts` | `logger.warn(message: string, meta?: object)`, also `.info/.debug/.error` |
| `createNodeSqliteDatabaseCtor`, `isNodeSqliteAvailable` | `src/core/nodeSqliteAdapter.ts` | `createNodeSqliteDatabaseCtor(): new (path: string, options?: unknown) => AdaptedDatabase`; `isNodeSqliteAvailable(): boolean` |
| `AdaptedDatabase` (shape) | `src/core/nodeSqliteAdapter.ts` | `{ exec(sql): void; prepare(sql): { run(...p): { changes: number; lastInsertRowid }; get(...p): unknown; all(...p): unknown[] }; pragma(src, opts?): unknown; transaction<T extends (...a) => unknown>(fn: T): T; close(): void }` — this is the common subset of better-sqlite3 and the node:sqlite adapter. PG SQLite code must use ONLY this subset. |
| `__resetDatabaseCtorForTests` | `src/core/SQLiteStorage.ts` | `(): void` — clears the cached driver so `MEMORY_SQLITE_DRIVER` can be re-read. |
| `ProcedureManager` | `src/agent/procedural/ProcedureManager.ts` | `new ProcedureManager(entityManager, relationManager)`; methods `addProcedure`, `getProcedure(id)`, `getStep`, `getNextStep`, `openSequencer(id)`, `invoke(id)`, `matchProcedure(ctx, candidates, threshold?)`, `refineProcedure(...)` |
| `Procedure`, `ProcedureStep` | `src/types/procedure.ts` | `ProcedureStep { order: number; action: string; parameters: Record<string,string>; fallback?: ProcedureStep; timeout?: number }`; `Procedure { id; name; description; steps: ProcedureStep[]; triggers?; successRate?; executionCount?; createdAt?; lastModified? }` |
| `StepSequencer` | `src/agent/procedural/StepSequencer.ts` | `current()`, `next()`, `branchToFallback()`, `isComplete()`, `reset()`. Fallback semantics: after `branchToFallback()` the fallback step is current; `next()` clears the fallback AND advances past the original step (resume at the next main step). |
| `RelationManager.createRelations` | `src/core/RelationManager.ts` | validates with `BatchCreateRelationsSchema.safeParse(relations)` then acquires `storage.graphMutex`. Duplicate identity = `(from, to, relationType)`. |
| `ManagerContext` | `src/core/ManagerContext.ts` | `get procedureManager()` lazy getter pattern at ~line 1107; `close(): void` at ~line 1658 closes `this.storage` only. Constructor builds storage via `createStorageFromPath(validatedPath)` (env `MEMORY_STORAGE_TYPE` wins; `opts.storageType` is ignored). |
| Barrels | `src/agent/procedural/index.ts`, `src/agent/index.ts` (~line 376 "3B.4 Procedural Memory" block), `src/types/index.ts`, `src/index.ts` (`export * from './agent/index.js'`) | Named re-exports; `export type { ... }` for types. |

### 2.2 Schema facts (`src/utils/schemas.ts`)

- `entityNameSchema`: `z.string().min(1).max(500)...`; `relationTypeSchema`: `.max(100)`.
- `RelationSchema = z.object({ from, to, relationType, createdAt?, lastModified? }).strict()` — used by `IOManager` JSON import (`src/features/IOManager.ts` ~lines 1051, 1079).
- `CreateRelationSchema = z.object({ from, to, relationType, createdAt?, lastModified?, weight?, confidence?, properties? }).strict()` — no `metadata`.
- `BatchCreateRelationsSchema = z.array(CreateRelationSchema).max(1000)`; `DeleteRelationsSchema = z.array(CreateRelationSchema).min(1).max(1000)`.
- Zod v4: `.strict()` and `.strip()` exist; `z.record(z.string(), z.unknown())` is the record form (two args in v4).

### 2.3 Environment / storage facts

- `MEMORY_STORAGE_SEGMENT_COUNT`: regex `^[1-9][0-9]*$`, integer in `[2, 1024]` activates segment mode in `GraphStorage`. PG JSONL backing must **refuse** to open when this env var parses into that range (A3).
- `MEMORY_SQLITE_DRIVER=node` forces the `node:sqlite` driver; otherwise `better-sqlite3` is tried first, then `node:sqlite` fallback. The resolver `loadDatabaseCtor()` in `SQLiteStorage.ts` is currently **not exported** (A12).
- Vitest config: `include: ['tests/**/*.test.ts']`, performance dir excluded by default.
- Existing procedural tests: `tests/unit/agent/ProcedureManager.test.ts`, `tests/unit/agent/ProcedureStore.test.ts`. They must keep passing.

### 2.4 Things that do NOT exist (do not reference them)

`src/core/IGraphStorage.ts`, `ctx.proceduralGraph` getter, `ProcedureGraphAdapter` (until Agent D creates it), any `src/agent/procedural/graph/**` file (until created in this plan), `tests/unit/agent/procedural/**` directory (create it), a `tokenizer` in the repo (the PG tokenizer is caller-supplied; tests use a whitespace tokenizer defined in the test file).

---

## 3. Waves and gates

| Wave | Agents (concurrent) | Gate (orchestrator runs) |
|---|---|---|
| **1** | A, B, C, D (all pure / leaf work; no cross-agent imports except A's types by C and D, which are stubbed by the interface spec below) | `bun run typecheck && bun run lint && bunx vitest run tests/unit/agent/procedural/graph tests/unit/utils/schemas.test.ts tests/unit/core/SQLiteStorage.test.ts` green; A's exported symbols match Section 4.1 exactly (`grep -n "^export" src/agent/procedural/graph/*.ts`). |
| **2** | A, B, C, D | Same as Wave 1 plus `tests/unit/agent/procedural/graph/backing/**` (both drivers) and `tests/integration/procedural-graph-guidance.test.ts` green. |
| **3** | B, C, D (A does review + fixtures) | `bun run build && bun run test:ci` green; `node -e "import('./dist/index.js').then(m=>console.log(typeof m.ProceduralGraphManager))"` prints `function`; `tests/unit/agent/ProcedureManager.test.ts` unchanged and green. |

Ordering rule inside a wave: agents C and D import types from `src/types/proceduralGraph.ts` (Agent A, Wave 1). To let all four start simultaneously, **Agent A's first commit in Wave 1 is the types file alone**, pushed to the branch within its first milestone; the orchestrator relays that commit hash to C and D, who `git pull` before writing code. If A is late, C and D begin with prompts/tests that need no types.

---

## 4. Interface specifications (authoritative)

Agents implement exactly these. Anything not specified is a private detail.

### 4.1 `src/types/proceduralGraph.ts` (Agent A) — leaf types, no runtime code

```typescript
/** @module types/proceduralGraph  @experimental */
export type PGBuiltInRelation = 'LEADS_TO' | 'TRIGGERS' | 'PROVIDES_INPUT_FOR' | 'CONVERGES_TO';
export const PG_BUILT_IN_RELATIONS: readonly PGBuiltInRelation[]; // ['LEADS_TO','TRIGGERS','PROVIDES_INPUT_FOR','CONVERGES_TO'] — const arrays are allowed in src/types
export type PGNodeType = 'ACTION' | 'SKILL' | 'REASONING' | 'STATE';
export interface PGNode { id: string; type: PGNodeType; description: string; actionName?: string }
export interface PGEdge { source: string; relation: string; target: string; condition: string | null; guidance: string | null; pitfalls: string | null }
export type PGCyclePolicy = 'allow' | 'repair' | 'reject';
export interface PGSnapshot {
  schemaVersion: 1; graphId: string; revisionId: string; parentRevisionId?: string;
  entryNodeId: string; relationVocabulary: readonly string[]; cyclePolicy: PGCyclePolicy;
  toolCatalogHash: string; nodes: readonly PGNode[]; edges: readonly PGEdge[];
}
export interface PGEditSet {  // paper's four arrays (PG-06)
  add_nodes: PGNode[]; delete_nodes: string[];
  add_edges: PGEdge[]; delete_edges: Array<{ source: string; target: string }>;
}
export type PGRefinementMode = 'static_onetime' | 'static_incremental' | 'scratch_onetime' | 'scratch_incremental';
export type PGConstructionMode = 'fixed_expert' | 'static_incremental' | 'scratch_incremental' | 'static_onetime' | 'scratch_onetime';
export interface PGDiagnostic { severity: 'error' | 'warning' | 'info'; code: string; message: string; nodeId?: string; edge?: { source: string; target: string; relation?: string }; editIndex?: number }
export interface PGValidationReport { ok: boolean; diagnostics: PGDiagnostic[] }
export interface PGTraceStep { action: string; nodeId?: string; observation?: string; at?: string }
export interface PGTrajectory { taskId: string; revisionId: string; steps: PGTraceStep[]; score: number; outcome?: 'success' | 'failure' | 'unknown' }
export interface PGTask { id: string; description: string; payload?: unknown }
export interface PGEvaluationReport { fingerprint: string; graphDigest: string; taskCount: number; completed: number; meanScore: number; scores: Array<{ taskId: string; score: number | null; error?: string }>; incomplete: boolean; evaluatedAt: string }
export interface PGHead { graphId: string; revisionId: string; headVersion: number; graphDigest: string; validationMean: number | null; evaluationFingerprint: string | null; validationReportRef: string | null; updatedAt: string }
export interface PGRoundRecord { runId: string; round: number; retainedRevisionId: string; candidateRevisionId?: string; outcome: 'accepted' | 'rejected-validation' | 'rejected-structural' | 'evaluation-error' | 'conflict'; baselineMean: number | null; candidateMean: number | null; diagnostics: PGDiagnostic[]; repairs: Array<{ source: string; target: string; relation: string }>; startedAt: string; finishedAt: string }
export interface PGRejectionRecord { runId: string; round: number; proposalDigest: string; edits: PGEditSet; candidateDigest?: string; candidateRevisionId?: string; reason: 'structural' | 'validation' | 'parse'; diagnostics: PGDiagnostic[]; candidateMean?: number; retainedMean: number | null; retainedRevisionId: string; trajectoryRefs: string[]; fingerprint: string; recordedAt: string }
export type PGGuidanceMode = 'generative' | 'attributes-only' | 'disabled';
export interface PGLocalization { matched: boolean; nodeId?: string; hops: Array<{ hop: number; edges: PGEdge[] }>; usedFullGraph: boolean; reason?: 'entry' | 'exact-id' | 'action-binding' | 'ambiguous' | 'not-found' }
export type PGGuidanceResult =
  | { status: 'ok'; mode: 'generative' | 'attributes-only'; guidance: string; localization: PGLocalization; usage?: { input: number; output: number; approximate: boolean }; degraded?: { from: 'generative'; error: string } }
  | { status: 'disabled' }
  | { status: 'context-budget-exceeded'; localization: PGLocalization; serializedBytes: number; budgetBytes: number }
  | { status: 'provider-error'; error: string; localization: PGLocalization };
```

Rules: no `zod`, no functions except none; `PG_BUILT_IN_RELATIONS` is the only runtime value. Re-export every name from `src/types/index.ts` (Agent D does the barrel in Wave 3; Agent A adds the block itself in Wave 1 because `src/types/index.ts` is a types-layer file — **exception to ownership**, limited to appending one `export type {...}` block plus `export { PG_BUILT_IN_RELATIONS }`).

### 4.2 `ProceduralGraphSchemas.ts` (Agent A) — Zod v4, implementation layer

```typescript
export const PG_LIMITS: { maxNodes: 2000; maxEdges: 8000; maxIdLength: 200; maxTextLength: 4000; maxSerializedBytes: 2_000_000 }; // must admit 131 nodes / 265 triplets (PG-08 sizing)
export const PGNodeSchema, PGEdgeSchema, PGSnapshotSchema, PGEditSetSchema; // z.ZodType of the matching types; strict objects
export function parseSnapshot(input: unknown): { ok: true; value: PGSnapshot } | { ok: false; diagnostics: PGDiagnostic[] };
export function parseEditSet(raw: string): { ok: true; value: PGEditSet } | { ok: false; diagnostics: PGDiagnostic[] };
```

`parseEditSet` rules (feature plan 9.4): input must be a single raw JSON object — reject leading/trailing prose or code fences (`code: 'not-raw-json'`), unknown top-level keys, non-array fields, duplicate node ids inside `add_nodes` (`'duplicate-add-node'`), duplicate `(source,relation,target)` in `add_edges`, an `add_edges` entry whose `guidance` or `pitfalls` is not a non-empty string (`'missing-required-attribute'`), `condition` not string/null, node `type` outside `PGNodeType`. `delete_edges` items must have exactly `source` and `target`. Diagnostics carry `editIndex`.

### 4.3 `canonical.ts` (Agent A)

```typescript
export function canonicalJson(value: unknown): string;   // sorted keys, no whitespace, arrays in given order, \u escapes stable
export function sha256Hex(input: string): string;
export function graphDigest(snapshot: PGSnapshot): string; // over { schemaVersion, entryNodeId, relationVocabulary(sorted), cyclePolicy, toolCatalogHash, nodes sorted by id, edges sorted by (source,target,relation) } — EXCLUDES graphId/revisionId/parentRevisionId/timestamps
export function toolCatalogHash(tools: readonly string[]): string; // sha256 of canonicalJson(sorted unique tools)
export function storageKey(kind: 'graph'|'revision'|'node'|'evaluation'|'rejection'|'run'|'head', tuple: readonly string[]): string; // `pg:${kind}:${sha256Hex(canonicalJson(tuple))}` — always < 100 chars (A5)
export function evaluationFingerprint(parts: Record<string, unknown>): string; // sha256 of canonicalJson(parts)
```

### 4.4 `ProceduralGraph.ts` (Agent A) — immutable snapshot wrapper

```typescript
export class ProceduralGraph {
  static fromSnapshot(snapshot: PGSnapshot): ProceduralGraph;          // deep-freezes a copy; does NOT validate (use validator)
  readonly snapshot: PGSnapshot;
  readonly digest: string;                                             // graphDigest(snapshot), computed once
  hasNode(id: string): boolean; getNode(id: string): PGNode | undefined;
  outgoing(id: string): readonly PGEdge[];                             // sorted by (target, relation)
  incoming(id: string): readonly PGEdge[];
  terminals(): readonly string[];                                      // zero out-degree node ids, sorted
  locate(lastAction: string | undefined, opts?: { allowActionBinding?: boolean }): PGLocalization; // PG-03; undefined => entry node; exact id match; then optional actionName binding; ambiguity => matched:false reason:'ambiguous'; hops:[] here (filled by neighborhood)
  neighborhood(nodeId: string, hops: number): PGLocalization['hops'];  // outgoing BFS by hop; an edge appears in the first hop that reaches it; visited-edge set bounds cycles
  reachesTerminal(): { ok: true } | { ok: false; unreachable: string[] }; // every node has a directed path to some terminal (PG-08)
  findCycleClosingEdges(): PGEdge[];                                   // deterministic: DFS from entryNodeId then remaining nodes in sorted id order; back edges in discovery order
  withEdits(edits: PGEditSet): { graph: ProceduralGraph; diagnostics: PGDiagnostic[] }; // applies 9.5 steps 1-4 ONLY (no cycle policy, no validation); new revisionId is caller's job — keeps same ids
}
```

### 4.5 `ProceduralGraphValidator.ts` (Agent A)

```typescript
export interface PGValidatorOptions { toolCatalog?: readonly string[]; enforceToolCatalog: boolean; paperCompatible: boolean; staticMode?: boolean; baselineNodeIds?: readonly string[] }
export function validateSnapshot(snapshot: PGSnapshot, opts: PGValidatorOptions): PGValidationReport;
// checks, in order, each emitting a coded diagnostic: 'duplicate-node-id','duplicate-edge','unknown-relation','missing-endpoint','missing-entry','unreachable-terminal','tool-catalog-mismatch' (severity 'error' when enforceToolCatalog is true, 'warning' otherwise; only evaluated when toolCatalog is provided), 'static-node-id-removed' (staticMode && baselineNodeIds not all present), 'limit-exceeded'
export function applyCyclePolicy(graph: ProceduralGraph, policy: PGCyclePolicy): { graph: ProceduralGraph; repairs: PGEdge[]; diagnostics: PGDiagnostic[] };
// 'allow' => unchanged; 'repair' => remove findCycleClosingEdges() iteratively until acyclic, each removal recorded; 'reject' => diagnostic 'cycle-detected' error if any cycle
export function prepareCandidate(retained: ProceduralGraph, edits: PGEditSet, opts: PGValidatorOptions & { cyclePolicy: PGCyclePolicy; nextRevisionId: string; parentRevisionId: string }): { ok: true; candidate: ProceduralGraph; repairs: PGEdge[]; diagnostics: PGDiagnostic[] } | { ok: false; diagnostics: PGDiagnostic[]; repairs: PGEdge[] };
// = withEdits -> applyCyclePolicy -> validateSnapshot (feature plan 9.5); ok:false iff any 'error' diagnostic; sets revisionId/parentRevisionId on the candidate snapshot
```

### 4.6 `ProceduralGraphSerializer.ts` (Agent A)

```typescript
export type PGSerializerStyle = 'paper-compatible' | 'memoryjs';
export function serializeLocalContext(graph: ProceduralGraph, loc: PGLocalization, style: PGSerializerStyle): string; // paper shape in feature plan 8.4; 'memoryjs' style adds ` [relation]` after the target bracket
export function serializeFullGraph(graph: ProceduralGraph, style: PGSerializerStyle): string; // header "Complete Procedural Graph:" then every node "Node: [id] (Type: T) — description" sorted by id, then all edges in the same transition block format sorted by (source,target,relation)
export function serializeGraphJson(graph: ProceduralGraph): string; // canonicalJson of { nodes, edges } for {current_graph_json}
```

`condition: null` prints as `(Condition: null)`; `null` guidance/pitfalls print as `* Guidance: (none)` / `* Pitfalls to Avoid: (none)`.

### 4.7 Backing contract (Agent B) — `backing/IProceduralGraphBacking.ts`

```typescript
export interface PGCommitInput { expectedHeadVersion: number; revision: PGSnapshot; validation: PGEvaluationReport; round: PGRoundRecord }
export type PGCommitResult = { status: 'committed'; head: PGHead } | { status: 'conflict'; currentHead: PGHead | undefined };
export interface IProceduralGraphBacking {
  readonly kind: 'jsonl' | 'sqlite' | 'memory';
  createGraph(revision: PGSnapshot): Promise<PGHead>;                       // headVersion 1, validationMean null; rejects if graphId exists ('graph-exists')
  loadHead(graphId: string): Promise<PGHead | undefined>;
  loadRevision(graphId: string, revisionId: string): Promise<PGSnapshot | undefined>;
  listRevisions(graphId: string, page: { offset: number; limit: number }): Promise<{ items: Array<{ revisionId: string; parentRevisionId?: string; graphDigest: string; createdAt: string }>; total: number }>;
  commitRetainedRevision(input: PGCommitInput): Promise<PGCommitResult>;   // atomic: revision + evaluation + round + head bump (headVersion = expected + 1)
  setHead(graphId: string, revisionId: string, expectedHeadVersion: number, round: PGRoundRecord): Promise<PGCommitResult>; // rollback: existing revision only; validationMean/fingerprint copied from that revision's stored evaluation if any, else null
  saveEvaluation(graphId: string, revisionId: string, report: PGEvaluationReport): Promise<void>; // baseline reports (not tied to a commit); keyed by (graphId, revisionId, fingerprint)
  loadEvaluation(graphId: string, revisionId: string, fingerprint: string): Promise<PGEvaluationReport | undefined>;
  appendRejection(record: PGRejectionRecord): Promise<void>;
  listRejections(graphId: string, page: { offset: number; limit: number }): Promise<{ items: PGRejectionRecord[]; total: number }>;
  appendRound(graphId: string, round: PGRoundRecord): Promise<void>;
  close(): Promise<void>;
}
export class InMemoryProceduralGraphBacking implements IProceduralGraphBacking { constructor() }
export class JsonlProceduralGraphBacking implements IProceduralGraphBacking { static async open(filePath: string): Promise<JsonlProceduralGraphBacking> } // throws Error('PG JSONL backing does not support MEMORY_STORAGE_SEGMENT_COUNT>=2') when segment env active (same regex/range as GraphStorage)
export class SqliteProceduralGraphBacking implements IProceduralGraphBacking { static async open(dbPath: string): Promise<SqliteProceduralGraphBacking> }
export function createProceduralGraphBacking(config: { type: 'jsonl' | 'sqlite' | 'memory'; path?: string }): Promise<IProceduralGraphBacking>; // NEVER reads MEMORY_STORAGE_TYPE (A2)
```

JSONL layout: one file; each line `{"kind":"head"|"revision"|"evaluation"|"round"|"rejection", ...}`. Full state is loaded at `open()`, mutated in memory under an `AsyncMutex`, and re-published as a whole file via `durableWriteFile` on every write (feature plan 7.4). Head lines are append-only with increasing `headVersion`; the latest wins on load.

SQLite layout: tables `pg_heads(graph_id PK, revision_id, head_version, graph_digest, validation_mean, evaluation_fingerprint, validation_report_ref, updated_at)`, `pg_revisions(graph_id, revision_id, parent_revision_id, graph_digest, created_at, snapshot_json, PRIMARY KEY(graph_id, revision_id))`, `pg_evaluations(graph_id, revision_id, fingerprint, report_json, PRIMARY KEY(graph_id, revision_id, fingerprint))`, `pg_rounds(id INTEGER PK, graph_id, run_id, round, record_json)`, `pg_rejections(id INTEGER PK, graph_id, record_json, recorded_at)`. `PRAGMA journal_mode=WAL`. Commit = one `db.transaction`; head predicate `UPDATE pg_heads SET ... WHERE graph_id=? AND head_version=?` with `changes === 1`, else throw inside the transaction (rolls back) and return `{ status: 'conflict' }`.

### 4.8 Guidance layer (Agent C)

```typescript
// CompletionProvider.ts
export interface PGCompletionProvider { complete(prompt: string, opts?: { signal?: AbortSignal }): Promise<string>; getLastUsage?(): { inputTokens: number; outputTokens: number } | undefined; readonly identity?: string }
export function adaptLLMProvider(p: LLMProvider & { getLastUsage?(): ... }): PGCompletionProvider;
export async function completeWithBudget(p: PGCompletionProvider, prompt: string, opts: { timeoutMs: number; maxOutputChars: number; signal?: AbortSignal }): Promise<{ ok: true; text: string; usage: { input: number; output: number; approximate: boolean } } | { ok: false; error: string; usage?: ... }>; // late response after timeout is discarded; usage approximate = ceil(chars/4) when getLastUsage absent

// tokenTail.ts
export interface PGTokenizer { encode(text: string): number[]; decode(tokens: number[]): string }
export function tokenTail(text: string, maxTokens: number, tokenizer: PGTokenizer): string; // PG-14: keep final maxTokens tokens, order preserved; shorter input unchanged
export function concatTrajectories(trajectories: readonly PGTrajectory[]): string; // deterministic: input order; per-trajectory block "### Task <id> (score <score>)" then one line per step "Action: <action>\nObservation: <observation|''>"

// prompts.ts — constants copied verbatim from feature plan 8.5
export const GUIDANCE_PROMPT_TEMPLATE: string; export const REFINER_PROMPT_TEMPLATE: string;
export const FULL_GRAPH_CONTEXT_DESC: string; export const FULL_GRAPH_SOURCE: string; export const LOCAL_GRAPH_CONTEXT_DESC: string; export const LOCAL_GRAPH_SOURCE: string;
export function renderTemplate(template: string, bindings: Record<string, string>): string; // replaces {name}; throws on unbound placeholder

// ProceduralGraphSession.ts
export interface PGSessionOptions { taskDescription: string; toolCatalog: readonly string[]; hopLimit?: number /*2*/; trajectoryWindow?: number /*3*/; guidanceMode?: PGGuidanceMode /*'generative'*/; serializerStyle?: PGSerializerStyle /*'paper-compatible' when paperCompatible else 'memoryjs'*/; paperCompatible?: boolean; provider?: PGCompletionProvider; degradeToAttributesOnError?: boolean /*false*/; maxContextBytes?: number /*60000*/; maxGuidanceCalls?: number /*500*/; timeoutMs?: number /*60000*/; maxOutputChars?: number /*20000*/ }
export class ProceduralGraphSession {
  constructor(graph: ProceduralGraph, options: PGSessionOptions, ids?: { sessionId?: string });
  readonly sessionId: string; readonly graph: ProceduralGraph; readonly revisionId: string; readonly graphDigest: string;
  recordStep(step: PGTraceStep): void;               // appends; never mutates graph
  get trace(): readonly PGTraceStep[];
  async guidance(query: string): Promise<PGGuidanceResult>; // locate -> neighborhood/full -> serialize -> (generative? provider : attributes-only)
  toTrajectory(taskId: string, score: number): PGTrajectory;
}
```

### 4.9 Evolution + facade (Agent D)

```typescript
// ProceduralGraphRefiner.ts
export interface PGRefinerInput { taskDescription: string; mode: PGRefinementMode; toolCatalog: readonly string[]; attemptsBlock: string; currentGraphJson: string; rejectedBlock: string }
export function buildRefinerPrompt(input: PGRefinerInput): string;   // REFINER_PROMPT_TEMPLATE via renderTemplate
export function serializeRejections(records: readonly PGRejectionRecord[], opts: { maxRecords: number; maxChars: number }): { text: string; omitted: number }; // newest first; each: reason, candidateMean (if any), retainedMean, edit summary counts, first 3 diagnostics
export async function proposeEdits(provider: PGCompletionProvider, input: PGRefinerInput, budget: { timeoutMs: number; maxOutputChars: number }): Promise<{ ok: true; raw: string; edits: PGEditSet; usage } | { ok: false; raw?: string; diagnostics: PGDiagnostic[]; usage? }>; // uses parseEditSet

// ProceduralGraphEvolution.ts
export interface PGEvolutionDependencies { rollout(task: PGTask, graph: PGSnapshot, signal?: AbortSignal): Promise<PGTrajectory>; evaluate(task: PGTask, graph: PGSnapshot, signal?: AbortSignal): Promise<number>; refiner: PGCompletionProvider; tokenizer: PGTokenizer }
export interface PGEvolutionOptions { graphId: string; mode: PGConstructionMode; trainingTasks: readonly PGTask[]; validationTasks: readonly PGTask[]; batchSize: number; maxRounds: number; maxTokens: number /*Lmax*/; cyclePolicy: PGCyclePolicy; paperCompatible: boolean; enforceToolCatalog?: boolean; successThreshold?: number /*1.0*/; toolCatalog: readonly string[]; taskDescription: string; concurrency?: number /*1*/; taskFailurePolicy: 'fail-round' | 'score-zero'; rejectionMemory?: { maxRecords: number; maxChars: number }; manifestExtras?: Record<string, unknown>; signal?: AbortSignal; sessionOptions?: Partial<PGSessionOptions> }
export interface PGEvolutionResult { runId: string; manifest: Record<string, unknown>; retained: { revisionId: string; graphDigest: string; validationMean: number | null }; rounds: PGRoundRecord[]; stoppedBecause: 'rounds-exhausted' | 'batches-exhausted' | 'aborted' | 'conflict' | 'fixed-mode' }
export class ProceduralGraphEvolution { constructor(backing: IProceduralGraphBacking, deps: PGEvolutionDependencies); run(opts: PGEvolutionOptions): Promise<PGEvolutionResult> }
// Algorithm: feature plan 9.7 verbatim. 'fixed_expert' returns immediately with stoppedBecause 'fixed-mode'. '*_onetime' modes: one round over ALL training tasks; when paperCompatible they commit WITHOUT evaluation (PG-16) — validationMean null; when !paperCompatible they are gated like incremental.

// ProceduralGraphManager.ts
export interface ProceduralGraphManagerConfig { backing: IProceduralGraphBacking; ownsBacking: boolean; policy?: PGPolicy; guidanceProvider?: PGCompletionProvider; paperCompatible?: boolean }
export interface PGPolicy { canRead?(graphId: string): boolean | Promise<boolean>; canWrite?(graphId: string): boolean | Promise<boolean>; canEvolve?(graphId: string): boolean | Promise<boolean>; audit?(event: { op: string; graphId: string; revisionId?: string; at: string }): void | Promise<void> }
export class ProceduralGraphManager {
  constructor(config: ProceduralGraphManagerConfig);
  createGraph(input: { graphId: string; nodes: PGNode[]; edges: PGEdge[]; entryNodeId?: string /*'Start'*/; relationVocabulary?: string[]; cyclePolicy?: PGCyclePolicy /*'reject'*/; toolCatalog?: string[] }): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }>;
  createSkeleton(input: { graphId: string; toolCatalog?: string[]; cyclePolicy?: PGCyclePolicy }): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }>; // Start(STATE) -LEADS_TO-> End(STATE), attributes null/''/'' per feature plan 9.9
  getGraph(graphId: string, revisionId?: string): Promise<ProceduralGraph | undefined>;
  openSession(graphId: string, options: PGSessionOptions & { revisionId?: string }): Promise<ProceduralGraphSession | undefined>;
  prepareCandidate(graphId: string, edits: PGEditSet, options?: { cyclePolicy?: PGCyclePolicy; enforceToolCatalog?: boolean; toolCatalog?: string[]; staticMode?: boolean }): Promise<ReturnType<typeof prepareCandidate>>;
  evolve(options: PGEvolutionOptions, deps: PGEvolutionDependencies): Promise<PGEvolutionResult>;
  listRevisions(graphId: string, page?: { offset?: number; limit?: number }): ReturnType<IProceduralGraphBacking['listRevisions']>;
  listRejections(graphId: string, page?: { offset?: number; limit?: number }): Promise<{ items: Array<Omit<PGRejectionRecord, 'trajectoryRefs'> & { trajectoryRefs?: undefined }>; total: number }>; // raw refs stripped by default
  rollback(graphId: string, revisionId: string, expectedHeadVersion: number): Promise<PGCommitResult | { status: 'not-found' }>;
  exportGraph(graphId: string, revisionId?: string): Promise<string | undefined>; // canonicalJson(snapshot)
  importGraph(document: string, options?: { graphId?: string; toolCatalog?: string[]; enforceToolCatalog?: boolean }): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }>;
  dispose(): Promise<void>; // closes backing only if ownsBacking
}

// ProcedureGraphAdapter.ts
export function procedureToGraphInput(procedure: Procedure): { nodes: PGNode[]; edges: PGEdge[]; notes: string[] };
// step k -> node id `${procedure.id}:step:${order}` (ACTION, actionName = step.action, description = `${action} ${JSON.stringify(parameters)}`); main sequence LEADS_TO chain; Start(STATE) -> first step; last step -> End(STATE); fallback f of step k -> node `${procedure.id}:step:${order}:fallback[:fallback...]` with edge (step, TRIGGERS, fallback) condition 'step failed' and edge (fallback, LEADS_TO, next main step | End) mirroring StepSequencer resume; timeout recorded in description; notes list every synthetic node
```

`ManagerContext` additions (Agent D, Wave 3, edits `src/core/ManagerContext.ts` only in the two places named): a private `_proceduralGraphManagers: ProceduralGraphManager[] = []`; `async createProceduralGraph(config: { backing: { type: 'jsonl'|'sqlite'|'memory'; path?: string } | IProceduralGraphBacking; policy?: PGPolicy; guidanceProvider?: PGCompletionProvider; paperCompatible?: boolean }): Promise<ProceduralGraphManager>` — when `backing` is a config object the context creates it (`ownsBacking: true`) and pushes the manager for disposal; when it is an instance, `ownsBacking: false`. `close()` additionally calls `dispose()` on each registered manager (fire-and-forget with `void`, since `close()` is synchronous today; do not change its signature). Default `path` when omitted: `<storageDir>/<basename>-procedural-graph.jsonl` (`.db` for sqlite), computed like the other sidecars in the constructor.

---

## 5. Wave 1 — pure foundations (all four agents concurrently)

### 5.1 Agent A / Wave 1 — types, schemas, canonical, graph core, validator, serializer

**Status:** ✅ SHIPPED · **Commit prefix:** `feat(pg-core)` · **Feature-plan sections to read:** 2, 5, 6, 8.2, 8.4, 9.5, 9.6

- [x] Create `src/types/proceduralGraph.ts` exactly per Section 4.1 and append its exports to `src/types/index.ts`. Commit immediately (`feat(pg-core): add procedural graph leaf types`).
- [x] Create `src/agent/procedural/graph/canonical.ts` (`canonicalJson`, `sha256Hex`, `graphDigest`, `toolCatalogHash`, `storageKey`, `evaluationFingerprint`).
- [x] Create `src/agent/procedural/graph/ProceduralGraphSchemas.ts` (`PG_LIMITS`, `parseSnapshot`, `parseEditSet`).
- [x] Create `src/agent/procedural/graph/ProceduralGraph.ts` (`ProceduralGraph` with `locate`, `neighborhood`, `reachesTerminal`, `findCycleClosingEdges`, `withEdits`).
- [x] Create `src/agent/procedural/graph/ProceduralGraphValidator.ts` (`validateSnapshot`, `applyCyclePolicy`, `prepareCandidate`).
- [x] Create `src/agent/procedural/graph/ProceduralGraphSerializer.ts` (`serializeLocalContext`, `serializeFullGraph`, `serializeGraphJson`).
- [x] Create fixtures `tests/unit/agent/procedural/graph/fixtures/hotpotqa-mode2.ts` (the 4-node excerpt from feature plan 8.4: `First_Hop_Retrieve → Scan_Index → Bridge_Extract`, plus `Start`, `End`; attributes copied from the excerpt) and `fixtures/cfo-generation-d.ts` (paper Appendix E.3 Generation D: `Start → Month_Start → recall_notes → check_cash_in_bank → cash_flow_forecast_calculation → save_note → check_market_data → Decide_Capital → {fund_raising_request → End, book_closing → End}`; guidance/pitfalls text is synthetic and must say so in a comment).
- [x] Tests (`tests/unit/agent/procedural/graph/`): `canonical.test.ts`, `ProceduralGraphSchemas.test.ts`, `ProceduralGraph.test.ts`, `ProceduralGraphValidator.test.ts`, `ProceduralGraphSerializer.test.ts`.

**Required test cases (names are the `it(...)` strings):**

`canonical.test.ts`
- "canonicalJson sorts keys recursively and is whitespace-free"
- "graphDigest ignores graphId, revisionId and parentRevisionId"
- "graphDigest changes when an edge attribute changes"
- "graphDigest is order-independent for nodes and edges"
- "storageKey is under 100 chars for a 600-char node id" (A5)

`ProceduralGraphSchemas.test.ts`
- "parseEditSet accepts the paper's exact output format example with concrete values"
- "parseEditSet rejects a fenced ```json block" / "rejects surrounding prose" / "rejects unknown top-level key" / "rejects add_edges entry with missing pitfalls" / "accepts condition null" / "rejects delete_edges entry with relation field" / "rejects duplicate add_nodes ids" / "reports editIndex on failures"
- "parseSnapshot accepts null guidance on an imported edge and reports no error" (PG-02 / A11)
- "PG_LIMITS admit 131 nodes and 265 edges"

`ProceduralGraph.test.ts`
- "locate(undefined) returns the entry node with reason 'entry'"
- "locate matches node id exactly and not case-insensitively"
- "locate falls back to actionName binding only when allowed; ambiguity yields reason 'ambiguous'"
- "locate on a terminal node is matched with empty hops"
- "neighborhood groups edges by hop and respects hopLimit 2 on a 4-deep chain"
- "neighborhood on a cycle terminates and lists each edge once"
- "neighborhood preserves parallel edges with different relations" (PG-01)
- "withEdits deletes all edges between endpoints regardless of relation before re-adding" (PG-07)
- "withEdits removes incident edges of deleted nodes"
- "withEdits applies deletions before additions so a re-added edge survives"
- "reachesTerminal fails for a node whose only path loops"
- "findCycleClosingEdges is deterministic across two runs and across node insertion order"

`ProceduralGraphValidator.test.ts`
- "validateSnapshot flags a missing endpoint" / "flags unknown relation outside vocabulary" / "accepts declared extension vocabulary" / "accepts a terminal not named End"
- "tool-catalog mismatch is a warning when enforceToolCatalog=false and an error when true" (A10)
- "staticMode rejects removal of a baseline node id"
- "applyCyclePolicy 'allow' leaves a cycle; 'reject' errors; 'repair' removes closing edges and records them"
- "prepareCandidate never returns ok when any error diagnostic exists"
- "prepareCandidate assigns nextRevisionId and parentRevisionId"

`ProceduralGraphSerializer.test.ts`
- "paper-compatible local serialization of the HotpotQA fixture equals the expected string" — the expected string is the feature plan 8.4 shape filled with the fixture's text; store it in the fixture file as `EXPECTED_LOCAL_SERIALIZATION`
- "memoryjs style prints the relation label; paper-compatible style does not"
- "null condition prints as (Condition: null)"
- "serializeFullGraph is deterministic regardless of input order"

**Gate:** rule-8 commands green; `grep -c "^export" src/agent/procedural/graph/*.ts` shows only the names in Section 4.

**Prompt:**
```text
[COMMON PREAMBLE]
You are Agent A ("pg-core"). Your task is Section 5.1 of docs/superpowers/plans/2026-09-10-procedural-graph-implementation.md. Implement every checkbox there in order, using the interface specs in Section 4.1–4.6 of that file EXACTLY. First deliverable: commit src/types/proceduralGraph.ts alone within your first milestone so other agents can import it. Write the tests listed under "Required test cases" with those exact it() names; add more if useful. Feature-plan sections to read: 2, 5, 6, 8.2, 8.4, 9.5, 9.6. Commit prefix: feat(pg-core).
```

### 5.2 Agent B / Wave 1 — relation schema fix + driver-resolver export

**Status:** ✅ SHIPPED · **Commit prefix:** `feat(pg-store)` · **Feature-plan sections:** 3 (A1, A12, A13), 4, 7

- [x] In `src/utils/schemas.ts`: add `metadata: z.record(z.string(), z.unknown()).optional()` to `CreateRelationSchema`; add `weight`, `confidence`, `properties`, and `metadata` (all optional, same sub-schemas as `CreateRelationSchema`) to `RelationSchema`. Keep both `.strict()`. `DeleteRelationsSchema` inherits automatically; verify with a test. Do **not** touch entity schemas.
- [x] In `src/core/SQLiteStorage.ts`: add `export function resolveSQLiteDatabaseCtor(): DatabaseCtor { return loadDatabaseCtor(); }` directly below `__resetDatabaseCtorForTests`, with a JSDoc noting it exists for the procedural-graph backing (A12). Export the `DatabaseCtor` type if it is not already exported (`export type { DatabaseCtor }`). Change nothing else in that file.
- [x] Tests: extend `tests/unit/utils/schemas.test.ts` with a new `describe('relation metadata (procedural graph)')` block: "CreateRelationSchema accepts metadata.proceduralGraph", "CreateRelationSchema still rejects unknown top-level keys", "RelationSchema accepts weight/confidence/properties/metadata", "DeleteRelationsSchema accepts relations carrying metadata". Add `tests/unit/core/RelationManager-metadata.test.ts`: create two entities via `EntityManager`, `createRelations([{ from, to, relationType:'LEADS_TO', metadata:{ proceduralGraph:{ schemaVersion:1, condition:null, guidance:'g', pitfalls:'p' } } }])` on a `GraphStorage` temp file, reload, assert metadata round-trips. Repeat on `SQLiteStorage` (skip with `it.skipIf` when neither driver is available — copy the availability check pattern from `tests/unit/core/sqlite-lazy-load.test.ts`).
- [x] Add `tests/unit/core/sqlite-driver-resolver.test.ts`: "resolveSQLiteDatabaseCtor returns a constructor" and "honors MEMORY_SQLITE_DRIVER=node after __resetDatabaseCtorForTests" (skip if `isNodeSqliteAvailable()` is false).
- [x] Run `bunx vitest run tests/unit/utils tests/unit/core tests/unit/features` and confirm no regression (IOManager import tests exercise `RelationSchema`).

**Prompt:**
```text
[COMMON PREAMBLE]
You are Agent B ("pg-store"). Your Wave 1 task is Section 5.2 of docs/superpowers/plans/2026-09-10-procedural-graph-implementation.md. You may edit ONLY: src/utils/schemas.ts (relation schemas), src/core/SQLiteStorage.ts (add one exported function + type export, nothing else), and the test files named in 5.2. Read src/utils/schemas.ts lines 255-300 and src/core/SQLiteStorage.ts lines 25-95 before editing. Zod is v4. Commit prefix: feat(pg-store).
```

### 5.3 Agent C / Wave 1 — prompts, provider adapter, token tail

**Status:** ✅ SHIPPED · **Commit prefix:** `feat(pg-guide)` · **Feature-plan sections:** 8.3, 8.5, 8.6, 9.3, PG-14

- [x] Create `src/agent/procedural/graph/prompts.ts`: the two templates copied **character-for-character** from feature plan 8.5 (including the `•` bullets and the `→` arrow), the four binding constants, and `renderTemplate`.
- [x] Create `src/agent/procedural/graph/CompletionProvider.ts` per 4.8 (`PGCompletionProvider`, `adaptLLMProvider`, `completeWithBudget`). Import `LLMProvider` as a type from `../../../search/LLMQueryPlanner.js`.
- [x] Create `src/agent/procedural/graph/tokenTail.ts` per 4.8 (`PGTokenizer`, `tokenTail`, `concatTrajectories`).
- [x] Tests in `tests/unit/agent/procedural/graph/`: `prompts.test.ts` ("guidance template contains the exact sentence 'You must include any specific command patterns, file paths, tools, or arguments defined in the graph context if they are relevant to the next steps.'", "refiner template contains rule 6 verbatim", "renderTemplate throws on unbound placeholder", "renderTemplate leaves JSON braces inside the refiner template intact" — note the refiner template contains literal `{` `}` in its output-format block; `renderTemplate` must replace only `{identifier}` tokens matching `/\{([a-z_]+)\}/g` whose name is in `bindings`, and the template's literal JSON braces contain `"add_nodes":` etc. so they never match that regex), `CompletionProvider.test.ts` ("timeout discards a late response and reports ok:false", "usage is approximate when getLastUsage is absent", "usage is exact when getLastUsage is present", "maxOutputChars truncation is reported"), `tokenTail.test.ts` ("keeps the final N tokens in order", "leaves shorter input unchanged", "concatTrajectories preserves input order and is deterministic"). Use a whitespace tokenizer defined inside the test file.

**Prompt:**
```text
[COMMON PREAMBLE]
You are Agent C ("pg-guide"). Your Wave 1 task is Section 5.3 of docs/superpowers/plans/2026-09-10-procedural-graph-implementation.md. Copy the prompt templates from docs/PROCEDURAL_GRAPH_FEATURE_PLAN.md Section 8.5 byte-for-byte (read that section with `sed -n` and paste; do not retype). If src/types/proceduralGraph.ts does not exist yet, `git pull` once; if still absent, write prompts.ts and tokenTail.ts first (they need only PGTrajectory, which you may temporarily declare locally with a `// TODO(pg-core): replace with import` comment, then replace once the file lands). Commit prefix: feat(pg-guide).
```

### 5.4 Agent D / Wave 1 — refiner (pure) and rejection serialization

**Status:** ✅ SHIPPED · **Commit prefix:** `feat(pg-evolve)` · **Feature-plan sections:** 9.4, 9.8, PG-06, PG-10, PG-11

- [x] Create `src/agent/procedural/graph/ProceduralGraphRefiner.ts` per 4.9 (`buildRefinerPrompt`, `serializeRejections`, `proposeEdits`). `proposeEdits` calls `completeWithBudget` (Agent C) and `parseEditSet` (Agent A); until those land, code against the signatures in Section 4 and mark the imports — they will resolve at the Wave 1 gate.
- [x] Tests `tests/unit/agent/procedural/graph/ProceduralGraphRefiner.test.ts` with a fake `PGCompletionProvider`: "buildRefinerPrompt binds all six placeholders and contains the mode string", "proposeEdits returns ok for a raw JSON object", "proposeEdits returns parse diagnostics for fenced JSON", "serializeRejections lists newest first and reports omitted count when over maxRecords", "serializeRejections output is bounded by maxChars", "an add_edges proposal that copies a task-specific literal from attemptsBlock is flagged with warning 'possible-trajectory-leak'" (PG-11: implement as a warning-only heuristic — any 12+ character substring of guidance/pitfalls that appears verbatim in `attemptsBlock`; never fatal).

**Prompt:**
```text
[COMMON PREAMBLE]
You are Agent D ("pg-evolve"). Your Wave 1 task is Section 5.4 of docs/superpowers/plans/2026-09-10-procedural-graph-implementation.md. Other agents are concurrently creating the modules you import (Section 4.2, 4.8). Code strictly against the Section 4 signatures; if a file is missing when you run tests, `git pull`; if still missing, stub ONLY in your test file with vi.mock and note it in your report. Commit prefix: feat(pg-evolve).
```

---

## 6. Wave 2 — persistence, sessions, evolution loop

Starts after Wave 1 gate. All agents `git pull` first.

### 6.1 Agent A / Wave 2 — hardening pass on the core

- [x] Add property-style tests: 200 random small graphs (seeded PRNG in-test) checking `graphDigest` order independence, `withEdits` idempotence of re-adding an identical edge, and `applyCyclePolicy('repair')` output being acyclic and deterministic across two runs.
- [x] Add "static-mode rename" test: delete `Scan_Index` and add `scan_index_v2` with the same description → `prepareCandidate(..., { staticMode: true, baselineNodeIds })` returns error `'static-node-id-removed'` (PG-10).
- [x] Add "equality of digests for semantically identical graphs with different graphId/revisionId" (feature plan 6.3).
- [x] Review Agents B/C/D usages of your API (read their files; do not edit). Report mismatches.

### 6.2 Agent B / Wave 2 — backings + contract suite

**Feature-plan sections:** 7.1–7.6, A2–A6

- [x] Create `src/agent/procedural/graph/backing/IProceduralGraphBacking.ts` (interface + `createProceduralGraphBacking`).
- [x] Create `backing/InMemoryProceduralGraphBacking.ts`.
- [x] Create `backing/JsonlProceduralGraphBacking.ts` (per 4.7; uses `durableWriteFile`, `AsyncMutex`; segment-mode refusal).
- [x] Create `backing/SqliteProceduralGraphBacking.ts` (per 4.7; obtains the ctor via `resolveSQLiteDatabaseCtor()`; uses only the `AdaptedDatabase` subset).
- [x] Create the shared contract suite `tests/unit/agent/procedural/graph/backing/backingContract.ts` exporting `runBackingContract(name, open: () => Promise<IProceduralGraphBacking>)` and three runner files: `memory.test.ts`, `jsonl.test.ts`, `sqlite.test.ts` (sqlite runner executes the suite twice: default driver and, when `isNodeSqliteAvailable()`, with `process.env.MEMORY_SQLITE_DRIVER='node'` after `__resetDatabaseCtorForTests()`; restore env in `afterAll`).

**Contract suite cases:**
- "createGraph returns headVersion 1 with null validationMean; second createGraph with same id rejects"
- "loadRevision returns a deep-equal snapshot including null attributes and Unicode/multiline text"
- "commitRetainedRevision with matching expectedHeadVersion commits and bumps headVersion"
- "commitRetainedRevision with stale expectedHeadVersion returns conflict and leaves head/revisions unchanged"
- "two concurrent commits with the same expectedHeadVersion: exactly one commits" (`Promise.all` of two calls)
- "setHead (rollback) to an existing revision bumps headVersion and copies that revision's evaluation mean or null"
- "setHead to a missing revision returns conflict without bumping"
- "appendRejection/listRejections paginate newest-first with total"
- "listRevisions paginates and total counts all"
- "saveEvaluation/loadEvaluation round-trip by fingerprint; a different fingerprint returns undefined"
- "reopen after close observes the same head and revisions" (memory backing: skip)
- JSONL only: "open refuses when MEMORY_STORAGE_SEGMENT_COUNT=4" and "a torn write (truncated last line) on disk still loads the previous complete head" — simulate by writing the file, then appending half a JSON line, then `open()`; the backing must ignore the trailing partial line and log a warning.
- SQLite only: "commit is atomic under an injected failure" — pass a `PGRoundRecord` with a `BigInt` inside `diagnostics` (JSON.stringify throws) and assert no revision/head change.

### 6.3 Agent C / Wave 2 — session + guidance orchestration

**Feature-plan sections:** 8.1–8.6, PG-03, PG-04, PG-05

- [x] Create `src/agent/procedural/graph/ProceduralGraphSession.ts` per 4.8.
- [x] Create `src/agent/procedural/graph/ProceduralGuidance.ts`: `export async function generateGuidance(args: { graph: ProceduralGraph; lastAction: string | undefined; query: string; recentSteps: readonly PGTraceStep[]; options: Required<Pick<PGSessionOptions,'taskDescription'|'hopLimit'|'trajectoryWindow'|'guidanceMode'|'serializerStyle'|'maxContextBytes'|'timeoutMs'|'maxOutputChars'>> & { paperCompatible: boolean; provider?: PGCompletionProvider; degradeToAttributesOnError: boolean } }): Promise<PGGuidanceResult>` — the session delegates to it.
- [x] Tests `tests/unit/agent/procedural/graph/ProceduralGraphSession.test.ts` (fake provider records prompts):
  - "first guidance call localizes at the entry node and the prompt contains 'Active Cognitive Node: [Start]'"
  - "after recordStep({action:'First_Hop_Retrieve'}) the prompt contains the hop-1 and hop-2 transitions from the fixture"
  - "unmatched action falls back to the full graph and the prompt uses the paper's full-graph context description"
  - "full-graph fallback over maxContextBytes returns status 'context-budget-exceeded' without calling the provider"
  - "trajectoryWindow 3 includes only the last three steps in recent_context"
  - "guidanceMode 'attributes-only' never calls the provider and returns mode 'attributes-only'"
  - "guidanceMode 'disabled' returns status 'disabled'"
  - "provider error returns status 'provider-error' unless degradeToAttributesOnError, which returns ok with degraded info"
  - "provider timeout is reported and a late resolve is ignored"
  - "maxGuidanceCalls exhaustion returns provider-error with a budget message"
  - "session graph is unchanged when the same PGSnapshot object is mutated afterwards (deep-frozen)" (PG-05)
  - "guidance text containing 'run rm -rf' is returned verbatim and nothing is executed" (documented negative test; assert no child_process import exists in the module via reading the source file)
- [x] Integration test `tests/integration/procedural-graph-guidance.test.ts`: open a session on the CFO fixture, walk `Month_Start → recall_notes → check_cash_in_bank`, assert each localization `nodeId` and that hop-2 from `check_cash_in_bank` includes `save_note`.

### 6.4 Agent D / Wave 2 — evolution loop

**Feature-plan sections:** 9.1–9.9, PG-12–PG-16

- [x] Create `src/agent/procedural/graph/ProceduralGraphEvolution.ts` per 4.9. Implement feature plan 9.7 line by line. Rollouts: `Promise.all` with `concurrency` chunks, then **re-sort by input index** before `concatTrajectories` (PG-14). Baseline: `backing.loadEvaluation(graphId, head.revisionId, fingerprint)`; when absent, evaluate the retained graph on the full validation set, persist with `backing.saveEvaluation(...)`, and record a `PGRoundRecord` with `round: 0`, `outcome: 'accepted'`, `candidateRevisionId` = retained. A cached report is reused only on an exact fingerprint match (A8). Evaluation aggregation: `completed < taskCount` ⇒ `incomplete: true` ⇒ no promotion (`taskFailurePolicy:'fail-round'`), or score 0 substituted and flagged in `scores[].error` (`'score-zero'`). Non-finite / out-of-`[0,1]` evaluator returns are errors, never averaged.
- [x] Manifest: `{ runId, graphId, mode, paperCompatible, enforceToolCatalog, cyclePolicy, hopLimit, trajectoryWindow, maxTokens, batchSize, successThreshold, taskFailurePolicy, toolCatalogHash, trainingFingerprint: sha256 of sorted task ids, validationFingerprint, refinerIdentity, guidanceIdentity, promptsVersion: 'paper-B.5-v1', serializerStyle, startedAt, ...manifestExtras }`. `evaluationFingerprint` = sha256 of the manifest minus `runId`/`startedAt`.
- [x] Tests `tests/unit/agent/procedural/graph/ProceduralGraphEvolution.test.ts` with scripted fakes (rollout returns fixed trajectories; evaluate returns per-revision scores from a map keyed by `graphDigest`; refiner returns queued JSON strings):
  - "baseline is evaluated once and reused across rounds with the same fingerprint" (evaluate call count)
  - "structurally invalid proposal appends a rejection and makes zero evaluate calls" (PG-08/13)
  - "candidateMean equal to baseline is accepted" / "lower is rejected and the retained revision and cached score are unchanged" / "higher is accepted and becomes the new baseline" (PG-12)
  - "a rejected candidate is never the starting graph of the next round" (refiner receives retained graph JSON)
  - "rejected_block passed to the refiner contains the previous rejection"
  - "trajectories are concatenated in batch order even when rollouts complete out of order" (fake rollout resolves in reverse with timers)
  - "tail truncation keeps only the last maxTokens tokens of the attempts block"
  - "evaluator NaN marks the round evaluation-error and does not promote"
  - "stale head conflict stops the run with stoppedBecause 'conflict'" (second backing handle commits between rounds)
  - "fixed_expert performs no rollout, no refiner call"
  - "scratch_onetime under paperCompatible commits without evaluation; under !paperCompatible it is gated" (PG-16)
  - "AbortSignal aborts between rounds with stoppedBecause 'aborted'"
  - "restart after a rejected round resumes from the retained head with the cached score" (run twice on the same backing)

---

## 7. Wave 3 — facade, lifecycle, adapter, exports, docs, recovery

### 7.1 Agent D / Wave 3 — facade + context factory + adapter + barrels + docs

- [x] Create `src/agent/procedural/graph/ProceduralGraphManager.ts` per 4.9 (policy checks before every op; `audit` after every mutation; `createSkeleton`; default `cyclePolicy: 'reject'` unless `paperCompatible`, then `'repair'`).
- [x] Create `src/agent/procedural/graph/ProcedureGraphAdapter.ts` per 4.9.
- [x] Create `src/agent/procedural/graph/index.ts` re-exporting every public symbol from Section 4 (values and types). Add `export * from './graph/index.js';` to `src/agent/procedural/index.ts`. In `src/agent/index.ts`, extend the "3B.4 Procedural Memory" block with the PG value exports (`ProceduralGraph`, `ProceduralGraphManager`, `ProceduralGraphSession`, `ProceduralGraphEvolution`, `InMemoryProceduralGraphBacking`, `JsonlProceduralGraphBacking`, `SqliteProceduralGraphBacking`, `createProceduralGraphBacking`, `procedureToGraphInput`, `parseEditSet`, `prepareCandidate`, `PG_BUILT_IN_RELATIONS`) and `export type` for the option/result types. Check name collisions against `src/agent/index.ts` with `grep`; if any collide, alias with a `PG` prefix and note it.
- [x] `src/core/ManagerContext.ts`: add the `createProceduralGraph` factory and disposal registration exactly as described at the end of Section 4.9. Add the import lines next to the existing `ProcedureManager` import.
- [x] Tests: `tests/unit/agent/procedural/graph/ProceduralGraphManager.test.ts` ("createGraph validates and persists", "importGraph rejects a snapshot with a missing endpoint and persists nothing", "exportGraph → importGraph round-trips digest", "rollback returns not-found for unknown revision", "policy canWrite=false blocks createGraph", "audit hook receives one event per mutation", "listRejections strips trajectoryRefs", "dispose closes an owned backing and not an injected one"); `ProcedureGraphAdapter.test.ts` ("three-step procedure yields Start, 3 ACTION nodes, End and a LEADS_TO chain", "step with fallback yields TRIGGERS edge and fallback resumes at the next main step matching StepSequencer.next()", "repeated action names yield distinct nodes", "nested fallback yields deterministic synthetic ids and notes"); `tests/unit/core/ManagerContext-proceduralGraph.test.ts` ("createProceduralGraph with a config backing is disposed by ctx.close()", "with an injected backing it is not closed", "default sidecar path is <basename>-procedural-graph.jsonl").
- [x] Docs: add a "Procedural Graph" subsection to `README.md` (under the agent memory section; ≤ 40 lines: what it is, `createProceduralGraph` example, `openSession`/`guidance`, `evolve` with caller callbacks, `paperCompatible` note) and one line to `CLAUDE.md` under `ctx.procedureManager` (`ctx.createProceduralGraph(config)` factory). Add a CHANGELOG "Unreleased" entry.
- [x] Verify `bun run build` and `node -e "import('./dist/index.js').then(m => { if (typeof m.ProceduralGraphManager !== 'function') process.exit(1) })"` and the CJS equivalent `node -e "const m=require('./dist/index.cjs'); if (typeof m.ProceduralGraphManager!=='function') process.exit(1)"` (adjust the CJS filename to what `package.json` `exports['.'].require` points at).

### 7.2 Agent B / Wave 3 — recovery, IOManager round-trip, both-driver CI

- [x] `tests/integration/procedural-graph-recovery.test.ts`: JSONL — write two revisions, then simulate crash by copying the file mid-write (monkeypatch `durableWriteFile`'s target with a partial buffer), reopen, assert head is either the pre-write or post-write complete state. SQLite — kill the connection (`close()`) inside a `commitRetainedRevision` via a throwing `round` serializer, reopen, assert no partial head.
- [x] `tests/integration/procedural-graph-iomanager-roundtrip.test.ts`: create a relation with `metadata.proceduralGraph` via `RelationManager`, export JSON with `IOManager`, import into a fresh context, assert metadata preserved (A13).
- [x] Confirm `tests/unit/agent/procedural/graph/backing/sqlite.test.ts` runs both drivers in CI: add a `console.info` line naming the driver in `beforeAll` and check both appear in the output.

### 7.3 Agent C / Wave 3 — behavioral fixtures + budget tests

- [x] `tests/unit/agent/procedural/graph/fixtures/appendixF.ts`: BFCL quote-only mini graph (`get_flight_cost → Finish` with guidance "report the quoted price and stop unless booking was requested"; `get_flight_cost → book_flight` with condition "user explicitly requested booking") and MultiChallenge F.2 graph (`ParseHistory → AnalyzeTargetQuestion → ExtractConstraints → Finish` with pitfalls "Do NOT write a meta-evaluation or answer the target question directly."). Attribute text may be paraphrased except the quoted pitfalls line, which is verbatim from the paper via the feature plan 12.2.
- [x] Tests: "attributes-only guidance after get_flight_cost includes the stop-unless-requested guidance and the booking condition"; "attributes-only guidance from AnalyzeTargetQuestion includes the verbatim pitfalls line"; "per-step observation over maxObservationChars is truncated with a marker in the trace, not silently".
- [x] Add `maxObservationChars` (default 8000) to `PGSessionOptions` — **this is the one permitted addition to Section 4.8**; update the interface comment.

### 7.4 Agent A / Wave 3 — cross-agent review

- [x] Read every file under `src/agent/procedural/graph/**` and produce a review report: API drift from Section 4, missing diagnostics codes, any `throw` on expected outcomes, any import from `src/types` into implementation dirs done the wrong way round, any paraphrased paper string (diff `prompts.ts` constants against feature plan 8.5 with a script). Fix issues only in files Agent A owns; list the rest as requests.

---

## 8. Orchestrator checklist per wave

1. `git pull`, run the wave gate commands from Section 3.
2. Run `bun run audit:plans -- --dry-run` and flip checkboxes here for shipped symbols.
3. Read each agent's "Requests for other agents" and relay as SendMessage to the owning agent (or fold into its next-wave prompt).
4. Only after Wave 3: run the full `bun run test:coverage`; require ≥ 90% line coverage on `src/agent/procedural/graph/**`.
5. Push the branch; open no PR unless asked.

## 9. Hallucination guards (why this plan is shaped this way)

- **Exclusive file ownership** removes merge conflicts and the "I fixed someone else's file from memory" failure mode.
- **Section 2** is the only allowed source of existing-symbol knowledge; each entry was read from the tree on 2026-09-10.
- **Section 4 signatures are complete**; agents are told not to add public surface.
- **Paper strings are copy-only**: the feature plan holds the verbatim text and agents are told to `sed -n` it, not retype it.
- **Test names are prescribed**, so "tests pass" cannot mean "I wrote tests for what I built" instead of "for what was specified".
- **Gates are commands**, not judgments.
- **What does not exist** is listed explicitly (Section 2.4) because absent files are the most common thing small models invent.
