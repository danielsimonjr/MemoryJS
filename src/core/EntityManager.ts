/**
 * Entity Manager
 *
 * Handles CRUD operations for entities in the knowledge graph.
 * Focused on core entity and tag operations only (Phase 4: Consolidate God Objects).
 *
 * @module core/EntityManager
 */

import type { Entity, LongRunningOperationOptions } from '../types/index.js';
import type { GraphStorage } from './GraphStorage.js';
import { EntityNotFoundError, InvalidImportanceError, ValidationError } from '../utils/errors.js';
import {
  BatchCreateEntitiesSchema,
  UpdateEntitySchema,
  EntityNamesSchema,
  checkCancellation,
  createProgressReporter,
  createProgress,
  sanitizeObject,
} from '../utils/index.js';
import { GRAPH_LIMITS } from '../utils/constants.js';

/**
 * Minimum importance value (least important).
 * Note: Use IMPORTANCE_RANGE from constants.ts for external access.
 */
const MIN_IMPORTANCE = 0;

/**
 * Maximum importance value (most important).
 * Note: Use IMPORTANCE_RANGE from constants.ts for external access.
 */
const MAX_IMPORTANCE = 10;

/**
 * Manages entity operations with automatic timestamp handling.
 */
export class EntityManager {
  constructor(private storage: GraphStorage) {}

  /**
   * Create multiple entities in a single batch operation.
   *
   * This method performs the following operations:
   * - Filters out entities that already exist (duplicate names)
   * - Automatically adds createdAt and lastModified timestamps
   * - Normalizes all tags to lowercase for consistent searching
   * - Validates importance values (must be between 0-10)
   *
   * Phase 9B: Supports progress tracking and cancellation via LongRunningOperationOptions.
   *
   * @param entities - Array of entities to create. Each entity must have a unique name.
   * @param options - Optional progress/cancellation options (Phase 9B)
   * @returns Promise resolving to array of newly created entities (excludes duplicates)
   * @throws {InvalidImportanceError} If any entity has importance outside the valid range [0-10]
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Create single entity
   * const results = await manager.createEntities([{
   *   name: 'Alice',
   *   entityType: 'person',
   *   observations: ['Works as engineer', 'Lives in Seattle'],
   *   importance: 7,
   *   tags: ['Team', 'Engineering']
   * }]);
   *
   * // Create multiple entities at once
   * const users = await manager.createEntities([
   *   { name: 'Bob', entityType: 'person', observations: [] },
   *   { name: 'Charlie', entityType: 'person', observations: [] }
   * ]);
   *
   * // With progress tracking and cancellation (Phase 9B)
   * const controller = new AbortController();
   * const results = await manager.createEntities(largeEntityArray, {
   *   signal: controller.signal,
   *   onProgress: (p) => console.log(`${p.percentage}% complete`),
   * });
   * ```
   */
  async createEntities(
    entities: Entity[],
    options?: LongRunningOperationOptions
  ): Promise<Entity[]> {
    // Check for early cancellation
    checkCancellation(options?.signal, 'createEntities');

    // Validate input
    const validation = BatchCreateEntitiesSchema.safeParse(entities);
    if (!validation.success) {
      const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid entity data', errors);
    }

    // Setup progress reporter
    const reportProgress = createProgressReporter(options?.onProgress);
    const total = entities.length;
    reportProgress?.(createProgress(0, total, 'createEntities'));

    // Use read-only graph for checking existing entities
    const readGraph = await this.storage.loadGraph();
    const timestamp = new Date().toISOString();

    // Check graph size limits
    const entitiesToAdd = entities.filter(e => !readGraph.entities.some(existing => existing.name === e.name));
    if (readGraph.entities.length + entitiesToAdd.length > GRAPH_LIMITS.MAX_ENTITIES) {
      throw new ValidationError(
        'Graph size limit exceeded',
        [`Adding ${entitiesToAdd.length} entities would exceed maximum of ${GRAPH_LIMITS.MAX_ENTITIES} entities`]
      );
    }

    // Check for cancellation before processing
    checkCancellation(options?.signal, 'createEntities');

    const newEntities: Entity[] = [];
    let processed = 0;

    for (const e of entitiesToAdd) {
      // Check for cancellation periodically
      checkCancellation(options?.signal, 'createEntities');

      const entity: Entity = {
        ...e,
        createdAt: e.createdAt || timestamp,
        lastModified: e.lastModified || timestamp,
      };

      // Normalize tags to lowercase
      if (e.tags) {
        entity.tags = e.tags.map(tag => tag.toLowerCase());
      }

      // Validate importance
      if (e.importance !== undefined) {
        if (e.importance < MIN_IMPORTANCE || e.importance > MAX_IMPORTANCE) {
          throw new InvalidImportanceError(e.importance, MIN_IMPORTANCE, MAX_IMPORTANCE);
        }
        entity.importance = e.importance;
      }

      newEntities.push(entity);
      processed++;
      reportProgress?.(createProgress(processed, entitiesToAdd.length, 'createEntities'));
    }

    // OPTIMIZED: Use append for single entity, bulk save for multiple
    // (N individual appends is slower than one bulk write)
    if (newEntities.length === 1) {
      await this.storage.appendEntity(newEntities[0]);
    } else if (newEntities.length > 1) {
      const graph = await this.storage.getGraphForMutation();
      graph.entities.push(...newEntities);
      await this.storage.saveGraph(graph);
    }

    // Report completion
    reportProgress?.(createProgress(entitiesToAdd.length, entitiesToAdd.length, 'createEntities'));

    return newEntities;
  }

