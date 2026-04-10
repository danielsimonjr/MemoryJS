/**
 * Relation Manager
 *
 * Handles CRUD operations for relations in the knowledge graph.
 *
 * @module core/RelationManager
 */

import type { Relation } from '../types/index.js';
import type { GraphStorage } from './GraphStorage.js';
import { ValidationError, RelationNotFoundError } from '../utils/errors.js';
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

    // Acquire mutex to prevent TOCTOU race between validation and mutation
    const release = await this.storage.graphMutex.acquire();
    try {
      // Use mutable graph for both validation and mutation (eliminates TOCTOU gap)
      const graph = await this.storage.getGraphForMutation();
      const timestamp = new Date().toISOString();

      // Build set of existing entity names for O(1) lookup
      const existingEntityNames = new Set(graph.entities.map(e => e.name));

      // Validate that all referenced entities exist
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
      const relationsToAdd = relations.filter(r => !graph.relations.some(existing =>
        existing.from === r.from &&
        existing.to === r.to &&
        existing.relationType === r.relationType
      ));

      if (graph.relations.length + relationsToAdd.length > GRAPH_LIMITS.MAX_RELATIONS) {
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

      if (newRelations.length > 0) {
        graph.relations.push(...newRelations);
        await this.storage.saveGraph(graph);
      }

      return newRelations;
    } finally {
      release();
    }
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

    const release = await this.storage.graphMutex.acquire();
    try {
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
        relations.map(r => `${r.from}\0${r.to}\0${r.relationType}`)
      );

      // Remove relations with O(1) Set lookup per relation instead of O(m) array scan
      graph.relations = graph.relations.filter(r =>
        !relationsToDeleteSet.has(`${r.from}\0${r.to}\0${r.relationType}`)
      );

      // Update lastModified for affected entities
      graph.entities.forEach(entity => {
        if (affectedEntityNames.has(entity.name)) {
          entity.lastModified = timestamp;
        }
      });

      await this.storage.saveGraph(graph);
    } finally {
      release();
    }
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

  /**
   * Mark a temporal relation as no longer valid by setting validUntil.
   *
   * This method finds an active (non-terminated) relation matching the specified
   * from, relationType, and to parameters, then sets its properties.validUntil
   * to indicate when the relation ended.
   *
   * @param from - Source entity name
   * @param relationType - Type of the relation
   * @param to - Target entity name
   * @param ended - ISO 8601 timestamp when the relation ended (defaults to current time)
   * @returns Promise that resolves when invalidation is complete
   * @throws {Error} If no active relation is found matching the criteria
   *
   * @example
   * ```typescript
   * const manager = new RelationManager(storage);
   *
   * // Mark a relation as ended (using custom date)
   * await manager.invalidateRelation('kai', 'works_on', 'orion', '2026-03-01');
   *
   * // Mark a relation as ended (using current time)
   * await manager.invalidateRelation('kai', 'works_on', 'orion');
   * ```
   */
  async invalidateRelation(
    from: string,
    relationType: string,
    to: string,
    ended?: string
  ): Promise<void> {
    const release = await this.storage.graphMutex.acquire();
    try {
      const graph = await this.storage.getGraphForMutation();
      const match = graph.relations.find(
        r =>
          r.from === from &&
          r.relationType === relationType &&
          r.to === to &&
          !r.properties?.validUntil
      );
      if (!match) {
        throw new RelationNotFoundError(from, to, relationType);
      }
      if (!match.properties) {
        match.properties = {};
      }
      match.properties.validUntil = ended ?? new Date().toISOString();
      match.lastModified = new Date().toISOString();
      await this.storage.saveGraph(graph);
    } finally {
      release();
    }
  }

  /**
   * Query relations valid at a specific point in time.
   *
   * This method returns relations involving an entity that are valid at the specified
   * date. A relation is considered valid if:
   * - validFrom is undefined OR validFrom <= asOf
   * - validUntil is undefined OR validUntil >= asOf
   *
   * @param entityName - The entity to query relations for
   * @param asOf - ISO 8601 date string to query at
   * @param options - Optional filters: direction ('outgoing' | 'incoming' | 'both', default: 'both')
   * @returns Promise resolving to array of relations valid at the given date
   *
   * @example
   * ```typescript
   * const manager = new RelationManager(storage);
   *
   * // Get relations valid in June 2025
   * const mid2025 = await manager.queryAsOf('kai', '2025-06-15');
   *
   * // Get only outgoing relations at a point in time
   * const outgoing = await manager.queryAsOf('kai', '2026-01-01', { direction: 'outgoing' });
   * ```
   */
  async queryAsOf(
    entityName: string,
    asOf: string,
    options?: { direction?: 'outgoing' | 'incoming' | 'both' }
  ): Promise<Relation[]> {
    if (asOf && !/^\d{4}-\d{2}-\d{2}/.test(asOf)) {
      throw new ValidationError(`asOf must be an ISO 8601 date string, got: '${asOf}'`, []);
    }
    const direction = options?.direction ?? 'both';
    const graph = await this.storage.loadGraph();
    return graph.relations.filter(r => {
      const matchesDirection =
        direction === 'both'
          ? r.from === entityName || r.to === entityName
          : direction === 'outgoing'
            ? r.from === entityName
            : r.to === entityName;
      if (!matchesDirection) return false;
      const vf = r.properties?.validFrom;
      const vu = r.properties?.validUntil;
      if (vf && vf > asOf) return false;
      if (vu && vu < asOf) return false;
      return true;
    });
  }

  /**
   * Get all relations for an entity in chronological order.
   *
   * This method returns all relations involving an entity, sorted chronologically
   * by their validFrom timestamp. Relations without a validFrom date are sorted
   * to the end.
   *
   * @param entityName - The entity to get timeline for
   * @param options - Optional filters: direction ('outgoing' | 'incoming' | 'both', default: 'both')
   * @returns Promise resolving to relations sorted by validFrom
   *
   * @example
   * ```typescript
   * const manager = new RelationManager(storage);
   *
   * // Get timeline of all relations for an entity
   * const timeline = await manager.timeline('kai');
   *
   * // Get only outgoing relations in chronological order
   * const outgoing = await manager.timeline('kai', { direction: 'outgoing' });
   * ```
   */
  async timeline(
    entityName: string,
    options?: { direction?: 'outgoing' | 'incoming' | 'both' }
  ): Promise<Relation[]> {
    const direction = options?.direction ?? 'both';
    const graph = await this.storage.loadGraph();
    const rels = graph.relations.filter(r => {
      if (direction === 'both') return r.from === entityName || r.to === entityName;
      if (direction === 'outgoing') return r.from === entityName;
      return r.to === entityName;
    });
    rels.sort((a, b) => {
      const aFrom = a.properties?.validFrom ?? '';
      const bFrom = b.properties?.validFrom ?? '';
      if (!aFrom && !bFrom) return 0;
      if (!aFrom) return 1;
      if (!bFrom) return -1;
      return aFrom.localeCompare(bFrom);
    });
    return rels;
  }
}
