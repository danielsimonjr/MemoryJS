/**
 * Search Indexes
 *
 * Provides O(1) lookup structures to avoid repeated linear scans.
 * - NameIndex: O(1) entity lookup by name
 * - TypeIndex: O(1) entities by type
 * - LowercaseCache: Pre-computed lowercase strings to avoid repeated toLowerCase()
 * - RelationIndex: O(1) relation lookup by entity name (from/to)
 * - ObservationIndex: O(1) observation word lookup by entity
 *
 * @module utils/indexes
 */

import type { Entity, LowercaseData, Relation } from '../types/index.js';

/**
 * NameIndex provides O(1) entity lookup by name.
 *
 * Uses a Map internally for constant-time access.
 */
export class NameIndex {
  private index: Map<string, Entity> = new Map();

  /**
   * Build the index from an array of entities.
   * Clears any existing index data first.
   */
  build(entities: Entity[]): void {
    this.index.clear();
    for (const entity of entities) {
      this.index.set(entity.name, entity);
    }
  }

  /**
   * Get an entity by name in O(1) time.
   */
  get(name: string): Entity | undefined {
    return this.index.get(name);
  }

  /**
   * Add a single entity to the index.
   */
  add(entity: Entity): void {
    this.index.set(entity.name, entity);
  }

  /**
   * Remove an entity from the index by name.
   */
  remove(name: string): void {
    this.index.delete(name);
  }

  /**
   * Check if an entity exists in the index.
   */
  has(name: string): boolean {
    return this.index.has(name);
  }

  /**
   * Get the number of entities in the index.
   */
  get size(): number {
    return this.index.size;
  }

  /**
   * Clear all entries from the index.
   */
  clear(): void {
    this.index.clear();
  }
}

/**
 * TypeIndex provides O(1) lookup of entities by type.
 *
 * Uses a Map<type, Set<entityName>> structure for efficient type queries.
 * Type comparisons are case-insensitive.
 */
export class TypeIndex {
  private index: Map<string, Set<string>> = new Map();

  /**
   * Build the index from an array of entities.
   * Clears any existing index data first.
   */
  build(entities: Entity[]): void {
    this.index.clear();
    for (const entity of entities) {
      this.addToIndex(entity.name, entity.entityType);
    }
  }

  /**
   * Get all entity names of a given type in O(1) time.
   * Type comparison is case-insensitive.
   */
  getNames(entityType: string): Set<string> {
    const typeLower = entityType.toLowerCase();
    return this.index.get(typeLower) ?? new Set();
  }

  /**
   * Add an entity to the type index.
   */
  add(entity: Entity): void {
    this.addToIndex(entity.name, entity.entityType);
  }

  /**
   * Remove an entity from the type index.
   * Requires the entity type to know which bucket to remove from.
   */
  remove(entityName: string, entityType: string): void {
    const typeLower = entityType.toLowerCase();
    const names = this.index.get(typeLower);
    if (names) {
      names.delete(entityName);
      if (names.size === 0) {
        this.index.delete(typeLower);
      }
    }
  }

  /**
   * Update an entity's type in the index.
   * Removes from old type and adds to new type.
   */
  updateType(entityName: string, oldType: string, newType: string): void {
    this.remove(entityName, oldType);
    this.addToIndex(entityName, newType);
  }

  /**
   * Get all unique types in the index.
   */
  getTypes(): string[] {
    return Array.from(this.index.keys());
  }

  /**
   * Clear all entries from the index.
   */
  clear(): void {
    this.index.clear();
  }

  private addToIndex(entityName: string, entityType: string): void {
    const typeLower = entityType.toLowerCase();
    let names = this.index.get(typeLower);
    if (!names) {
      names = new Set();
      this.index.set(typeLower, names);
    }
    names.add(entityName);
  }
}

/**
 * LowercaseCache pre-computes lowercase versions of all searchable fields.
 *
 * Eliminates the need for repeated toLowerCase() calls during search,
 * which is expensive with many entities and observations.
 */
export class LowercaseCache {
  private cache: Map<string, LowercaseData> = new Map();

  /**
   * Build the cache from an array of entities.
   * Clears any existing cache data first.
   */
  build(entities: Entity[]): void {
    this.cache.clear();
    for (const entity of entities) {
      this.cache.set(entity.name, this.computeLowercase(entity));
    }
  }

  /**
   * Get pre-computed lowercase data for an entity.
   */
  get(entityName: string): LowercaseData | undefined {
    return this.cache.get(entityName);
  }

  /**
   * Add or update an entity in the cache.
   */
  set(entity: Entity): void {
    this.cache.set(entity.name, this.computeLowercase(entity));
  }

  /**
   * Remove an entity from the cache.
   */
  remove(entityName: string): void {
    this.cache.delete(entityName);
  }

