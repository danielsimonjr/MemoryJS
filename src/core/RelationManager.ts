/**
 * Relation Manager
 *
 * Handles CRUD operations for relations in the knowledge graph.
 *
 * @module core/RelationManager
 */

import type { Relation } from '../types/index.js';
import type { GraphStorage } from './GraphStorage.js';
import { ValidationError } from '../utils/errors.js';
import { BatchCreateRelationsSchema, DeleteRelationsSchema } from '../utils/index.js';
import { GRAPH_LIMITS } from '../utils/constants.js';

/**
 * Manages relation operations with automatic timestamp handling.
 */
export class RelationManager {
  constructor(private storage: GraphStorage) {}

  /**
   * Create multiple relations in a single batch operation.
   *
   * This method performs the following operations:
   * - Validates that all referenced entities exist (prevents dangling relations)
   * - Filters out duplicate relations (same from, to, and relationType)
   * - Automatically adds createdAt and lastModified timestamps
   *
   * A relation is considered duplicate if another relation exists with the same:
   * - from entity name
   * - to entity name
   * - relationType
   *
   * @param relations - Array of relations to create
   * @returns Promise resolving to array of newly created relations (excludes duplicates)
   * @throws {ValidationError} If any relation references non-existent entities
   *
   * @example
   * ```typescript
   * const manager = new RelationManager(storage);
   *
   * // Create single relation
   * const results = await manager.createRelations([{
   *   from: 'Alice',
   *   to: 'Bob',
   *   relationType: 'works_with'
   * }]);
   *
   * // Create multiple relations at once
   * await manager.createRelations([
   *   { from: 'Alice', to: 'Project_X', relationType: 'contributes_to' },
   *   { from: 'Bob', to: 'Project_X', relationType: 'leads' },
   *   { from: 'Charlie', to: 'Alice', relationType: 'reports_to' }
   * ]);
   *
   * // Duplicate relations are filtered out
   * await manager.createRelations([
   *   { from: 'Alice', to: 'Bob', relationType: 'works_with' } // Already exists, won't be added
   * ]);
   * ```
   */
  async createRelations(relations: Relation[]): Promise<Relation[]> {
    // Validate input
    const validation = BatchCreateRelationsSchema.safeParse(relations);
    if (!validation.success) {
      const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid relation data', errors);
    }

    // Use read-only graph for checking existing relations and entity existence
    const readGraph = await this.storage.loadGraph();
    const timestamp = new Date().toISOString();

    // Build set of existing entity names for O(1) lookup
    const existingEntityNames = new Set(readGraph.entities.map(e => e.name));

    // Validate that all referenced entities exist (fixes bug 7.2 from analysis)
    const danglingRelations: string[] = [];
    for (const relation of relations) {
      const missingEntities: string[] = [];
      if (!existingEntityNames.has(relation.from)) {
        missingEntities.push(relation.from);
      }
      if (!existingEntityNames.has(relation.to)) {
        missingEntities.push(relation.to);
      }
      if (missingEntities.length > 0) {
        danglingRelations.push(
          `Relation from "${relation.from}" to "${relation.to}" references non-existent entities: ${missingEntities.join(', ')}`
        );
      }
    }

    if (danglingRelations.length > 0) {
      throw new ValidationError('Relations reference non-existent entities', danglingRelations);
    }

    // Check graph size limits
    const relationsToAdd = relations.filter(r => !readGraph.relations.some(existing =>
      existing.from === r.from &&
      existing.to === r.to &&
      existing.relationType === r.relationType
    ));

    if (readGraph.relations.length + relationsToAdd.length > GRAPH_LIMITS.MAX_RELATIONS) {
      throw new ValidationError(
        'Graph size limit exceeded',
        [`Adding ${relationsToAdd.length} relations would exceed maximum of ${GRAPH_LIMITS.MAX_RELATIONS} relations`]
      );
    }

    const newRelations = relationsToAdd
      .map(r => ({
        ...r,
        createdAt: r.createdAt || timestamp,
        lastModified: r.lastModified || timestamp,
      }));

    // Get mutable copy for write operation
    const graph = await this.storage.getGraphForMutation();
    graph.relations.push(...newRelations);
    await this.storage.saveGraph(graph);

    return newRelations;
  }

