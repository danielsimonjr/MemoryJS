/**
 * Manager Context
 *
 * Central context holding all manager instances.
 * Core managers are eagerly initialized; agent memory managers
 * use lazy initialization due to conditional creation and dependency chains.
 *
 * @module core/ManagerContext
 */

import path from 'path';
import { logger } from '../utils/logger.js';
import { IndexHealthMonitor, type IndexHealthReport } from '../utils/IndexHealthMonitor.js';
import { buildDiagnosticsReport, type DiagnosticsReport } from '../utils/Diagnostics.js';
import { BatchTransaction } from './TransactionManager.js';
import type { BatchResult, BatchOptions, Entity } from '../types/index.js';
import { CachePressureCoordinator } from '../utils/CachePressureCoordinator.js';
import { MaterializedViewsManager } from '../search/MaterializedViews.js';
import { ObservationStore } from './ObservationStore.js';
import { GraphStorage } from './GraphStorage.js';
import { createStorageFromPath } from './StorageFactory.js';
import { EntityManager } from './EntityManager.js';
import { RelationManager } from './RelationManager.js';
import { ObservationManager } from './ObservationManager.js';
import { JsonlColumnStore } from './columns/JsonlColumnStore.js';
import { TieredIndex, buildTieredIndex } from '../search/tiered/TieredIndex.js';
import { LRUHotTier } from '../search/tiered/LRUHotTier.js';
import { DiskWarmTier } from '../search/tiered/DiskWarmTier.js';
import { BrotliColdTier } from '../search/tiered/BrotliColdTier.js';
import { CompressedMap } from '../utils/compression/CompressedMap.js';
import { ZlibCompressionAdapter } from '../utils/compression/ICompressionAdapter.js';
import type { IColumnStore, ObservationColumn } from './columns/IColumnStore.js';
import { HierarchyManager } from './HierarchyManager.js';
import { GraphTraversal } from './GraphTraversal.js';
import { SearchManager } from '../search/SearchManager.js';
import { RankedSearch } from '../search/RankedSearch.js';
import { LLMQueryPlanner } from '../search/LLMQueryPlanner.js';
import { LLMSearchExecutor } from '../search/LLMSearchExecutor.js';
import type { LLMQueryPlannerConfig } from '../search/LLMQueryPlanner.js';
import { SemanticSearch, createEmbeddingService, createVectorStore } from '../search/index.js';
import { IOManager } from '../features/IOManager.js';
import { TagManager } from '../features/TagManager.js';
import { AnalyticsManager } from '../features/AnalyticsManager.js';
import { CompressionManager } from '../features/CompressionManager.js';
import { ArchiveManager } from '../features/ArchiveManager.js';
import { AutoLinker } from '../features/AutoLinker.js';
import { FactExtractor } from '../features/FactExtractor.js';
import { TransitionLedger } from './TransitionLedger.js';
import { AccessTracker } from '../agent/AccessTracker.js';
import { DecayEngine } from '../agent/DecayEngine.js';
import { DecayScheduler } from '../agent/DecayScheduler.js';
import { ConsolidationScheduler } from '../agent/ConsolidationScheduler.js';
import { SalienceEngine } from '../agent/SalienceEngine.js';
import { ContextWindowManager } from '../agent/ContextWindowManager.js';
import { MemoryFormatter } from '../agent/MemoryFormatter.js';
import { AgentMemoryManager } from '../agent/AgentMemoryManager.js';
import { ArtifactManager } from '../agent/ArtifactManager.js';
import { DreamEngine, type DreamEngineConfig } from '../agent/DreamEngine.js';
import { RefIndex } from './RefIndex.js';
import { ObserverPipeline } from '../agent/ObserverPipeline.js';
import type { ObserverPipelineOptions } from '../agent/ObserverPipeline.js';
import type { AgentMemoryConfig } from '../agent/AgentMemoryConfig.js';
import { getEmbeddingConfig } from '../utils/constants.js';
import { validateFilePath } from '../utils/index.js';
import { ContradictionDetector } from '../features/ContradictionDetector.js';
import { SemanticForget } from '../features/SemanticForget.js';
import { MemoryEngine } from '../agent/MemoryEngine.js';
import { ImportanceScorer } from '../agent/ImportanceScorer.js';
import type { IMemoryBackend } from '../agent/MemoryBackend.js';
import { InMemoryBackend } from '../agent/InMemoryBackend.js';
import { SQLiteBackend } from '../agent/SQLiteBackend.js';
import { MemoryValidator } from '../agent/MemoryValidator.js';
import { TrajectoryCompressor } from '../agent/TrajectoryCompressor.js';
import { ExperienceExtractor } from '../agent/ExperienceExtractor.js';
import { HeuristicManager } from '../agent/HeuristicManager.js';
import { ObservationDedupManager } from '../agent/ObservationDedupManager.js';
import { ExclusionManager } from '../agent/ExclusionManager.js';
import { PatternDetector } from '../agent/PatternDetector.js';
import { ProcedureManager } from '../agent/procedural/ProcedureManager.js';
import {
  ProspectiveMemoryManager,
  type ProcedureInvoker,
} from '../agent/ProspectiveMemoryManager.js';
import { FailureManager } from '../agent/FailureManager.js';
import { PlanManager } from '../agent/PlanManager.js';
import { ReflectionManager } from '../agent/ReflectionManager.js';
import { CausalReasoner } from '../agent/causal/CausalReasoner.js';
import { RbacMiddleware } from '../agent/rbac/RbacMiddleware.js';
import { RoleAssignmentStore } from '../agent/rbac/RoleAssignmentStore.js';
import { WorldModelManager } from '../agent/world/WorldModelManager.js';
import { ActiveRetrievalController } from '../agent/retrieval/ActiveRetrievalController.js';

/**
 * Options for constructing a ManagerContext.
 */
export interface ManagerContextOptions {
  storagePath: string;
  storageType?: 'jsonl' | 'sqlite';
  /** Default project scope for this context. */
  defaultProjectId?: string;
  /** Enable contradiction detection. Requires embedding provider. */
  enableContradictionDetection?: boolean;
  /** Similarity threshold for contradiction detection. Default 0.85. */
  contradictionThreshold?: number;
}

/**
 * Central context holding all manager instances.
 * Core managers are eagerly initialized in the constructor.
 * Agent memory managers use lazy initialization due to dependency chains and conditional creation.
 */
export class ManagerContext {
  // Type as GraphStorage for manager compatibility; actual instance may be SQLiteStorage
  // which implements the same interface via duck typing
  readonly storage: GraphStorage;
  public readonly defaultProjectId?: string;
  private readonly savedSearchesFilePath: string;
  private readonly tagAliasesFilePath: string;
  private readonly refIndexFilePath: string;
  private readonly observationColumnStorePath: string;
  private _observerPipeline?: ObserverPipeline;

