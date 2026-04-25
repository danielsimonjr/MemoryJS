/**
 * Causal Reasoner (3B.6)
 *
 * Symbolic forward / backward / counterfactual inference over causal
 * relations. Wraps `GraphTraversal.findAllPaths` filtered to causal
 * relation types and scores each path by the product of per-edge
 * `causalStrength` values.
 *
 * Out of scope (this module): probabilistic Bayes-net inference. That
 * would require a dedicated lib (e.g. jsbayes); deferred per the plan.
 *
 * @module agent/causal/CausalReasoner
 */

import type { GraphTraversal } from '../../core/GraphTraversal.js';
import type { Relation } from '../../types/index.js';

/** Recognized causal relation types. Free-form `string` also accepted. */
export type CausalRelationType =
  | 'causes'
  | 'enables'
  | 'prevents'
  | 'precedes'
  | 'correlates'
  | (string & {});

/** Default set of relation types treated as causal. */
export const DEFAULT_CAUSAL_RELATION_TYPES: ReadonlyArray<CausalRelationType> = [
  'causes', 'enables', 'prevents', 'precedes', 'correlates',
];

/** A single causal chain — sequence of entities + edges + composite score. */
export interface CausalChain {
  /** Ordered entity names from cause to effect. */
  path: string[];
  /** Edges traversed (parallel to `path` minus one). */
  relations: Relation[];
  /**
   * Composite score = product of per-edge `causalStrength` (defaults to 1
   * when an edge has no strength annotation). Range [0, 1] for normal
   * inputs; longer chains attenuate.
   */
  score: number;
  /** Number of hops (= relations.length). */
  length: number;
}

/** A detected causal cycle (entity name appears more than once). */
export interface CausalCycle {
  /** Entity names making up the cycle, with the repeated entity at both ends. */
  cycle: string[];
  /** Edges in the cycle. */
  relations: Relation[];
}

export interface CausalReasonerConfig {
  /** Relation types to treat as causal (default: DEFAULT_CAUSAL_RELATION_TYPES). */
  causalTypes?: ReadonlyArray<CausalRelationType>;
  /** Maximum path length for chain searches (default: 6). */
  maxDepth?: number;
}

/** Helper — extract `metadata.causalStrength` if present, else 1. */
function chainScore(relations: Relation[]): number {
  let score = 1;
  for (const r of relations) {
    const meta = r.metadata as Record<string, unknown> | undefined;
    const strength = typeof meta?.causalStrength === 'number'
      ? meta.causalStrength
      : 1;
    score *= strength;
  }
  return score;
}

export class CausalReasoner {
  private readonly causalTypes: ReadonlyArray<string>;
  private readonly maxDepth: number;

  constructor(
    private readonly traversal: GraphTraversal,
    config: CausalReasonerConfig = {},
  ) {
    this.causalTypes = config.causalTypes ?? DEFAULT_CAUSAL_RELATION_TYPES;
    this.maxDepth = config.maxDepth ?? 6;
  }

  /**
   * Find all causal chains ending at `effectEntityName`. Searches for
   * paths from any node to `effectEntityName` along causal edges. In
   * practice we delegate to `findAllPaths` per candidate cause; for
   * unbounded discovery the caller should layer their own seed selection.
   *
   * Returns an empty array when no causal chain reaches the target. Each
   * chain's `score` is the product of `causalStrength` annotations on
   * its relations (defaults to 1 per edge when missing).
   */
  async findCauses(
    effectEntityName: string,
    candidateCauses: string[],
    maxDepth?: number,
  ): Promise<CausalChain[]> {
    const depth = maxDepth ?? this.maxDepth;
    const chains: CausalChain[] = [];
    for (const cause of candidateCauses) {
      const paths = await this.traversal.findAllPaths(cause, effectEntityName, depth, {
        relationTypes: this.causalTypes as string[],
      });
      for (const p of paths) {
        chains.push({
          path: p.path,
          relations: p.relations,
          score: chainScore(p.relations),
          length: p.relations.length,
        });
      }
    }
    chains.sort((a, b) => b.score - a.score);
    return chains;
  }

