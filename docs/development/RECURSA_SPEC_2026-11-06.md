# Recursa for MemoryJS — specification and subagent-driven implementation plan

**Source paper:** Zhu, Lin, Shi, Lin & Zhou, *Recursa: Toward Recursively Self-Improving Foundation
Model Systems*, arXiv 2611.04035, November 2026.
**Target:** MemoryJS 4.5.0, based on `master` `731a96d`. **Status:** proposal, nothing applied.
**Revision:** v3 — v2 integrated the Challenger (22 findings) and Checker (claim verification) passes;
v3 resolves the §6 owner questions from the perspective of a harness integrator (MemoryJS used as an
MCP server / plugin for Claude Code): skills publish atomically to disk, YAML is an optional peer,
and the learner is a resumable state machine the harness drives one tool call at a time (§3.8).
**Audience:** the Planner / Builder / Challenger / Checker / Fixer roles. Every item names its files,
types, tests, risk and the invariants the Challenger attacks.

---

## 0. Executive summary

Recursa is a *foundation model system* that adapts to a new domain without a human expert or a
stronger teacher model. It learns its **knowledge repository** `K = (instructions, skills, memory)`
rather than its weights, in two phases:

1. **Bootstrapping** closes the *knowledge gap*: summarize and map the domain corpus into navigation
   structures and exploration notes, record what the corpus does and does not contain, generate
   practice tasks from the materials, and practice on them with parallel agents whose findings are
   merged. Output: `K^(0)`.
2. **Recursive self-improvement** closes the *behaviour gap*: `LEARN(D, K)` (paper Algorithm 1). A
   **leaf learner** runs *solve → diagnose → edit → validate* with parallel solvers, keeping an edit
   only if it fixes failures without regressions. A **parent learner** splits the task set, runs child
   learners in parallel, **merges** their revisions (dedupe, reconcile conflicts, generalize,
   re-validate on a sample), **reflects** on the children's learning traces into memory, and repeats
   until no progress or the budget is spent.

The paper's harness (persistent REPL, append-only event log with programmatic retrieval, subagents)
makes long-horizon learning tractable. Results (paper Table 3, revised rubrics): all-pass on the 100
held-out Harvey LAB test tasks rose from 30.0 % to 55.0 % with DeepSeek-V4.1-Flash and from 35.0 % to
46.0 % with Qwen3.8-Flash; multi-learner decomposition beat a single learner (55.0 % vs 43.0 %, 46.0 %
vs 37.0 %); bootstrapping alone cut mean turns from 69.4 to 55.0 and input tokens from 6.45 M to
4.81 M per task (paper Figure 4).

**What this means for MemoryJS.** MemoryJS is a memory library, not an agent runtime. It already
holds most of the *memory* leg of `K` (episodic, semantic, procedural, heuristic, failure, reflection,
plan, project-context, decision, exclusion and tool-affordance records), an offline self-evolution loop
for one component (`ProceduralGraphEvolution`), and an optional `LLMProvider` seam with deterministic
fallbacks. What it lacks is (a) **skills** as a first-class, versioned, load-on-demand memory type,
(b) a **knowledge repository** that versions `K` as a whole and can diff, merge and roll back,
(c) an **append-only interaction log** with addressable, programmatically retrievable records for
context management, (d) a **bootstrapper** that turns a corpus into navigation structures, boundary
records and practice tasks, (e) the **recursive learning loop** itself (leaf + parent learners,
split/merge/reflect, validation gate, learning traces, budgets, waste and signal accounting), and
(f) a small **evaluation harness** (rubric criteria, mean-criteria and all-pass metrics, stratified
splits, rubric audit).

This plan adds those six capabilities as additive `@experimental` modules under `src/agent/skills/`,
`src/agent/knowledge/`, `src/agent/harness/`, `src/agent/bootstrap/`, `src/agent/learning/` and
`src/agent/evaluation/`, wired through lazy `ManagerContext` getters, with the *solver* (the model
that executes tasks) always supplied by the caller as a callback, exactly as
`ProceduralGraphEvolution` takes `rollout` / `evaluate` / `refiner`. Every learning step works
without an LLM (deterministic fallbacks) and gets better with one. 27 implementable items in 6 ordered
phases, ~26 new source files, ~30 new test files; **no new runtime dependencies**.

---

## 1. Paper → MemoryJS concept map

