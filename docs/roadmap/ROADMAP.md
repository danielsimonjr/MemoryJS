# MemoryJS Roadmap

**Last refreshed**: 2026-05-13 (v1.15.0). Memorilla research note added 2026-10-18 — [MEMORILLA_LATENT_MEMORY_PLAN.md](./MEMORILLA_LATENT_MEMORY_PLAN.md). EMMA research track added 2026-10-29 in the section below. Both notes are docs only and do not change the snapshot below.

Forward-looking work tracker. **Shipped features are not listed here** — see [CHANGELOG.md](../../CHANGELOG.md) for the per-version history and [`docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md`](../planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md) for the per-phase task ledger of completed work.

> **Where the codebase is now (v1.15.0)**
>
> - 231 source files / 76,495 LOC / 7,098 passing tests / 11 modules
> - Phases 1–3, 3B (3B.1–3B.7), 3C, 3D, η-series, δ, β all shipped
> - Phases 0–11 of the performance & scale track shipped via PR #34: mmap-backed I/O, segment-sharded JSONL, columnar observation storage, tiered indexing, in-memory compression adapters, minimal SPARQL subset, write-ahead log, extracted `BackupManager`, CRDT primitives, ABAC + RLS + API keys, HITS / clique / Louvain graph algorithms, structured logger, bounded `TaskQueue`, BM25 incrementality, SQLite read pool
>
> The list below is the genuinely outstanding work as of 2026-05-13.

---

## Open Work

### Priority 1 — next sprint

#### 1. ~~Failure Memory hardening (Phase 2 Sprint 4)~~ — ✅ shipped
- Closed via `FailureManager` (`src/agent/FailureManager.ts`) + `MemoryType: 'failure'` extension + `ctx.failureManager` lazy getter
- Pre-task `lookupForTask()` substring MVP; `SearchManager.semanticSearch` integration deferred to a follow-up

#### 2. ~~Plan / Goal Stack (Phase 2 Sprint 5)~~ — ✅ shipped
- Closed via `PlanManager` (`src/agent/PlanManager.ts`) + `MemoryType: 'plan'` extension + `ctx.plan` lazy getter
- `PlanRecord` with `rootGoal: GoalNode` (recursive tree), `currentNodeId`, `PlanLifecycle` / `GoalNodeLifecycle` discriminated unions, `history: GoalEvent[]`, optional `acceptanceCriteria` per node
- Public API: `createPlan` / `pushSubGoal` / `transitionNode` / `markPlanComplete` / `abandonPlan` / `findPlan` / `findNode` / `getCurrentPath` / `getActivePlan` / `listPlans`
- `validatePlanInvariants` runs after every mutation (unique ids, `currentNodeId ∈ tree`, no cycles); cycle-protected DFS in `findNodeInTree` / `findPathToNode` as defense against corrupted on-disk plans
- Branded `PlanId` / `GoalNodeId` prevent id-type confusion; `MarkResolvedResult` discriminates `'resolved' | 'already-resolved' | 'not-found' | 'vanished-mid-update'`
- 36 unit tests passing; consolidation-pipeline stage + wakeUp L1.5 layer follow as separate sprints

#### 3. ~~Trust Hierarchy formalization (Phase 2 Sprint 6)~~ — ✅ shipped (partial)
- Closed (type + backfill + `ConflictResolver` strategy): `TrustLevel` union (`'ground-truth' | 'verified' | 'inferred' | 'unverified'`) added to `MemorySource.trustLevel?:`; `inferTrustLevel(source)` backfill from `method` + `reliability` with `DEFAULT_TRUST_THRESHOLDS` overridable defaults; `compareTrustLevel` standard comparator; new `'trust_level'` `ConflictStrategy` with recency tiebreak in `ConflictResolver.resolveTrustLevel`
- `CollaborativeSynthesis.resolveConflicts` ordering integration closed in v2.0.x — `ConflictResolutionPolicy` gains a `{ strategy: 'trust_level' }` variant that sorts candidates by categorical `TrustLevel` descending with recency tiebreak, mirroring `ConflictResolver.resolveTrustLevel`.
- Verified: 31/31 trust-level + `ConflictResolver` tests; 1957/1957 sibling agent + types + ManagerContext suites green

#### 4. ~~Heuristic Guidelines Manager (3B.8)~~ — ✅ shipped (v2.0.x)
- Closed via storage-backed `HeuristicManager` (`src/agent/HeuristicManager.ts`) + `MemoryType: 'heuristic'` + `HeuristicEntity` + `ctx.heuristicManager` lazy getter (3B.8a) and `HeuristicExtractionStage` in `ConsolidationPipeline` that crystallises resolved failures + qualifying reflections into heuristics with content-hash idempotency (3B.8b). Last 3B item — closes the entire "From Storage to Experience" memory evolution series
- Manager surface: `add` / `get` / `match` (Jaccard × confidence) / `reinforce` / `recordContradiction` / `detectConflicts` / `remove` / `clear` / `list` / `size`. Mutating writes use `EntityManager` OCC; `reinforce`/`recordContradiction` return discriminated `HeuristicUpdateResult` (`'updated' | 'not-found' | 'conflict' | 'vanished-mid-update'`). `@experimental` tag on the match algorithm stays — future evolution toward semantic-similarity matching is in scope
- Stage surface: scans resolved `FailureRecord`s and qualifying `ReflectionRecord`s with `experienceType` + `keyInsights[]`. Configurable `minConfidence` / `maxPerRun` / `failureConfidence` / `reflectionConfidenceCap`. `runOnResolution(failureId)` helper for explicit single-failure passes. Not auto-registered on the default pipeline — construct and `registerStage()` explicitly

#### 5. ~~Entity-level observation deduplication~~ — ✅ shipped (v2.0.x)
- Closed via storage-backed `ObservationDedupManager` (`src/agent/ObservationDedupManager.ts`) + `ctx.observationDedupManager` lazy getter (Phase A) and `ObservationDedupReportStage` diagnostic pipeline stage (Phase B). Report-only — finds cross-entity duplicate observations without mutating; consumers decide on merge/strip
- Manager surface: `findDuplicateObservations(filter?)` (exact-hash, cheap) and `findJaccardDuplicates(filter?)` (token Jaccard with union-find grouping, opt-in expensive path). Filter supports `entityType` / `projectId` / `sessionId` scoping plus `minOccurrences` (default 2) and `maxGroups` (default 100) circuit-breakers
- Stage surface: `ObservationDedupReportStage` emits one `[info]`-prefixed entry per duplicate group on `StageResult.errors`; `transformed` always 0. Not auto-registered. `includeJaccard: true` opts in to the Jaccard tier
- Follow-ups (deferred): auto-merge into shared semantic entity (needs relation-design decision), auto-strip from individuals (destructive — needs governance)

