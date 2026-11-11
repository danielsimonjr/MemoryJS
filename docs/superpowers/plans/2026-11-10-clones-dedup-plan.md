# Resolve repo-tools clone pairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop every repo-tools clone pair whose overlapping AST is genuine shared behavior by extracting a helper (or parameterized core) **before** rewriting call sites, while leaving chrono-node parity shapes and unrelated containment hits alone.

**Architecture:** One implementation PR. Tests that pin current behavior land first and must fail if the helper is wired with the wrong semantics. Helpers stay next to their callers (no new public package exports). `src/search/enDate/` keeps chrono-node's split function names even when two bodies look alike.

**Tech Stack:** TypeScript, Vitest, `npx -y @danielsimonjr/repo-tools@2.6.0 clones . --out ../clone-inventory` (write outside the repo; never commit `inventory.jsonl` / `clones.json`).

## Global Constraints

- Baseline (confirmed 2026-11-11 on `de3f30cf`): **415 files, 1849 units (`minNodes=50`), 2 exact groups, 27 near pairs** (the 27 include the 2 exact groups as `jStruct=1` rows). Daniel's "25 near pairs" are the 25 rows that are not text-identical exact clones.
- Plan-only branch does not change `src/`. This document is the spec for a later implementation PR.
- Do not merge code whose runtime behavior differs (BFS visit-on-enqueue vs DFS visit-on-pop must stay distinct even if they share setup).
- Do not "unify" `imply*` vs `assign*` in `src/search/enDate/` into one exported function; chrono-node exposes both.
- New exported symbols need a JSDoc first sentence that says what the function does (`repo-tools docs check src`). Prefer `@internal` helpers not re-exported from barrels.
- Verification after implementation: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run test:ci`, `bun run build`, then clones with `--out` outside the repo. Do not commit inventory dumps.
- No force-push, rebase, amend, `--no-verify`, merge, tag, release, or publish on the planner or builder branches.

## Clone-count targets

| Metric | Before (`de3f30cf`) | After implementation PR |
|---|---|---|
| files | 415 | 415 (or 416 only if a new helper file is justified; prefer editing existing files) |
| units (`minNodes=50`) | 1849 | ~1840–1855 (helpers add units; shrunk callers may fall below 50) |
| **exact groups** | **2** | **1** (`implySimilarTime` / `assignSimilarTime` remains) |
| **near pairs** | **27** | **10** (3 enDate chrono-parity + 7 containment / unrelated-semantics hits listed as KEEP) |

If a KEEP pair disappears because a caller shrank below `minNodes=50`, that is success; do not restore padding to keep the pair. If a REFACTOR pair remains above threshold, the extract was too thin — move more of the shared loop into the helper until the pair drops.

## File map

| File | Change |
|---|---|
| `src/agent/learning/llmJson.ts` | Canonical `raceAbort` / `ABORTED` (already exported) |
| `src/agent/evaluation/LLMRubricJudge.ts` | Delete local `raceAbort` / `ABORTED`; import from `llmJson.ts` |
| `src/agent/knowledge/knowledgeLoad.ts` | Add `toLoadItems` + `packLoadedKnowledge` |
| `src/agent/knowledge/KnowledgeRepository.ts` | `loadForContext` calls pack helper |
| `src/agent/knowledge/ScratchKnowledge.ts` | Same |
| `src/agent/SalienceEngine.ts` | Add `fieldRelevance` parameterized core |
| `src/search/QueryCostEstimator.ts` | Add `scoreLayerBySignals` |
| `src/utils/schema.ts` | Add `failInvalidType` used by string/number/boolean `_parse` |
| `src/agent/learning/LeafLearnerStore.ts` | Add `loadTasksByIds` |
| `src/agent/learning/RecursiveLearnerState.ts` | `loadRecursive` uses `loadTasksByIds` |
| `src/agent/versionedRecordUpdate.ts` (create) **or** `src/agent/versionedWriteFailure.ts` | Shared OCC lifecycle patch used by `archive` / `markResolved` |
| `src/core/GraphTraversal.ts` | Shared traversal setup + neighbor walk; BFS/DFS keep visit timing |
| `src/features/IOManager.ts` | Shared XML node/edge loop for GraphML and GEXF |
| `src/utils/EntityValidator.ts` | Shared rule-result folding |
| `src/search/BloomFilter.ts` | Shared `hashPositions` iterator |
| `src/core/PostgreSQLStorage.ts` | Shared optional-column apply helper |
| `src/cli/commands/helpers.ts` | Shared `emitJson` |
| `src/cli/commands/{heuristic,observationDedup,cache,reindex,spell}.ts` | Use `emitJson` |
| `src/agent/DecayEngine.ts` | Instance `calculateDecayFactor` ends in `clampedHalfLifeScore` |
| `src/agent/ConsolidationScheduler.ts` / `DecayScheduler.ts` / `ContextWindowManager.ts` / `SalienceEngine.ts` | Move default-config objects out of constructors so those units shrink |

---

## Per-pair classification

Ids match the REPORT.md order. `j` = jStruct, `c` = containment.

| # | Pair | j/c | Decision | Why (verifiable) |
|---|---|---|---|---|
| E1 / N1 | `LLMRubricJudge.raceAbort` ↔ `llmJson.raceAbort` | 1.00/1.00 | **REFACTOR** | Byte-identical (local copy vs export). Judge already documents the mirror in `llmJson.ts` header. |
| E2 / N2 | `implySimilarTime` ↔ `assignSimilarTime` | 1.00/1.00 | **KEEP** | Chrono-node `ENTimeExpressionParser` / component helpers: `imply` does not overwrite certain fields; `assign` does. Same field list is the chrono API, not a bug. Do not collapse to one export. |
| N3 | `SalienceEngine.calculateTaskRelevance` ↔ `calculateQueryRelevance` | 0.79/0.94 | **REFACTOR** | Both already call `semanticOr`; remaining shared core is name/observation substring scoring with different weights and one extra `entityType` / `taskId` check. Parameterize those weights. |
| N4 | `KnowledgeRepository.loadForContext` ↔ `ScratchKnowledge.loadForContext` | 0.76/0.91 | **REFACTOR** | Candidate list → `fitInOrder` → id harvest is identical; skill *source* (live `skills.match` vs in-memory matcher) stays in each class. |
| N5 | `QueryCostEstimator.scoreLexicalLayer` ↔ `scoreSemanticLayer` | 0.74/0.88 | **REFACTOR** | Same skeleton: base score, word-count bump, `AND\|OR\|NOT` bump, `analysis.questionType` bumps. Tables differ. |
| N6 | `ExtractTimezoneAbbrRefiner.refine` ↔ `MergeWeekdayComponentRefiner.refine` | 0.73/0.92 | **KEEP** | Chrono-node refiners with different regex and effects (timezone offset vs weekday merge). Shared `results` loop is the refiner interface, not shared behavior. |
| N7 | `StringSchema._parse` ↔ `NumberSchema._parse` | 0.73/0.90 | **REFACTOR** | Shared invalid-type issue construction (`makeIssue` + `invalidTypeMessage` + `pushIssue`). Number also rejects NaN/Infinity via `received`. |
| N8 | `ConsolidationScheduler.constructor` ↔ `DecayScheduler.constructor` | 0.69/0.95 | **REFACTOR (shrink)** | Already share `fillDefaults` + `unrefInterval`. Clone is the inlined default-object + callback copy. Move defaults to module `const`; do **not** invent a scheduler base class (cycle bodies differ: pipeline vs decay). |
| N9 | `loadRun` ↔ `loadRecursive` | 0.69/0.86 | **REFACTOR** | Shared `readTasks` + `JSON.parse` + `taskIds.map` rehydrate. Schema/kind checks stay in each loader. |
| N10 | `AgentReflectionManager.archive` ↔ `FailureManager.markResolved` | 0.66/0.86 | **REFACTOR** | Shared OCC pattern: `getEntityByName` → type guard → already-done short circuit → timestamped record patch → `updateEntity({ expectedVersion })` → `versionedWriteFailure`. Record shapes differ. |
| N11 | `GraphTraversal.bfs` ↔ `dfs` | 0.65/0.80 | **REFACTOR (core only)** | Shared: missing-start empty result, `visited`/`nodes`/`depths`/`parents`, `getNeighborsWithRelations`, `maxDepth`. **Not** shared: BFS marks visited on enqueue; DFS on pop; parent-first-wins only on DFS. Keep two public methods. |
| N12 | `checkAndReturnWithoutFollowingPattern` ↔ `checkAndReturnWithFollowingPattern` | 0.65/0.83 | **KEEP** | Chrono-node `ENTimeExpressionParser` pair (with vs without a following time range). Different regex and reject rules (`/^\d$/` vs `/^\d+-\d+$/`). |
| N13 | `IOManager.exportAsGraphML` ↔ `exportAsGEXF` | 0.65/0.91 | **REFACTOR** | Shared walk: entities → escaped ids + type/observations; relations → escaped endpoints + incrementing edge id. Element names and extra GraphML keys differ. |
| N14 | `EntityValidator.validate` ↔ `validateSync` | 0.65/0.89 | **REFACTOR** | Shared error/warning buckets, `issueFor`, `failFast`, `errorIssueFor`, `buildResult`. Sync path uniquely rejects `Promise` results. |
| N15 | `ContextWindowManager.constructor` ↔ `SalienceEngine.constructor` | 0.63/0.84 | **REFACTOR (shrink)** | Already `fillDefaults`. Clone is two large default literals inside constructors. Hoist `DEFAULT_*_CONFIG`. Do not share a base class (different deps: `ContextProfileManager` vs `SummarizationService`/`FreshnessManager`). |
| N16 | `BloomFilter.add` ↔ `mayContain` | 0.60/0.78 | **REFACTOR** | Identical `doubleHash` + `h1 + i*h2` bit index loop. `add` ORs the bit; `mayContain` returns false on unset. Hot path: keep the helper in-file, no extra allocations per hash. |
| N17 | `PostgreSQLStorage.rowToEntity` ↔ `rowToRelation` | 0.58/1.00 | **REFACTOR** | Shared optional-column copy (`columnText` / `columnIso` / `Number` / skip null) plus `mergeExtensionFields`. Column maps differ. |
| N18 | `LearningTrace.flush` ↔ `RecursiveDrive` `run` (`runChildren`) | 0.54/0.90 | **KEEP** | `flush` serializes OCC writes on a per-id promise tail (`flushTails`). `runChildren` fans out child learners under `runAll` + `AbortController`. Containment of "queue a promise, abort listener, then/catch". No one helper can serve both without lying. |
| N19 | `registerHeuristicCommands` ↔ `registerObservationDedupCommands` | 0.43/0.93 | **REFACTOR** | Shared `emitJson` (also copied in `cache.ts`, `reindex.ts`, `spell.ts`) and `runAction` + `program.command` + `.option` + `.action`. Extract `emitJson`; leave command trees as data in each file (heuristic CRUD ≠ obs-dedup find). |
| N20 | `LeafLearnerDeps` `editor.edit` ↔ `makeRound` | 0.41/0.91 | **KEEP** | Containment of a 67-node object-literal factory (`makeRound`) inside an adapter that calls `KnowledgeEditor.edit`. Unrelated types (`KnowledgeRevisionRecord` vs `PGRoundRecord`). |
| N21 | `DecayEngine.calculateDecayFactor` ↔ `clampedHalfLifeScore` | 0.38/0.96 | **REFACTOR** | After TTL/importance adjust `effectiveHalfLife`, the ageHours + `halfLifeFactor` + clamp is exactly `clampedHalfLifeScore(lastAccessedAt, effectiveHalfLife)`. Empty timestamp already returns 0 in both. |
| N22 | `BasicSearch.openNodes` ↔ `BooleanSearch.booleanSearch` | 0.23/0.91 | **REFACTOR** | Shared `collectInducedRelations` wrap: entities → `KnowledgeGraph`. Boolean AST, cache, pagination stay in `booleanSearch`. Extract `inducedSubgraph(storage, entities)`. |
| N23 | `parseVerdicts` ↔ `makeRound` | 0.19/0.91 | **KEEP** | Containment: rubric Map vs `PGRoundRecord` factory. No shared domain. |
| N24 | `createLeafLearnerDeps` ↔ `makeRound` | 0.12/0.91 | **KEEP** | Containment of `makeRound` inside adapter factory. |
| N25 | `Bootstrapper.run` ↔ `makeRound` | 0.09/0.95 | **KEEP** | Containment of `makeRound` inside corpus→learn pipeline. |
| N26 | `deleteNamesFromSnapshot` ↔ `ArchiveManager.archiveEntities` | 0.09/0.97 | **KEEP** | `deleteNamesFromSnapshot` mutates an in-memory `KnowledgeGraph` cache after a durable delete. `archiveEntities` scores entities, writes an archive file, then deletes. jStruct 0.085; only generic "filter names out of a graph" overlaps. |
| N27 | `knowledgeRevision.applyOp` ↔ `LearningTrace.buildTraceEntity` | 0.06/0.90 | **KEEP** | `applyOp` is a 1000+ node opcode switch. `buildTraceEntity` is a 57-node `learning_trace` entity factory. Containment of object-literal field lists; different entity types. |

**KEEP count (must remain unless they fall below `minNodes`):** E2/N2, N6, N12, N18, N20, N23, N24, N25, N26, N27 → 10 near pairs, 1 exact group.

**REFACTOR count:** E1/N1, N3, N4, N5, N7, N8, N9, N10, N11, N13, N14, N15, N16, N17, N19, N21, N22 → 17 near rows (16 unique extracts; N8 and N15 are constructor shrinks).

---

## Planned PR breakdown

**This planner PR:** this file only.

**Implementation: one PR** (`feat: extract shared cores for repo-tools clone pairs`). One PR because every extract is a local helper plus existing tests; splitting would leave clones.json half-migrated and CI still red on Architecture docs only if src JSDoc is wrong — still cheaper as one review.

A second PR is allowed **only** if GraphML/GEXF goldens plus PostgreSQL row mapping plus schema parity cannot land green together (export tests vs `schema.parity.test.ts`). Default is one PR.

---

### Task 1: Pin `raceAbort`, then import it in the judge

**Files:**
- Modify: `tests/unit/agent/evaluation/LLMRubricJudge.hardening.test.ts` (keep; add a direct helper test)
- Create: `tests/unit/agent/learning/llmJson.raceAbort.test.ts`
- Modify: `src/agent/evaluation/LLMRubricJudge.ts`

**Interfaces:**
- Consumes: `export function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T | typeof ABORTED>`
- Produces: judge uses the same function as Diagnoser / KnowledgeEditor / RevisionMerger

- [ ] **Step 1: Write failing tests for abort racing (no signal, abort before settle, late resolve ignored, late reject ignored)**

```typescript
import { describe, it, expect } from 'vitest';
import { ABORTED, raceAbort } from '../../../../src/agent/learning/llmJson.js';