  /**
   * Delete multiple entities by name in a single batch operation.
   *
   * This method performs cascading deletion:
   * - Removes all specified entities from the graph
   * - Automatically removes all relations where these entities are source or target
   * - Silently ignores entity names that don't exist (no error thrown)
   *
   * @param entityNames - Array of entity names to delete
   * @returns Promise that resolves when deletion is complete
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Delete single entity
   * await manager.deleteEntities(['Alice']);
   *
   * // Delete multiple entities at once
   * await manager.deleteEntities(['Bob', 'Charlie', 'Dave']);
   *
   * // Safe to delete non-existent entities (no error)
   * await manager.deleteEntities(['NonExistent']); // No error thrown
   * ```
   */
  async deleteEntities(entityNames: string[]): Promise<void> {
    // Validate input
    const validation = EntityNamesSchema.safeParse(entityNames);
    if (!validation.success) {
      const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid entity names', errors);
    }

    const graph = await this.storage.getGraphForMutation();

    // OPTIMIZED: Use Set for O(1) lookups instead of O(n) includes()
    const namesToDelete = new Set(entityNames);
    graph.entities = graph.entities.filter(e => !namesToDelete.has(e.name));
    graph.relations = graph.relations.filter(
      r => !namesToDelete.has(r.from) && !namesToDelete.has(r.to)
    );

    await this.storage.saveGraph(graph);
  }

  /**
   * Retrieve a single entity by its unique name.
   *
   * This is a read-only operation that does not modify the graph.
   * Entity names are case-sensitive.
   *
   * @param name - The unique name of the entity to retrieve
   * @returns Promise resolving to the Entity object if found, or null if not found
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Get an existing entity
   * const alice = await manager.getEntity('Alice');
   * if (alice) {
   *   console.log(alice.observations);
   *   console.log(alice.importance);
   * }
   *
   * // Handle non-existent entity
   * const missing = await manager.getEntity('NonExistent');
   * console.log(missing); // null
   * ```
   */
  async getEntity(name: string): Promise<Entity | null> {
    const graph = await this.storage.loadGraph();
    return graph.entities.find(e => e.name === name) || null;
  }

  /**
   * Update one or more fields of an existing entity.
   *
   * This method allows partial updates - only the fields specified in the updates
   * object will be changed. All other fields remain unchanged.
   * The lastModified timestamp is automatically updated.
   *
   * @param name - The unique name of the entity to update
   * @param updates - Partial entity object containing only the fields to update
   * @returns Promise resolving to the fully updated Entity object
   * @throws {EntityNotFoundError} If no entity with the given name exists
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Update importance only
   * const updated = await manager.updateEntity('Alice', {
   *   importance: 9
   * });
   *
   * // Update multiple fields
   * await manager.updateEntity('Bob', {
   *   entityType: 'senior_engineer',
   *   tags: ['leadership', 'architecture'],
   *   observations: ['Led project X', 'Designed system Y']
   * });
   *
   * // Add observations (requires reading existing entity first)
   * const entity = await manager.getEntity('Charlie');
   * if (entity) {
   *   await manager.updateEntity('Charlie', {
   *     observations: [...entity.observations, 'New observation']
   *   });
   * }
   * ```
   */
  async updateEntity(name: string, updates: Partial<Entity>): Promise<Entity> {
    // Validate input
    const validation = UpdateEntitySchema.safeParse(updates);
    if (!validation.success) {
      const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid update data', errors);
    }

    const graph = await this.storage.getGraphForMutation();
    const entity = graph.entities.find(e => e.name === name);

    if (!entity) {
      throw new EntityNotFoundError(name);
    }

    // Apply updates (sanitized to prevent prototype pollution)
    Object.assign(entity, sanitizeObject(updates as Record<string, unknown>));
    entity.lastModified = new Date().toISOString();

    await this.storage.saveGraph(graph);
    return entity;
  }