### Priority 2 — within 1–2 sprints

#### 1. ~~Tool Affordance Memory (Phase 2 Sprint 7 — new memory type)~~ — ✅ shipped (v2.0.x)
- Closed via four workflow turns per [`TOOL_AFFORDANCE_PLAN.md`](./TOOL_AFFORDANCE_PLAN.md): Tool A `ToolAffordanceManager` + `'tool_affordance'` memory type, Tool B `ToolCallObserver` producer pipeline, Tool C `MCPToolObserverAdapter` protocol shim, Tool D CLI + docs close
- Scope expansion: MemoryJS now tracks tool-call outcomes via `ctx.toolCallObserver` in addition to entity-layer memories. Documented on the Phase 2 Q4 resolution
- Manager surface: `recordOutcome` / `rollingStats` / `suggestTool` / `get` / `list` / `remove`. Observer: `observeStart` / `observeComplete` / `observeError` / `observePartial` / `cancel`. MCP shim: `wrapToolCall(envelope, handler)`. CLI: `memory tool-affordance list|show|stats|suggest`

#### 2. ~~Reflection Log scheduled pass (Phase 2 Sprint 8)~~ — ✅ shipped
- Closed via `AgentReflectionManager` (`src/agent/AgentReflectionManager.ts`; renamed from `ReflectionManager` in v2.9.x, back-compat alias `ReflectionMemoryManager`) + `MemoryType: 'reflection'` extension + `ctx.reflectionManager` lazy getter + `ReflectionStage` appended to `ConsolidationPipeline`
- New `ReflectionRecord` schema with `scope: 'session' | 'project' | 'global'`, `evidence: string[]`, `generalization_confidence: number`, `keyInsights[]`, content-hash dedup on `sha256(scope + sorted(evidence))`
- **Additive** by design (no supersession of evidence entities); raw `PatternResult.confidence ≥ 0.4` gate; session-end scheduling via explicit `runOnSessionEnd(sessionId)` helper (no `SessionManager` coupling)
- 29 unit tests across `ReflectionManager` (19) + `ReflectionStage` (10); 1986/1986 sibling agent + types + ManagerContext tests green
- Sprint 8 follow-ups closed in v2.0.x: (a) `PatternResult.sourceEntities` narrowing — `detectPatterns` now accepts optional `entityNames` and `ReflectionStage` attributes evidence only to entities whose observations matched a qualifying pattern; (b) `ExperienceExtractor.synthesizeExperience` wiring — `ReflectionStageConfig.experienceExtractor` (optional) drives `ReflectionRecord.experienceType` via `Experience.type` classification.
- Aliased export `ReflectionMemoryManager` at the agent barrel to avoid collision with existing `src/search/ReflectionManager` (progressive query refinement)

#### 3. Concrete Vector-DB drivers (MEM-06)
- `IVectorDBAdapter` interface + `InMemoryVectorAdapter` + `InMemoryVectorStore` + `SQLiteVectorStore` + `QuantizedVectorStore` all shipped
- Concrete external drivers still pending: **pgvector**, **Pinecone**, **Weaviate**
- Effort: high (each driver is its own integration project + auth + rate-limiting story)

#### 4. PostgreSQL backend (MEM-05)
- Multi-user / multi-tenant deployment with row-level tenant isolation
- `IDatabaseAdapter` interface shipped; concrete `PostgreSQLBackend` not started
- Effort: high (PostgreSQL ↔ FTS / pg_trgm parity work)

#### 5. ~~Spell correction layer~~ — ✅ shipped (v2.0.x)
- Closed via `src/search/SpellChecker.ts` — two-stage bigram-Jaccard pre-filter + Levenshtein re-rank, vocabulary auto-built from entity names + tag values, exposed via `ctx.spellChecker`
- Optional `QueryAnalyzer` integration ("did you mean…?" at parse time) deferred as a separate follow-up — the standalone manager API is the v1 surface

#### 6. Query Language DSL frontend
- `QueryParser` + `QueryDslError` + `QueryAnalyzer` shipped
- Full DSL frontend (SQL-like syntax, visual query builder) still pending
- Effort: high

#### 7. REST API generation polish — ⚠️ partial (v2.0.x)
- Shipped in v2.0.x: `RateLimiter` (`src/adapters/RateLimiter.ts`, in-memory token bucket) + pagination helpers (`paginate` / `parsePaginationParams` in `src/adapters/pagination.ts`, wired into `RestRouter.withDefaults` `/entities` and `/search`)
- **Still pending** (each warrants a go/no-go): Fastify plugin wrapper (adds dep — flagged by minimal-deps policy); OpenAPI generation (substantial — would parse `RouteDefinition` into OpenAPI 3.0 spec)
- Effort remaining: medium per deferred piece

### Priority 3 — within the next quarter

#### ~~Phase 3 memory-types expansion (Decision Rationale + Project Context + `do_not_remember`)~~ — ✅ shipped (v2.0.x)
- All three types from the Phase 2 backlog's P3/P4 section shipped via 9 workflow turns (3 per type) per [`MEMORY_TYPES_EXPANSION_PHASE_3.md`](./MEMORY_TYPES_EXPANSION_PHASE_3.md)
- `do_not_remember`: storage-backed `ExclusionManager` (substring-mode v1; regex deferred) + write-block in `MemoryEngine.addTurn` (returns `{blocked, blockedByRuleId}`) + throw in `WorkingMemoryManager.createWorkingMemory` (`MemoryWriteBlockedError`). CLI: `memory exclude`
- Decision Rationale: storage-backed `DecisionManager` with discriminated lifecycle (proposed → accepted | rejected; accepted → superseded) + ADR markdown dual-write (`exportAsAdrMarkdown` / static `parseAdrMarkdown`). CLI: `memory decision`
- Project Context: storage-backed `ProjectContextManager` (one record per `projectId`; facts/conventions/commands/glossary) + `ContextWindowManager.wakeUp` integration (`WakeUpResult.projectContext` field). CLI: `memory project-context`