  // ==================== LAZY-INITIALIZED CORE MANAGERS ====================
  private _entityManager?: EntityManager;
  private _relationManager?: RelationManager;
  private _observationManager?: ObservationManager;
  private _observationColumnStore: IColumnStore<ObservationColumn> | null | undefined;

  /** Phase 9: tiered posting-list cache. `undefined` = unresolved, `null` = env-gated off. */
  private _tieredPostingsIndex: TieredIndex<unknown> | null | undefined;

  /** Phase 10: compressed entity cache. `undefined` = unresolved, `null` = env-gated off. */
  private _compressedEntityCache: CompressedMap<string, Entity> | null | undefined;
  private _hierarchyManager?: HierarchyManager;
  private _graphTraversal?: GraphTraversal;
  private _searchManager?: SearchManager;
  private _rankedSearch?: RankedSearch;
  private _ioManager?: IOManager;
  private _tagManager?: TagManager;
  private _analyticsManager?: AnalyticsManager;
  private _compressionManager?: CompressionManager;
  private _archiveManager?: ArchiveManager;
  /**
   * Coordinated cache pressure across registered subsystem caches.
   * Enabled when `MEMORY_CACHE_BUDGET_ENTRIES` is set; otherwise this
   * is a quiet no-op. Subsystems (e.g. `EmbeddingCache`,
   * `QueryPlanCache`) are registered on first lazy access so the
   * coordinator can shrink them proportionally when the global budget
   * is exceeded.
   */
  readonly cachePressure: CachePressureCoordinator = new CachePressureCoordinator();

  /** Lazy-initialised. See `materializedViews` getter. */
  private _materializedViews?: MaterializedViewsManager;

  /** Lazy-initialised. See `observationStore` getter. */
  private _observationStore?: ObservationStore;

  private _autoLinker?: AutoLinker;
  private _factExtractor?: FactExtractor;
  private _transitionLedger?: TransitionLedger | null;
  private _semanticSearch?: SemanticSearch | null;
  private _memoryEngine?: MemoryEngine;
  private _memoryBackend?: IMemoryBackend;
  private _memoryValidator?: MemoryValidator;
  private _trajectoryCompressor?: TrajectoryCompressor;
  private _experienceExtractor?: ExperienceExtractor;
  private _heuristicManager?: HeuristicManager;
  private _observationDedupManager?: ObservationDedupManager;
  private _exclusionManager?: ExclusionManager;
  private _patternDetector?: PatternDetector;
  private _procedureManager?: ProcedureManager;
  private _prospectiveMemory?: ProspectiveMemoryManager;
  private _failureManager?: FailureManager;
  private _plan?: PlanManager;
  private _reflectionManager?: ReflectionManager;
  private _causalReasoner?: CausalReasoner;
  private _rbacMiddleware?: RbacMiddleware;
  private _roleAssignmentStore?: RoleAssignmentStore;
  private _worldModelManager?: WorldModelManager;
  private _activeRetrieval?: ActiveRetrievalController;
  private _accessTracker?: AccessTracker;
  private _decayEngine?: DecayEngine;
  private _decayScheduler?: DecayScheduler;
  private _salienceEngine?: SalienceEngine;
  private _contextWindowManager?: ContextWindowManager;
  private _memoryFormatter?: MemoryFormatter;
  private _agentMemory?: AgentMemoryManager;
  private _refIndex?: RefIndex;
  private _artifactManager?: ArtifactManager;
  private _consolidationScheduler?: ConsolidationScheduler;
  private _dreamEngine?: DreamEngine;
  private _llmQueryPlanner?: LLMQueryPlanner;
  private _llmSearchExecutor?: LLMSearchExecutor;
  private _semanticForget?: SemanticForget;

  constructor(pathOrOptions: string | ManagerContextOptions) {
    const opts: ManagerContextOptions =
      typeof pathOrOptions === 'string'
        ? { storagePath: pathOrOptions }
        : pathOrOptions;
    this.defaultProjectId = opts.defaultProjectId;

    // Security: Validate path to prevent path traversal attacks.
    // confineToBase=false because storagePath is application-controlled
    // (not user-tainted) — tests need to pass tmpdir() paths. The defense-
    // in-depth ".." segment check at the top of validateFilePath still runs.
    const validatedPath = validateFilePath(opts.storagePath, undefined, false);

    // Derive paths for saved searches and tag aliases
    const dir = path.dirname(validatedPath);
    const basename = path.basename(validatedPath, path.extname(validatedPath));
    this.savedSearchesFilePath = path.join(dir, `${basename}-saved-searches.jsonl`);
    this.tagAliasesFilePath = path.join(dir, `${basename}-tag-aliases.jsonl`);
    this.refIndexFilePath = path.join(dir, `${basename}-ref-index.jsonl`);
    // Phase 8: column-store sidecar lives next to the main file. Only
    // populated when `MEMORY_OBSERVATIONS_COLUMNAR=true` (see the
    // `observationColumnStore` lazy getter below); zero behavior change
    // when the flag is unset. Hyphen-delimited path matches the
    // convention used by the other sidecars in this constructor
    // (`-saved-searches`, `-tag-aliases`, `-ref-index`).
    this.observationColumnStorePath = path.join(dir, `${basename}-observations.jsonl`);
    // Use StorageFactory to respect MEMORY_STORAGE_TYPE environment variable
    // Type assertion: SQLiteStorage implements same interface as GraphStorage
    this.storage = createStorageFromPath(validatedPath) as GraphStorage;

    // Wire contradiction detection if enabled (gracefully degrades without embedding provider)
    if (opts.enableContradictionDetection) {
      this.initContradictionDetection(opts.contradictionThreshold);
    }

    // Wire the pre-storage validator hook unconditionally as a lazy
    // provider thunk. The hook re-reads `MEMORY_VALIDATE_ON_STORE` on
    // every call so runtime toggling (ON→OFF and OFF→ON) works without
    // re-construction; the validator object itself is constructed only
    // on first call with the flag enabled.
    this.observationManager.setMemoryValidator(() => this.memoryValidator);
  }

