/**
 * Contradiction Detector
 *
 * Detects when new observations contradict existing ones using semantic
 * similarity. Feature 2 of the v1.8.0 supermemory gap-closing effort.
 *
 * @module features/ContradictionDetector
 */

import type { Entity, EntityStatus } from '../types/types.js';
import type { PlanRecord } from '../types/agent-memory.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';
import type { EntityManager } from '../core/EntityManager.js';

/**
 * A pair of observations that are semantically close but not identical.
 */
export interface Contradiction {
  /** Existing observation on the entity */
  existingObservation: string;
  /** New observation attempting to be added */
  newObservation: string;
  /** Cosine similarity score (0-1) */
  similarity: number;
}

/** Optional arguments for {@link ContradictionDetector.supersede}. */
export interface SupersedeOptions {
  causedByFailureId?: string;
  lifecycleStatus?: EntityStatus;
  /**
   * Guarded edits set this. Skip `detect`. Keep every existing observation.
   * Copy subtype fields that are present on the old entity:
   * `memoryType`, `heuristicRecord` (structuredClone), `agentId`,
   * `visibility`, `confidence`, `confirmationCount`, `source`.
   * Do not copy `id`, `name`, `contentHash`, `supersededBy`, or the
   * version-chain fields. Those are set by this method, as today.
   */
  preserveBody?: boolean;
  patch?: Partial<Pick<Entity, 'importance' | 'confidence' | 'ttl'>>;
  /** When set with `preserveBody`, stored on the new entity instead of copying from the old plan. */
  planRecord?: PlanRecord;
}

/**
 * Finds new observations that contradict existing observations on an entity.
 *
 * A contradiction is a pair with a cosine similarity at or above the
 * threshold (default 0.85) that is not an exact text match.
 */
export class ContradictionDetector {
  constructor(
    private semanticSearch: SemanticSearch,
    private threshold: number = 0.85
  ) {}

  /**
   * Check if any new observation contradicts an existing observation on the entity.
   *
   * Contradiction = high semantic similarity but not exact match. Two facts
   * about the same subject with different values (e.g. "Lives in NYC" vs
   * "Lives in SF") will be semantically close but textually different.
   */
  async detect(
    entity: Entity,
    newObservations: string[]
  ): Promise<Contradiction[]> {
    if (entity.observations.length === 0) return [];
    if (newObservations.length === 0) return [];

    const contradictions: Contradiction[] = [];

    for (const newObs of newObservations) {
      for (const existingObs of entity.observations) {
        if (newObs === existingObs) continue; // skip exact matches
        const similarity = await this.semanticSearch.calculateSimilarity(
          newObs,
          existingObs
        );
        if (similarity >= this.threshold) {
          contradictions.push({
            existingObservation: existingObs,
            newObservation: newObs,
            similarity,
          });
        }
      }
    }

    return contradictions;
  }

  /**
   * Create a new version of an entity that supersedes the old one.
   * The old entity gets isLatest=false and supersededBy=newName.
   * The new entity becomes the latest in the chain.
   *
   * @param oldEntity - The entity being superseded
   * @param newObservations - Observations to merge into the new version
   *   (non-contradicted existing observations are carried over automatically)
   * @param entityManager - Used to persist both the updated old entity and the new version
   * @param options - Optional failure link, lifecycle, body preservation, or scalar patch
   * @returns The newly created entity
   */
  async supersede(
    oldEntity: Entity,
    newObservations: string[],
    entityManager: EntityManager,
    options?: SupersedeOptions
  ): Promise<Entity> {
    const currentVersion = oldEntity.version ?? 1;
    const nextVersion = currentVersion + 1;
    const rootName = oldEntity.rootEntityName ?? oldEntity.name;
    const newName = `${rootName}-v${nextVersion}`;

    const preserveBody = options?.preserveBody === true;
    let observations: string[];

    if (preserveBody) {
      observations = [...oldEntity.observations, ...newObservations];
    } else {
      const contradictions = await this.detect(oldEntity, newObservations);
      const contradictedSet = new Set(
        contradictions.map(c => c.existingObservation)
      );
      const preserved = oldEntity.observations.filter(
        o => !contradictedSet.has(o)
      );
      observations = [...preserved, ...newObservations];
    }

    const oldRecord = oldEntity as unknown as Record<string, unknown>;

    const newEntity: Entity = {
      name: newName,
      entityType: oldEntity.entityType,
      observations,
      tags: oldEntity.tags ? [...oldEntity.tags] : undefined,
      importance: options?.patch?.importance ?? oldEntity.importance,
      parentId: oldEntity.parentId,
      projectId: oldEntity.projectId,
      version: nextVersion,
      parentEntityName: oldEntity.name,
      rootEntityName: rootName,
      isLatest: true,
    };

    // Default supersede copies only the fields it copied before options existed.
    // confidence/ttl come from an explicit patch, or from the old entity when
    // preserveBody keeps the rest of the body.
    if (options?.patch?.confidence !== undefined) {
      newEntity.confidence = options.patch.confidence;
    } else if (preserveBody && oldEntity.confidence !== undefined) {
      newEntity.confidence = oldEntity.confidence;
    }
    if (options?.patch?.ttl !== undefined) {
      newEntity.ttl = options.patch.ttl;
    } else if (preserveBody && oldEntity.ttl !== undefined) {
      newEntity.ttl = oldEntity.ttl;
    }

    if (options?.causedByFailureId !== undefined) {
      newEntity.causedByFailureId = options.causedByFailureId;
    }
    if (options?.lifecycleStatus !== undefined) {
      newEntity.lifecycleStatus = options.lifecycleStatus;
    }

    if (preserveBody) {
      if (oldRecord.memoryType !== undefined) {
        (newEntity as unknown as Record<string, unknown>).memoryType = oldRecord.memoryType;
      }
      if (oldRecord.heuristicRecord !== undefined) {
        (newEntity as unknown as Record<string, unknown>).heuristicRecord = structuredClone(
          oldRecord.heuristicRecord
        );
      }
      if (oldRecord.agentId !== undefined) {
        (newEntity as unknown as Record<string, unknown>).agentId = oldRecord.agentId;
      }
      if (oldRecord.visibility !== undefined) {
        (newEntity as unknown as Record<string, unknown>).visibility = oldRecord.visibility;
      }
      if (oldRecord.confirmationCount !== undefined) {
        (newEntity as unknown as Record<string, unknown>).confirmationCount =
          oldRecord.confirmationCount;
      }
      if (oldRecord.accessCount !== undefined) {
        (newEntity as unknown as Record<string, unknown>).accessCount = oldRecord.accessCount;
      }
      if (oldRecord.source !== undefined) {
        (newEntity as unknown as Record<string, unknown>).source = structuredClone(oldRecord.source);
      }
      if (options?.planRecord !== undefined) {
        (newEntity as unknown as Record<string, unknown>).planRecord = structuredClone(options.planRecord);
      } else if (oldRecord.planRecord !== undefined) {
        (newEntity as unknown as Record<string, unknown>).planRecord = structuredClone(oldRecord.planRecord);
      }
    }

    await entityManager.createEntities([newEntity]);

    await entityManager.updateEntity(oldEntity.name, {
      isLatest: false,
      supersededBy: newName,
    });

    return newEntity;
  }
}