#### 8. Framework integrations
- `LangChainMemoryAdapter` scaffolded in `src/adapters/`
- LlamaIndex, Haystack, Semantic Kernel adapters not started
- Effort: medium per framework

#### 9. Concrete external DB drivers
- PostgreSQL adapter with pg_trgm for text search (overlaps with MEM-05)
- MongoDB integration for document-oriented storage
- Effort: high

#### 10. Encryption & GDPR tooling
- PII redactor + audit log shipped
- Formal GDPR-export workflow + right-to-erasure confirmation + tenant data isolation reports pending
- Effort: medium

#### 11. Public API tiering completion
- API-stability tags added; coverage incomplete
- Need explicit `@stable` / `@beta` / `@internal` on every public export
- Effort: low (mechanical, but requires sweep)

### Priority 4 — strategic / gated

#### 12. Elasticsearch integration
- Optional add-on; SQLite FTS5 + BM25 covers the common case
- Offload advanced full-text search; sync entities to ES index; hybrid local + ES queries
- Effort: high. **Gated**: user pull required to justify the dep

#### 13. Multi-node distributed architecture
- In-process building blocks ready: `WriteAheadLog`, `EntityProxy`, `CRDTGraph`, `FileSegmentStorage`, `FnvSegmentRouter`
- Missing: cross-host coordinator, read replicas, replication transport
- Effort: very high. **Gated**: design doc + clustering model decision required

#### 14. Cloud-native deployment artefacts
- Kubernetes manifests / Helm chart / Docker image / serverless adapters / cloud-storage backends (S3 / GCS / Azure Blob)
- Likely lives in a sibling repo (e.g., `memoryjs-deploy`) once API stability is declared
- Effort: medium-high. **Gated**: API-stability declaration

#### 15. GraphQL support
- Build on top of REST layer once `RestRouter` is fleshed out
- Effort: medium. **Gated**: user pull

### Priority 5 — long horizon

#### 16. GPU acceleration
- CUDA-accelerated similarity search, batch embedding generation, parallel graph algorithm execution
- `src/search/Node2Vec.ts` source comments explicitly defer GPU; CPU-only envelope currently covers ~10 M entities
- Effort: very high. **Deferred**: CPU envelope is sufficient for now

#### 17. Real-time collaboration transport
- CRDT primitives + collaboration synthesis + conflict resolution all shipped
- WebSocket / SignalR transport layer to make multi-user editing live still pending
- Effort: very high. **Out of scope** for core library — build on top via MCP server or sibling package

#### 18. GraphSAGE for inductive learning
- node2vec shipped (`BiasedRandomWalk` + `SkipGramTrainer`); GraphSAGE adds a TensorFlow/PyTorch dependency
- Effort: very high. **Out of scope** — adds heavy ML dep for marginal capability gain over node2vec

#### 19. Knowledge graph completion (predict missing relations)
- Pattern detection + anomaly detection shipped; predictive relation-completion not started
- Effort: very high. **Speculative** — needs concrete user motivation

#### 20. Clawvault — out of scope
- Separate concept, 4-phase plan from `CLAWVAULT_IDEAS.md` / `CLAWVAULT_IMPLEMENTATION_PLAN.md`
- Per `GAP_ANALYSIS_VS_SUPERMEMORY.md`: "Out of scope for core library; better suited as separate packages or MCP tools"
- **Spin out** as `memoryjs-clawvault` sibling repo when there's pull

### Competitive research — brainapi2-inspired additions (2026-07-24)

> **Status update (same day):** R1–R5, R7, R9 ✅ shipped on this branch — `EventManager`
> (`ctx.eventManager`), `explain: true` evidence paths (`EvidencePathBuilder`),
> `RelationConsolidator` + pipeline stage, `memory audit` CLI + ingest manifests with
> `observationMeta.sourceRef` provenance, `mode: accurate|balanced|lightweight` + token
> accounting, `lookFor` neighbor ranking + `findPathWithin`, `memory doctor`.
> Still open: **R6** (polarity synergies — awaiting demand validation) and **R8**
> (MCP meta-tool — belongs to the `memory-mcp` package, not this repo).

> Source: exploration of [Lumen-Labs/brainapi2](https://github.com/Lumen-Labs/brainapi2) (Python/FastAPI
> knowledge-graph memory server, LLM agent-swarm ingestion). Ideas below are the *deltas* — features
> where brainapi2 does something MemoryJS genuinely lacks. Rejected as duplicative or off-mission:
> wholesale append-only-never-delete (conflicts with the decay/forgetting pillar), MCP server itself
> (memory-mcp exists), Celery/Redis/OAuth deployment infra, multi-brain scoping (`projectId` covers it),
> document OCR pipeline, chat-agent layer, config-YAML plugin registry (library-shaped extension points
> `IDistillationPolicy`/providers already cover it), and their temporal agent (a stub; MemoryJS is ahead).
> Suggested order: R2 → R4 → R5 → R1 → R3.

#### R1. Event reification — n-ary "triangle" model with first-class event hubs
- brainapi2 reifies every action as an event node: `(Actor)-[MADE]->(EventHub)-[TARGETED]->(Target)` +
  `[OCCURRED_WITHIN]` context edges, grouped by a `flow_key`. Fixes the arity limit of flat triples —
  "who did what, to whom, where, when" becomes one queryable unit
- MemoryJS delta: `Relation` is a flat triple; episodic memory stores events as entities but without
  role-typed edges. Fit: an `EventManager` minting `entityType:'event'` entities with `actor_of` /
  `target_of` / `occurred_in` / `occurred_at` relations + `flowKey` tag — pure convention layer over
  existing storage; `GraphTraversal` + `TemporalSearch` are the query substrate; `IOManager.ingest()`
  is the producer. Effort: **M**

#### R2. Traceable reasoning paths in query answers (`explain: true`)
- brainapi2's `/retrieve/context` returns the answer **plus the graph path that derived it** (`triples`,
  hop dicts with `via_uuid` breadcrumbs, depth/hop caps, truncation flag) — evidence paths instead of
  opaque similarity hits