| Recursa concept (section) | Already in MemoryJS (verified) | Gap this plan fills |
|---|---|---|
| Knowledge repository `K` = instructions + skills + memory (§2.2) | `MEMORY_TYPES` in `src/types/agent-memory.ts:160` = `working, episodic, semantic, procedural, prospective, failure, plan, reflection, heuristic, exclusion, decision, project_context, tool_affordance`; `ProjectContextManager` (project knowledge ≈ instructions); `ProcedureManager` + `ProceduralGraphManager` (procedural); `HeuristicManager` (condition→action rules, lexical `match(input, {limit?, minScore?})`) | `skill` memory type + `SkillManager` (RS-1..3); `instruction_set` records (RS-4); `KnowledgeRepository` facade with full-payload snapshots `K^(t)`, diff, merge, rollback (RS-5..6) |
| Skills in Agent Skills format: instructions + bundled scripts/refs, loaded on demand; every entry links its source, states uncertainty and applicable scope (§2.2, §4.1) | nothing skill-shaped; `Procedure` is step-sequence oriented | `SkillRecord` with `scope`, `uncertainty`, `sources[]`, `body`, `resources[]`, lineage; SKILL.md import/export without a YAML library (RS-2, RS-3) |
| Harness: persistent REPL, tool composition in code (§3.1) | out of scope (runtime concern) | none; the caller's `Solver` owns execution |
| Programmatic context management: append-only event log, records retrievable by address, context holds recent history + an eviction index (§3.2, Fig. 2b) | `TransitionLedger` (graph-mutation audit), `EventManager` (reified domain events), `SessionCheckpointManager`, `ToolCallObserver` (tool outcomes), `ContextWindowManager` (budgeted retrieval, `handleSpillover`) | `InteractionLog` append-only JSONL with `addr`, `search`, `read`, `select`, size caps with disk spill; `EvictionIndex` hook for `ContextWindowManager` (RS-7..8) |
| Multi-agent orchestration: subagents in isolated sandboxes, results merged (§3.3) | `MultiAgentMemoryManager` (visibility), `CollaborativeSynthesis`, `WorkThreadManager` (claim/release) | parallel child learners / shard mappers via caller-supplied `SubagentRunner` + `ConcurrencyLimiter` (RS-9) |
| Bootstrapping: navigation structures (summaries linked to source locations, structured metadata, RAPTOR-style levels), exploration notes, boundary records (present / absent / partial), multi-agent map + merge (§4.1) | `HierarchyManager.setEntityParent`, `SummarizationService.summarize(texts, query?)` (LLM or extractive), `KeywordExtractor`, `IOManager.ingest`, `ReconstructiveMemory` topic layer with the `TOPIC_SUMMARIZES` relation constant | `CorpusMapper` → `navigation_node` entities; `BoundaryRecorder` → `coverage` records; `ExplorationNotes` cheatsheet skill (RS-10..12) |
| Self-practice: generate practice tasks from materials, attempt, reflect, refine initial skills (§4.2) | none | `PracticeTaskGenerator` (LLM or template fallback) producing `Task`s with rubric + source refs; practice run reuses the leaf learner (RS-13) |
| Leaf learner loop solve→diagnose→edit→validate; keep an edit only if it fixes failures without regressions (§5.1) | `ProceduralGraphEvolution` (`PGEvolutionDependencies.rollout/evaluate/refiner/tokenizer`; retain a candidate only when validation improves) for one procedural graph; `FailureManager.record/lookupForTask`, `FailureDistillation`, `HeuristicExtractionStage` | `LeafLearner` over the whole `K` with `Diagnoser`, `KnowledgeEditor`, `RevisionValidator` (RS-14..18) |
| Split by category / failure case / skill / tool; children in parallel; merge (dedupe, reconcile, generalize, re-validate on sample); reflect on children's traces (§5.2) | `ConflictResolver` (memory conflict strategies), `CompressionManager` (entity merge), `AgentReflectionManager` | `SplitStrategy` set, `RevisionMerger`, `LearningReflector`, `RecursiveLearner` (RS-19..21) |
| Learning trace `T` (learner actions, solver traces, children's traces) (§2.1) | `EventManager` flows; `TrajectoryCompressor` | `LearningTrace` tree persisted as `learning_trace` entities linked to `InteractionLog` addresses (RS-22) |
| Learning waste (stalls, rework) and learning signal (solver vs learner signals) (§5.3) | `ToolAffordanceManager` rolling stats | `LearningAccountant`: stall and rework counters, signal ledger, budget (RS-23) |
| Evaluation: rubric criteria per task, mean-criteria pass and all-pass, stratified train/test split, criteria audit (§6.1, App. B) | none | `evaluation/`: `Criterion`, `RubricJudge` (LLM or deterministic), metrics, `stratifiedSplit`, `RubricAudit` (RS-24..26) |
| Harness reduces exploration after bootstrapping (§6.3, Fig. 4) | `ContextWindowManager.wakeUp` L0/L1 | `KnowledgeRepository.loadForContext()` feeding `wakeUp` (RS-27) |

Out of scope, by design: the Python REPL, model inference, sandboxing, and training the foundation
model (the paper itself leaves model and harness learning to future work).

---

## 2. Design principles (binding on every item)

1. **The library never runs a model or a task.** Solving, judging and refining are caller-supplied
   callbacks: `Solver`, `RubricJudge`, `PGCompletionProvider`. This mirrors
   `PGEvolutionDependencies` and keeps MemoryJS testable with fakes.
2. **LLM optional, never required.** Every editor / generator / judge has a deterministic fallback
   (template, extractive, lexical) so the whole loop runs in CI with no network, as
   `LLMQueryPlanner`, `SummarizationService` and `MemoryDistiller` already do. LLM JSON output is
   validated with `zod` (already a dependency), retried once, then falls back.
3. **Knowledge is graph entities.** Skills, instruction sets, navigation nodes, coverage records,
   tasks, snapshots, revisions and learning traces are `AgentEntity` subtypes with a snake_case
   `memoryType` and a typed `...Record` field (the `HeuristicEntity` / `FailureRecord` pattern), so
   they are searchable, versionable (`version`, OCC via `expectedVersion`), governed and exportable
   with no new storage code.
4. **Validation gates every edit.** No revision reaches `K` unless `RevisionValidator` shows it fixes
   at least one previously failing task and regresses none of a held sample (paper §5.1). Result
   unions are returned, never thrown (the `ProceduralGraphEvolution` convention).
5. **Additive and experimental.** New modules carry `@experimental`; nothing existing changes shape.
   New `ManagerContext` getters are lazy and env-gated where they allocate resources.
6. **Repo gates.** `bun run typecheck`; `bun run lint` (`scripts/lint-rules.mjs`: `src/types` imports
   nothing outside `src/types`; `storage.updateEntity` results never discarded); `bun run build`
   (`scripts/check-exports.mjs`); `SKIP_BENCHMARKS=true bun run test:ci`; `bun run tools:check-census`
   and `tools:check-duplicates`; the CI "Architecture docs" job runs `repo-tools check . --docs=docs/architecture`
   and `repo-tools docs check src` (every exported symbol documented, 0 MUST issues). No new
   dependencies. Env vars are read through `src/utils/envConfig.ts`.
7. **File-size rule.** New source files < 500 lines, new test files < 400 lines. The four legacy files
   this plan touched (`src/types/agent-memory.ts`, `src/features/IOManager.ts`,
   `src/agent/ContextWindowManager.ts`, `src/core/ManagerContext.ts`) were already over the limit when
   the plan was written; edits to them were additive and capped per item below. The facade split (#278)
   moved the lazy-getter bodies out of `ManagerContext.ts` into `src/core/context/`, so the
   `ManagerContext.ts` line caps in §3.7 and §4 apply to the pre-split file (§4.1). All new types went in new files
   (`src/types/skills.ts`, `src/types/learning.ts`) re-exported from `src/types/index.ts`.
8. **Barrel ownership.** `src/agent/index.ts`, `src/types/index.ts`, `src/utils/index.ts` and each new
   `index.ts` are edited only by the phase lead, after the phase's parallel batches land. Parallel
   batches never touch a barrel.
9. **Leaf layer split.** Data-only types (records, options, results, enums) live in `src/types/`.
   Interfaces that mention callbacks or manager classes (`Solver`, `RubricJudge`, `SubagentRunner`,
   `LoadedKnowledge`) live in `src/agent/*/types.ts`. Nothing in `src/types` imports from `src/agent`.

---

## 3. Specification

### 3.0 New memory types and entity naming (single source of truth)

| `memoryType` (snake_case, added to `MEMORY_TYPES`) | Record field | Entity name pattern | Introduced |
|---|---|---|---|
| `skill` | `skillRecord` | `skill-<slug>-<shortId>` | RS-1 |
| `instruction_set` | `instructionSetRecord` | `instructions-<role>-<shortId>` | RS-4 |
| `knowledge_snapshot` | `knowledgeSnapshotRecord` | `K-<n>` (n = 0, 1, 2, …) | RS-5 |
| `knowledge_revision` | `knowledgeRevisionRecord` | `revision-<shortId>` | RS-6 |
| `navigation_node` | `navigationNodeRecord` | `nav-<level>-<shortId>` | RS-10 |
| `coverage` | `coverageRecord` | `coverage-<region-slug>` | RS-11 |
| `task` | `taskRecord` | `task-<shortId>` | RS-24 |
| `learning_trace` | `learningTraceRecord` | `trace-<shortId>` | RS-22 |

Hyphenated spellings are never used for `memoryType`. `ReflectionScope` gains `'learning'` (additive;
every `switch` over the scope must stay exhaustive, checked in 1A). The `recordGuard` helper is
module-private in `src/types/agent-memory.ts`, so each new guard (`isSkillEntity`, …) is declared
there, next to `isHeuristicEntity`, while the record *types* live in the new files.

### 3.1 Skills (`src/agent/skills/`)

**RS-1 `SkillRecord`** (`src/types/skills.ts`, new; guards in `agent-memory.ts`)

```ts
export type SkillId = string & { readonly __brand: 'SkillId' };
export type SkillKind = 'navigation' | 'procedure' | 'judgment' | 'convention' | 'tool';
export interface SkillSource { ref: string; kind: 'document' | 'entity' | 'url' | 'trace'; excerpt?: string }
export interface SkillResource { name: string; ref: string; kind: 'script' | 'reference' | 'template' }
export interface SkillRecord {
  id: SkillId;
  name: string;                       // Agent Skills `name`
  description: string;                // when to apply — the retrieval key
  kind: SkillKind;
  scope: { domains: string[]; tasks?: string[]; tools?: string[] };   // applicable scope (§4.1)
  uncertainty: number;                // [0,1] — the entry states how sure it is (§4.1)
  body: string;                       // Markdown instructions (SKILL.md body)
  resources: SkillResource[];
  sources: SkillSource[];             // every entry retains a link to its source (§4.1)
  lineage: { revisionId?: string; parentSkillId?: SkillId; learnedFromTaskIds?: string[] };
  stats: { applied: number; helped: number; hurt: number };
  retired?: { at: IsoDateTime; reason: string };   // retire() sets this; `supersededBy` is not used
  createdAt: IsoDateTime; lastUpdatedAt: IsoDateTime;
}
export interface SkillEntity extends AgentEntity { memoryType: 'skill'; skillRecord: SkillRecord }
```
Observations carry `[skill-name]:`, `[kind]:`, `[scope]:` scalar lines so lexical search and
`ObserverPipeline` work unchanged.

**RS-2 `SkillManager`** (`src/agent/skills/SkillManager.ts`, ≤ 450 lines)
- `add(input) → SkillId`: validates `name` (non-empty, ≤ 80 chars), `scope.domains` non-empty,
  `uncertainty ∈ [0,1]`; content-hash dedup on `sha256(name + '\0' + body)` (NUL separator, so `('ab','c')` and `('a','bc')` differ) returns the existing id of a live skill; a retired match does not dedup.
- `get(id)`, `list({ kind?, domain?, includeRetired? })`.
- `update(id, patch, { expectedVersion })` → `'updated' | 'not-found' | 'version-conflict'` through
  `EntityManager.updateEntity` (the `HeuristicManager` / `FailureManager` OCC pattern).
- `retire(id, reason)` sets `retired`; never deletes.
- `match(taskHint, { limit = 5, minScore = 0.1 })` → `SkillMatch[]` `{ skill, score, matched: string[] }`.
  Score = Jaccard of `tokenSetWithoutStopwords(x, ENGLISH_STOPWORDS_SMALL, 2)` over
  `description + scope.domains + scope.tasks` versus the hint (lexical, ASCII-tokenized, like
  `HeuristicManager.match`), plus, **when `setSemanticSearch(search)` has been called**,
  `0.5 × lexical + 0.5 × cosine`. Retired skills are excluded. Ties break by `helped − hurt`, then id.
- `recordOutcome(id, 'applied' | 'helped' | 'hurt')` increments `stats`.
- `loadForContext(ids, { budgetTokens, multiplier })` → Markdown with one fenced block per skill headed
  by `### <name> (uncertainty 0.2, sources: …)`, trimmed to the budget with
  `estimateTokensFromText(text, multiplier)` (multiplier from `MEMORY_CONTEXT_TOKEN_MULTIPLIER`, default 1.3).
- Emits `skill:added | skill:updated | skill:retired` on the graph event emitter (additive event names).

**RS-3 SKILL.md import / export and publish** (`src/agent/skills/{SkillFormat,SkillPublisher}.ts`)
Front matter parsing has two paths. When the `yaml` package is installed it is used for full YAML
(comments, multi-line scalars, extra harness keys such as `allowed-tools` are preserved in
`SkillRecord.extra`); it is declared as an **optional peer dependency** (the
`@huggingface/transformers` pattern for local embeddings), never a hard dependency, and loaded
lazily with a dynamic import. Without it, the front matter is a fixed, hand-parsed
subset: lines `key: <JSON scalar>` and `key:` followed by `  - <JSON scalar>` list items, keys limited
to `name, description, kind, scope.domains, scope.tasks, scope.tools, uncertainty, sources, resources,
lineage`. Values are written with `JSON.stringify` and parsed with `JSON.parse`; anything else makes
`parseSkillMarkdown` return `{ ok: false, line, reason }` naming the first unsupported construct.
Export always emits the subset so files round-trip on either path. A body line equal to `---` is
written as `\---` and unescaped on parse, so round-trip is byte-stable.

`SkillPublisher` is the harness interface (decision Q1): entities are the source of truth for learning
state; the SKILL.md tree is the **published view** the harness loads.
- `publish(dir)` writes every non-retired skill to a temp directory next to `dir` and renames it into
  place (atomic; a harness never reads a half-written tree), then records `publishedHash` per skill on
  the entity and writes `<dir>/.memoryjs-skills.json` (`{ publishedAt, snapshotId, skills: { id: hash } }`)
  as the change marker a hook or MCP notification can watch.
- `importSkills(dir)` compares each file hash with the entity's `publishedHash`: equal → no-op;
  file changed and entity unchanged → entity updated from the file (human edit absorbed, lineage
  `producedBy: 'manual'`); both changed → `ImportConflict { id, fileHash, entityHash }` returned, never a
  silent overwrite.
- `IOManager` gains thin `exportSkills(dir)` / `importSkills(dir)` wrappers using the existing
  `validateFilePath` confinement (`IOManager.ts:33`); ≤ 40 added lines there.
- The learner calls `publish` after every accepted revision (RS-18), so a harness that reloads skills
  at session start sees the latest `K`.

### 3.2 Instructions and the knowledge repository (`src/agent/knowledge/`)

**RS-4 `InstructionSet`** (`src/types/skills.ts` + `src/agent/knowledge/InstructionSetManager.ts`)
`InstructionSetRecord { id; role: 'solver' | 'learner' | 'shared'; sections: Array<{ heading; text;
sources: SkillSource[]; uncertainty: number }>; createdAt; lastUpdatedAt }`. The system prompt,
guardrails and conventions (§2.2) become editable, versioned, source-linked data.
`InstructionSetManager`: `add`, `get`, `patchSection(id, heading, text, sources, { expectedVersion })`
(adds the section when the heading is new), `render(role, { budgetTokens })`, `history(id)` (via
`TransitionLedger` entries for the entity).

**RS-5 `KnowledgeRepository`** (`src/agent/knowledge/KnowledgeRepository.ts`)
The paper's `K`. Constructed by `ManagerContext` from `ctx.instructionSets`, `ctx.skillManager`,
`ctx.heuristicManager`, `ctx.failureManager`, `ctx.reflectionManager` (`AgentReflectionManager`) and
`ctx.projectContextManager` (these live on `ManagerContext`, not on `AgentMemoryManager`).
- `snapshot(label?) → KnowledgeSnapshotRecord`: persists the **full payload** —
  `{ id: 'K-<n>', label?, createdAt, instructionSets: InstructionSetRecord[], skills: SkillRecord[],
  memoryRefs: { heuristicIds, failureIds, reflectionIds }, digest }` where `digest = sha256` of the
  canonical JSON (sorted keys, arrays sorted by id) of `instructionSets + skills`. `n` is the count of
  existing snapshots; the label is metadata, not the id.
- `diff(aId, bId) → KnowledgeDiff` `{ skills: { added, updated, retired }, sections: { added, changed,
  removed }, memoryRefs: { … } }` computed from the two stored payloads; `diff(a, b)` and `diff(b, a)`
  are mirror images.
- `applyRevision(rev, { expectedSnapshotId }) → ApplyResult` where
  `ApplyResult = { status: 'applied'; snapshotId } | { status: 'conflict'; currentSnapshotId }
  | { status: 'rejected'; failedOpIndex: number; reason: string }`. **All-or-nothing**: ops are applied
  to an in-memory clone first; if any op fails nothing is written and `rejected` names the op. On
  success the writes go through `ctx.batch()` (`BatchTransaction`, default `stopOnError: true`) and a new
  snapshot is taken. `conflict` when the live digest differs from `expectedSnapshotId`'s digest.
- `rollbackTo(snapshotId)` restores skills and instruction sections from the stored payload (skills
  added later are retired, not deleted; sections are rewritten) and takes a new snapshot labelled
  `rollback:<id>`.
- `loadForContext({ role, taskHint, budgetTokens }) → LoadedKnowledge` (`{ markdown, skillIds,
  instructionSetIds, failureIds, tokens }`): instructions (`render`) first, then `SkillManager.match`
  bodies, then `FailureManager.lookupForTask(taskHint)` lessons, trimmed in that order to the budget. Phase 1 composes skills + instruction sets + failures
  only; heuristics, reflections and project context enter `K` as snapshot `memoryRefs`. Heuristic
  lessons in `loadForContext` are added with RS-27 context integration.

**RS-6 `KnowledgeRevision`** (`src/types/skills.ts`)
```ts
export type RevisionOp =
  | { op: 'skill.add'; skill: Omit<SkillRecord, 'id' | 'createdAt' | 'lastUpdatedAt' | 'stats' | 'retired'> }
  | { op: 'skill.update'; id: SkillId; patch: Partial<Pick<SkillRecord, 'body' | 'description' | 'scope' | 'uncertainty' | 'sources'>> }
  | { op: 'skill.retire'; id: SkillId; reason: string }
  | { op: 'instruction.patch'; id: string; heading: string; text: string; sources: SkillSource[] }
  | { op: 'heuristic.add'; condition: string; action: string }
  | { op: 'memory.reflect'; summary: string; evidence: string[] };
export interface KnowledgeRevisionRecord { id: string; baseSnapshotId: string; ops: RevisionOp[];
  rationale: string; diagnosedFailureIds: string[]; producedBy: 'leaf' | 'merge' | 'bootstrap' | 'manual';
  createdAt: IsoDateTime }
```
Persisted as `knowledge_revision` entities so learning traces can cite them. Ops that reference an
unknown skill id or instruction set id are rejected by `applyRevision` with `failedOpIndex`.

### 3.3 Harness support (`src/agent/harness/`)

**RS-7 `InteractionLog`** (`src/agent/harness/InteractionLog.ts` + `InteractionLogFormat.ts`)
Append-only JSONL sidecar at `sidecarPath(storageFilePath, '-interactions')` (`sidecarPath` takes the
storage **file path**), written with `durableAppendFile`. Record:
`{ addr: 'e<n>', ts, sessionId, kind: 'model' | 'tool_call' | 'tool_output' | 'note' | 'feedback',
  tag?: string, content: string, bytes: number, spill?: { path, originalBytes } }`.
- `addr` is `e<n>` with `n` = number of records on disk + 1; on open the file is scanned once to
  recover `n` (torn trailing line tolerated and skipped, the `DiskWarmTier` rule). Addresses are
  monotonic across reopen.
- All methods are serialized by a mutex (`async-mutex`, the `DiskWarmTier` pattern). No compaction:
  the log is append-only with no deletes; size is bounded by the caller (`truncateTo(addr)` is not
  offered in this plan).
- `append(rec) → addr`; `read(addr)`; `range(from, to, { limit })`; `search(query, { kinds, sessionId,
  limit })` lexical over `tokenizeUnicodeToSet` (Jaccard, blended with the semantic provider when set: `(jaccard + similarity) / 2` once `setSemanticSearch` is called);
  `select(addr, { regex?, lines?: [from, to], fields?: string[] })` returns only the selected excerpt
  (§3.2: only selected evidence enters the context). Regex sources are capped at 256 characters,
  patterns with nested quantifiers (`(…+)+`, `(…*)*`) are rejected with `InteractionLogError`, and
  matching runs over at most `maxInlineBytes` of content.
- Content over `maxInlineBytes` (default 16 KiB, env `MEMORY_INTERACTION_LOG_INLINE_BYTES`) is written
  to `<sidecar-dir>/<basename>-interactions-blobs/<addr>` (path validated with `validateFilePath`) and
  the record keeps the first `maxInlineBytes` plus `spill`.
- `stats()` → `{ records, bytes, spilled }`. `close()` releases the handle (Windows CI relies on it).
- `ToolCallObserver` may be pointed at a log (`observer.setInteractionLog(log)`, ≤ 15 lines) so tool
  outcomes are recorded as `tool_call` / `tool_output` records; optional, off by default.

**RS-8 `EvictionIndex` + `ContextWindowManager` hook** (`src/agent/harness/EvictionIndex.ts`)
`EvictionIndex` keeps `{ fromAddr, toAddr, summary, tokens }` ranges. `ContextWindowManager` gains
`setEvictionIndex(index?)` and, inside the **synchronous** `handleSpillover`, calls
`index.record(range)` when one is set; `wakeUp` and `retrieveForContext` append at most
`maxEvictionLines` (default 5) `[evicted]: e12–e48 — <summary>` lines **last**, counted against the
same token budget and dropped first when over budget. No behaviour change when unset; ≤ 40 added lines
in `ContextWindowManager.ts`.

**RS-9 `ConcurrencyLimiter` and the subagent seam** (`src/agent/harness/ConcurrencyLimiter.ts`)
`runAll(items, fn, { concurrency, signal }) → Array<{ ok: true; value } | { ok: false; error }>` with
per-item error isolation (the DES-10 pattern), `concurrency` validated as a positive safe integer,
abort rejecting queued items with `AbortError` and never leaving a pending promise, and
`stats.queuedMs` (stall accounting for RS-23).
`SubagentTask = { kind: 'learn' | 'map' | 'practice'; input: unknown; budget?: LearningBudget }`;
`SubagentRunner = { run<T>(task: SubagentTask, signal?: AbortSignal): Promise<T> }` is caller-supplied
(paper §3.3 isolation); when absent, children run in-process.

### 3.4 Bootstrapping (`src/agent/bootstrap/`)

**RS-10 `CorpusMapper`** (`src/agent/bootstrap/CorpusMapper.ts`)
Input `CorpusSource[]` (`{ ref, title?, text?, loader?(): Promise<string>, metadata }`) and a
`Partitioner` (default: by `metadata.group`, else fixed-size shards of `shardSize`).
- Leaf nodes: one `navigation_node` per source, keyed by `ref` (`NavigationNodeRecord { level: 0, ref,
  title, summary, keywords, metadata, contentHash, sourceRefs: [ref] }`); `summary` from
  `SummarizationService.summarize([text])`, `keywords` from `KeywordExtractor`. Two sources with the
  same `ref` and different text: the first wins by `contentHash`; the second adds a
  `[conflict]: <hash>` observation to the existing node (Batch 5C tests exactly this).
- Shards run in parallel through `ConcurrencyLimiter`; each shard folds its leaves into a level-1 node
  (summary of summaries), and levels fold until one root (`level = maxLevel`). Parent → child uses the
  existing `TOPIC_SUMMARIZES` relation constant (`src/agent/reconstruction/MemoryGraphBridge.ts`) and
  `HierarchyManager.setEntityParent`; `located_at` is a new relation constant from a leaf node to the
  source `ref` entity (created when absent, `entityType: 'source'`).
- Output `NavigationMap { rootId, levels, nodeCount, conflicts }`.

**RS-11 `BoundaryRecorder`** (`src/agent/bootstrap/BoundaryRecorder.ts`)
`CoverageRecord { region; status: 'present' | 'absent' | 'partial'; evidence: SkillSource[]; note;
recordedAt }`, one per region named by the caller or derived from `metadata.group` counts
(§4.1 "which kinds of material are present, absent, or partial"). `record`, `lookup(region)`,
`summaryForContext()` (feeds `KnowledgeRepository.loadForContext` so solvers skip what is known to be
absent).

**RS-12 `ExplorationNotes`** (`src/agent/bootstrap/ExplorationNotes.ts`)
One `skill` of kind `convention` per corpus (the cheatsheet form, §4.1): terminology (top keywords
with the node that defines them), conventions (metadata patterns), conflicts, coverage, guidance for
future investigation; each bullet carries `sources` and `uncertainty`. LLM-written when a provider
exists, template otherwise.

**RS-13 `PracticeTaskGenerator` and `Bootstrapper`** (`src/agent/bootstrap/{PracticeTaskGenerator,Bootstrapper}.ts`)
From navigation nodes produce `Task`s (RS-24) grounded in materials. Fallback templates: *locate*
(which source states X — rubric `document`), *reconcile* (two sources disagree on X — rubric `fact`
+ `document`), *enumerate* (all sources matching a metadata filter — rubric `set-exact`). The LLM path
asks for tasks that "require finding relevant sources, reconciling evidence, and producing supported
responses" (§4.2) and validates the JSON with zod. Optional `guidance` (preferences, example rubrics,
known failure modes) steers generation. `Bootstrapper.run({ sources, solver?, judge?, budget })` =
map → boundaries → notes → practice tasks → (if a solver is given) one `LeafLearner.learn()` pass over
the practice tasks → `KnowledgeRepository.snapshot('bootstrap')` and returns `{ snapshotId,
navigationMap, taskIds, learn? }`.

### 3.5 Recursive self-improvement (`src/agent/learning/`)

**RS-14 Core contracts** — data types in `src/types/learning.ts`; callback interfaces in
`src/agent/learning/types.ts` (which imports from `src/types`, never the reverse).

`src/types/learning.ts` (data only):
```ts
export type SplitStrategyName = 'byCategory' | 'byFailureMode' | 'bySkill' | 'byTool' | 'auto';
export interface LearningBudget { maxRounds: number; maxTokens?: number; maxWallClockMs?: number; maxChildren?: number }
export interface SolveResult { answer: string; traceAddrs: string[]; tokens?: { input: number; output: number } }
export interface Feedback { taskId: string; criteria: CriterionResult[]; allPass: boolean; source: 'judge' | 'human' | 'test' }
export type DiagnosisKind = 'missing-knowledge' | 'wrong-behaviour' | 'noisy-feedback' | 'ambiguous';
export interface Diagnosis { taskId: string; kind: DiagnosisKind; summary: string; evidenceAddrs: string[];
  relatedSkillIds: SkillId[]; relatedFailureId?: string; confidence: number }
export interface LearnOptions { taskIds: string[]; budget: LearningBudget; split?: SplitStrategyName;
  validationSampleSize?: number; validationRepeats?: number; concurrency?: number; leafThreshold?: number; maxDepth?: number }
export type LearnStopReason = 'no-progress' | 'budget-rounds' | 'budget-tokens' | 'budget-time' | 'aborted' | 'all-pass';
export interface LearnResult { snapshotId: string; traceId: string; before: EvalMetrics; after: EvalMetrics; stoppedBecause: LearnStopReason }
```
`src/agent/learning/types.ts` (callbacks):
```ts
export interface LoadedKnowledge { markdown: string; skillIds: SkillId[]; instructionSetIds: string[]; failureIds: string[]; tokens: number }
export interface Solver { solve(task: Task, knowledge: LoadedKnowledge, signal?: AbortSignal): Promise<SolveResult> }
export interface LearningDeps { solver: Solver; judge?: RubricJudge; llmProvider?: PGCompletionProvider; subagentRunner?: SubagentRunner; signal?: AbortSignal }
```
`LearnResult.traceId` names the root `learning_trace` entity; `LearningTrace.load(traceId)` rebuilds
the tree (RS-22).

**RS-15 `Diagnoser`** (`src/agent/learning/Diagnoser.ts`)
For each failed task: read `Feedback` + `InteractionLog.select` excerpts of `SolveResult.traceAddrs`,
separate genuine solver errors from noisy or ambiguous feedback (§5.1 Diagnose), and for each
`missing-knowledge` / `wrong-behaviour` diagnosis call `FailureManager.record` with **all five required
`FailureInput` fields**: `context` (task input head), `attempted` (answer head), `failure_mode` (failed
criteria text), `root_cause` (diagnosis summary), `applicability_hint` (`<category>: <failed criterion
ids>`), plus `sourceSessionId`. One failure record per trace, task and round (dedup key
`traceId + taskId + round`). *Decided in Phase 4:* the dedup is durable — the leaf learner passes a
`FailureDedupStore` backed by its persisted run (`recordedFailures: Record<key, failureId>`, saved as
soon as a record is written), so a resumed run or a new `Diagnoser` instance never records twice and a
new run never reuses an old id; without a store the `Diagnoser` uses an in-memory map. An abort during
the LLM call rejects with `AbortError` (no fallback, no record).
Earlier reflections come from `AgentReflectionManager.getRelevantForSession` (§5.3). LLM path: prompt →
zod-validated `Diagnosis` JSON, retry once, else fallback. Fallback classification: all criteria of
kind `free` failed → `ambiguous`; failed criteria reference sources absent from `LoadedKnowledge` →
`missing-knowledge`; otherwise `wrong-behaviour`; feedback with `source: 'judge'` whose note contains
`uncertain` → `noisy-feedback`.

**RS-16 `KnowledgeEditor`** (`src/agent/learning/KnowledgeEditor.ts`)
Turns `Diagnosis[]` into one `KnowledgeRevisionRecord`: `missing-knowledge` → `skill.add`
(kind `navigation` when evidence is a document ref, else `convention`) grounded in the diagnosis
evidence; `wrong-behaviour` → `skill.update` of the highest-scoring `relatedSkillIds` entry or
`instruction.patch` of the solver instruction set when no skill relates, plus `heuristic.add` when the
diagnosis summary matches `when … then …`; `noisy-feedback` / `ambiguous` → `memory.reflect` only.
LLM path drafts the body; fallback composes `## When\n<criteria>\n## Do\n<evidence excerpts>`. Task
input and solver output are inserted into skill bodies only inside fenced blocks (prompt-injection
containment). Returns the revision; never writes to `K`.

**RS-17 `RevisionValidator`** (`src/agent/learning/RevisionValidator.ts`)
Applies the revision to a **scratch** snapshot (`KnowledgeRepository.cloneForValidation()` returns an
in-memory `LoadedKnowledge` builder that never touches storage), re-runs the affected tasks plus a
stratified sample (`validationSampleSize`, by category) of previously passing tasks through the
`Solver` and the same `RubricJudge`, `validationRepeats` times (default 1; a task counts as passing
only if it passes every repeat), and returns `{ verdict: 'accept' | 'reject'; fixed; regressed;
unchanged }`. Accept iff `fixed.length > 0 && regressed.length === 0` (§5.1 Validate). On accept the
caller applies the same ops to the live `K` with `expectedSnapshotId` OCC. *Decided in Phase 4:* the
scratch copy is a `ScratchKnowledge` (not a `LoadedKnowledge` builder) with an injectable `matcher`;
`cloneForValidation` passes the pure lexical scorer shared with `SkillManager.match`
(`rankSkillsLexically` in `skillRecordUtils`), so scratch and live rank skills identically (the
semantic blend is not available in scratch). The leaf learner computes the validation plan once,
persists it (tasks, scratch knowledge, live digest) on the run and reuses it for every repeat; when the
live digest moves mid-validation it records `validation-stale` and rejects the revision (`no-progress`). This implements the same
retain-on-improvement gate as `ProceduralGraphEvolution`; sharing code between them is a follow-up,
not part of this plan.

**RS-18 `LeafLearner`** (`src/agent/learning/LeafLearner.ts`)
Algorithm 1 lines 2–7 as a **resumable state machine** (decision Q3): the state lives in the
`learning_trace` entity, so every step can be driven by an in-process loop *or* by a harness making
one tool call at a time.
```ts
type LeafPhase = 'solve' | 'judge' | 'diagnose' | 'edit' | 'validate' | 'apply' | 'done';
interface LeafState { traceId: string; round: number; phase: LeafPhase; pending: string[]; // task ids awaiting results
  results: Record<string, SolveResult>; feedback: Record<string, Feedback>; revisionId?: string; stop?: LearnStopReason }
```
API: `start(opts) → LeafState` (persists round 0); `next(traceId) → StepRequest | LeafState` where
`StepRequest = { kind: 'solve'; tasks: Array<{ task, knowledge: LoadedKnowledge }> } | { kind: 'judge';
answers } | { kind: 'done'; result: LearnResult }`; `submit(traceId, kind, payload)` stores results and
advances the phase; diagnose / edit / validate / apply run inside `next` because they need no external
work (validate issues its own `solve` / `judge` `StepRequest`s for the affected tasks and the sample).
`learn(opts, deps)` is the in-process convenience loop: it calls `next`, fulfils each `StepRequest`
with `deps.solver` / `deps.judge` through `ConcurrencyLimiter`, and `submit`s, until `done`. After
every accepted revision it calls `SkillPublisher.publish` when a publish directory is configured.
Stops on `all-pass`, `no-progress` (a round that accepts no edit) or `LearningAccountant.exceeded`.

*Decided in Phase 4 (persistence and failure handling):*
- The run record is JSON in numbered `[leaf-state i/n] <chunk>` observations of the trace entity
  (each ≤ 4000 characters, under the 5000-character observation cap); tasks are written once as
  `[leaf-tasks i/n]`. Decoding requires chunk indices exactly `1..n`.
- Single driver: the record carries `stateRev`; every save is compare-and-swap on it. A second
  learner stepping the same trace gets `LeafLearner: stale state (expected rev N)` and nothing it
  computed is stored (entity-version conflicts from trace actions are retried, a moved `stateRev` is not).
- Apply `conflict` (live `K` moved): trace action `edit` / `apply-conflict: <reason>`, nothing applied,
  the next round starts from a fresh snapshot of live `K` unless a budget is spent. Apply `rejected`:
  `apply-rejected: failedOpIndex=<i> <reason>`, the round counts as no progress. Neither throws.
- `snapshotId`, `revisionCount` and `appliedRevisionIds` are saved before `publish`; publishing is best
  effort (`publish-failed: <message>`, never thrown). Apply is idempotent: a revision id already in
  `appliedRevisionIds`, or one whose `revision:<id>`-labelled snapshot exists (crash between
  `applyRevision` and the save), is not applied again.
- Token and wall-clock budgets are also checked after each solve and judge stage; `start` rejects
  non-positive or non-finite `maxTokens` / `maxWallClockMs`. The accountant state (rework digests,
  diagnosed failures, stalls, signals, phase timing) is persisted, and `LearnResult.report` carries it.

**RS-19 `SplitStrategy`** (`src/agent/learning/SplitStrategies.ts`)
`split(name, tasks, ctx) → TaskSubset[]` (`{ label, taskIds, rationale }`), a partition: every task
in exactly one subset, no empty subsets. `byCategory` (task `category`, else `tags[0]`, else
`'uncategorized'`); `byFailureMode` (cluster failed tasks by `DiagnosisKind + failed criterion kinds`,
passing tasks form their own subset); `bySkill` (top `SkillManager.match` skill id, else `'no-skill'`);
`byTool` (`tools[0]`, else `'no-tool'`); `auto` picks, among the four, the partition with the lowest
`max(subsetSize) / mean(subsetSize)` and, on ties, the fewest skills shared between subsets (§5.2:
subsets should exercise different skills). Deterministic for the same inputs.

**RS-20 `RevisionMerger`** (`src/agent/learning/RevisionMerger.ts`)
Merges child revisions (§5.2 Merging): (1) dedupe `skill.add` ops whose bodies have token Jaccard
≥ `DEFAULT_DEDUP_JACCARD` = 0.85 (the `ObservationDedupManager` default, imported from there) over
`tokenSetWithoutStopwords(body, ENGLISH_STOPWORDS_SMALL, 2)`, keeping the one from the child with more
`fixed` tasks; (2) reconcile conflicting `skill.update` / `instruction.patch` on the same target — LLM
reconcile prompt when available, else keep the child with the larger `fixed` set and append a
`[conflict]: <other child label>` observation; (3) generalize: two or more children adding skills with
the same `kind` and overlapping `scope.domains` → one skill whose `scope.domains` is the **union of the
children's evidence domains only**, `uncertainty = max(children)`, LLM-generalized body or concatenated
fallback. The merged revision is validated (RS-17) on a stratified sample of the children's tasks
before it is applied.

**RS-21 `RecursiveLearner` and `LearningReflector`** (`src/agent/learning/{RecursiveLearner,LearningReflector}.ts`)
Algorithm 1 lines 9–16: split → child `LEARN` in parallel (a `LeafLearner` when `subset.size ≤
leafThreshold` or `depth === maxDepth`, else a `RecursiveLearner` at `depth + 1`; through
`SubagentRunner` when supplied) → merge → reflect → re-split → repeat until no child improved
(`no-progress`) or the budget is spent. `LearningReflector` reads the children's traces, finds subsets
that did not improve, conflicting edits and `noisy-feedback` clusters, and writes one
`ReflectionRecord` per round through `AgentReflectionManager.create` with `scope: 'learning'`,
`evidence` = child trace entity names, `keyInsights` ≤ 5, `generalization_confidence` = share of
children that improved. The reflection's `keyInsights` are passed to the next round's `auto` split.

Like the leaf learner, the recursive learner is a state machine (decision Q3): `plan(traceId) →
{ subsets, childTraceIds }` creates one child trace per subset (each a `LeafState` or a nested
recursive state); the harness runs each child by driving its `next` / `submit` (or the in-process loop
does it through `ConcurrencyLimiter` / `SubagentRunner`); `submitChild(traceId, childTraceId)` marks a
child complete; `merge(traceId)` runs `RevisionMerger` + validation once all children are complete;
`reflect(traceId)` writes the reflection and decides `continue | done`. `SubagentRunner` is one
adapter over this API. Exposed as `ctx.learningLoop(deps)` → `{ learn, start, plan, next, submit,
submitChild, merge, reflect, status }`.

**RS-22 `LearningTrace`** (`src/agent/learning/LearningTrace.ts`)
`LearningTraceRecord { id; parentTraceId?; learnerKind: 'leaf' | 'recursive'; round; subsetLabel;
actions: Array<{ kind: 'solve' | 'diagnose' | 'edit' | 'validate' | 'split' | 'merge' | 'reflect';
startedAt; endedAt; addrs: string[]; outcome: string }>; revisionIds: string[]; metrics: EvalMetrics }`.
Children link to parents with a `child_of` relation. Solver output is referenced by `InteractionLog`
address, never copied (acceptance 5.4). `LearningTrace.load(traceId)` rebuilds the tree;
`toMermaid(tree)` renders it.

**RS-23 `LearningAccountant`** (`src/agent/learning/LearningAccountant.ts`)
Learning waste and signal (§5.3): `stalls` (sum of `ConcurrencyLimiter.stats.queuedMs`), `rework`
(a task solved again while the `K` digest is unchanged; a diagnosis repeated for the same failure id),
`solverSignals` (feedback + trace excerpts consumed) and `learnerSignals` (validation verdicts, source
checks, child traces consumed), tokens and wall-clock by phase. `exceeded(budget) → LearnStopReason |
null`; `report()` is consumed by `LearningReflector` and attached to the trace metrics.

### 3.6 Evaluation (`src/agent/evaluation/`)

**RS-24 Task and rubric types** (`src/types/learning.ts`)
`Criterion { id; text; kind: 'fact' | 'document' | 'set-exact' | 'set-precision' | 'number' | 'free';
expected?: string | string[] | number; tolerance?: number; weight?: number }`, `CriterionResult {
criterionId; pass; note? }`, `TaskRecord { id; input; category?; tags?; tools?; difficulty?;
sources?: SkillSource[]; rubric: Criterion[] }` (persisted as `task` entities), `EvalMetrics { tasks;
allPass; meanCriteria; byCategory: Record<string, { tasks; allPass; meanCriteria }> }`.

**RS-25 `RubricJudge`, `DeterministicJudge`, `Evaluator`** (`src/agent/evaluation/`)
`RubricJudge { judge(task, answer, signal?): Promise<CriterionResult[]> }` is caller-supplied (an LLM
judge as in the paper); `LLMRubricJudge` is provided behind `PGCompletionProvider` with zod-validated
JSON and falls back to `DeterministicJudge`: `fact` (normalized substring of `expected`), `number`
(`|x − expected| ≤ tolerance`, first number in the answer), `set-exact` / `set-precision` (list
extraction, case-insensitive, duplicates collapsed; exact = equal sets, precision = answer ⊆ expected),
`document` (answer mentions `expected` ref), `free` → `pass: false, note: 'needs judge'` (never passes
silently). `Evaluator.evaluate(tasks, solver, judge, { knowledge })` → `{ metrics: EvalMetrics,
feedback: Feedback[] }`. `stratifiedSplit(tasks, { testFraction, by: 'difficulty' | 'priorPassRate',
seed })` is deterministic for a seed and reproduces the paper's split by prior pass rate when an earlier
`EvalMetrics` is given.

**RS-26 `RubricAudit`** (`src/agent/evaluation/RubricAudit.ts`)
`RubricIssue { taskId; criterionId; kind: 'placeholder' | 'files' | 'contradicts' | 'omits' | 'admits';
detail }`. Deterministic checks inspired by App. B: *placeholder* (`[same … set]`-style bracketed
references with no members), *files* (criterion names only specific filenames), *contradicts*
(criterion mentions a concept token absent from the task input), *omits* / *admits* (set criteria whose
members are not all referenced by the task's sources, or that include members the task excludes by
category). Returns issues for human review; never rewrites a rubric. Fixtures are synthetic.

**RS-27 Context integration**
`ContextWindowManager.wakeUp(options)` accepts `knowledge?: KnowledgeRepository` and `taskHint?`; when
given, L0 includes `InstructionSetManager.render('shared', …)` and L1 includes matched skill bodies
within the existing budgets (≤ 30 added lines). `AgentMemoryManager` gains
`setKnowledgeRepository(repo)` (it has no access to the repository's managers itself) and a
`wakeUp(options)` wrapper that delegates to `ContextWindowManager.wakeUp`, passing the stored repository
when `options.knowledge` is absent. `KnowledgeRepository.loadForContext` gains an additive
`sections?: ('instructions' | 'skills' | 'failures')[]` option (default all) so L0 loads only
instructions and L1 only skills, each with its own budget and one skill match per wake-up.

### 3.7 `ManagerContext` wiring and configuration

Lazy getters: `ctx.skillManager`, `ctx.instructionSets`, `ctx.knowledgeRepository`,
`ctx.interactionLog` (`null` unless `MEMORY_INTERACTION_LOG === 'true'`, strict literal),
`ctx.evaluator`; factories `ctx.bootstrapper(deps)` and `ctx.learningLoop(deps)` (`LearningDeps`)
returning `{ run }` / `{ learn }`. *Phase 4:* `learningLoop(deps)` returns a fresh, independent loop
(`learn`, `start`, `next`, `submit`, `status` → state plus `LearningReport`) on each call; `deps` adds
`publishDir`, `solverInstructionSetId`, `sessionId`, `interactionLog` (passed to the `Diagnoser`; solve
trace addresses are then kept on trace actions) and `includeTraceAddrs`. Getters are created on first access and released in `close()`.
Env vars (read via `readEnvStrictFlag` / `readEnvPositiveIntOrDefault`; documented in CLAUDE.md,
README and CONFIGURATION.md):

| Variable | Default | Meaning |
|---|---|---|
| `MEMORY_INTERACTION_LOG` | unset | `'true'` enables `ctx.interactionLog` sidecar |
| `MEMORY_INTERACTION_LOG_INLINE_BYTES` | 16384 | spill threshold per record |
| `MEMORY_LEARNING_MAX_ROUNDS` | 5 | default `LearningBudget.maxRounds` (paper ran K^(1)…K^(5)) |
| `MEMORY_LEARNING_CONCURRENCY` | 4 | default solver / child concurrency |
| `MEMORY_LEARNING_VALIDATION_SAMPLE` | 10 | previously-passing tasks re-run per validation |
| `MEMORY_LEARNING_LEAF_THRESHOLD` | 20 | subsets at or below this size get a leaf learner |
| `MEMORY_LEARNING_MAX_DEPTH` | 2 | recursion depth of `RecursiveLearner` |

### 3.8 Harness / MCP surface (decisions Q1–Q5 applied)

MemoryJS used from Claude Code (as an MCP server or plugin) sees only stateless tool calls, reads
skills from disk, and owns subagents and tool execution. The library therefore exposes the learner as
steps, publishes skills to disk, and ingests the harness's own transcript. A reference MCP tool list
(the MCP server stays downstream, not in this library; the reference adapter now ships as
`src/adapters/RecursaToolAdapter.ts` (`createRecursaTools(ctx, deps)`, `@experimental`), a stateless JSON-in/JSON-out
set that the downstream server wraps one-to-one; listed here so the library API is shaped for it):

| Tool | Library call | Notes |
|---|---|---|
| `recursa.knowledge.load` | `knowledgeRepository.loadForContext({ role, taskHint, budgetTokens })` | returns Markdown + ids; the harness pastes it into the solver prompt |
| `recursa.skills.publish` | `skillPublisher.publish(dir)` | atomic; returns the change marker; `dir` optional, confined to `deps.publishDir` |
| `recursa.skills.import` | `skillPublisher.importSkills(dir)` | returns `ImportConflict[]`; `dir` as for publish |
| `recursa.learn.start` / `.next` / `.submit` | RS-18 | one `StepRequest` per call; the harness runs solves with its own model and subagents |
| `recursa.learn.plan` / `.submitChild` / `.merge` / `.reflect` / `.status` | RS-21 | the harness fans children out with its Agent tool |
| `recursa.log.append` | `interactionLog.append(rec)` | fed from `PostToolUse` / turn hooks; `tokens` caller-reported (Q4) |
| `recursa.log.select` | `interactionLog.select(addr, …)` | only the excerpt returns to the context |
| `recursa.eval.run` | `evaluator.evaluate(…)` with harness-supplied answers | metrics for before/after |

Phase 6 amendments (Checker/Fixer):

- **Confinement.** `SkillPublisher` takes a `root` (default `process.cwd()`); `publish` / `importSkills`
  re-validate `dir` against it after `path.resolve` and after `realpath` of the deepest existing ancestor,
  and refuse `..`, the root itself, absolute paths outside it, symlink escapes and `/proc` / `/sys` / `/dev`
  (`ValidationError`, `errors[0] = 'dir:<reason>'`) before creating anything. The adapter's skills tools need
  `deps.publishDir` (else `not_configured`); `dir` is optional and must be a relative subpath below it
  (else `invalid_args`).
- **Error codes.** `invalid_args` (strict schemas, reserved `__proto__` / `constructor` / `prototype` keys,
  library validation, unknown `criterionId`, unknown `eval.run` answer ids), `not_found` (unknown trace),
  `invalid_state` (leaf/recursive mismatch, out-of-phase or duplicate submit, non-pending task id),
  `not_configured`, `solver_required`, `aborted`, `unknown_tool`, `internal_error` (real bugs only).
- **eval.run.** Tasks without an answer fail with the note `no answer` and are listed in `missing`.
- **Metrics.** Recursive metrics and the merge validator's prior feedback use the judged criteria of the
  children and the live evaluation, never empty placeholders.

Decisions recorded: **Q1** entities authoritative, SKILL.md the published view with atomic publish and
hash-based conflict detection; **Q2** `yaml` optional peer dependency, subset parser fallback;
**Q3** step-wise resumable learners, `SubagentRunner` is an adapter; **Q4** caller-reported tokens win,
provider `getLastUsage` is the fallback; **Q5** `InteractionLog` is separate from `TransitionLedger`
and acts as an importer of harness transcript events; **Q6** `@experimental` through 4.x; **Q7**
gate sharing deferred; **Q8** no visibility tiers for shards.

---

### 3.9 Phase 5 decisions (Checker/Fixer amendments)

These behaviours were decided while checking Phase 5 and are binding on RS-17..RS-21 and §3.7.

- **Loadability contract (D1/D2).** A `skill.add` produced by `KnowledgeEditor` carries
  `scope.tasks = ['task:<taskId>', ...first 8 stopword-free keywords of the task input]`,
  `description = '<rubric criteria text head> — <those keywords>'` and a `{ ref: 'task:<taskId>',
  kind: 'task' }` source (`SkillSource.kind` gains `'task'`). `KnowledgeRepository.loadForContext` and
  `ScratchKnowledge.loadForContext` take `includeSkillIds` (loaded first, regardless of lexical score)
  and `maxSkills` (default 20, replacing the fixed lookup limit of 5; the token budget still bounds the
  output). `skillIdsForTasks(taskIds)` on the repository, the scratch copy and the child overlay
  returns the live skills whose `scope.tasks` contains `task:<id>` (at most 50). Every solve, diagnose,
  edit, validation and live-evaluation load passes them. Measured: 40/40 editor-built skills are
  loaded for their own task on both backends (requirement: at least 38/40).
- **Live-K results (B1).** A recursive round never reports the children's overlay results. When the
  merged revision is applied, every task of the run is solved and judged once against the node's
  repository (live `K` at the root) and that pass map becomes `current`; when it is not applied,
  `current` returns to the round's `before` (the children's `beforePass`). `all-pass` is reported only
  when that pass map is all-pass; an unapplied merge, or an applied one that fixed nothing live, stops
  `no-progress`. `abort` (and a budget stop between children) also discards unmerged child results.
- **Generalize rule (B2).** Two `skill.add` ops from different children are generalized only when
  their `kind` matches, their domains overlap and their descriptions have token Jaccard >= 0.5. The
  merged skill: description = deduplicated union of the member descriptions (<= 400 chars),
  `scope.tasks` = union, name = `Merged <kind>: <first 3 keywords> <6-hex hash of the members>`,
  domains = union of evidence domains, else of the members' skill domains; never empty (the group is
  then not generalized).
