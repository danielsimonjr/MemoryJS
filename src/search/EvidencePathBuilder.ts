/**
 * Evidence Path Builder
 *
 * R2 (traceable reasoning paths): given a result entity, the set of anchor
 * entities that directly matched the query (per search layer), and a graph
 * snapshot, produces the graph paths that connect each anchor to the result.
 * These paths are the "why" behind a search hit — evidence instead of an
 * opaque similarity score.
 *
 * Path algorithm: bounded breadth-first search over the undirected
 * projection of the graph (relation direction is preserved in the output
 * but ignored for traversal), capped by `maxDepth` hops. BFS guarantees
 * each returned path is a shortest path from its anchor to the result.
 *
 * @module search/EvidencePathBuilder
 * @experimental
 */

import type { ReadonlyKnowledgeGraph } from '../types/index.js';
import type {
  EvidenceLayer,
  EvidencePath,
  EvidencePathOptions,
  EvidencePathRelation,
} from '../types/search.js';

/** Default maximum path length in hops. */
export const DEFAULT_EVIDENCE_MAX_DEPTH = 3;
/** Default maximum number of evidence paths per result. */
export const DEFAULT_EVIDENCE_MAX_PATHS_PER_RESULT = 3;

/**
 * An anchor entity: a direct query match to trace evidence paths from.
 */
export interface EvidenceAnchor {
  /** Anchor entity name */
  name: string;
  /** Search layer through which the anchor matched the query */
  viaLayer: EvidenceLayer;
  /**
   * Optional match strength; anchors are tried in descending score order
   * so the strongest matches produce paths before the cap bites.
   */
  score?: number;
}

/**
 * Evidence paths for a single result plus a truncation marker.
 */
export interface EvidencePathSet {
  /** Shortest paths from anchors to the result (at most maxPathsPerResult) */
  paths: EvidencePath[];
  /**
   * True when a cap changed the outcome: either more anchors remained after
   * `maxPathsPerResult` paths were collected, or a bounded BFS hit
   * `maxDepth` while unexplored graph remained (a longer path may exist).
   */
  truncated: boolean;
}

interface AdjacencyEdge {
  neighbor: string;
  relation: EvidencePathRelation;
}

interface BoundedBfsOutcome {
  path: EvidencePath | null;
  /** True when the search stopped expanding due to maxDepth with frontier remaining. */
  depthLimited: boolean;
}

/**
 * Builds traceable evidence paths from query-anchor entities to result
 * entities over a graph snapshot.
 *
 * Construction cost is one pass over `graph.relations` (adjacency index);
 * instances are cheap and intended to be created per search call when
 * `explain: true` is requested.
 */
export class EvidencePathBuilder {
  private readonly adjacency = new Map<string, AdjacencyEdge[]>();
  private readonly maxDepth: number;
  private readonly maxPathsPerResult: number;

  constructor(graph: ReadonlyKnowledgeGraph, options: EvidencePathOptions = {}) {
    this.maxDepth = Math.max(0, options.maxDepth ?? DEFAULT_EVIDENCE_MAX_DEPTH);
    this.maxPathsPerResult = Math.max(
      1,
      options.maxPathsPerResult ?? DEFAULT_EVIDENCE_MAX_PATHS_PER_RESULT
    );

    for (const relation of graph.relations) {
      const edge: EvidencePathRelation = {
        from: relation.from,
        to: relation.to,
        relationType: relation.relationType,
      };
      if (relation.from === relation.to) continue; // self-loops add no path information
      this.addEdge(relation.from, { neighbor: relation.to, relation: edge });
      this.addEdge(relation.to, { neighbor: relation.from, relation: edge });
    }
  }

  private addEdge(node: string, edge: AdjacencyEdge): void {
    const list = this.adjacency.get(node);
    if (list) {
      list.push(edge);
    } else {
      this.adjacency.set(node, [edge]);
    }
  }

  /**
   * Build evidence paths from the given anchors to a result entity.
   *
   * Anchors are deduplicated by name (first occurrence wins — pass them in
   * layer-priority order) and tried in descending `score` order. A result
   * that is itself an anchor yields a trivial single-node path.
   *
   * @param resultName - Result entity name (path endpoint)
   * @param anchors - Direct query matches to trace paths from
   * @returns Paths (capped at maxPathsPerResult) and a truncation flag
   */
  buildForResult(resultName: string, anchors: readonly EvidenceAnchor[]): EvidencePathSet {
    // Dedupe by name, first occurrence wins; then stable-sort by score desc.
    const seen = new Set<string>();
    const ordered: EvidenceAnchor[] = [];
    for (const anchor of anchors) {
      if (seen.has(anchor.name)) continue;
      seen.add(anchor.name);
      ordered.push(anchor);
    }
    ordered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const paths: EvidencePath[] = [];
    let truncated = false;

    for (let i = 0; i < ordered.length; i++) {
      if (paths.length >= this.maxPathsPerResult) {
        // Cap reached with anchors remaining.
        truncated = true;
        break;
      }
      const anchor = ordered[i];

      // Trivial self-path: the result itself matched the query directly.
      if (anchor.name === resultName) {
        paths.push({
          nodes: [resultName],
          relations: [],
          anchor: anchor.name,
          viaLayer: anchor.viaLayer,
        });
        continue;
      }

      const outcome = this.boundedBfs(anchor.name, resultName);
      if (outcome.path) {
        paths.push({ ...outcome.path, anchor: anchor.name, viaLayer: anchor.viaLayer });
      } else if (outcome.depthLimited) {
        // A longer path may exist beyond the depth cap.
        truncated = true;
      }
    }

    return { paths, truncated };
  }

  /**
   * Bounded BFS from `source` to `target` over the undirected projection.
   * Returns the shortest path within `maxDepth` hops, or null.
   */
  private boundedBfs(source: string, target: string): BoundedBfsOutcome {
    if (!this.adjacency.has(source)) {
      return { path: null, depthLimited: false };
    }

    const parents = new Map<string, { parent: string; relation: EvidencePathRelation } | null>();
    parents.set(source, null);
    let frontier: string[] = [source];
    let depth = 0;
    let depthLimited = false;

    while (frontier.length > 0 && depth < this.maxDepth) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const { neighbor, relation } of this.adjacency.get(node) ?? []) {
          if (parents.has(neighbor)) continue;
          parents.set(neighbor, { parent: node, relation });
          if (neighbor === target) {
            return { path: this.reconstruct(source, target, parents), depthLimited: false };
          }
          next.push(neighbor);
        }
      }
      frontier = next;
      depth++;
    }

    // Target not found. If frontier still has unexplored expansion left, the
    // depth cap (not exhaustion) ended the search.
    if (frontier.length > 0 && depth >= this.maxDepth) {
      depthLimited = frontier.some(node =>
        (this.adjacency.get(node) ?? []).some(({ neighbor }) => !parents.has(neighbor))
      );
    }

    return { path: null, depthLimited };
  }

  private reconstruct(
    source: string,
    target: string,
    parents: Map<string, { parent: string; relation: EvidencePathRelation } | null>
  ): EvidencePath {
    const nodes: string[] = [];
    const relations: EvidencePathRelation[] = [];
    let current: string | null = target;

    while (current !== null) {
      nodes.unshift(current);
      const info = parents.get(current);
      if (info) {
        relations.unshift(info.relation);
        current = info.parent;
      } else {
        current = null;
      }
    }

    return { nodes, relations, anchor: source, viaLayer: 'lexical' };
  }
}
