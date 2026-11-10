/**
 * Fuzzy Search
 *
 * Search with typo tolerance using Levenshtein distance similarity.
 * Uses workerpool for parallel processing on large datasets.
 *
 * @module search/FuzzySearch
 */

import type { Entity, KnowledgeGraph, LowercaseData } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import type { CachePressureCoordinator } from '../utils/CachePressureCoordinator.js';
import { levenshteinDistance } from '../utils/index.js';
import { logger } from '../utils/logger.js';
import { cleanupExpiredEntries, evictOldest, getGraphGenerations } from '../utils/searchCache.js';
import { FUZZY_SEARCH_LIMITS, SEARCH_LIMITS } from '../utils/constants.js';
import { SearchFilterChain, type SearchFilters } from './SearchFilterChain.js';
import { NGramIndex } from './NGramIndex.js';
import type { BloomPreScreener } from './BloomPreScreener.js';
import { collectInducedRelations } from './inducedSubgraph.js';
import type { WorkerInput } from '../workers/levenshteinWorker.js';
import workerpool, { type Pool } from '@danielsimonjr/workerpool';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';
import { existsSync } from 'fs';

/**
 * Default fuzzy search similarity threshold (70% match required).
 * Lower values are more permissive (more typos tolerated).
 * Higher values are stricter (fewer typos tolerated).
 */
export const DEFAULT_FUZZY_THRESHOLD = 0.7;

/**
 * Phase 4 Sprint 3: Cache entry for fuzzy search results.
 */
interface FuzzyCacheEntry {
  /** Cached entity names that matched */
  entityNames: string[];
  /** Entity count when cache was created (for invalidation) */
  entityCount: number;
  /** Storage mutation generation; count alone misses same-size updates. */
  entityGeneration: number;
  /** Timestamp when cached */
  timestamp: number;
}

/**
 * Phase 4 Sprint 3: Maximum cache size to prevent memory bloat.
 */
const FUZZY_CACHE_MAX_SIZE = 100;

/**
 * Phase 4 Sprint 3: Cache TTL in milliseconds (5 minutes).
 */
const FUZZY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Phase 7 Sprint 3: Minimum number of entities to activate worker pool.
 */
const WORKER_MIN_ENTITIES = 500;

/**
 * Phase 7 Sprint 3: Maximum threshold for worker pool activation.
 * Higher thresholds have fewer matches, so single-threaded is faster.
 */
const WORKER_MAX_THRESHOLD = 0.8;

/** Amortize worker scheduling over useful text, rather than host CPU count alone. */
const WORKER_TARGET_CHARACTERS = 64 * 1024;
const WORKER_MIN_CHUNK_ENTITIES = 250;

/**
 * Match result from worker.
 */
interface MatchResult {
  name: string;
  score: number;
  matchedIn: 'name' | 'type' | 'observation';
}

/**
 * Options for FuzzySearch constructor.
 */
export interface FuzzySearchOptions {
  /**
   * Whether to use worker pool for parallel processing.
   * Set to false for testing or when workers are not available.
   * Default: true
   */
  useWorkerPool?: boolean;

  /** Optional NGramIndex used only with approximatePrefilter enabled. */
  ngramIndex?: NGramIndex;

  /**
   * Allow n-gram/Bloom candidate rejection, which can lose valid fuzzy matches.
   * Default false: exact recall is retained even when indexes are attached.
   */
  approximatePrefilter?: boolean;

  /**
   * Jaccard similarity threshold used when querying the NGramIndex prefilter.
   * Lower values allow more candidates through (safer, less filtering).
   * Default: 0.1
   */
  ngramThreshold?: number;

  /** Optional global cache-pressure coordinator supplied by ManagerContext. */
  cachePressure?: CachePressureCoordinator;
}

/**
 * Performs fuzzy search with configurable similarity threshold.
 */
export class FuzzySearch {
  readonly name = 'search-fuzzy';

  /**
   * Phase 4 Sprint 3: Result cache for fuzzy search.
   * Maps cache key -> cached entity names.
   */
  private fuzzyResultCache: Map<string, FuzzyCacheEntry> = new Map();

  /**
   * Phase 8: Worker pool using workerpool library.
   * Initialized lazily when needed.
   */
  private workerPool: Pool | null = null;