- **Budget split (S1).** Each child gets `floor(remainingTokens / children)` tokens (at least 1) and
  the remaining wall-clock time. Between child completions the parent checks its own token and time
  budget; when spent, the remaining children are aborted and the run stops `budget-tokens` /
  `budget-time`.
- **One-subset rule (S2).** `plan` passes the previous children's diagnoses and feedback and a
  repository-backed `skillMatch` into `split`. A one-subset result falls through to the next strategy
  in `auto` order; if every strategy gives one subset the node runs one forced leaf child (no further
  recursion). `auto` ranks a single-subset partition last. The reflector stores `prefer-split:<name>`
  in `keyInsights`; `split('auto')` parses only that exact token for its tie-break.
- **`submitChild`** requires the child's phase to be `done` (S3). Reflections are idempotent per round
  (`experienceType = learning-round:<traceId>#<round>`).
- **Leaf threshold env (S5).** `MEMORY_LEARNING_LEAF_THRESHOLD` (strict integer >= 0, default 20) is
  read by `LearningFacade`; `opts.leafThreshold` overrides. A run is recursive when
  `tasks.length > threshold`, or when `opts.split` is set and there is more than one task. The
  threshold is passed down as the child leaf threshold. `learningLoop.next` / `submit` on a recursive
  trace throw and name `plan / submitChild / merge / reflect` (N4). The facade passes `llmProvider` to
  `RevisionMerger` and `LearningReflector` (S4).
