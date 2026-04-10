# Gap Analysis: MemoryJS vs Supermemory

Updated: 2026-04-08 (source-verified from GitHub repos)

## Executive Summary

**MemoryJS** (`@danielsimonjr/memoryjs`) is a local-first TypeScript knowledge graph library with 29+ managers, 94 MCP tools (via memory-mcp), formal agent memory (sessions, decay, salience, DreamEngine), and 12+ search strategies. It excels at graph algorithms, memory lifecycle management, and offline operation.

**Supermemory** (`supermemory`) is a cloud SaaS monorepo (Turbo + Bun + Cloudflare Workers + PostgreSQL) with auto-maintained user profiles, contradiction-aware memory versioning, semantic forget, external connectors, and multi-SDK middleware integration. It excels at zero-config memory augmentation for conversational AI.

Neither is a superset of the other — they solve different problems at different layers.

---

## Repository Structure Comparison

| Aspect | MemoryJS Ecosystem | Supermemory Ecosystem |
|--------|-------------------|----------------------|
| **Library** | `memoryjs` (single npm package) | `supermemory` (monorepo: apps + packages) |
| **MCP Server** | `memory-mcp` (standalone, 94 tools) | `apps/mcp` in monorepo (6 tools + 2 resources + 1 prompt) |
| **Standalone MCP** | — | `supermemory-mcp` (2 tools + 1 prompt, very thin) |
| **Runtime** | Node.js, local files | Cloudflare Workers, Durable Objects, PostgreSQL |
| **Package Manager** | npm | Bun |
| **Build** | tsup (ESM + CJS) | Vite, tsdown |

### Supermemory Monorepo Contents (source-verified)

**Apps:**
- `web/` — Next.js web dashboard
- `mcp/` — MCP server (Cloudflare Workers + Durable Objects)
- `browser-extension/` — Chrome extension for saving web content
- `raycast-extension/` — Raycast integration
- `memory-graph-playground/` — Interactive graph visualization app

**Packages:**
- `ai-sdk/` — Vercel AI SDK middleware (`withSupermemory()`)
- `openai-sdk-python/` — OpenAI Python SDK integration
- `pipecat-sdk-python/` — Pipecat voice AI framework integration
- `agent-framework-python/` — Python agent framework integration
- `memory-graph/` — React D3 force-directed graph component
- `hooks/` — React hooks for supermemory
- `lib/` — Shared utilities (auth, API client, similarity, PostHog)
- `tools/` — Tool definitions
- `ui/` — Shared UI components
- `validation/` — Zod schemas

---

## MCP Server Comparison (Source-Verified)

### supermemory MCP (apps/mcp) — 6 Tools

| Tool | Description |
|------|-------------|
| `memory` | Save or forget information. `action: "save"\|"forget"`. Forget uses exact match → 0.85 semantic fallback |
| `recall` | Search memories + optional profile. Returns static/dynamic profile + ranked results with similarity % |
| `listProjects` | List available containerTag projects |
| `whoAmI` | Get current user info (userId, email, name, client, sessionId) |
| `memory-graph` | D3 force-directed interactive visualization via `@modelcontextprotocol/ext-apps` |
| `fetch-graph-data` | Pagination helper for graph UI (app-only visibility) |

**Resources:** `supermemory://profile`, `supermemory://projects`
**Prompts:** `context` (system prompt injection with profile + "save memories" instruction)

### supermemory-mcp (standalone) — 2 Tools

| Tool | Description |
|------|-------------|
| `addToSupermemory` | Store content with 2000-memory limit per user |
| `searchSupermemory` | Semantic search scoped by userId containerTag |

**Prompts:** 1 (aggressive "use supermemory proactively" system prompt)

### memory-mcp — 94 Tools (Grouped)

