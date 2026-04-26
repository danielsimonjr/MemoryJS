# Gap Analysis: MemoryJS vs MemPalace

Originally generated: 2026-04-09 (source-verified from GitHub)
**Last refreshed: 2026-04-25** — MemoryJS now at v1.14.0 + Unreleased.

## Executive Summary

**MemoryJS** (v1.14.0 + Unreleased; was v1.8.0 at original write-up) is a TypeScript knowledge graph library with 40+ managers, 94 MCP tools (via memory-mcp), formal agent memory (sessions, decay, salience, DreamEngine), 12+ search strategies, dual storage backends (JSONL + SQLite), pluggable IMemoryBackend (in-memory + SQLite), four-tier conversation-turn dedup (MemoryEngine), bitemporal versioning (η.4.4), causal reasoning (3B.6), procedural memory (3B.4), world-model orchestration (3B.7), active iterative retrieval (3B.5), RBAC (η.6.1), PII redaction (η.6.3), W3C Linked-Data export (η.5.4), and full multi-agent collaboration primitives (η.5.5).

> **Status of original MUST/SHOULD items** — see the closing roadmap table at line 270; items 1–5 (4-layer memory stack, ingestion pipeline, temporal KG convenience methods, agent diary, auto-save hooks) ✅ shipped in v1.9.0. Subsequent gaps closed via v1.10–Unreleased work.

**MemPalace** (v3.1.0) is a Python AI memory system using ChromaDB with a spatial "memory palace" metaphor (wings → rooms → closets → drawers). It stores verbatim conversations, uses a 4-layer memory stack for context loading (~170 tokens wake-up), has a temporal knowledge graph (SQLite), and includes an experimental AAAK compression dialect. It excels at zero-API-key operation, conversation mining, and benchmark performance (96.6% LongMemEval R@5).

Neither is a superset of the other — they solve the same problem from fundamentally different angles.

---

## Architecture Comparison

| Aspect | MemoryJS | MemPalace |
|--------|----------|-----------|
| **Language** | TypeScript | Python |
| **Storage** | JSONL + SQLite (dual backend) | ChromaDB (vector) + SQLite (KG) |
| **Data Model** | Entity/Relation/Observation graph | Wings/Rooms/Closets/Drawers + KG triples |
| **Version** | v1.8.0 | v3.1.0 |
| **Package** | npm: `@danielsimonjr/memoryjs` | PyPI: `mempalace` |
| **MCP Server** | Separate repo (memory-mcp, 94 tools) | Built-in (mcp_server.py, 19 tools) |
| **Dependencies** | better-sqlite3, async-mutex, Zod | chromadb, pyyaml |
| **Embedding** | Pluggable (OpenAI, local ONNX, none) | ChromaDB built-in (all-MiniLM-L6-v2) |
| **API Key Required** | Optional (for semantic search) | Never |
| **CLI** | `memory` / `memoryjs` | `mempalace` |
| **Plugin System** | Claude Code plugin (.claude-plugin) | Claude Code plugin + Codex plugin |

---

## Feature Comparison Matrix

