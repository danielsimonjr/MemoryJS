# TODO

Open follow-up work. Everything else that was found in the 2026-11 audits has
been fixed and merged (see CHANGELOG `[Unreleased]`).

## Oversize files (review convention: src < 500 lines, tests < 400 lines)

The convention is not a gate. These files predate it and were left intact in
the 2026-11-06 docs/health pass because splitting them is a multi-day refactor
with regression risk. Do it as its own PR series, one file (or one cluster)
per PR, behaviour-identical, with the existing test suites unchanged and the
same Builder → Challenger → Reviewer/Fixer pipeline. Prefer the pattern used
for `ManagerContext` (#278): extract cohesive groups into sibling modules and
keep the original file as a thin facade.

### Source files over 500 lines (57)

Suggested order: largest and most central first.

| Lines | File | Suggested split |
|---:|---|---|
| 2641 | `src/core/SQLiteStorage.ts` | |
| 2585 | `src/types/types.ts` | |
| 2534 | `src/types/agent-memory.ts` | |
| 2145 | `src/features/IOManager.ts` | |
| 2139 | `src/agent/ConsolidationPipeline.ts` | |
| 1999 | `src/agent/ContextWindowManager.ts` | |
| 1862 | `src/core/GraphStorage.ts` | |
| 1606 | `src/core/EntityManager.ts` | |
| 1406 | `src/core/GraphTraversal.ts` | |
| 1152 | `src/agent/MultiAgentMemoryManager.ts` | |
| 1008 | `src/core/ObservationManager.ts` | |
| 961 | `src/agent/RelationConsolidator.ts` | |
| 927 | `src/search/EmbeddingService.ts` | |
| 897 | `src/agent/procedural/graph/ProceduralGraphEvolution.ts` | |
| 888 | `src/utils/entityUtils.ts` | |
| 830 | `src/agent/DecayEngine.ts` | |
| 816 | `src/agent/WorkingMemoryManager.ts` | |
| 811 | `src/utils/schemas.ts` | |
| 800 | `src/agent/WorkThreadManager.ts` | |
| 794 | `src/search/QueryCostEstimator.ts` | |
| 776 | `src/core/ManagerContext.ts` | |
| 762 | `src/core/TransactionManager.ts` | |
| 750 | `src/adapters/RestRouter.ts` | |
| 732 | `src/agent/SalienceEngine.ts` | |
| 727 | `src/agent/AgentMemoryManager.ts` | |
| 716 | `src/features/GovernanceManager.ts` | |
| 710 | `src/agent/GuardedComponentEdit.ts` | |
| 707 | `src/features/CompressionManager.ts` | |
| 691 | `src/agent/SessionCheckpoint.ts` | |
| 684 | `src/agent/SessionManager.ts` | |
| 684 | `src/agent/ProspectiveMemoryManager.ts` | |
| 677 | `src/core/segments/FileSegmentStorage.ts` | |
| 645 | `src/agent/DreamEngine.ts` | |
| 644 | `src/search/FuzzySearch.ts` | |
| 641 | `src/utils/taskScheduler.ts` | |
| 639 | `src/agent/index.ts` | |
| 635 | `src/core/PostgreSQLStorage.ts` | |
| 603 | `src/search/TFIDFIndexManager.ts` | |
| 601 | `src/search/HybridSearchManager.ts` | |
| 595 | `src/agent/MemoryEngine.ts` | |
| 580 | `src/agent/procedural/graph/backing/ProceduralGraphState.ts` | |
| 577 | `src/search/SemanticSearch.ts` | |
| 574 | `src/search/BooleanSearch.ts` | |
| 562 | `src/search/ParallelSearchExecutor.ts` | |
| 560 | `src/search/SearchManager.ts` | |
| 557 | `src/search/RankedSearch.ts` | |
| 553 | `src/features/AuditLog.ts` | |
| 543 | `src/search/BM25Search.ts` | |
| 542 | `src/agent/PlanManager.ts` | |
| 540 | `src/agent/SessionQueryBuilder.ts` | |
| 536 | `src/agent/procedural/graph/ProceduralGraphManager.ts` | |
| 530 | `src/agent/EpisodicMemoryManager.ts` | |
| 525 | `src/utils/BatchProcessor.ts` | |
| 522 | `src/utils/searchCache.ts` | |
| 517 | `src/agent/MemoryFormatter.ts` | |
| 515 | `src/agent/procedural/graph/backing/SqliteProceduralGraphBacking.ts` | |
| 512 | `src/agent/events/EventManager.ts` | |

Suggested splits for the largest:
- `src/core/SQLiteStorage.ts` — schema/migrations, FTS, read pool, entity ops, relation ops, embeddings table.
- `src/types/types.ts` / `src/types/agent-memory.ts` — one file per record family (entity, relation, search, agent records, guards); keep `src/types` a leaf.
- `src/features/IOManager.ts` — one module per format (JSON/CSV/GraphML/GEXF/DOT/Markdown/Mermaid), ingest, backup, skills.
- `src/agent/ConsolidationPipeline.ts` — one module per stage.
- `src/agent/ContextWindowManager.ts` — retrieval, budgeting/diversity, spillover, wakeUp layers.
- `src/core/GraphStorage.ts` / `src/core/EntityManager.ts` — delta write path, rename, versioning, cache.
- `src/core/GraphTraversal.ts` — paths, centrality, components, hierarchy.

### Test files over 400 lines (139)

List them with:

```bash
find tests -name "*.ts" -exec wc -l {} + | awk '$1>400 && $2!="total"' | sort -rn
```

Split each by `describe` block into sibling files (`<name>.<topic>.test.ts`),
keeping shared fixtures in a `*Fixtures.ts` helper; no test may be dropped,
skipped or weakened. Largest first: `tests/unit/agent/ConsolidationPipeline.test.ts`
(2333), `tests/unit/features/IOManager.test.ts` (1776),
`tests/unit/agent/ContextWindowManager.test.ts` (1752),
`tests/unit/core/SQLiteStorage.test.ts` (1719), `tests/unit/core/ManagerContext.test.ts` (1358).

## Other

- `src/core/sqlite-register.ts` is tagged `@internal` but re-exported from
  `src/core/index.ts` (guides import `SQLiteStorage` from the root). Retag to
  `@experimental` or stop re-exporting once the guides move to the `./sqlite`
  subpath. See CLAUDE.md "API Stability Tiers".
- `PostgreSQLStorage` is mock-tested only; add an opt-in integration test
  behind a `PG_TEST_URL` env var.
