/**
 * BM25 Search
 *
 * BM25 (Best Matching 25) relevance scoring algorithm for lexical search.
 * Provides improved ranking over TF-IDF by incorporating document length normalization.
 *
 * Phase 12 Sprint 3: Search Algorithm Optimization
 *
 * @module search/BM25Search
 */

import type { Entity, SearchResult } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import { SEARCH_LIMITS } from '../utils/constants.js';

/**
 * Common English stopwords to filter from queries and documents.
 * These words are too common to provide meaningful ranking signal.
 */
export const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'to', 'was', 'were', 'will', 'with', 'you', 'your',
  'this', 'but', 'they', 'have', 'had', 'what', 'when', 'where',
  'who', 'which', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can',
  'just', 'should', 'now', 'also', 'being', 'been', 'would',
  'could', 'into', 'over', 'after', 'before', 'between', 'under',
  'again', 'then', 'once', 'here', 'there', 'any', 'about',
]);

/**
 * BM25 index entry for a single document.
 */
export interface BM25DocumentEntry {
  /** Entity name */
  entityName: string;
  /** Term frequencies in this document */
  termFreqs: Map<string, number>;
  /** Total number of tokens in document */
  docLength: number;
}

/**
 * BM25 index structure.
 */
export interface BM25Index {
  /** Document entries keyed by entity name */
  documents: Map<string, BM25DocumentEntry>;
  /** Document frequency for each term (number of docs containing term) */
  documentFrequency: Map<string, number>;
  /** Average document length */
  avgDocLength: number;
  /** Total number of documents */
  totalDocs: number;
}

/**
 * BM25 configuration parameters.
 */
export interface BM25Config {
  /** Term frequency saturation parameter (default: 1.2) */
  k1: number;
  /** Length normalization parameter (default: 0.75) */
  b: number;
}

/**
 * Default BM25 parameters based on research recommendations.
 */
export const DEFAULT_BM25_CONFIG: BM25Config = {
  k1: 1.2,
  b: 0.75,
};

/**
 * BM25 Search implementation.
 *
 * BM25 improves over TF-IDF by:
 * 1. Saturating term frequency - prevents long documents from dominating
 * 2. Document length normalization - accounts for varying document sizes
 *
 * Formula:
 * score(D,Q) = sum_i( IDF(qi) * (f(qi,D) * (k1 + 1)) / (f(qi,D) + k1 * (1 - b + b * |D|/avgdl)) )
 *
 * Where:
 * - f(qi,D) is the term frequency of qi in document D
 * - |D| is the length of document D
 * - avgdl is the average document length
 * - k1 and b are free parameters
 *
 * @example
 * ```typescript
 * const bm25 = new BM25Search(storage);
 * await bm25.buildIndex();
 * const results = await bm25.search('machine learning');
 * ```
 */
export class BM25Search {
  private index: BM25Index | null = null;
  private config: BM25Config;

  constructor(
    private storage: GraphStorage,
    config: Partial<BM25Config> = {}
  ) {
    this.config = { ...DEFAULT_BM25_CONFIG, ...config };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): BM25Config {
    return { ...this.config };
  }

  /**
   * Update configuration parameters.
   *
   * @param config - New configuration values
   */
  setConfig(config: Partial<BM25Config>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Tokenize text into lowercase terms with stopword filtering.
   *
   * @param text - Text to tokenize
   * @param filterStopwords - Whether to filter stopwords (default: true)
   * @returns Array of lowercase tokens
   */
  tokenize(text: string, filterStopwords: boolean = true): string[] {
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0);

    if (filterStopwords) {
      return tokens.filter(token => !STOPWORDS.has(token));
    }
    return tokens;
  }

  /**
   * Build the BM25 index from the current graph.
   *
   * Should be called after significant graph changes.
   */
  async buildIndex(): Promise<void> {
    const graph = await this.storage.loadGraph();
    const documents = new Map<string, BM25DocumentEntry>();
    const documentFrequency = new Map<string, number>();
    const termsSeen = new Set<string>();
    let totalDocLength = 0;

    // First pass: tokenize all documents and count term frequencies
    for (const entity of graph.entities) {
      const text = this.entityToText(entity);
      const tokens = this.tokenize(text);
      const termFreqs = new Map<string, number>();

      // Count term frequencies for this document
      for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
      }

      // Track which terms appear in this document (for IDF calculation)
      termsSeen.clear();
      for (const token of tokens) {
        if (!termsSeen.has(token)) {
          termsSeen.add(token);
          documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
        }
      }

      const entry: BM25DocumentEntry = {
        entityName: entity.name,
        termFreqs,
        docLength: tokens.length,
      };

      documents.set(entity.name, entry);
      totalDocLength += tokens.length;
    }

    const totalDocs = documents.size;
    const avgDocLength = totalDocs > 0 ? totalDocLength / totalDocs : 0;

