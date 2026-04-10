/**
 * Contradiction Detector
 *
 * Detects when new observations contradict existing ones using semantic
 * similarity. Feature 2 of the v1.8.0 supermemory gap-closing effort.
 *
 * @module features/ContradictionDetector
 */

import type { Entity } from '../types/types.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';
import type { EntityManager } from '../core/EntityManager.js';

export interface Contradiction {
  /** Existing observation on the entity */
  existingObservation: string;
  /** New observation attempting to be added */
  newObservation: string;
  /** Cosine similarity score (0-1) */
  similarity: number;
}

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
   * @returns The newly created entity
   */
  async supersede(
    oldEntity: Entity,
    newObservations: string[],
    entityManager: EntityManager
  ): Promise<Entity> {
    const currentVersion = oldEntity.version ?? 1;
    const nextVersion = currentVersion + 1;
    const rootName = oldEntity.rootEntityName ?? oldEntity.name;
    const newName = `${rootName}-v${nextVersion}`;

    // Detect which existing observations are contradicted
    const contradictions = await this.detect(oldEntity, newObservations);
    const contradictedSet = new Set(
      contradictions.map(c => c.existingObservation)
    );
    const preserved = oldEntity.observations.filter(
      o => !contradictedSet.has(o)
    );

    // Create the new version
    const newEntity: Entity = {
      name: newName,
      entityType: oldEntity.entityType,
      observations: [...preserved, ...newObservations],
      tags: oldEntity.tags ? [...oldEntity.tags] : undefined,
      importance: oldEntity.importance,
      parentId: oldEntity.parentId,
      projectId: oldEntity.projectId,
      version: nextVersion,
      parentEntityName: oldEntity.name,
      rootEntityName: rootName,
      isLatest: true,
    };

    await entityManager.createEntities([newEntity]);

    // Mark old entity as superseded
    await entityManager.updateEntity(oldEntity.name, {
      isLatest: false,
      supersededBy: newName,
    });

    return newEntity;
  }
}
