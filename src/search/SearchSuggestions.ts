/**
 * Search Suggestions
 *
 * "Did you mean?" suggestions plus pre-execution query auto-correction
 * over a vocabulary built from entity names, types, and observation
 * tokens.
 *
 * @module search/SearchSuggestions
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import type { GraphEventEmitter } from '../core/GraphEventEmitter.js';
import { levenshteinDistance } from '../utils/index.js';

interface Suggestion {
  text: string;
  similarity: number;
}

/** Result of a query-term correction pass. */
export interface CorrectedQuery {
  /** The original query string, unchanged. */
  original: string;
  /** Per-term corrections — same length as the input's whitespace split. */
  terms: Array<{ original: string; corrected: string; corrected_? : boolean; distance?: number }>;
  /** Joined corrected query — pass this to the actual search. */
  corrected: string;
  /** True when at least one term was substituted. */
  hadCorrection: boolean;
}

/** Options for `correctQuery`. */
export interface CorrectQueryOptions {
  /** Maximum Levenshtein distance to substitute (default: 2). */
  maxDistance?: number;
  /** Ignore short tokens (avoid hammering 2-letter words into noise). Default: 4. */
  minTokenLength?: number;
  /** Skip correction for terms that already exist in the vocabulary verbatim. Default: true. */
  skipExactMatches?: boolean;
}

/**
 * Generates "did you mean?" suggestions and auto-corrects queries against
 * a vocabulary built from the graph.
 */
export class SearchSuggestions {
  constructor(private storage: GraphStorage) {}

  /**
   * Cached vocabulary: lowercased terms drawn from entity names, types,
   * and observation tokens. Built lazily on first call to
   * `getVocabulary()` / `correctQuery()`. Auto-invalidated via
   * `attachInvalidator(events)` when wired to a `GraphEventEmitter`;
   * callers can also invoke `invalidateVocabulary()` directly after
   * bulk imports or other operations the event stream doesn't cover.
   */
  private vocabularyCache: Set<string> | null = null;

  /** Unsubscribe handles for the optional event-driven invalidator. */
  private vocabUnsubscribers: Array<() => void> = [];

