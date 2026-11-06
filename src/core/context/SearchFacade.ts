/**
 * SearchFacade
 *
 * Owns the search-layer managers that `ManagerContext` used to hold inline:
 * the ranked, search, hybrid, and semantic search stack, the graph-rank prior,
 * materialised views, the auto-linker and fact extractor, and the LLM query
 * planner. Also owns the Bloom pre-screener attachment to the fuzzy searcher.
 *
 * Every member is lazy and constructed at most once. Env flags are read on the
 * first access of each member, matching the pre-extraction behaviour. Nothing
 * is constructed by the `peek*` methods or by the constructor.
 *
 * @module core/context/SearchFacade
 * @internal
 */

import { SearchManager } from '../../search/SearchManager.js';
import { RankedSearch } from '../../search/RankedSearch.js';
import { GraphRankPrior } from '../../search/GraphRankPrior.js';
import { HybridSearchManager } from '../../search/HybridSearchManager.js';
import { LLMQueryPlanner } from '../../search/LLMQueryPlanner.js';
import type { LLMQueryPlannerConfig } from '../../search/LLMQueryPlanner.js';
import { LLMSearchExecutor } from '../../search/LLMSearchExecutor.js';
import { TemporalSearch } from '../../search/TemporalSearch.js';
import { SemanticSearch } from '../../search/SemanticSearch.js';
import { createEmbeddingService } from '../../search/EmbeddingService.js';
import { EmbeddingCache } from '../../search/EmbeddingCache.js';
import { createVectorStore, isEmbeddingStorage } from '../../search/VectorStore.js';
import { MaterializedViewsManager } from '../../search/MaterializedViews.js';
import type { BloomPreScreener } from '../../search/BloomPreScreener.js';
import { AutoLinker } from '../../features/AutoLinker.js';
import { FactExtractor } from '../../features/FactExtractor.js';
import type { GraphStorage } from '../GraphStorage.js';
import type { EntityManager } from '../EntityManager.js';
import type { RelationManager } from '../RelationManager.js';
import type { ObservationManager } from '../ObservationManager.js';
import type { GraphTraversal } from '../GraphTraversal.js';
import type { CachePressureCoordinator } from '../../utils/CachePressureCoordinator.js';
import type { Entity } from '../../types/index.js';
import { readEnvNumber, readEnvStrictFlag } from '../../utils/envConfig.js';
import { getEmbeddingConfig } from '../../utils/constants.js';
import { PROBABILITY } from './envBounds.js';

/** Constructor dependencies for {@link SearchFacade}. */
export interface SearchFacadeDeps {
  /** Storage shared by every search manager. */
  storage: GraphStorage;
  /** Shared cache-pressure coordinator; caches register with it when enabled. */
  cachePressure: CachePressureCoordinator;
  /** Absolute path of the saved-searches sidecar. */
  savedSearchesFilePath: string;
  /** Returns the owning context's entity manager (constructed on demand). */
  getEntityManager: () => EntityManager;
  /** Returns the owning context's relation manager (constructed on demand). */
  getRelationManager: () => RelationManager;
  /** Returns the owning context's observation manager (constructed on demand). */
  getObservationManager: () => ObservationManager;
  /** Returns the owning context's graph traversal (constructed on demand). */
  getGraphTraversal: () => GraphTraversal;
  /** Returns the storage-infrastructure Bloom pre-screener, or `null` when disabled. */
  getBloomPreScreener: () => BloomPreScreener | null;
}

/**
 * Lazy search-layer managers. See the module doc for the resolution rules.
 *
 * @internal
 */
export class SearchFacade {
  private readonly deps: SearchFacadeDeps;

  private _searchManager?: SearchManager;
  private _rankedSearch?: RankedSearch;
  private _graphRankPrior?: GraphRankPrior;
  private _hybridSearchManager?: HybridSearchManager;
  private _materializedViews?: MaterializedViewsManager;
  /** `undefined` = unresolved, `null` = no embedding provider configured. */
  private _semanticSearch?: SemanticSearch | null;
  private _autoLinker?: AutoLinker;
  private _factExtractor?: FactExtractor;
  private _llmQueryPlanner?: LLMQueryPlanner;
  private _llmSearchExecutor?: LLMSearchExecutor;
  private _temporalSearch?: TemporalSearch;