describe('raceAbort', () => {
  it('returns the work promise when signal is omitted', async () => {
    await expect(raceAbort(Promise.resolve(7))).resolves.toBe(7);
  });

  it('resolves ABORTED when the signal fires first', async () => {
    const c = new AbortController();
    const work = new Promise<string>(() => undefined);
    const p = raceAbort(work, c.signal);
    c.abort();
    await expect(p).resolves.toBe(ABORTED);
  });
});
```

- [ ] **Step 2: Run `bunx vitest run tests/unit/agent/learning/llmJson.raceAbort.test.ts tests/unit/agent/evaluation/LLMRubricJudge.hardening.test.ts`**

Expected: new file PASS against existing `llmJson.raceAbort`; hardening still PASS.

- [ ] **Step 3: Delete local `ABORTED` / `raceAbort` in `LLMRubricJudge.ts`; import `{ ABORTED, raceAbort, describeError as describe }` from `../learning/llmJson.js`.** Keep `out === ABORTED` and fallback note `aborted`.

- [ ] **Step 4: Re-run the same vitest command plus `tests/unit/agent/evaluation/LLMRubricJudge.test.ts`. Expected: PASS. `describeError` must keep `err instanceof Error ? err.message : String(err)`.**

- [ ] **Step 5: Commit** `test: pin raceAbort then share it with LLMRubricJudge`

**Risks:** `ABORTED` in `llmJson` is `unique symbol`; the local judge symbol was a plain `Symbol('aborted')`. Identity must stay `===` with the imported sentinel. Do not change `ConcurrencyLimiter`'s private `raceAbort` (different arity: `fn, item, index, signal`).

---

### Task 2: `packLoadedKnowledge` for both `loadForContext` methods

**Files:**
- Modify: `src/agent/knowledge/knowledgeLoad.ts`
- Modify: `src/agent/knowledge/KnowledgeRepository.ts` (`loadForContext` ~377–404)
- Modify: `src/agent/knowledge/ScratchKnowledge.ts` (`loadForContext` ~161–189)
- Test: `tests/unit/agent/knowledge/KnowledgeRepository.rollback.test.ts`, `tests/unit/agent/learning/LearnedSkillLoadability.test.ts`, `tests/unit/agent/learning/LeafValidationPlan.test.ts`

**Interfaces:**
- Produces:

```typescript
export function toLoadItems(
  instructions: readonly InstructionItem[],
  matches: readonly SkillMatchLike[],
  failures: readonly FailureRecord[],
): LoadItem[]