  /** Get suggestions for a query using Levenshtein distance similarity. */
  async getSearchSuggestions(query: string, maxSuggestions: number = 5): Promise<string[]> {
    const graph = await this.storage.loadGraph();
    const queryLower = query.toLowerCase();

    const suggestions: Suggestion[] = [];

    // Check entity names
    for (const entity of graph.entities) {
      const distance = levenshteinDistance(queryLower, entity.name.toLowerCase());
      const maxLength = Math.max(queryLower.length, entity.name.length);
      const similarity = 1 - distance / maxLength;

      if (similarity > 0.5 && similarity < 1.0) {
        // Not exact match but similar
        suggestions.push({ text: entity.name, similarity });
      }
    }

    // Check entity types
    const uniqueTypes = [...new Set(graph.entities.map(e => e.entityType))];
    for (const type of uniqueTypes) {
      const distance = levenshteinDistance(queryLower, type.toLowerCase());
      const maxLength = Math.max(queryLower.length, type.length);
      const similarity = 1 - distance / maxLength;

      if (similarity > 0.5 && similarity < 1.0) {
        suggestions.push({ text: type, similarity });
      }
    }

    // Sort by similarity and return top suggestions
    return suggestions
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxSuggestions)
      .map(s => s.text);
  }

  /**
   * Build (or read from cache) the vocabulary. Returns a Set of
   * lowercased tokens drawn from:
   *   - entity names
   *   - entity types
   *   - observation tokens (split on non-word characters)
   *
   * Tokens shorter than 3 characters are skipped — they produce too many
   * false-positive corrections to be useful.
   */
  async getVocabulary(): Promise<Set<string>> {
    if (this.vocabularyCache) return this.vocabularyCache;

    const graph = await this.storage.loadGraph();
    const vocab = new Set<string>();

    for (const entity of graph.entities) {
      const name = entity.name.toLowerCase();
      if (name.length >= 3) vocab.add(name);

      const type = entity.entityType.toLowerCase();
      if (type.length >= 3) vocab.add(type);

      for (const obs of entity.observations) {
        for (const token of obs.toLowerCase().split(/[^a-z0-9]+/)) {
          if (token.length >= 3) vocab.add(token);
        }
      }
    }

    this.vocabularyCache = vocab;
    return vocab;
  }

  /**
   * Drop the cached vocabulary so the next call to `getVocabulary()` /
   * `correctQuery()` rebuilds it from the current graph. Cheap — just
   * nulls the field.
   */
  invalidateVocabulary(): void {
    this.vocabularyCache = null;
  }

  /**
   * Wire automatic invalidation to a `GraphEventEmitter`. After this is
   * attached, the vocabulary cache is dropped on every entity
   * create/update/delete event. Returns an unsubscribe function;
   * subsequent calls replace the previous subscription.
   */
  attachInvalidator(events: GraphEventEmitter): () => void {
    this.detachInvalidator();
    const drop = (): void => this.invalidateVocabulary();
    this.vocabUnsubscribers.push(events.on('entity:created', drop));
    this.vocabUnsubscribers.push(events.on('entity:updated', drop));
    this.vocabUnsubscribers.push(events.on('entity:deleted', drop));
    return (): void => this.detachInvalidator();
  }

  /** Unsubscribe from any attached `GraphEventEmitter`. */
  detachInvalidator(): void {
    for (const u of this.vocabUnsubscribers) u();
    this.vocabUnsubscribers = [];
  }

  /**
   * Auto-correct each whitespace-separated term in `query` against the
   * vocabulary using Levenshtein distance. Returns the original string,
   * a per-term audit, the corrected string, and a `hadCorrection` flag
   * so callers can decide whether to surface the correction to the user.
   *
   * The correction is conservative by default:
   *   - terms < 4 chars are skipped (too noisy)
   *   - exact matches are preserved verbatim
   *   - only substitutes when there is a unique closest match within
   *     `maxDistance` (default 2)
   *
   * Designed to run *before* search execution — pass `result.corrected`
   * to the actual search method.
   */
  async correctQuery(query: string, options: CorrectQueryOptions = {}): Promise<CorrectedQuery> {
    const maxDistance = options.maxDistance ?? 2;
    const minTokenLength = options.minTokenLength ?? 4;
    const skipExactMatches = options.skipExactMatches ?? true;

    const vocab = await this.getVocabulary();
    const tokens = query.split(/(\s+)/); // Preserve whitespace for round-trip.

    let hadCorrection = false;
    const auditTerms: CorrectedQuery['terms'] = [];
    const correctedTokens: string[] = [];

    for (const token of tokens) {
      if (/^\s+$/.test(token) || token.length === 0) {
        correctedTokens.push(token);
        continue;
      }

      const lower = token.toLowerCase();
      const isExact = vocab.has(lower);

      if (token.length < minTokenLength || (isExact && skipExactMatches)) {
        correctedTokens.push(token);
        auditTerms.push({ original: token, corrected: token });
        continue;
      }

      // Find the unique closest vocab match within maxDistance.
      let bestMatch: string | null = null;
      let bestDistance = Infinity;
      let tied = false;
      for (const candidate of vocab) {
        if (Math.abs(candidate.length - lower.length) > maxDistance) continue;
        const d = levenshteinDistance(lower, candidate);
        if (d < bestDistance) {
          bestDistance = d;
          bestMatch = candidate;
          tied = false;
        } else if (d === bestDistance && candidate !== bestMatch) {
          tied = true;
        }
      }

      if (bestMatch !== null && bestDistance <= maxDistance && bestDistance > 0 && !tied) {
        correctedTokens.push(bestMatch);
        auditTerms.push({ original: token, corrected: bestMatch, distance: bestDistance });
        hadCorrection = true;
      } else {
        correctedTokens.push(token);
        auditTerms.push({ original: token, corrected: token });
      }
    }

    return {
      original: query,
      terms: auditTerms,
      corrected: correctedTokens.join(''),
      hadCorrection,
    };
  }
}
