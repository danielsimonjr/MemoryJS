/**
 * Ranked Search
 *
 * TF-IDF relevance-based search with scoring and pre-calculated indexes.
 *
 * @module search/RankedSearch
 */

import type {
  Entity,
  GraphEventType,
  IGraphStorage,
  SearchResult,
  TFIDFIndex,
  TokenizedEntity,
} from '../types/index.js';
import type { GraphEventEmitter } from '../core/GraphEventEmitter.js';
import type { CachePressureCoordinator } from '../utils/CachePressureCoordinator.js';
import { calculateTFFromTokens, calculateIDFFromTokenSets, tokenize } from '../utils/index.js';
import { SEARCH_LIMITS } from '../utils/constants.js';
import { TFIDFIndexManager } from './TFIDFIndexManager.js';
import { SearchFilterChain, type SearchFilters } from './SearchFilterChain.js';
import type { IndexHealthSnapshot } from '../utils/IIndexHealth.js';
import type { GraphRankPrior } from './GraphRankPrior.js';

/**
 * Events that can change entity text content or corpus membership — the two
 * things the fallback token cache derives from. Relation events are
 * deliberately excluded (relations never feed tokenization).
 */
const TOKEN_CACHE_INVALIDATING_EVENTS: readonly GraphEventType[] = [
  'entity:created',
  'entity:updated',
  'entity:deleted',
  'entity:renamed',
  'observation:added',
  'observation:deleted',
  'graph:saved',
  'graph:loaded',
];

/**
 * Performs TF-IDF ranked search with optional pre-calculated indexes.
 */
export class RankedSearch {
  readonly name: string;
  private indexManager: TFIDFIndexManager | null = null;

  /**
   * Optional graph-connectivity prior. When set with a positive boost, final
   * scores are multiplied by `(1 + boost * normalizedPageRank)`. Default off.
   */
  private graphPrior: GraphRankPrior | null = null;
  private graphBoost: number = 0;

  /**
   * Phase 4 Sprint 2: Fallback token cache for entities.
   * Maps entity name -> pre-tokenized entity data.
   * Invalidated when graph changes (detected by entity count mismatch).
   */
  private fallbackTokenCache: Map<string, TokenizedEntity> = new Map();
  private cachedEntityCount: number = 0;
  private cachedEntityNames: string | null = null;

  /**
   * S1 optimization: event-driven token-cache invalidation.
   *
   * When the storage exposes a GraphEventEmitter (both first-party backends
   * do), `mutationGeneration` is bumped on every event that can change
   * entity text or corpus membership, and the per-query cache check becomes
   * an O(1) generation comparison instead of building an O(N) `namesKey`
   * string. When no emitter is available (e.g. minimal test doubles), the
   * legacy count + namesKey check is kept unchanged as a fallback.
   *
   * The event-driven path is also *more* correct than namesKey: an
   * observation-only update leaves the name set unchanged (namesKey would
   * serve stale tokens) but bumps the generation here.
   */
  private mutationGeneration: number = 0;
  private tokenCacheGeneration: number = -1;
  private eventDriven: boolean;
  private eventUnsubscribers: Array<() => void> = [];

  constructor(
    private storage: IGraphStorage,
    storageDir?: string,
    private cachePressure?: CachePressureCoordinator,
    cacheName: string = 'search-ranked-tokens',
  ) {
    this.name = cacheName;
    this.cachePressure?.register(this);
    // Initialize index manager if storage directory is provided
    if (storageDir) {
      this.indexManager = new TFIDFIndexManager(storageDir);
    }

    // Subscribe for cheap generation-based token-cache invalidation when the
    // storage exposes an event emitter (guarded so structural test doubles
    // without `.events` keep working via the namesKey fallback).
    const events = (storage as { events?: GraphEventEmitter }).events;
    if (events && typeof events.on === 'function') {
      const bump = (): void => {
        this.mutationGeneration++;
      };
      for (const eventType of TOKEN_CACHE_INVALIDATING_EVENTS) {
        this.eventUnsubscribers.push(events.on(eventType, bump));
      }
      this.eventDriven = true;
    } else {
      this.eventDriven = false;
    }
  }

  /**
   * Unsubscribe from storage events. The instance remains usable — cache
   * invalidation reverts to the legacy count + namesKey comparison so
   * searches after a dispose never serve tokens for a changed entity set.
   */
  dispose(): void {
    for (const unsubscribe of this.eventUnsubscribers) {
      unsubscribe();
    }
    this.eventUnsubscribers = [];
    this.eventDriven = false;
    // Force the fallback comparison to treat the next search as cold.
    this.clearTokenCache();
    this.cachedEntityNames = null;
  }

