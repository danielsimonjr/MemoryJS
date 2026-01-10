/**
 * Observation Manager
 *
 * Handles observation CRUD operations for entities.
 * Extracted from EntityManager (Phase 4: Consolidate God Objects).
 *
 * @module core/ObservationManager
 */

import type { GraphStorage } from './GraphStorage.js';
import { EntityNotFoundError } from '../utils/errors.js';

/**
 * Manages observation operations for entities in the knowledge graph.
 */
export class ObservationManager {
  constructor(private storage: GraphStorage) {}

  /**
   * Add observations to multiple entities in a single batch operation.
   *
   * This method performs the following operations:
   * - Adds new observations to specified entities
   * - Filters out duplicate observations (already present)
   * - Updates lastModified timestamp only if new observations were added
   * - ATOMIC: All updates are saved in a single operation
   *
   * @param observations - Array of entity names and observations to add
   * @returns Promise resolving to array of results showing which observations were added
   * @throws {EntityNotFoundError} If any entity is not found
   *
   * @example
   * ```typescript
   * const manager = new ObservationManager(storage);
   *
   * // Add observations to multiple entities
   * const results = await manager.addObservations([
   *   { entityName: 'Alice', contents: ['Completed project X', 'Started project Y'] },
   *   { entityName: 'Bob', contents: ['Joined team meeting'] }
   * ]);
   *
   * // Check what was added (duplicates are filtered out)
   * results.forEach(r => {
   *   console.log(`${r.entityName}: added ${r.addedObservations.length} new observations`);
   * });
   * ```
   */
  async addObservations(
    observations: { entityName: string; contents: string[] }[]
  ): Promise<{ entityName: string; addedObservations: string[] }[]> {
    // Get mutable graph for atomic update
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    const results: { entityName: string; addedObservations: string[] }[] = [];
    let hasChanges = false;

    for (const o of observations) {
      const entity = graph.entities.find(e => e.name === o.entityName);
      if (!entity) {
        throw new EntityNotFoundError(o.entityName);
      }

      const newObservations = o.contents.filter(content => !entity.observations.includes(content));

      if (newObservations.length > 0) {
        // Add new observations directly to the entity
        entity.observations.push(...newObservations);
        entity.lastModified = timestamp;
        hasChanges = true;
      }

      results.push({ entityName: o.entityName, addedObservations: newObservations });
    }

    // Save all changes in a single atomic operation
    if (hasChanges) {
      await this.storage.saveGraph(graph);
    }

    return results;
  }

  /**
   * Delete observations from multiple entities in a single batch operation.
   *
   * This method performs the following operations:
   * - Removes specified observations from entities
   * - Updates lastModified timestamp only if observations were deleted
   * - Silently ignores entities that don't exist (no error thrown)
   * - ATOMIC: All deletions are saved in a single operation
   *
   * @param deletions - Array of entity names and observations to delete
   * @returns Promise that resolves when deletion is complete
   *
   * @example
   * ```typescript
   * const manager = new ObservationManager(storage);
   *
   * // Delete observations from multiple entities
   * await manager.deleteObservations([
   *   { entityName: 'Alice', observations: ['Old observation 1', 'Old observation 2'] },
   *   { entityName: 'Bob', observations: ['Outdated info'] }
   * ]);
   *
   * // Safe to delete from non-existent entities (no error)
   * await manager.deleteObservations([
   *   { entityName: 'NonExistent', observations: ['Some text'] }
   * ]); // No error thrown
   * ```
   */
  async deleteObservations(
    deletions: { entityName: string; observations: string[] }[]
  ): Promise<void> {
    // Get mutable graph for atomic update
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    let hasChanges = false;

    deletions.forEach(d => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity) {
        const originalLength = entity.observations.length;
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));

        // Update lastModified timestamp if observations were deleted
        if (entity.observations.length < originalLength) {
          entity.lastModified = timestamp;
          hasChanges = true;
        }
      }
    });

    // Save all changes in a single atomic operation
    if (hasChanges) {
      await this.storage.saveGraph(graph);
    }
  }
}
