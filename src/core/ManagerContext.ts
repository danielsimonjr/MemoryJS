/**
 * Manager Context
 *
 * Central context holding all manager instances. Core managers (entity,
 * relation, observation, hierarchy, graph traversal, IO, tags, analytics,
 * compression, archive, reference index) are eagerly constructed or
 * constructed on first access. The search, agent-memory, agent-cognition,
 * agent-bookkeeping, and knowledge/governance groups are owned by facades under
 * `src/core/context/`; the getters here delegate to them. Facade members keep
 * the lazy, once-only resolution and the env-read timing of the original
 * inline getters.
 *
 * @module core/ManagerContext
 */

import { logger } from '../utils/logger.js';
import { IndexHealthMonitor, type IndexHealthReport } from '../utils/IndexHealthMonitor.js';
import { buildDiagnosticsReport, type DiagnosticsOptions, type DiagnosticsReport } from '../utils/Diagnostics.js';
import { BatchTransaction } from './TransactionManager.js';
import { ContradictionDetector } from '../features/ContradictionDetector.js';
import { validateFilePath, sidecarPath } from '../utils/index.js';
import type { BatchResult, BatchOptions, Entity } from '../types/index.js';
import { CachePressureCoordinator } from '../utils/CachePressureCoordinator.js';
import type { MaterializedViewsManager } from '../search/MaterializedViews.js';
import type { SpellChecker } from '../search/SpellChecker.js';
import { ObservationStore } from './ObservationStore.js';
import { GraphStorage } from './GraphStorage.js';
import { createStorage, createStorageFromPath } from './StorageFactory.js';
// S9: side-effect import registers the SQLiteStorage constructor with
// StorageFactory (which no longer static-imports the SQLiteStorage module),
// keeping MEMORY_STORAGE_TYPE=sqlite working for direct ManagerContext
// consumers. Tree-shaking bundlers (sideEffects: false) may drop this;
// such consumers use preloadSQLiteStorage() instead.
import './sqlite-register.js';
import { EntityManager } from './EntityManager.js';
import { RelationManager } from './RelationManager.js';
import { ObservationManager } from './ObservationManager.js';
import type { TieredIndex } from '../search/tiered/TieredIndex.js';
import type { CompressedMap } from '../utils/compression/CompressedMap.js';
import type { IColumnStore, ObservationColumn } from './columns/IColumnStore.js';
import { StorageInfraFacade } from './context/StorageInfraFacade.js';
import { SearchFacade } from './context/SearchFacade.js';
import { AgentMemoryFacade } from './context/AgentMemoryFacade.js';
import { AgentCognitionFacade, type ProceduralGraphConfig } from './context/AgentCognitionFacade.js';
export type { ProceduralGraphConfig } from './context/AgentCognitionFacade.js';
import { AgentBookkeepingFacade } from './context/AgentBookkeepingFacade.js';
import { KnowledgeGovernanceFacade } from './context/KnowledgeGovernanceFacade.js';
import { readEnvNumber, type EnvNumberBounds } from '../utils/envConfig.js';
import { HierarchyManager } from './HierarchyManager.js';
import { GraphTraversal } from './GraphTraversal.js';
import type { SearchManager } from '../search/SearchManager.js';
import type { RankedSearch } from '../search/RankedSearch.js';
import type { GraphRankPrior } from '../search/GraphRankPrior.js';
import type { HybridSearchManager } from '../search/HybridSearchManager.js';
import type { LLMQueryPlanner, LLMQueryPlannerConfig } from '../search/LLMQueryPlanner.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';
import type { BloomPreScreener } from '../search/BloomPreScreener.js';
import { IOManager } from '../features/IOManager.js';
import { TagManager } from '../features/TagManager.js';
import { AnalyticsManager } from '../features/AnalyticsManager.js';
import { CompressionManager } from '../features/CompressionManager.js';
import { ArchiveManager } from '../features/ArchiveManager.js';
import type { AutoLinker } from '../features/AutoLinker.js';
import type { FactExtractor } from '../features/FactExtractor.js';
import type { GovernanceManager } from '../features/GovernanceManager.js';
import type { AccessTracker } from '../agent/AccessTracker.js';
import type { DecayEngine } from '../agent/DecayEngine.js';
import type { DecayScheduler } from '../agent/DecayScheduler.js';
import type { ConsolidationScheduler } from '../agent/ConsolidationScheduler.js';
import type { SalienceEngine } from '../agent/SalienceEngine.js';
import type { ContextWindowManager } from '../agent/ContextWindowManager.js';
import type { MemoryFormatter } from '../agent/MemoryFormatter.js';
import type { AgentMemoryManager } from '../agent/AgentMemoryManager.js';
import type { AgentMemoryConfig } from '../agent/AgentMemoryConfig.js';
import type { ArtifactManager } from '../agent/ArtifactManager.js';
import type { DreamEngine, DreamEngineConfig } from '../agent/DreamEngine.js';
import { RefIndex } from './RefIndex.js';
import type { ObserverPipeline } from '../agent/ObserverPipeline.js';
import type { MemoryEngine } from '../agent/MemoryEngine.js';
import type { IMemoryBackend } from '../agent/MemoryBackend.js';
import type { MemoryValidator } from '../agent/MemoryValidator.js';
import type { TrajectoryCompressor } from '../agent/TrajectoryCompressor.js';
import type { ExperienceExtractor } from '../agent/ExperienceExtractor.js';
import type { HeuristicManager } from '../agent/HeuristicManager.js';
import type { ObservationDedupManager } from '../agent/ObservationDedupManager.js';
import type { ExclusionManager } from '../agent/ExclusionManager.js';
import type { DecisionManager } from '../agent/DecisionManager.js';
import type { ProjectContextManager } from '../agent/ProjectContextManager.js';
import type { ToolAffordanceManager } from '../agent/ToolAffordanceManager.js';
import type { ToolCallObserver } from '../agent/ToolCallObserver.js';
import type { PatternDetector } from '../agent/PatternDetector.js';
import type { ProcedureManager } from '../agent/procedural/ProcedureManager.js';
import type { ProceduralGraphManager } from '../agent/procedural/graph/index.js';
import type { EventManager } from '../agent/events/EventManager.js';
import type { ProspectiveMemoryManager, PredicateEvaluator } from '../agent/ProspectiveMemoryManager.js';
import type { FailureManager } from '../agent/FailureManager.js';
import type { PlanManager } from '../agent/PlanManager.js';
import type { AgentReflectionManager } from '../agent/AgentReflectionManager.js';
import type { CausalReasoner } from '../agent/causal/CausalReasoner.js';
import type { RbacMiddleware } from '../agent/rbac/RbacMiddleware.js';
import type { RoleAssignmentStore } from '../agent/rbac/RoleAssignmentStore.js';
import type { WorldModelManager } from '../agent/world/WorldModelManager.js';
import type { ActiveRetrievalController } from '../agent/retrieval/ActiveRetrievalController.js';
import type { ReconstructiveMemory, ReconstructiveMemoryConfig } from '../agent/reconstruction/index.js';
import type { SemanticForget } from '../features/SemanticForget.js';
import type { TransitionLedger } from './TransitionLedger.js';
import type { SkillManager } from '../agent/skills/SkillManager.js';
import type { SkillPublisher } from '../agent/skills/SkillPublisher.js';
import type { InstructionSetManager } from '../agent/knowledge/InstructionSetManager.js';
import type { KnowledgeRepository } from '../agent/knowledge/KnowledgeRepository.js';