  /**
   * @param deps Storage, pressure coordinator, sidecar path, and lazy accessors
   *   for the sibling managers this facade wires into.
   */
  constructor(deps: SearchFacadeDeps) {
    this.deps = deps;
  }

  /**
   * SearchManager - all search operations.
   *
   * When `MEMORY_FUZZY_BLOOM_PRESCREEN` is the strict literal `'true'`, the
   * Bloom pre-screener is attached to `fuzzySearcher` at construction.
   */
  get searchManager(): SearchManager {
    if (!this._searchManager) {
      this._searchManager = new SearchManager(
        this.deps.storage,
        this.deps.savedSearchesFilePath,
        this.deps.cachePressure.enabled ? this.deps.cachePressure : undefined,
      );
      if (readEnvStrictFlag('MEMORY_FUZZY_BLOOM_PRESCREEN')) {
        const screener = this.deps.getBloomPreScreener();
        if (screener) this._searchManager.fuzzySearcher.setBloomPreScreener(screener);
      }
    }
    return this._searchManager;
  }

  /**
   * TemporalSearch - natural-language time-range search (chrono-node parser over
   * entity timestamps). Lazy; constructed on first access.
   */
  get temporalSearch(): TemporalSearch {
    if (!this._temporalSearch) {
      this._temporalSearch = new TemporalSearch(this.deps.storage);
    }
    return this._temporalSearch;
  }

  /**
   * RankedSearch - TF-IDF/BM25 ranked search.
   *
   * When `MEMORY_RANKED_GRAPH_BOOST` is greater than 0, the graph-rank prior is
   * attached as a post-scoring boost. At 0 or unset, the prior is not built.
   */
  get rankedSearch(): RankedSearch {
    if (!this._rankedSearch) {
      this._rankedSearch = new RankedSearch(
        this.deps.storage,
        undefined,
        this.deps.cachePressure.enabled ? this.deps.cachePressure : undefined,
        'context-ranked-tokens',
      );
      // Optional graph-connectivity boost. When MEMORY_RANKED_GRAPH_BOOST is
      // 0/unset (the default), the prior is not even constructed — zero overhead.
      const graphBoost = readEnvNumber('MEMORY_RANKED_GRAPH_BOOST', 0, { min: 0 });
      if (graphBoost > 0) {
        this._rankedSearch.setGraphPrior(this.graphRankPrior, graphBoost);
      }
    }
    return this._rankedSearch;
  }

  /**
   * GraphRankPrior — cached graph-connectivity ranking signal (normalized
   * PageRank with degree fallback). Built over the existing GraphTraversal
   * and auto-invalidated via the storage GraphEventEmitter.
   *
   * @experimental
   */
  get graphRankPrior(): GraphRankPrior {
    return (this._graphRankPrior ??= new GraphRankPrior(this.deps.getGraphTraversal(), {
      events: this.deps.storage.events,
    }));
  }

  /**
   * HybridSearchManager — semantic + lexical + symbolic (+ optional graph)
   * layered search. Reads `MEMORY_HYBRID_GRAPH_WEIGHT` at first access; when
   * 0/unset (the default), the GraphRankPrior is not attached — zero overhead.
   */
  get hybridSearchManager(): HybridSearchManager {
    if (!this._hybridSearchManager) {
      const graphWeight = readEnvNumber('MEMORY_HYBRID_GRAPH_WEIGHT', 0, PROBABILITY);
      this._hybridSearchManager =
        graphWeight > 0
          ? new HybridSearchManager(this.semanticSearch, this.rankedSearch, this.graphRankPrior, {
              graphWeight,
            })
          : new HybridSearchManager(this.semanticSearch, this.rankedSearch);
    }
    return this._hybridSearchManager;
  }

  /**
   * Materialised search views — pre-computed result sets for repeated
   * filter-based queries. Lazy: only constructed on first access (which
   * also wires the GraphEventEmitter listener for auto-invalidation).
   */
  get materializedViews(): MaterializedViewsManager {
    return (this._materializedViews ??= new MaterializedViewsManager(
      this.deps.storage,
      this.deps.storage.events,
    ));
  }