  /**
   * Find all causal chains starting at `causeEntityName` and reaching
   * any of `candidateEffects`. Symmetric counterpart to `findCauses`.
   */
  async findEffects(
    causeEntityName: string,
    candidateEffects: string[],
    maxDepth?: number,
  ): Promise<CausalChain[]> {
    const depth = maxDepth ?? this.maxDepth;
    const chains: CausalChain[] = [];
    for (const effect of candidateEffects) {
      const paths = await this.traversal.findAllPaths(causeEntityName, effect, depth, {
        relationTypes: this.causalTypes as string[],
      });
      for (const p of paths) {
        chains.push({
          path: p.path,
          relations: p.relations,
          score: chainScore(p.relations),
          length: p.relations.length,
        });
      }
    }
    chains.sort((a, b) => b.score - a.score);
    return chains;
  }

  /**
   * Counterfactual: "what changes if we remove edge `(removeFrom →
   * removeTo)` and ask whether `predict` is still reachable from
   * `seed`?" Returns chains from `seed` to `predict` that DO NOT use
   * the removed edge. Compare against the unfiltered `findEffects`
   * result to see which chains the removal kills.
   *
   * Pure: does not mutate the underlying graph or storage.
   */
  async counterfactual(scenario: {
    seed: string;
    removeFrom: string;
    removeTo: string;
    predict: string;
    maxDepth?: number;
  }): Promise<CausalChain[]> {
    const depth = scenario.maxDepth ?? this.maxDepth;
    const paths = await this.traversal.findAllPaths(
      scenario.seed,
      scenario.predict,
      depth,
      { relationTypes: this.causalTypes as string[] },
    );
    const surviving = paths.filter(p =>
      !p.relations.some(
        r => r.from === scenario.removeFrom && r.to === scenario.removeTo,
      ),
    );
    return surviving.map(p => ({
      path: p.path,
      relations: p.relations,
      score: chainScore(p.relations),
      length: p.relations.length,
    }));
  }

  /**
   * Detect cycles in the causal subgraph rooted at `seed`. Returns each
   * cycle as a list of entity names (with the repeating node at both
   * ends) plus the edges that close the loop.
   *
   * **Caveat**: treats `prevents` as a directed causal edge, NOT as a
   * negation. A `prevents`→`enables`→`prevents` triangle WILL show up
   * as a cycle. Document explicitly so callers don't misinterpret.
   *
   * Cycle detection here is a depth-bounded DFS rather than full Tarjan
   * SCC — sufficient for sparse causal graphs at hop counts ≤ 6, but
   * may double-report cycles that share edges. Filter by `cycle[0]`
   * sort-then-stringify if exact dedup is needed.
   */
  detectCycles(seed: string, maxDepth?: number): CausalCycle[] {
    const depth = maxDepth ?? this.maxDepth;
    const cycles: CausalCycle[] = [];
    const path: string[] = [];
    const relations: Relation[] = [];
    const inPath = new Set<string>();

    const dfs = (node: string, d: number): void => {
      if (d > depth) return;
      inPath.add(node);
      path.push(node);
      const neighbors = this.traversal.getNeighborsWithRelations(node, {
        relationTypes: this.causalTypes as string[],
        direction: 'outgoing',
      });
      for (const { neighbor, relation } of neighbors) {
        if (inPath.has(neighbor)) {
          // Found a cycle — extract the segment from `neighbor` onwards.
          const idx = path.indexOf(neighbor);
          if (idx >= 0) {
            cycles.push({
              cycle: [...path.slice(idx), neighbor],
              relations: [...relations.slice(idx), relation],
            });
          }
        } else {
          relations.push(relation);
          dfs(neighbor, d + 1);
          relations.pop();
        }
      }
      inPath.delete(node);
      path.pop();
    };

    dfs(seed, 0);
    return cycles;
  }
}
