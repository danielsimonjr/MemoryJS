/**
 * Graph Connectivity Helpers
 *
 * Shared degree computation for connectivity-aware scoring.
 * Used by SalienceEngine (connectivity salience signal) and
 * DecayEngine (connectivity decay protection).
 *
 * @module agent/connectivity
 * @internal
 */

import type { Relation } from '../types/types.js';

/**
 * Degree information for all entities that participate in at least
 * one relation, plus the maximum degree observed in the graph.
 */
export interface DegreeMap {
  /** Entity name → relation count (entities with no relations are absent). */
  degrees: Map<string, number>;
  /** Maximum degree across all entities (0 for a graph with no relations). */
  maxDegree: number;
}

/**
 * Compute the degree of every entity from a relation list.
 *
 * Degree of an entity = number of relations where `from` or `to`
 * equals the entity name. A self-loop (from === to) counts once.
 *
 * @param graph - Any object exposing a relations array (KnowledgeGraph or ReadonlyKnowledgeGraph)
 * @returns Degree map plus the maximum degree in the graph
 */
export function computeDegreeMap(graph: { relations: readonly Relation[] }): DegreeMap {
  const degrees = new Map<string, number>();

  for (const relation of graph.relations) {
    degrees.set(relation.from, (degrees.get(relation.from) ?? 0) + 1);
    // Self-loops are a single relation touching the entity — count once
    if (relation.to !== relation.from) {
      degrees.set(relation.to, (degrees.get(relation.to) ?? 0) + 1);
    }
  }

  let maxDegree = 0;
  for (const degree of degrees.values()) {
    if (degree > maxDegree) maxDegree = degree;
  }

  return { degrees, maxDegree };
}

/**
 * Normalized degree of an entity in [0, 1]: degree / maxDegree.
 * Returns 0 when the graph has no relations (maxDegree === 0)
 * or the entity has no relations.
 *
 * @param degreeMap - Precomputed degree map
 * @param entityName - Entity to look up
 * @returns Normalized degree between 0 and 1
 */
export function normalizedDegree(degreeMap: DegreeMap, entityName: string): number {
  if (degreeMap.maxDegree === 0) return 0;
  return (degreeMap.degrees.get(entityName) ?? 0) / degreeMap.maxDegree;
}