/**
 * Options for constructing a ManagerContext.
 */
export interface ManagerContextOptions {
  storagePath: string;
  /**
   * Storage backend for `storagePath`. Acts as the default when
   * `MEMORY_STORAGE_TYPE` is unset; the environment variable keeps its
   * documented precedence over any explicit type (see `createStorage`).
   * Omitted = `MEMORY_STORAGE_TYPE`, else `jsonl`.
   */
  storageType?: 'jsonl' | 'sqlite';
  /** Default project scope for this context. */
  defaultProjectId?: string;
  /**
   * Evaluator for conditional prospective-memory triggers. Passed to the
   * `ctx.prospectiveMemory` manager. Code-only; no environment variable.
   */
  prospectivePredicateEvaluator?: PredicateEvaluator;
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
  /** Env-gated optional storage infrastructure (DES-4). */
  private readonly infra: StorageInfraFacade;
  /** Search-layer managers (DES search facade). */
  private readonly searchFacade: SearchFacade;
  /** Agent memory lifecycle and retrieval managers. */
  private readonly memoryFacade: AgentMemoryFacade;
  /** Agent reasoning and procedural managers. */
  private readonly cognitionFacade: AgentCognitionFacade;
  /** Agent record-keeping managers (heuristics, exclusions, validation, ...). */
  private readonly bookkeepingFacade: AgentBookkeepingFacade;
  /** Knowledge, RBAC, transition ledger, and governance managers. */
  private readonly knowledgeFacade: KnowledgeGovernanceFacade;

