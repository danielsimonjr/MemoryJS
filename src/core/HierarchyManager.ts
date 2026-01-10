/**
 * Hierarchy Manager
 *
 * Handles entity hierarchy operations (parent-child relationships).
 * Extracted from EntityManager (Phase 4: Consolidate God Objects).
 *
 * @module core/HierarchyManager
 */

import type { Entity, KnowledgeGraph, ReadonlyKnowledgeGraph } from '../types/index.js';
import type { GraphStorage } from './GraphStorage.js';
import { EntityNotFoundError, CycleDetectedError } from '../utils/errors.js';

/**
 * Manages hierarchical relationships between entities.
 */
export class HierarchyManager {
  constructor(private storage: GraphStorage) {}

  /**
   * Set the parent of an entity.
   *
   * Validates:
   * - Entity and parent exist
   * - Setting parent won't create a cycle
   *
   * @param entityName - Entity to set parent for
   * @param parentName - Parent entity name (null to remove parent)
   * @returns Updated entity
   * @throws {EntityNotFoundError} If entity or parent not found
   * @throws {CycleDetectedError} If setting parent would create a cycle
   */
  async setEntityParent(entityName: string, parentName: string | null): Promise<Entity> {
    // Use read-only graph for validation checks
    const readGraph = await this.storage.loadGraph();
    const entityExists = readGraph.entities.find(e => e.name === entityName);

    if (!entityExists) {
      throw new EntityNotFoundError(entityName);
    }

    // If setting a parent, validate it exists and doesn't create a cycle
    if (parentName !== null) {
      const parent = readGraph.entities.find(e => e.name === parentName);
      if (!parent) {
        throw new EntityNotFoundError(parentName);
      }

      // Check for cycles
      if (this.wouldCreateCycle(readGraph, entityName, parentName)) {
        throw new CycleDetectedError(entityName, parentName);
      }
    }

    // Get mutable copy for write operation
    const graph = await this.storage.getGraphForMutation();
    const entity = graph.entities.find(e => e.name === entityName)!;
    entity.parentId = parentName || undefined;
    entity.lastModified = new Date().toISOString();

    await this.storage.saveGraph(graph);
    return entity;
  }

  /**
   * Check if setting a parent would create a cycle in the hierarchy.
   *
   * @param graph - Knowledge graph
   * @param entityName - Entity to set parent for
   * @param parentName - Proposed parent
   * @returns True if cycle would be created
   */
  private wouldCreateCycle(
    graph: ReadonlyKnowledgeGraph,
    entityName: string,
    parentName: string
  ): boolean {
    const visited = new Set<string>();
    let current: string | undefined = parentName;

    while (current) {
      if (visited.has(current)) {
        return true; // Cycle detected in existing hierarchy
      }
      if (current === entityName) {
        return true; // Would create a cycle
      }
      visited.add(current);

      const currentEntity = graph.entities.find(e => e.name === current);
      current = currentEntity?.parentId;
    }

    return false;
  }

  /**
   * Get the immediate children of an entity.
   *
   * @param entityName - Parent entity name
   * @returns Array of child entities
   * @throws {EntityNotFoundError} If entity not found
   */
  async getChildren(entityName: string): Promise<Entity[]> {
    const graph = await this.storage.loadGraph();

    // Verify entity exists
    if (!graph.entities.find(e => e.name === entityName)) {
      throw new EntityNotFoundError(entityName);
    }

    return graph.entities.filter(e => e.parentId === entityName);
  }

  /**
   * Get the parent of an entity.
   *
   * @param entityName - Entity name
   * @returns Parent entity or null if no parent
   * @throws {EntityNotFoundError} If entity not found
   */
  async getParent(entityName: string): Promise<Entity | null> {
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find(e => e.name === entityName);

    if (!entity) {
      throw new EntityNotFoundError(entityName);
    }

    if (!entity.parentId) {
      return null;
    }

    const parent = graph.entities.find(e => e.name === entity.parentId);
    return parent || null;
  }

  /**
   * Get all ancestors of an entity (parent, grandparent, etc.).
   *
   * @param entityName - Entity name
   * @returns Array of ancestor entities (ordered from immediate parent to root)
   * @throws {EntityNotFoundError} If entity not found
   */
  async getAncestors(entityName: string): Promise<Entity[]> {
    const graph = await this.storage.loadGraph();
    const ancestors: Entity[] = [];

    let current = graph.entities.find(e => e.name === entityName);
    if (!current) {
      throw new EntityNotFoundError(entityName);
    }

    while (current.parentId) {
      const parent = graph.entities.find(e => e.name === current!.parentId);
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }

    return ancestors;
  }

  /**
   * Get all descendants of an entity (children, grandchildren, etc.).
   *
   * Uses breadth-first traversal.
   *
   * @param entityName - Entity name
   * @returns Array of descendant entities
   * @throws {EntityNotFoundError} If entity not found
   */
  async getDescendants(entityName: string): Promise<Entity[]> {
    const graph = await this.storage.loadGraph();

    // Verify entity exists
    if (!graph.entities.find(e => e.name === entityName)) {
      throw new EntityNotFoundError(entityName);
    }

    const descendants: Entity[] = [];
    const toProcess = [entityName];

    while (toProcess.length > 0) {
      const current = toProcess.shift()!;
      const children = graph.entities.filter(e => e.parentId === current);

      for (const child of children) {
        descendants.push(child);
        toProcess.push(child.name);
      }
    }

    return descendants;
  }

  /**
   * Get the entire subtree rooted at an entity (entity + all descendants).
   *
   * Includes relations between entities in the subtree.
   *
   * @param entityName - Root entity name
   * @returns Knowledge graph containing subtree
   * @throws {EntityNotFoundError} If entity not found
   */
  async getSubtree(entityName: string): Promise<KnowledgeGraph> {
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find(e => e.name === entityName);

    if (!entity) {
      throw new EntityNotFoundError(entityName);
    }

    const descendants = await this.getDescendants(entityName);
    const subtreeEntities = [entity, ...descendants];
    const subtreeEntityNames = new Set(subtreeEntities.map(e => e.name));

    // Include relations between entities in the subtree
    const subtreeRelations = graph.relations.filter(
      r => subtreeEntityNames.has(r.from) && subtreeEntityNames.has(r.to)
    );

    return {
      entities: subtreeEntities,
      relations: subtreeRelations,
    };
  }

  /**
   * Get root entities (entities with no parent).
   *
   * @returns Array of root entities
   */
  async getRootEntities(): Promise<Entity[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(e => !e.parentId);
  }

  /**
   * Get the depth of an entity in the hierarchy.
   *
   * Root entities have depth 0, their children depth 1, etc.
   *
   * @param entityName - Entity name
   * @returns Depth (number of ancestors)
   * @throws {EntityNotFoundError} If entity not found
   */
  async getEntityDepth(entityName: string): Promise<number> {
    const ancestors = await this.getAncestors(entityName);
    return ancestors.length;
  }

  /**
   * Move an entity to a new parent (maintaining its descendants).
   *
   * Alias for setEntityParent.
   *
   * @param entityName - Entity to move
   * @param newParentName - New parent name (null to make root)
   * @returns Updated entity
   */
  async moveEntity(entityName: string, newParentName: string | null): Promise<Entity> {
    return await this.setEntityParent(entityName, newParentName);
  }
}