- **Merge-apply conflict (S6).** An OCC conflict on the merged revision is recorded as an
  `apply-conflict` merge action; the next round rebases on live `K` (fresh round snapshot) and the
  run stops only on its budget.
- **Reconcile (S7).** A child's sequential patches to one target are folded into one op before
  reconciling; `skill.update` patches from different children on disjoint fields are merged into one
  op; otherwise the winner rule applies and the `[conflict]` note and `memory.reflect` ops name only
  the children whose edit differs from the winner's.
- **Bootstrap input checks.** A `CorpusMapper` loader that resolves to a non-string is a
  `ValidationError` (S8). Refs must be non-empty and at most 493 characters (the spec's 512, lowered so
  `source:<ref>` fits the 500-character entity-name limit) (N2). Within one `map` call a repeated
  conflicting text is recorded once (N1). `BoundaryRecorder` keeps the original region name, and a
  second distinct region with the same slug is a `ValidationError` naming both (S9). Untrusted
  text in fences and child bodies in a generalized skill have line-start `#` escaped (N5).

## 4. Subagent-driven implementation plan

Team: Planner (Fable, low) owns this document and batch briefs; Builders (Haiku, low) implement
batches on disjoint files; Challenger (Haiku, low) writes adversarial and differential tests;
Checker (Opus, low) runs every gate; Fixer (Sonnet, low) closes findings. Each phase ended with
Challenger + Checker, then Fixer, then one PR squash-merged after all six CI legs were green (the
Windows legs catch open-handle leaks: every test that opens a storage or sidecar closes it before
temp-dir cleanup, per `tests/helpers/tempStorage.ts`). Barrels (`index.ts`) are edited by the phase
lead after its batches land (§2.8).