  // ==================== LAZY-INITIALIZED CORE MANAGERS ====================
  private _entityManager?: EntityManager;
  private _relationManager?: RelationManager;
  private _observationManager?: ObservationManager;
  private _hierarchyManager?: HierarchyManager;
  private _graphTraversal?: GraphTraversal;
  private _ioManager?: IOManager;
  private _tagManager?: TagManager;
  private _analyticsManager?: AnalyticsManager;
  private _compressionManager?: CompressionManager;
  private _archiveManager?: ArchiveManager;
  private _refIndex?: RefIndex;
  /**
   * Coordinated cache pressure across registered subsystem caches.
   * Enabled when `MEMORY_CACHE_BUDGET_ENTRIES` is set; otherwise this
   * is a quiet no-op. Subsystems (e.g. `EmbeddingCache`,
   * `QueryPlanCache`) are registered on first lazy access so the
   * coordinator can shrink them proportionally when the global budget
   * is exceeded.
   */
  readonly cachePressure: CachePressureCoordinator = new CachePressureCoordinator();

  /** Lazy-initialised. See `observationStore` getter. */
  private _observationStore?: ObservationStore;

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

    // Sidecars live next to the main file (hyphen-delimited suffixes).
    this.savedSearchesFilePath = sidecarPath(validatedPath, '-saved-searches');
    this.tagAliasesFilePath = sidecarPath(validatedPath, '-tag-aliases');
    this.refIndexFilePath = sidecarPath(validatedPath, '-ref-index');
    // Use StorageFactory to respect MEMORY_STORAGE_TYPE environment variable.
    // An explicit `storageType` option is the default type when the env var
    // is unset (previously the option was declared but ignored).
    // Type assertion: SQLiteStorage implements same interface as GraphStorage
    this.storage = (opts.storageType
      ? createStorage({ type: opts.storageType, path: validatedPath })
      : createStorageFromPath(validatedPath)) as GraphStorage;

    // Env-gated storage infrastructure (column store, tiered index, compressed
    // cache, Bloom pre-screener). Resolution is lazy; construction here is free.
    this.infra = new StorageInfraFacade({
      storage: this.storage,
      cachePressure: this.cachePressure,
      // Phase 8 sidecar, only used when MEMORY_OBSERVATIONS_COLUMNAR=true.
      columnStorePath: sidecarPath(validatedPath, '-observations'),
      onBloomScreenerReady: (screener) => {
        this.searchFacade.peekSearchManager()?.fuzzySearcher.setBloomPreScreener(screener);
      },
    });