export function packLoadedKnowledge(
  role: InstructionSetRole,
  candidates: readonly LoadItem[],
  budget: number,
  multiplier: number,
): LoadedKnowledge
```

`packLoadedKnowledge` must call `fitInOrder` + `renderLoadedKnowledge` and return `{ markdown, skillIds, instructionSetIds, failureIds, tokens }` with the same `flatMap` / `Set` rules as today.

- [ ] **Step 1: Add a test that live and scratch markdown/ids/tokens stay equal for the same seed (already in LeafValidationPlan). Add one unit test on `packLoadedKnowledge` that a skill after the budget cut is omitted from `skillIds`.**

- [ ] **Step 2: Run those tests — FAIL until the helper exists if the test imports it; otherwise they still PASS as characterization.**

- [ ] **Step 3: Implement helper; both methods keep their skill-source differences (`this.skills.match` vs `this.matcher`).**

- [ ] **Step 4: Run the three test files. Expected: PASS.**

- [ ] **Step 5: Commit** `refactor: share packLoadedKnowledge between live and scratch K`

**Risks:** `ScratchKnowledge.loadForContext` uses label `ScratchKnowledge.loadForContext` in `assertBudgetTokens`; live uses `loadForContext`. Keep those labels. Do not route scratch through `SkillManager.match`.

---

### Task 3: Parameterize salience field relevance

**Files:**
- Modify: `src/agent/SalienceEngine.ts` ~354–405
- Test: `tests/unit/agent/SalienceEngine.test.ts`

**Interfaces:**

```typescript
private fieldRelevance(
  entity: AgentEntity,
  text: string,
  scores: { name: number; observation: number; entityType?: number },
): number
```

`calculateTaskRelevance`: if `entity.taskId === taskDescription` return `1.0`; else `fieldRelevance(..., { name: 0.8, observation: 0.5 })`.
`calculateQueryRelevance`: `fieldRelevance(..., { name: 1.0, entityType: 0.7, observation: 0.5 })`.

- [ ] **Step 1: Characterization tests if missing: taskId exact 1.0; name substring 0.8 vs 1.0; entityType only counts for query.**

- [ ] **Step 2: Run tests (PASS on current code).**

- [ ] **Step 3: Extract `fieldRelevance` still going through `semanticOr`.**

- [ ] **Step 4: Re-run. Expected: PASS, same numeric scores.**

- [ ] **Step 5: Commit** `refactor: share SalienceEngine fieldRelevance scoring`

**Risks:** `useSemanticSimilarity` must still bypass substring scores via `semanticOr`.

---

### Task 4: `scoreLayerBySignals` in QueryCostEstimator

**Files:**
- Modify: `src/search/QueryCostEstimator.ts` ~676–735
- Test: `tests/unit/search/QueryCostEstimator.test.ts`

**Interfaces:**

```typescript
private scoreLayerBySignals(
  query: string,
  analysis: QueryAnalysis | undefined,
  spec: {
    base: number;
    wordMin?: number;
    wordMax?: number;
    wordBonus: number;
    noOperatorBonus: number;
    questionBonuses: Partial<Record<string, number>>;
    complexityHighBonus?: number;
  },
): number
```

Lexical spec: `base: 50`, words `[2,5] +20`, no operators +10, factual +15, aggregation +10.
Semantic spec: `base: 45`, words `>=5 +25`, no operators +10, conceptual +30, comparative +20, high complexity +15.
Leave `scoreSymbolicLayer` alone (different signals).

- [ ] **Steps:** pin current scores for `"foo bar"`, `"what is X AND Y"`, conceptual vs factual fixtures → extract → re-run → commit `refactor: share QueryCostEstimator layer signal scoring`

**Risks:** word split is `query.trim().split(/\s+/)`. Operators regex must stay `/\b(AND|OR|NOT)\b/` (not case-insensitive; current lexical/semantic use that exact pattern).

---

### Task 5: `failInvalidType` for schema `_parse`

**Files:**
- Modify: `src/utils/schema.ts` `StringSchema._parse`, `NumberSchema._parse`, and `BooleanSchema._parse` (boolean is the same pattern; include it even though clones did not pair it)
- Test: `tests/unit/utils/schema.parity.test.ts`, `tests/unit/utils/schema.challenger.test.ts`

**Interfaces:**

```typescript
function failInvalidType(
  payload: Payload,
  expected: 'string' | 'number' | 'boolean',
  received?: string,
): void
```

Must keep issue field order: `makeIssue({ code: 'invalid_type', expected, received?, input, message: '' })` then `issue.message = invalidTypeMessage(issue)` then `pushIssue(payload, issue, undefined)`.

- [ ] **Steps:** run parity tests first (PASS) → extract → parity must still PASS against `schemaParity.json` → commit `refactor: share schema invalid_type failure`

**Risks:** Number's `received` is `'NaN'` or `String(value)` for infinities and omitted for non-numbers. Do not change that. This file is a Zod 4.6.7 parity port; issue order is user-visible.

---

### Task 6: Shrink scheduler and engine constructors (N8, N15)

**Files:**
- Modify: `src/agent/ConsolidationScheduler.ts`, `src/agent/DecayScheduler.ts`, `src/agent/ContextWindowManager.ts`, `src/agent/SalienceEngine.ts`
- Test: existing constructor/default tests in those modules' test files

**Interfaces:** module-level `const DEFAULT_*` with the same literals now inside constructors. Constructors: assign deps, `this.config = { ...fillDefaults(config, DEFAULT_*), callbacks from config }`.

- [ ] **Steps:** grep tests for default `4000` / `0.25` / `3600000` → hoist constants → re-run those tests → commit `refactor: hoist scheduler and salience default configs`

**Risks:** `fillDefaults` must still treat missing keys vs explicit `undefined` the same as today. Do not introduce a shared `Scheduler` base (N8 cycle methods are not the clone).

---

### Task 7: `loadTasksByIds` for leaf and recursive loaders

**Files:**
- Modify: `src/agent/learning/LeafLearnerStore.ts`
- Modify: `src/agent/learning/RecursiveLearnerState.ts`
- Test: existing leaf/recursive persist tests under `tests/unit/agent/learning/`

**Interfaces:**

```typescript
export async function loadTasksByIds(
  traces: LearningTrace,
  traceId: string,
  taskIds: readonly string[],
  label: 'LeafLearner' | 'RecursiveLearner',
): Promise<TaskRecord[]>
```

Error strings must remain `LeafLearner: trace "${traceId}" has no task records` / `lacks task ${id}` (and RecursiveLearner equivalents). Implement by interpolating `label`.

- [ ] **Steps:** add tests that missing tasks json and missing id still throw those exact strings → extract → commit `refactor: share learning-trace task rehydrate`

**Risks:** `loadRun` still validates `schema === 1`; `loadRecursive` still requires `kind === 'recursive' && schema === 2` **before** loading tasks.

---

### Task 8: Shared OCC lifecycle patch (archive / markResolved)

**Files:**
- Modify: `src/agent/versionedWriteFailure.ts` or create `src/agent/versionedRecordUpdate.ts`
- Modify: `src/agent/AgentReflectionManager.ts` `archive` ~234–258
- Modify: `src/agent/FailureManager.ts` `markResolved` ~379–405
- Test: existing archive / markResolved tests

**Interfaces:**

```typescript
export async function patchVersionedRecord<E extends Entity, R>(opts: {
  storage: { getEntityByName(id: string): Entity | undefined };
  entityManager: EntityManager;
  id: string;
  asTarget: (e: Entity) => e is E;
  already: (e: E) => R | undefined;
  patch: (e: E, now: string) => { updates: Partial<Entity>; result: R };
}): Promise<R | 'not-found' | 'conflict' | 'vanished-mid-update'>
```

Callers still pass type guards `isReflectionMemory` / `isFailureMemory` and their already-archived / already-resolved results.

- [ ] **Steps:** pin not-found, already-*, conflict, vanished, happy path → extract → commit `refactor: share versioned lifecycle record patch`

**Risks:** `versionedWriteFailure` must stay synchronous so microtask timing of callers does not change (see its module JSDoc). Do not swallow non-version errors.

---

### Task 9: Shared traversal setup for BFS and DFS

**Files:**
- Modify: `src/core/GraphTraversal.ts` ~283–373
- Test: `tests/unit/core/GraphTraversal.test.ts`

**Interfaces:**

```typescript
private emptyTraversal(): TraversalResult
private beginTraversal(startEntity: string, options: TraversalOptions): {
  opts: Required<TraversalOptions>;
  visited: Set<string>;
  nodes: string[];
  depths: Map<string, number>;
  parents: Map<string, string | null>;
} | null
```

`beginTraversal` returns `null` when `!hasEntity` (same empty maps). BFS keeps visit-on-enqueue + queue; DFS visit-on-pop + stack + `if (!parents.has(neighbor))`.

- [ ] **Steps:** tests for missing start, parent maps on a diamond graph (BFS vs DFS parents differ), maxDepth → extract setup only → commit `refactor: share GraphTraversal walk setup`

**Risks:** Unifying the loops into one `mode: 'bfs'|'dfs'` function is allowed only if diamond-parent tests pass unchanged. Prefer two loops sharing setup if a single loop is hard to verify.

---

### Task 10: Shared XML graph dump for GraphML and GEXF

**Files:**
- Modify: `src/features/IOManager.ts` ~824–910
- Test: `tests/unit/features/IOManager.test.ts`, `tests/unit/features/IOManager.graphmlDataValue.test.ts`

**Interfaces:**

```typescript
private mapGraphXml(
  graph: ReadonlyKnowledgeGraph,
  writeNode: (lines: string[], entity: Entity, id: string) => void,
  writeEdge: (lines: string[], relation: Relation, id: string, from: string, to: string) => void,
): { lines: string[]; /* writers already pushed */ }
```

Or a generator of `{ entity, nodeId }` / `{ relation, edgeId, sourceId, targetId }` after `escapeXml`.

- [ ] **Steps:** pin GraphML keys `d0`–`d5` and GEXF `attvalue for="0"` → extract walk → goldens PASS → commit `refactor: share IOManager XML node/edge walk`

**Risks:** GraphML includes timestamps/tags/importance; GEXF does not. Escaping must stay `escapeXml`. Creator string `Memory MCP Server` stays GEXF-only.

---

### Task 11: Shared EntityValidator rule fold

**Files:**
- Modify: `src/utils/EntityValidator.ts` ~156–228
- Test: `tests/unit/utils/EntityValidator.test.ts`, `tests/unit/utils/EntityValidator.results.test.ts`

**Interfaces:**

```typescript
private foldRuleResult(
  rule: EntityValidationRule,
  entity: Entity,
  result: RuleValidationResult,
  errors: EntityValidationIssue[],
  warnings: EntityValidationIssue[],
): 'break' | 'continue'
```

`validate` awaits `rule.validate`; `validateSync` throws if `result instanceof Promise` (and `void result.catch(() => {})` stays).

- [ ] **Steps:** pin failFast, async-in-sync error message, warning vs error severity → extract fold → commit `refactor: share EntityValidator issue fold`

**Risks:** Do not `await` in `validateSync`. Promise detection must remain `instanceof Promise`.

---

### Task 12: Bloom `forEachHashBit`

**Files:**
- Modify: `src/search/BloomFilter.ts`
- Test: `tests/unit/search/BloomFilter.test.ts`

**Interfaces:**

```typescript
private forEachHashBit(item: string, visit: (byte: number, mask: number) => boolean | void): void
```

`add`: `this.bits[byte] = (this.bits[byte] ?? 0) | mask` (visit always continues).
`mayContain`: return false from visit when bit unset; after loop return true.

No arrays of indexes (hot path).

- [ ] **Steps:** pin add then mayContain true; missing item false; does not allocate → extract → commit `refactor: share BloomFilter hash-bit loop`

**Risks:** `% this.bitCount`, `idx >>> 3`, `1 << (idx & 7)` must not change. `inserted++` only in `add`.

---

### Task 13: PostgreSQL optional column apply

**Files:**
- Modify: `src/core/PostgreSQLStorage.ts` ~274–320
- Test: existing PostgreSQL storage tests (skip if no DB; unit tests that call private mappers via public load)

**Interfaces:**

```typescript
function readOptional<T>(
  row: Record<string, unknown>,
  column: string,
  map: (v: unknown) => T,
): T | undefined
```

`rowToEntity` / `rowToRelation` still list their own columns. Helper only implements `if (row[column] != null) target[field] = map(row[column])`.

- [ ] **Steps:** pin null vs missing vs extra JSON `extra` merge → extract → commit `refactor: share PostgreSQL optional column reads`

**Risks:** `rowToRelation` uses `String(row.from_name)` not `columnText` for required keys — keep that. `mergeExtensionFields` stays last.

---

### Task 14: CLI `emitJson`

**Files:**
- Modify: `src/cli/commands/helpers.ts`
- Modify: `heuristic.ts`, `observationDedup.ts`, `cache.ts`, `reindex.ts`, `spell.ts`
- Test: CLI command tests under `tests/unit/cli/` if present; otherwise a helpers unit test that `emitJson` is `JSON.stringify(payload, null, 2)` + newline via `console.log`

**Interfaces:**

```typescript
export function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}
```

Do not invent `registerJsonSubcommands` unless N19 still clones after this extract; command option lists are product surface.

- [ ] **Steps:** add helpers test with a mock `console.log` → replace five local copies → commit `refactor: share CLI emitJson`

**Risks:** `heuristic.ts` `match` action does not use `runAction` (manual try). Leave that control flow.

---

### Task 15: DecayEngine delegates clamp to `clampedHalfLifeScore`

**Files:**
- Modify: `src/agent/DecayEngine.ts` `calculateDecayFactor` ~240–275
- Test: `tests/unit/agent/DecayEngine.test.ts`, `tests/unit/utils/halfLife.test.ts`

**Interfaces:** after computing `effectiveHalfLife` (importance + TTL), `return clampedHalfLifeScore(lastAccessedAt, effectiveHalfLife)`.

Empty `lastAccessedAt` still returns 0 before Date math (both already do).

- [ ] **Steps:** pin TTL-expired faster decay vs `clampedHalfLifeScore` on the same timestamp → replace duplicated `ageHours`/`halfLifeFactor`/`clamp` → commit `refactor: DecayEngine.calculateDecayFactor uses clampedHalfLifeScore`

**Risks:** `importanceModulation` false must ignore `importanceBoost`. TTL uses `createdAt ?? now`. Do not change `calculateDecayFactorStatic` (already one line to `clampedHalfLifeScore`).

---

### Task 16: `inducedSubgraph` for openNodes and booleanSearch

**Files:**
- Modify: search helper next to `collectInducedRelations` (find its current module; keep it there)
- Modify: `src/search/BasicSearch.ts` `openNodes`
- Modify: `src/search/BooleanSearch.ts` cache-hit return and final return
- Test: basic/boolean search unit tests

**Interfaces:**

```typescript
export function inducedSubgraph(
  storage: IGraphStorage,
  entities: readonly Entity[],
  relationFilter?: (r: Relation) => boolean,
): KnowledgeGraph
```

Implementation: `names = new Set(entities.map(e => e.name)); return { entities, relations: collectInducedRelations(storage, names, relationFilter) }`.

- [ ] **Steps:** openNodes names that have a relation between them; boolean cache hit path must use the helper too → commit `refactor: share inducedSubgraph graph slice`

**Risks:** `openNodes` does not paginate. Boolean cache stores names not entities; rebuild entities from the live graph then call `inducedSubgraph`.

---

### Task 17: Re-run clones and Architecture docs

- [ ] **Step 1:** `npx -y @danielsimonjr/repo-tools@2.6.0 clones . --out ../clone-inventory` from repo root. Compare REPORT.md to the targets table. Delete `../clone-inventory` after.
- [ ] **Step 2:** `npx --yes @danielsimonjr/repo-tools@2.3.0 check . --docs=docs/architecture` and `npx --yes @danielsimonjr/repo-tools@2.3.0 docs check src` must exit 0. New exports need JSDoc.
- [ ] **Step 3:** `bun run typecheck && bun run lint && bun run test:ci && bun run build`
- [ ] **Step 4:** Commit only if src still dirty after Task 16. Do not commit clone dumps.

**Expected clones:** exact groups = 1 (N2/E2 only); near pairs = 10 KEEP rows. A leftover REFACTOR pair means the helper did not absorb the shared loop — enlarge the helper, do not lower `minNodes`.

---

## Self-review

- Spec coverage: all 2 exact + 25 additional near pairs are in the classification table with REFACTOR extract or a KEEP reason that cites the other function's different control flow.
- No TBD/placeholder extracts.
- Helper names in later tasks match Task 2/7/8 interfaces.
- enDate KEEP set is exactly N2, N6, N12.
- Architecture docs CI does not read this plan path; implementation PRs that add src exports must still satisfy `repo-tools docs check src`.