| Capability | MemoryJS | MemPalace | Gap |
|-----------|----------|-----------|-----|
| **Search: Semantic** | Vector similarity (optional provider) | ChromaDB semantic (always-on, no API key) | **MP ahead** (zero-config) |
| **Search: Text** | BM25, TF-IDF, Boolean, Fuzzy, N-gram | — | **MJ ahead** |
| **Search: Temporal** | chrono-node NL parsing, searchByTime | — | **MJ ahead** |
| **Search: LLM-planned** | NL → StructuredQuery decomposition | — | **MJ ahead** |
| **Search: Hybrid** | Semantic + lexical + symbolic weights | Wing/room metadata filtering | MJ more configurable |
| **Memory Stack** | — | 4-layer (L0 identity ~100tok, L1 essential ~500tok, L2 on-demand, L3 deep search) | **MP ahead** |
| **Wake-up Context** | — | ~170 tokens loads identity + critical facts | **MP ahead** |
| **Spatial Organization** | Tags + hierarchy (parent/child) | Wings → Halls → Rooms → Closets → Drawers + Tunnels (cross-wing) | **MP ahead** (richer metaphor) |
| **Conversation Mining** | — | 5 chat format normalizer + convo/project/general modes | **MP ahead** |
| **AAAK Compression** | — | Lossy abbreviation dialect for token density (experimental, 84.2% vs 96.6% raw) | **MP unique** |
| **Knowledge Graph** | Entity/Relation/Observation (primary model) | Temporal triples (subject→predicate→object) with validity windows | Different models |
| **Temporal Validity** | — | `valid_from`/`valid_to` on triples, `invalidate()`, `as_of` queries, `timeline()` | **MP ahead** |
| **Agent Memory** | Sessions, working/episodic/semantic/procedural, decay, salience, DreamEngine | — | **MJ far ahead** |
| **Specialist Agents** | — | Agent diaries (AAAK), per-agent wings, focus areas | **MP ahead** |
| **Multi-agent** | 5-level visibility, conflict resolution, role profiles | — | **MJ far ahead** |
| **User Profile** | ProfileManager (static/dynamic facts, auto-extract) | Identity file (L0, ~100 tokens) | MJ more automated |
| **Project Scoping** | `projectId` on Entity, SearchFilterChain | Wings (per-project or per-person) | Comparable |
| **Memory Versioning** | ContradictionDetector, version chains, supersede | — (fact_checker.py exists but not wired into KG) | **MJ ahead** |
| **Semantic Forget** | SemanticForget (exact + 0.85 semantic fallback) | — | **MJ ahead** |
| **Graph Algorithms** | Dijkstra, PageRank, centrality, connected components | Graph traversal (rooms → tunnels), find_tunnels | **MJ ahead** |
| **Import/Export** | 7 formats (JSON, CSV, GraphML, GEXF, DOT, MD, Mermaid) | — | **MJ unique** |
| **Governance** | Audit log, rollback, GovernancePolicy | — | **MJ unique** |
| **DreamEngine** | 8-phase background maintenance | — | **MJ unique** |
| **Entropy Filtering** | Shannon entropy gate | — | **MJ unique** |
| **Cognitive Load** | Token density + redundancy metrics | — | **MJ unique** |
| **Distillation** | IDistillationPolicy pipeline | — | **MJ unique** |
| **Consolidation** | Background recursive dedup+merge scheduler | — | **MJ unique** |
| **Auto-Save Hooks** | — | Stop hook (every 15 msgs) + PreCompact hook | **MP ahead** |
| **Mega-File Splitting** | — | `mempalace split` for concatenated transcripts | **MP ahead** |
| **Benchmarks** | — | 96.6% LongMemEval R@5 (raw), 100% with Haiku rerank | **MP ahead** |
| **Duplicate Detection** | CompressionManager.findDuplicates | `mempalace_check_duplicate` MCP tool | Comparable |
| **Observation Normalization** | Pronoun resolution, relative date anchoring | — | **MJ ahead** |
| **Named References** | RefIndex for O(1) stable-name lookups | — | **MJ unique** |
| **Worker Pool** | CPU-intensive ops offloaded to workers | — | **MJ unique** |
| **Test Suite** | 5,417 tests across 168 files | pytest (85% coverage threshold) | **MJ ahead** |
| **MCP Tool Count** | 94 (via memory-mcp) | 19 (built-in) | **MJ ahead** |

---

## Gaps: What MemPalace Has That MemoryJS Should Adopt

### Priority 1: HIGH VALUE

#### 1. 4-Layer Memory Stack with Token-Budget Wake-up
**What MP does**: `MemoryStack` class with:
- **L0** (~100 tokens): Identity text loaded every session
- **L1** (~500-800 tokens): Auto-generated from top drawers, grouped by room
- **L2** (on-demand): Wing/room filtered retrieval when topics come up
- **L3** (unlimited): Full semantic search

Wake-up cost: ~170 tokens for L0+L1, leaving 95%+ of context free.

**Why it matters**: This is the most efficient context loading pattern for LLMs. MemoryJS has `ContextWindowManager` and `MemoryFormatter` but no structured layer system. The "wake-up" concept is powerful — load only critical facts by default, search on demand.

**How to implement in MJ**: New `MemoryStack` class in `src/agent/` that:
- L0: Read from profile entity (`[static]` facts → identity)
- L1: Top-N entities by salience score, formatted compactly
- L2: Project-scoped retrieval via `searchNodes` with projectId filter
- L3: Full hybrid search
- `wakeUp(options?)` method returns L0+L1 in ~200 tokens
- Wire into `ContextWindowManager` as a retrieval strategy

