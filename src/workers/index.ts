/**
 * Workers Module
 *
 * Worker thread utilities for parallel processing.
 * Phase 8: Uses workerpool library for worker management.
 *
 * @module workers
 */

// Re-export workerpool types for convenience
export type { Pool, PoolStats } from '@danielsimonjr/workerpool';

// Re-export levenshtein worker types and functions for testing
export type { WorkerInput, MatchResult } from './levenshteinWorker.js';
export { levenshteinDistance, similarity, searchEntities } from './levenshteinWorker.js';
