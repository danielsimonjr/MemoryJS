import type { WeightedTurn } from './MemoryBackend.js';

/**
 * Scores items, filters by threshold, sorts descending, and applies limit.
 */
export function selectWeightedTurns<T>(
  items: readonly T[],
  project: (item: T) => WeightedTurn,
  threshold: number,
  limit: number,
): WeightedTurn[] {
  return items
    .map(project)
    .filter(wt => wt.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
