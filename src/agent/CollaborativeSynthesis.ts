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
 * A single multi-agent conflict surfaced during synthesis (η.5.5.a).
 *
 * Each ConflictView represents a group of entities that share the same
 * `rootEntityName` (or `name` when there is no v1.8.0 supersession chain)
 * but were authored by *different* `agentId`s — i.e. multiple agents have
 * written competing versions of the same logical entity.
 *
 * The `recommendedWinner` is the agentId of the candidate with the highest
 * `score = (confidence ?? 0.5) × salienceScore`. Callers pick a final
 * winner by calling `resolveConflicts(result, policy)` on the synthesis
 * instance — the recommendation is advisory.
 */
export interface ConflictView {
  /** Logical entity identity — `rootEntityName` if set, else `name`. */
  entityName: string;
  /** Competing versions, sorted by score descending. */
  candidates: Array<{
    agentId: string;
    entity: AgentEntity;
    /** confidence × salienceScore, normalized to [0, 1]. */
    score: number;
  }>;
  /** agentId of the highest-scored candidate (advisory). */
  recommendedWinner: string;
}

/**
 * Strategy for resolving a `ConflictView` programmatically.
 *
 * - `most_recent` — pick the candidate with the latest `lastModified`.
 * - `highest_confidence` — pick the candidate with the highest `confidence`.
 * - `highest_score` — pick `recommendedWinner` (default).
 * - `trusted_agent` — caller supplies a `trustedAgentId`; that agent wins
 *   if present in the candidates, else falls back to `highest_score`.
 */
export type ConflictResolutionPolicy =
  | { strategy: 'most_recent' }
  | { strategy: 'highest_confidence' }
  | { strategy: 'highest_score' }
  | { strategy: 'trusted_agent'; trustedAgentId: string };

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
  /**
   * Multi-agent conflicts detected among the neighbors (η.5.5.a). Each
   * entry describes a logical entity with competing versions from different
   * agents. Empty array when no conflicts exist (single-agent case).
   */
  conflicts: ConflictView[];
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

    // 7. Detect multi-agent conflicts (η.5.5.a)
    const conflicts = this.detectConflicts(neighbors);

    return {
      seedEntity: seedEntityName,
      neighbors,
      synthesizedObservations,
      traversedCount,
      filteredCount,
      conflicts,
    };
  }

  /**
   * Detect multi-agent conflicts among the synthesized neighbors (η.5.5.a).
   *
   * Two entities are *competing* when they share a logical identity
   * (same `rootEntityName`, falling back to `name` when no chain) but
   * carry distinct `agentId` values. A single-agent group of versions is
   * NOT a conflict — only divergence between agents counts.
   *
   * Candidates within a conflict are ranked by `score = (confidence ?? 0.5)
   * × salienceScore`, so a high-confidence finding from a noisy region of
   * the graph can still rank below a moderate-confidence finding in a
   * salient region.
   *
   * @internal
   */
  private detectConflicts(neighbors: ScoredEntity[]): ConflictView[] {
    type Candidate = { agentId: string; entity: AgentEntity; score: number };
    const groups = new Map<string, Candidate[]>();

    for (const scored of neighbors) {
      const e = scored.entity;
      const agentId = e.agentId;
      // Skip entities with no agentId — they can't participate in
      // multi-agent conflict (no attribution to disagree with).
      if (!agentId) continue;
      const key = e.rootEntityName ?? e.name;
      const confidence = e.confidence ?? 0.5;
      const score = confidence * scored.salienceScore;
      const list = groups.get(key) ?? [];
      list.push({ agentId, entity: e, score });
      groups.set(key, list);
    }

    const conflicts: ConflictView[] = [];
    for (const [entityName, candidates] of groups) {
      // Need at least 2 distinct agents to constitute a conflict.
      const distinctAgents = new Set(candidates.map(c => c.agentId));
      if (distinctAgents.size < 2) continue;
      candidates.sort((a, b) => b.score - a.score);
      conflicts.push({
        entityName,
        candidates,
        recommendedWinner: candidates[0].agentId,
      });
    }
    return conflicts;
  }

  /**
   * Pick a winner per `ConflictView` according to the supplied policy.
   * Returns a map keyed by `entityName` whose values are the winning
   * `AgentEntity`. Pure function — does not mutate the synthesis result
   * or persist anything to storage. Callers feed the winners back through
   * their write path of choice (e.g. `EntityManager.updateEntity`).
   *
   * @example
   * ```typescript
   * const result = await synth.synthesize('Alice');
   * const winners = synth.resolveConflicts(result, { strategy: 'most_recent' });
   * for (const [name, winner] of winners) {
   *   await entityManager.updateEntity(name, { ...winner });
   * }
   * ```
   */
  resolveConflicts(
    result: SynthesisResult,
    policy: ConflictResolutionPolicy,
  ): Map<string, AgentEntity> {
    const winners = new Map<string, AgentEntity>();

    for (const conflict of result.conflicts) {
      let winner: { agentId: string; entity: AgentEntity; score: number };

      if (policy.strategy === 'highest_score') {
        winner = conflict.candidates[0]; // already sorted descending
      } else if (policy.strategy === 'most_recent') {
        winner = [...conflict.candidates].sort((a, b) => {
          const aTime = a.entity.lastModified ?? '1970-01-01T00:00:00Z';
          const bTime = b.entity.lastModified ?? '1970-01-01T00:00:00Z';
          return bTime.localeCompare(aTime);
        })[0];
      } else if (policy.strategy === 'highest_confidence') {
        winner = [...conflict.candidates].sort((a, b) => {
          const aConf = a.entity.confidence ?? 0.5;
          const bConf = b.entity.confidence ?? 0.5;
          return bConf - aConf;
        })[0];
      } else {
        // trusted_agent — the named agent wins if they have a candidate;
        // otherwise fall back to highest_score.
        const trusted = conflict.candidates.find(
          c => c.agentId === policy.trustedAgentId,
        );
        winner = trusted ?? conflict.candidates[0];
      }

      winners.set(conflict.entityName, winner.entity);
    }

    return winners;
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
