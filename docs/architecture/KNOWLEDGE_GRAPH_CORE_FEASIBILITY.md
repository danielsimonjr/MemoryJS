# Feasibility: Making the Knowledge Graph the Core of MemoryJS

**Status:** Assessment (2026-07-23)
**Scope:** Evaluates whether the Entity/Relation knowledge graph can — and should — become the architectural core of the library, and what that would take.

---

## Verdict

**Feasible, and mostly already true at the storage layer — but not at the computational layer.** The realistic path is not a rewrite; it is closing four specific gaps where subsystems bypass or degrade the graph. Two of those gaps are cheap, two are expensive, and one prerequisite (stable entity identity) gates everything else.

---

## 1. Where the library already is graph-core

The claim "knowledge graph library" is genuinely true for persistence and for most of the feature surface:

- **Data model.** The model (`src/types/types.ts`) is entity/relation/observation, and `KnowledgeGraph` is the universal interchange type across managers.
- **Relations are first-class in both backends.** SQLite has a dedicated `relations` table with indexes on `fromEntity`, `toEntity`, `relationType`, `weight`, and `confidence` (`src/core/SQLiteStorage.ts`). The JSONL backend maintains an in-memory `RelationIndex` keyed by `from:to:relationType` alongside `NameIndex`/`TypeIndex`/`ObservationIndex` (`src/core/GraphStorage.ts`).
- **Broad manager coupling.** 13 of 18 `src/features` modules and roughly half of `src/agent` (40 of 79 files) read and write through `EntityManager`/`RelationManager`/storage.
- **Derived indexes are views, not bypasses.** The TF-IDF sidecar (`TFIDFIndexManager` + `TFIDFEventSync`), vector store, and inverted index are materialized views kept in sync via `GraphEventEmitter` — they serve graph centrality rather than undermining it.

The feasibility question is therefore: *can the parts that currently ignore or abuse the graph be brought onto it?*

---

## 2. Gap analysis

### Gap 1 — Search treats the graph as a flat text corpus
*Moderate cost, high payoff.*

No module in `src/search` (48 files, ~15k LOC) imports `GraphTraversal`. Relations are only *projected*: `BasicSearch` and `BooleanSearch` filter entities by text, then keep whichever relations happen to have surviving endpoints. `SemanticSearch.entityToText()` embeds name + type + observations and discards edges entirely. Ranking never uses connectivity, despite PageRank and centrality already existing in `src/core/GraphTraversal.ts` (1,183 lines, currently used by only three experimental agent modules: `CausalReasoner`, `CollaborativeSynthesis`, `MemoryGraphBridge`).

**Closing it:** add a graph-signal channel to `HybridScorer` — e.g. precomputed PageRank as a static rank prior, and one-hop neighborhood expansion of results. Additive work, no breaking changes. This is the single change that would most visibly justify "the graph is the core."

### Gap 2 — Salience and decay ignore edges
*Low cost.*

`SalienceEngine` scores by importance/recency/frequency/text-context only (`src/agent/SalienceEngine.ts`); `DecayEngine` touches relations only to delete dangling ones when forgetting entities. Neither uses connectivity as a signal.

**Closing it:** a connectivity term (degree or PageRank) in the salience weighted sum, and decay protection for well-connected entities. The existing env-var weight pattern (`MEMORY_SALIENCE_*_WEIGHT`) already accommodates a new signal.

### Gap 3 — Structured data smuggled as JSON blobs inside observation strings
*Moderate cost, migration risk.*

Several agent managers use the graph as an opaque document store:

| Module | Encoding |
|---|---|
| `src/agent/procedural/ProcedureStore.ts` | `[procedure-steps]:` / `[procedure-meta]:` JSON sentinel observations |
| `src/agent/WorkThreadManager.ts` | entire thread serialized as one `JSON.stringify` observation |
| `src/agent/SessionCheckpoint.ts` | `[CHECKPOINT] {json}` observations |
| `src/agent/ProfileManager.ts` | `[static]` / `[dynamic]` prefix-tagged observations |
| `src/agent/ProjectContextManager.ts`, `src/agent/ToolAffordanceManager.ts` | entity-name prefixes (`project-context-`, `tool-affordance-`) as namespaces |

None of this content is queryable, traversable, or indexable as graph content — the opposite of graph-core.

