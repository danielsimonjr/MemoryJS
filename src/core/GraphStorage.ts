/**
 * Graph Storage
 *
 * Handles file I/O operations for the knowledge graph using JSONL format.
 * Implements IGraphStorage interface for storage abstraction.
 *
 * @module core/GraphStorage
 */

import { promises as fs } from 'fs';
import { Mutex } from 'async-mutex';
import type { KnowledgeGraph, Entity, Relation, ReadonlyKnowledgeGraph, IGraphStorage, LowercaseData } from '../types/index.js';
import { clearAllSearchCaches } from '../utils/searchCache.js';
import { NameIndex, TypeIndex, LowercaseCache, RelationIndex, ObservationIndex } from '../utils/indexes.js';
import { sanitizeObject, validateFilePath } from '../utils/index.js';
import { BatchTransaction } from './TransactionManager.js';
import { GraphEventEmitter } from './GraphEventEmitter.js';

/**
 * GraphStorage manages persistence of the knowledge graph to disk.
 *
 * Uses JSONL (JSON Lines) format where each line is a separate JSON object
 * representing either an entity or a relation.
 *
 * OPTIMIZED: Implements in-memory caching to avoid repeated disk reads.
 * Cache is invalidated on every write operation to ensure consistency.
 *
 * @example
 * ```typescript
 * const storage = new GraphStorage('/path/to/memory.jsonl');
 * const graph = await storage.loadGraph();
 * graph.entities.push(newEntity);
 * await storage.saveGraph(graph);
 * ```
 */
export class GraphStorage implements IGraphStorage {
  /**
   * Mutex for thread-safe access to storage operations.
   * Prevents concurrent writes from corrupting the file or cache.
   */
  private mutex = new Mutex();

  /**
   * In-memory cache of the knowledge graph.
   * Null when cache is empty or invalidated.
   */
  private cache: KnowledgeGraph | null = null;

  /**
   * Number of pending append operations since last compaction.
   * Used to trigger automatic compaction when threshold is reached.
   */
  private pendingAppends: number = 0;

  /**
   * Dynamic threshold for automatic compaction.
   *
   * Returns the larger of 100 or 10% of the current entity count.
   * This scales with graph size to avoid too-frequent compaction on large graphs
   * while maintaining a reasonable minimum for small graphs.
   *
   * @returns Compaction threshold value
   */
  private get compactionThreshold(): number {
    return Math.max(100, Math.floor((this.cache?.entities.length ?? 0) * 0.1));
  }

  /**
   * O(1) entity lookup by name.
   */
  private nameIndex: NameIndex = new NameIndex();

  /**
   * O(1) entity lookup by type.
   */
  private typeIndex: TypeIndex = new TypeIndex();

  /**
   * Pre-computed lowercase strings for search optimization.
   */
  private lowercaseCache: LowercaseCache = new LowercaseCache();

  /**
   * O(1) relation lookup by entity name.
   */
  private relationIndex: RelationIndex = new RelationIndex();

  /**
   * O(1) observation word lookup by entity.
   * Maps words in observations to entity names.
   */
  private observationIndex: ObservationIndex = new ObservationIndex();

  /**
   * Phase 10 Sprint 2: Event emitter for graph change notifications.
   * Allows external systems to subscribe to graph changes.
   */
  private eventEmitter: GraphEventEmitter = new GraphEventEmitter();

  /**
   * Validated file path (after path traversal checks).
   */
  private memoryFilePath: string;

  /**
   * Create a new GraphStorage instance.
   *
   * @param memoryFilePath - Absolute path to the JSONL file
   * @throws {FileOperationError} If path traversal is detected
   */
  constructor(memoryFilePath: string) {
    // Security: Validate path to prevent path traversal attacks
    this.memoryFilePath = validateFilePath(memoryFilePath);
  }

  // ==================== Phase 10 Sprint 2: Event Emitter Access ====================

  /**
   * Get the event emitter for subscribing to graph changes.
   *
   * @returns GraphEventEmitter instance
   *
   * @example
   * ```typescript
   * const storage = new GraphStorage('/data/memory.jsonl');
   *
   * // Subscribe to entity creation events
   * storage.events.on('entity:created', (event) => {
   *   console.log(`Entity ${event.entity.name} created`);
   * });
   *
   * // Subscribe to all events
   * storage.events.onAny((event) => {
   *   console.log(`Graph event: ${event.type}`);
   * });
   * ```
   */
  get events(): GraphEventEmitter {
    return this.eventEmitter;
  }