  /**
   * Attach (or detach) a graph-connectivity prior for score boosting.
   *
   * When both a prior and a positive boost are set, `searchNodesRanked`
   * multiplies each result's score by `(1 + boost * normalizedPageRank)`
   * and re-sorts. A boost of 0 (the default) disables the behavior entirely.
   *
   * @param prior - GraphRankPrior instance, or null to detach
   * @param boost - Multiplicative boost factor (default 0 = off)
   * @experimental
   */
  setGraphPrior(prior: GraphRankPrior | null, boost: number = 0): void {
    this.graphPrior = prior;
    this.graphBoost = Number.isFinite(boost) && boost > 0 ? boost : 0;
  }

  /**
   * Phase 4 Sprint 2: Clear the fallback token cache.
   * Called when graph changes are detected or explicitly by external code.
   */
  clearTokenCache(): void {
    this.fallbackTokenCache.clear();
    this.cachedEntityCount = 0;
  }

  /** Tokenized-document entry count for cache-pressure coordination. */
  currentEntries(): number {
    return this.fallbackTokenCache.size;
  }

  /** Evict oldest tokenized documents using Map insertion order. */
  evictTo(targetEntries: number): void {
    const target = Math.max(0, Math.floor(targetEntries));
    while (this.fallbackTokenCache.size > target) {
      const oldest = this.fallbackTokenCache.keys().next().value;
      if (oldest === undefined) break;
      this.fallbackTokenCache.delete(oldest);
    }
  }

  /**
   * Surface the underlying TF-IDF index manager's health. Returns a
   * 'not configured' snapshot when no storageDir was provided to the
   * constructor (in which case there is no on-disk TF-IDF index).
   */
  getIndexHealth(): IndexHealthSnapshot {
    if (!this.indexManager) {
      return {
        name: 'tfidf',
        initialized: false,
        documentCount: 0,
        warnings: ['no storageDir provided to RankedSearch; TF-IDF index disabled'],
      };
    }
    return this.indexManager.health();
  }

  /**
   * Initialize and build the TF-IDF index for fast searches.
   *
   * Should be called after graph changes to keep index up-to-date.
   */
  async buildIndex(): Promise<void> {
    if (!this.indexManager) {
      throw new Error('Index manager not initialized. Provide storageDir to constructor.');
    }

    const graph = await this.storage.loadGraph();
    await this.indexManager.buildIndex(graph);
    await this.indexManager.saveIndex();
  }

  /**
   * Update the index incrementally after entity changes.
   *
   * @param changedEntityNames - Names of entities that were created, updated, or deleted
   */
  async updateIndex(changedEntityNames: Set<string>): Promise<void> {
    if (!this.indexManager) {
      return; // No index manager, skip
    }

    const graph = await this.storage.loadGraph();
    await this.indexManager.updateIndex(graph, changedEntityNames);
    await this.indexManager.saveIndex();
  }

  /**
   * Load the TF-IDF index from disk if available.
   */
  private async ensureIndexLoaded(): Promise<TFIDFIndex | undefined> {
    if (!this.indexManager) {
      return undefined;
    }

    // Return cached index if already loaded
    const cached = this.indexManager.getIndex();
    if (cached) {
      return cached;
    }

    // Try to load from disk
    return await this.indexManager.loadIndex();
  }

