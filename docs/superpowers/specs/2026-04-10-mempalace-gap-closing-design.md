# Design: MemPalace Gap-Closing (v1.9.0)

**Date:** 2026-04-10
**Status:** ✅ **Shipped as v1.9.0** — temporal relations (`invalidateRelation` / `queryAsOf` / `timeline`), 4-layer wake-up stack (`ContextWindowManager.wakeUp`), conversation ingestion (`IOManager.ingest`), per-agent diary, local-embeddings default. See CHANGELOG v1.9.0.
**Branch:** `feature/mempalace-gap` → merged to master.
**Related:** `docs/roadmap/GAP_ANALYSIS_VS_MEMPALACE.md`

## Goal

Close the gap with mempalace by adding 7 features to memoryjs, extending existing managers (Approach A). Sprint 1 (MUST) and Sprint 2 (SHOULD).

## Non-Goals

- Chat format parsing — users normalize before calling ingest()
- AAAK compression dialect — experimental, regresses benchmarks
- Wing/Room/Closet/Drawer metaphor — MJ entity/relation/observation is more general
- ChromaDB backend — MJ already has JSONL + SQLite

## Feature 1: Temporal KG Convenience Methods

**File:** `src/core/RelationManager.ts` (+~100 lines)

Three new methods using existing `RelationProperties.validFrom/validUntil`:

- `invalidateRelation(from, relationType, to, ended?)` — sets validUntil on matching active relation
- `queryAsOf(entityName, asOf, options?)` — filters relations by validity window at a point in time
- `timeline(entityName, options?)` — all relations sorted chronologically by validFrom

## Feature 2: 4-Layer Memory Stack (wake-up)

**File:** `src/agent/ContextWindowManager.ts` (+~100 lines)

New `wakeUp(options?)` method returning `WakeUpResult { l0, l1, totalTokens, entityCount }`:
- L0 (~100 tokens): identity from ProfileManager.getProfile() static facts
- L1 (~500 tokens): top entities by SalienceEngine score, formatted compactly
- L2/L3: not returned — use existing searchNodes/hybridSearch on demand

## Feature 3: Conversation Ingestion Pipeline

**File:** `src/features/IOManager.ts` (+~200 lines)

New `ingest(input, options?)` accepting format-agnostic `IngestInput { messages[], source?, metadata? }`:
- Chunking: exchange pairs (user+assistant), paragraph, or fixed size
- Entity naming: `{source}-{timestamp}-{index}`
- Observations: verbatim message content prefixed with role
- Dedup: exact match or optional semantic similarity threshold
- DryRun support

## Feature 4: Specialist Agent Diary

**File:** `src/agent/AgentMemoryManager.ts` (+~80 lines)

New methods on the facade:
- `writeDiary(agentId, entry, options?)` — timestamped observation on `diary-{agentId}` entity
- `readDiary(agentId, options?)` — reverse-chronological entries, optional topic filter
- Reserve `diary-*` namespace in EntityManager

## Feature 5: Zero-Config Semantic Search

**Files:** `src/core/ManagerContext.ts` + `src/search/SemanticSearch.ts`

Default `MEMORY_EMBEDDING_PROVIDER` from `none` to `local`. Graceful fallback to `none` if ONNX model unavailable.

## Feature 6: Auto-Save Hooks

**Files:** `hooks/memoryjs_save_hook.sh`, `hooks/memoryjs_precompact_hook.sh`, `hooks/README.md`

Shell scripts calling memoryjs CLI. Not library code — tooling.

## Feature 7: Benchmarking Suite

**Files:** `benchmarks/longmemeval.ts`, `benchmarks/run.ts`, `benchmarks/README.md`

LongMemEval runner comparing JSONL vs SQLite vs semantic search. Reports R@5, R@10, latency.

## Implementation Order

1. Temporal KG (S, 1-2 days)
2. Zero-Config Semantic (S, 1 day)
3. Memory Stack (M, 3-5 days)
4. Ingestion Pipeline (M, 3-5 days)
5. Agent Diary (S, 1-2 days)
6. Auto-Save Hooks (S, 1 day)
7. Benchmarks (L, 1-2 weeks)

## Success Criteria

- No regressions in 5,417 existing tests
- ~80-120 new tests
- Typecheck clean
- LongMemEval benchmark produces reproducible scores
- CHANGELOG updated with v1.9.0
