# MemoryJS Roadmap

**Last refreshed**: 2026-05-13 (v1.15.0)

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

#### 4. Heuristic Guidelines Manager (3B.8)
- `src/agent/HeuristicManager.ts` exists as scaffold but is not wired into the `ConsolidationPipeline`
- Final 3B item — closing it completes the entire "From Storage to Experience" memory evolution series
- Effort: medium (1–2 weeks)

#### 5. Entity-level observation deduplication
- `MemoryEngine` covers turn-level dedup (Tier 1–4 chain). Entity-level passes — finding cross-entity duplicate observations — still TBD
- Could reuse the existing four-tier dedup machinery applied at observation granularity
- Effort: medium

### Priority 2 — within 1–2 sprints

#### 1. Tool Affordance Memory (Phase 2 Sprint 7 — new memory type)
- No current support; high adaptive-tool-selection value
- `ToolAffordanceRecord` with `tool_name` / `recent_success_rate` / `common_failure_modes` / `cost_estimate` / rolling-window stats
- Needs an upstream tool-observation pipeline (open Q4 in Phase 2 doc — scope decision)
- Effort: medium (~7 days)
- Design: [`MEMORY_TYPES_EXPANSION_PHASE_2.md`](./MEMORY_TYPES_EXPANSION_PHASE_2.md) §4 Priority 2 / Type 8

#### 2. ~~Reflection Log scheduled pass (Phase 2 Sprint 8)~~ — ✅ shipped
- Closed via `ReflectionManager` (`src/agent/ReflectionManager.ts`) + `MemoryType: 'reflection'` extension + `ctx.reflectionManager` lazy getter + `ReflectionStage` appended to `ConsolidationPipeline`
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

#### 5. Spell correction layer
- `NGramIndex` infrastructure exists; spell-correction layer absent
- Could plug into `QueryAnalyzer` to suggest corrections at parse time
- Effort: medium

#### 6. Query Language DSL frontend
- `QueryParser` + `QueryDslError` + `QueryAnalyzer` shipped
- Full DSL frontend (SQL-like syntax, visual query builder) still pending
- Effort: high

#### 7. REST API generation polish
- `RestRouter` scaffold shipped
- Fastify plugin wrapper + OpenAPI generation + rate-limiting + pagination middleware pending
- Effort: medium

### Priority 3 — within the next quarter

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

---

## Status Summary

| Track | Outstanding items |
|-------|-------------------|
| **Agent memory** (Phase 3B finish + Phase 2 expansions) | 3B.8 Heuristic Guidelines Manager, **Tool Affordance Memory** (new type); deferred follow-up: archive/`markResolved` race-condition fix |
| **Dedup** | Entity-level observation dedup |
| **Backends** | MEM-05 PostgreSQL, MEM-06 concrete vector DBs |
| **Search** | Spell correction, query DSL frontend |
| **Integration** | Elasticsearch, REST API polish, framework adapters, GraphQL |
| **Enterprise** | Distributed coordinator, cloud-native artefacts, GDPR tooling, encryption layer |
| **Long horizon** | GPU, GraphSAGE, KG completion, real-time WS transport, affective tagging (deferred P3) |
| **Out of scope** | Clawvault (sibling repo), sensory buffer (covered by ingest pipeline) |

**Genuinely active P1/P2 items: 8.** Everything else is gated, strategic, or long-horizon.

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

### Companion documents

- [CHANGELOG.md](../../CHANGELOG.md) — per-version history of shipped features
- [`docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md`](../planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md) — per-phase task ledger for the perf & scale track
- [`docs/roadmap/future_features.md`](./future_features.md) — companion roadmap with the §1–§15 narrative framing
- [`docs/roadmap/MEMORY_TYPES_EXPANSION.md`](./MEMORY_TYPES_EXPANSION.md) — Phase 1 design (prospective memory, ✅ shipped)
- [`docs/roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md`](./MEMORY_TYPES_EXPANSION_PHASE_2.md) — Phase 2 planning (catalog-driven candidate set: failure-memory hardening / plan / trust hierarchy / tool affordance / reflection)
- [`docs/architecture/DEPENDENCY_GRAPH.md`](../architecture/DEPENDENCY_GRAPH.md) — auto-generated dependency map; source of truth for what exists in `src/`
- [`docs/roadmap/GAP_ANALYSIS_VS_MEMPALACE.md`](./GAP_ANALYSIS_VS_MEMPALACE.md), [`GAP_ANALYSIS_VS_SUPERMEMORY.md`](./GAP_ANALYSIS_VS_SUPERMEMORY.md) — comparative analysis against adjacent projects