  /**
   * Delete multiple relations in a single batch operation.
   *
   * This method performs the following operations:
   * - Removes all specified relations from the graph
   * - Automatically updates lastModified timestamp for all affected entities
   * - Silently ignores relations that don't exist (no error thrown)
   *
   * An entity is considered "affected" if it appears as either the source (from)
   * or target (to) of any deleted relation.
   *
   * @param relations - Array of relations to delete. Each relation is matched by from, to, and relationType.
   * @returns Promise that resolves when deletion is complete
   *
   * @example
   * ```typescript
   * const manager = new RelationManager(storage);
   *
   * // Delete single relation
   * await manager.deleteRelations([{
   *   from: 'Alice',
   *   to: 'Bob',
   *   relationType: 'works_with'
   * }]);
   *
   * // Delete multiple relations at once
   * await manager.deleteRelations([
   *   { from: 'Alice', to: 'Project_X', relationType: 'contributes_to' },
   *   { from: 'Bob', to: 'Project_X', relationType: 'leads' }
   * ]);
   * // Note: Alice, Bob, and Project_X will all have their lastModified timestamp updated
   *
   * // Safe to delete non-existent relations
   * await manager.deleteRelations([
   *   { from: 'NonExistent', to: 'AlsoNonExistent', relationType: 'fake' } // No error
   * ]);
   * ```
   */
  async deleteRelations(relations: Relation[]): Promise<void> {
    // Validate input
    const validation = DeleteRelationsSchema.safeParse(relations);
    if (!validation.success) {
      const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid relation data', errors);
    }

    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();

    // Track affected entities
    const affectedEntityNames = new Set<string>();
    relations.forEach(rel => {
      affectedEntityNames.add(rel.from);
      affectedEntityNames.add(rel.to);
    });

    // OPTIMIZED: Use Set<string> for O(1) lookup instead of O(n) array.some()
    // Create composite keys for relations to delete
    const relationsToDeleteSet = new Set(
      relations.map(r => `${r.from}|${r.to}|${r.relationType}`)
    );

    // Remove relations with O(1) Set lookup per relation instead of O(m) array scan
    graph.relations = graph.relations.filter(r =>
      !relationsToDeleteSet.has(`${r.from}|${r.to}|${r.relationType}`)
    );

    // Update lastModified for affected entities
    graph.entities.forEach(entity => {
      if (affectedEntityNames.has(entity.name)) {
        entity.lastModified = timestamp;
      }
    });

    await this.storage.saveGraph(graph);
  }

  /**
   * Retrieve all relations involving a specific entity.
   *
   * This is a read-only operation that returns all relations where the specified
   * entity appears as either the source (from) or target (to) of the relation.
   * Entity names are case-sensitive.
   *
   * @param entityName - The unique name of the entity to find relations for
   * @returns Promise resolving to array of Relation objects (empty array if no relations found)
   *
   * @example
   * ```typescript
   * const manager = new RelationManager(storage);
   *
   * // Get all relations for an entity
   * const aliceRelations = await manager.getRelations('Alice');
   * // Returns: [
   * //   { from: 'Alice', to: 'Bob', relationType: 'works_with' },
   * //   { from: 'Alice', to: 'Project_X', relationType: 'contributes_to' },
   * //   { from: 'Charlie', to: 'Alice', relationType: 'reports_to' }
   * // ]
   *
   * // Process relations by type
   * const relations = await manager.getRelations('Alice');
   * const outgoing = relations.filter(r => r.from === 'Alice');
   * const incoming = relations.filter(r => r.to === 'Alice');
   *
   * // Handle entity with no relations
   * const noRelations = await manager.getRelations('IsolatedEntity');
   * console.log(noRelations); // []
   * ```
   */
  async getRelations(entityName: string): Promise<Relation[]> {
    // OPTIMIZED: Uses RelationIndex for O(1) lookup instead of O(n) array scan
    await this.storage.ensureLoaded();
    return this.storage.getRelationsFor(entityName);
  }
}