    // Facades are constructed here but resolve nothing: every member is lazy.
    this.searchFacade = new SearchFacade({
      storage: this.storage,
      cachePressure: this.cachePressure,
      savedSearchesFilePath: this.savedSearchesFilePath,
      getEntityManager: () => this.entityManager, getRelationManager: () => this.relationManager,
      getObservationManager: () => this.observationManager, getGraphTraversal: () => this.graphTraversal,
      getBloomPreScreener: () => this.bloomPreScreener,
    });
    this.knowledgeFacade = new KnowledgeGovernanceFacade({
      storage: this.storage,
      getEntityManager: () => this.entityManager,
      getFailureManager: () => this.failureManager,
      peekSemanticSearch: () => this.searchFacade.peekSemanticSearch(),
    });
    this.bookkeepingFacade = new AgentBookkeepingFacade({
      storage: this.storage,
      getEntityManager: () => this.entityManager,
      getObservationManager: () => this.observationManager,
      getSemanticSearch: () => this.semanticSearch,
    });
    this.cognitionFacade = new AgentCognitionFacade({
      storage: this.storage,
      getEntityManager: () => this.entityManager, getRelationManager: () => this.relationManager,
      getGraphTraversal: () => this.graphTraversal, getRankedSearch: () => this.rankedSearch,
      getSemanticSearch: () => this.semanticSearch, getMemoryValidator: () => this.memoryValidator,
      prospectivePredicateEvaluator: opts.prospectivePredicateEvaluator,
    });
    this.memoryFacade = new AgentMemoryFacade({
      storage: this.storage,
      getEntityManager: () => this.entityManager, getSearchManager: () => this.searchManager,
      getGraphTraversal: () => this.graphTraversal, getSemanticSearch: () => this.semanticSearch,
      getHybridSearchManager: () => this.hybridSearchManager, getCompressionManager: () => this.compressionManager,
      getExclusionManager: () => this.exclusionManager, getRefIndex: () => this.refIndex,
    });

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

  // ==================== LAZY ACCESSORS (core) ====================

  /** EntityManager - Entity CRUD and tag operations. Governance hooks are wired at first access; see {@link KnowledgeGovernanceFacade.getGovernanceHooks}. */
  get entityManager(): EntityManager {
    if (!this._entityManager) {
      this._entityManager = new EntityManager(
        this.storage,
        { defaultProjectId: this.defaultProjectId }
      );
      // Wire the RefIndex so stable aliases survive renames
      // (EntityManager.renameEntity remaps them) and are purged on
      // deletes. RefIndex is lazy — no disk I/O until first use.
      this._entityManager.setRefIndex(this.refIndex);
      this._entityManager.setGovernanceHooks(this.knowledgeFacade.getGovernanceHooks());
    }
    return this._entityManager;
  }

  /** See {@link KnowledgeGovernanceFacade.governanceManager}. */
  get governanceManager(): GovernanceManager { return this.knowledgeFacade.governanceManager; }

  /** RelationManager - Relation CRUD. */
  get relationManager(): RelationManager {
    return (this._relationManager ??= new RelationManager(
      this.storage,
      this.knowledgeFacade.getGovernanceHooks(),
    ));
  }

  /** ObservationManager - Observation CRUD. Wires the column store (env-gated) at first access. */
  get observationManager(): ObservationManager {
    if (!this._observationManager) {
      this._observationManager = new ObservationManager(
        this.storage,
        this.knowledgeFacade.getGovernanceHooks(),
      );
      // Phase 8 tasks 66 + 67: wire the column store (env-gated). The
      // store is null when `MEMORY_OBSERVATIONS_COLUMNAR` is unset/false,
      // matching pre-Phase-8 behavior.
      this._observationManager.setColumnStore(this.observationColumnStore);
    }
    return this._observationManager;
  }

  /** See {@link StorageInfraFacade.observationColumnStore}. */
  get observationColumnStore(): IColumnStore<ObservationColumn> | null { return this.infra.observationColumnStore; }
  /** See {@link StorageInfraFacade.tieredPostingsIndex}. */
  get tieredPostingsIndex(): TieredIndex<unknown> | null { return this.infra.tieredPostingsIndex; }
  /** See {@link StorageInfraFacade.compressedEntityCache}. */
  get compressedEntityCache(): CompressedMap<string, Entity> | null { return this.infra.compressedEntityCache; }

  /** HierarchyManager - Entity hierarchy operations. */
  get hierarchyManager(): HierarchyManager {
    return (this._hierarchyManager ??= new HierarchyManager(this.storage));
  }

  /** GraphTraversal - Phase 4 Sprint 6-8: Graph traversal algorithms. */
  get graphTraversal(): GraphTraversal {
    return (this._graphTraversal ??= new GraphTraversal(this.storage));
  }

  // ==================== SEARCH (delegates to SearchFacade) ====================