  /**
   * Check if an entity exists in the cache.
   */
  has(entityName: string): boolean {
    return this.cache.has(entityName);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of entries in the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  private computeLowercase(entity: Entity): LowercaseData {
    return {
      name: entity.name.toLowerCase(),
      entityType: entity.entityType.toLowerCase(),
      observations: entity.observations.map(o => o.toLowerCase()),
      tags: entity.tags?.map(t => t.toLowerCase()) ?? [],
    };
  }
}

/**
 * RelationIndex provides O(1) lookup of relations by entity name.
 *
 * Maintains two separate indexes for efficient directional queries:
 * - fromIndex: Map from source entity name to its outgoing relations
 * - toIndex: Map from target entity name to its incoming relations
 *
 * This eliminates O(n) array scans when looking up relations for an entity.
 */
export class RelationIndex {
  /** Index of relations by source (from) entity */
  private fromIndex: Map<string, Set<Relation>> = new Map();

  /** Index of relations by target (to) entity */
  private toIndex: Map<string, Set<Relation>> = new Map();

  /**
   * Build the index from an array of relations.
   * Clears any existing index data first.
   */
  build(relations: Relation[]): void {
    this.fromIndex.clear();
    this.toIndex.clear();
    for (const relation of relations) {
      this.addToIndexes(relation);
    }
  }

  /**
   * Get all relations where the entity is the source (outgoing relations).
   * Returns empty array if no relations found.
   */
  getRelationsFrom(entityName: string): Relation[] {
    const relations = this.fromIndex.get(entityName);
    return relations ? Array.from(relations) : [];
  }

  /**
   * Get all relations where the entity is the target (incoming relations).
   * Returns empty array if no relations found.
   */
  getRelationsTo(entityName: string): Relation[] {
    const relations = this.toIndex.get(entityName);
    return relations ? Array.from(relations) : [];
  }

  /**
   * Get all relations involving the entity (both incoming and outgoing).
   * Returns empty array if no relations found.
   */
  getRelationsFor(entityName: string): Relation[] {
    const fromRelations = this.fromIndex.get(entityName);
    const toRelations = this.toIndex.get(entityName);

    // Combine sets to handle self-referential relations correctly
    const combined = new Set<Relation>();
    if (fromRelations) {
      for (const r of fromRelations) {
        combined.add(r);
      }
    }
    if (toRelations) {
      for (const r of toRelations) {
        combined.add(r);
      }
    }
    return Array.from(combined);
  }

  /**
   * Add a single relation to the index.
   */
  add(relation: Relation): void {
    this.addToIndexes(relation);
  }

  /**
   * Remove a relation from the index.
   * Matches by from, to, and relationType.
   */
  remove(relation: Relation): void {
    // Remove from fromIndex
    const fromRelations = this.fromIndex.get(relation.from);
    if (fromRelations) {
      for (const r of fromRelations) {
        if (r.from === relation.from && r.to === relation.to && r.relationType === relation.relationType) {
          fromRelations.delete(r);
          break;
        }
      }
      if (fromRelations.size === 0) {
        this.fromIndex.delete(relation.from);
      }
    }

    // Remove from toIndex
    const toRelations = this.toIndex.get(relation.to);
    if (toRelations) {
      for (const r of toRelations) {
        if (r.from === relation.from && r.to === relation.to && r.relationType === relation.relationType) {
          toRelations.delete(r);
          break;
        }
      }
      if (toRelations.size === 0) {
        this.toIndex.delete(relation.to);
      }
    }
  }

  /**
   * Remove all relations involving a specific entity.
   * Returns the relations that were removed.
   */
  removeAllForEntity(entityName: string): Relation[] {
    const removed: Relation[] = [];

    // Remove outgoing relations
    const fromRelations = this.fromIndex.get(entityName);
    if (fromRelations) {
      for (const r of fromRelations) {
        removed.push(r);
        // Also remove from toIndex
        const toRels = this.toIndex.get(r.to);
        if (toRels) {
          toRels.delete(r);
          if (toRels.size === 0) {
            this.toIndex.delete(r.to);
          }
        }
      }
      this.fromIndex.delete(entityName);
    }

    // Remove incoming relations
    const toRelations = this.toIndex.get(entityName);
    if (toRelations) {
      for (const r of toRelations) {
        // Skip self-referential relations (already handled above)
        if (r.from === entityName) continue;
        removed.push(r);
        // Also remove from fromIndex
        const fromRels = this.fromIndex.get(r.from);
        if (fromRels) {
          fromRels.delete(r);
          if (fromRels.size === 0) {
            this.fromIndex.delete(r.from);
          }
        }
      }
      this.toIndex.delete(entityName);
    }

    return removed;
  }

