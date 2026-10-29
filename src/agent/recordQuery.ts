import type { Entity, IGraphStorage } from '../types/types.js';

/**
 * Loads entities from storage, keeps those matching `isRecord`, and maps each to `project`.
 */
export async function loadProjectedRecords<E extends Entity, T>(
  storage: Pick<IGraphStorage, 'loadGraph'>,
  isRecord: (entity: Entity) => entity is E,
  project: (entity: E) => T,
): Promise<T[]> {
  const graph = await storage.loadGraph();
  return graph.entities.filter(isRecord).map(project);
}

/**
 * Returns whether every provided filter pair matches.
 * When `wanted` is undefined, that predicate is ignored.
 * When `wanted` is defined, it must equal `actual` (including null and '').
 */
export function matchesDefined(
  predicates: ReadonlyArray<readonly [wanted: unknown, actual: unknown]>,
): boolean {
  for (const [wanted, actual] of predicates) {
    if (wanted !== undefined && actual !== wanted) {
      return false;
    }
  }
  return true;
}