### 4.1 As shipped

Each phase shipped as its own squash-merged PR. The three integration tests are the Phase 6 deliverables:
`tests/integration/agent/recursa-loop.test.ts` (Phase 2/3 loop), `tests/integration/agent/recursa-leaf-learner.test.ts`
(Phase 4 leaf learner, resumable driver) and `tests/integration/agent/recursa-end-to-end.test.ts` (6C scenario).

| PR | Batch(es) | RS items | Notes |
|---|---|---|---|
| #272 | this document | — | Spec v1 and the implementation plan in §4 |
| #273 | this document, v3 | — | Owner questions resolved from the harness-integrator lens (§6); §3.8 added |
| #274 | 1A | RS-1, RS-4, RS-6, RS-24 (plus §3.0 types) | `src/types/{skills,learning}.ts`; eight record memory types; persistence allowlists |
| #275 | 1B, 1C | RS-2, RS-3, RS-5 | `SkillManager`, SKILL.md format and publisher, `InstructionSetManager`, `KnowledgeRepository` |
| #276 | 1D | — | Barrels; `ManagerContext` getters for 1B/1C |
| #277 | 2A, 2B, 2C | RS-7, RS-8, RS-9 | Harness support: `InteractionLog`, `EvictionIndex`, `ConcurrencyLimiter` |
| #278 | — | — | `ManagerContext` facade split into `src/core/context/*Facade.ts` (no behaviour change) |
| #279 | 3A, 3B, 3C | RS-25, RS-26, RS-27 | Evaluation; RS-27 `setKnowledgeRepository` and `wakeUp` integration (the §4 batch label 6A) |
| #280 | 4A–4D | RS-14, RS-15–RS-18, RS-22, RS-23 | Leaf learner (`LeafLearner`, `Diagnoser`, `KnowledgeEditor`, `RevisionValidator`) |
| #281 | 5A–5D | RS-10–RS-13, RS-19–RS-21 | Recursive learner, split strategies, bootstrapping |
| #282 | 6A–6C | §3.8 | `RecursaToolAdapter` (14 tools), path confinement for skills publishing, 6C integration test |

