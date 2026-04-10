/**
 * Collaborative Memory Synthesis
 *
 * Traverses graph neighbors of a seed entity, scores them by salience,
 * and synthesizes composite observations grouped by entity type.
 *
 * @module agent/CollaborativeSynthesis
 */

import type { IGraphStorage } from '../types/types.js';
import type { AgentEntity, SalienceContext, ScoredEntity } from '../types/agent-memory.js';
import type { GraphTraversal } from '../core/GraphTraversal.js';
import type { SalienceEngine } from './SalienceEngine.js';

/**
 * Configuration for CollaborativeSynthesis.
 */
export interface CollaborativeSynthesisConfig {
  /** Maximum BFS depth to traverse from seed (default: 2) */
  maxDepth?: number;
  /** Minimum salience score for a neighbor to be included (default: 0.3) */
  minNeighborSalience?: number;
  /** Maximum number of neighbor entities to include after scoring (default: 20) */
  maxNeighbors?: number;
  /** If non-empty, only traverse relations of these types (default: all) */
  relationTypes?: string[];
}

/**
 * Result of a collaborative synthesis operation.
 */
export interface SynthesisResult {
  /** Name of the seed entity used as the traversal start point */
  seedEntity: string;
  /** Neighbor entities that passed the salience filter, sorted by score descending */
  neighbors: ScoredEntity[];
  /** Synthesized observation strings grouped by entity type */
  synthesizedObservations: string[];
  /** Total number of entities visited during traversal (excluding seed) */
  traversedCount: number;
  /** Number of entities filtered out due to low salience */
  filteredCount: number;
}

/** Default configuration values. */
const DEFAULTS: Required<CollaborativeSynthesisConfig> = {
  maxDepth: 2,
  minNeighborSalience: 0.3,
  maxNeighbors: 20,
  relationTypes: [],
};

/**
 * Collaboratively synthesises context from a seed entity's graph neighbourhood.
 *
 * The synthesis pipeline:
 * 1. BFS-traverse neighbors up to `maxDepth` hops from the seed.
 * 2. Score each neighbor with the provided SalienceEngine.
 * 3. Filter neighbors below `minNeighborSalience`.
 * 4. Keep at most `maxNeighbors` (highest salience first).
 * 5. Group survivors by `entityType` and emit one summary line per group
 *    plus the top observation from the highest-scoring entity in that group.
 *
 * @example
 * ```typescript
 * const synth = new CollaborativeSynthesis(storage, traversal, salienceEngine);
 * const result = await synth.synthesize('Alice', { currentTask: 'planning' });
 * console.log(result.synthesizedObservations);
 * ```
 */
export class CollaborativeSynthesis {
  private readonly config: Required<CollaborativeSynthesisConfig>;

  constructor(
    private readonly storage: IGraphStorage,
    private readonly traversal: GraphTraversal,
    private readonly salienceEngine: SalienceEngine,
    config: CollaborativeSynthesisConfig = {}
  ) {
    this.config = {
      maxDepth: config.maxDepth ?? DEFAULTS.maxDepth,
      minNeighborSalience: config.minNeighborSalience ?? DEFAULTS.minNeighborSalience,
      maxNeighbors: config.maxNeighbors ?? DEFAULTS.maxNeighbors,
      relationTypes: config.relationTypes ?? DEFAULTS.relationTypes,
    };
  }

  /**
   * Synthesize collaborative context starting from a seed entity.
   *
   * @param seedEntityName - Name of the entity to start traversal from
   * @param context - Salience context used for scoring neighbors
   * @returns SynthesisResult with scored neighbors and synthesized observations
   */
  async synthesize(seedEntityName: string, context: SalienceContext = {}): Promise<SynthesisResult> {
    // 1. BFS traversal to collect all reachable neighbors within maxDepth
    const traversalResult = this.traversal.bfs(seedEntityName, {
      maxDepth: this.config.maxDepth,
      relationTypes: this.config.relationTypes.length > 0 ? this.config.relationTypes : undefined,
    });

    // Exclude the seed entity itself
    const neighborNames = traversalResult.nodes.filter((n) => n !== seedEntityName);
    const traversedCount = neighborNames.length;

    // 2. Resolve entities and cast to AgentEntity (tolerate plain Entity)
    const neighborEntities: AgentEntity[] = [];
    for (const name of neighborNames) {
      const entity = this.storage.getEntityByName(name);
      if (entity) {
        // Cast to AgentEntity; plain Entity fields are compatible for salience scoring
        neighborEntities.push(entity as AgentEntity);
      }
    }

    // 3. Score all neighbors via SalienceEngine
    const scored = await this.salienceEngine.rankEntitiesBySalience(neighborEntities, context);

    // 4. Filter below minNeighborSalience
    const passing = scored.filter((s) => s.salienceScore >= this.config.minNeighborSalience);
    const filteredCount = scored.length - passing.length;

    // 5. Cap at maxNeighbors (already sorted descending by rankEntitiesBySalience)
    const neighbors = passing.slice(0, this.config.maxNeighbors);

    // 6. Synthesize observations grouped by entityType
    const synthesizedObservations = this.synthesizeObservations(seedEntityName, neighbors);

    return {
      seedEntity: seedEntityName,
      neighbors,
      synthesizedObservations,
      traversedCount,
      filteredCount,
    };
  }

  /**
   * Group neighbors by entityType and produce summary observation lines.
   *
   * For each group the output is:
   *   "[seedName] context — [N] [type] neighbor(s): [name1], [name2], ..."
   * followed by the top observation of the highest-scoring entity in the group.
   *
   * If there are no salient neighbors a single "No salient neighbors" line is returned.
   *
   * @internal
   */
  private synthesizeObservations(seedName: string, neighbors: ScoredEntity[]): string[] {
    if (neighbors.length === 0) {
      return [`No salient neighbors found for "${seedName}"`];
    }

    // Group by entityType
    const groups = new Map<string, ScoredEntity[]>();
    for (const scored of neighbors) {
      const type = scored.entity.entityType;
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type)!.push(scored);
    }

    const lines: string[] = [];

    for (const [type, members] of groups) {
      // Already sorted descending by score coming in; first is highest
      const topEntity = members[0];
      const names = members.map((m) => m.entity.name).join(', ');
      const count = members.length;

      // Summary line
      lines.push(
        `${seedName} context — ${count} ${type} neighbor${count === 1 ? '' : 's'}: ${names}`
      );

      // Top observation from the highest-scoring entity in this group
      const topObs = topEntity.entity.observations?.[0];
      if (topObs) {
        lines.push(`  [${topEntity.entity.name}] ${topObs}`);
      }
    }

    return lines;
  }
}