  /** Storage replaces lowercase records on mutation; old payloads are collected automatically. */
  private workerEntityCache = new WeakMap<LowercaseData, WorkerInput['entities'][number]>();

  /**
   * Phase 7 Sprint 3: Path to the worker script.
   */
  private workerPath: string;

  /**
   * Phase 8: Whether to use worker pool for parallel processing.
   * Can be disabled for testing or when workers are not available.
   */
  private useWorkerPool: boolean;

  /**
   * Feature 6: Optional NGramIndex used as a prefilter before Levenshtein.
   * When set, only the candidate set returned by the NGramIndex is passed to
   * `performFuzzyMatch`, potentially skipping most of the corpus.
   */
  private ngramIndex: NGramIndex | null;

  /**
   * Feature 6: Jaccard threshold for NGramIndex prefilter queries.
   */
  private ngramThreshold: number;
  private approximatePrefilter: boolean;
  private cachePressure?: CachePressureCoordinator;

  /**
   * Optional exact-token pre-screener. Candidate rejection is approximate
   * for fuzzy matching and only runs with approximatePrefilter enabled.
   */
  private bloomPreScreener: BloomPreScreener | null = null;

  constructor(private storage: GraphStorage, options: FuzzySearchOptions = {}) {
    this.useWorkerPool = options.useWorkerPool ?? true;
    this.ngramIndex = options.ngramIndex ?? null;
    this.ngramThreshold = options.ngramThreshold ?? 0.1;
    this.approximatePrefilter = options.approximatePrefilter ?? false;
    this.cachePressure = options.cachePressure;
    this.cachePressure?.register(this);
    // Resolve the Levenshtein worker across every build layout. The worker
    // always ships at dist/workers/levenshteinWorker.{js,cjs}, but the file
    // that runs THIS code can live at several depths depending on the build:
    //   - dist/search/FuzzySearch.js         (unbundled tsc; currentDir=dist/search)
    //   - dist/search/index.js               (tsup subpath entry; currentDir=dist/search)
    //   - dist/<hash>.js  or  dist/index.js  (tsup shared chunk / root bundle; currentDir=dist)
    //   - dist/cli/index.js                  (CLI bundle; currentDir=dist/cli)
    //   - src/search/FuzzySearch.ts          (vitest; worker lives under <root>/dist)
    // A single hard-coded relative path only matched the unbundled dist/search
    // case, so bundled consumers silently lost the worker pool. Probe an
    // ordered candidate list and take the first that exists.
    const currentFileUrl = import.meta.url;
    const currentDir = dirname(fileURLToPath(currentFileUrl));
    const resolved = FuzzySearch.resolveWorkerPath(currentFileUrl, currentDir);

    if (resolved) {
      this.workerPath = resolved;
    } else {
      // No worker binary found for any known layout — run single-threaded.
      this.workerPath = normalize(join(currentDir, '..', 'workers', 'levenshteinWorker.js'));
      this.useWorkerPool = false;
    }
  }