| Category | Count | Examples |
|----------|-------|---------|
| Entity CRUD | 6 | `create_entities`, `delete_entities`, `merge_entities`, `open_nodes` |
| Relation CRUD | 3 | `create_relations`, `delete_relations`, `find_all_paths` |
| Observation CRUD | 4 | `add_observations`, `delete_observations`, `normalize_observations` |
| Search | 12 | `search_nodes`, `fuzzy_search`, `boolean_search`, `semantic_search`, `hybrid_search`, `search_by_time`, `search_auto`, `smart_search`, `search_nodes_ranked`, `query_natural_language` |
| Graph Algorithms | 5 | `find_shortest_path`, `find_all_paths`, `get_centrality`, `get_connected_components` |
| Hierarchy | 6 | `set_entity_parent`, `get_ancestors`, `get_descendants`, `get_children`, `get_subtree`, `move_entity` |
| Tags | 7 | `add_tags`, `remove_tags`, `replace_tag`, `merge_tags`, `add_tag_alias`, `resolve_tag` |
| Import/Export | 2 | `export_graph`, `import_graph` (7 formats) |
| Analytics | 3 | `get_graph_stats`, `validate_graph`, `find_duplicates` |
| Compression | 2 | `compress_graph`, `find_similar_entities` |
| Freshness | 4 | `check_freshness`, `freshness_report`, `get_stale_entities`, `get_expired_entities` |
| Governance | 4 | `governance_transaction`, `audit_history`, `audit_query`, `rollback_operation` |
| Agent Memory | 12 | `start_consolidation`, `stop_consolidation`, `run_consolidation_now`, `compute_entropy`, `enable_entropy_filter`, `set_agent_role`, `list_role_profiles`, `analyze_cognitive_load`, `format_with_salience_budget`, `synthesize_collaborative_context`, `distill_failure`, `configure_distillation` |
| Artifacts | 3 | `create_artifact`, `get_artifact`, `list_artifacts` |
| References | 4 | `register_ref`, `deregister_ref`, `resolve_ref`, `list_refs` |
| Saved Searches | 5 | `save_search`, `execute_saved_search`, `list_saved_searches`, `update_saved_search`, `delete_saved_search` |
| Memory Management | 6 | `set_importance`, `archive_entities`, `refresh_entity`, `adaptive_reduce_memories`, `read_graph`, `analyze_query` |
| Sessions | 2 | `start_consolidation` (scheduler), `end_session` |
| Visibility | 1 | `synthesize_collaborative_context` |

---

## Feature Comparison Matrix (Source-Verified)