  /**
   * Update multiple entities in a single batch operation.
   *
   * This method is more efficient than calling updateEntity multiple times
   * as it loads and saves the graph only once. All updates are applied atomically.
   * The lastModified timestamp is automatically updated for all entities.
   *
   * @param updates - Array of updates, each containing entity name and changes
   * @returns Promise resolving to array of updated entities
   * @throws {EntityNotFoundError} If any entity is not found
   * @throws {ValidationError} If any update data is invalid
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Update multiple entities at once
   * const updated = await manager.batchUpdate([
   *   { name: 'Alice', updates: { importance: 9 } },
   *   { name: 'Bob', updates: { importance: 8, tags: ['senior'] } },
   *   { name: 'Charlie', updates: { entityType: 'lead_engineer' } }
   * ]);
   *
   * console.log(`Updated ${updated.length} entities`);
   *
   * // Efficiently update many entities (single graph load/save)
   * const massUpdate = employees.map(name => ({
   *   name,
   *   updates: { tags: ['team-2024'] }
   * }));
   * await manager.batchUpdate(massUpdate);
   * ```
   */
  async batchUpdate(
    updates: Array<{ name: string; updates: Partial<Entity> }>
  ): Promise<Entity[]> {
    // Validate all updates first
    for (const { updates: updateData } of updates) {
      const validation = UpdateEntitySchema.safeParse(updateData);
      if (!validation.success) {
        const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        throw new ValidationError('Invalid update data', errors);
      }
    }

    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    const updatedEntities: Entity[] = [];

    // OPTIMIZED: Build Map for O(1) lookups instead of O(n) find() per update
    const entityIndex = new Map<string, number>();
    graph.entities.forEach((e, i) => entityIndex.set(e.name, i));

    for (const { name, updates: updateData } of updates) {
      const idx = entityIndex.get(name);
      if (idx === undefined) {
        throw new EntityNotFoundError(name);
      }
      const entity = graph.entities[idx];

      // Apply updates (sanitized to prevent prototype pollution)
      Object.assign(entity, sanitizeObject(updateData as Record<string, unknown>));
      entity.lastModified = timestamp;
      updatedEntities.push(entity);
    }

    await this.storage.saveGraph(graph);
    return updatedEntities;
  }

  // ============================================================
  // TAG OPERATIONS
  // ============================================================

  /**
   * Add tags to an entity.
   *
   * Tags are normalized to lowercase and duplicates are filtered out.
   *
   * @param entityName - Name of the entity
   * @param tags - Tags to add
   * @returns Result with entity name and added tags
   * @throws {EntityNotFoundError} If entity is not found
   */
  async addTags(entityName: string, tags: string[]): Promise<{ entityName: string; addedTags: string[] }> {
    // OPTIMIZED: Use O(1) NameIndex lookup instead of loadGraph() + O(n) find()
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new EntityNotFoundError(entityName);
    }

    // Initialize tags array if it doesn't exist
    const existingTags = entity.tags || [];

    // Normalize tags to lowercase and filter out duplicates
    const normalizedTags = tags.map(tag => tag.toLowerCase());
    const newTags = normalizedTags.filter(tag => !existingTags.includes(tag));

    if (newTags.length > 0) {
      // OPTIMIZED: Use updateEntity for in-place update + append
      await this.storage.updateEntity(entityName, { tags: [...existingTags, ...newTags] });
    }