  /** See {@link SearchFacade.searchManager}. */
  get searchManager(): SearchManager { return this.searchFacade.searchManager; }
  /** See {@link StorageInfraFacade.bloomPreScreener}. */
  get bloomPreScreener(): BloomPreScreener | null { return this.infra.bloomPreScreener; }
  /** See {@link SearchFacade.rankedSearch}. */
  get rankedSearch(): RankedSearch { return this.searchFacade.rankedSearch; }
  /** See {@link SearchFacade.graphRankPrior}. */
  get graphRankPrior(): GraphRankPrior { return this.searchFacade.graphRankPrior; }
  /** See {@link SearchFacade.hybridSearchManager}. */
  get hybridSearchManager(): HybridSearchManager { return this.searchFacade.hybridSearchManager; }
  /** See {@link SearchFacade.materializedViews}. */
  get materializedViews(): MaterializedViewsManager { return this.searchFacade.materializedViews; }

  /**
   * Content-addressable observation store — opt-in helper for callers
   * who want to detect duplicate observation strings across entities
   * (memory-saving analysis, dedup audits). Lazy: only constructed
   * on first access. Per-`ManagerContext`, in-process only; no
   * persistence and no seed from existing graph entities.
   */
  get observationStore(): ObservationStore {
    return (this._observationStore ??= new ObservationStore());
  }

  /** See {@link SearchFacade.semanticSearch}. */
  get semanticSearch(): SemanticSearch | null { return this.searchFacade.semanticSearch; }
  /** See {@link SearchFacade.autoLinker}. */
  get autoLinker(): AutoLinker { return this.searchFacade.autoLinker; }
  /** See {@link SearchFacade.factExtractor}. */
  get factExtractor(): FactExtractor { return this.searchFacade.factExtractor; }
  /** See {@link SearchFacade.llmQueryPlanner}. */
  llmQueryPlanner(config?: LLMQueryPlannerConfig): LLMQueryPlanner { return this.searchFacade.llmQueryPlanner(config); }
  /** See {@link SearchFacade.queryNaturalLanguage}. */
  queryNaturalLanguage(text: string): Promise<Entity[]> { return this.searchFacade.queryNaturalLanguage(text); }

