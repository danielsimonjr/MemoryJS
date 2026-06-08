/**
 * SpellChecker — spell-correction layer for entity names and tags.
 *
 * Builds a vocabulary of known terms (entity names + tag aliases by
 * default) and suggests close matches for a (potentially misspelled)
 * query. Two-stage ranking:
 * 1. `NGramIndex` Jaccard pre-filter to surface candidates cheaply.
 * 2. Levenshtein distance re-rank to score the final list — strict for
 *    near-exact matches, lenient enough for one-character typos.
 *
 * Vocabulary is rebuilt lazily on first `suggest()` and on explicit
 * `rebuild()`. For low-churn graphs the lazy cache is correct; callers
 * with frequent entity creation/deletion should call `rebuild()` after
 * bulk changes.
 *
 * @module search/SpellChecker
 */

import type { IGraphStorage } from '../types/types.js';
import { NGramIndex } from './NGramIndex.js';
import { levenshteinDistance } from '../utils/index.js';

/** Configuration for `SpellChecker`. */
export interface SpellCheckerConfig {
  /**
   * N-gram size for the underlying index. Default 2 (bigrams) — gives
   * enough overlap on short transpositions like "alcie" vs "alice"
   * that trigrams miss. Levenshtein re-ranks the resulting candidates,
   * so bigram noise doesn't hurt final ordering.
   */
  ngramSize?: number;
  /** Include tag values in the vocabulary. Default true. */
  includeTags?: boolean;
  /** Include entity names in the vocabulary. Default true. */
  includeEntityNames?: boolean;
  /** Pre-filter Jaccard threshold (looser than the final score). Default 0.1. */
  ngramThreshold?: number;
}

/** Options for `suggest()`. */
export interface SuggestOptions {
  /** Maximum corrections returned. Default 5. */
  limit?: number;
  /**
   * Minimum final score (0..1, higher = better) to include. Default 0.4.
   * Combines normalized Levenshtein similarity with the n-gram Jaccard
   * pre-filter score.
   */
  minScore?: number;
  /**
   * Maximum Levenshtein edit distance allowed for the final list.
   * Default 3 — accepts typos, rejects unrelated words. Set higher for
   * loose recall.
   */
  maxDistance?: number;
}

/** A single ranked correction. */
export interface SpellSuggestion {
  /** The corrected term from the vocabulary. */
  correction: string;
  /** Final ranking score in [0, 1]. */
  score: number;
  /** Levenshtein distance from the query to the correction. */
  distance: number;
}

export class SpellChecker {
  private readonly storage: IGraphStorage;
  private readonly cfg: Required<SpellCheckerConfig>;
  private index: NGramIndex | undefined;
  /** Lowercased vocabulary → original-case term (for case-preserving output). */
  private vocab: Map<string, string> = new Map();

  constructor(storage: IGraphStorage, config: SpellCheckerConfig = {}) {
    this.storage = storage;
    this.cfg = {
      ngramSize: config.ngramSize ?? 2,
      includeTags: config.includeTags ?? true,
      includeEntityNames: config.includeEntityNames ?? true,
      ngramThreshold: config.ngramThreshold ?? 0.1,
    };
  }

  /**
   * Suggest close matches for `query`. Returns an empty array when the
   * vocabulary is empty or no candidate clears the score / distance
   * gates.
   */
  async suggest(query: string, options: SuggestOptions = {}): Promise<SpellSuggestion[]> {
    if (typeof query !== 'string' || query.trim().length === 0) return [];
    if (!this.index) await this.rebuild();

    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0.4;
    const maxDistance = options.maxDistance ?? 3;

    // Stage 1: n-gram pre-filter (loose, broad recall).
    const candidates = this.index!.query(query.toLowerCase(), this.cfg.ngramThreshold);
    if (candidates.length === 0) return [];

    // Stage 2: Levenshtein re-rank.
    const queryLower = query.toLowerCase();
    const scored: SpellSuggestion[] = [];
    for (const candidateLower of candidates) {
      const distance = levenshteinDistance(queryLower, candidateLower);
      if (distance > maxDistance) continue;
      // Normalized similarity: 1 - distance/max(len). Tight for typos,
      // robust against length variation.
      const maxLen = Math.max(queryLower.length, candidateLower.length);
      const similarity = maxLen === 0 ? 0 : 1 - distance / maxLen;
      if (similarity < minScore) continue;
      const correction = this.vocab.get(candidateLower) ?? candidateLower;
      scored.push({ correction, score: similarity, distance });
    }

    // Sort by score desc, then by distance asc as tiebreaker.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.distance - b.distance;
    });
    return scored.slice(0, limit);
  }

  /**
   * Force a rebuild of the vocabulary + n-gram index. Call after bulk
   * entity changes; the lazy cache is otherwise correct for low-churn
   * graphs.
   */
  async rebuild(): Promise<void> {
    const graph = await this.storage.loadGraph();
    this.index = new NGramIndex(this.cfg.ngramSize);
    this.vocab = new Map();

    const terms = new Set<string>();
    if (this.cfg.includeEntityNames) {
      for (const entity of graph.entities) {
        if (typeof entity.name === 'string' && entity.name.length > 0) {
          terms.add(entity.name);
        }
      }
    }
    if (this.cfg.includeTags) {
      for (const entity of graph.entities) {
        const tags = (entity as unknown as { tags?: unknown }).tags;
        if (Array.isArray(tags)) {
          for (const t of tags) {
            if (typeof t === 'string' && t.length > 0) terms.add(t);
          }
        }
      }
    }

    for (const term of terms) {
      const lower = term.toLowerCase();
      // First-write wins on case collisions (e.g. "Alice" vs "alice").
      if (!this.vocab.has(lower)) this.vocab.set(lower, term);
      this.index.addDocument(lower, lower);
    }
  }

  /** Size of the indexed vocabulary. Mostly for diagnostics. */
  vocabularySize(): number {
    return this.vocab.size;
  }
}