    this.index = {
      documents,
      documentFrequency,
      avgDocLength,
      totalDocs,
    };
  }

  /**
   * Search using the BM25 algorithm.
   *
   * @param query - Search query
   * @param limit - Maximum results to return
   * @returns Array of search results sorted by BM25 score
   */
  async search(query: string, limit: number = SEARCH_LIMITS.DEFAULT): Promise<SearchResult[]> {
    const effectiveLimit = Math.min(limit, SEARCH_LIMITS.MAX);

    // Ensure index is built
    if (!this.index) {
      await this.buildIndex();
    }

    if (!this.index || this.index.documents.size === 0) {
      return [];
    }

    const graph = await this.storage.loadGraph();
    const entityMap = new Map(graph.entities.map(e => [e.name, e]));

    // Tokenize query
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) {
      return [];
    }

    const { k1, b } = this.config;
    const { documents, documentFrequency, avgDocLength, totalDocs } = this.index;
    const results: SearchResult[] = [];

    // Calculate BM25 score for each document
    for (const [entityName, docEntry] of documents) {
      const entity = entityMap.get(entityName);
      if (!entity) continue;

      let score = 0;
      const matchedFields: SearchResult['matchedFields'] = {};

      for (const term of queryTerms) {
        const tf = docEntry.termFreqs.get(term) || 0;
        if (tf === 0) continue;

        // Calculate IDF
        const df = documentFrequency.get(term) || 0;
        const idf = df > 0 ? Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1) : 0;

        // Calculate BM25 score component
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docEntry.docLength / avgDocLength));
        const termScore = idf * (numerator / denominator);

        score += termScore;

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

      if (score > 0) {
        results.push({
          entity,
          score,
          matchedFields,
        });
      }
    }

    // Sort by score descending and limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, effectiveLimit);
  }

  /**
   * Update the index for changed entities.
   *
   * @param changedEntityNames - Names of entities that changed
   */
  async update(changedEntityNames: Set<string>): Promise<void> {
    if (!this.index) {
      await this.buildIndex();
      return;
    }

    const graph = await this.storage.loadGraph();
    const entityMap = new Map(graph.entities.map(e => [e.name, e]));

    // Process each changed entity
    for (const entityName of changedEntityNames) {
      const entity = entityMap.get(entityName);
      const existingEntry = this.index.documents.get(entityName);

      if (existingEntry) {
        // Remove old term frequencies from document frequency counts
        for (const [term] of existingEntry.termFreqs) {
          const df = this.index.documentFrequency.get(term) || 0;
          if (df <= 1) {
            this.index.documentFrequency.delete(term);
          } else {
            this.index.documentFrequency.set(term, df - 1);
          }
        }
        this.index.documents.delete(entityName);
      }

      if (entity) {
        // Add new entry
        const text = this.entityToText(entity);
        const tokens = this.tokenize(text);
        const termFreqs = new Map<string, number>();
        const termsSeen = new Set<string>();

        for (const token of tokens) {
          termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
          if (!termsSeen.has(token)) {
            termsSeen.add(token);
            this.index.documentFrequency.set(
              token,
              (this.index.documentFrequency.get(token) || 0) + 1
            );
          }
        }

        const entry: BM25DocumentEntry = {
          entityName: entity.name,
          termFreqs,
          docLength: tokens.length,
        };

        this.index.documents.set(entityName, entry);
      }
    }

    // Recalculate average document length
    this.index.totalDocs = this.index.documents.size;
    let totalLength = 0;
    for (const doc of this.index.documents.values()) {
      totalLength += doc.docLength;
    }
    this.index.avgDocLength = this.index.totalDocs > 0
      ? totalLength / this.index.totalDocs
      : 0;
  }

  /**
   * Remove an entity from the index.
   *
   * @param entityName - Name of entity to remove
   */
  remove(entityName: string): boolean {
    if (!this.index) {
      return false;
    }

    const entry = this.index.documents.get(entityName);
    if (!entry) {
      return false;
    }

    // Update document frequency counts
    for (const [term] of entry.termFreqs) {
      const df = this.index.documentFrequency.get(term) || 0;
      if (df <= 1) {
        this.index.documentFrequency.delete(term);
      } else {
        this.index.documentFrequency.set(term, df - 1);
      }
    }

    this.index.documents.delete(entityName);

    // Update totals
    this.index.totalDocs = this.index.documents.size;
    let totalLength = 0;
    for (const doc of this.index.documents.values()) {
      totalLength += doc.docLength;
    }
    this.index.avgDocLength = this.index.totalDocs > 0
      ? totalLength / this.index.totalDocs
      : 0;

    return true;
  }

  /**
   * Clear the index.
   */
  clearIndex(): void {
    this.index = null;
  }

  /**
   * Check if the index is built.
   */
  isIndexed(): boolean {
    return this.index !== null;
  }

  /**
   * Get index statistics.
   */
  getIndexStats(): { documents: number; terms: number; avgDocLength: number } | null {
    if (!this.index) {
      return null;
    }
    return {
      documents: this.index.documents.size,
      terms: this.index.documentFrequency.size,
      avgDocLength: this.index.avgDocLength,
    };
  }

  /**
   * Convert an entity to searchable text.
   */
  private entityToText(entity: Entity): string {
    return [entity.name, entity.entityType, ...entity.observations].join(' ');
  }
}
