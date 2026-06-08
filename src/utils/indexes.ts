/**
 * O(1) lookup indexes for entities, types, relations, and observations.
 * @module utils/indexes
 */

import type { Entity, LowercaseData, Relation } from '../types/index.js';

/** O(1) entity lookup by name. */
export class NameIndex {
  private index: Map<string, Entity> = new Map();

  build(entities: Entity[]): void {
    this.index.clear();
    for (const entity of entities) {
      this.index.set(entity.name, entity);
    }
  }

  get(name: string): Entity | undefined {
    return this.index.get(name);
  }

  add(entity: Entity): void {
    this.index.set(entity.name, entity);
  }

  remove(name: string): void {
    this.index.delete(name);
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  get size(): number {
    return this.index.size;
  }

  clear(): void {
    this.index.clear();
  }
}

/** O(1) lookup of entities by type (case-insensitive). */
export class TypeIndex {
  private index: Map<string, Set<string>> = new Map();
  build(entities: Entity[]): void {
    this.index.clear();
    for (const entity of entities) {
      this.addToIndex(entity.name, entity.entityType);
    }
  }

  /** Get all entity names of a given type. */
  getNames(entityType: string): Set<string> {
    const typeLower = entityType.toLowerCase();
    return this.index.get(typeLower) ?? new Set();
  }

  add(entity: Entity): void {
    this.addToIndex(entity.name, entity.entityType);
  }
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

  /** Update an entity's type (removes from old, adds to new). */
  updateType(entityName: string, oldType: string, newType: string): void {
    this.remove(entityName, oldType);
    this.addToIndex(entityName, newType);
  }

  /** Get all unique types. */
  getTypes(): string[] {
    return Array.from(this.index.keys());
  }

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

/** Pre-computes lowercase versions of all searchable fields for O(1) lookup. */
export class LowercaseCache {
  private cache: Map<string, LowercaseData> = new Map();

  build(entities: Entity[]): void {
    this.cache.clear();
    for (const entity of entities) {
      this.cache.set(entity.name, this.computeLowercase(entity));
    }
  }

  get(entityName: string): LowercaseData | undefined {
    return this.cache.get(entityName);
  }

  set(entity: Entity): void {
    this.cache.set(entity.name, this.computeLowercase(entity));
  }

  remove(entityName: string): void {
    this.cache.delete(entityName);
  }

  has(entityName: string): boolean {
    return this.cache.has(entityName);
  }

  clear(): void {
    this.cache.clear();
  }

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

/** O(1) lookup of relations by entity name (fromIndex + toIndex). */
export class RelationIndex {
  private fromIndex: Map<string, Set<Relation>> = new Map();
  private toIndex: Map<string, Set<Relation>> = new Map();

  build(relations: Relation[]): void {
    this.fromIndex.clear();
    this.toIndex.clear();
    for (const relation of relations) {
      this.addToIndexes(relation);
    }
  }

  getRelationsFrom(entityName: string): Relation[] {
    const relations = this.fromIndex.get(entityName);
    return relations ? Array.from(relations) : [];
  }

  getRelationsTo(entityName: string): Relation[] {
    const relations = this.toIndex.get(entityName);
    return relations ? Array.from(relations) : [];
  }

  getRelationsFor(entityName: string): Relation[] {
    const fromRelations = this.fromIndex.get(entityName);
    const toRelations = this.toIndex.get(entityName);

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

  add(relation: Relation): void {
    this.addToIndexes(relation);
  }

  remove(relation: Relation): void {
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

  hasRelations(entityName: string): boolean {
    return this.fromIndex.has(entityName) || this.toIndex.has(entityName);
  }

  getOutgoingCount(entityName: string): number {
    return this.fromIndex.get(entityName)?.size ?? 0;
  }

  getIncomingCount(entityName: string): number {
    return this.toIndex.get(entityName)?.size ?? 0;
  }

  get size(): number {
    let count = 0;
    for (const relations of this.fromIndex.values()) {
      count += relations.size;
    }
    return count;
  }

  clear(): void {
    this.fromIndex.clear();
    this.toIndex.clear();
  }

  private addToIndexes(relation: Relation): void {
    let fromSet = this.fromIndex.get(relation.from);
    if (!fromSet) {
      fromSet = new Set();
      this.fromIndex.set(relation.from, fromSet);
    }
    fromSet.add(relation);

    let toSet = this.toIndex.get(relation.to);
    if (!toSet) {
      toSet = new Set();
      this.toIndex.set(relation.to, toSet);
    }
    toSet.add(relation);
  }
}

/** Inverted index mapping observation keywords to entity names. */
export class ObservationIndex {
  private index: Map<string, Set<string>> = new Map();
  private entityObservations: Map<string, Set<string>> = new Map();

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

  getEntitiesWithWord(word: string): Set<string> {
    return this.index.get(word.toLowerCase()) ?? new Set();
  }

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

  getEntitiesWithAllWords(words: string[]): Set<string> {
    if (words.length === 0) return new Set();

    let result = new Set(this.getEntitiesWithWord(words[0]));

    for (let i = 1; i < words.length && result.size > 0; i++) {
      const wordEntities = this.getEntitiesWithWord(words[i]);
      result = new Set([...result].filter(e => wordEntities.has(e)));
    }

    return result;
  }

  clear(): void {
    this.index.clear();
    this.entityObservations.clear();
  }

  getStats(): { wordCount: number; entityCount: number } {
    return {
      wordCount: this.index.size,
      entityCount: this.entityObservations.size,
    };
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 2);
  }
}