**Effort**: M (3-5 days)

---

#### 2. Conversation Mining / Ingestion Pipeline
**What MP does**: Three mining modes:
- `mine <dir>` — project files (code, docs, notes)
- `mine <dir> --mode convos` — conversation exports from Claude, ChatGPT, Slack (5 format normalizer in `normalize.py`)
- `mine <dir> --mode convos --extract general` — auto-classifies into decisions, milestones, problems, preferences, emotional context

Normalizes 5 chat formats: Claude JSON, Claude MD/XML, ChatGPT JSON, Slack JSON, generic markdown.

**Why it matters**: Getting data INTO the memory system is the biggest adoption barrier. MemoryJS has `IOManager` for import/export but no content ingestion pipeline. Users must manually create entities. MP's `mine` command handles the whole pipeline.

**How to implement in MJ**: New `IngestManager` in `src/features/` that:
- Accepts file/directory paths
- Auto-detects format (Claude, ChatGPT, Slack, markdown, code)
- Chunks content into entity-sized pieces
- Creates entities with appropriate types, tags, observations
- Assigns projectId from source path or --wing flag
- Supports incremental re-mining (skip already-ingested files via hash tracking)

**Effort**: L (1-2 weeks)

---

#### 3. Temporal Knowledge Graph with Validity Windows
**What MP does**: SQLite-based triple store with:
- `add_triple(subject, predicate, object, valid_from, valid_to, confidence, source_closet)`
- `invalidate(subject, predicate, object, ended)` — marks facts as no longer true
- `query_entity(name, as_of="2026-01-15")` — time-travel queries
- `timeline(entity)` — chronological fact story
- Auto-creates entity nodes on triple insert
- Foreign key relationships between entities and triples

**Why it matters**: MemoryJS has Relations with optional `validFrom`/`validUntil` in `RelationProperties`, but no `as_of` time-travel queries, no `invalidate()` convenience method, and no `timeline()` view. MP's temporal model is simpler but more usable.

**How to implement in MJ**: MemoryJS already has the foundation:
- `Relation.properties.validFrom` / `validUntil` exist
- `TemporalSearch` with chrono-node exists
- Need: `invalidateRelation(from, relationType, to, ended?)` convenience method
- Need: `queryAsOf(entityName, date)` — filter relations by validity window
- Need: `timeline(entityName)` — chronological relation history
- These are thin wrappers over existing infrastructure

**Effort**: S (1-2 days)

---

#### 4. Specialist Agent Diary System
**What MP does**: JSON-defined agents with:
- Focus areas (what to pay attention to)
- AAAK-encoded diary (persists across sessions)
- Per-agent wing in the palace
- `mempalace_diary_write(agent, entry)` and `mempalace_diary_read(agent, last_n)` MCP tools
- Agents discover themselves at runtime from `~/.mempalace/agents/`

**Why it matters**: MemoryJS has `AgentMemoryManager` with multi-agent support (5-level visibility, conflict resolution, role profiles) — but no persistent per-agent diary/journal. The diary pattern is lightweight and useful for agent specialization.

**How to implement in MJ**: Extend the existing agent memory system:
- New `AgentDiary` class wrapping a dedicated Entity per agent (`diary-{agentId}`)
- `write(content, tags?)` appends an observation with timestamp
- `read(lastN)` returns recent observations
- Integrate with `AgentMemoryManager` alongside `ProfileManager`
- Wire into existing multi-agent visibility model

**Effort**: S (1-2 days)

---

### Priority 2: MEDIUM VALUE

#### 5. Auto-Save Hooks for Claude Code
**What MP does**: Two shell hooks:
- **Stop hook** (every 15 messages): structured save of topics, decisions, quotes, code changes; regenerates L1 critical facts
- **PreCompact hook**: emergency save before context compression

Configured via Claude Code's `hooks` settings.

**Why it matters**: MemoryJS doesn't auto-save during sessions. Users must explicitly call save operations. MP's hooks ensure nothing is lost, even during context compression.

**How to implement in MJ**: Shell script hooks + a new `AutoSaveManager`:
- `mempal_save_hook.sh` equivalent that calls `memoryjs` CLI to save current session observations
- `mempal_precompact_hook.sh` equivalent for emergency saves
- Document hook setup in README

**Effort**: S (1-2 days)