  // ==================== Durable File Operations ====================

  /**
   * Write content to file with fsync for durability.
   *
   * @param content - Content to write
   */
  private async durableWriteFile(content: string): Promise<void> {
    // Atomic write: write to temp file, fsync, then rename over target
    const tmpPath = `${this.memoryFilePath}.tmp.${process.pid}`;
    const fd = await fs.open(tmpPath, 'w');
    try {
      await fd.write(content);
      await fd.sync();
    } finally {
      await fd.close();
    }
    try {
      await fs.rename(tmpPath, this.memoryFilePath);
    } catch {
      // Fallback for Windows where rename can fail (EPERM) due to file locking
      const fallbackFd = await fs.open(this.memoryFilePath, 'w');
      try {
        await fallbackFd.write(content);
        await fallbackFd.sync();
      } finally {
        await fallbackFd.close();
      }
      // Clean up temp file
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    }
  }

  /**
   * Append content to file with fsync for durability.
   *
   * @param content - Content to append
   * @param prependNewline - Whether to prepend a newline
   */
  private async durableAppendFile(content: string, prependNewline: boolean): Promise<void> {
    const fd = await fs.open(this.memoryFilePath, 'a');
    try {
      const dataToWrite = prependNewline ? '\n' + content : content;
      await fd.write(dataToWrite);
      await fd.sync();
    } finally {
      await fd.close();
    }
  }

  /**
   * Load the knowledge graph from disk (read-only access).
   *
   * OPTIMIZED: Returns cached reference directly without copying.
   * This is O(1) regardless of graph size. For mutation operations,
   * use getGraphForMutation() instead.
   *
   * @returns Promise resolving to read-only knowledge graph reference
   * @throws Error if file exists but cannot be read or parsed
   */
  async loadGraph(): Promise<ReadonlyKnowledgeGraph> {
    // Return cached graph directly (no copying - O(1))
    if (this.cache !== null) {
      return this.cache;
    }

    // Cache miss - load from disk
    await this.loadFromDisk();
    return this.cache!;
  }

  /**
   * Get a mutable copy of the graph for write operations.
   *
   * Creates deep copies of entity and relation arrays to allow
   * safe mutation without affecting the cached data.
   *
   * @returns Promise resolving to mutable knowledge graph copy
   */
  async getGraphForMutation(): Promise<KnowledgeGraph> {
    await this.ensureLoaded();
    return {
      entities: this.cache!.entities.map(e => ({
        ...e,
        observations: [...e.observations],
        tags: e.tags ? [...e.tags] : undefined,
      })),
      relations: this.cache!.relations.map(r => ({ ...r })),
    };
  }

  /**
   * Ensure the cache is loaded from disk.
   *
   * @returns Promise resolving when cache is populated
   */
  async ensureLoaded(): Promise<void> {
    if (this.cache === null) {
      await this.loadFromDisk();
    }
  }

