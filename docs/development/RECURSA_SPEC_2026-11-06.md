# Recursa for MemoryJS — specification and subagent-driven implementation plan

**Source paper:** Zhu, Lin, Shi, Lin & Zhou, *Recursa: Toward Recursively Self-Improving Foundation
Model Systems*, arXiv 2611.04035, November 2026.
**Target:** MemoryJS 4.5.x (`master` at `731a96d`). **Status:** proposal, nothing applied.
**Audience:** the Planner / Builder / Challenger / Checker / Fixer roles. Every item names its files,
types, tests, risk and the invariants the Challenger attacks.

---

## 0. Executive summary

Recursa is a *foundation model system* that adapts to a new domain without a human expert or a
stronger teacher model. It does this by learning its **knowledge repository** `K = (instructions,
skills, memory)` rather than its weights, in two phases:

1. **Bootstrapping** closes the *knowledge gap*: summarize and map the domain corpus into navigation
   structures and exploration notes, record what the corpus does and does not contain, generate
   practice tasks from the materials, and practice on them with parallel agents whose findings are
   merged. Output: `K^(0)`.
2. **Recursive self-improvement** closes the *behaviour gap*: `LEARN(D, K)` (Algorithm 1). A **leaf
   learner** runs *solve → diagnose → edit → validate* with parallel solvers, keeping an edit only
   if it fixes failures without regressions. A **parent learner** splits the task set, runs child
   learners in parallel, **merges** their revisions (dedupe, reconcile conflicts, generalize,
   re-validate on a sample), **reflects** on the children's learning traces into memory, and
   repeats until no progress or the budget is spent.

The paper's harness (persistent REPL, append-only event log with programmatic retrieval, subagents)
is what makes long-horizon learning tractable. Its headline result: all-pass on held-out Harvey LAB
tasks from 30.0 % to 55.0 % (DeepSeek-V4.1-Flash) and 35.0 % to 46.0 % (Qwen3.8-Flash), with
multi-learner decomposition beating a single learner and bootstrapping cutting turns and tokens by
roughly a fifth to a quarter.

**What this means for MemoryJS.** MemoryJS is a memory library, not an agent runtime. It already
holds most of the *memory* leg of `K` (episodic, semantic, procedural, heuristic, failure, reflection,
plan, project-context, tool-affordance records), an offline self-evolution loop for one component
(`ProceduralGraphEvolution`), and an optional `LLMProvider` seam with deterministic fallbacks. What it
lacks is (a) **skills** as a first-class, versioned, load-on-demand memory type, (b) a **knowledge
repository** that versions `K` as a whole and can diff/merge revisions, (c) an **append-only
interaction log** with addressable, programmatically retrievable records for context management,
(d) a **bootstrapper** that turns a corpus into navigation structures, boundary records and practice
tasks, (e) the **recursive learning loop** itself (leaf + parent learners, split/merge/reflect,
validation gate, learning traces, budgets, waste and signal accounting), and (f) a small
**evaluation harness** (rubric criteria, mean-criteria and all-pass metrics, stratified splits).

This plan adds those six capabilities as additive `@experimental` modules under `src/agent/skills/`,
`src/agent/knowledge/`, `src/agent/harness/`, `src/agent/bootstrap/`, `src/agent/learning/` and
`src/agent/evaluation/`, wired through lazy `ManagerContext` getters, with the *solver* (the model
that executes tasks) always supplied by the caller as a callback, exactly as `ProceduralGraphEvolution`
takes `rollout` / `evaluate`. Every learning step works without an LLM (deterministic fallbacks) and
gets better with one. 27 implementable items in 6 ordered phases, ~24 new source files, ~30 new test
files; no new runtime dependencies.

---

## 1. Paper → MemoryJS concept map