    return { entityName, addedTags: newTags };
  }

  /**
   * Remove tags from an entity.
   *
   * @param entityName - Name of the entity
   * @param tags - Tags to remove
   * @returns Result with entity name and removed tags
   * @throws {EntityNotFoundError} If entity is not found
   */
  async removeTags(entityName: string, tags: string[]): Promise<{ entityName: string; removedTags: string[] }> {
    // OPTIMIZED: Use O(1) NameIndex lookup instead of loadGraph() + O(n) find()
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new EntityNotFoundError(entityName);
    }

    if (!entity.tags) {
      return { entityName, removedTags: [] };
    }

    // Normalize tags to lowercase
    const normalizedTags = tags.map(tag => tag.toLowerCase());
    const originalLength = entity.tags.length;

    // Capture existing tags (lowercase) BEFORE filtering to accurately track removals
    const existingTagsLower = entity.tags.map(t => t.toLowerCase());

    // Filter out the tags to remove
    const newTags = entity.tags.filter(tag => !normalizedTags.includes(tag.toLowerCase()));

    // A tag was removed if it existed in the original tags
    const removedTags = normalizedTags.filter(tag => existingTagsLower.includes(tag));

    // Update entity via storage if tags were removed
    if (newTags.length < originalLength) {
      await this.storage.updateEntity(entityName, { tags: newTags });
    }

    return { entityName, removedTags };
  }

  /**
   * Set importance level for an entity.
   *
   * @param entityName - Name of the entity
   * @param importance - Importance level (0-10)
   * @returns Result with entity name and importance
   * @throws {EntityNotFoundError} If entity is not found
   * @throws {Error} If importance is out of range
   */
  async setImportance(entityName: string, importance: number): Promise<{ entityName: string; importance: number }> {
    // Validate importance range (0-10)
    if (importance < 0 || importance > 10) {
      throw new Error(`Importance must be between 0 and 10, got ${importance}`);
    }

    // OPTIMIZED: Use O(1) NameIndex lookup instead of loadGraph() + O(n) find()
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new EntityNotFoundError(entityName);
    }

    // Use updateEntity for in-place update + append
    await this.storage.updateEntity(entityName, { importance });

    return { entityName, importance };
  }

  /**
   * Add tags to multiple entities in a single operation.
   *
   * OPTIMIZED: Uses Map for O(1) entity lookups instead of O(n) find() per entity.
   *
   * @param entityNames - Names of entities to tag
   * @param tags - Tags to add to each entity
   * @returns Array of results showing which tags were added to each entity
   */
  async addTagsToMultipleEntities(entityNames: string[], tags: string[]): Promise<{ entityName: string; addedTags: string[] }[]> {
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    const normalizedTags = tags.map(tag => tag.toLowerCase());
    const results: { entityName: string; addedTags: string[] }[] = [];

    // OPTIMIZED: Build Map for O(1) lookups instead of O(n) find() per entity
    const entityMap = new Map<string, Entity>();
    for (const e of graph.entities) {
      entityMap.set(e.name, e);
    }

    for (const entityName of entityNames) {
      const entity = entityMap.get(entityName);
      if (!entity) {
        continue; // Skip non-existent entities
      }

      // Initialize tags array if it doesn't exist
      if (!entity.tags) {
        entity.tags = [];
      }

      // Filter out duplicates
      const newTags = normalizedTags.filter(tag => !entity.tags!.includes(tag));
      entity.tags.push(...newTags);

      // Update lastModified timestamp if tags were added
      if (newTags.length > 0) {
        entity.lastModified = timestamp;
      }

      results.push({ entityName, addedTags: newTags });
    }

    await this.storage.saveGraph(graph);
    return results;
  }

  /**
   * Replace a tag with a new tag across all entities (rename tag).
   *
   * @param oldTag - Tag to replace
   * @param newTag - New tag value
   * @returns Result with affected entities and count
   */
  async replaceTag(oldTag: string, newTag: string): Promise<{ affectedEntities: string[]; count: number }> {
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    const normalizedOldTag = oldTag.toLowerCase();
    const normalizedNewTag = newTag.toLowerCase();
    const affectedEntities: string[] = [];

    for (const entity of graph.entities) {
      if (!entity.tags || !entity.tags.includes(normalizedOldTag)) {
        continue;
      }

      // Replace old tag with new tag
      const index = entity.tags.indexOf(normalizedOldTag);
      entity.tags[index] = normalizedNewTag;
      entity.lastModified = timestamp;
      affectedEntities.push(entity.name);
    }

    await this.storage.saveGraph(graph);
    return { affectedEntities, count: affectedEntities.length };
  }

  /**
   * Merge two tags into one target tag across all entities.
   *
   * Combines tag1 and tag2 into targetTag. Any entity with either tag1 or tag2
   * will have both removed and targetTag added (if not already present).
   *
   * @param tag1 - First tag to merge
   * @param tag2 - Second tag to merge
   * @param targetTag - Target tag to merge into
   * @returns Object with affected entity names and count
   */
  async mergeTags(tag1: string, tag2: string, targetTag: string): Promise<{ affectedEntities: string[]; count: number }> {
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();
    const normalizedTag1 = tag1.toLowerCase();
    const normalizedTag2 = tag2.toLowerCase();
    const normalizedTargetTag = targetTag.toLowerCase();
    const affectedEntities: string[] = [];

    for (const entity of graph.entities) {
      if (!entity.tags) {
        continue;
      }

      const hasTag1 = entity.tags.includes(normalizedTag1);
      const hasTag2 = entity.tags.includes(normalizedTag2);

      if (!hasTag1 && !hasTag2) {
        continue;
      }

      // Remove both tags
      entity.tags = entity.tags.filter(tag => tag !== normalizedTag1 && tag !== normalizedTag2);

      // Add target tag if not already present
      if (!entity.tags.includes(normalizedTargetTag)) {
        entity.tags.push(normalizedTargetTag);
      }

      entity.lastModified = timestamp;
      affectedEntities.push(entity.name);
    }

    await this.storage.saveGraph(graph);
    return { affectedEntities, count: affectedEntities.length };
  }
}