  /**
   * Aggregate index health snapshot.
   *
   * Returns a uniform report covering every search index this context is
   * aware of. Side-effect-free: reads the cached search instances directly so
   * calling `indexHealth()` does not force construction of `RankedSearch` or
   * `SemanticSearch` (which would load the local embedding model).
   */
  indexHealth(): IndexHealthReport {
    return new IndexHealthMonitor({
      rankedSearch: this.searchFacade.peekRankedSearch(),
      embeddingHealth: () => this.embeddingHealthSnapshot(),
    }).report();
  }

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
    const builder = new BatchTransaction(this.storage);
    try {
      await fn(builder);
    } catch (err) {
      builder.clear();
      throw err;
    }
    return builder.execute(options);
  }

  /**
   * Aggregate diagnostics: composes over `indexHealth()` and adds optional
   * memory / entity-count / query-stats / cache-hit-rate panels. Cheap
   * enough to call from a request handler — does not force lazy-subsystem
   * construction (uninitialised parts report null/empty).
   */
  diagnostics(options: DiagnosticsOptions = {}): DiagnosticsReport {
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
        const tiered = this.infra.peekTieredPostingsIndex();
        if (!tiered) return undefined;
        const stats = tiered.stats();
        const total = stats.hits + stats.misses;
        return {
          ...stats,
          hitRate: total === 0 ? 0 : stats.hits / total,
        };
      },
      // DES-12 (CMP-8): opt-in observation dedup ratio. Uses a throwaway
      // store so `ctx.observationStore` is never populated by diagnostics.
      () => {
        if (options.observationDedup !== true) return undefined;
        const cached = this.storage.cachedGraph;
        if (!cached) return undefined;
        const store = new ObservationStore();
        for (const e of cached.entities) {
          store.internAll(e.observations);
        }
        return store.stats();
      },
    );
  }

  /** Embedding health panel for {@link ManagerContext.indexHealth}. Reads the cached search only. */
  private embeddingHealthSnapshot() {
    const semantic = this.searchFacade.peekSemanticSearch();
    if (semantic === undefined) {
      return {
        name: 'embedding',
        initialized: false,
        documentCount: -1,
        warnings: ['embedding subsystem not initialised'],
      };
    }
    return {
      name: 'embedding',
      initialized: semantic !== null,
      documentCount: -1,
      warnings: semantic === null ? ['no embedding provider configured'] : [],
    };
  }

  /** IOManager - Import/export/backup/restore. */
  get ioManager(): IOManager {
    return (this._ioManager ??= new IOManager(this.storage, {
      entityManager: this.entityManager,
      relationManager: this.relationManager,
      governanceHooks: this.knowledgeFacade.getGovernanceHooks(),
    }));
  }

  /** TagManager - Tag alias management. */
  get tagManager(): TagManager {
    return (this._tagManager ??= new TagManager(this.tagAliasesFilePath));
  }

  /** AnalyticsManager - Graph statistics and validation. */
  get analyticsManager(): AnalyticsManager {
    return (this._analyticsManager ??= new AnalyticsManager(this.storage));
  }

  /** CompressionManager - Duplicate detection and entity merging. */
  get compressionManager(): CompressionManager {
    return (this._compressionManager ??= new CompressionManager(
      this.storage,
      this.knowledgeFacade.getGovernanceHooks(),
    ));
  }

  /** ArchiveManager - Entity archival to compressed storage. */
  get archiveManager(): ArchiveManager {
    return (this._archiveManager ??= new ArchiveManager(
      this.storage,
      this.knowledgeFacade.getGovernanceHooks(),
    ));
  }

  /** RefIndex - Named reference index for O(1) stable entity lookups. */
  get refIndex(): RefIndex {
    return (this._refIndex ??= new RefIndex(this.refIndexFilePath));
  }

  // ==================== AGENT MEMORY (delegates to AgentMemoryFacade) ====================

  /** See {@link AgentMemoryFacade.agentMemory}. */
  agentMemory(config?: AgentMemoryConfig): AgentMemoryManager { return this.memoryFacade.agentMemory(config); }
  /** See {@link AgentMemoryFacade.memoryEngine}. */
  get memoryEngine(): MemoryEngine { return this.memoryFacade.memoryEngine; }
  /** See {@link AgentMemoryFacade.memoryBackend}. */
  get memoryBackend(): IMemoryBackend { return this.memoryFacade.memoryBackend; }
  /** See {@link AgentCognitionFacade.procedureManager}. */
  get procedureManager(): ProcedureManager { return this.cognitionFacade.procedureManager; }
  /** See {@link AgentCognitionFacade.createProceduralGraph}. */
  createProceduralGraph(config: ProceduralGraphConfig): Promise<ProceduralGraphManager> { return this.cognitionFacade.createProceduralGraph(config); }
  /** See {@link AgentMemoryFacade.trajectoryCompressor}. */
  get trajectoryCompressor(): TrajectoryCompressor { return this.memoryFacade.trajectoryCompressor; }
  /** See {@link AgentMemoryFacade.experienceExtractor}. */
  get experienceExtractor(): ExperienceExtractor { return this.memoryFacade.experienceExtractor; }
  /** See {@link AgentMemoryFacade.patternDetector}. */
  get patternDetector(): PatternDetector { return this.memoryFacade.patternDetector; }
  /** See {@link AgentBookkeepingFacade.memoryValidator}. */
  get memoryValidator(): MemoryValidator { return this.bookkeepingFacade.memoryValidator; }
  /** See {@link AgentBookkeepingFacade.heuristicManager}. */
  get heuristicManager(): HeuristicManager { return this.bookkeepingFacade.heuristicManager; }
  /** See {@link AgentBookkeepingFacade.observationDedupManager}. */
  get observationDedupManager(): ObservationDedupManager { return this.bookkeepingFacade.observationDedupManager; }
  /** See {@link AgentBookkeepingFacade.exclusionManager}. */
  get exclusionManager(): ExclusionManager { return this.bookkeepingFacade.exclusionManager; }
  /** See {@link AgentBookkeepingFacade.decisionManager}. */
  get decisionManager(): DecisionManager { return this.bookkeepingFacade.decisionManager; }
  /** See {@link AgentBookkeepingFacade.projectContextManager}. */
  get projectContextManager(): ProjectContextManager { return this.bookkeepingFacade.projectContextManager; }
  /** See {@link AgentBookkeepingFacade.spellChecker}. */
  get spellChecker(): SpellChecker { return this.bookkeepingFacade.spellChecker; }
  /** See {@link AgentBookkeepingFacade.toolAffordanceManager}. */
  get toolAffordanceManager(): ToolAffordanceManager { return this.bookkeepingFacade.toolAffordanceManager; }
  /** See {@link AgentBookkeepingFacade.toolCallObserver}. */
  get toolCallObserver(): ToolCallObserver { return this.bookkeepingFacade.toolCallObserver; }
  /** See {@link AgentCognitionFacade.eventManager}. */
  get eventManager(): EventManager { return this.cognitionFacade.eventManager; }
  /** See {@link AgentCognitionFacade.prospectiveMemory}. */
  get prospectiveMemory(): ProspectiveMemoryManager { return this.cognitionFacade.prospectiveMemory; }
  /** See {@link AgentCognitionFacade.failureManager}. */
  get failureManager(): FailureManager { return this.cognitionFacade.failureManager; }
  /** See {@link AgentCognitionFacade.plan}. */
  get plan(): PlanManager { return this.cognitionFacade.plan; }
  /** See {@link AgentCognitionFacade.reflectionManager}. */
  get reflectionManager(): AgentReflectionManager { return this.cognitionFacade.reflectionManager; }
  /** See {@link AgentCognitionFacade.causalReasoner}. */
  get causalReasoner(): CausalReasoner { return this.cognitionFacade.causalReasoner; }
  /** See {@link KnowledgeGovernanceFacade.roleAssignmentStore}. */
  get roleAssignmentStore(): RoleAssignmentStore { return this.knowledgeFacade.roleAssignmentStore; }
  /** See {@link KnowledgeGovernanceFacade.rbacMiddleware}. */
  get rbacMiddleware(): RbacMiddleware { return this.knowledgeFacade.rbacMiddleware; }
  /** See {@link AgentCognitionFacade.worldModelManager}. */
  get worldModelManager(): WorldModelManager { return this.cognitionFacade.worldModelManager; }
  /** See {@link AgentCognitionFacade.activeRetrieval}. */
  get activeRetrieval(): ActiveRetrievalController { return this.cognitionFacade.activeRetrieval; }
  /** See {@link AgentCognitionFacade.reconstructiveMemory}. */
  reconstructiveMemory(config?: ReconstructiveMemoryConfig): ReconstructiveMemory { return this.cognitionFacade.reconstructiveMemory(config); }
  /** See {@link KnowledgeGovernanceFacade.transitionLedger}. */
  get transitionLedger(): TransitionLedger | null { return this.knowledgeFacade.transitionLedger; }
  /** See {@link KnowledgeGovernanceFacade.skillManager}. */
  get skillManager(): SkillManager { return this.knowledgeFacade.skillManager; }
  /** See {@link KnowledgeGovernanceFacade.instructionSets}. */
  get instructionSets(): InstructionSetManager { return this.knowledgeFacade.instructionSets; }
  /** See {@link KnowledgeGovernanceFacade.knowledgeRepository}. */
  get knowledgeRepository(): KnowledgeRepository { return this.knowledgeFacade.knowledgeRepository; }
  /** See {@link KnowledgeGovernanceFacade.skillPublisher}. */
  get skillPublisher(): SkillPublisher { return this.knowledgeFacade.skillPublisher; }
  /** See {@link AgentBookkeepingFacade.semanticForget}. */
  get semanticForget(): SemanticForget { return this.bookkeepingFacade.semanticForget; }
  /** See {@link AgentMemoryFacade.artifactManager}. */
  get artifactManager(): ArtifactManager { return this.memoryFacade.artifactManager; }
  /** See {@link AgentMemoryFacade.accessTracker}. */
  get accessTracker(): AccessTracker { return this.memoryFacade.accessTracker; }
  /** See {@link AgentMemoryFacade.decayEngine}. */
  get decayEngine(): DecayEngine { return this.memoryFacade.decayEngine; }
  /** See {@link AgentMemoryFacade.decayScheduler}. */
  get decayScheduler(): DecayScheduler | undefined { return this.memoryFacade.decayScheduler; }
  /** See {@link AgentMemoryFacade.consolidationScheduler}. */
  get consolidationScheduler(): ConsolidationScheduler | undefined { return this.memoryFacade.consolidationScheduler; }
  /** See {@link AgentMemoryFacade.dreamEngine}. */
  dreamEngine(config: DreamEngineConfig = {}): DreamEngine { return this.memoryFacade.dreamEngine(config); }
  /** See {@link AgentMemoryFacade.salienceEngine}. */
  get salienceEngine(): SalienceEngine { return this.memoryFacade.salienceEngine; }
  /** See {@link AgentMemoryFacade.contextWindowManager}. */
  get contextWindowManager(): ContextWindowManager { return this.memoryFacade.contextWindowManager; }
  /** See {@link AgentMemoryFacade.memoryFormatter}. */
  get memoryFormatter(): MemoryFormatter { return this.memoryFacade.memoryFormatter; }
  /** See {@link AgentMemoryFacade.observerPipeline}. */
  get observerPipeline(): ObserverPipeline | undefined { return this.memoryFacade.observerPipeline; }

  // ==================== Lifecycle ====================

  /**
   * Release the underlying storage handle.
   *
   * The SQLite backend keeps `mem.db`, `mem.db-wal` and `mem.db-shm` open for
   * the lifetime of the connection. POSIX lets you unlink an open file, so on
   * Linux/macOS a caller can delete or move the database without closing it —
   * but **Windows refuses with `EBUSY`**. Without this method a consumer of the
   * facade had no way to release the handle at all (only the raw
   * `SQLiteStorage` exposed `close()`), which also leaked a handle per context
   * in long-running processes.
   *
   * Disposes procedural-graph managers created with owned backings, detaches the
   * Bloom pre-screener (when one was attached), and closes storage. Backends are
   * duck-typed: the JSONL `GraphStorage` holds no persistent handle and exposes
   * no `close()`, so that step is a safe no-op there.
   *
   * Idempotent — calling it twice is harmless.
   *
   * @example
   * const ctx = new ManagerContext('./memory.db');
   * try { ... } finally { ctx.close(); }
   */
  close(): void {
    this.cognitionFacade.close();
    const hadBloomScreener = this.infra.peekBloomPreScreener() !== null;
    this.infra.close();
    if (hadBloomScreener) {
      this.searchFacade.close();
    }
    const storage = this.storage as unknown as { close?: () => void };
    if (typeof storage?.close === 'function') {
      storage.close();
    }
  }

  // ==================== LAZINESS PROBES (tests only) ====================

  /** Cached skill manager, if already built. @internal test probe; never constructs. */
  protected get _skillManager(): SkillManager | undefined {
    return this.knowledgeFacade.peekSkillManager();
  }

  /** Cached instruction sets, if already built. @internal test probe; never constructs. */
  protected get _instructionSets(): InstructionSetManager | undefined {
    return this.knowledgeFacade.peekInstructionSets();
  }

  /** Cached knowledge repository, if already built. @internal test probe; never constructs. */
  protected get _knowledgeRepository(): KnowledgeRepository | undefined {
    return this.knowledgeFacade.peekKnowledgeRepository();
  }

  /** Cached skill publisher, if already built. @internal test probe; never constructs. */
  protected get _skillPublisher(): SkillPublisher | undefined {
    return this.knowledgeFacade.peekSkillPublisher();
  }

  /** Cached prospective memory, if already built. @internal test probe; never constructs. */
  protected get _prospectiveMemory(): ProspectiveMemoryManager | undefined {
    return this.cognitionFacade.peekProspectiveMemory();
  }

  // ==================== Environment Variable Helpers ====================

  /**
   * Get a number from environment variable with default.
   * Retained for the env-validation contract tests; facades read env through
   * `readEnvNumber` directly.
   * @internal
   */
  protected getEnvNumber(key: string, defaultValue: number, bounds?: EnvNumberBounds): number {
    return readEnvNumber(key, defaultValue, bounds);
  }
}