| Recursa concept (section) | Already in MemoryJS | Gap this plan fills |
|---|---|---|
| Knowledge repository `K` = instructions + skills + memory (§2.2) | memory types in `src/types/agent-memory.ts` (`MEMORY_TYPES`: working, episodic, semantic, procedural, prospective, failure, plan, reflection, heuristic, exclusion, decision, project_context, …); `ProjectContextManager` (project knowledge ≈ instructions); `ProcedureManager` + `ProceduralGraphManager` (procedural); `HeuristicManager` (condition→action rules) | `skill` memory type + `SkillManager` (RS-1..3); `InstructionSet` records (RS-4); `KnowledgeRepository` facade with versioned snapshots `K^(t)`, diff and merge (RS-5..6) |
| Skills in Agent Skills format: instructions + bundled scripts/refs, loaded on demand; every entry links its source, states uncertainty and applicable scope (§2.2, §4.1) | nothing skill-shaped; `Procedure` is step-sequence oriented | `SkillRecord` with `scope`, `uncertainty`, `sources[]`, `body`, `resources[]`, lineage; SKILL.md import/export (RS-2, RS-3) |
| Harness: persistent REPL, tool composition in code (§3.1) | out of scope (runtime concern) | none; the caller's `Solver` owns execution |
| Programmatic context management: append-only event log, records retrievable by address into variables, context holds only recent history + an eviction index (§3.2, Fig. 2b) | `TransitionLedger` (graph-mutation audit), `EventManager` (reified domain events), `SessionCheckpoint`, `ContextWindowManager` (budgeted retrieval, spillover pages) | `InteractionLog` append-only JSONL with `addr`, `search`, `read`, `select`, size caps with disk spill; `EvictionIndex` hook for `ContextWindowManager` (RS-7..8) |
| Multi-agent orchestration: subagents on isolated sandboxes, results merged (§3.3) | `MultiAgentMemoryManager` (visibility), `CollaborativeSynthesis`, `WorkThreadManager` (claim/release), worker pool | parallel child learners / shard mappers via caller-supplied `runSubagent` callback + `ConcurrencyLimiter` (RS-9) |
| Bootstrapping: navigation structures (summaries linked to source locations, structured metadata, RAPTOR-style levels), exploration notes/cheatsheets, boundary records (present / absent / partial), multi-agent map + merge (§4.1) | `HierarchyManager`, `SummarizationService` (LLM or extractive), `KeywordExtractor`, `IOManager.ingest`, `ReconstructiveMemory` topic layer | `CorpusMapper` → `navigation-node` entities with `located_at` / `summarizes` relations; `BoundaryRecorder` → `coverage` records; `ExplorationNotes` cheatsheet (RS-10..12) |
| Self-practice: generate practice tasks from materials, attempt, record reflections, refine initial skills (§4.2) | none | `PracticeTaskGenerator` (LLM or template fallback) producing `Task`s with rubric + source refs; practice run reuses the leaf learner (RS-13) |
| Leaf learner loop solve→diagnose→edit→validate; keep an edit only if it fixes failures without regressions (§5.1) | `ProceduralGraphEvolution` (propose → validate → evaluate → retain on validation gain) for one procedural graph; `FailureManager`, `FailureDistillation`, `HeuristicExtractionStage` | `LeafLearner` over the whole `K` with `Diagnoser`, `KnowledgeEditor`, `RevisionValidator` (RS-14..17) |
| Split by category / failure case / skill / tool; children in parallel; merge (dedupe, reconcile, generalize, re-validate on sample); reflect on children's traces (§5.2) | `ConflictResolver` (memory conflict strategies), `CompressionManager` (entity merge), `ReflectionManager` | `SplitStrategy` set, `RevisionMerger`, `LearningReflector`, `RecursiveLearner` (RS-18..21) |
| Learning trace `T` (learner actions, solver traces, children's traces) (§2.1) | `EventManager` flows; `TrajectoryCompressor` | `LearningTrace` tree persisted as `learning-trace` entities linked to `InteractionLog` addresses (RS-22) |
| Learning waste (stalls, rework) and learning signal (solver vs learner signals) (§5.3) | `ToolAffordanceManager` rolling stats | `LearningAccountant`: stall and rework counters, signal ledger, budget (rounds / tokens / wall-clock) (RS-23) |
| Evaluation: rubric criteria per task, mean-criteria pass and all-pass, stratified train/test split, criteria audit (§6.1, App. B) | none | `evaluation/`: `Criterion`, `RubricJudge` (LLM or deterministic), metrics, `stratifiedSplit`, `RubricAudit` (RS-24..26) |
| Harness reduces exploration (fewer turns/tokens after bootstrapping) (§6.3, Fig. 4) | `ContextWindowManager.wakeUp` L0/L1 | `KnowledgeRepository.loadForContext()` feeding `wakeUp` (RS-27) |

Out of scope, by design: the Python REPL, model inference, sandboxing, and training the foundation
model (the paper itself leaves model and harness learning to future work).

---

## 2. Design principles (binding on every item)

1. **The library never runs a model or a task.** Solving, judging and refining are caller-supplied
   callbacks: `Solver`, `RubricJudge`, `PGCompletionProvider`. This mirrors
   `PGEvolutionDependencies.rollout/evaluate/refiner` and keeps MemoryJS testable with fakes.
2. **LLM optional, never required.** Every editor / generator / judge has a deterministic fallback
   (template, extractive, lexical) so the whole loop runs in CI with no network, as
   `LLMQueryPlanner`, `SummarizationService` and `MemoryDistiller` already do.
3. **Knowledge is graph entities.** Skills, instruction sets, navigation nodes, coverage records,
   tasks, revisions and learning traces are `AgentEntity` subtypes with a `memoryType` and a typed
   `...Record` field (the `HeuristicEntity` / `FailureRecord` pattern), so they are searchable,
   versionable (`version` / `supersededBy`), governed and exportable with no new storage code.
4. **Validation gates every edit.** No revision reaches `K` unless `RevisionValidator` shows it fixes
   at least one previously failing task and regresses none of a held sample (paper §5.1). The
   result union is returned, never thrown (the `ProceduralGraphEvolution` convention).
5. **Additive and experimental.** New modules carry `@experimental`; nothing existing changes shape.
   New `ManagerContext` getters are lazy and env-gated where they allocate resources.
6. **Repo gates.** `bun run typecheck`, `bun run lint` (types leaf rule, no discarded
   `updateEntity` results), `repo-tools docs check src` (every export documented), census and
   duplicate-symbol checks, files < 500 lines (src) / < 400 (tests), no new dependencies, env vars
   read through `src/utils/envConfig.ts`.

---

## 3. Specification

### 3.1 Skills (`src/agent/skills/`)

**RS-1 `skill` memory type and `SkillRecord`** (`src/types/agent-memory.ts`, additive)

```ts
export type SkillId = string & { readonly __brand: 'SkillId' };
export type SkillKind = 'navigation' | 'procedure' | 'judgment' | 'convention' | 'tool';
export interface SkillSource { ref: string; kind: 'document' | 'entity' | 'url' | 'trace'; excerpt?: string }
export interface SkillRecord {
  id: SkillId;                      // `skill-<slug>-<shortId>`
  name: string;                     // Agent Skills `name`
  description: string;              // when to apply (the retrieval key)
  kind: SkillKind;
  scope: { domains: string[]; tasks?: string[]; tools?: string[] };   // applicable scope (§4.1)
  uncertainty: number;              // [0,1] — the entry states how sure it is (§4.1)
  body: string;                     // Markdown instructions (SKILL.md body)
  resources: Array<{ name: string; ref: string; kind: 'script' | 'reference' | 'template' }>;
  sources: SkillSource[];           // every entry retains a link to its source (§4.1)
  lineage: { revisionId?: string; parentSkillId?: SkillId; learnedFromTaskIds?: string[] };
  stats: { applied: number; helped: number; hurt: number };
  createdAt: IsoDateTime; lastUpdatedAt: IsoDateTime;
}
export interface SkillEntity extends AgentEntity { memoryType: 'skill'; skillRecord: SkillRecord }
```
`MEMORY_TYPES` gains `'skill'`; a `recordGuard('skill', 'skillRecord', …)` `isSkillEntity` guard
follows the heuristic pattern. Observations carry `[skill-name]:`, `[kind]:`, `[scope]:` scalar lines so
lexical search and `ObserverPipeline` work unchanged.

**RS-2 `SkillManager`** (`src/agent/skills/SkillManager.ts`, ≤ 450 lines)
`add(input) → SkillId` (name/scope validation, content-hash dedup on `body`), `get`, `list(filter)`,
`update(id, patch, { expectedVersion })` (OCC via `EntityManager.updateEntity`, mirrors
`HeuristicManager`), `retire(id, reason)` (sets `supersededBy` or a retired flag, never deletes),
`match(taskHint, { limit, minScore })` → ranked `SkillMatch[]` scoring `description` + `scope` tokens
(`tokenSetWithoutStopwords`) and, when `semanticSearch` is wired, cosine similarity (the
`HeuristicManager.match` shape), `recordOutcome(id, 'helped' | 'hurt')`, `loadForContext(ids, budget)`
→ Markdown block sized by `estimateTokensFromText`. Emits `skill:added|updated|retired` on the graph
emitter.

**RS-3 SKILL.md import / export** (`src/agent/skills/SkillFormat.ts`)
`toSkillMarkdown(record)` / `parseSkillMarkdown(text)` following the Agent Skills layout (YAML front
matter `name`, `description`, `scope`, `uncertainty`, `sources`; body Markdown; `resources/` listing).
`IOManager` gains `exportSkills(dir)` / `importSkills(dir)` (one directory per skill) reusing its path
confinement helpers. Round-trip is byte-stable for records produced by `toSkillMarkdown`.

### 3.2 Instructions and the knowledge repository (`src/agent/knowledge/`)

**RS-4 `InstructionSet`** (`src/types/agent-memory.ts` + `src/agent/knowledge/InstructionSetManager.ts`)
`memoryType: 'instruction_set'`; `InstructionSetRecord { id, role: 'solver' | 'learner' | 'shared',
sections: Array<{ heading, text, sources, uncertainty }>, version, createdAt, lastUpdatedAt }`. The
system prompt, guardrails and conventions (§2.2) become editable, versioned, source-linked data.
`InstructionSetManager` = add / get / patchSection / render(role, budget) / history.

**RS-5 `KnowledgeRepository`** (`src/agent/knowledge/KnowledgeRepository.ts`)
The paper's `K`. Composes `InstructionSetManager`, `SkillManager` and the memory managers it needs
(`heuristicManager`, `failureManager`, `reflectionManager`, `projectContextManager`). API:
`snapshot(label?) → KnowledgeSnapshot` (`{ id: 'K-<n>', createdAt, instructionSetIds[], skillIds[],
memoryRefs: { heuristics: n, failures: n, reflections: n }, digest }`, persisted as a
`knowledge-snapshot` entity); `diff(a, b) → KnowledgeDiff` (added / updated / retired skills,
instruction section changes); `applyRevision(rev, { expectedSnapshot }) → ApplyResult` (OCC on the
snapshot digest, returns `'applied' | 'conflict' | 'rejected'`); `rollbackTo(snapshotId)`;
`loadForContext({ role, taskHint, budgetTokens })` → ordered Markdown (instructions → matched skills →
matched heuristics/failures) using `SkillManager.match` and `FailureManager.lookupForTask`.

**RS-6 `KnowledgeRevision`** (`src/types/agent-memory.ts`)
```ts
export type RevisionOp =
  | { op: 'skill.add'; skill: Omit<SkillRecord, 'id' | 'createdAt' | 'lastUpdatedAt' | 'stats'> }
  | { op: 'skill.update'; id: SkillId; patch: Partial<Pick<SkillRecord, 'body' | 'description' | 'scope' | 'uncertainty' | 'sources'>> }
  | { op: 'skill.retire'; id: SkillId; reason: string }
  | { op: 'instruction.patch'; id: string; heading: string; text: string; sources: SkillSource[] }
  | { op: 'heuristic.add'; condition: string; action: string }
  | { op: 'memory.reflect'; summary: string; evidence: string[] };
export interface KnowledgeRevision { id: string; baseSnapshotId: string; ops: RevisionOp[];
  rationale: string; diagnosedFailureIds: string[]; producedBy: 'leaf' | 'merge' | 'bootstrap' | 'manual';
  createdAt: IsoDateTime }
```
Persisted as `knowledge-revision` entities so the learning trace can cite them.

### 3.3 Harness support (`src/agent/harness/`)

**RS-7 `InteractionLog`** (`src/agent/harness/InteractionLog.ts`)
Append-only JSONL sidecar at `sidecarPath(storage, '-interactions')` (RS uses the existing
`sidecarPath` helper and `durableAppendFile`). Record:
`{ addr: 'e<n>', ts, sessionId, kind: 'model' | 'tool_call' | 'tool_output' | 'note' | 'feedback',
  tag?: string, content: string, bytes: number, truncated?: { spillPath, originalBytes } }`.
API (all async, serialized by a mutex, the `DiskWarmTier` append pattern): `append(rec) → addr`,
`read(addr)`, `range(fromAddr, toAddr)`, `search(query, { kinds, sessionId, limit })` (lexical, uses
`tokenizeUnicodeToSet`; semantic when `semanticSearch` is wired), `select(addr, { regex | fields |
lines })` returning only the selected excerpt (§3.2: only selected evidence enters the context),
`stats()`. Long outputs over `maxInlineBytes` (default 16 KiB, env `MEMORY_INTERACTION_LOG_INLINE_BYTES`)
spill to `<sidecar>-blobs/<addr>` and the record keeps the head. Compaction is a full rewrite behind
the mutex (reuse `DiskWarmTier` compaction semantics: tombstone-free since append-only).

**RS-8 `EvictionIndex` + `ContextWindowManager` hook** (`src/agent/harness/EvictionIndex.ts`)
When `ContextWindowManager.handleSpillover` drops entities, it can register
`{ fromAddr, toAddr, summary }` ranges so the model context keeps "what was removed and how to get it
back" (§3.2). `ContextWindowManager` gains an optional `setEvictionIndex(index)`; `wakeUp` and
`retrieveForContext` append an `[evicted]: e12–e48 — <summary>` line per range when one is set.
No behaviour change when unset.

**RS-9 `ConcurrencyLimiter` and the subagent seam** (`src/agent/harness/ConcurrencyLimiter.ts`)
`runAll(items, fn, { concurrency, signal })` with per-item error isolation (the DES-10 promotion
pattern) and stall accounting (time items spend queued). `SubagentRunner` is an interface
`{ run<T>(task: SubagentTask): Promise<T> }` the caller supplies; the library only orchestrates.

### 3.4 Bootstrapping (`src/agent/bootstrap/`)

**RS-10 `CorpusMapper`** (`src/agent/bootstrap/CorpusMapper.ts`)
Input: `CorpusSource[]` (`{ ref, title?, text | loader(), metadata }`) and a `Partitioner`
(default: by `metadata.group` else fixed-size shards). For each shard (in parallel through
`ConcurrencyLimiter`) build a leaf `navigation-node` per source (`summary` via
`SummarizationService.summarize`, `keywords` via `KeywordExtractor`, `metadata` copied,
`located_at` relation to the source entity) then fold shards into parent nodes level by level
(RAPTOR-style, `summarizes` relations, `HierarchyManager.setEntityParent`) until one root per
corpus. The merge step dedups leaf nodes by source ref and reconciles conflicting summaries by
keeping both with a `[conflict]:` observation. Output: `NavigationMap { rootId, levels, nodeCount }`.

**RS-11 `BoundaryRecorder`** (`src/agent/bootstrap/BoundaryRecorder.ts`)
`memoryType: 'coverage'`; one `CoverageRecord { region, status: 'present' | 'absent' | 'partial',
evidence: SkillSource[], note, recordedAt }` per region the caller or mapper names (§4.1 "which kinds of
material are present, absent, or partial"). `lookup(region)` and `summaryForContext()` feed
`KnowledgeRepository.loadForContext` so solvers do not search for what is known to be absent.

**RS-12 `ExplorationNotes`** (`src/agent/bootstrap/ExplorationNotes.ts`)
A single `skill` of kind `convention` per corpus (the cheatsheet form, §4.1): terminology, conventions,
guidance for future investigation, each bullet with `sources` and `uncertainty`. Built from
navigation-node keywords + conflicts + coverage; LLM-written when a provider exists, template otherwise.

**RS-13 `PracticeTaskGenerator`** (`src/agent/bootstrap/PracticeTaskGenerator.ts`)
From navigation nodes produce `Task`s (RS-24) grounded in materials: each has `input`, `sources[]`,
a `rubric` of ≥ 1 `Criterion`, and `difficulty`. LLM path uses the paper's framing ("tasks require
agents to find relevant sources, reconcile evidence, and produce supported responses"); fallback
templates: *locate* (which source states X), *reconcile* (two sources disagree on X), *enumerate*
(all sources matching metadata filter). Optional `guidance` (preferences, rubrics, known failure modes)
steers generation (§4.2). `Bootstrapper.run()` = map → boundaries → notes → practice tasks →
one `LeafLearner.learn()` pass over the practice tasks → `KnowledgeRepository.snapshot('K0')`.

### 3.5 Recursive self-improvement (`src/agent/learning/`)

**RS-14 Core contracts** (`src/agent/learning/types.ts` → re-exported from `src/types/learning.ts`
to keep `src/types` a leaf; concrete types live in `src/types`, interfaces with callbacks in `src/agent`)
```ts
export interface Solver { solve(task: Task, knowledge: LoadedKnowledge, signal?: AbortSignal): Promise<SolveResult> }
export interface SolveResult { answer: string; traceAddrs: string[]; tokens?: { input: number; output: number } }
export interface Feedback { taskId: string; criteria: CriterionResult[]; allPass: boolean; source: 'judge' | 'human' | 'test' }
export interface Diagnosis { taskId: string; kind: 'missing-knowledge' | 'wrong-behaviour' | 'noisy-feedback' | 'ambiguous';
  summary: string; evidenceAddrs: string[]; relatedSkillIds: SkillId[]; relatedFailureId?: string; confidence: number }
export interface LearnOptions { tasks: Task[]; budget: LearningBudget; split?: SplitStrategy | 'auto';
  validationSampleSize?: number; concurrency?: number; signal?: AbortSignal }
export interface LearningBudget { maxRounds: number; maxTokens?: number; maxWallClockMs?: number; maxChildren?: number }
export interface LearnResult { snapshotId: string; trace: LearningTrace; before: EvalMetrics; after: EvalMetrics;
  stoppedBecause: 'no-progress' | 'budget-rounds' | 'budget-tokens' | 'budget-time' | 'aborted' | 'all-pass' }
```

**RS-15 `Diagnoser`** (`src/agent/learning/Diagnoser.ts`)
Reads feedback + solver trace excerpts (`InteractionLog.select`) for failed tasks, separates genuine
solver errors from noisy or ambiguous feedback (§5.1 Diagnose), and records each genuine failure
through `FailureManager.record` (`applicability_hint` = task category + failed criteria). LLM path
uses a diagnosis prompt returning the `Diagnosis` JSON (Zod-validated, retry once, fallback on parse
failure); deterministic fallback classifies by criterion type and failure-mode keywords. Reflections
from earlier rounds (`ReflectionManager.getRelevantForSession`) are included as context (§5.3).

**RS-16 `KnowledgeEditor`** (`src/agent/learning/KnowledgeEditor.ts`)
Turns `Diagnosis[]` into one `KnowledgeRevision`. For `missing-knowledge` → `skill.add` (navigation or
convention) grounded in the diagnosis evidence sources; for `wrong-behaviour` → `skill.update` of the
most related skill or `instruction.patch`, plus `heuristic.add` when the fix is a condition→action
rule. LLM path drafts the skill body; fallback composes it from the evidence excerpts and the failed
criteria text. Never edits `K` directly; returns the revision for validation.

**RS-17 `RevisionValidator`** (`src/agent/learning/RevisionValidator.ts`)
Applies the revision to a *scratch* snapshot (RS-5 `applyRevision` on a cloned snapshot, not the live
one), re-runs the affected tasks plus a sample of previously passing tasks (`validationSampleSize`,
stratified by category) through the `Solver` and `RubricJudge`, and returns
`{ verdict: 'accept' | 'reject', fixed: string[], regressed: string[], unchanged: string[] }`. Accept
iff `fixed.length > 0 && regressed.length === 0` (§5.1 Validate). The scratch snapshot is discarded on
reject; on accept the same ops are applied to the live `K` with `expectedSnapshot` OCC.

**RS-18 `LeafLearner`** (`src/agent/learning/LeafLearner.ts`)
Algorithm 1 lines 2–7: repeat { solve all tasks in parallel (`ConcurrencyLimiter`) → judge → if all
pass stop → diagnose → edit → validate → apply or discard } until no accepted edit in a round or the
budget is spent. Writes a `LearningTrace` node per round (RS-22) and `LearningAccountant` counters
(RS-23). Returns `LearnResult`.

**RS-19 `SplitStrategy`** (`src/agent/learning/SplitStrategies.ts`)
`byCategory` (task `category` / tags), `byFailureMode` (cluster failed tasks by diagnosis kind +
failed criterion ids), `bySkill` (group by the skills `SkillManager.match` returns), `byTool`
(task `tools[]`), and `auto` (choose the strategy that minimizes expected duplicate work: the most
even partition whose groups share the fewest matched skills — §5.2 "subsets exercise different
skills"). Each returns `TaskSubset[]` with a label and a rationale string.

**RS-20 `RevisionMerger`** (`src/agent/learning/RevisionMerger.ts`)
Merges child revisions into one (§5.2 Merging): dedupe `skill.add` ops whose bodies are near-identical
(Jaccard over `tokenSetWithoutStopwords` ≥ 0.8, reuse `ObservationDedupManager` thresholds), reconcile
conflicting `skill.update` / `instruction.patch` on the same target (LLM reconcile prompt; fallback keeps
the child with the larger `fixed` set and records the other as a `[conflict]:` observation),
generalize recurring lessons (two or more children adding skills with the same `scope.domains` →
one skill with the union scope, LLM-generalized body or concatenated fallback). The merged revision is
then validated on a sample of the children's tasks (RS-17) before it is applied.

**RS-21 `RecursiveLearner`** (`src/agent/learning/RecursiveLearner.ts`)
Algorithm 1 lines 9–16: split → child `LEARN` in parallel (each child is a `LeafLearner`, or a
`RecursiveLearner` when the subset is larger than `leafThreshold` and depth < `maxDepth`) → merge →
reflect → choose new subsets → repeat until no progress or budget. `LearningReflector` reads the
children's traces, finds subsets that did not improve, conflicting edits and unreliable feedback, writes
a `ReflectionRecord` (`scope: 'learning'`, evidence = trace entity names) through `ReflectionManager`,
and feeds the next round's split choice (§5.2 Reflection). Exposed as `ctx.learningLoop.learn(opts)`.

**RS-22 `LearningTrace`** (`src/agent/learning/LearningTrace.ts`)
Tree of `learning-trace` entities: `{ id, parentId?, learnerKind: 'leaf' | 'recursive', round, subset,
actions: Array<{ kind: 'solve' | 'diagnose' | 'edit' | 'validate' | 'split' | 'merge' | 'reflect',
startedAt, endedAt, addrs: string[], outcome }>, revisionIds, metrics }`. Children link with
`child_of` relations; solver traces are addresses into `InteractionLog`, never copied (§3.2).
`LearningTrace.toMermaid()` for docs/debugging.

**RS-23 `LearningAccountant`** (`src/agent/learning/LearningAccountant.ts`)
Learning waste and learning signal (§5.3): `stalls` (sum of queued wait from `ConcurrencyLimiter`),
`rework` (tasks solved more than once with an unchanged `K` digest; diagnoses repeated for the same
failure id), `solverSignals` / `learnerSignals` counts, tokens by phase, wall-clock by phase. Budget
checks (`exceeded(budget) → reason | null`) and a `report()` consumed by `LearningReflector`.

### 3.6 Evaluation (`src/agent/evaluation/`)

**RS-24 Task and rubric types** (`src/types/learning.ts`)
`Criterion { id, text, kind: 'fact' | 'document' | 'set-exact' | 'set-precision' | 'number' | 'free' ,
weight? }`, `CriterionResult { criterionId, pass, note? }`, `Task { id, input, category?, tags?, tools?,
difficulty?, sources?: SkillSource[], rubric: Criterion[] }`, `EvalMetrics { tasks, allPass, meanCriteria,
byCategory }` (paper §6.1 metrics).

**RS-25 `RubricJudge` and `Evaluator`** (`src/agent/evaluation/Evaluator.ts`)
`RubricJudge { judge(task, answer): Promise<CriterionResult[]> }` supplied by the caller (an LLM judge
as in the paper) with a built-in `DeterministicJudge` for `fact` (normalized substring), `number`
(tolerance), `set-exact` / `set-precision` (list extraction), `document` (ref mention); `free` is
`pass: false, note: 'needs judge'`. `Evaluator.evaluate(tasks, solver, judge)` → `EvalMetrics` and
per-task `Feedback`. `stratifiedSplit(tasks, { testFraction, by: 'difficulty' })` reproduces the
paper's split by per-task pass rate when a prior `EvalMetrics` is given.

**RS-26 `RubricAudit`** (`src/agent/evaluation/RubricAudit.ts`)
Deterministic checks inspired by App. B's five criterion defects: *placeholder* (`[same N-entry
set]`-style brackets), *files* (criterion names specific filenames only), *contradicts* (criterion
mentions a concept absent from the task input), *omits/admits* heuristics (set criteria whose members
are not all referenced by the task's sources). Returns `RubricIssue[]` for human review; never
auto-rewrites.

**RS-27 Context integration**
`ContextWindowManager.wakeUp` accepts `knowledge?: KnowledgeRepository`; when given, L0 includes
`InstructionSetManager.render('shared', budget)` and L1 includes `SkillManager.match(taskHint)` bodies
within the existing token budget. `AgentMemoryManager` gains `get knowledgeRepository()` delegating
to the context.

### 3.7 `ManagerContext` wiring and configuration

Lazy getters: `ctx.skillManager`, `ctx.instructionSets`, `ctx.knowledgeRepository`,
`ctx.interactionLog` (env `MEMORY_INTERACTION_LOG='true'` strict literal; otherwise `null`),
`ctx.bootstrapper(deps)`, `ctx.evaluator`, `ctx.learningLoop(deps)` (deps = `{ solver, judge?,
llmProvider?, subagentRunner? }`). Env vars (all read via `envConfig`, documented in CLAUDE.md,
README and CONFIGURATION.md):

| Variable | Default | Meaning |
|---|---|---|
| `MEMORY_INTERACTION_LOG` | unset | `'true'` enables `ctx.interactionLog` sidecar |
| `MEMORY_INTERACTION_LOG_INLINE_BYTES` | 16384 | spill threshold per record |
| `MEMORY_LEARNING_MAX_ROUNDS` | 5 | default `LearningBudget.maxRounds` (paper ran K^(1)..K^(5)) |
| `MEMORY_LEARNING_CONCURRENCY` | 4 | default solver / child concurrency |
| `MEMORY_LEARNING_VALIDATION_SAMPLE` | 10 | previously-passing tasks re-run per validation |
| `MEMORY_LEARNING_LEAF_THRESHOLD` | 20 | subsets at or below this size get a leaf learner |
| `MEMORY_LEARNING_MAX_DEPTH` | 2 | recursion depth of `RecursiveLearner` |

---

## 4. Subagent-driven implementation plan

Team: Planner (Fable, low) owns this document and batch briefs; Builders (Haiku, low) implement
batches on disjoint files; Challenger (Haiku, low) writes adversarial and differential tests;
Checker (Opus, low) runs every gate; Fixer (Sonnet, low) closes findings. Each phase ends with
Challenger + Checker, then Fixer, then one PR squash-merged after all six CI legs are green (the
Windows legs catch open-handle leaks: every test that opens a storage or sidecar closes it before
temp-dir cleanup, per `tests/helpers/tempStorage.ts`).

### Phase 1 — Types, skills, instructions, repository (foundation)
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 1A | RS-1, RS-4, RS-6, RS-24 types | `src/types/agent-memory.ts` (+`'skill'`, `'instruction_set'`, `'coverage'`, `'knowledge_snapshot'`, `'knowledge_revision'`, `'learning_trace'` in `MEMORY_TYPES`), new `src/types/learning.ts`, `src/types/index.ts` | type guards table test; `MEMORY_TYPES` exhaustiveness test; existing `types` leaf lint | guard false-positives on near-miss objects; `memoryType` unions used in `switch` statements elsewhere still exhaustive |
| 1B | RS-2, RS-3 | `src/agent/skills/{SkillManager,SkillFormat,index}.ts`, `src/features/IOManager.ts` (+2 methods), `src/agent/index.ts` | add/dedup/OCC/match/outcome tests on both backends; SKILL.md round-trip; path-confinement test for import | OCC conflict on concurrent update; match on empty scope; front-matter injection (`---` inside body); import of a directory escaping the root |
| 1C | RS-5 | `src/agent/knowledge/{InstructionSetManager,KnowledgeRepository,index}.ts` | snapshot digest stable across reload; diff symmetric; applyRevision OCC conflict; rollback restores skills and sections; loadForContext respects budget | applyRevision partial failure mid-ops (must roll back or report exactly which op failed); digest ignores insertion order |
| 1D | `ManagerContext` getters for 1B/1C; docs rows | `src/core/ManagerContext.ts`, `src/core/context/*` if a facade is cleaner, CLAUDE.md, API.md | getter identity + lazy-once; close() releases | getter touched before storage loaded |
Order: 1A first (others import its types); 1B ∥ 1C; then 1D.

### Phase 2 — Harness support
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 2A | RS-7 | `src/agent/harness/{InteractionLog,InteractionLogFormat,index}.ts`, `src/utils/index.ts` (if a helper is shared) | append/read/range/search/select; spill over `maxInlineBytes`; torn trailing line on load; compaction byte-equivalence; Windows close-before-rm | address monotonicity across reopen; concurrent appends under the mutex; select with catastrophic regex (must be bounded or rejected); spill path confinement |
| 2B | RS-8, RS-9 | `src/agent/harness/{EvictionIndex,ConcurrencyLimiter}.ts`, `src/agent/ContextWindowManager.ts` (+`setEvictionIndex`, ≤ 25 lines) | no behaviour change when unset (existing CWM suites unchanged); eviction lines within budget; limiter isolation + stall accounting + abort | abort mid-batch leaves no dangling promise; limiter with concurrency 0/NaN; eviction line pushes context over budget |
Order: 2A ∥ 2B.

### Phase 3 — Evaluation (needed by learners and bootstrapping)
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 3A | RS-25 | `src/agent/evaluation/{Evaluator,DeterministicJudge,index}.ts` | each criterion kind table-driven; metrics match hand-computed values; stratified split reproducible with seed | set-precision with duplicates / case; number with units; free criteria never pass silently |
| 3B | RS-26 | `src/agent/evaluation/RubricAudit.ts` | five defect classes with fixtures adapted from App. B (synthetic, no benchmark text) | false positives on legitimate bracketed text |
Order: 3A ∥ 3B.

### Phase 4 — Leaf learner
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 4A | RS-14 (interfaces), RS-22, RS-23 | `src/agent/learning/{types,LearningTrace,LearningAccountant,index}.ts` | trace tree persistence + reload + Mermaid; accountant rework detection | rework counted when `K` digest changed (must not) |
| 4B | RS-15, RS-16 | `src/agent/learning/{Diagnoser,KnowledgeEditor}.ts` | deterministic fallback classification table; LLM path with a fake provider returning malformed JSON (retry then fallback); FailureManager record written once per genuine failure | prompt injection via task input reaching the revision body unescaped; editor producing ops that reference unknown skill ids |
| 4C | RS-17, RS-18 | `src/agent/learning/{RevisionValidator,LeafLearner}.ts` | accept only when fixed>0 and regressed=0; scratch snapshot never leaks into live `K` on reject; budget stop reasons; all-pass early exit; abort | a solver that is nondeterministic (validator must compare against the same judge, same seed); an edit that fixes A and breaks B exactly at the sample boundary |
Order: 4A → 4B ∥ 4C (4C stubs the editor until 4B lands, then integration test).

### Phase 5 — Recursive learner and bootstrapping
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 5A | RS-19, RS-20 | `src/agent/learning/{SplitStrategies,RevisionMerger}.ts` | each strategy partitions exactly (no task lost or duplicated); `auto` choice deterministic; merge dedup/reconcile/generalize fixtures; merged revision re-validated | subsets of size 1; children revising the same skill in opposite directions; generalization that widens scope beyond evidence |
| 5B | RS-21 | `src/agent/learning/{RecursiveLearner,LearningReflector}.ts` | depth and child budgets honoured; reflection written once per round with trace evidence; no-progress detection; end-to-end with fake solver that improves only when a specific skill exists | runaway recursion; child failure isolation; reflection citing trace ids that do not exist |
| 5C | RS-10..RS-13 | `src/agent/bootstrap/{CorpusMapper,BoundaryRecorder,ExplorationNotes,PracticeTaskGenerator,Bootstrapper,index}.ts` | map of 50 synthetic docs → levels, relations, dedup; coverage lookup; notes from fixtures; practice tasks have rubric + sources; `K0` snapshot | sources with identical refs and different text; empty corpus; partitioner returning empty shards; practice task whose rubric is unsatisfiable |
Order: 5A → 5B; 5C ∥ 5A (5C's practice pass uses the Phase 4 leaf learner).

### Phase 6 — Wiring, docs, example
| Batch | Items | Files |
|---|---|---|
| 6A | RS-27, `ManagerContext` getters for harness / evaluation / learning / bootstrap, `AgentMemoryManager.knowledgeRepository` | `src/core/ManagerContext.ts`, `src/agent/AgentMemoryManager.ts`, `src/agent/ContextWindowManager.ts` |
| 6B | docs: CLAUDE.md (modules, env table, getters), README quick-start for `learningLoop`, `docs/architecture/AGENT_MEMORY.md` (new "Knowledge repository and recursive learning" section with the paper mapping), `docs/architecture/API.md`, CHANGELOG `[Unreleased]` | docs only |
| 6C | `examples/recursa-loop.ts`: fake corpus → bootstrap → stratified split → `learn` with a scripted `Solver` that passes a task once the matching skill exists → prints before/after `EvalMetrics` (runs in CI as an integration test) | `examples/`, `tests/integration/agent/recursa-loop.test.ts` |
Order: 6A → 6B ∥ 6C. Finalize: census regen, verification totals, `repo-tools docs check src`, PR.

### Effort and sequencing

| Phase | Builders in parallel | Est. new src lines | Est. tests |
|---|---|---|---|
| 1 | 3 | ~1,400 | ~45 |
| 2 | 2 | ~700 | ~30 |
| 3 | 2 | ~600 | ~35 |
| 4 | 2 | ~1,300 | ~50 |
| 5 | 3 | ~1,600 | ~55 |
| 6 | 3 | ~300 + docs | ~10 |

Each phase is one PR; phases 2 and 3 can be one PR if both are green. Total: 6 PRs, 27 items.

---

## 5. Acceptance criteria (Checker)

1. All repo gates green on every phase PR, on all six CI legs.
2. **No-LLM end-to-end**: `examples/recursa-loop.ts` with no provider raises all-pass on the fixture
   task set from < 50 % to 100 % within `maxRounds = 3`, because the scripted solver passes a task
   exactly when `K` holds the skill the fixture expects (the loop, not the model, is under test).
3. **Validation gate**: a mutation test that makes `RevisionValidator` always accept must fail at
   least one test (regression is caught).
4. **Context discipline**: no `LearningTrace` or `Diagnosis` stores raw solver output longer than
   `maxInlineBytes`; only `InteractionLog` addresses and selected excerpts.
5. **Backend parity**: every new manager's test suite runs on JSONL and SQLite via
   `withBothBackends`, and closes storages before temp-dir cleanup.
6. **Public surface**: every new export has a doc comment (`repo-tools docs check src`, 0 MUST) and
   is reachable from `src/agent/index.ts` / the root barrel; `@experimental` on every new module.
7. **Metrics parity with the paper's definitions**: `meanCriteria` is the mean over tasks of the
   per-task criteria pass fraction; `allPass` is the fraction of tasks with every criterion passed.

---

## 6. Deferred / owner questions

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Should skills live on disk as SKILL.md directories (source of truth) or as entities with export? | Entities are the source of truth; SKILL.md is import/export (RS-3). |
| Q2 | Is a built-in LLM `RubricJudge` adapter (prompt + JSON schema) wanted, or caller-supplied only? | Provide `LLMRubricJudge` behind the existing `LLMProvider` seam with the deterministic judge as fallback; caller may replace it. |
| Q3 | Should `RecursiveLearner` run child learners through the caller's `SubagentRunner` (true isolation, paper §3.3) or in-process? | In-process by default; `SubagentRunner` optional. |
| Q4 | Token accounting source: provider `getLastUsage` (as `PGCompletionProvider`) or caller-reported in `SolveResult.tokens`? | Both, summed when both present. |
| Q5 | Should `InteractionLog` replace `TransitionLedger` for agent traces, or stay separate? | Separate: the ledger is graph-mutation audit; the log is model/tool interaction history. |
| Q6 | Public API tier for `learning/` after one release: promote to `@public` or keep `@experimental`? | Keep `@experimental` through 4.x. |
| Q7 | Should bootstrapping's parallel mappers use `MultiAgentMemoryManager` visibility (`team`) for shard results before merge? | Not initially; shards write `navigation-node` entities tagged with the shard id. |

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Learning loop cost explodes (rounds × tasks × validation sample) | `LearningBudget` mandatory; `LearningAccountant.exceeded` checked before every solve batch; defaults match the paper's 5 rounds. |
| Validation flakiness with nondeterministic solvers | Validator re-runs with the same judge; `rework` metric exposes it; option `validationRepeats` (default 1). |
| Knowledge drift: merged skills widen scope beyond evidence | `RevisionMerger.generalize` only unions scopes present in evidence; `uncertainty` raised on generalized skills; `RubricAudit`-style audit for skills in a follow-up. |
| Prompt injection from corpus text into skills | Editor/generator outputs are data; `KnowledgeRepository.loadForContext` wraps skill bodies in fenced blocks with provenance headers; no code execution anywhere in the library. |
| File growth | `ConsolidationPipeline` stage to retire skills with `hurt > helped` over N rounds (follow-up, not in this plan). |

---

## 8. Glossary

`K` knowledge repository; `K^(t)` snapshot after round t; `D` training tasks; `SOLVE(x, K) → (y, τ)`;
`LEARN(D, K) → (K', T)`; `τ` solver trace (here: `InteractionLog` addresses); `T` learning trace
(RS-22); learning waste = stalls + rework; learning signal = solver signals (feedback, traces) +
learner signals (validation outcomes, checks against sources, children's traces).