  /**
   * Internal method to load graph from disk into cache.
   */
  private async loadFromDisk(): Promise<void> {
    try {
      const data = await fs.readFile(this.memoryFilePath, 'utf-8');
      const lines = data.split('\n').filter((line: string) => line.trim() !== '');

      // Use Maps to deduplicate - later entries override earlier ones
      // This supports append-only updates where new versions are appended
      const entityMap = new Map<string, Entity>();
      const relationMap = new Map<string, Relation>();

      for (const line of lines) {
        const item = JSON.parse(line);

        if (item.type === 'entity') {
          // Add createdAt if missing for backward compatibility
          if (!item.createdAt) item.createdAt = new Date().toISOString();
          // Add lastModified if missing for backward compatibility
          if (!item.lastModified) item.lastModified = item.createdAt;

          // Use name as key - later entries override earlier ones
          entityMap.set(item.name, item as Entity);
        }

        if (item.type === 'relation') {
          // Add createdAt if missing for backward compatibility
          if (!item.createdAt) item.createdAt = new Date().toISOString();
          // Add lastModified if missing for backward compatibility
          if (!item.lastModified) item.lastModified = item.createdAt;

          // Use composite key for relations
          const key = `${item.from}:${item.to}:${item.relationType}`;
          relationMap.set(key, item as Relation);
        }
      }

      // Convert maps to arrays
      const graph: KnowledgeGraph = {
        entities: Array.from(entityMap.values()),
        relations: Array.from(relationMap.values()),
      };

      // Populate cache
      this.cache = graph;

      // Build indexes from loaded data
      this.buildEntityIndexes(graph.entities);
      this.buildRelationIndex(graph.relations);

      // Phase 10 Sprint 2: Emit graph:loaded event
      this.eventEmitter.emitGraphLoaded(graph.entities.length, graph.relations.length);
    } catch (error) {
      // File doesn't exist - create empty graph
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        this.cache = { entities: [], relations: [] };
        this.clearIndexes();

        // Phase 10 Sprint 2: Emit graph:loaded event for empty graph
        this.eventEmitter.emitGraphLoaded(0, 0);
        return;
      }
      throw error;
    }
  }

  /**
   * Build all entity indexes from entity array.
   */
  private buildEntityIndexes(entities: Entity[]): void {
    this.nameIndex.build(entities);
    this.typeIndex.build(entities);
    this.lowercaseCache.build(entities);

    // Build observation index
    this.observationIndex.clear();
    for (const entity of entities) {
      this.observationIndex.add(entity.name, entity.observations);
    }
  }

  /**
   * Build relation index from relation array.
   */
  private buildRelationIndex(relations: Relation[]): void {
    this.relationIndex.build(relations);
  }

  /**
   * Clear all indexes.
   */
  private clearIndexes(): void {
    this.nameIndex.clear();
    this.typeIndex.clear();
    this.lowercaseCache.clear();
    this.relationIndex.clear();
    this.observationIndex.clear();
  }

  /**
   * Save the knowledge graph to disk.
   *
   * OPTIMIZED: Updates cache directly after write to avoid re-reading.
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   *
   * Writes the graph to JSONL format, with one JSON object per line.
   *
   * @param graph - The knowledge graph to save
   * @returns Promise resolving when save is complete
   * @throws Error if file cannot be written
   */
  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.saveGraphInternal(graph);
    });
  }

  /**
   * Append a single entity to the file (O(1) write operation).
   *
   * OPTIMIZED: Uses file append instead of full rewrite.
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   * Updates cache in-place and triggers compaction when threshold is reached.
   *
   * @param entity - The entity to append
   * @returns Promise resolving when append is complete
   */
  async appendEntity(entity: Entity): Promise<void> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      const entityData: Record<string, unknown> = {
        type: 'entity',
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations,
        createdAt: entity.createdAt,
        lastModified: entity.lastModified,
      };

      // Only include optional fields if they exist
      if (entity.tags !== undefined) entityData.tags = entity.tags;
      if (entity.importance !== undefined) entityData.importance = entity.importance;
      if (entity.parentId !== undefined) entityData.parentId = entity.parentId;

      const line = JSON.stringify(entityData);

      // Append to file with fsync for durability (write FIRST, then update cache)
      try {
        const stat = await fs.stat(this.memoryFilePath);
        await this.durableAppendFile(line, stat.size > 0);
      } catch (error) {
        // File doesn't exist - create it
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          await this.durableWriteFile(line);
        } else {
          throw error;
        }
      }

      // Update cache in-place (after successful file write)
      this.cache!.entities.push(entity);

      // Update indexes
      this.nameIndex.add(entity);
      this.typeIndex.add(entity);
      this.lowercaseCache.set(entity);
      this.observationIndex.add(entity.name, entity.observations);

      this.pendingAppends++;

      // Clear search caches
      clearAllSearchCaches();

      // Phase 10 Sprint 2: Emit entity:created event
      this.eventEmitter.emitEntityCreated(entity);

      // Trigger compaction if threshold reached
      if (this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }
    });
  }

  /**
   * Append a single relation to the file (O(1) write operation).
   *
   * OPTIMIZED: Uses file append instead of full rewrite.
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   * Updates cache in-place and triggers compaction when threshold is reached.
   *
   * @param relation - The relation to append
   * @returns Promise resolving when append is complete
   */
  async appendRelation(relation: Relation): Promise<void> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      // Serialize relation with all fields (Phase 1 Sprint 5: Metadata support)
      const serialized: Record<string, unknown> = {
        type: 'relation',
        from: relation.from,
        to: relation.to,
        relationType: relation.relationType,
        createdAt: relation.createdAt,
        lastModified: relation.lastModified,
      };
      // Only include optional metadata fields if present
      if (relation.weight !== undefined) serialized.weight = relation.weight;
      if (relation.confidence !== undefined) serialized.confidence = relation.confidence;
      if (relation.properties) serialized.properties = relation.properties;
      if (relation.metadata) serialized.metadata = relation.metadata;
      const line = JSON.stringify(serialized);

      // Append to file with fsync for durability (write FIRST, then update cache)
      try {
        const stat = await fs.stat(this.memoryFilePath);
        await this.durableAppendFile(line, stat.size > 0);
      } catch (error) {
        // File doesn't exist - create it
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          await this.durableWriteFile(line);
        } else {
          throw error;
        }
      }

      // Update cache in-place (after successful file write)
      this.cache!.relations.push(relation);

      // Update relation index
      this.relationIndex.add(relation);

      this.pendingAppends++;

      // Clear search caches
      clearAllSearchCaches();

      // Phase 10 Sprint 2: Emit relation:created event
      this.eventEmitter.emitRelationCreated(relation);

      // Trigger compaction if threshold reached
      if (this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }
    });
  }

  /**
   * Compact the file by rewriting it with only current cache contents.
   *
   * THREAD-SAFE: Uses mutex to prevent concurrent operations.
   * Removes duplicate entries and cleans up the file.
   * Resets pending appends counter.
   *
   * @returns Promise resolving when compaction is complete
   */
  async compact(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.compactInternal();
    });
  }

  /**
   * Internal compact implementation (must be called within mutex).
   *
   * @returns Promise resolving when compaction is complete
   */
  private async compactInternal(): Promise<void> {
    if (this.cache === null) {
      return;
    }

    // Rewrite file with current cache (removes duplicates/updates)
    await this.saveGraphInternal(this.cache);
    this.pendingAppends = 0;
  }

  /**
   * Internal saveGraph implementation (must be called within mutex).
   *
   * @param graph - The knowledge graph to save
   * @returns Promise resolving when save is complete
   */
  private async saveGraphInternal(graph: KnowledgeGraph): Promise<void> {
    const lines = [
      ...graph.entities.map(e => {
        const entityData: Record<string, unknown> = {
          type: 'entity',
          name: e.name,
          entityType: e.entityType,
          observations: e.observations,
          createdAt: e.createdAt,
          lastModified: e.lastModified,
        };

        // Only include optional fields if they exist
        if (e.tags !== undefined) entityData.tags = e.tags;
        if (e.importance !== undefined) entityData.importance = e.importance;
        if (e.parentId !== undefined) entityData.parentId = e.parentId;

        return JSON.stringify(entityData);
      }),
      // Serialize relations with metadata (Phase 1 Sprint 5)
      ...graph.relations.map(r => {
        const relationData: Record<string, unknown> = {
          type: 'relation',
          from: r.from,
          to: r.to,
          relationType: r.relationType,
          createdAt: r.createdAt,
          lastModified: r.lastModified,
        };
        // Only include optional metadata fields if they exist
        if (r.weight !== undefined) relationData.weight = r.weight;
        if (r.confidence !== undefined) relationData.confidence = r.confidence;
        if (r.properties) relationData.properties = r.properties;
        if (r.metadata) relationData.metadata = r.metadata;
        return JSON.stringify(relationData);
      }),
    ];

    await this.durableWriteFile(lines.join('\n'));

    // Update cache directly with the saved graph (avoid re-reading from disk)
    this.cache = graph;

    // Rebuild indexes with new graph data
    this.buildEntityIndexes(graph.entities);
    this.buildRelationIndex(graph.relations);

    // Reset pending appends since file is now clean
    this.pendingAppends = 0;

    // Clear all search caches since graph data has changed
    clearAllSearchCaches();

    // Phase 10 Sprint 2: Emit graph:saved event
    this.eventEmitter.emitGraphSaved(graph.entities.length, graph.relations.length);
  }

  /**
   * Get the current pending appends count.
   *
   * Useful for testing compaction behavior.
   *
   * @returns Number of pending appends since last compaction
   */
  getPendingAppends(): number {
    return this.pendingAppends;
  }

  /**
   * Update an entity in-place in the cache and append to file.
   *
   * OPTIMIZED: Modifies cache directly and appends updated version to file.
   * THREAD-SAFE: Uses mutex to prevent concurrent write operations.
   * Does not rewrite the entire file - compaction handles deduplication later.
   *
   * @param entityName - Name of the entity to update
   * @param updates - Partial entity updates to apply
   * @returns Promise resolving to true if entity was found and updated, false otherwise
   */
  async updateEntity(entityName: string, updates: Partial<Entity>): Promise<boolean> {
    await this.ensureLoaded();

    return this.mutex.runExclusive(async () => {
      const entityIndex = this.cache!.entities.findIndex(e => e.name === entityName);
      if (entityIndex === -1) {
        return false;
      }

      const entity = this.cache!.entities[entityIndex];
      const oldType = entity.entityType;
      const timestamp = new Date().toISOString();

      // Phase 10 Sprint 2: Capture previous values for event
      const previousValues: Partial<Entity> = {};
      for (const key of Object.keys(updates) as Array<keyof Entity>) {
        if (key in entity) {
          previousValues[key] = entity[key] as any;
        }
      }

      // Build the updated entity data for file write BEFORE modifying cache
      // This ensures cache consistency if file write fails
      const updatedEntity = {
        ...entity,
        ...updates,
        lastModified: timestamp,
      };

      const entityData: Record<string, unknown> = {
        type: 'entity',
        name: updatedEntity.name,
        entityType: updatedEntity.entityType,
        observations: updatedEntity.observations,
        createdAt: updatedEntity.createdAt,
        lastModified: updatedEntity.lastModified,
      };

      if (updatedEntity.tags !== undefined) entityData.tags = updatedEntity.tags;
      if (updatedEntity.importance !== undefined) entityData.importance = updatedEntity.importance;
      if (updatedEntity.parentId !== undefined) entityData.parentId = updatedEntity.parentId;

      const line = JSON.stringify(entityData);

      // Write to file FIRST with durability - if this fails, cache remains consistent
      try {
        const stat = await fs.stat(this.memoryFilePath);
        await this.durableAppendFile(line, stat.size > 0);
      } catch (error) {
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          await this.durableWriteFile(line);
        } else {
          throw error;
        }
      }

      // File write succeeded - NOW update cache in-place (sanitized to prevent prototype pollution)
      Object.assign(entity, sanitizeObject(updates as Record<string, unknown>));
      entity.lastModified = timestamp;

      // Update indexes
      this.nameIndex.add(entity); // Update reference
      if (updates.entityType && updates.entityType !== oldType) {
        this.typeIndex.updateType(entityName, oldType, updates.entityType);
      }
      this.lowercaseCache.set(entity); // Recompute lowercase
      if (updates.observations) {
        this.observationIndex.remove(entityName); // Remove old observations
        this.observationIndex.add(entityName, entity.observations); // Add new observations
      }

      this.pendingAppends++;

      // Clear search caches
      clearAllSearchCaches();

      // Phase 10 Sprint 2: Emit entity:updated event
      this.eventEmitter.emitEntityUpdated(entityName, updates, previousValues);

      // Trigger compaction if threshold reached
      if (this.pendingAppends >= this.compactionThreshold) {
        await this.compactInternal();
      }

      return true;
    });
  }

  /**
   * Manually clear the cache.
   *
   * Useful for testing or when external processes modify the file.
   *
   * @returns void
   */
  clearCache(): void {
    this.cache = null;
    this.clearIndexes();
  }

  /**
   * Get the file path being used for storage.
   *
   * @returns The memory file path
   */
  getFilePath(): string {
    return this.memoryFilePath;
  }

  // ==================== Index Accessors ====================

  /**
   * Get an entity by name in O(1) time.
   *
   * OPTIMIZED: Uses NameIndex for constant-time lookup.
   *
   * @param name - Entity name to look up
   * @returns Entity if found, undefined otherwise
   */
  getEntityByName(name: string): Entity | undefined {
    return this.nameIndex.get(name);
  }

  /**
   * Check if an entity exists by name in O(1) time.
   *
   * @param name - Entity name to check
   * @returns True if entity exists
   */
  hasEntity(name: string): boolean {
    return this.nameIndex.has(name);
  }

  /**
   * Get all entities of a given type in O(1) time.
   *
   * OPTIMIZED: Uses TypeIndex for constant-time lookup of entity names,
   * then uses NameIndex for O(1) entity retrieval.
   *
   * @param entityType - Entity type to filter by (case-insensitive)
   * @returns Array of entities with the given type
   */
  getEntitiesByType(entityType: string): Entity[] {
    const names = this.typeIndex.getNames(entityType);
    const entities: Entity[] = [];
    for (const name of names) {
      const entity = this.nameIndex.get(name);
      if (entity) {
        entities.push(entity);
      }
    }
    return entities;
  }

  /**
   * Get pre-computed lowercase data for an entity.
   *
   * OPTIMIZED: Avoids repeated toLowerCase() calls during search.
   *
   * @param entityName - Entity name to get lowercase data for
   * @returns LowercaseData if entity exists, undefined otherwise
   */
  getLowercased(entityName: string): LowercaseData | undefined {
    return this.lowercaseCache.get(entityName);
  }

  /**
   * Get all unique entity types in the graph.
   *
   * @returns Array of unique entity types (lowercase)
   */
  getEntityTypes(): string[] {
    return this.typeIndex.getTypes();
  }

  // ==================== Relation Index Accessors ====================

  /**
   * Get all relations where the entity is the source (outgoing relations) in O(1) time.
   *
   * OPTIMIZED: Uses RelationIndex for constant-time lookup.
   *
   * @param entityName - Entity name to look up outgoing relations for
   * @returns Array of relations where entity is the source
   */
  getRelationsFrom(entityName: string): Relation[] {
    return this.relationIndex.getRelationsFrom(entityName);
  }

  /**
   * Get all relations where the entity is the target (incoming relations) in O(1) time.
   *
   * OPTIMIZED: Uses RelationIndex for constant-time lookup.
   *
   * @param entityName - Entity name to look up incoming relations for
   * @returns Array of relations where entity is the target
   */
  getRelationsTo(entityName: string): Relation[] {
    return this.relationIndex.getRelationsTo(entityName);
  }

  /**
   * Get all relations involving the entity (both incoming and outgoing) in O(1) time.
   *
   * OPTIMIZED: Uses RelationIndex for constant-time lookup.
   *
   * @param entityName - Entity name to look up all relations for
   * @returns Array of all relations involving the entity
   */
  getRelationsFor(entityName: string): Relation[] {
    return this.relationIndex.getRelationsFor(entityName);
  }

  /**
   * Check if an entity has any relations.
   *
   * @param entityName - Entity name to check
   * @returns True if entity has any relations
   */
  hasRelations(entityName: string): boolean {
    return this.relationIndex.hasRelations(entityName);
  }

  // ==================== Observation Index Accessors ====================

  /**
   * Get entities that have observations containing the given word.
   * Uses the observation index for O(1) lookup.
   *
   * OPTIMIZED: Uses ObservationIndex for constant-time lookup instead of
   * linear scan through all entities and their observations.
   *
   * @param word - Word to search for in observations
   * @returns Set of entity names
   */
  getEntitiesByObservationWord(word: string): Set<string> {
    return this.observationIndex.getEntitiesWithWord(word);
  }

  /**
   * Get entities that have observations containing ANY of the given words (union).
   * Uses the observation index for O(1) lookup per word.
   *
   * OPTIMIZED: Uses ObservationIndex for constant-time lookups.
   *
   * @param words - Array of words to search for
   * @returns Set of entity names containing any of the words
   */
  getEntitiesByAnyObservationWord(words: string[]): Set<string> {
    return this.observationIndex.getEntitiesWithAnyWord(words);
  }

  /**
   * Get entities that have observations containing ALL of the given words (intersection).
   * Uses the observation index for O(1) lookup per word.
   *
   * OPTIMIZED: Uses ObservationIndex for constant-time lookups and set intersection.
   *
   * @param words - Array of words that must all be present
   * @returns Set of entity names containing all of the words
   */
  getEntitiesByAllObservationWords(words: string[]): Set<string> {
    return this.observationIndex.getEntitiesWithAllWords(words);
  }

  /**
   * Get statistics about the observation index.
   *
   * @returns Object with wordCount and entityCount
   */
  getObservationIndexStats(): { wordCount: number; entityCount: number } {
    return this.observationIndex.getStats();
  }

  // ==================== Phase 10 Sprint 1: Transaction Factory ====================

  /**
   * Create a new batch transaction for atomic operations.
   *
   * Returns a BatchTransaction instance that can be used to queue multiple
   * operations and execute them atomically with a single save operation.
   *
   * @returns A new BatchTransaction instance
   *
   * @example
   * ```typescript
   * const storage = new GraphStorage('/data/memory.jsonl');
   *
   * // Create and execute a batch transaction
   * const result = await storage.transaction()
   *   .createEntity({ name: 'Alice', entityType: 'person', observations: ['Developer'] })
   *   .createEntity({ name: 'Bob', entityType: 'person', observations: ['Designer'] })
   *   .createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' })
   *   .execute();
   *
   * console.log(`Batch completed: ${result.operationsExecuted} operations`);
   * ```
   */
  transaction(): BatchTransaction {
    return new BatchTransaction(this);
  }
}