- MemoryJS delta: all the ingredients exist (Dijkstra/all-paths, hybrid scoring, causal chains) but no
  search API returns *why*. Add `explain: true` to `HybridSearchManager`/`LLMSearchExecutor` annotating
  results with `evidencePaths: { nodes, relations, viaQueryTerm }[]`. Best differentiator-per-effort of
  this batch — the core argument for graph memory over vector RAG. Effort: **M**

#### R3. Relation-level consolidation with corrective feedback (Janitor pattern)
- brainapi2's Janitor validates new relationships against a 2nd-degree-neighbor snapshot and feeds
  structured corrections back to the writer (≤3 iterations); semantic edge dedup via embedding
  similarity >0.90 on relation descriptions
- MemoryJS delta: consolidation/dedup is entity/observation-centric; relations get no semantic dedup,
  no neighborhood validation, no corrective loop. Fit: `RelationConsolidator` stage in
  `ConsolidationPipeline` — exact-key tier, embedding-similarity tier via `EmbeddingService`, optional
  `LLMProvider` validation tier (mirrors the `LLMQueryPlanner` optional-provider pattern). Guards the
  graph as LLM-driven ingestion grows. Effort: **M**

#### R4. Queryable provenance: audit query API + source-chunk linkage
- brainapi2 exposes provenance as a retrieval surface (`/retrieve/changelogs` with filters,
  `/retrieve/text-chunks` linking every fact to the source text that produced it)
- MemoryJS delta: `AuditLog` is write-only (no query API) and observations don't record their ingestion
  source. (a) `ctx.auditQuery({ entity?, opType?, timeRange?, text?, limit })` + `memory audit` CLI —
  Effort: **S**; (b) `sourceRef` on observations written by `ingest()` (chunk id into an ingest
  manifest) so evidence paths (R2) extend answer → relation → observation → source chunk — Effort: **M**

#### R5. Ingestion cost/quality dial (`mode: accurate | balanced | lightweight`)
- brainapi2 runs its whole swarm under one mode switch (full extraction + validation loops vs
  important-entities-only, skip validation), with per-stage token accounting
- MemoryJS delta: `ingest()`/`MemoryDistiller` pick LLM-vs-heuristic by provider *presence*, not by
  caller intent, and report no cost. Add `mode` to `IngestOptions` (lightweight = heuristics only;
  balanced = LLM extract, no validation; accurate = LLM extract + R3 consolidation pass) + token-usage
  summary in the ingest result. Effort: **S**