| Capability | MemoryJS | Supermemory | Gap Owner |
|-----------|----------|-------------|-----------|
| **Data Model** | Entity/Relation/Observation graph with tags, importance, ttl, confidence | Document → Memory entries with versioning chain (parentMemoryId, rootMemoryId, isLatest, isForgotten) | Different models |
| **Storage** | JSONL + SQLite (local) | PostgreSQL + Cloudflare (cloud) | Different paradigm |
| **Search: Text** | BM25, TF-IDF, Boolean (AND/OR/NOT), Fuzzy (Levenshtein + N-gram), substring | — | **MJ ahead** |
| **Search: Semantic** | Vector similarity (pluggable embedding provider) | Hybrid (memories + document chunks) via Cloudflare AI | Comparable |
| **Search: Hybrid** | Semantic + lexical + symbolic with configurable weights | Memories-first, cascade to chunks, `searchMode: "hybrid"` | MJ more configurable |
| **Search: Temporal** | chrono-node NL parsing → time range filters | — | **MJ ahead** |
| **Search: LLM-planned** | NL → StructuredQuery decomposition via LLMProvider | — | **MJ ahead** |
| **Agent Memory** | Sessions, working/episodic/semantic/procedural, decay, salience, DreamEngine | — | **MJ far ahead** |
| **Multi-agent** | 5-level visibility (private→public), conflict resolution, role profiles | — | **MJ far ahead** |
| **DreamEngine** | 8-phase background maintenance system | — | **MJ unique** |
| **Graph Algorithms** | Dijkstra, PageRank, betweenness/degree centrality, connected components | — | **MJ unique** |
| **Import/Export** | 7 formats (JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid) | — | **MJ unique** |
| **Governance** | Audit log, rollback, GovernancePolicy enforcement | — | **MJ unique** |
| **Entropy Filtering** | Shannon entropy gate for low-information observations | — | **MJ unique** |
| **Cognitive Load** | Token density + redundancy ratio → CognitiveLoadReport | — | **MJ unique** |
| **Distillation** | IDistillationPolicy pipeline (relevance + freshness + dedup) | — | **MJ unique** |
| **Failure Distillation** | Causal chain lesson extraction from failed episodes | — | **MJ unique** |
| **Consolidation** | Background recursive dedup+merge scheduler | — | **MJ unique** |
| **User Profile** | — | Auto-maintained static + dynamic profile (~50ms retrieval) | **SM ahead** |
| **Contradiction Resolution** | — | Memory versioning chain (parentMemoryId, rootMemoryId, isLatest, version) | **SM ahead** |
| **Semantic Forget** | — | Exact match → 0.85 semantic search fallback, only memories (not chunks) deletable | **SM ahead** |
| **Project/Container Scoping** | — | `containerTag` on every operation, `listProjects` tool | **SM ahead** |
| **Interactive Visualization** | Export to DOT/Mermaid/GraphML for external rendering | D3 force-directed graph via `@modelcontextprotocol/ext-apps` in MCP response | **SM ahead** |
| **SDK Integrations** | — | Vercel AI SDK, OpenAI Python SDK, Pipecat (voice AI), Python agent framework | **SM ahead** |
| **Browser Extension** | — | Chrome extension for saving web content as memories | **SM ahead** |
| **Raycast Extension** | — | Raycast app for quick memory add/search | **SM ahead** |
| **React Components** | — | `packages/memory-graph` (D3 graph component), `packages/hooks`, `packages/ui` | **SM ahead** |
| **Memory Deduplication** | CompressionManager.findDuplicates (Levenshtein/Jaccard) | Priority-based dedup (static > dynamic > search) | SM's approach smarter |
| **Analytics/Telemetry** | AnalyticsManager (graph stats, validation) | PostHog event tracking per operation | Different focus |
| **Auth** | None (local library) | OAuth + API key + Better Auth with organizations | N/A (different paradigm) |
| **Benchmarks** | — | MemoryBench (#1 LongMemEval 81.6%) | **SM ahead** |
| **CLI** | `memory` / `memoryjs` binary with entity/relation/observation/search/graph/tag/hierarchy/io/maintenance commands | — | **MJ ahead** |
| **Test Suite** | 4674 tests across 126 files | Unknown | **MJ ahead** |

---

## Gaps: What Supermemory Has That MemoryJS Should Adopt

### Priority 1: HIGH VALUE (Sprint 1)

#### 1. Auto-Maintained User Profile
**What SM does (source-verified)**: `SupermemoryClient.getProfile(query?)` returns `{ static: string[], dynamic: string[] }`. Static = long-lived stable facts. Dynamic = recent episodic context. The profile endpoint on the API auto-extracts these from stored memories — no explicit "save to profile" needed.

**MCP exposure**: `recall` tool with `includeProfile: true` (default), `context` prompt for system injection, `supermemory://profile` resource.

**How to implement in MJ**:
- New `ProfileManager` class extending agent memory
- Auto-extract profile facts from observations using salience + confirmation count
- Static: entities with high importance + low decay rate
- Dynamic: recent session observations above salience threshold
- `getProfile(query?)` returns formatted static + dynamic + optional search results
- New MCP tools: `get_profile`, `update_profile`

**Effort**: M (3-5 days)

---

#### 2. Memory Versioning / Contradiction Resolution
**What SM does (source-verified)**: `DocumentMemoryEntry` has these fields:
```typescript
isLatest?: boolean       // only latest version is active
isForgotten?: boolean    // soft-delete flag
version?: number         // version counter
parentMemoryId?: string  // previous version
rootMemoryId?: string    // original memory in chain
forgetAfter?: string     // scheduled forget date
forgetReason?: string    // why it was forgotten
```

**How to implement in MJ**:
- Add `parentEntityName?`, `rootEntityName?`, `isLatest?`, `supersededBy?`, `version?` to Entity
- New `ContradictionDetector` using semantic similarity on observations
- Auto-create new version when contradicting observation detected
- Search should prefer `isLatest: true` by default
- New MCP tools: `get_entity_versions`, `get_version_chain`

**Effort**: L (1-2 weeks)

---

#### 3. Semantic Forget (Two-Tier Deletion)
**What SM does (source-verified from `client.ts`)**: `forgetMemory(content)`:
1. Try `client.memories.forget({ content, containerTag })` (exact match)
2. If 404, fall back to `search(content, 5, 0.85)` — semantic search at 0.85 threshold
3. Filter: only `"memory" in r` (not document chunks) can be deleted
4. Delete via `client.memories.forget({ id, containerTag })`

**How to implement in MJ**:
- New `forgetByContent(content: string, threshold?: number)` on EntityManager
- Step 1: Exact observation match across all entities
- Step 2: If no match, SemanticSearch with threshold (default 0.85)
- Step 3: Delete matching observations (or entire entity if all observations match)
- Audit log the deletion
- New MCP tool: `forget_memory`

**Effort**: M (3-5 days)

---

#### 4. Project/Container Scoping
**What SM does (source-verified)**: Every API call accepts `containerTag: string`. The MCP server supports an optional root `containerTag` from props plus per-call override. `listProjects` returns available containerTags.

**How to implement in MJ**:
- Add optional `projectId?: string` to Entity
- Add `projectScope?: string` parameter to all search methods
- `ManagerContext` accepts optional `defaultProject` at construction
- Storage: JSONL filters by projectId; SQLite adds indexed column
- New MCP tools: `list_projects`, `set_project_scope`

**Effort**: L (1-2 weeks)

---

### Priority 2: MEDIUM VALUE (Sprint 2)

#### 5. Interactive Graph Visualization (MCP App)
**What SM does (source-verified)**: Uses `@modelcontextprotocol/ext-apps` to register an HTML app resource (`mcp-app.html`) and a tool (`memory-graph`) that returns structured data. The HTML renders a D3 force-directed graph with documents as rectangles and memories as hexagons. `fetch-graph-data` provides pagination.

**How to implement in MJ**:
- Create self-contained HTML visualization using D3 or vis.js
- Use `@modelcontextprotocol/ext-apps` if targeting MCP clients that support it
- Alternatively, output inline SVG or generate a local HTML file
- New MCP tool: `visualize_graph`

**Effort**: M (3-5 days)

---

#### 6. Smart Memory Deduplication (Priority-Based)
**Current MJ approach**: `CompressionManager.findDuplicates()` uses Levenshtein/Jaccard similarity.
**SM approach**: Priority system where static memories > dynamic > search results.

**How to improve MJ**:
- Extend `CompressionManager` with `priorityDedup(memories, priorities)`
- Priority weights: importance > confirmation count > recency > access frequency
- Integrate into DistillationPipeline

**Effort**: S (1-2 days)

---

### Priority 3: NICE-TO-HAVE (Sprint 3)

#### 7. LLM Middleware / SDK Integrations
**What SM has (source-verified, 6+ integrations)**:
- `packages/ai-sdk/` — `withSupermemory()` wraps Vercel AI SDK models
- `packages/tools/` — OpenAI function-calling tools, Mastra processors, Claude Memory Tool adapter
- `packages/openai-sdk-python/` — OpenAI Python SDK integration
- `packages/pipecat-sdk-python/` — Voice AI framework (Pipecat) integration
- `packages/agent-framework-python/` — Microsoft Agent Framework integration
- Planned: LangChain, LangGraph, OpenAI Agents SDK, Agno, n8n

**SM middleware modes**: `profile` (inject profile), `query` (search per message), `full` (both).
**SM storage modes**: `always` (auto-save conversations), `never` (read-only).

**How to implement for MJ**:
- New `@danielsimonjr/memoryjs-ai-sdk` package
- `withMemoryJS(model, contextPath, opts)` middleware
- On generate: fetch relevant memories via HybridSearchManager
- On complete: optionally extract and store new facts
- Start with Vercel AI SDK, then OpenAI

**Effort**: L (1-2 weeks per SDK)

---

#### 8. External Connector Framework
**What SM has**: Google Drive, Gmail, Notion, OneDrive, GitHub, S3 connectors with webhook-based incremental sync.

**How to implement in MJ**: Plugin architecture for ingestion connectors. Out of scope for core library; better suited as separate packages or MCP tools.

**Effort**: XL (3+ weeks per connector)

---

#### 9. Memory Benchmarking
**What SM has**: MemoryBench framework, #1 on LongMemEval (81.6%).

**How to implement in MJ**: Create benchmark suite testing recall accuracy, latency, context relevance.

**Effort**: L (1-2 weeks)

---

#### 10. Client-Side Components
**What SM has (source-verified)**:
- `packages/memory-graph/` — React D3 graph component (canvas rendering, hooks, components)
- `packages/hooks/` — React hooks for supermemory
- `packages/ui/` — Shared UI component library
- `apps/browser-extension/` — Chrome extension
- `apps/raycast-extension/` — Raycast app

**MJ assessment**: These are product-level concerns, not library concerns. Could be built as separate packages if needed.

**Effort**: XL (per component)

---

## Reverse Gaps: What MemoryJS Has That Supermemory Lacks

These are memoryjs strengths to preserve and emphasize:

| Feature | MJ Advantage | SM Status |
|---------|-------------|-----------|
| **94 MCP tools** (vs SM's 6) | Granular control over every graph operation | SM abstracts behind simple memory/recall |
| **12+ search strategies** | BM25, TF-IDF, Boolean, Fuzzy, N-gram, Hybrid, Temporal, LLM-planned, Semantic, Ranked, Auto, Smart | SM has hybrid only |
| **Graph algorithms** | Dijkstra, PageRank, centrality, connected components, path finding | SM has none |
| **Formal agent memory** | Sessions, working/episodic/semantic/procedural memory types, decay, salience | SM has none |
| **Multi-agent** | 5-level visibility, conflict resolution, role profiles, collaborative synthesis | SM has containerTag only |
| **DreamEngine** | 8-phase background maintenance | SM has none |
| **Import/Export** | 7 formats (JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid) | SM has none |
| **Governance** | Immutable audit log, rollback, policy enforcement | SM has none |
| **Entropy filtering** | Shannon entropy gate drops low-information observations | SM has none |
| **Cognitive load analysis** | Token density + redundancy metrics | SM has none |
| **Distillation pipeline** | Relevance + freshness + dedup policy chain | SM has none |
| **Failure distillation** | Causal chain lesson extraction from failed episodes | SM has none |
| **Consolidation scheduler** | Background recursive dedup+merge to fixed point | SM has none |
| **CLI** | Full-featured `memory` binary with 10+ command groups | SM has none |
| **Dual storage backends** | JSONL (human-readable) + SQLite (FTS5, ACID) | PostgreSQL only |
| **Offline/local-first** | Works without network, no cloud dependency | Requires cloud API |
| **Test suite** | 4674 tests across 126 files | Unknown coverage |
| **Observation normalization** | Pronoun resolution, relative date anchoring | SM has none |
| **Named references** | RefIndex for O(1) stable-name lookups | SM has none |
| **Tag system** | Tag aliases, merge, resolution | SM has containerTag only |
| **Hierarchy** | Parent/child tree with ancestors/descendants/subtree queries | SM has flat structure |
| **Worker pool** | CPU-intensive operations (Levenshtein) offloaded to workers | N/A (cloud) |

---

## Recommended Implementation Order

| # | Feature | Effort | Value | Priority | Status |
|---|---------|--------|-------|----------|--------|
| 1 | Auto-Maintained User Profile | M | High | **MUST** | ✅ v1.8.0 |
| 2 | Semantic Forget (Two-Tier Deletion) | M | High | **MUST** | ✅ v1.8.0 |
| 3 | Memory Versioning / Contradiction Resolution | L | High | **MUST** | ✅ v1.8.0 |
| 4 | Project/Container Scoping | L | High | **MUST** | ✅ v1.8.0 |
| 5 | Interactive Graph Visualization | M | Medium | **SHOULD** | Not started |
| 6 | Smart Memory Deduplication (Priority-Based) | S | Medium | **SHOULD** | Not started |
| 7 | LLM Middleware Integration (Vercel AI SDK) | L | Medium | **COULD** | Not started |
| 8 | External Connector Framework | XL | Medium | **COULD** | Not started |
| 9 | Memory Benchmarking | L | Low | **COULD** | Not started |
| 10 | Client-Side Components | XL | Low | **WON'T** | Out of scope |

**Sprint 1** (MUST, ~3 weeks): Profile, Semantic Forget, Versioning, Project Scoping
**Sprint 2** (SHOULD, ~1 week): Priority Dedup, Graph Visualization
**Sprint 3** (COULD, ~3 weeks): LLM Middleware, Connectors, Benchmarks

---

## What NOT to Adopt

| SM Feature | Why Skip |
|------------|----------|
| Cloud hosting / PostgreSQL | MJ is local-first by design |
| OAuth / API key auth | Not needed for a library |
| PostHog analytics | Privacy concern; MJ has AnalyticsManager |
| Cloudflare Workers / Durable Objects | Infrastructure-specific |
| Browser extension / Raycast | Product-level, not library concern |
| Better Auth / organizations | MJ handles multi-agent via visibility model |
| React hooks / UI components | MJ is a headless library |

---

## Key Observations from Source Review

1. **supermemory-mcp (standalone)** is essentially a thin demo — just 2 tools with a 2000-memory hard limit. The real MCP implementation is `apps/mcp` in the monorepo.

2. **Supermemory's "intelligence" is server-side**: Profile auto-maintenance, dedup, contradiction resolution all happen in the Supermemory API, not in the MCP or SDK. MJ would need to implement these in the library itself.

3. **The memory versioning chain** (`parentMemoryId → rootMemoryId`) is a first-class data model concept in SM, not an add-on. Implementing this in MJ requires Entity model changes.

4. **SM's `context` prompt** is aggressive about auto-saving: it instructs the LLM to "automatically store new information after EVERY user message." This is a UX pattern, not a technical feature — MJ could adopt this as an MCP prompt without code changes.

5. **SDK breadth is SM's moat for developers**: Vercel AI SDK + OpenAI tools + Mastra + Claude Memory Tool + OpenAI Python + Pipecat voice + MS Agent Framework = **6+ integration points** MJ doesn't cover. However, these all depend on the cloud API.

6. **Scheduled forgetting** (`forgetAfter` field): SM supports automatic time-based memory expiry — the memory is soft-deleted after a date. MJ has `FreshnessManager` with TTL-based staleness detection but doesn't auto-delete. This is a small but meaningful gap.

7. **memory-mcp tool count discrepancy**: The published GitHub version has ~59 tools; the local development version (feature/must-have-8 branch) has 94 tools. The gap analysis uses the 94-tool count reflecting current development state.

6. **MJ's moat is depth**: 94 tools, 12 search types, graph algorithms, governance, agent memory. SM can't match this without fundamentally changing from a SaaS API to a library.