  /**
   * Search with TF-IDF relevance ranking.
   *
   * Uses pre-calculated index if available, falls back to on-the-fly calculation.
   *
   * @param query - Search query
   * @param tags - Optional tags filter
   * @param minImportance - Optional minimum importance
   * @param maxImportance - Optional maximum importance
   * @param limit - Maximum results to return (default 50, max 200)
   * @returns Array of search results sorted by relevance
   */
  async searchNodesRanked(
    query: string,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number,
    limit: number = SEARCH_LIMITS.DEFAULT,
    projectId?: string
  ): Promise<SearchResult[]> {
    // Enforce maximum search limit
    const effectiveLimit = Math.min(limit, SEARCH_LIMITS.MAX);
    const graph = await this.storage.loadGraph();

    // Apply tag and importance filters to build the scoring corpus.
    // projectId is intentionally excluded from the pre-score filter: applying it
    // here would collapse the corpus to a single project and cause IDF values to
    // drop to zero (log(N/df) = 0 when N === df), making all scores zero.
    // Instead we score across the full tag/importance-filtered corpus and apply
    // the projectId constraint as a post-score filter so rankings stay meaningful.
    const preFilters: SearchFilters = { tags, minImportance, maxImportance };
    const candidateEntities = SearchFilterChain.applyFilters(graph.entities, preFilters);
    const ftsCandidateNames = await this.getFtsCandidateNames(query, graph.entities.length);
    const scoringEntities = ftsCandidateNames === null
      ? candidateEntities
      : candidateEntities.filter(entity => ftsCandidateNames.has(entity.name));
    if (scoringEntities.length === 0) return [];

    // Try to use pre-calculated index
    const index = await this.ensureIndexLoaded();
    const queryTerms = tokenize(query);

    // Score across the full candidate corpus (no projectId narrowing yet).
    // Pass a large limit so we capture all matches before post-filtering.
    const scoringLimit = projectId ? SEARCH_LIMITS.MAX : effectiveLimit;
    let scored: SearchResult[];
    if (index) {
      scored = this.searchWithIndex(scoringEntities, queryTerms, index, scoringLimit);
    } else {
      scored = this.searchWithoutIndex(
        scoringEntities,
        queryTerms,
        scoringLimit,
        candidateEntities,
      );
    }

    // Apply projectId filter post-scoring to preserve IDF corpus integrity
    if (projectId) {
      scored = scored.filter(r => r.entity.projectId === projectId);
    }

    // Optional graph-connectivity boost (off unless setGraphPrior enabled it)
    scored = await this.applyGraphBoost(scored);

    return scored.slice(0, effectiveLimit);
  }

  /**
   * Retrieve lexical candidates from a storage-native FTS index when one is
   * available. A null result means "capability unavailable"; an empty Set is
   * a valid indexed no-match result and avoids an in-memory corpus scan.
   */
  private async getFtsCandidateNames(
    query: string,
    corpusSize: number,
  ): Promise<Set<string> | null> {
    if (!this.storage.fullTextSearch) return null;
    await this.storage.ensureLoaded();
    const matches = await this.storage.fullTextSearch(query, {
      // Retrieve every FTS match so tag/importance post-filtering cannot
      // hide a lower-ranked but eligible candidate.
      limit: Math.max(corpusSize, 1),
    });
    return new Set(matches.map(match => match.name));
  }