  /**
   * Check if any relations exist for an entity.
   */
  hasRelations(entityName: string): boolean {
    return this.fromIndex.has(entityName) || this.toIndex.has(entityName);
  }

  /**
   * Get count of outgoing relations for an entity.
   */
  getOutgoingCount(entityName: string): number {
    return this.fromIndex.get(entityName)?.size ?? 0;
  }

  /**
   * Get count of incoming relations for an entity.
   */
  getIncomingCount(entityName: string): number {
    return this.toIndex.get(entityName)?.size ?? 0;
  }

  /**
   * Get total count of unique relations in the index.
   */
  get size(): number {
    // Count all relations in fromIndex (each relation appears exactly once there)
    let count = 0;
    for (const relations of this.fromIndex.values()) {
      count += relations.size;
    }
    return count;
  }

  /**
   * Clear all entries from the index.
   */
  clear(): void {
    this.fromIndex.clear();
    this.toIndex.clear();
  }

  private addToIndexes(relation: Relation): void {
    // Add to fromIndex
    let fromSet = this.fromIndex.get(relation.from);
    if (!fromSet) {
      fromSet = new Set();
      this.fromIndex.set(relation.from, fromSet);
    }
    fromSet.add(relation);

    // Add to toIndex
    let toSet = this.toIndex.get(relation.to);
    if (!toSet) {
      toSet = new Set();
      this.toIndex.set(relation.to, toSet);
    }
    toSet.add(relation);
  }
}

/**
 * Inverted index mapping observation keywords to entity names.
 * Enables O(1) lookup for 'which entities mention word X?' queries.
 * Words are normalized to lowercase and split on whitespace/punctuation.
 */
export class ObservationIndex {
  private index: Map<string, Set<string>> = new Map();
  private entityObservations: Map<string, Set<string>> = new Map();

  /**
   * Add an entity's observations to the index.
   * Tokenizes observations into words and creates reverse mapping.
   *
   * @param entityName - Name of the entity
   * @param observations - Array of observation strings
   */
  add(entityName: string, observations: string[]): void {
    const entityWords = new Set<string>();

    for (const observation of observations) {
      const words = this.tokenize(observation);
      for (const word of words) {
        entityWords.add(word);
        if (!this.index.has(word)) {
          this.index.set(word, new Set());
        }
        this.index.get(word)!.add(entityName);
      }
    }

    this.entityObservations.set(entityName, entityWords);
  }

  /**
   * Remove an entity from the index.
   * Cleans up all word mappings for this entity.
   *
   * @param entityName - Name of the entity to remove
   */
  remove(entityName: string): void {
    const words = this.entityObservations.get(entityName);
    if (!words) return;

    for (const word of words) {
      const entities = this.index.get(word);
      if (entities) {
        entities.delete(entityName);
        if (entities.size === 0) {
          this.index.delete(word);
        }
      }
    }

    this.entityObservations.delete(entityName);
  }

  /**
   * Get all entities that have observations containing the given word.
   * Word matching is case-insensitive.
   *
   * @param word - Word to search for
   * @returns Set of entity names containing this word
   */
  getEntitiesWithWord(word: string): Set<string> {
    return this.index.get(word.toLowerCase()) ?? new Set();
  }

  /**
   * Get all entities that have observations containing ANY of the given words (union).
   *
   * @param words - Array of words to search for
   * @returns Set of entity names containing any of the words
   */
  getEntitiesWithAnyWord(words: string[]): Set<string> {
    const result = new Set<string>();
    for (const word of words) {
      const entities = this.getEntitiesWithWord(word);
      for (const entity of entities) {
        result.add(entity);
      }
    }
    return result;
  }

  /**
   * Get all entities that have observations containing ALL of the given words (intersection).
   *
   * @param words - Array of words that must all be present
   * @returns Set of entity names containing all of the words
   */
  getEntitiesWithAllWords(words: string[]): Set<string> {
    if (words.length === 0) return new Set();

    let result = new Set(this.getEntitiesWithWord(words[0]));

    for (let i = 1; i < words.length && result.size > 0; i++) {
      const wordEntities = this.getEntitiesWithWord(words[i]);
      result = new Set([...result].filter(e => wordEntities.has(e)));
    }

    return result;
  }

  /**
   * Clear all entries from the index.
   */
  clear(): void {
    this.index.clear();
    this.entityObservations.clear();
  }

  /**
   * Get statistics about the index.
   *
   * @returns Object with wordCount and entityCount
   */
  getStats(): { wordCount: number; entityCount: number } {
    return {
      wordCount: this.index.size,
      entityCount: this.entityObservations.size,
    };
  }

  /**
   * Tokenize text into searchable words.
   * Normalizes to lowercase, splits on non-alphanumeric characters,
   * and filters out words less than 2 characters.
   *
   * @param text - Text to tokenize
   * @returns Array of normalized words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 2);
  }
}