---

#### 6. Benchmarking Suite (LongMemEval, LoCoMo)
**What MP does**: Reproducible benchmark runners in `benchmarks/`:
- `longmemeval_bench.py` — 500-question LongMemEval (R@5 metric)
- `locomo_bench.py` — LoCoMo benchmark
- `membench_bench.py` — Custom MemBench
- Published results: 96.6% R@5 (raw), 100% with Haiku rerank

**Why it matters**: No credible memory system ships without benchmarks. MP's 96.6% LongMemEval result is their strongest marketing asset. MemoryJS has no published benchmarks.

**How to implement in MJ**: Port the benchmark runners to TypeScript:
- LongMemEval runner using MemoryJS's search stack
- Compare raw JSONL vs SQLite FTS5 vs semantic search
- Publish results alongside MP's for direct comparison

**Effort**: L (1-2 weeks)

---

#### 7. Zero-Config Semantic Search (No API Key)
**What MP does**: ChromaDB includes `all-MiniLM-L6-v2` embeddings by default — semantic search works out of the box with zero configuration.

**What MJ does**: Semantic search requires `MEMORY_EMBEDDING_PROVIDER=openai` + an API key, or `local` + ONNX runtime. Without configuration, semantic search is unavailable.

**How to improve MJ**: Make the `local` embedding provider the default (no API key required). ChromaDB bundles the model; MemoryJS could do the same with the ONNX provider. Change `MEMORY_EMBEDDING_PROVIDER` default from `none` to `local`.

**Effort**: S (1-2 days, mainly config + testing)

---

### Priority 3: NICE-TO-HAVE

#### 8. AAAK-style Compression for Context Loading
**What MP does**: Lossy abbreviation dialect that encodes repeated entities as short codes. Experimental; currently regresses benchmark scores (84.2% vs 96.6%).

**MJ assessment**: MemoryJS has `ContextWindowManager` with token budgeting and `MemoryFormatter.formatWithSalienceBudget()`. These handle context compression via selection (salience-based), not encoding. AAAK-style encoding is orthogonal and could be added as a `ContextFormatter` plugin, but the regression vs. raw mode makes this low priority.

**Effort**: M (3-5 days, mostly R&D on whether it helps)

---

#### 9. File Splitting for Mega-Transcripts
**What MP does**: `mempalace split <dir>` splits concatenated multi-session transcripts into per-session files using delimiter detection.

**MJ assessment**: MemoryJS's `tools/chunking-for-files` already handles large file splitting/merging. The specific conversation-splitting logic could be added as a tool or integrated into the IngestManager (Priority 1.2).

**Effort**: S (1-2 days)

---

## Reverse Gaps: What MemoryJS Has That MemPalace Lacks

| Feature | MJ Advantage |
|---------|-------------|
| **12+ search strategies** | BM25, TF-IDF, Boolean, Fuzzy, N-gram, Hybrid, Temporal, LLM-planned | MP has semantic only |
| **Formal agent memory** | Sessions, working/episodic/semantic/procedural types, decay, salience | MP has none |
| **DreamEngine** | 8-phase background maintenance | MP has none |
| **Memory versioning** | ContradictionDetector, version chains, supersede | MP has unfinished fact_checker |
| **Semantic forget** | Two-tier deletion (exact → semantic) | MP has no forget |
| **Graph algorithms** | Dijkstra, PageRank, centrality, connected components | MP has basic traversal only |
| **Import/Export** | 7 formats (JSON, CSV, GraphML, GEXF, DOT, MD, Mermaid) | MP has none |
| **Governance** | Audit log, rollback, GovernancePolicy enforcement | MP has none |
| **Entropy filtering** | Shannon entropy gate for low-info observations | MP has none |
| **Cognitive load** | Token density + redundancy metrics | MP has none |
| **Distillation pipeline** | Relevance + freshness + dedup policy chain | MP has none |
| **Consolidation scheduler** | Background recursive dedup+merge to fixed point | MP has none |
| **User profile** | ProfileManager with static/dynamic auto-extraction | MP has identity.txt (manual) |
| **Project scoping** | projectId on Entity, SearchFilterChain filter | MP has wings (similar concept) |
| **Dual storage backends** | JSONL (human-readable) + SQLite (FTS5, ACID) | MP has ChromaDB only |
| **Named references** | RefIndex for O(1) stable-name lookups | MP has none |
| **Observation normalization** | Pronoun resolution, relative date anchoring | MP has none |
| **Worker pool** | CPU-intensive ops offloaded to workers | MP has none |
| **94 MCP tools** vs 19 | Granular control over every graph operation | MP has 19 coarse tools |
| **5,417 tests** | Comprehensive test suite | MP has ~85% coverage target |
| **TypeScript** | Type safety, IDE support, compile-time checks | Python (runtime types) |

