# Resolve repo-tools clone pairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop every repo-tools clone pair whose overlapping AST is genuine shared behavior by extracting a helper (or parameterized core) **before** rewriting call sites. Chrono-node's split export names stay; their bodies may delegate to one internal helper. Unrelated containment hits stay only when the overlap is not a behavior both sides actually perform.

**Architecture:** One implementation PR. Tests that pin current behavior land first and must fail if the helper is wired with the wrong semantics. Helpers stay next to their callers (no new public package exports, no barrel re-exports). `src/search/enDate/` keeps chrono-node's split function names; `implySimilar*` / `assignSimilar*` and the two time-pattern checkers become thin wrappers over a parameterized core.

**Tech Stack:** TypeScript, Vitest, `npx -y @danielsimonjr/repo-tools@2.6.0 clones . --out ../clone-inventory` (write outside the repo; never commit `inventory.jsonl` / `clones.json`).

## Global Constraints

- Baseline (confirmed 2026-11-11 on `de3f30cf`): **415 files, 1849 units (`minNodes=50`), 2 exact groups, 27 near pairs** (the 27 include the 2 exact groups as `jStruct=1` rows). Daniel's "25 near pairs" are the 25 rows that are not text-identical exact clones.
- Plan-only branch does not change `src/`. This document is the spec for a later implementation PR.
- Do not merge code whose runtime behavior differs (BFS visit-on-enqueue vs DFS visit-on-pop must stay distinct even if they share setup).
- Do not collapse `implySimilarTime` and `assignSimilarTime` (or the date siblings) into one exported function. Chrono-node exposes both names. Both bodies must call one internal writer parameterized by `imply` vs `assign`.
- New exported symbols need a JSDoc first sentence that says what the function does (`repo-tools docs check src`). Prefer `@internal` helpers not re-exported from barrels.
- Verification after implementation: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run test:ci`, `bun run build`, then clones with `--out` outside the repo. Do not commit inventory dumps.
- No force-push, rebase, amend, `--no-verify`, merge, tag, release, or publish on the planner or builder branches.

## Clone-count targets

| Metric | Before (`de3f30cf`) | After implementation PR |
|---|---|---|
| files | 415 | 415 (or 416 only if a new helper file is justified; prefer editing existing files) |
| units (`minNodes=50`) | 1849 | ~1840–1855 (helpers add units; shrunk callers may fall below 50) |
| **exact groups** | **2** | **0** (E1 imported; E2/N2 bodies delegate to one writer, wrappers fall under `minNodes`) |
| **near pairs** | **27** | **6** (N6, N18, N20, N23, N24, N25). Task 17 fails if any REFACTOR row is still reported. |

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
| `src/search/BloomFilter.ts` | Shared `applyHashBits(item, mode)` — no per-call closure, no index array |
| `src/search/enDate/components.ts` | Internal `copySimilarFields` used by imply/assign date and time |
| `src/search/enDate/parsers.ts` | Internal `checkAndReturnTimePattern` used by both checkers |
| `src/core/storageCache.ts` | `omitNamedEndpoints` used by `deleteNamesFromSnapshot` and `ArchiveManager` |
| `src/agent/knowledge/knowledgeRevision.ts` | `privateRecordEntity` shell shared with `buildTraceEntity` |
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
| E2 / N2 | `implySimilarTime` ↔ `assignSimilarTime` | 1.00/1.00 | **REFACTOR** | Bodies (`components.ts` 242–262) are the same five keys (`hour`, `minute`, `second`, `millisecond`, `meridiem` from `getUTCHours() < 12`) passed to `imply` vs `assign`. Extract `copySimilarFields(components, target, keys, write)`. Keep both exports as wrappers. `imply` still no-ops when `known[key]` is set (`components.ts` 80–83); `assign` still clears `implied`. Also route `implySimilarDate` / `assignSimilarDate` (218–234, not in the baseline report) through the same writer so the sibling shape cannot become a new exact group. |
| N3 | `SalienceEngine.calculateTaskRelevance` ↔ `calculateQueryRelevance` | 0.79/0.94 | **REFACTOR** | Both already call `semanticOr`; remaining shared core is name/observation substring scoring with different weights and one extra `entityType` / `taskId` check. Parameterize those weights. |
| N4 | `KnowledgeRepository.loadForContext` ↔ `ScratchKnowledge.loadForContext` | 0.76/0.91 | **REFACTOR** | Candidate list → `fitInOrder` → id harvest is identical; skill *source* (live `skills.match` vs in-memory matcher) stays in each class. |
| N5 | `QueryCostEstimator.scoreLexicalLayer` ↔ `scoreSemanticLayer` | 0.74/0.88 | **REFACTOR** | Same skeleton: base score, word-count bump, `AND\|OR\|NOT` bump, `analysis.questionType` bumps. Tables differ. |
| N6 | `ExtractTimezoneAbbrRefiner.refine` ↔ `MergeWeekdayComponentRefiner.refine` | 0.73/0.92 | **KEEP** | Bodies re-read (`refiners.ts` 99–161). Abbr refiner scans a trailing `TIMEZONE_NAME_SUFFIX`, calls `timezoneOffsetFor`, and `assign`s `timezoneOffset` only when not already certain. Weekday refiner pairwise-merges when `isOnlyWeekday` meets a certain `day` across `/^,?\s*$/`, then `cloneComponents` + `assign` weekday. No common regex, predicate, or assignment. Do not fold either into `mergeAdjacent`. |
| N7 | `StringSchema._parse` ↔ `NumberSchema._parse` | 0.73/0.90 | **REFACTOR** | Shared invalid-type issue construction (`makeIssue` + `invalidTypeMessage` + `pushIssue`). Number also rejects NaN/Infinity via `received`. |
| N8 | `ConsolidationScheduler.constructor` ↔ `DecayScheduler.constructor` | 0.69/0.95 | **REFACTOR (shrink)** | Already share `fillDefaults` + `unrefInterval`. Clone is the inlined default-object + callback copy. Move defaults to module `const`; do **not** invent a scheduler base class (cycle bodies differ: pipeline vs decay). |
| N9 | `loadRun` ↔ `loadRecursive` | 0.69/0.86 | **REFACTOR** | Shared `readTasks` + `JSON.parse` + `taskIds.map` rehydrate. Schema/kind checks stay in each loader. |
| N10 | `AgentReflectionManager.archive` ↔ `FailureManager.markResolved` | 0.66/0.86 | **REFACTOR** | Shared OCC pattern: `getEntityByName` → type guard → already-done short circuit → timestamped record patch → `updateEntity({ expectedVersion })` → `versionedWriteFailure`. Record shapes differ. |
| N11 | `GraphTraversal.bfs` ↔ `dfs` | 0.65/0.80 | **REFACTOR (core only)** | Shared: missing-start empty result, `visited`/`nodes`/`depths`/`parents`, `getNeighborsWithRelations`, `maxDepth`. **Not** shared: BFS marks visited on enqueue; DFS on pop; parent-first-wins only on DFS. Keep two public methods. |
| N12 | `checkAndReturnWithoutFollowingPattern` ↔ `checkAndReturnWithFollowingPattern` | 0.65/0.83 | **REFACTOR** | Shared tail (`parsers.ts` 615–638): if the captured ending contains `.` and fails `/\d(\.\d{2})+$/`, return null; if `parseInt(ending, 10) > 24`, return null. Differing prefix rejects (`/^\d$/`, `/^\d\d\d+$/`, `/\d[apAP]$/` vs `/^\d+-\d+$/`) and the range regex (also rejects `parseInt(startingNumbers) > 24`) are parameters. Extract `checkAndReturnTimePattern(result, kind: 'bare' \| 'range')`. Keep both chrono names as wrappers. |
| N13 | `IOManager.exportAsGraphML` ↔ `exportAsGEXF` | 0.65/0.91 | **REFACTOR** | Shared walk: entities → escaped ids + type/observations; relations → escaped endpoints + incrementing edge id. Element names and extra GraphML keys differ. |
| N14 | `EntityValidator.validate` ↔ `validateSync` | 0.65/0.89 | **REFACTOR** | Shared error/warning buckets, `issueFor`, `failFast`, `errorIssueFor`, `buildResult`. Sync path uniquely rejects `Promise` results. |
| N15 | `ContextWindowManager.constructor` ↔ `SalienceEngine.constructor` | 0.63/0.84 | **REFACTOR (shrink)** | Already `fillDefaults`. Clone is two large default literals inside constructors. Hoist `DEFAULT_*_CONFIG`. Do not share a base class (different deps: `ContextProfileManager` vs `SummarizationService`/`FreshnessManager`). |
| N16 | `BloomFilter.add` ↔ `mayContain` | 0.60/0.78 | **REFACTOR** | Identical `doubleHash` + `h1 + i*h2` bit index loop. `add` ORs the bit; `mayContain` returns false on unset. Hot path: keep the helper in-file, no extra allocations per hash. |
| N17 | `PostgreSQLStorage.rowToEntity` ↔ `rowToRelation` | 0.58/1.00 | **REFACTOR** | Shared optional-column copy (`columnText` / `columnIso` / `Number` / skip null) plus `mergeExtensionFields`. Column maps differ. |
| N18 | `LearningTrace.flush` ↔ `RecursiveDrive.runChildren` | 0.54/0.90 | **KEEP** | Re-read. `flush` (`LearningTrace.ts` 506–524) chains `flushTails` so both fulfill and reject still call `writeOps`, then deletes the tail. `runChildren` (`RecursiveDrive.ts` 73–122) adds an abort listener, `runAll`s children, and on `AbortError` stops for budget. `flush` takes no `AbortSignal`. A shared "then both branches" helper would hide the OCC tail vs the fan-out. |
| N19 | `registerHeuristicCommands` ↔ `registerObservationDedupCommands` | 0.43/0.93 | **REFACTOR** | Shared `emitJson` (also copied in `cache.ts`, `reindex.ts`, `spell.ts`) and `runAction` + `program.command` + `.option` + `.action`. Extract `emitJson`; leave command trees as data in each file (heuristic CRUD ≠ obs-dedup find). |
| N20 | `LeafLearnerDeps` `editor.edit` ↔ `makeRound` | 0.41/0.91 | **KEEP** | Re-read. `editor.edit` (`LeafLearnerDeps.ts` 92–109) builds a `KnowledgeEditContext` and returns `parts.editor.edit(...)`. `makeRound` (`ProceduralGraphEvolution.ts` 862–878) copies `PGRoundRecord` fields and optionally spreads `candidateRevisionId`. Overlap is `...(cond ? { key } : {})`, not a shared record. Calling `makeRound` here would not typecheck. |
| N21 | `DecayEngine.calculateDecayFactor` ↔ `clampedHalfLifeScore` | 0.38/0.96 | **REFACTOR** | After TTL/importance adjust `effectiveHalfLife`, the ageHours + `halfLifeFactor` + clamp is exactly `clampedHalfLifeScore(lastAccessedAt, effectiveHalfLife)`. Empty timestamp already returns 0 in both. |
| N22 | `BasicSearch.openNodes` ↔ `BooleanSearch.booleanSearch` | 0.23/0.91 | **REFACTOR** | Shared `collectInducedRelations` wrap: entities → `KnowledgeGraph`. Boolean AST, cache, pagination stay in `booleanSearch`. Extract `inducedSubgraph(storage, entities)`. |
| N23 | `parseVerdicts` ↔ `makeRound` | 0.19/0.91 | **KEEP** | Re-read. `parseVerdicts` (`LLMRubricJudge.ts` 147–173) parses a JSON array into `Map<criterionId, CriterionResult>` and optionally spreads `note`. No `PGRoundRecord` fields. jStruct 0.19 is the optional-spread shape inside the larger parser, which also does schema checks `makeRound` does not. |
| N24 | `createLeafLearnerDeps` ↔ `makeRound` | 0.12/0.91 | **KEEP** | Re-read. The factory returns `{ diagnoser, editor }` adapters. The contained shape is the same optional-spread as N20 (sessionId, signal, dedup, solverInstructionSetId). It never builds a round record. |
| N25 | `Bootstrapper.run` ↔ `makeRound` | 0.09/0.95 | **KEEP** | Re-read (`Bootstrapper.ts` 140–202). Pipeline is map → boundaries → notes → practice tasks → optional `learn` → `repository.snapshot`. The return is `BootstrapResult` with an optional `learn` spread. No round factory; jStruct 0.09. |
| N26 | `deleteNamesFromSnapshot` ↔ `ArchiveManager.archiveEntities` | 0.09/0.97 | **REFACTOR** | The overlap is not generic. `archiveEntities` copies the snapshot filter twice (`ArchiveManager.ts` 221–226 and 263–266): drop entities whose name is in the set, drop relations whose `from` or `to` is in the set. That is the whole body of `deleteNamesFromSnapshot` (`storageCache.ts` 269–277). Extract `omitNamedEndpoints` and call it from both. Scoring, archive file, and governance stay in `archiveEntities`. |
| N27 | `knowledgeRevision.applyOp` ↔ `LearningTrace.buildTraceEntity` | 0.06/0.90 | **REFACTOR** | The contained literal is the private-memory shell, not an unrelated object. `buildTraceEntity` (`LearningTrace.ts` 630–645) and `applyOp`'s `heuristic.add` / `memory.reflect` literals (`knowledgeRevision.ts` 212–226 and 246–260) plus `buildSkillEntity` (271–287) all set `name`, `entityType`, `observations`, `createdAt`, `lastModified`, `importance: 5`, `memoryType`, `visibility: 'private'`, `accessCount: 0`, `confirmationCount: 0`, `version: 1`, then a confidence and one record field. Extract `privateRecordEntity`. Confidence stays `1` for learning_trace and skill, `0.5` for heuristic and reflection. `contentHash` stays skill-only. |

**KEEP count (must remain unless they fall below `minNodes`):** N6, N18, N20, N23, N24, N25 → 6 near pairs, 0 exact groups.

**REFACTOR count:** E1/N1, E2/N2, N3, N4, N5, N7, N8, N9, N10, N11, N12, N13, N14, N15, N16, N17, N19, N21, N22, N26, N27 → 21 near rows. N8 and N15 are constructor shrinks. E2 also covers the under-threshold date sibling. N27 also covers `buildSkillEntity`, which is the same shell and must not be left behind as a replacement pair.

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

- [x] **Step 1: Write failing tests for abort racing (no signal, abort before settle, late resolve ignored, late reject ignored)**

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

- [x] **Step 2: Run `bunx vitest run tests/unit/agent/learning/llmJson.raceAbort.test.ts tests/unit/agent/evaluation/LLMRubricJudge.hardening.test.ts`**

Expected: new file PASS against existing `llmJson.raceAbort`; hardening still PASS.

- [x] **Step 3: Delete local `ABORTED` / `raceAbort` in `LLMRubricJudge.ts`; import `{ ABORTED, raceAbort, describeError as describe }` from `../learning/llmJson.js`.** Keep `out === ABORTED` and fallback note `aborted`.

- [x] **Step 4: Re-run the same vitest command plus `tests/unit/agent/evaluation/LLMRubricJudge.test.ts`. Expected: PASS. `describeError` must keep `err instanceof Error ? err.message : String(err)`.**

- [x] **Step 5: Commit** `test: pin raceAbort then share it with LLMRubricJudge`

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

- [x] **Step 1: Add a test that live and scratch markdown/ids/tokens stay equal for the same seed (already in LeafValidationPlan). Add one unit test on `packLoadedKnowledge` that a skill after the budget cut is omitted from `skillIds`.**

- [x] **Step 2: Run those tests — FAIL until the helper exists if the test imports it; otherwise they still PASS as characterization.**

- [x] **Step 3: Implement helper; both methods keep their skill-source differences (`this.skills.match` vs `this.matcher`).**

- [x] **Step 4: Run the three test files. Expected: PASS.**

- [x] **Step 5: Commit** `refactor: share packLoadedKnowledge between live and scratch K`

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

- [x] **Step 1: Characterization tests if missing: taskId exact 1.0; name substring 0.8 vs 1.0; entityType only counts for query.**

- [x] **Step 2: Run tests (PASS on current code).**

- [x] **Step 3: Extract `fieldRelevance` still going through `semanticOr`.**

- [x] **Step 4: Re-run. Expected: PASS, same numeric scores.**

- [x] **Step 5: Commit** `refactor: share SalienceEngine fieldRelevance scoring`

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

- [x] **Steps:** pin current scores for `"foo bar"`, `"what is X AND Y"`, conceptual vs factual fixtures → extract → re-run → commit `refactor: share QueryCostEstimator layer signal scoring`

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

- [x] **Steps:** run parity tests first (PASS) → extract → parity must still PASS against `schemaParity.json` → commit `refactor: share schema invalid_type failure`

**Risks:** Number's `received` is `'NaN'` or `String(value)` for infinities and omitted for non-numbers. Do not change that. This file is a Zod 4.6.7 parity port; issue order is user-visible.

---

### Task 6: Shrink scheduler and engine constructors (N8, N15)

**Files:**
- Modify: `src/agent/ConsolidationScheduler.ts`, `src/agent/DecayScheduler.ts`, `src/agent/ContextWindowManager.ts`, `src/agent/SalienceEngine.ts`
- Test: existing constructor/default tests in those modules' test files

**Interfaces:** module-level `const DEFAULT_*` with the same literals now inside constructors. Constructors: assign deps, `this.config = { ...fillDefaults(config, DEFAULT_*), callbacks from config }`.

- [x] **Steps:** grep tests for default `4000` / `0.25` / `3600000` → hoist constants → re-run those tests → commit `refactor: hoist scheduler and salience default configs`

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

- [x] **Steps:** add tests that missing tasks json and missing id still throw those exact strings → extract → commit `refactor: share learning-trace task rehydrate`

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

- [x] **Steps:** pin not-found, already-*, conflict, vanished, happy path → extract → commit `refactor: share versioned lifecycle record patch`

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

- [x] **Steps:** tests for missing start, parent maps on a diamond graph (BFS vs DFS parents differ), maxDepth → extract setup only → commit `refactor: share GraphTraversal walk setup`

**Risks:** Hot path (centrality, shortest path). Share setup once per call, not a per-neighbor callback. BFS (`GraphTraversal.ts` 313–316) marks `visited` and sets `parent` on enqueue and uses an index cursor (`queueHead`), not `shift()`. DFS (351–367) marks `visited` on pop and sets `parent` only when `!parents.has(neighbor)`. A diamond test must fail if those two timings are swapped. Unifying into `mode: 'bfs'|'dfs'` is allowed only when that test passes unchanged. Do not change public `bfs` / `dfs` signatures.

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

- [x] **Steps:** pin GraphML keys `d0`–`d5` and GEXF `attvalue for="0"` → extract walk → goldens PASS → commit `refactor: share IOManager XML node/edge walk`

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

- [x] **Steps:** pin failFast, async-in-sync error message, warning vs error severity → extract fold → commit `refactor: share EntityValidator issue fold`

**Risks:** Do not `await` in `validateSync`. Promise detection must remain `instanceof Promise`.

---

### Task 12: Bloom `applyHashBits`

**Files:**
- Modify: `src/search/BloomFilter.ts`
- Test: `tests/unit/search/BloomFilter.test.ts`

**Interfaces:**

```typescript
private applyHashBits(item: string, mode: 'or' | 'test'): boolean
```

One direct method. Do **not** take a `visit` callback: `add` / `mayContain` sit on the fuzzy pre-screen hot path, and a fresh closure per call allocates. Do **not** build an array of indexes.

`mode: 'or'`: `this.bits[byte] = (this.bits[byte] ?? 0) | mask`, then `add` does `this.inserted++`.
`mode: 'test'`: return `false` when `((this.bits[byte] ?? 0) & mask) === 0`; after the loop return `true`.

- [x] **Steps:** pin add then mayContain true; missing item false; does not allocate → extract → commit `refactor: share BloomFilter hash-bit loop`

**Risks:** `% this.bitCount`, `idx >>> 3`, `1 << (idx & 7)` must not change. `inserted++` only in `add`. A branch on `mode` inside the hash loop is the intended shape (one mode per call, predictable). Public `add` / `mayContain` / `clear` / `size` signatures stay.

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

- [x] **Steps:** pin null vs missing vs extra JSON `extra` merge → extract → commit `refactor: share PostgreSQL optional column reads`

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

`emitJson` alone will not drop N19. The pair is the two `register*` functions (`heuristic.ts` 23–120 vs `observationDedup.ts` 52–80). Containment is the repeated `.command().description().option().action(runAction → emitJson)` skeleton, not the 3-line logger. Also add an internal `addJsonCommand(parent, spec)` that performs `command` + `option` list + `runAction` + `emitJson`. Callers pass option specs as data (`flags`, `description`, `parse`). Heuristic `match` stays a manual try/catch (`heuristic.ts` 68–87) and must not go through `runAction`. If N19 is still reported after both extracts, the helper did not absorb the skeleton — enlarge it. Do not merge heuristic CRUD with Jaccard find into one command table (different managers and flags). `emitJson` and `addJsonCommand` stay off the package barrel.

- [x] **Steps:** add helpers test with a mock `console.log` → replace five local copies → commit `refactor: share CLI emitJson`

**Risks:** `heuristic.ts` `match` action does not use `runAction` (manual try). Leave that control flow.

---

### Task 15: DecayEngine delegates clamp to `clampedHalfLifeScore`

**Files:**
- Modify: `src/agent/DecayEngine.ts` `calculateDecayFactor` ~240–275
- Test: `tests/unit/agent/DecayEngine.test.ts`, `tests/unit/utils/halfLife.test.ts`

**Interfaces:** after computing `effectiveHalfLife` (importance + TTL), `return clampedHalfLifeScore(lastAccessedAt, effectiveHalfLife)`.

Empty `lastAccessedAt` still returns 0 before Date math (both already do).

- [x] **Steps:** pin TTL-expired faster decay vs `clampedHalfLifeScore` on the same timestamp → replace duplicated `ageHours`/`halfLifeFactor`/`clamp` → commit `refactor: DecayEngine.calculateDecayFactor uses clampedHalfLifeScore`

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

- [x] **Steps:** openNodes names that have a relation between them; boolean cache hit path must use the helper too → commit `refactor: share inducedSubgraph graph slice`

**Risks:** `openNodes` does not paginate. Boolean cache stores names not entities; rebuild entities from the live graph then call `inducedSubgraph`.

---

### Task 17: Re-run clones and Architecture docs

- [x] **Step 1:** `npx -y @danielsimonjr/repo-tools@2.6.0 clones . --out ../clone-inventory` from repo root. Compare REPORT.md to the targets table. Delete `../clone-inventory` after.
- [x] **Step 2:** `npx --yes @danielsimonjr/repo-tools@2.3.0 check . --docs=docs/architecture` and `npx --yes @danielsimonjr/repo-tools@2.3.0 docs check src` must exit 0. New exports need JSDoc.
- [x] **Step 3:** `bun run typecheck && bun run lint && bun run test:ci && bun run build`
- [x] **Step 4:** Commit only if src still dirty after Task 16. Do not commit clone dumps.

**Expected clones:** exact groups = 0; near pairs = 6 (N6, N18, N20, N23, N24, N25). A leftover REFACTOR pair means the helper did not absorb the shared loop — enlarge the helper, do not lower `minNodes`, and do not reclassify it as KEEP.

---

## Self-review

- Spec coverage: all 2 exact + 25 additional near pairs are in the classification table with REFACTOR extract or a KEEP reason that cites the other function's different control flow.
- No TBD/placeholder extracts.
- Helper names in later tasks match Task 2/7/8 interfaces.
- enDate KEEP set is exactly N6. E2/N2 and N12 are parameterized cores behind the chrono names.
- Architecture docs CI does not read this plan path; implementation PRs that add src exports must still satisfy `repo-tools docs check src`.

## Plan review

Reviewed 2026-11-11 by reading both function bodies for every pair (not the planner's summary). Decisions below are what changed in this revision.

**Flipped KEEP → REFACTOR**

- **E2/N2.** The two functions are the same five time fields. The only semantic difference is the writer (`imply` does not overwrite `known`; `assign` does). A shared `copySimilarFields(..., write)` keeps both exports and both semantics. Exact-group target moves from 1 to 0. The date pair (`implySimilarDate` / `assignSimilarDate`) is the same shape and is under `minNodes` today; it goes through the same writer so it cannot reappear as an exact group.
- **N12.** The shared tail is real: dotted-ending reject via `/\d(\.\d{2})+$/` and `parseInt > 24`. The differing regexes are parameters of `checkAndReturnTimePattern`. Chrono names stay as wrappers. "Different regex" was not a reason to keep the duplicated reject.
- **N26.** `archiveEntities` inlines `deleteNamesFromSnapshot`'s filter twice, including "either endpoint". That is shared behavior at jStruct 0.09. `omitNamedEndpoints` is the core. Scoring and the archive file stay put.
- **N27.** The contained 57-node literal is the same private-entity shell (importance 5, visibility private, accessCount 0, confirmationCount 0, version 1) with a different `confidence` and record key. `buildSkillEntity` and `buildInstructionSetEntity` (`InstructionSetManager.ts` 291–306, confidence `1`, no `contentHash`) use that shell and are included so the extract does not create a replacement pair.

**KEEP that survived the challenge**

- **N6.** Abbr refiner is a suffix scan plus `timezoneOffset`. Weekday refiner is an adjacent merge plus `cloneComponents`. No shared predicate to parameterize.
- **N18.** `flush` has a per-id OCC tail and no abort signal. `runChildren` fans out under `runAll` and an `AbortController`. The promise `.then` on both branches is not a shared operation.
- **N20, N23, N24, N25.** Each large function was read. None constructs a `PGRoundRecord`. The containment is optional object spread (`candidateRevisionId` in `makeRound` vs `note` / `signal` / `learn` elsewhere). A spread helper would not be shared domain behavior and would not remove `makeRound`'s field list from those units without rewriting unrelated option passing.

**REFACTOR challenges that changed the extract, not the decision**

- **N11 (kept REFACTOR).** Setup-only extract stays. Added an explicit ban on a per-neighbor callback (centrality hot path) and a diamond test that fails if visit-on-enqueue is swapped with visit-on-pop. Public `bfs` / `dfs` signatures do not change.
- **N16 (kept REFACTOR).** Replaced the planned `visit` callback with `applyHashBits(item, mode)`. A closure per `add` / `mayContain` allocates on the Bloom pre-screen path. No index array. Bit math and `inserted++` stay where they are.
- **N19 (kept REFACTOR).** `emitJson` is necessary and not sufficient: the reported pair is the two `register*` functions, and the overlap is the repeated command/action skeleton. Task 14 now also requires `addJsonCommand`. Heuristic `match` stays on its manual try/catch. Task 17 treats a remaining N19 row as a failed extract.

**Counts.** 21 near rows are REFACTOR, 6 are KEEP. Both exact groups are in the REFACTOR set, so exact groups go to 0 and near pairs go to 6. That holds only if each extract absorbs the shared loop (Task 17 gate). N19 is the row most likely to miss the cutoff if `addJsonCommand` is skipped.

**Not changed.** E1 symbol-identity risk (`unique symbol` vs `Symbol('aborted')`), schema issue order, OCC microtask timing, and "no new barrel exports" still stand. No `src/` edits in this review.

---

### Task 18: `copySimilarFields` for imply/assign date and time

**Files:**
- Modify: `src/search/enDate/components.ts` (`implySimilarDate`, `assignSimilarDate`, `implySimilarTime`, `assignSimilarTime`)
- Test: existing enDate / chrono parity tests (do not weaken fixtures)

**Interfaces:**

```typescript
function copySimilarFields(
  components: Components,
  target: Date,
  keys: readonly ComponentKey[],
  write: typeof imply | typeof assign,
): Components
```

Time keys: `hour`, `minute`, `second`, `millisecond`, then `meridiem` from `target.getUTCHours() < 12 ? MERIDIEM_AM : MERIDIEM_PM` (that value is not a `Date` getter; pass it as an extra key/value or handle it inside the time wrappers before the call — do not recompute it differently for imply vs assign).

Date keys: `day` = `getUTCDate()`, `month` = `getUTCMonth() + 1`, `year` = `getUTCFullYear()`.

Exported names stay. `createRelativeFromReference` still calls `assignSimilarTime` / `implySimilarTime` by those names.

- [x] **Steps:** pin a case where the field is already `known` (imply leaves it, assign replaces it and deletes `implied`) for both date and time → extract → parity tests PASS → commit `refactor: share enDate similar-field copy`

**Risks:** `imply` returns early when `known[key] !== undefined` and must not delete `implied`. `assign` writes `known` and `delete`s `implied`. Public exports stay. No behavior change in `createRelativeFromReference` (time-bearing durations still assign both, date-bearing still imply time).

---

### Task 19: `checkAndReturnTimePattern`

**Files:**
- Modify: `src/search/enDate/parsers.ts` (both checkers and their call sites at the end of `ENTimeExpressionParser.extract`)
- Test: existing time-expression parser tests. Add cases if missing: single digit rejected on the bare path; `1-2` rejected on the range path; ending `25` rejected on both; a `.50`-style ending that fails `/\d(\.\d{2})+$/` rejected on both; range also rejects when the *start* number is `> 24`.

**Interfaces:**

```typescript
function checkAndReturnTimePattern(result: ParsedResult, kind: 'bare' | 'range'): ParsedResult | null
```

`bare` keeps `/^\d$/`, `/^\d\d\d+$/`, `/\d[apAP]$/`, and `/[^\d:.](\d[\d.]+)$/`.
`range` keeps `/^\d+-\d+$/` and `/[^\d:.](\d[\d.]+)\s*-\s*(\d[\d.]+)$/`, and rejects when either captured number parses `> 24`.
Both share the `.` / cents check and the ending `> 24` check. Both return `result` unchanged when they accept.

- [x] **Steps:** add the reject cases (PASS on current wrappers) → extract → same tests PASS → commit `refactor: share EN time-pattern reject checks`

**Risks:** The two regexes are not interchangeable. `extract` must still call the bare checker when there is no following match (`parsers.ts` 685–686) and the range checker after a following time is merged (695). Do not rename the chrono functions.

---

### Task 20: `omitNamedEndpoints` for snapshot delete and archive

**Files:**
- Modify: `src/core/storageCache.ts` `deleteNamesFromSnapshot`
- Modify: `src/features/ArchiveManager.ts` both filter sites (~221 and ~263)
- Test: existing storage-cache and archive tests. Pin: an entity in the set is removed; a relation is removed when **either** endpoint is in the set; a relation with both endpoints outside the set stays.

**Interfaces:**

```typescript
export function omitNamedEndpoints(
  graph: { entities: readonly Entity[]; relations: readonly Relation[] },
  nameSet: ReadonlySet<string>,
): { entities: Entity[]; relations: Relation[] }
```

`deleteNamesFromSnapshot` assigns the result back onto `cache` (same mutation as today). `archiveEntities` uses the result for `postArchiveGraph` and for the graph it saves. Do not skip governance preflight or the archive file write.

- [x] **Steps:** pin endpoint-either-side removal → replace both inline filters and the snapshot helper body → commit `refactor: share omitNamedEndpoints graph filter`

**Risks:** `deleteNamesFromSnapshot` currently mutates `cache.entities` / `cache.relations` in place. Callers that hold those array references must still observe the new arrays (assignment, not an in-place `splice`, matches today). Archive dry-run must not call this on the live graph.

---

### Task 21: `privateRecordEntity` shell

**Files:**
- Modify: `src/agent/learning/LearningTrace.ts` `buildTraceEntity`
- Modify: `src/agent/knowledge/knowledgeRevision.ts` `heuristic.add`, `memory.reflect`, `buildSkillEntity`
- Modify: `src/agent/knowledge/InstructionSetManager.ts` `buildInstructionSetEntity` (same shell: confidence `1`, no `contentHash`, record key `instructionSetRecord`; `InstructionSetManager.ts` 291–306)
- Test: learning-trace create tests and knowledge-revision apply tests. Snapshot the entity objects (confidence, `contentHash` presence, record property name).

**Interfaces:**

```typescript
function privateRecordEntity(
  fields: {
    name: string;
    entityType: string;
    observations: string[];
    now: string;
    memoryType: string;
    confidence: number;
    contentHash?: string;
    recordKey: string;
    record: unknown;
  },
): Entity
```

`buildTraceEntity` keeps its public signature and its `as LearningTraceEntity` cast. Heuristic and reflection stay `as unknown as Entity` with `confidence: 0.5`. Skill keeps `contentHash` and `confidence: 1`. Do not export this helper from a barrel.

- [x] **Steps:** characterize one entity per kind (learning_trace, heuristic, reflection, skill, instruction_set) → extract → same objects → commit `refactor: share private memory entity shell`

**Risks:** `createdAt` / `lastModified` for these literals are the `now` argument, not `toIsoDateTime(now)` (the nested records use `toIsoDateTime`). Do not swap them. `buildInstructionSetEntity` stays exported with the same signature and cast. `applyOp` validation strings stay in the switch.

---

## Implementation outcome

Implemented on branch `cursor/clones-dedup-impl-d0b2` (from plan head `db9b7fc`), one PR to `master` (references plan PR #323).

Every REFACTOR row landed with behavior-pinning tests first (each new test file passed against the pre-refactor code except where it imports a helper that did not exist yet, in which case the pinned public behavior passed and the helper-only cases failed only on the missing symbol):

| Task | Row | Helper | Test file |
|---|---|---|---|
| 1 | E1/N1 | `raceAbort` imported from `llmJson` | `tests/unit/agent/learning/llmJson.raceAbort.test.ts` |
| 2 | N4 | `toLoadItems`, `packLoadedKnowledge`, `prepareLoad`, `loadSkillMatches` | `tests/unit/agent/knowledge/knowledgeLoad.pack.test.ts` |
| 3 | N3 | `SalienceEngine.fieldRelevance` | `tests/unit/agent/SalienceEngine.test.ts` |
| 4 | N5 | `QueryCostEstimator.scoreLayerBySignals` | `tests/unit/search/QueryCostEstimator.test.ts` |
| 5 | N7 | `failInvalidType`, `failInvalidValue` | `tests/unit/utils/schema.failures.test.ts` |
| 6 | N8, N15 | `DEFAULT_*` module constants | existing constructor tests |
| 7 | N9 | `loadTasksByIds` | `tests/unit/agent/learning/loadTasksByIds.test.ts` |
| 8 | N10 | `patchVersionedRecord` (in `versionedWriteFailure.ts`) | existing archive/markResolved pins + microtask-turn pins |
| 9 | N11 | `emptyTraversal`, `beginTraversal`, `visitNode`, `forEachOpenNeighbor` | `tests/unit/core/GraphTraversal.test.ts` (diamond timing pins), `tests/unit/core/GraphTraversal.bfsDuplicates.test.ts` |
| 10 | N13 | `mapGraphXml` | `tests/unit/features/IOManager.xmlGoldens.test.ts` (byte-for-byte) |
| 11 | N14 | `foldRuleResult` | `tests/unit/utils/EntityValidator.results.test.ts` |
| 12 | N16 | `applyHashBits(item, mode)` (no per-call closure/array) | `tests/unit/search/BloomFilter.test.ts` (bit-layout pin) |
| 13 | N17 | `readOptional`, `assignOptional`, `applyOptionalColumns` | `tests/unit/core/PostgreSQLStorage.test.ts` |
| 14 | N19 | `emitJson`, `addJsonCommand` | `tests/unit/cli/emitJson.test.ts` |
| 15 | N21 | `clampedHalfLifeScore` delegation | `tests/unit/agent/DecayEngine.test.ts` |
| 16 | N22 | `inducedSubgraph` | `tests/unit/search/inducedSubgraph.test.ts` |
| 18 | E2/N2 | `copySimilarDateFields`, `copySimilarTimeFields` | `tests/unit/search/enDate.similarFields.test.ts` |
| 19 | N12 | `checkAndReturnTimePattern(result, kind)` | `tests/unit/search/enDate.timePatterns.test.ts` |
| 20 | N26 | `omitNamedEndpoints` | `tests/unit/core/storageCache.test.ts` |
| 21 | N27 | `privateRecordEntity` | `tests/unit/agent/privateRecordEntity.test.ts` |

N4, N11 and N17 needed a second, larger extract: the first pass moved only the tail, and Task 17's gate still reported the pair. The helpers gained `prepareLoad` / `loadSkillMatches` (N4), `visitNode` + `forEachOpenNeighbor` with `claimOnVisit` for BFS vs DFS (N11), and the table-driven `applyOptionalColumns` (N17) before those rows dropped.

### Clone counts

`npx -y @danielsimonjr/repo-tools@2.6.0 clones . --out=<outside repo>`, `minNodes=50`, before = `de3f30cf` baseline, after = this branch:

| Metric | Before | After |
|---|---|---|
| files | 415 | 416 (one new `@internal` module, `src/agent/knowledge/privateRecordEntity.ts`) |
| units | 1849 | 1841 |
| **exact groups** | **2** | **0** |
| **near pairs** | **27** | **6** |

The six remaining near pairs are exactly the KEEP set: N6 (`ExtractTimezoneAbbrRefiner.refine` / `MergeWeekdayComponentRefiner.refine`), N18 (`LearningTrace.flush` / `KeyedMutex.run`), N20 (`LeafLearnerDeps.editor.edit` / `makeRound`), N23 (`parseVerdicts` / `makeRound`), N24 (`createLeafLearnerDeps` / `makeRound`), N25 (`Bootstrapper.run` / `makeRound`). No REFACTOR row is left.