  /**
   * Multiply each result's score by `(1 + boost * normalizedPageRank)` and
   * re-sort. No-op when no prior/boost is configured (the default).
   */
  private async applyGraphBoost(results: SearchResult[]): Promise<SearchResult[]> {
    if (!this.graphPrior || this.graphBoost <= 0 || results.length === 0) {
      return results;
    }

    const priorScores = await this.graphPrior.getScores(results.map(r => r.entity.name));
    return results
      .map(r => ({
        ...r,
        score: r.score * (1 + this.graphBoost * (priorScores.get(r.entity.name) ?? 0)),
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Search using pre-calculated TF-IDF index (fast path).
   */
  private searchWithIndex(
    entities: Entity[],
    queryTerms: string[],
    index: TFIDFIndex,
    limit: number
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entity of entities) {
      const docVector = index.documents.get(entity.name);
      if (!docVector) {
        continue; // Entity not in index
      }

      // Calculate total terms in document (sum of all term frequencies)
      const totalTerms = Object.values(docVector.terms).reduce((sum, count) => sum + count, 0);
      if (totalTerms === 0) continue;

      // Calculate score using pre-calculated term frequencies and IDF
      let totalScore = 0;
      const matchedFields: SearchResult['matchedFields'] = {};

      for (const term of queryTerms) {
        const termCount = docVector.terms[term] || 0;
        const idf = index.idf.get(term) || 0;

        // Calculate TF-IDF: (termCount / totalTerms) * IDF
        const tf = termCount / totalTerms;
        const tfidf = tf * idf;
        totalScore += tfidf;

        // Track which fields matched
        if (termCount > 0) {
          if (entity.name.toLowerCase().includes(term)) {
            matchedFields.name = true;
          }
          if (entity.entityType.toLowerCase().includes(term)) {
            matchedFields.entityType = true;
          }
          const matchedObs = entity.observations.filter(o =>
            o.toLowerCase().includes(term)
          );
          if (matchedObs.length > 0) {
            matchedFields.observations = matchedObs;
          }
        }
      }

      // Only include entities with non-zero scores
      if (totalScore > 0) {
        results.push({
          entity,
          score: totalScore,
          matchedFields,
        });
      }
    }

    // Sort by score descending and apply limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Search without index (on-the-fly calculation, slow path).
   *
   * OPTIMIZED: Phase 4 Sprint 2 - Uses fallback token cache to avoid
   * repeated tokenization of entities. Pre-tokenizes all documents once
   * and caches for subsequent searches.
   */
  private searchWithoutIndex(
    entities: Entity[],
    queryTerms: string[],
    limit: number,
    corpusEntities: Entity[] = entities,
  ): SearchResult[] {
    const results: SearchResult[] = [];

    // Check if cache needs invalidation.
    if (this.eventDriven) {
      // S1: O(1) generation comparison — the generation is bumped by storage
      // events for every mutation that can change entity text or membership,
      // so no per-query O(N) namesKey string is needed. Cache entries are
      // keyed by entity name and independent of the (possibly filtered)
      // subset passed in, so subset changes never require invalidation.
      if (this.mutationGeneration !== this.tokenCacheGeneration) {
        this.clearTokenCache();
        this.tokenCacheGeneration = this.mutationGeneration;
      }
    } else {
      // Legacy fallback (storage without an event emitter): check both count
      // and entity name set to detect renames/replacements.
      const namesKey = corpusEntities.map(e => e.name).join('\0');
      if (
        corpusEntities.length !== this.cachedEntityCount
        || namesKey !== this.cachedEntityNames
      ) {
        this.clearTokenCache();
        this.cachedEntityCount = corpusEntities.length;
        this.cachedEntityNames = namesKey;
      }
    }

    // Phase 4 Sprint 2: Get or compute tokenized data for each entity
    const documentData: TokenizedEntity[] = corpusEntities.map(e => {
      // Check cache first
      const cached = this.fallbackTokenCache.get(e.name);
      if (cached) {
        return cached;
      }

      // Compute and cache tokenized data
      const text = [e.name, e.entityType, ...e.observations].join(' ');
      const tokens = tokenize(text);
      const tokenized: TokenizedEntity = {
        entity: e,
        text,
        tokens,
        tokenSet: new Set(tokens),
      };
      this.fallbackTokenCache.set(e.name, tokenized);
      return tokenized;
    });
    this.cachePressure?.evictIfOverBudget();
    const candidateNames = entities === corpusEntities
      ? null
      : new Set(entities.map(entity => entity.name));
    const scoringDocuments = candidateNames === null
      ? documentData
      : documentData.filter(doc => candidateNames.has(doc.entity.name));

    // Pre-compute token sets for IDF calculation
    const tokenSets = documentData.map(d => d.tokenSet);

    // S1: IDF is a per-term corpus constant (loop-invariant across
    // documents), so hoist it out of the per-document loop. Computing it
    // inside the loop rescanned all N token sets per (document, term) pair —
    // O(N^2 * terms). This single pass is O(N * terms) and, because
    // calculateIDFFromTokenSets is deterministic in (term, tokenSets),
    // produces bit-identical scores.
    const idfByTerm = new Map<string, number>();
    for (const term of queryTerms) {
      if (!idfByTerm.has(term)) {
        idfByTerm.set(term, calculateIDFFromTokenSets(term, tokenSets));
      }
    }

    for (const docData of scoringDocuments) {
      const { entity, tokens } = docData;

      // Calculate score for each query term
      let totalScore = 0;
      const matchedFields: SearchResult['matchedFields'] = {};

      for (const term of queryTerms) {
        // Calculate TF using pre-tokenized tokens (O(T) vs O(N) re-tokenization)
        const tf = calculateTFFromTokens(term, tokens);

        // IDF from the per-query hoisted map (O(1) per document)
        const idf = idfByTerm.get(term) ?? 0;

        // TF-IDF score
        const score = tf * idf;
        totalScore += score;

        // Track which fields matched
        if (entity.name.toLowerCase().includes(term)) {
          matchedFields.name = true;
        }
        if (entity.entityType.toLowerCase().includes(term)) {
          matchedFields.entityType = true;
        }
        const matchedObs = entity.observations.filter(o =>
          o.toLowerCase().includes(term)
        );
        if (matchedObs.length > 0) {
          matchedFields.observations = matchedObs;
        }
      }

      // Only include entities with non-zero scores
      if (totalScore > 0) {
        results.push({
          entity,
          score: totalScore,
          matchedFields,
        });
      }
    }

    // Sort by score descending and apply limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
