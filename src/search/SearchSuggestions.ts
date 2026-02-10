/**
 * Search Suggestions
 *
 * Provides "did you mean?" suggestions using Levenshtein distance.
 *
 * @module search/SearchSuggestions
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import { levenshteinDistance } from '../utils/index.js';

interface Suggestion {
  text: string;
  similarity: number;
}

/** Generates "did you mean?" search suggestions based on entity names and types. */
export class SearchSuggestions {
  constructor(private storage: GraphStorage) {}

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
}
