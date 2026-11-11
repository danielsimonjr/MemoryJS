/**
 * Challenger tests: BFS must visit each node once, even when a node is reachable
 * by parallel edges from the same node (duplicate neighbors).
 *
 * Master behavior (de3f30cf): BFS claims a neighbor on enqueue, so a neighbor that
 * appears twice in one node's adjacency (two relations of different types, or an
 * A↔B pair expanded with direction 'both') is queued exactly once.
 *
 * The dedup refactor (PR #324) replaced the inline visited-check with
 * `unvisitedNeighbors`, which collects the whole open list before any `visited.add`
 * runs — so duplicates slip through and the node is visited (and listed) twice.
 */

import { describe, it, expect } from 'vitest';
import { GraphTraversal } from '../../../src/core/GraphTraversal.js';
import type { IGraphStorage } from '../../../src/types/types.js';

type MinimalRelation = { from: string; to: string; relationType: string };

function stubStorage(entities: string[], relations: MinimalRelation[]): IGraphStorage {
  const entityList = entities.map((name) => ({ name, entityType: 'node', observations: [`obs ${name}`] }));
  return {
    hasEntity: (n: string) => entityList.some((e) => e.name === n),
    getEntityByName: (n: string) => entityList.find((e) => e.name === n),
    getRelationsFrom: (n: string) => relations.filter((r) => r.from === n),
    getRelationsTo: (n: string) => relations.filter((r) => r.to === n),
  } as unknown as IGraphStorage;
}

describe('GraphTraversal BFS with duplicate neighbors (clones-dedup challenger)', () => {
  it('visits a node once when two relations of different types connect the same pair', () => {
    const traversal = new GraphTraversal(
      stubStorage(['A', 'B', 'C'], [
        { from: 'A', to: 'B', relationType: 'knows' },
        { from: 'A', to: 'B', relationType: 'likes' },
        { from: 'B', to: 'C', relationType: 'knows' },
      ]),
    );

    const result = traversal.bfs('A', { direction: 'outgoing' });

    expect(result.nodes.filter((n) => n === 'B')).toHaveLength(1);
    expect(result.nodes).toEqual(['A', 'B', 'C']);
  });

  it('visits a node once when direction both sees the pair from both endpoints', () => {
    const traversal = new GraphTraversal(
      stubStorage(['A', 'B', 'C'], [
        { from: 'A', to: 'B', relationType: 'knows' },
        { from: 'B', to: 'A', relationType: 'knows' },
        { from: 'A', to: 'C', relationType: 'knows' },
      ]),
    );

    const result = traversal.bfs('A', { direction: 'both' });

    expect(result.nodes.filter((n) => n === 'B')).toHaveLength(1);
    expect(result.nodes.filter((n) => n === 'C')).toHaveLength(1);
  });

  it('depths contain each node once under duplicate adjacency', () => {
    const traversal = new GraphTraversal(
      stubStorage(['A', 'B'], [
        { from: 'A', to: 'B', relationType: 'knows' },
        { from: 'A', to: 'B', relationType: 'likes' },
      ]),
    );

    const result = traversal.bfs('A', { direction: 'outgoing', maxDepth: 1 });

    expect(result.nodes).toEqual(['A', 'B']);
    expect([...result.depths.keys()].filter((n) => n === 'B')).toHaveLength(1);
  });
});
