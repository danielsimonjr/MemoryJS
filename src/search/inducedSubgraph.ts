import type { GraphStorage } from '../core/GraphStorage.js';
import type { Relation } from '../types/index.js';

/**
 * Package relations whose endpoints are both in `entityNames` without
 * scanning the graph's complete relation array. Every induced edge is owned
 * by a matched `from` endpoint, so outgoing adjacency lookups visit it once.
 */
export function collectInducedRelations(
  storage: GraphStorage,
  entityNames: Set<string>,
  predicate?: (relation: Relation) => boolean,
): Relation[] {
  const relations: Relation[] = [];
  for (const name of entityNames) {
    for (const relation of storage.getRelationsFrom(name)) {
      if (!entityNames.has(relation.to)) continue;
      if (predicate && !predicate(relation)) continue;
      relations.push(relation);
    }
  }
  return relations;
}
