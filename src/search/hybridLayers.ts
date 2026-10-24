/**
 * Score mapping for the semantic, lexical and symbolic search layers.
 *
 * The layer calls stay in their callers. Each caller keeps its own error policy.
 *
 * @module search/hybridLayers
 */

import type { SearchResult, SemanticSearchResult } from '../types/index.js';
import type { SymbolicResult } from './SymbolicSearch.js';

/**
 * Add the similarity of each semantic result to a score map.
 *
 * Each entity name maps to its similarity. The map keeps the entries written before an error.
 *
 * @param results - Map that receives the similarity scores
 * @param semanticResults - Semantic search results
 */
export function addSimilarityScores(
  results: Map<string, number>,
  semanticResults: SemanticSearchResult[],
): void {
  for (const result of semanticResults) {
    results.set(result.entity.name, result.similarity);
  }
}

/**
 * Add the lexical score of each result to a score map, scaled by the largest score.
 *
 * The divisor is never below one. When no score exceeds one, the scores keep their raw values.
 * The map keeps the entries written before an error.
 *
 * @param results - Map that receives the normalized scores
 * @param lexicalResults - Ranked lexical search results
 */
export function addNormalizedLexicalScores(
  results: Map<string, number>,
  lexicalResults: SearchResult[],
): void {
  const maxScore = Math.max(...lexicalResults.map(r => r.score), 1);
  for (const result of lexicalResults) {
    results.set(result.entity.name, result.score / maxScore);
  }
}

/**
 * Add the symbolic score of each result to a score map.
 *
 * Each entity name maps to its score unchanged. An error stops the loop.
 * The map keeps the entries written before the error.
 * The caller calls this function only when at least one filter is set.
 *
 * @param results - Map that receives the symbolic scores
 * @param symbolicResults - Symbolic search results
 */
export function addSymbolicScores(
  results: Map<string, number>,
  symbolicResults: SymbolicResult[],
): void {
  for (const result of symbolicResults) {
    results.set(result.entity.name, result.score);
  }
}