#### R6–R9. Second tier (validate demand before scheduling)
- **R6 Polarity-aware synergies**: `polarity` on entities + `findSynergies()` blending embedding and
  bridge-structure similarity to find allied/*opposing* entities (their `entity_sibilings.py` weights
  direct ×1.30 / indirect ×0.70). Needs evidence agent users want alliance/opposition queries. Effort: M
- **R7 NL-guided neighbor retrieval**: `lookFor?: string` on traversal/neighbor options, ranking
  candidate neighbors by embedding similarity to a free-text description of the desired connection.
  Small, high-utility for agent tool use. Effort: S
- **R8 Self-documenting MCP meta-tool**: a `get_search_operation_instructions`-style tool teaching the
  calling LLM the recommended search workflow at runtime, + a bounded read-only structured-query escape
  hatch. Validate against memory-mcp's current surface. Effort: S
- **R9 `memory doctor` preflight**: CLI diagnostics for the documented gotchas — Node version,
  `better-sqlite3` ABI (`NODE_MODULE_VERSION` mismatch), `dist/workers/` presence, embedding-provider
  reachability, strict-literal env flags. Effort: S

### Research track — Memorilla (2026-10-18), audited against `src/`

> Full audit and acceptance criteria: [`MEMORILLA_LATENT_MEMORY_PLAN.md`](./MEMORILLA_LATENT_MEMORY_PLAN.md) §3–§4.
> Planning only. Paper numbers are the authors' Qwen results, not targets.

> Source: Fallahpour et al., *Memorilla: Latent Semantic Memory for LLMs*, arXiv:2610.21375 (15 Oct 2026).
> FactKG Table 11: 84.33% vs 80.43% full context at 108× fewer document tokens. TextWorld §6.1: avg@3
> 0.186 → 0.242, memory tokens supplementing the same history. Code: <https://github.com/snap-stanford/memorilla>.

Most of the paper's *system shape* is already in this repo. Chunks are entities (`IOManager.ingest` + `Entity.contentHash` + `idx_entities_content_hash`). Vectors have a table (`SQLiteStorage.embeddings`, `SQLiteVectorStore`). Packing has a budget (`ContextWindowManager.retrieveForContext`, `TokenBreakdown`, `enforceDiversity`, `MemoryFormatter.formatWithSalienceBudget`). Ranking has hybrid search (`HybridSearchManager` over `SemanticSearch` + `RankedSearch` TF-IDF + optional `GraphRankPrior`). On SQLite, `RankedSearch` already narrows candidates with `SQLiteStorage.fullTextSearch` (FTS5 `bm25()`). `BM25Search` is a second, unwired caller of that method. Turns already append via `MemoryEngine.addTurn`. Soft tokens and GRPO are dropped: no class accepts hidden states.

What is actually missing is wiring and two fields:

#### E1. ~~Point semantic search at the embeddings table~~ — ✅ shipped
- With `SQLiteStorage`, `ManagerContext.semanticSearch` calls `createVectorStore('sqlite', this.storage, model)` (`src/search/VectorStore.ts`). The `embeddings` table is the live store. JSONL stays `InMemoryVectorStore`.
- `SemanticSearch.indexAll` skips unchanged entities. It re-embeds an entity when its hash differs from the nullable `embeddings.contentHash` column that `storeEmbedding` writes. The hash is `entity.contentHash`, or a SHA-256 of the embedding text when the entity has none.
- Tests: `tests/unit/search/SemanticSearch.test.ts` and `tests/unit/search/VectorStore.test.ts`. No new module.

#### E2. ~~Candidate-token ratio, optional slot cap, query rank via hybrid search~~ — ✅ shipped
- `ContextPackage` reports `sourceTokens` and `compressionRatio` (`src/types/agent-memory.ts`). The ratio is 1 when nothing is excluded.
- `ContextRetrievalOptions.maxSlots` caps the result. Unset means no cap. The cap applies in `prioritize`, `retrieveForContext` and `retrieveWithBudgetAllocation`.
- `ContextWindowManager.setHybridSearch()` attaches a `HybridSearchManager`. When `SalienceContext.queryText` is set, `retrieveForContext` orders candidates by hybrid rank before the salience cut. `composeHops: 1` adds one-hop neighbors of the top hits. `MEMORY_CONTEXT_HYBRID_RANKING=true` (default `false`) makes `ctx.contextWindowManager` call `setHybridSearch` with the hybrid search manager. `AgentMemoryManager` is not covered.
- Tests: `tests/unit/agent/ContextWindowManager.test.ts`.

#### E3. ~~Finish `SummarizationService`'s provider~~ — ✅ shipped
- `SummarizationService.summarize(texts, query?)` takes an optional query. `LLMSummarizationProvider(llm, maxTokens)` sends the texts and the query to an `LLMProvider` and clips the reply to the word limit. The caller passes the provider in code: `new SummarizationService(config, { llmProvider })`.
- `ContextRetrievalOptions.summarizeExcluded` (off by default) makes `retrieveForContext` return one summary of the excluded entities in `ContextPackage.excludedSummary`. A summarizer must be attached with `ContextWindowManager.setSummarizer()`. The summary is not counted in `totalTokens`. `ProfileConfig.retrieval.summarizeExcluded` sets the default.
- No production code calls `setSummarizer()`. Default retrieval output is unchanged.
- Tests: `tests/unit/agent/SummarizationService.test.ts` and `tests/unit/agent/ContextWindowManager.test.ts`.

#### E4. ~~Question-type profiles~~ — ✅ shipped
- `ContextProfile` has `lookup` (query starts with who, which, when or where) and `synthesis` (query starts with why or how). `ContextProfileManager.inferProfile` checks them after the four task profiles.
- `ProfileConfig.retrieval.composeHops` is applied by `ContextWindowManager.applyProfile` when the caller leaves `composeHops` unset. The shipped presets leave `retrieval` unset, so default retrieval does not change.
- Tests: `tests/unit/agent/ContextProfileManager.test.ts`.

#### E5. ~~Repeat count per session~~ — ✅ shipped
- `MemoryEngine.getRepeatedTurnCount(sessionId)` returns the number of turns that the dedup chain rejected for the session in this process. It counts only dedup-chain rejections.
- The count is not persisted. `deleteSession` resets it.
- Tests: `tests/unit/agent/MemoryEngine.test.ts`.

Suggested order: **E1 → E2**. E3 has shipped as a library API. No new store, no latent adapter, no FactKG download.

### Research track — EMMA (2026-10-29), audited against `src/`

> Planning only. Benchmark figures in the abstract are the authors' results. This track leaves those benchmarks unscheduled.

> Source: Niu, Liu, Yu, and Klinkner, *EMMA: Structured Episodic Memory for Multi-Agent Workflow Synthesis*, arXiv:2610.35966. Abstract: <https://arxiv.org/abs/2610.35966>.
>
> Abstract (update rule): "EMMA makes the ownership and admissibility of updates explicit: a reflector assigns each diagnosed failure to the scope owning its correction and proposes one edit within it, and backbone-independent guards keep every accepted edit scoped, incremental and bounded." The abstract also reports the best overall result on KramaBench, AppWorld, and BBEH, up to 32.5% over the strongest of ACE, GEPA, EvoMAS, and ADAS, with 17–38% fewer training executions than the most efficient baseline.
>
> Loop this section evaluates, and nothing wider: after a failed task, a reviewer blames one component and makes one small, guarded edit to it. The abstract's controller-routing memory, inheriting specialists, and per-step skill pool are a multi-agent workflow synthesizer. This library does not gain that system from the items below.

Three candidate ideas were checked against `src/`. Each one already has a store, a writer, or a lifecycle. The open work is the joint that the loop needs and the current modules do not write.

#### M1. Name one blamed component on the failure record

**Already covered.** A structured failure of task, attempt, and outcome is already stored and is already retrievable on a later run.

- `FailureRecord` (`src/types/agent-memory.ts`) keeps the task in `context`, the attempt in `attempted`, the outcome in `failure_mode`, a free-text diagnosis in `root_cause`, the retrieval key in `applicability_hint`, `lifecycle` (`open` | `resolved`), and `sourceSessionId`.
- `FailureManager.record` and `FailureManager.lookupForTask` (`src/agent/FailureManager.ts`) persist that record and score later tasks by substring overlap on `applicability_hint`, `context`, and `attempted`.
- `FailureDistillation.distillFromSession` (`src/agent/FailureDistillation.ts`) runs only when the session entity's `outcome` is `'failure'`, walks `EpisodicRelations.CAUSED_BY`, and returns a `DistilledLesson` whose `causeChain` is a list of episode names.
- `EpisodicMemoryManager.createEpisode`, `getTimeline`, and `addCausalLink` (`src/agent/EpisodicMemoryManager.ts`) store the attempt itself.
- `PGTrajectory` (`src/types/proceduralGraph.ts`) records `taskId`, `revisionId`, `steps`, `score`, and `outcome` for one procedural-graph run. `ToolAffordanceManager.recordOutcome` (`src/agent/ToolAffordanceManager.ts`) records one tool call as `success` | `failure` | `partial`.

**Gap.** Nothing on `FailureRecord` points at exactly one component. `root_cause` is prose. `causeChain` is a list. `lookupForTask` cannot answer "which failures blamed this procedure, heuristic, or plan node?"

**Builds on.** `FailureRecord`, `FailureManager.record`, `FailureManager.lookupForTask`, `isFailureMemory`. The id is an existing handle: an entity `name` (including heuristic ids and `ProcedureStore` procedure / procedure-step names), a node id that `PlanManager.findNode` can resolve, or a `PGNode.id` inside a loaded `PGSnapshot`.

**New pieces.** Add optional `blamedComponent: { kind: 'entity' | 'heuristic' | 'procedure' | 'plan-node' | 'pg-node'; id: string }` to `FailureRecord`. The type holds one id. `record` rejects an empty id. It also rejects an id the kind's existing getter cannot resolve: `storage.getEntityByName` for `entity`, `heuristic`, and `procedure`; `PlanManager.findNode` for `plan-node`; the snapshot's `nodes` for `pg-node`. Add `FailureManager.lookupByComponent(id, options?)` beside `lookupForTask`, same status filter, match on `blamedComponent.id` only. Records that omit the field keep today's `lookupForTask` scoring and stay out of `lookupByComponent`.

**Acceptance.** A record written with one resolved component id round-trips through `lookupByComponent` and through `getAll`. A second component cannot be represented on the same record. An unknown id is rejected at `record` time. A record with no `blamedComponent` keeps the current `lookupForTask` token score and is absent from `lookupByComponent`.

**Tests.** Extend `tests/unit/agent/FailureManager.test.ts`: round-trip, unknown-id rejection, status filter, and a `lookupForTask` case that stays green when the new field is absent.

Effort: **S**.

#### M2. One guarded edit, saved as a new version and linked to that failure

**Already covered.** Versions, history, and audit retention already exist. M2 writes through those chains. Existing delete APIs stay available to their current callers.

- Entity chain fields `version`, `parentEntityName`, `rootEntityName`, `isLatest`, `supersededBy` live on `Entity` (`src/types/types.ts`). `ContradictionDetector.supersede` (`src/features/ContradictionDetector.ts`) creates the next entity and sets the previous `isLatest: false` and `supersededBy`. `EntityManager.getVersionChain` and `getLatestVersion` (`src/core/EntityManager.ts`) read the chain. `SearchFilterChain.entityPassesFilters` (`src/search/SearchFilterChain.ts`) drops `isLatest === false` unless `includeSuperseded` is set. Tests: `tests/unit/core/entity-manager-version-chain.test.ts`, `tests/unit/search/search-filter-chain-versioning.test.ts`.
- Procedural-graph revisions already keep history: `PGSnapshot.revisionId` and `parentRevisionId` (`src/types/proceduralGraph.ts`), `ProceduralGraphState.listRevisions` / `loadRevision` (`src/agent/procedural/graph/backing/ProceduralGraphState.ts`), and `ProceduralGraphEvolution.run` (`src/agent/procedural/graph/ProceduralGraphEvolution.ts`), which records every round on `PGRoundRecord` and rejected proposals on `PGRejectionRecord`.
- `AuditLog.append` and `AuditLog.query` (`src/features/AuditLog.ts`) record mutations. `RelationManager.invalidateRelation` ends a relation and leaves the row. `DecisionManager.supersede` versions a decision. `HeuristicExtractionStage.runOnResolution` (`src/agent/ConsolidationPipeline.ts`) mints a new heuristic from a resolved failure; it does not edit the blamed component.
- Delete and archive APIs stay on their current callers: `SemanticForget.forgetByContent`, `DecayEngine.forgetWeakMemories`, `HeuristicManager.remove`, `EntityManager.deleteEntities`, `ArchiveManager.archiveEntities`. `applyGuardedEdit` is a separate caller and leaves the previous version stored.

**Gap.** A new version is not stamped with the failure that caused it. `supersede` takes observations and no failure id. `PGRoundRecord` points at a run and a score, and it does not point at a `FailureRecord.id`. A single call can also change more than one component: `ProceduralGraphRefiner.proposeEdits` (`src/agent/procedural/graph/ProceduralGraphRefiner.ts`) accepts a `PGEditSet` of `add_nodes`, `delete_nodes`, `add_edges`, and `delete_edges`. `HeuristicManager.reinforce` rewrites confidence on the same row.

**Builds on.** M1's `blamedComponent`. For an entity-backed component (heuristic, procedure step, plan, or plain entity), `ContradictionDetector.supersede` and `EntityManager.getVersionChain`. For a `pg-node`, one child `PGSnapshot` committed through `IProceduralGraphBacking` with `parentRevisionId` set to the retained revision. `AuditLog.append` for the write. `FailureManager.markResolved` stays the way a failure is closed after the edit exists.

**New pieces.** One function, `applyGuardedEdit`, in a new module `src/agent/GuardedComponentEdit.ts`:

1. Load the failure. Require `blamedComponent`. Refuse the call when it is absent.
2. Apply one bounded change to that id only. Entity path: the same version fields `supersede` writes (`version`, `parentEntityName`, `rootEntityName`, `isLatest`), plus one observation or one scalar field, and a new optional `causedByFailureId` on the new entity equal to `FailureRecord.id`. `supersede` does not accept that id or an initial `lifecycleStatus` today, so extend it with those two optional arguments rather than cloning the method. Procedural-graph path: one node-text or one edge-text change on the blamed `PGNode.id`, committed as a child revision. Refuse a `PGEditSet` that adds or deletes a node, touches any other id, or changes more than one text field.
3. Leave the previous version in place. The function does not call `deleteEntities`, `forgetByContent`, `forgetWeakMemories`, `HeuristicManager.remove`, or `ArchiveManager.archiveEntities`.
4. Append one audit entry whose target is the new version and whose metadata names the failure id.

**Acceptance.** One call yields one new version of the blamed id. `getVersionChain` (entity) or `loadRevision` (graph) still returns the previous version. The new version's `causedByFailureId` equals the failure id. A call whose payload names any other id throws before a write. A payload with two field changes throws before a write. A payload that deletes the old version throws before a write.

**Tests.** New `tests/unit/agent/GuardedComponentEdit.test.ts` on a temp graph: chain length grows by one, the old entity reloads, `causedByFailureId` matches, a second target is rejected, and a delete-shaped payload is rejected with no storage change. One procedural-graph case on `InMemoryProceduralGraphBacking`: the child snapshot's `parentRevisionId` is the previous revision, and `listRevisions` returns both.

Effort: **M**. Depends on M1.

#### M3. Start that edit as draft, publish it when a later task succeeds, archive it otherwise

**Already covered.** Trust labels, numeric confidence, working-memory promotion, and decay already exist. M3 calls `EntityStatus` and those scorers. It adds no parallel enum.

- `EntityStatus` is `'draft' | 'published' | 'archived'` (`src/types/types.ts`), with `ENTITY_STATUS_TRANSITIONS`. `draft → published`, `draft → archived`, `published → archived`, and `archived → published` are legal. `published → draft` is not. `EntityStateMachine.transition` (`src/core/EntityStateMachine.ts`) enforces that. `EntityManager.updateEntity` calls it before writing `lifecycleStatus`. `DEFAULT_ENTITY_STATUS` is `'published'`, and a missing `lifecycleStatus` is treated as published. `SearchFilterChain.entityPassesFilters` keeps only `published` unless the caller passes `lifecycleStatus`. The field comment already defines `draft` as in-flight, `published` as live, and `archived` as removed from default search while the entity remains stored.
- `TrustLevel` (`'ground-truth' | 'verified' | 'inferred' | 'unverified'`), `inferTrustLevel`, and `compareTrustLevel` (`src/types/agent-memory.ts`) rank provenance. `ConflictResolver.resolveTrustLevel` and `CollaborativeSynthesis.resolveConflicts` (`strategy: 'trust_level'`) consume that order. `AgentEntity.confidence` and `confirmationCount` are the numeric belief. `HeuristicManager.reinforce` and `recordContradiction` move confidence in place. `ProcedureManager.refineProcedure` updates a procedure's success rate in place. `WorkingMemoryManager.promoteMemory` moves `working` to `episodic` or `semantic` (`promotedAt`, `promotedFrom`). `SessionManager` does that at session end when `promoteOnEnd` is set. `ProspectivePromotionStage` promotes a fired intention to an episodic entity.
- Removal of weak memory is a different operation: `DecayEngine.forgetWeakMemories`, `SemanticForget.forgetByContent`, `FreshnessManager` (TTL and confidence reports), and `ArchiveManager.archiveEntities` (copies matches into a compressed archive and removes them from the live graph). `FailureManager.markResolved` closes the failure record. `ProceduralGraphEvolution` promotes a candidate revision to head when its validation mean improves; that rule stays the graph's own.

**Gap.** `ContradictionDetector.supersede` creates the new version without `lifecycleStatus`, so the new version is immediately published. No writer moves `draft → published` because a later task that used this version succeeded, and no writer moves it to `archived` because that later task failed, while keeping the row. `published → draft` is illegal, so a follow-up `updateEntity` cannot demote a version `supersede` has already created.

**Builds on.** M2's new version. `EntityManager.createEntities` (initial `lifecycleStatus: 'draft'` is accepted; the transition guard runs on update). `EntityManager.updateEntity` plus `EntityStateMachine.transition`. `EntityManager.getVersionChain`. `SearchFilterChain.entityPassesFilters`. `RelationManager.createRelations` for the evidence edge (`metadata` already exists on `Relation`). When the blamed component is a heuristic, `HeuristicManager.reinforce` on publish. Optional: set `source.trustLevel` to `'verified'` on publish so `resolveTrustLevel` already prefers it. Procedural-graph head promotion stays inside `ProceduralGraphEvolution`; M3 does not add a second rule on `PGHead`.

**New pieces.** In `applyGuardedEdit`, pass `lifecycleStatus: 'draft'` into the create path (the optional argument from M2). Add two methods on the same module:

- `noteHelped(versionName, taskId)` — `updateEntity` to `published`, then `createRelations` of type `helped_task` from the version to `taskId` (the later task's episode or session name). If the version is a heuristic, call `reinforce`.
- `retire(versionName, taskId, reason)` — `updateEntity` to `archived`, then a `retired_after` relation whose `metadata.reason` is `reason`. The entity stays in storage. `getVersionChain` still returns it.

Default search interaction: `entityPassesFilters` hides `isLatest === false` and hides `draft`. A draft latest version would hide the previous published version too. Extend the versioning branch so that, when the latest entity is `draft`, the newest ancestor with `lifecycleStatus` published or unset still passes. Trial retrieval uses `getLatestVersion` and `lookupByComponent`, which do not apply this filter. `getLatestPublished(name)` on `EntityManager` walks `getVersionChain` and returns that ancestor for callers that want trusted memory only.

**Acceptance.** The version M2 writes has `lifecycleStatus: 'draft'`. Default search returns the previous published ancestor and omits the draft. `getLatestVersion` returns the draft. After `noteHelped`, the draft is `published`, default search returns it, a `helped_task` relation points at `taskId`, and a heuristic's `support` has increased by one. After `retire`, default search omits it, `getVersionChain` still contains it, and a `retired_after` relation stores `reason`. An entity that never went through `applyGuardedEdit` keeps its current status and its current search behavior. `noteHelped` on an already published version follows `EntityStateMachine` (published → published is a no-op; published → draft throws and is not the API).

**Tests.** Extend `tests/unit/agent/GuardedComponentEdit.test.ts` for the initial `draft`. Extend `tests/unit/search/search-filter-chain-versioning.test.ts` with a chain whose latest is `draft` and whose parent is `published`: default filters return the parent. New cases for `noteHelped` and `retire` assert status, the relation, the heuristic `support` bump, and that `retire` does not call a delete (entity still loads by name).

Effort: **M**. Depends on M2.

Suggested order: **M1 → M2 → M3**. No new store, no new status enum, no workflow synthesizer, no benchmark harness.

---

## Status Summary

| Track | Outstanding items |
|-------|-------------------|
| **Agent memory** (Phase 3B finish + Phase 2 expansions) | **Tool Affordance Memory** (new type) |
| **Dedup** | _(none outstanding — entity-level observation dedup shipped v2.0.x; merge/strip actions deferred as design follow-ups)_ |
| **Backends** | MEM-05 PostgreSQL, MEM-06 concrete vector DBs |
| **Search** | Spell correction, query DSL frontend |
| **Integration** | Elasticsearch, REST API polish, framework adapters, GraphQL |
| **Enterprise** | Distributed coordinator, cloud-native artefacts, GDPR tooling, encryption layer |
| **Long horizon** | GPU, GraphSAGE, KG completion, real-time WS transport, affective tagging (deferred P3) |
| **Latent memory (Memorilla)** | Two enhancements, not new modules: E1 wire `semanticSearch` to the existing `embeddings` table and re-embed on `contentHash` change; E2 `sourceTokens` / `compressionRatio` / optional `maxSlots` on `ContextPackage`, ranking via `HybridSearchManager`. E3 finishes the `SummarizationService` provider and adds an optional excluded-entity summary; no production code calls it yet. Soft tokens and GRPO dropped. See [`MEMORILLA_LATENT_MEMORY_PLAN.md`](./MEMORILLA_LATENT_MEMORY_PLAN.md). |
| **Failure-edit loop (EMMA)** | M1 one `blamedComponent` on `FailureRecord` plus `lookupByComponent`. M2 `applyGuardedEdit`: one bounded change, new version, `causedByFailureId`, previous version kept. M3 that version starts `draft`, `noteHelped` publishes it, `retire` archives it. See the EMMA research track above. |
| **Out of scope** | Clawvault (sibling repo), sensory buffer (covered by ingest pipeline), Memorilla soft-token injection and in-core GRPO |

**Genuinely active P1/P2 items: 6.** Everything else is gated, strategic, or long-horizon.

---

## Dependency Strategy

### Current dependencies (minimal)
- `@danielsimonjr/workerpool` — worker pool management
- `async-mutex` — concurrency control
- `better-sqlite3` — SQLite backend
- `chrono-node` — natural-language temporal parsing
- `zod` — runtime validation

### Adding new dependencies

Net-new runtime dependencies require:
1. Clear justification tied to a roadmap item above
2. Bundle-size impact assessment (`tsup` build-size delta)
3. License compatibility check (MIT / Apache 2.0 / BSD only)
4. Security audit (`npm audit` + manual review of maintainer reputation)
5. Test impact (does it require new test-environment setup?)

Dev dependencies face a lighter bar but still need justification beyond "it would be nice."

### Why dependencies are kept minimal

- Lower attack surface (fewer transitive packages to audit)
- Faster `npm install` on user machines
- Smaller bundle size for downstream consumers
- Less coordination work on version bumps

---

## Breaking Change Policy

### Stability tiers
- **`@stable`** — covered by SemVer; breaking changes require a major version bump + migration guide
- **`@beta`** — may break between minor versions with CHANGELOG entry
- **`@internal`** — no stability guarantee; safe to refactor freely

### What we don't break
- Core `Entity` / `Relation` / `KnowledgeGraph` interfaces
- Search-result ranking algorithms without prior deprecation
- JSONL storage format (always backward-readable)
- Public methods on `ManagerContext`, `EntityManager`, `RelationManager`, `ObservationManager`, `SearchManager`

### What we will break (with deprecation)
- Internal manager wiring patterns
- Experimental APIs (`@beta`-tagged)
- Performance heuristics (algorithm-level changes)

### Gradual rollout pattern
1. Mark old API `@deprecated` with migration pointer
2. Ship the new API alongside the old one for ≥1 minor version
3. Remove the old API in the next major version

---

## Contributing to the Roadmap

This roadmap is a living document. To propose features:

1. Open an issue with the `roadmap` label
2. Describe the use case and expected benefits
3. Indicate preferred priority tier
4. Include implementation considerations if known

Items reaching P1/P2 must have:
- A concrete user need or compliance requirement driving them
- A rough effort estimate
- A clear "done" definition (what observable behaviour ships)

---

## References

### Research papers

- **Luo, J., Tian, Y., Cao, C., et al. (2026)**. ["From Storage to Experience: A Survey on the Evolution of LLM Agent Memory Mechanisms."](https://www.preprints.org/manuscript/202601.0618/v2) *Preprints.org*, doi:10.20944/preprints202601.0618.v2
  - Proposes three-stage evolutionary framework: Storage → Reflection → Experience
  - Sourced the Phase 3B design (3B.1–3B.7 all now shipped; 3B.8 remains)
- **Fallahpour, A., Idehpour, P., Kothapalli, V., Mounier, N., Wu, S., Pardis, S., and Leskovec, J. (2026).** ["Memorilla: Latent Semantic Memory for LLMs."](https://arxiv.org/abs/2610.21375) arXiv:2610.21375. HTML: <https://arxiv.org/html/2610.21375>. Site: <https://memory.stanford.edu/>.
  - Write-once embeddings and a K = 16 soft-token readout for a frozen LLM
  - Audited in [`MEMORILLA_LATENT_MEMORY_PLAN.md`](./MEMORILLA_LATENT_MEMORY_PLAN.md). Chunk store, vector table, hybrid search, and token budgets already exist. Open work is wiring `embeddings` into `semanticSearch` and reporting the context-packer's compression ratio. Soft-token injection is dropped.
- **Niu, R., Liu, K., Yu, R., and Klinkner, K. (2026).** ["EMMA: Structured Episodic Memory for Multi-Agent Workflow Synthesis."](https://arxiv.org/abs/2610.35966) arXiv:2610.35966.
  - A reflector assigns each diagnosed failure to the scope that owns the correction and proposes one guarded edit inside that scope.
  - Audited in the EMMA research track above. Failure records, version chains, and `draft` / `published` / `archived` already exist. Open work is M1–M3: one blamed component, one failure-linked edit, and publishing or archiving that edit from a later task.

### Companion documents

- [CHANGELOG.md](../../CHANGELOG.md) — per-version history of shipped features
- [`docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md`](../planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md) — per-phase task ledger for the perf & scale track
- [`docs/roadmap/future_features.md`](./future_features.md) — companion roadmap with the §1–§15 narrative framing
- [`docs/roadmap/MEMORY_TYPES_EXPANSION.md`](./MEMORY_TYPES_EXPANSION.md) — Phase 1 design (prospective memory, ✅ shipped)
- [`docs/roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md`](./MEMORY_TYPES_EXPANSION_PHASE_2.md) — Phase 2 planning (catalog-driven candidate set: failure-memory hardening / plan / trust hierarchy / tool affordance / reflection)
- [`docs/architecture/DEPENDENCY_GRAPH.md`](../architecture/DEPENDENCY_GRAPH.md) — auto-generated dependency map; source of truth for what exists in `src/`
- [`docs/roadmap/GAP_ANALYSIS_VS_MEMPALACE.md`](./GAP_ANALYSIS_VS_MEMPALACE.md), [`GAP_ANALYSIS_VS_SUPERMEMORY.md`](./GAP_ANALYSIS_VS_SUPERMEMORY.md) — comparative analysis against adjacent projects
- [`docs/roadmap/MEMORILLA_LATENT_MEMORY_PLAN.md`](./MEMORILLA_LATENT_MEMORY_PLAN.md) — Memorilla (arXiv:2610.21375) summary, codebase audit, and enhancements E1–E3
