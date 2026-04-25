/**
 * World Model Manager (3B.7)
 *
 * Orchestrator that composes existing services rather than implementing
 * new reasoning. Provides:
 *
 * - `getCurrentState()` — fresh `WorldStateSnapshot` from the live graph.
 * - `validateFact(observation, entityName)` — delegates to
 *   `MemoryValidator.validateConsistency` when wired; deferred when not.
 * - `predictOutcome(action, candidates)` — delegates to
 *   `CausalReasoner.findEffects` (needs `action` to be an entity name).
 * - `detectStateChange(before, after)` — pure snapshot diff.
 *
 * Designed to be wired through `ManagerContext` lazily; minimal
 * dependencies so it costs nothing when unused.
 *
 * @module agent/world/WorldModelManager
 */

import type { Entity } from '../../types/index.js';
import type { EntityManager } from '../../core/EntityManager.js';
import type { CausalReasoner, CausalChain } from '../causal/CausalReasoner.js';
import type { MemoryValidator, MemoryValidationResult } from '../MemoryValidator.js';
import {
  WorldStateSnapshot,
  type WorldStateChange,
  type WorldStateEntity,
} from './WorldStateSnapshot.js';

export interface WorldModelManagerOptions {
  /**
   * Cap on snapshot size — keeps the snapshot small enough to roundtrip
   * through `worker_threads` or to persist as a single observation.
   * Default: 1000 entities.
   */
  maxSnapshotSize?: number;
}

export class WorldModelManager {
  private readonly maxSnapshotSize: number;

  constructor(
    private readonly entityManager: EntityManager,
    private readonly causalReasoner: CausalReasoner | undefined,
    private readonly memoryValidator: MemoryValidator | undefined,
    options: WorldModelManagerOptions = {},
  ) {
    this.maxSnapshotSize = options.maxSnapshotSize ?? 1000;
  }

  /**
   * Build a fresh snapshot from the live graph. Loads ALL entities (capped
   * at `maxSnapshotSize`) and reduces each to a `WorldStateEntity`. Pure
   * reads; safe to call concurrently.
   *
   * For graphs larger than the cap, entities are sorted by `importance`
   * descending and truncated — high-importance entities preferred.
   */
  async getCurrentState(): Promise<WorldStateSnapshot> {
    const graph = await this.entityManager['storage'].loadGraph();
    let entities = graph.entities as Entity[];
    if (entities.length > this.maxSnapshotSize) {
      entities = [...entities]
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
        .slice(0, this.maxSnapshotSize);
    }
    const snapshotEntities: WorldStateEntity[] = entities.map(e => ({
      name: e.name,
      entityType: e.entityType,
      importance: e.importance,
      confidence: e.confidence,
      observationCount: e.observations.length,
      tags: [...(e.tags ?? [])],
      lastModified: e.lastModified,
    }));
    return new WorldStateSnapshot(snapshotEntities);
  }

  /**
   * Validate a candidate observation against the named entity's current
   * state. Delegates to `MemoryValidator.validateConsistency` when one
   * was wired at construction; returns a deferred result with a `null`
   * `issues` array when no validator is available — callers should treat
   * `valid: undefined` as "not checked" rather than "passed".
   */
  async validateFact(
    observation: string,
    entityName: string,
  ): Promise<MemoryValidationResult | null> {
    if (!this.memoryValidator) return null;
    const entity = await this.entityManager.getEntity(entityName);
    if (!entity) return null;
    return this.memoryValidator.validateConsistency(observation, entity);
  }

  /**
   * Predict downstream effects of an action by walking the causal
   * subgraph from `actionEntity` to each candidate effect. Returns
   * empty when no causal reasoner was wired or no chain reaches any
   * candidate.
   */
  async predictOutcome(
    actionEntity: string,
    candidateEffects: string[],
  ): Promise<CausalChain[]> {
    if (!this.causalReasoner) return [];
    return this.causalReasoner.findEffects(actionEntity, candidateEffects);
  }

  /**
   * Pure: diff two snapshots. Direct passthrough to
   * `WorldStateSnapshot.diffTo` — exposed here so callers can use the
   * world-model facade for both snapshotting and change detection.
   */
  detectStateChange(
    before: WorldStateSnapshot,
    after: WorldStateSnapshot,
  ): WorldStateChange {
    return before.diffTo(after);
  }
}