  /**
   * Resolve the Levenshtein worker path across all build layouts.
   *
   * Extension preference follows the caller's own module extension (a `.cjs`
   * bundle prefers the CJS worker, otherwise the ESM `.js` worker) so the
   * spawned worker matches the host's module system; the other extension is
   * still tried as a fallback. Returns the first existing candidate, or
   * `null` when no worker binary is present (single-threaded fallback).
   *
   * Exposed (via a static method) so the resolution logic is unit-testable
   * without constructing a full `FuzzySearch` against real storage.
   */
  static resolveWorkerPath(moduleUrl: string, currentDir: string): string | null {
    const preferCjs = moduleUrl.endsWith('.cjs');
    const exts = preferCjs ? ['.cjs', '.js'] : ['.js', '.cjs'];

    // Directory roots that may contain a sibling/descendant `workers/` dir,
    // ordered from most- to least-specific relative to `currentDir`.
    const workerDirs = [
      join(currentDir, 'workers'), // currentDir = dist root (bundled chunk/root)
      join(currentDir, '..', 'workers'), // currentDir = dist/search | dist/cli
      join(currentDir, '..', '..', 'dist', 'workers'), // src/search during tests
      join(currentDir, '..', 'dist', 'workers'), // src root fallback
      join(currentDir, '..', '..', 'workers'), // deeper nesting fallback
    ];

    for (const dir of workerDirs) {
      for (const ext of exts) {
        const candidate = normalize(join(dir, `levenshteinWorker${ext}`));
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  /**
   * Phase 4 Sprint 3: Generate cache key for fuzzy search parameters.
   */
  private generateCacheKey(
    query: string,
    threshold: number,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number,
    offset?: number,
    limit?: number,
    projectId?: string
  ): string {
    return JSON.stringify({
      q: query.toLowerCase(),
      t: threshold,
      tags: tags ? [...tags].sort() : [],
      min: minImportance,
      max: maxImportance,
      off: offset,
      lim: limit,
      pid: projectId,
    });
  }

  /**
   * Set (or replace) the index used in approximatePrefilter mode.
   *
   * The index should already be populated with the same documents that are
   * stored in the backing `GraphStorage`. This heuristic is inactive unless
   * approximatePrefilter is enabled. Setting null disables the heuristic.
   *
   * @param index - Populated NGramIndex, or null to disable prefiltering.
   * @param threshold - Optional Jaccard threshold override (default: 0.1).
   */
  setNgramIndex(index: NGramIndex | null, threshold?: number): void {
    this.ngramIndex = index;
    this.clearCache();
    if (threshold !== undefined) {
      this.ngramThreshold = threshold;
    }
  }

  /** Explicitly allow recall-losing n-gram/Bloom rejection (disabled by default). */
  setApproximatePrefilter(enabled: boolean): void {
    this.approximatePrefilter = enabled;
    this.clearCache();
  }

  /**
   * Feature 6: Return the currently attached NGramIndex (or null).
   */
  getNgramIndex(): NGramIndex | null {
    return this.ngramIndex;
  }

  /**
   * Phase 4 Sprint 3: Clear the fuzzy search cache.
   */
  clearCache(): void {
    this.fuzzyResultCache.clear();
  }

  /** Result entry count for cache-pressure coordination. */
  currentEntries(): number {
    return this.fuzzyResultCache.size;
  }

  /** Drop oldest cached results until at or below `targetEntries`. */
  evictTo(targetEntries: number): void {
    const target = Math.max(0, Math.floor(targetEntries));
    evictOldest(this.fuzzyResultCache, target, entry => entry.timestamp);
  }

  /**
   * Attach a `BloomPreScreener` for opt-in candidate pre-screening.
   * Pass `null` to detach. The screener narrows the candidate set
   * before the Levenshtein scan only in approximatePrefilter mode.
   * Verification removes false positives, but cannot restore excluded matches.
   */
  setBloomPreScreener(screener: BloomPreScreener | null): void {
    this.bloomPreScreener = screener;
    this.fuzzyResultCache.clear(); // candidate-set change invalidates cache
  }

  /** Whether a `BloomPreScreener` is currently attached. */
  hasBloomPreScreener(): boolean {
    return this.bloomPreScreener !== null;
  }

  /**
   * Phase 4 Sprint 3: Invalidate stale cache entries.
   */
  private cleanupCache(): void {
    cleanupExpiredEntries(
      this.fuzzyResultCache,
      FUZZY_CACHE_TTL_MS,
      FUZZY_CACHE_MAX_SIZE,
      entry => entry.timestamp
    );
  }

  /**
   * Fuzzy search for entities with typo tolerance and pagination.
   *
   * Uses Levenshtein distance to calculate similarity between strings.
   * Matches if similarity >= threshold (0.0 to 1.0).
   *
   * Phase 4 Sprint 3: Implements result caching for repeated queries.
   *
   * @param query - Search query
   * @param threshold - Similarity threshold (0.0 to 1.0), default DEFAULT_FUZZY_THRESHOLD
   * @param tags - Optional tags filter
   * @param minImportance - Optional minimum importance
   * @param maxImportance - Optional maximum importance
   * @param offset - Number of results to skip (default: 0)
   * @param limit - Maximum number of results (default: 50, max: 200)
   * @returns Filtered knowledge graph with fuzzy matches and pagination applied
   */
  async fuzzySearch(
    query: string,
    threshold: number = DEFAULT_FUZZY_THRESHOLD,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number,
    offset: number = 0,
    limit: number = SEARCH_LIMITS.DEFAULT,
    projectId?: string
  ): Promise<KnowledgeGraph> {
    if (query.length > FUZZY_SEARCH_LIMITS.MAX_QUERY_LENGTH) {
      throw new RangeError(
        `Fuzzy search query exceeds maximum length of ${FUZZY_SEARCH_LIMITS.MAX_QUERY_LENGTH}`
      );
    }

    const graph = await this.storage.loadGraph();
    const queryLower = query.toLowerCase();
    const entityGeneration = getGraphGenerations(this.storage).entity;

    // Phase 4 Sprint 3: Generate cache key and check cache
    const cacheKey = this.generateCacheKey(query, threshold, tags, minImportance, maxImportance, offset, limit, projectId);
    const cached = this.fuzzyResultCache.get(cacheKey);

    // Check if cache is valid (entity count hasn't changed)
    if (cached && cached.entityCount === graph.entities.length && cached.entityGeneration === entityGeneration) {
      const now = Date.now();
      if (now - cached.timestamp < FUZZY_CACHE_TTL_MS) {
        // Return cached results
        const cachedNameSet = new Set(cached.entityNames);
        const cachedEntities = graph.entities.filter(e => cachedNameSet.has(e.name));
        const cachedRelations = collectInducedRelations(this.storage, cachedNameSet);
        return { entities: cachedEntities, relations: cachedRelations };
      }
    }

    // Resolve version visibility from the complete graph before narrowing candidates.
    const filters: SearchFilters = { tags, minImportance, maxImportance, projectId };
    const versionContext = {
      visibleSupersededNames: SearchFilterChain.publishedAncestorsOfDraftHeads(graph.entities),
    };
    const eligibleEntities = SearchFilterChain.applyFilters(graph.entities, filters, versionContext);

    // These heuristics cannot prove rejection under substring/word fuzzy
    // semantics. Use them only when the caller explicitly accepts recall loss.
    let candidateEntities: readonly Entity[] = eligibleEntities;
    if (this.approximatePrefilter && this.ngramIndex) {
      const candidateIds = new Set(this.ngramIndex.query(query, this.ngramThreshold));
      if (candidateIds.size > 0) {
        candidateEntities = candidateEntities.filter(e => candidateIds.has(e.name));
      }
      // If the NGramIndex returns zero candidates, fall back to full scan to
      // avoid missing results (can happen for very short queries or very high
      // threshold values).
    }

    // Phase 4 follow-up: optional Bloom pre-screen layered AFTER the
    // NGram prefilter. The Bloom filter operates on EXACT-match
    // tokens — but fuzzy search is specifically for queries that
    // DON'T exact-match (e.g. "Alise" finding "Alice" at Levenshtein
    // distance 1). When the screener returns zero candidates we
    // therefore fall back to the larger candidate set rather than
    // trust the empty result; Levenshtein then has the chance to
    // find tolerant matches the Bloom filter couldn't see.
    // Lazy build: a write clears the screener (see ManagerContext wiring), so
    // the first search after a write rebuilds it from the current graph.
    if (this.approximatePrefilter && this.bloomPreScreener && !this.bloomPreScreener.isBuilt() && graph.entities.length > 0) {
      await this.bloomPreScreener.build();
    }
    if (this.approximatePrefilter && this.bloomPreScreener && this.bloomPreScreener.isBuilt()) {
      const screened = new Set(this.bloomPreScreener.intersectCandidates(query));
      if (screened.size > 0 && screened.size < candidateEntities.length) {
        candidateEntities = candidateEntities.filter((e) => screened.has(e.name));
      }
    }

    // Phase 7 Sprint 3: Use worker pool for large graphs with low thresholds
    // Phase 8: Respect useWorkerPool flag for testing
    const shouldUseWorkers =
      this.useWorkerPool &&
      candidateEntities.length >= WORKER_MIN_ENTITIES &&
      threshold < WORKER_MAX_THRESHOLD;

    let fuzzyMatched: Entity[];

    if (shouldUseWorkers) {
      fuzzyMatched = await this.searchWithWorkers(query, threshold, candidateEntities as Entity[]);
    } else {
      // Perform single-threaded fuzzy search
      fuzzyMatched = this.performFuzzyMatch(candidateEntities, queryLower, threshold);
    }

    // Apply pagination using SearchFilterChain
    const pagination = SearchFilterChain.validatePagination(offset, limit);
    const paginatedEntities = SearchFilterChain.paginate(fuzzyMatched, pagination);

    // Phase 4 Sprint 3: Cache the results
    this.fuzzyResultCache.set(cacheKey, {
      entityNames: paginatedEntities.map(e => e.name),
      entityCount: graph.entities.length,
      entityGeneration,
      timestamp: Date.now(),
    });
    this.cachePressure?.evictIfOverBudget();

    // Cleanup old cache entries periodically
    if (this.fuzzyResultCache.size > FUZZY_CACHE_MAX_SIZE / 2) {
      this.cleanupCache();
    }

    const filteredEntityNames = new Set(paginatedEntities.map(e => e.name));
    const filteredRelations = collectInducedRelations(this.storage, filteredEntityNames);

    return {
      entities: paginatedEntities,
      relations: filteredRelations,
    };
  }

  /**
   * Phase 4 Sprint 3: Perform the actual fuzzy matching logic.
   * Extracted from fuzzySearch for cleaner code structure.
   */
  private performFuzzyMatch(entities: readonly Entity[], queryLower: string, threshold: number): Entity[] {
    return entities.filter(e => {
      const lowercased = this.storage.getLowercased(e.name);

      // Check name match (use pre-computed lowercase)
      const nameLower = this.truncateField(
        lowercased?.name
          ?? e.name.slice(0, FUZZY_SEARCH_LIMITS.MAX_NAME_LENGTH).toLowerCase(),
        FUZZY_SEARCH_LIMITS.MAX_NAME_LENGTH
      );
      if (this.isFuzzyMatchLower(nameLower, queryLower, threshold)) return true;

      // Check type match (use pre-computed lowercase)
      const typeLower = this.truncateField(
        lowercased?.entityType
          ?? e.entityType.slice(0, FUZZY_SEARCH_LIMITS.MAX_NAME_LENGTH).toLowerCase(),
        FUZZY_SEARCH_LIMITS.MAX_NAME_LENGTH
      );
      if (this.isFuzzyMatchLower(typeLower, queryLower, threshold)) return true;

      // Check observations (use pre-computed lowercase array)
      const obsLower = lowercased?.observations
        ? lowercased.observations.map(o =>
          this.truncateField(o, FUZZY_SEARCH_LIMITS.MAX_OBSERVATION_LENGTH))
        : e.observations.map(o =>
          o.slice(0, FUZZY_SEARCH_LIMITS.MAX_OBSERVATION_LENGTH).toLowerCase());
      return obsLower.some(
        o =>
          // For observations, split into words and check each word
          o
            .split(/\s+/)
            .some(word => this.isFuzzyMatchLower(word, queryLower, threshold)) ||
          // Also check if the observation contains the query
          this.isFuzzyMatchLower(o, queryLower, threshold)
      );
    }) as Entity[];
  }

  private truncateField(value: string, maxLength: number): string {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  /**
   * Check if two already-lowercase strings match with fuzzy logic.
   *
   * OPTIMIZED: Skips toLowerCase() calls when strings are already lowercase.
   *
   * @param s1 - First string (already lowercase)
   * @param s2 - Second string (already lowercase)
   * @param threshold - Similarity threshold (0.0 to 1.0)
   * @returns True if strings match fuzzily
   */
  private isFuzzyMatchLower(s1: string, s2: string, threshold: number = 0.7): boolean {
    if (threshold <= 0) return true;

    // Exact match
    if (s1 === s2) return true;

    // One contains the other
    if (s1.includes(s2) || s2.includes(s1)) return true;

    // Calculate similarity using Levenshtein distance
    const maxLength = Math.max(s1.length, s2.length);
    const maxDistance = Math.floor(
      (1 - threshold) * maxLength + Number.EPSILON * maxLength
    );
    if (Math.abs(s1.length - s2.length) > maxDistance) return false;
    const distance = levenshteinDistance(s1, s2, maxDistance);
    const similarity = 1 - distance / maxLength;

    return similarity >= threshold;
  }

  /**
   * Phase 8: Perform fuzzy search using workerpool for parallel processing.
   *
   * Splits entities into chunks and processes them in parallel using worker threads.
   * Returns completed worker results when a worker fails or times out. It does
   * not repeat the same unbounded workload synchronously.
   *
   * @param query - Search query
   * @param threshold - Similarity threshold
   * @param entities - Entities to search
   * @returns Array of matched entities
   */
  private async searchWithWorkers(
    query: string,
    threshold: number,
    entities: Entity[]
  ): Promise<Entity[]> {
    try {
      const prepared = entities.map(entity => this.prepareWorkerEntity(entity));
      const textCharacters = prepared.reduce((sum, entity) => sum + entity.nameLower.length +
        (entity.entityTypeLower?.length ?? 0) + entity.observations.reduce((n, obs) => n + obs.length, 0), 0);
      const numWorkers = Math.max(1, Math.min(
        Math.max(1, workerpool.cpus - 1),
        Math.ceil(entities.length / WORKER_MIN_CHUNK_ENTITIES),
        Math.ceil(textCharacters / WORKER_TARGET_CHARACTERS),
      ));
      // Start only as many workers as the first workload can use. Later larger
      // searches can queue chunks on this pool without oversubscribing the host.
      if (!this.workerPool) {
        const workerThreadOpts = { type: 'module' } as Record<string, unknown>;
        this.workerPool = workerpool.pool(this.workerPath, {
          maxWorkers: numWorkers,
          workerType: 'thread',
          workerThreadOpts,
        });
      }
      const chunkSize = Math.max(1, Math.ceil(entities.length / numWorkers));
      const workerInputs: WorkerInput[] = [];
      for (let i = 0; i < prepared.length; i += chunkSize) {
        workerInputs.push({ query, threshold, normalized: true, entities: prepared.slice(i, i + chunkSize) });
      }

      // Execute all chunks in parallel using workerpool with timeout
      const WORKER_TIMEOUT_MS = 30000; // 30 seconds
      const settledResults = await Promise.allSettled(
        workerInputs.map(input =>
          this.workerPool!.exec('searchEntities', [input])
            .timeout(WORKER_TIMEOUT_MS) as Promise<MatchResult[]>
        )
      );
      const results: MatchResult[][] = [];
      let failedWorkers = 0;
      for (const result of settledResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          failedWorkers++;
        }
      }
      if (failedWorkers > 0) {
        logger.warn(
          `${failedWorkers} of ${settledResults.length} fuzzy search workers failed or timed out; ` +
          'returning partial results without a synchronous retry'
        );
      }

      // Flatten results and extract matched entity names
      const matchedNames = new Set(results.flat().map(r => r.name));

      // Return entities that matched
      return entities.filter(e => matchedNames.has(e.name));
    } catch (error) {
      // Do not defeat worker timeouts by repeating the same workload on the
      // main thread.
      logger.warn(
        `Worker pool execution failed; returning no fuzzy matches: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return [];
    }
  }

  /** Build a bounded payload once per immutable storage lowercase record. */
  private prepareWorkerEntity(entity: Entity): WorkerInput['entities'][number] {
    const lower = this.storage.getLowercased(entity.name);
    const cached = lower && this.workerEntityCache.get(lower);
    if (cached && cached.name === entity.name) return cached;
    const prepared = {
      name: entity.name,
      nameLower: this.truncateField(lower?.name ?? entity.name.toLowerCase(), FUZZY_SEARCH_LIMITS.MAX_NAME_LENGTH),
      entityTypeLower: this.truncateField(lower?.entityType ?? entity.entityType.toLowerCase(), FUZZY_SEARCH_LIMITS.MAX_NAME_LENGTH),
      observations: (lower?.observations ?? entity.observations.map(o => o.toLowerCase()))
        .map(o => this.truncateField(o, FUZZY_SEARCH_LIMITS.MAX_OBSERVATION_LENGTH)),
    };
    if (lower) this.workerEntityCache.set(lower, prepared);
    return prepared;
  }

  /**
   * Phase 8: Shutdown the worker pool and clean up resources.
   *
   * Should be called when FuzzySearch is no longer needed.
   */
  async shutdown(): Promise<void> {
    if (this.workerPool) {
      await this.workerPool.terminate();
      this.workerPool = null;
    }
  }
}