  /**
   * Wire ContradictionDetector to ObservationManager if a semantic search
   * embedding provider is available. Silently degrades when none is configured.
   * @internal
   */
  private initContradictionDetection(threshold?: number): void {
    try {
      const ss = this.semanticSearch;
      if (!ss) {
        logger.warn(
          '[ManagerContext] Contradiction detection requested but no embedding provider is configured. ' +
          'Set MEMORY_EMBEDDING_PROVIDER to enable it.'
        );
        return;
      }
      const detector = new ContradictionDetector(ss, threshold ?? 0.85);
      this.observationManager.setContradictionDetector(detector, this.entityManager);
    } catch (err) {
      logger.warn(
        '[ManagerContext] Could not initialise contradiction detection:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // ==================== LAZY ACCESSORS (agent memory + semantic) ====================

  /** EntityManager - Entity CRUD and tag operations */
  get entityManager(): EntityManager {
    return (this._entityManager ??= new EntityManager(
      this.storage,
      { defaultProjectId: this.defaultProjectId }
    ));
  }

  /** RelationManager - Relation CRUD */
  get relationManager(): RelationManager {
    return (this._relationManager ??= new RelationManager(this.storage));
  }

  /** ObservationManager - Observation CRUD */
  get observationManager(): ObservationManager {
    if (!this._observationManager) {
      this._observationManager = new ObservationManager(this.storage);
      // Phase 8 tasks 66 + 67: wire the column store (env-gated). The
      // store is null when `MEMORY_OBSERVATIONS_COLUMNAR` is unset/false,
      // matching pre-Phase-8 behavior. When enabled, every
      // addObservations/deleteObservations write shadow-mirrors to the
      // sidecar and `getObservationsFor(name)` reads from the column
      // store first, falling back to inline.
      this._observationManager.setColumnStore(this.observationColumnStore);
    }
    return this._observationManager;
  }

  /**
   * Lazy `IColumnStore<ObservationColumn>` for the shadow observation
   * column. Returns `null` when `MEMORY_OBSERVATIONS_COLUMNAR` is
   * unset / `false` / any other value. Strict literal-match on
   * `'true'` keeps the activation gate predictable (no `'yes'` /
   * `'1'` / `'TRUE'` surprises). The sidecar lives at
   * `<basename>-observations.jsonl` next to the main storage file.
   *
   * **Read once, cached for the life of the ManagerContext.** The
   * env-var value is read on first access and the resolved column
   * store (or `null`) is cached. Flipping
   * `MEMORY_OBSERVATIONS_COLUMNAR` at runtime has no effect after
   * the first access — restart the process. Matches the precedent
   * set by Phase 7's `MEMORY_STORAGE_SEGMENT_COUNT` on
   * `GraphStorage`. If runtime reconfiguration becomes a
   * requirement, expose a `setObservationColumnStore` method on
   * `ManagerContext` rather than reading the env on every call.
   *
   * @experimental Phase 8 — call signature stable; the underlying
   *   sidecar format may grow new fields in non-breaking ways.
   */
  get observationColumnStore(): IColumnStore<ObservationColumn> | null {
    if (this._observationColumnStore === undefined) {
      this._observationColumnStore =
        process.env.MEMORY_OBSERVATIONS_COLUMNAR === 'true'
          ? new JsonlColumnStore<ObservationColumn>(this.observationColumnStorePath)
          : null;
    }
    return this._observationColumnStore;
  }

  /**
   * Lazy `ITieredIndex<string, unknown>` building block for callers
   * who want hot/warm/cold posting-list caching. Returns `null` when
   * `MEMORY_TIERED_INDEX` is not exactly `'true'` (strict literal
   * match — `'1'` / `'yes'` / `'TRUE'` decline, matching the
   * `MEMORY_OBSERVATIONS_COLUMNAR` precedent).
   *
   * **Wiring**: a `LRUHotTier` (10k entries default) → `DiskWarmTier`
   * (sidecar at `<basename>-tiered-warm.jsonl`) → `BrotliColdTier`
   * (shard at `<basename>-tiered-cold.jsonl.br`) chain. Use
   * `tieredPostingsIndex.stats()` for hit-rate diagnostics; the
   * tier-stats roll up into `ctx.diagnostics()`.
   *
   * **Direct integration with `OptimizedInvertedIndex` is intentionally
   * deferred** — the existing class uses tightly-coupled `Uint32Array`
   * posting layouts that don't map cleanly onto an `ITieredIndex<V>`.
   * Callers who want the cache today can compose it themselves on top
   * of any string-keyed corpus; a follow-up phase will retrofit
   * `OptimizedInvertedIndex` to consume the tiered backing.
   *
   * Read once at first access — restart the process to flip the env
   * var. Matches `observationColumnStore` precedent.
   *
   * Phase 9 tasks 73 + 74.
   *
   * @internal Until `OptimizedInvertedIndex` (or another concrete
   *   index implementation) actually consumes this property, the
   *   typing `TieredIndex<unknown>` is loose and the property has
   *   no in-tree caller. Marked `@internal` per Phase 9 review #5
   *   so external adopters don't lock themselves to a surface that
   *   may grow stricter generics once a concrete consumer lands.
   *   The `@experimental` notes still apply: tier sizing defaults
   *   and the `stats()` shape may change in non-breaking ways.
   */
  get tieredPostingsIndex(): TieredIndex<unknown> | null {
    if (this._tieredPostingsIndex === undefined) {
      if (process.env.MEMORY_TIERED_INDEX !== 'true') {
        this._tieredPostingsIndex = null;
        return null;
      }
      const filePath = this.storage.getFilePath();
      const dir = path.dirname(filePath);
      const basename = path.basename(filePath, path.extname(filePath));
      const warmPath = path.join(dir, `${basename}-tiered-warm.jsonl`);
      const coldPath = path.join(dir, `${basename}-tiered-cold.jsonl.br`);
      this._tieredPostingsIndex = buildTieredIndex<unknown>({
        makeHot: (onEvict) => new LRUHotTier({ maxEntries: 10_000, onEvict, name: 'hot' }),
        makeWarm: (onEvict) => new DiskWarmTier({ filePath: warmPath, maxEntries: 100_000, onEvict, name: 'warm' }),
        makeCold: () => new BrotliColdTier({ filePath: coldPath, name: 'cold' }),
      });
    }
    return this._tieredPostingsIndex;
  }

  /**
   * Lazy `CompressedMap<string, Entity>` for callers who want to
   * hold a large entity set in RAM at a fraction of the uncompressed
   * cost. Activated by `MEMORY_CACHE_COMPRESS='true'` (strict
   * literal-match — matches `MEMORY_OBSERVATIONS_COLUMNAR` and
   * `MEMORY_TIERED_INDEX` precedents).
   *
   * **Default configuration:** hot threshold 1000 entries
   * (uncompressed working set), Zlib adapter at level 6 (best
   * compress-speed/ratio trade-off per Phase 10 task 77 benchmark).
   * Brotli is the right pick for cold-storage shards; zlib for hot
   * caches like this one.
   *
   * **Direct integration with `GraphStorage.cache` is intentionally
   * deferred** — the existing cache holds a `KnowledgeGraph`
   * snapshot, not per-entity entries, so swapping in a
   * `CompressedMap` would require restructuring every read/write
   * path. Callers who want compressed entity caching today can
   * compose this property over the storage layer themselves; the
   * follow-up phase that rewires `GraphStorage` to entity-level
   * caching will pick this up.
   *
   * Phase 10 task 79.
   *
   * @internal Until `GraphStorage.cache` is restructured to use
   *   per-entity caching, the property has no in-tree consumer.
   *   Marked `@internal` per Phase 9 precedent so external adopters
   *   don't lock themselves to a surface that may grow stricter
   *   typing once a concrete consumer lands.
   */
  get compressedEntityCache(): CompressedMap<string, Entity> | null {
    if (this._compressedEntityCache === undefined) {
      if (process.env.MEMORY_CACHE_COMPRESS !== 'true') {
        this._compressedEntityCache = null;
        return null;
      }
      this._compressedEntityCache = new CompressedMap<string, Entity>({
        hotThreshold: 1000,
        adapter: new ZlibCompressionAdapter(6),
      });
    }
    return this._compressedEntityCache;
  }

  /** HierarchyManager - Entity hierarchy operations */
  get hierarchyManager(): HierarchyManager {
    return (this._hierarchyManager ??= new HierarchyManager(this.storage));
  }

  /** GraphTraversal - Phase 4 Sprint 6-8: Graph traversal algorithms */
  get graphTraversal(): GraphTraversal {
    return (this._graphTraversal ??= new GraphTraversal(this.storage));
  }

  /** SearchManager - All search operations */
  get searchManager(): SearchManager {
    return (this._searchManager ??= new SearchManager(this.storage, this.savedSearchesFilePath));
  }

  /** RankedSearch - TF-IDF/BM25 ranked search */
  get rankedSearch(): RankedSearch {
    return (this._rankedSearch ??= new RankedSearch(this.storage));
  }

  /**
   * Materialised search views — pre-computed result sets for repeated
   * filter-based queries. Lazy: only constructed on first access (which
   * also wires the GraphEventEmitter listener for auto-invalidation).
   */
  get materializedViews(): MaterializedViewsManager {
    return (this._materializedViews ??= new MaterializedViewsManager(
      this.storage as GraphStorage,
      this.storage.events,
    ));
  }

  /**
   * Content-addressable observation store — opt-in helper for callers
   * who want to detect duplicate observation strings across entities
   * (memory-saving analysis, dedup audits). Lazy: only constructed
   * on first access. The Entity shape on disk is unchanged; this is
   * a side-channel store the caller drives manually via
   * `internEntityObservations(entity)` / `releaseEntityObservations(hashes)`.
   *
   * **Scope:** the store is per-`ManagerContext` instance and lives
   * only in process memory. There is no on-disk persistence and no
   * seed from existing graph entities — a fresh `ctx` starts empty
   * and the store accumulates only the observations the caller
   * explicitly interns. Restart the process and the table is gone.
   */
  get observationStore(): ObservationStore {
    return (this._observationStore ??= new ObservationStore());
  }

  /**
   * Aggregate index health snapshot.
   *
   * Returns a uniform report covering every search index this context is
   * aware of. The future `ctx.diagnostics()` will compose over this shape
   * rather than redefine it.
   *
   * Side-effect-free: reads the private lazy-init fields directly so calling
   * `indexHealth()` does not force construction of `RankedSearch` or
   * `SemanticSearch` (which would load the local embedding model).
   * Uninitialised subsystems report `initialized: false` with a warning.
   */
  indexHealth(): IndexHealthReport {
    return new IndexHealthMonitor({
      rankedSearch: this._rankedSearch,
      embeddingHealth: () => this.embeddingHealthSnapshot(),
    }).report();
  }

  /**
   * Aggregate diagnostics: composes over `indexHealth()` and adds optional
   * memory / entity-count / query-stats / cache-hit-rate panels. Cheap
   * enough to call from a request handler — does not force lazy-subsystem
   * construction (uninitialised parts report null/empty).
   */
  /**
   * Group multiple mutations into a single batch executed atomically.
   *
   * The callback receives a `BatchTransaction` builder. Mutations queued
   * on the builder are validated and applied in a single pass via the
   * underlying `BatchTransaction.execute()`, returning the aggregate
   * result.
   *
   * **Exception semantics:** if `fn` throws, the queued operations are
   * discarded and the exception propagates — `execute()` is not called.
   * This is the conventional "abort on builder error" contract.
   *
   * @example
   * ```typescript
   * const result = await ctx.batch(async (b) => {
   *   b.createEntity({ name: 'A', entityType: 'note', observations: [] });
   *   b.createRelation({ from: 'A', to: 'B', relationType: 'r' });
   * });
   * ```
   */
  async batch(
    fn: (b: BatchTransaction) => void | Promise<void>,
    options: BatchOptions = {},
  ): Promise<BatchResult> {
    const builder = new BatchTransaction(this.storage as GraphStorage);
    try {
      await fn(builder);
    } catch (err) {
      builder.clear();
      throw err;
    }
    return builder.execute(options);
  }

  diagnostics(): DiagnosticsReport {
    return buildDiagnosticsReport(
      () => this.indexHealth(),
      () => {
        // Read the in-memory cache directly via the IGraphStorage getter
        // — does NOT force a load, returns -1 / {} when nothing is cached.
        const cached = this.storage.cachedGraph;
        if (!cached) return { total: -1, byType: {} };
        const byType: Record<string, number> = {};
        for (const e of cached.entities) {
          byType[e.entityType] = (byType[e.entityType] ?? 0) + 1;
        }
        return { total: cached.entities.length, byType };
      },
      // Phase 9 task 74: include tier stats when active. Reads through
      // the cached field directly so an unconfigured tiered index
      // doesn't force initialization just to report nothing.
      () => {
        if (this._tieredPostingsIndex === undefined || this._tieredPostingsIndex === null) {
          return undefined;
        }
        const stats = this._tieredPostingsIndex.stats();
        const total = stats.hits + stats.misses;
        return {
          ...stats,
          hitRate: total === 0 ? 0 : stats.hits / total,
        };
      },
    );
  }

  private embeddingHealthSnapshot() {
    if (this._semanticSearch === undefined) {
      return {
        name: 'embedding',
        initialized: false,
        documentCount: -1,
        warnings: ['embedding subsystem not initialised'],
      };
    }
    return {
      name: 'embedding',
      initialized: this._semanticSearch !== null,
      documentCount: -1,
      warnings: this._semanticSearch === null ? ['no embedding provider configured'] : [],
    };
  }

  /** IOManager - Import/export/backup/restore */
  get ioManager(): IOManager {
    return (this._ioManager ??= new IOManager(this.storage));
  }

  /** TagManager - Tag alias management */
  get tagManager(): TagManager {
    return (this._tagManager ??= new TagManager(this.tagAliasesFilePath));
  }

  /** AnalyticsManager - Graph statistics and validation */
  get analyticsManager(): AnalyticsManager {
    return (this._analyticsManager ??= new AnalyticsManager(this.storage));
  }

  /** CompressionManager - Duplicate detection and entity merging */
  get compressionManager(): CompressionManager {
    return (this._compressionManager ??= new CompressionManager(this.storage));
  }

  /** ArchiveManager - Entity archival to compressed storage */
  get archiveManager(): ArchiveManager {
    return (this._archiveManager ??= new ArchiveManager(this.storage));
  }

  /**
   * AutoLinker - Automatic entity mention detection in observations.
   * Automatically wired to ObservationManager for auto-link support.
   */
  get autoLinker(): AutoLinker {
    if (!this._autoLinker) {
      this._autoLinker = new AutoLinker(
        this.storage,
        this.relationManager
      );
      this.observationManager.setAutoLinker(this._autoLinker);
    }
    return this._autoLinker;
  }

  /**
   * FactExtractor - Rule-based fact extraction from observation text.
   */
  get factExtractor(): FactExtractor {
    if (!this._factExtractor) {
      this._factExtractor = new FactExtractor(this.entityManager, this.relationManager);
    }
    return this._factExtractor;
  }

  /**
   * SemanticSearch - Semantic similarity search.
   * Returns null if no embedding provider is configured.
   */
  get semanticSearch(): SemanticSearch | null {
    if (this._semanticSearch === undefined) {
      const config = getEmbeddingConfig();
      const embeddingService = createEmbeddingService(config);

      if (embeddingService) {
        const vectorStore = createVectorStore('jsonl');
        this._semanticSearch = new SemanticSearch(embeddingService, vectorStore);
      } else {
        this._semanticSearch = null;
      }
    }
    return this._semanticSearch;
  }

  /**
   * MemoryEngine — turn-aware conversation memory facade composing over
   * EpisodicMemoryManager + WorkingMemoryManager + ImportanceScorer.
   * Lazy: instantiated on first access. Reads MEMORY_ENGINE_* env vars
   * for dedup thresholds, scan window, and scorer weights.
   */
  get memoryEngine(): MemoryEngine {
    if (!this._memoryEngine) {
      const agent = this.agentMemory();
      const importanceScorer = new ImportanceScorer({
        lengthWeight: this.getEnvNumber('MEMORY_ENGINE_LENGTH_WEIGHT', 0.3),
        keywordWeight: this.getEnvNumber('MEMORY_ENGINE_KEYWORD_WEIGHT', 0.4),
        overlapWeight: this.getEnvNumber('MEMORY_ENGINE_OVERLAP_WEIGHT', 0.3),
      });
      const semanticSearch = this.semanticSearch ?? null;
      // Use the public accessor so a future rename of the private field
      // would surface as a typecheck error rather than a silent null.
      const embeddingService = semanticSearch?.getEmbeddingService() ?? null;

      this._memoryEngine = new MemoryEngine(
        this.storage,
        this.entityManager,
        agent.episodicMemory,
        agent.workingMemory,
        importanceScorer,
        semanticSearch,
        embeddingService,
        {
          jaccardThreshold: this.getEnvNumber('MEMORY_ENGINE_JACCARD_THRESHOLD', 0.72),
          prefixOverlapThreshold: this.getEnvNumber('MEMORY_ENGINE_PREFIX_OVERLAP', 0.5),
          dedupScanWindow: Math.trunc(
            this.getEnvNumber('MEMORY_ENGINE_DEDUP_SCAN_WINDOW', 200),
          ),
          maxTurnsPerSession: Math.trunc(
            this.getEnvNumber('MEMORY_ENGINE_MAX_TURNS_PER_SESSION', 1000),
          ),
          semanticDedupEnabled: this.getEnvBool('MEMORY_ENGINE_SEMANTIC_DEDUP', false),
          semanticThreshold: this.getEnvNumber('MEMORY_ENGINE_SEMANTIC_THRESHOLD', 0.92),
          recentTurnsForImportance: Math.trunc(
            this.getEnvNumber('MEMORY_ENGINE_RECENT_TURNS', 10),
          ),
        },
      );
    }
    return this._memoryEngine;
  }

  /**
   * IMemoryBackend (PRD MEM-04) — agent-memory-flavored backend.
   *
   * Selection by `MEMORY_BACKEND` env var:
   *   - `sqlite` (default when storage is SQLite OR var unset on JSONL)
   *   - `in-memory` (ephemeral; no persistence)
   *   - future: `postgres`, `vector` (Phase γ)
   *
   * Both adapters wrap `ctx.memoryEngine` + `ctx.decayEngine` so they
   * inherit the four-tier dedup chain and PRD effective-importance
   * scoring respectively. Lazy-initialized; cached.
   */
  get memoryBackend(): IMemoryBackend {
    if (!this._memoryBackend) {
      const choice = (process.env.MEMORY_BACKEND ?? 'sqlite').toLowerCase();
      switch (choice) {
        case 'in-memory':
        case 'inmemory':
        case 'memory':
          this._memoryBackend = new InMemoryBackend(this.decayEngine);
          break;
        case 'sqlite':
        default:
          // SQLiteBackend wraps MemoryEngine which works against either
          // JSONL or SQLite storage transparently — naming reflects PRD
          // intent (durable backend) more than the disk format.
          this._memoryBackend = new SQLiteBackend(this.memoryEngine, this.decayEngine);
          break;
      }
    }
    return this._memoryBackend;
  }

  /**
   * MemoryValidator (ROADMAP §3B.1, Phase δ.1) — reflection-stage
   * service that prevents hallucinations and logical errors from
   * contaminating memory through self-critique before storage.
   * Wraps `ContradictionDetector`. Lazy-initialized.
   *
   * Construction needs `ContradictionDetector(SemanticSearch, threshold)`.
   * If no semantic-search backend is configured, a no-op detector is
   * synthesized so MemoryValidator's other methods still work — the
   * detection method just returns no contradictions.
   */
  get memoryValidator(): MemoryValidator {
    if (!this._memoryValidator) {
      const ss = this.semanticSearch;
      const detector = ss
        ? new ContradictionDetector(ss, 0.85)
        : new ContradictionDetector(
            { calculateSimilarity: async () => 0 } as never,
            0.85,
          );
      this._memoryValidator = new MemoryValidator(detector);
    }
    return this._memoryValidator;
  }

  /**
   * TrajectoryCompressor (ROADMAP §3B.2, Phase δ.2) — reflection-stage
   * service that distills verbose interaction histories into compact,
   * reusable representations. Wraps `compressForContext`. Lazy.
   */
  get trajectoryCompressor(): TrajectoryCompressor {
    if (!this._trajectoryCompressor) {
      this._trajectoryCompressor = new TrajectoryCompressor(this.contextWindowManager);
    }
    return this._trajectoryCompressor;
  }

  /**
   * ExperienceExtractor (ROADMAP §3B.3, Phase δ.3) — experience-stage
   * service that abstracts universal patterns from trajectory clusters
   * for zero-shot transfer. Wraps `PatternDetector`. Lazy.
   */
  get experienceExtractor(): ExperienceExtractor {
    if (!this._experienceExtractor) {
      this._experienceExtractor = new ExperienceExtractor(this.patternDetector);
    }
    return this._experienceExtractor;
  }

  /**
   * `HeuristicManager` (Phase 3B.8a, v2.0.x) — storage-backed registry of
   * `condition → action` heuristic guidelines. `@experimental` match
   * algorithm. Lazy. The companion `HeuristicExtractionStage` (3B.8b,
   * pending) will crystallise resolved failures + qualifying reflections
   * into heuristic entities; for now the manager is the explicit
   * `add` / `match` / `reinforce` surface.
   */
  get heuristicManager(): HeuristicManager {
    if (!this._heuristicManager) {
      this._heuristicManager = new HeuristicManager(this.storage, this.entityManager);
    }
    return this._heuristicManager;
  }

  /**
   * `ObservationDedupManager` — read-only cross-entity duplicate-observation
   * finder. Complementary to `MemoryEngine` (turn-level) and
   * `CompressionManager.findDuplicates` (entity-level); this manager
   * surfaces observation strings that appear verbatim or
   * near-verbatim across distinct entities. Lazy.
   */
  get observationDedupManager(): ObservationDedupManager {
    if (!this._observationDedupManager) {
      this._observationDedupManager = new ObservationDedupManager(this.storage);
    }
    return this._observationDedupManager;
  }

  /**
   * `ExclusionManager` (Phase 3, v2.0.x) — user-supplied content-pattern
   * exclusion rules (`do_not_remember`). Hard-deletes existing matches
   * on `add` and (in Phase Excl B) write-blocks future matches at the
   * `MemoryEngine.addTurn` / `WorkingMemoryManager.add` hot paths. v1
   * ships `substring` matching only; `regex` is deferred. Lazy.
   */
  get exclusionManager(): ExclusionManager {
    if (!this._exclusionManager) {
      this._exclusionManager = new ExclusionManager(this.storage, this.entityManager);
    }
    return this._exclusionManager;
  }

  /** Lazy `PatternDetector` instance — backs `experienceExtractor`
   * but also exposed directly for callers that want pattern detection
   * without the full Experience-stage wrapper. */
  get patternDetector(): PatternDetector {
    if (!this._patternDetector) {
      this._patternDetector = new PatternDetector();
    }
    return this._patternDetector;
  }

  /**
   * `ProcedureManager` (3B.4) — first-class executable procedures.
   * Lazy. Composes `EntityManager` (persists procedures as
   * `entityType: 'procedure'`).
   */
  get procedureManager(): ProcedureManager {
    if (!this._procedureManager) {
      this._procedureManager = new ProcedureManager(this.entityManager);
    }
    return this._procedureManager;
  }

  /**
   * `ProspectiveMemoryManager` — intention-to-act / future-tense memory.
   * Lazy. Wires `procedureInvoker` to delegate to `procedureManager.invoke()`
   * per D1 of `docs/roadmap/MEMORY_TYPES_EXPANSION.md` §6.
   */
  get prospectiveMemory(): ProspectiveMemoryManager {
    if (!this._prospectiveMemory) {
      const procedureInvoker: ProcedureInvoker = async (procedureId) => {
        const result = await this.procedureManager.invoke(procedureId);
        if (!result.found) {
          throw new Error(`ProcedureInvoker: procedure '${procedureId}' not found`);
        }
      };
      this._prospectiveMemory = new ProspectiveMemoryManager(this.storage, {
        defaultExpiryHours: this.getEnvNumber('MEMORY_PROSPECTIVE_DEFAULT_EXPIRY_HOURS', 168),
        maxPendingPerSession: this.getEnvNumber('MEMORY_PROSPECTIVE_MAX_PENDING_PER_SESSION', 100),
        procedureInvoker,
      });
    }
    return this._prospectiveMemory;
  }

  /**
   * `FailureManager` (Phase 2 Sprint 4) — structured failure-memory
   * with `record()` / `lookupForTask()` / `markResolved()` /
   * `getAll()`. Catalog Type 9. The catalog calls this "the single
   * biggest concrete win available to most agentic systems" — the
   * pre-task `lookupForTask` is the headline retrieval mode.
   */
  get failureManager(): FailureManager {
    if (!this._failureManager) {
      this._failureManager = new FailureManager(this.storage, this.entityManager, {
        defaultLookupLimit: this.getEnvNumber('MEMORY_FAILURE_LOOKUP_LIMIT', 5),
      });
    }
    return this._failureManager;
  }

  /**
   * `PlanManager` (Phase 2 Sprint 5) — plan / goal-stack memory.
   * Catalog Type 6: forward-looking goal tree with sub-tasks +
   * acceptance criteria. Distinct from prospective memory (single
   * intention-to-act) by mutability + decomposition.
   */
  get plan(): PlanManager {
    if (!this._plan) {
      this._plan = new PlanManager(this.storage);
    }
    return this._plan;
  }

  /**
   * `ReflectionManager` (Phase 2 Sprint 8) — reflection-memory write
   * path and read API. Catalog Type 10: derived memories produced by
   * `ReflectionStage` (pattern + trajectory + experience) over a
   * candidate set. **Additive** — reflections do NOT supersede their
   * evidence entities. `ReflectionStage` itself is not auto-registered
   * on the default pipeline; construct it explicitly (it requires a
   * `TrajectoryCompressor` which needs a `ContextWindowManager`) and
   * invoke `runOnSessionEnd(sessionId)` from session-end handlers, or
   * register it on a `ConsolidationPipeline` instance.
   */
  get reflectionManager(): ReflectionManager {
    if (!this._reflectionManager) {
      this._reflectionManager = new ReflectionManager(this.storage, this.entityManager);
    }
    return this._reflectionManager;
  }

  /**
   * `CausalReasoner` (3B.6) — symbolic forward / backward / counter-
   * factual inference over the causal subgraph. Wraps `GraphTraversal`.
   * Lazy.
   */
  get causalReasoner(): CausalReasoner {
    if (!this._causalReasoner) {
      this._causalReasoner = new CausalReasoner(this.graphTraversal);
    }
    return this._causalReasoner;
  }

  /**
   * `RoleAssignmentStore` (η.6.1) — registry of role grants per agent.
   * Lazy. In-memory only by default; configure persistence via the
   * direct constructor if a JSONL sidecar is wanted.
   */
  get roleAssignmentStore(): RoleAssignmentStore {
    if (!this._roleAssignmentStore) {
      this._roleAssignmentStore = new RoleAssignmentStore();
    }
    return this._roleAssignmentStore;
  }

  /**
   * `RbacMiddleware` (η.6.1) — `RbacPolicy` impl. Backed by the lazy
   * `roleAssignmentStore`. Lazy.
   */
  get rbacMiddleware(): RbacMiddleware {
    if (!this._rbacMiddleware) {
      this._rbacMiddleware = new RbacMiddleware(this.roleAssignmentStore);
    }
    return this._rbacMiddleware;
  }

  /**
   * `WorldModelManager` (3B.7) — orchestrator that composes
   * `causalReasoner`, `memoryValidator`, and `entityManager` into a
   * single facade for `getCurrentState` / `validateFact` /
   * `predictOutcome` / `detectStateChange`. Lazy. Causal and validator
   * dependencies are passed through; methods that need them gracefully
   * return null/empty when they're not configured.
   */
  get worldModelManager(): WorldModelManager {
    if (!this._worldModelManager) {
      this._worldModelManager = new WorldModelManager(
        this.entityManager,
        this.causalReasoner,
        this.memoryValidator,
      );
    }
    return this._worldModelManager;
  }

  /**
   * `ActiveRetrievalController` (3B.5) — adaptive query-rewriting loop
   * over `RankedSearch`. Lazy. Pure symbolic expansion (no LLM); for
   * LLM-driven decomposition use `ctx.llmQueryPlanner`.
   */
  get activeRetrieval(): ActiveRetrievalController {
    if (!this._activeRetrieval) {
      this._activeRetrieval = new ActiveRetrievalController(this.rankedSearch);
    }
    return this._activeRetrieval;
  }

  /**
   * TransitionLedger - Append-only audit trail for state changes.
   * Returns null if not enabled via MEMORY_TRANSITION_LEDGER env var.
   * Auto-attaches to storage event emitter when created.
   */
  get transitionLedger(): TransitionLedger | null {
    if (this._transitionLedger === undefined) {
      if (this.getEnvBool('MEMORY_TRANSITION_LEDGER', false)) {
        this._transitionLedger = new TransitionLedger(this.storage.getFilePath());
        this._transitionLedger.attachToEmitter(this.storage.events);
      } else {
        this._transitionLedger = null;
      }
    }
    return this._transitionLedger;
  }

  /** RefIndex - Named reference index for O(1) stable entity lookups */
  get refIndex(): RefIndex {
    return (this._refIndex ??= new RefIndex(this.refIndexFilePath));
  }

  /** SemanticForget - Feature 3 (v1.8.0): Two-tier deletion with semantic fallback */
  get semanticForget(): SemanticForget {
    return (this._semanticForget ??= new SemanticForget(
      this.storage,
      this.observationManager,
      this.entityManager,
      this.semanticSearch ?? undefined,
      undefined // auditLog not yet exposed by GovernanceManager
    ));
  }

  /**
   * ArtifactManager - v1.7.0: Stable artifact entities with auto-generated names and ref registration.
   */
  get artifactManager(): ArtifactManager {
    if (!this._artifactManager) {
      this._artifactManager = new ArtifactManager(this.storage, this.entityManager, this.refIndex);
    }
    return this._artifactManager;
  }

  /**
   * AccessTracker - Access pattern tracking.
   * Automatically wired to EntityManager, SearchManager, and GraphTraversal.
   */
  get accessTracker(): AccessTracker {
    if (!this._accessTracker) {
      this._accessTracker = new AccessTracker(this.storage);
      this.entityManager.setAccessTracker(this._accessTracker);
      this.searchManager.setAccessTracker(this._accessTracker);
      this.graphTraversal.setAccessTracker(this._accessTracker);
    }
    return this._accessTracker;
  }

  /**
   * DecayEngine - Memory importance decay calculations.
   */
  get decayEngine(): DecayEngine {
    if (!this._decayEngine) {
      this._decayEngine = new DecayEngine(this.storage, this.accessTracker, {
        halfLifeHours: this.getEnvNumber('MEMORY_DECAY_HALF_LIFE_HOURS', 168),
        minImportance: this.getEnvNumber('MEMORY_DECAY_MIN_IMPORTANCE', 0.1),
        importanceModulation: this.getEnvBool('MEMORY_DECAY_IMPORTANCE_MOD', true),
        accessModulation: this.getEnvBool('MEMORY_DECAY_ACCESS_MOD', true),
        // PRD MEM-01 (v1.12.0). decayRate is auto-derived from halfLifeHours
        // when env-var unset (NaN check avoids overriding the auto-derive).
        decayRate: this.envNumberOrUndefined('MEMORY_PRD_DECAY_RATE'),
        freshnessCoefficient: this.getEnvNumber('MEMORY_PRD_FRESHNESS_COEFFICIENT', 0.01),
        relevanceWeight: this.getEnvNumber('MEMORY_PRD_RELEVANCE_WEIGHT', 0.35),
        minImportanceThreshold: this.getEnvNumber('MEMORY_PRD_MIN_IMPORTANCE_THRESHOLD', 0.1),
      });
    }
    return this._decayEngine;
  }

  /** Returns env-var as number, or undefined when unset (lets the
   *  default-derive logic in DecayEngine kick in for `decayRate`). */
  private envNumberOrUndefined(name: string): number | undefined {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  /**
   * DecayScheduler - Scheduled decay and forget operations.
   * Returns undefined if auto-decay is not enabled (MEMORY_AUTO_DECAY).
   */
  get decayScheduler(): DecayScheduler | undefined {
    if (this._decayScheduler) return this._decayScheduler;

    if (this.getEnvBool('MEMORY_AUTO_DECAY', false)) {
      this._decayScheduler = new DecayScheduler(this.decayEngine, {
        decayIntervalMs: this.getEnvNumber('MEMORY_DECAY_INTERVAL_MS', 3600000),
        autoForget: this.getEnvBool('MEMORY_AUTO_FORGET', false),
        forgetOptions: {
          effectiveImportanceThreshold: this.getEnvNumber('MEMORY_FORGET_THRESHOLD', 0.05),
        },
      });
    }

    return this._decayScheduler;
  }

  /**
   * ConsolidationScheduler - SHOULD-HAVE: Scheduled memory consolidation.
   *
   * Returns undefined when MEMORY_AUTO_CONSOLIDATION is not set to 'true'.
   *
   * Configurable via environment variables:
   * - MEMORY_AUTO_CONSOLIDATION (default: false) - Enable to create scheduler
   * - MEMORY_CONSOLIDATION_INTERVAL_MS (default: 3600000 = 1 hour)
   * - MEMORY_CONSOLIDATION_MERGE_DUPLICATES (default: false)
   * - MEMORY_CONSOLIDATION_DUPLICATE_THRESHOLD (default: 0.9)
   */
  get consolidationScheduler(): ConsolidationScheduler | undefined {
    if (this._consolidationScheduler) return this._consolidationScheduler;

    if (this.getEnvBool('MEMORY_AUTO_CONSOLIDATION', false)) {
      this._consolidationScheduler = new ConsolidationScheduler(
        this.agentMemory().consolidationPipeline,
        this.compressionManager,
        {
          consolidationIntervalMs: this.getEnvNumber(
            'MEMORY_CONSOLIDATION_INTERVAL_MS',
            3600000
          ),
          autoMergeDuplicates: this.getEnvBool(
            'MEMORY_CONSOLIDATION_MERGE_DUPLICATES',
            false
          ),
          duplicateThreshold: this.getEnvNumber(
            'MEMORY_CONSOLIDATION_DUPLICATE_THRESHOLD',
            0.9
          ),
        }
      );
    }

    return this._consolidationScheduler;
  }

  /**
   * DreamEngine — Background memory maintenance.
   *
   * Returns a DreamEngine instance.  The timer is NOT auto-started.
   * Call `.start()` to activate periodic cycles, or use `agentMemory()` helper
   * methods `startDreaming()` / `stopDreaming()`.
   *
   * Configurable via environment variables:
   * - MEMORY_DREAM_INTERVAL_MS (default: 14400000 = 4 hours)
   */
  dreamEngine(config: DreamEngineConfig = {}): DreamEngine {
    if (!this._dreamEngine || Object.keys(config).length > 0) {
      this._dreamEngine = new DreamEngine(
        this.storage,
        this.agentMemory().consolidationPipeline,
        {
          intervalMs: this.getEnvNumber('MEMORY_DREAM_INTERVAL_MS', 4 * 60 * 60 * 1000),
          ...config,
        }
      );
    }
    return this._dreamEngine;
  }

  /**
   * SalienceEngine - Phase 4 Agent Memory: Context-aware relevance scoring.
   *
   * Configurable via environment variables:
   * - MEMORY_SALIENCE_IMPORTANCE_WEIGHT (default: 0.25)
   * - MEMORY_SALIENCE_RECENCY_WEIGHT (default: 0.25)
   * - MEMORY_SALIENCE_FREQUENCY_WEIGHT (default: 0.2)
   * - MEMORY_SALIENCE_CONTEXT_WEIGHT (default: 0.2)
   * - MEMORY_SALIENCE_NOVELTY_WEIGHT (default: 0.1)
   */
  get salienceEngine(): SalienceEngine {
    if (!this._salienceEngine) {
      this._salienceEngine = new SalienceEngine(
        this.storage,
        this.accessTracker,
        this.decayEngine,
        {
          importanceWeight: this.getEnvNumber('MEMORY_SALIENCE_IMPORTANCE_WEIGHT', 0.25),
          recencyWeight: this.getEnvNumber('MEMORY_SALIENCE_RECENCY_WEIGHT', 0.25),
          frequencyWeight: this.getEnvNumber('MEMORY_SALIENCE_FREQUENCY_WEIGHT', 0.2),
          contextWeight: this.getEnvNumber('MEMORY_SALIENCE_CONTEXT_WEIGHT', 0.2),
          noveltyWeight: this.getEnvNumber('MEMORY_SALIENCE_NOVELTY_WEIGHT', 0.1),
        }
      );
    }
    return this._salienceEngine;
  }

  /**
   * ContextWindowManager - Token-budgeted memory retrieval.
   */
  get contextWindowManager(): ContextWindowManager {
    if (!this._contextWindowManager) {
      this._contextWindowManager = new ContextWindowManager(
        this.storage,
        this.salienceEngine,
        {
          defaultMaxTokens: this.getEnvNumber('MEMORY_CONTEXT_MAX_TOKENS', 4000),
          tokenMultiplier: this.getEnvNumber('MEMORY_CONTEXT_TOKEN_MULTIPLIER', 1.3),
          reserveBuffer: this.getEnvNumber('MEMORY_CONTEXT_RESERVE_BUFFER', 100),
          diversityThreshold: this.getEnvNumber('MEMORY_CONTEXT_DIVERSITY_THRESHOLD', 0.8),
          enforceDiversity: this.getEnvBool('MEMORY_CONTEXT_ENFORCE_DIVERSITY', true),
        }
      );
    }
    return this._contextWindowManager;
  }

  /**
   * MemoryFormatter - Format memories for LLM consumption.
   */
  get memoryFormatter(): MemoryFormatter {
    if (!this._memoryFormatter) {
      this._memoryFormatter = new MemoryFormatter({
        includeTimestamps: this.getEnvBool('MEMORY_FORMAT_TIMESTAMPS', true),
        includeMemoryType: this.getEnvBool('MEMORY_FORMAT_MEMORY_TYPE', true),
      });
    }
    return this._memoryFormatter;
  }

  /**
   * ObserverPipeline - Event-driven observation scoring and categorization.
   * Returns undefined if not enabled (MEMORY_OBSERVER_PIPELINE env var).
   */
  get observerPipeline(): ObserverPipeline | undefined {
    if (this._observerPipeline) return this._observerPipeline;

    if (this.getEnvBool('MEMORY_OBSERVER_PIPELINE', false)) {
      const options: ObserverPipelineOptions = {
        minImportanceThreshold: this.getEnvNumber('MEMORY_OBSERVER_MIN_THRESHOLD', 0.3),
        autoTag: this.getEnvBool('MEMORY_OBSERVER_AUTO_TAG', true),
        autoRoute: this.getEnvBool('MEMORY_OBSERVER_AUTO_ROUTE', false),
      };
      this._observerPipeline = new ObserverPipeline(
        this.entityManager,
        options
      );
    }

    return this._observerPipeline;
  }

  /**
   * AgentMemoryManager - Unified facade for all agent memory operations.
   *
   * @param config - Optional configuration override (default: loaded from env vars)
   */
  agentMemory(config?: AgentMemoryConfig): AgentMemoryManager {
    if (!this._agentMemory || config) {
      this._agentMemory = new AgentMemoryManager(this.storage, config);
      // Invalidate every derived cache that captured references into the
      // old AgentMemoryManager. The full set:
      //   - MemoryEngine (wires episodicMemory/workingMemory at ctor)
      //   - MemoryBackend (wraps MemoryEngine)
      //   - ConsolidationScheduler (captures agentMemory().consolidationPipeline)
      //   - DreamEngine (also captures consolidationPipeline)
      this._memoryEngine = undefined;
      this._memoryBackend = undefined;
      this._consolidationScheduler = undefined;
      this._dreamEngine = undefined;
    }
    return this._agentMemory;
  }

  // ==================== LLM Query Planner ====================

  /**
   * LLMQueryPlanner - Feature 7: Natural language query decomposition.
   *
   * Decomposes free-text queries into structured search plans.
   * Optionally configured with an LLM provider; falls back to keyword
   * extraction when no provider is supplied.
   *
   * @param config - Optional LLM provider and default limit
   */
  llmQueryPlanner(config?: LLMQueryPlannerConfig): LLMQueryPlanner {
    if (!this._llmQueryPlanner || config) {
      this._llmQueryPlanner = new LLMQueryPlanner(config);
      // Reset the executor so it is recreated with the new planner's config
      this._llmSearchExecutor = undefined;
    }
    return this._llmQueryPlanner;
  }

  /**
   * Convenience method: decompose a natural language string into Entity results.
   *
   * Uses the default (no-LLM) query planner unless a custom planner has
   * already been initialised via {@link llmQueryPlanner}.
   *
   * @param text - Natural language query
   * @returns Matching entities
   */
  async queryNaturalLanguage(text: string): Promise<import('../types/index.js').Entity[]> {
    const planner = this._llmQueryPlanner ?? this.llmQueryPlanner();

    if (!this._llmSearchExecutor) {
      this._llmSearchExecutor = new LLMSearchExecutor(this.searchManager);
    }

    const structured = await planner.planQuery(text);
    return this._llmSearchExecutor.execute(structured);
  }

  // ==================== Environment Variable Helpers ====================

  /**
   * Get a number from environment variable with default.
   * @internal
   */
  private getEnvNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get a boolean from environment variable with default.
   * @internal
   */
  private getEnvBool(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true';
  }
}