Every RS item (RS-1 to RS-27) has a shipped PR above. Phases 2 and 3 shipped as separate PRs (#277, #279),
and the line caps in §4 were applied per PR. Because of the facade split (#278), `src/core/ManagerContext.ts`
is no longer the file the 1D, 4D and 5D caps were written against. See the CHANGELOG `[Unreleased]` entries for the
current counts.

### Phase 1 — Types, skills, instructions, repository (foundation)
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 1A | §3.0, RS-1, RS-4, RS-6, RS-24 types | new `src/types/skills.ts`, `src/types/learning.ts`; `src/types/agent-memory.ts` (+8 `MEMORY_TYPES` entries, `'learning'` in `ReflectionScope`, guards; ≤ 120 added lines); lead adds `src/types/index.ts` exports | guard table test (true / near-miss objects); `MEMORY_TYPES` exhaustiveness; every `switch` on `ReflectionScope` compiles | guard false-positives; a `switch` over `MemoryType` elsewhere that is no longer exhaustive |
| 1B | RS-2, RS-3 | `src/agent/skills/{SkillManager,SkillFormat,SkillPublisher}.ts`, `src/features/IOManager.ts` (+≤ 40 lines), `package.json` (`peerDependenciesMeta.yaml.optional`) | add/dedup/OCC/match/outcome on both backends; SKILL.md round-trip incl. `---` in body (subset path; full-YAML path skipped when `yaml` is absent); atomic publish (temp dir + rename, marker file); import no-op / absorb / conflict matrix; path confinement | concurrent `update` with the same `expectedVersion`; `match` with empty hint; front matter with unknown key; import directory escaping the root |
| 1C | RS-5 | `src/agent/knowledge/{InstructionSetManager,KnowledgeRepository}.ts` | digest stable across reload and key order; diff mirror property; `applyRevision` op 3 of 5 fails → zero writes, `failedOpIndex: 2`; rollback restores sections and retires later skills; `loadForContext` budget | `applyRevision` with an unknown skill id; two revisions racing on the same `expectedSnapshotId` (one must get `conflict`) |
| 1D (lead) | barrels, `ManagerContext` getters for 1B/1C, docs rows | `src/types/index.ts`, `src/agent/index.ts`, `src/core/ManagerContext.ts` (≤ 60 lines), CLAUDE.md, API.md | getter identity + lazy-once; `close()` releases | getter touched before storage loaded |
Order: 1A → (1B ∥ 1C) → 1D. Four batches, three Builders plus the lead.

### Phase 2 — Harness support
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 2A | RS-7 | `src/agent/harness/{InteractionLog,InteractionLogFormat}.ts`, `src/agent/ToolCallObserver.ts` (+≤ 15 lines) | append/read/range/search/select; spill over `maxInlineBytes`; torn trailing line on open; addr monotonic across reopen; regex caps; close-before-rm on both OSes | concurrent appends under the mutex; `select` with a 10 KB regex; spill path with `..` in `addr` (must be impossible) |
| 2B | RS-8, RS-9 | `src/agent/harness/{EvictionIndex,ConcurrencyLimiter}.ts`, `src/agent/ContextWindowManager.ts` (+≤ 40 lines) | existing CWM suites unchanged; eviction lines last and dropped first over budget; limiter isolation, stall accounting, abort | abort mid-batch leaves no pending promise; `concurrency` 0 / NaN / 1.5 rejected; eviction summary longer than the whole budget |
| 2C (lead) | barrels | `src/agent/index.ts`, `src/agent/harness/index.ts` | export test | — |
Order: 2A ∥ 2B → 2C.

### Phase 3 — Evaluation (needed by learners and bootstrapping)
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 3A | RS-25 | `src/agent/evaluation/{Evaluator,DeterministicJudge,LLMRubricJudge}.ts` | each criterion kind table-driven; metrics equal hand-computed values; split reproducible with a seed; LLM judge malformed JSON → fallback | `set-precision` with duplicates / case; `number` with units and thousands separators; `free` never passes |
| 3B | RS-26 | `src/agent/evaluation/RubricAudit.ts` | five defect classes with synthetic fixtures | false positives on legitimate bracketed text |
| 3C (lead) | barrels | `src/agent/evaluation/index.ts`, `src/agent/index.ts` | export test | — |
Order: 3A ∥ 3B → 3C. Phases 2 and 3 shipped as separate PRs (#277, #279).

### Phase 4 — Leaf learner
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 4A | RS-14 callback types, RS-22, RS-23 | `src/agent/learning/{types,LearningTrace,LearningAccountant}.ts` | trace tree persist / `load` / Mermaid; rework detection only when the digest is unchanged | rework counted after a digest change (must not); trace with 1,000 actions stays under `maxInlineBytes` per entity |
| 4B | RS-15, RS-16 | `src/agent/learning/{Diagnoser,KnowledgeEditor}.ts` | fallback classification table; LLM path with malformed JSON (retry then fallback); exactly one `FailureManager.record` per task per round with all five fields | task input containing `---` / fenced blocks reaching a skill body unfenced; editor op referencing an unknown skill id |
| 4C | RS-17, RS-18 | `src/agent/learning/{RevisionValidator,LeafLearner}.ts` (4C uses a stub editor until 4B lands, then an integration test) | accept only when `fixed > 0 && regressed = 0`; scratch never leaks into live `K` on reject; every stop reason; `all-pass` early exit; abort; step-wise parity: driving `start/next/submit` by hand yields the same `LearnResult` as `learn()`; state survives a reopen between steps | nondeterministic solver with `validationRepeats = 2`; an edit that fixes A and breaks B exactly at the sample boundary |
| 4D (lead) | barrels, `ctx.learningLoop` stub for leaf-only use | `src/agent/learning/index.ts`, `src/agent/index.ts`, `src/core/ManagerContext.ts` (≤ 30 lines) | — | — |
Order: 4A → (4B ∥ 4C) → 4D.

### Phase 5 — Recursive learner and bootstrapping
| Batch | Items | Files | Tests | Challenger attacks |
|---|---|---|---|---|
| 5A | RS-19, RS-20 | `src/agent/learning/{SplitStrategies,RevisionMerger}.ts` | each strategy is a partition (no task lost or duplicated, no empty subset); `auto` deterministic; dedup at 0.85; reconcile; generalize unions evidence domains only; merged revision re-validated | subsets of size 1; children revising the same skill in opposite directions; generalization widening scope beyond evidence (must not) |
| 5B | RS-21 | `src/agent/learning/{RecursiveLearner,LearningReflector}.ts` | depth and child budgets honoured; one reflection per round with trace evidence and `scope: 'learning'`; no-progress detection; end-to-end with a scripted solver that passes a task only when the expected skill exists; `plan/submitChild/merge/reflect` driven by hand equals the in-process loop | runaway recursion; child failure isolation; reflection citing trace ids that do not exist |
| 5C | RS-10..RS-13 | `src/agent/bootstrap/{CorpusMapper,BoundaryRecorder,ExplorationNotes,PracticeTaskGenerator,Bootstrapper}.ts` | map of 50 synthetic docs → levels, `TOPIC_SUMMARIZES` / `located_at` relations, same-ref conflict rule; coverage lookup; notes from fixtures; practice tasks have rubric + sources; `K-0` snapshot labelled `bootstrap` | empty corpus; partitioner returning empty shards (rejected); practice task with an unsatisfiable rubric (flagged by `RubricAudit`) |
| 5D (lead) | barrels, `ctx.bootstrapper`, full `ctx.learningLoop` | `src/agent/{learning,bootstrap}/index.ts`, `src/agent/index.ts`, `src/core/ManagerContext.ts` (≤ 40 lines) | — | — |
Order: (5A ∥ 5C) → 5B → 5D.

### Phase 6 — Wiring, docs, end-to-end scenario
| Batch | Items | Files |
|---|---|---|
| 6A | RS-27, `AgentMemoryManager.setKnowledgeRepository` | `src/agent/ContextWindowManager.ts` (≤ 30 lines), `src/agent/AgentMemoryManager.ts` |
| 6B | docs: CLAUDE.md (modules, env table, getters), README quick-start for `learningLoop`, `docs/architecture/AGENT_MEMORY.md` new section "Knowledge repository and recursive learning" with the §1 mapping, `docs/architecture/API.md`, CHANGELOG `[Unreleased]` | docs only |
| 6C | end-to-end scenario as an integration test (there is no `examples/` directory and tests are the runnable examples here): `tests/integration/agent/recursa-loop.test.ts` — fake corpus → bootstrap → stratified split → `learn` with a scripted `Solver` that passes a task once the matching skill exists → asserts before/after `EvalMetrics` | `tests/integration/agent/` |
Order: 6A → (6B ∥ 6C). Finalize: census regen, verification totals, `repo-tools docs check src`, PR.

### Effort and sequencing

| Phase | Parallel Builders | Est. new src lines | Est. tests |
|---|---|---|---|
| 1 | 2 (+ lead) | ~1,500 | ~45 |
| 2 | 2 (+ lead) | ~700 | ~30 |
| 3 | 2 (+ lead) | ~650 | ~35 |
| 4 | 2 (+ lead) | ~1,300 | ~50 |
| 5 | 2–3 (+ lead) | ~1,600 | ~55 |
| 6 | 2 | ~200 + docs | ~10 |

Shipped as nine implementation PRs (#274 to #282; #278 is the facade split, not a phase), covering all 27 items.
The spec had said that phases 2 and 3 might combine into one PR; they did not (#277, #279).

---

## 5. Acceptance criteria (Checker)

1. All repo gates green on every phase PR, on all six CI legs.
2. **No-LLM end-to-end**: `tests/integration/agent/recursa-loop.test.ts` with no provider raises
   all-pass on its fixture task set from < 50 % to 100 % within `maxRounds = 3`, because the scripted
   solver passes a task exactly when `K` holds the skill the fixture expects (the loop, not a model,
   is under test).
3. **Validation gate**: a mutation test that makes `RevisionValidator` always accept must fail at
   least one test (a regression must be caught).
4. **Context discipline**: no `learning_trace` or `Diagnosis` entity stores raw solver output longer
   than `maxInlineBytes`; only `InteractionLog` addresses and selected excerpts.
5. **Backend parity**: every new manager's suite runs on JSONL and SQLite via `withBothBackends` and
   closes storages and sidecars before temp-dir cleanup.
6. **Public surface**: every new export has a doc comment (`repo-tools docs check src`, 0 MUST) and is
   reachable from `src/agent/index.ts` and the root barrel; `@experimental` on every new module.
7. **Metric definitions**: `meanCriteria` is the mean over tasks of the per-task criteria pass
   fraction; `allPass` is the fraction of tasks with every criterion passed (paper §6.1).
8. **Leaf layer**: `src/types/skills.ts` and `src/types/learning.ts` import only from `src/types`.

---

## 6. Owner questions — decided (v3, harness-integrator lens)

| # | Question | Decision |
|---|---|---|
| Q1 | SKILL.md directories or entities as source of truth? | **Entities authoritative; SKILL.md is the published view.** Atomic publish after every accepted revision, hash-based conflict detection on import (RS-3 `SkillPublisher`). A harness reads skills from disk, so publishing is part of the loop, not an export afterthought. |
| Q2 | Real YAML dependency? | **`yaml` as an optional peer dependency**; fixed-subset parser when absent. Human-written SKILL.md files are real YAML; a subset-only parser would reject them on import. |
| Q3 | Child learners through an isolated `SubagentRunner` or in-process? | **Step-wise, resumable learners** (`start/next/submit`, `plan/submitChild/merge/reflect`) whose state lives in `learning_trace` entities, so a harness drives them one tool call at a time with its own subagents; `SubagentRunner` and `learn()` are in-process adapters over that API (RS-18, RS-21, §3.8). |
| Q4 | Token accounting source? | **Caller-reported `SolveResult.tokens` wins**; provider `getLastUsage` is the fallback for direct `LLMProvider` calls. |
| Q5 | `InteractionLog` vs `TransitionLedger` / `ToolCallObserver`? | **Separate.** The log is an importer of harness transcript events (hooks) addressed for `select`; the ledger stays graph-mutation audit; the observer may also write to the log. |
| Q6 | API tier after one release? | `@experimental` through 4.x. |
| Q7 | Share the validation gate with `ProceduralGraphEvolution`? | Deferred until `RevisionValidator` stabilizes (after Phase 5); the clone tooling will flag the duplication. |
| Q8 | `MultiAgentMemoryManager` visibility for shard results? | Not initially; shards tag `navigation_node` entities with the shard id. |

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Learning loop cost explodes (rounds × tasks × validation sample × repeats) | `LearningBudget` mandatory; `LearningAccountant.exceeded` checked before every solve batch; defaults match the paper's 5 rounds. |
| Validation flakiness with nondeterministic solvers | same judge on re-runs; `validationRepeats`; `rework` metric exposes it. |
| Knowledge drift: merged skills widen scope beyond evidence | `generalize` unions evidence domains only; `uncertainty = max`; a `ConsolidationPipeline` stage to retire skills with `hurt > helped` is a follow-up. |
| Prompt injection from corpus text into skills | editor / generator outputs are data; task text enters skill bodies only in fenced blocks; `loadForContext` adds provenance headers; the library executes nothing. |
| Legacy-file growth (`agent-memory.ts`, `IOManager.ts`, `ContextWindowManager.ts`, `ManagerContext.ts`) | per-item line caps in §4; new types in new files. |

---

## 8. Glossary

`K` knowledge repository; `K^(t)` snapshot after round t (`K-<n>` entities); `D` training tasks;
`SOLVE(x, K) → (y, τ)`; `LEARN(D, K) → (K', T)`; `τ` solver trace (here: `InteractionLog` addresses);
`T` learning trace (`learning_trace` entities, RS-22); learning waste = stalls + rework; learning signal
= solver signals (feedback, traces) + learner signals (validation outcomes, checks against sources,
children's traces).