  /**
   * SemanticSearch - semantic similarity search.
   * Returns `null` if no embedding provider is configured.
   */
  get semanticSearch(): SemanticSearch | null {
    if (this._semanticSearch === undefined) {
      const config = getEmbeddingConfig();
      const embeddingService = createEmbeddingService(config);

      if (embeddingService) {
        const storage = this.deps.storage;
        const vectorStore = isEmbeddingStorage(storage)
          ? createVectorStore('sqlite', storage, embeddingService.model)
          : createVectorStore('jsonl');
        const pressure = this.deps.cachePressure.enabled ? this.deps.cachePressure : undefined;
        const embeddingCache = pressure
          ? new EmbeddingCache({ dimensions: embeddingService.dimensions })
          : undefined;
        if (embeddingCache) pressure?.register(embeddingCache);
        this._semanticSearch = new SemanticSearch(embeddingService, vectorStore, {
          embeddingCache,
          onCacheInsert: () => pressure?.evictIfOverBudget(),
        });
      } else {
        this._semanticSearch = null;
      }
    }
    return this._semanticSearch;
  }

  /**
   * AutoLinker - automatic entity mention detection in observations.
   * Automatically wired to ObservationManager for auto-link support.
   */
  get autoLinker(): AutoLinker {
    if (!this._autoLinker) {
      this._autoLinker = new AutoLinker(
        this.deps.storage,
        this.deps.getRelationManager(),
      );
      this.deps.getObservationManager().setAutoLinker(this._autoLinker);
    }
    return this._autoLinker;
  }

  /**
   * FactExtractor - rule-based fact extraction from observation text.
   */
  get factExtractor(): FactExtractor {
    if (!this._factExtractor) {
      this._factExtractor = new FactExtractor(this.deps.getEntityManager(), this.deps.getRelationManager());
    }
    return this._factExtractor;
  }

  /**
   * LLMQueryPlanner - Feature 7: natural language query decomposition.
   *
   * Decomposes free-text queries into structured search plans.
   * Optionally configured with an LLM provider; falls back to keyword
   * extraction when no provider is supplied.
   *
   * @param config - Optional LLM provider and default limit. Passing a config
   *   re-instantiates the planner and resets the cached executor.
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
   * Decompose a natural language string into entity results.
   *
   * Uses the default (no-LLM) query planner unless a custom planner has
   * already been initialised via {@link SearchFacade.llmQueryPlanner}.
   *
   * @param text - Natural language query.
   * @returns Matching entities.
   */
  async queryNaturalLanguage(text: string): Promise<Entity[]> {
    const planner = this._llmQueryPlanner ?? this.llmQueryPlanner();

    if (!this._llmSearchExecutor) {
      this._llmSearchExecutor = new LLMSearchExecutor(this.searchManager);
    }

    const structured = await planner.planQuery(text);
    return this._llmSearchExecutor.execute(structured);
  }

  /**
   * Side-effect-free read of the search manager. Returns the cached instance,
   * or `undefined` when it has not been constructed. Never constructs.
   *
   * @returns The cached `SearchManager`, or `undefined`.
   */
  peekSearchManager(): SearchManager | undefined {
    return this._searchManager;
  }

  /**
   * Side-effect-free read of the ranked search. Never constructs.
   *
   * @returns The cached `RankedSearch`, or `undefined` when unresolved.
   */
  peekRankedSearch(): RankedSearch | undefined {
    return this._rankedSearch;
  }

  /**
   * Side-effect-free read of the semantic search. Never constructs.
   *
   * @returns `undefined` when unresolved, `null` when no embedding provider is
   *   configured, otherwise the cached `SemanticSearch`.
   */
  peekSemanticSearch(): SemanticSearch | null | undefined {
    return this._semanticSearch;
  }

  /**
   * Detach the Bloom pre-screener from the fuzzy searcher, if a search manager
   * exists. Idempotent. The caller decides whether a screener was attached.
   */
  close(): void {
    this._searchManager?.fuzzySearcher.setBloomPreScreener(null);
  }
}