---

## Recommended Implementation Order

| # | Feature | Effort | Value | Priority | Status |
|---|---------|--------|-------|----------|--------|
| 1 | 4-Layer Memory Stack (wake-up) | M | High | **MUST** | ✅ v1.9.0 |
| 2 | Conversation Mining / Ingestion Pipeline | L | High | **MUST** | ✅ v1.9.0 |
| 3 | Temporal KG Convenience Methods (invalidate, asOf, timeline) | S | High | **MUST** | ✅ v1.9.0 |
| 4 | Specialist Agent Diary System | S | High | **SHOULD** | ✅ v1.9.0 |
| 5 | Auto-Save Hooks | S | Medium | **SHOULD** | ✅ v1.9.0 |
| 6 | Benchmarking Suite (LongMemEval) | L | Medium | **SHOULD** | Not started |
| 7 | Zero-Config Semantic Search (default local embeddings) | S | Medium | **SHOULD** | ✅ v1.9.0 |
| 8 | AAAK-style Compression | M | Low | **COULD** | ✅ v1.9.0 (as compressForContext) |
| 9 | Mega-File Splitting | S | Low | **COULD** | ✅ v1.9.0 (as splitTranscript) |

**Sprint 1** (MUST, ~2-3 weeks): Memory Stack, Ingestion Pipeline, Temporal KG Methods
**Sprint 2** (SHOULD, ~2 weeks): Agent Diary, Auto-Save Hooks, Benchmarks, Zero-Config Semantic
**Sprint 3** (COULD, ~1 week): AAAK Compression, File Splitting

---

## Key Observations

1. **Different paradigms, complementary strengths**: MemPalace is conversation-centric (mine → store verbatim → search). MemoryJS is graph-centric (create entities → relate → search). Neither replaces the other — they serve different workflows.

2. **MemPalace's 96.6% LongMemEval is from ChromaDB raw mode** — not from the palace structure, AAAK, or any custom retrieval logic. The "palace" adds +34% over unfiltered search via metadata filtering (standard ChromaDB feature). MemoryJS with the same embedding model and ChromaDB-equivalent search should achieve comparable results.

3. **AAAK is experimental and regresses benchmarks** — 84.2% vs 96.6% raw. The compression dialect is an interesting R&D direction but not a competitive threat until it actually improves recall.

4. **MemPalace's temporal KG is a thin SQLite wrapper** — 400 lines total. MemoryJS has a much richer graph model but lacks the convenience methods (`as_of`, `invalidate`, `timeline`). These are trivially implementable.

5. **Conversation mining is MP's biggest practical advantage** — MemPalace can ingest Claude, ChatGPT, Slack exports in one command. MemoryJS requires manual entity creation. Adding an ingestion pipeline would dramatically improve adoption.

6. **The 4-layer memory stack is a UX innovation, not a technical one** — The idea of loading ~170 tokens on wake-up and searching on demand is a prompt engineering pattern, not a library feature. But packaging it as a first-class API (`stack.wake_up()`) is valuable.

7. **MemPalace has no graph algorithms, governance, agent memory, or versioning** — These are MemoryJS's deep advantages and represent months of work that MP would need to replicate.

---

## What NOT to Adopt

| MP Feature | Why Skip |
|------------|----------|
| ChromaDB as storage | MJ already has JSONL + SQLite; adding a third backend adds complexity without clear benefit |
| AAAK dialect (for now) | Experimental, regresses benchmarks. Monitor but don't implement yet |
| Wing/Room/Closet/Drawer metaphor | MJ's entity/relation/observation model is more general; wings ≈ projectId, rooms ≈ tags |
| Python implementation | MJ is TypeScript; cross-language porting doesn't make sense |
| Identity.txt file | MJ's ProfileManager (v1.8.0) is more sophisticated |
| `mempalace init` onboarding wizard | Nice UX but product-level, not library-level |
