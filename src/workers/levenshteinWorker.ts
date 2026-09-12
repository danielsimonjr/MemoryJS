/**
 * Levenshtein Worker
 *
 * Worker thread for calculating Levenshtein distances in parallel.
 * Uses workerpool for worker management.
 *
 * @module workers/levenshteinWorker
 */

import workerpool from '@danielsimonjr/workerpool';
import { FUZZY_SEARCH_LIMITS } from '../utils/constants.js';
import { levenshteinDistance } from '../utils/searchAlgorithms.js';
export { levenshteinDistance } from '../utils/searchAlgorithms.js';

/**
 * Input data structure for the worker.
 */
export interface WorkerInput {
  /** Search query string */
  query: string;
  /** Array of entities to search */
  entities: Array<{
    name: string;
    nameLower: string;
    entityTypeLower?: string;
    observations: string[];
  }>;
  /** Similarity threshold (0.0 to 1.0) */
  threshold: number;
}

/**
 * Match result returned by the worker.
 */
export interface MatchResult {
  /** Entity name that matched */
  name: string;
  /** Similarity score (0.0 to 1.0) */
  score: number;
  /** Where the match occurred */
  matchedIn: 'name' | 'type' | 'observation';
}

/**
 * Calculate similarity score between two strings.
 *
 * @param s1 - First string
 * @param s2 - Second string
 * @param threshold - Optional minimum score used for early termination
 * @returns Similarity score (0.0 to 1.0, where 1.0 is identical)
 */
export function similarity(s1: string, s2: string, threshold: number = 0): number {
  // Exact match
  if (s1 === s2) return 1.0;

  // One contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 1.0;

  // Calculate Levenshtein-based similarity
  const maxLength = Math.max(s1.length, s2.length);
  const maxDistance = Math.floor((1 - threshold) * maxLength + Number.EPSILON * maxLength);
  const distance = levenshteinDistance(s1, s2, maxDistance);
  if (distance > maxDistance) {
    return Math.max(0, threshold - Number.EPSILON);
  }
  return 1 - distance / maxLength;
}

/**
 * Search entities for fuzzy matches.
 *
 * @param data - Worker input containing query, entities, and threshold
 * @returns Array of match results
 */
export function searchEntities(data: WorkerInput): MatchResult[] {
  const { query, entities, threshold } = data;
  if (query.length > FUZZY_SEARCH_LIMITS.MAX_QUERY_LENGTH) {
    throw new RangeError(
      `Fuzzy search query exceeds maximum length of ${FUZZY_SEARCH_LIMITS.MAX_QUERY_LENGTH}`
    );
  }
  const queryLower = query.toLowerCase();
  const results: MatchResult[] = [];

  for (const entity of entities) {
    // Check name similarity
    const nameLower = entity.nameLower
      .slice(0, FUZZY_SEARCH_LIMITS.MAX_NAME_LENGTH)
      .toLowerCase();
    const nameScore = similarity(queryLower, nameLower, threshold);
    if (nameScore >= threshold) {
      results.push({ name: entity.name, score: nameScore, matchedIn: 'name' });
      continue;
    }

    if (entity.entityTypeLower !== undefined) {
      const typeScore = similarity(queryLower,
        entity.entityTypeLower.slice(0, FUZZY_SEARCH_LIMITS.MAX_NAME_LENGTH).toLowerCase(), threshold);
      if (typeScore >= threshold) {
        results.push({ name: entity.name, score: typeScore, matchedIn: 'type' });
        continue;
      }
    }

    // Check observations
    for (const obs of entity.observations) {
      const observation = obs
        .slice(0, FUZZY_SEARCH_LIMITS.MAX_OBSERVATION_LENGTH)
        .toLowerCase();
      let obsScore = similarity(queryLower, observation, threshold);
      if (obsScore < threshold) {
        for (const word of observation.split(/\s+/)) {
          obsScore = Math.max(obsScore, similarity(queryLower, word, threshold));
          if (obsScore >= threshold) break;
        }
      }
      if (obsScore >= threshold) {
        results.push({ name: entity.name, score: obsScore, matchedIn: 'observation' });
        break;
      }
    }
  }

  return results;
}

// Register worker methods with workerpool
// Cast to satisfy workerpool's generic type signature
workerpool.worker({
  searchEntities: searchEntities as (...args: unknown[]) => unknown,
});
