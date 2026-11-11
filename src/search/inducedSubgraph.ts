import type { GraphStorage } from '../core/GraphStorage.js';
import type { Entity, KnowledgeGraph, Relation } from '../types/index.js';

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

/**
 * Build the subgraph induced by `entities`: the entities themselves, plus every relation whose
 * two endpoints are in that set (optionally filtered by `relationFilter`).
 *
 * The entity order and object identity of the argument are preserved, so a caller that resolved
 * its entity list from a cache hit gets the same objects back.
 *
 * @param storage - Storage queried for outgoing relation adjacency.
 * @param entities - Entities that make up the subgraph.
 * @param relationFilter - Optional predicate; only relations it accepts are kept.
 * @returns The induced subgraph.
 */
export function inducedSubgraph(
  storage: GraphStorage,
  entities: readonly Entity[],
  relationFilter?: (relation: Relation) => boolean,
): KnowledgeGraph {
  const names = new Set(entities.map((entity) => entity.name));
  return { entities: [...entities], relations: collectInducedRelations(storage, names, relationFilter) };
}