**Closing it:** decompose the blobs into real entities and relations (a procedure's steps become nodes linked by `precedes` edges, etc.), with a data migration per manager. This is where "graph as core" costs real engineering, but it can proceed manager-by-manager. `ProcedureStore` is the natural first target — its own header acknowledges the debt.

### Gap 4 — Two parallel data models bypass the graph entirely
*Highest cost — decide, don't necessarily merge.*

- **`InMemoryBackend`** (`src/agent/InMemoryBackend.ts`) keeps its own `Map<sessionId, MemoryTurn[]>` independent of the graph. (The SQLite backend does route through `MemoryEngine`.)
- **`CueTagContentGraph`** (`src/agent/reconstruction/`) is a complete second graph model with its own internal maps, only *optionally* mirrored into the entity graph via `MemoryGraphBridge`.

Full unification of the CTC graph onto Entity/Relation is possible in principle (cues/tags/contents as typed entities) but would sacrifice its O(1) mapping operators and complicate a research-grade `@experimental` module for purity's sake.

**Pragmatic graph-core position:** keep CTC as a specialized in-memory index, but make bridge persistence the default contract (which `ctx.reconstructiveMemory()` already does) rather than optional. Define `InMemoryBackend` as an explicitly ephemeral store for tests and short-lived processes.

---

## 3. The gating prerequisite: entity identity

The single biggest structural obstacle is that **entity name is the primary key**. Relations store `from`/`to` as name strings; there is no entity id and no `renameEntity` primitive anywhere in core. `RefIndex` (`src/core/RefIndex.ts`) exists specifically to paper over this, and `src/agent/SQLiteBackend.ts` notes in its header that stable IDs are blocked pending a `storage.renameEntity` primitive.

Any serious graph-core investment — graph-aware ranking caches, blob decomposition into linked nodes, cross-store references — multiplies the cost of name coupling, because every new edge is another thing a rename breaks.

**Closing it:** introduce stable internal ids (keeping `name` as a unique, mutable label). This is a v2.0-scale change to the storage schema and `Relation` type, but it can be staged: add an `id` column now, backfill, and migrate reference sites incrementally while `name` remains the public API.

---

## 4. Recommendation

Feasible, worth doing, and best framed as **convergence rather than re-architecture**:

1. **Cheap wins first** (minor releases): graph-connectivity signals in `SalienceEngine` and `HybridScorer`; wire `GraphTraversal` PageRank into ranked search as an optional scorer. This makes the graph the *computational* core where it is currently just the storage core.
2. **Blob decomposition** manager-by-manager (`ProcedureStore` first), each with a migration path.
3. **Stable ids + `renameEntity`** as the headline v2.0 breaking change, unblocking everything downstream.
4. **Don't** force-unify `CueTagContentGraph` or delete `InMemoryBackend`; define them as ephemeral indexes over the graph with persistence-through-the-bridge as the contract.

### What to avoid

A triple-store-style purist rewrite (observations as first-class nodes) is **not** recommended. `observations: string[]` is load-bearing in both storage schemas (SQLite stores it as a JSON `TEXT` column mirrored into FTS5; JSONL indexes it via `ObservationIndex`), and dozens of managers depend on it. The cost is enormous and the payoff mostly aesthetic.

The library gets ~90% of "knowledge graph as core" from steps 1–3 at perhaps 10% of the cost of a model rewrite.

---

## Appendix: subsystem scale (as of this assessment)

| Dir | Files | Approx. LOC | Largest modules |
|---|---|---|---|
| `src/core` | 23 | 12,300 | SQLiteStorage, ManagerContext, GraphStorage, GraphTraversal, EntityManager |
| `src/search` | 48 | 15,400 | QueryCostEstimator, EmbeddingService, ParallelSearchExecutor, BooleanSearch, FuzzySearch |
| `src/agent` | 79 | 26,500 | ConsolidationPipeline, ContextWindowManager, MultiAgentMemoryManager, WorkingMemoryManager, SalienceEngine |
| `src/features` | 18 | 6,700 | IOManager, CompressionManager, GovernanceManager, ArchiveManager |

`src/agent` is the largest and most internally diverse subsystem — and it is where the graph's centrality is weakest (parallel backends, a second graph model, JSON-blob observations). It is therefore where the convergence effort should focus.
