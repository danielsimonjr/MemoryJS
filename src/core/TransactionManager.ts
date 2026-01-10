/**
 * Transaction Manager
 *
 * Provides atomic transaction support for knowledge graph operations.
 * Ensures data consistency by allowing multiple operations to be
 * grouped together and committed atomically, with automatic rollback on failure.
 *
 * @module core/TransactionManager
 */

import type {
  Entity,
  Relation,
  KnowledgeGraph,
  LongRunningOperationOptions,
  BatchOperation,
  BatchResult,
  BatchOptions,
} from '../types/index.js';
import type { GraphStorage } from './GraphStorage.js';
import { IOManager } from '../features/IOManager.js';
import { KnowledgeGraphError } from '../utils/errors.js';
import { checkCancellation, createProgressReporter, createProgress, sanitizeObject } from '../utils/index.js';

/**
 * Types of operations that can be performed in a transaction.
 */
export enum OperationType {
  CREATE_ENTITY = 'CREATE_ENTITY',
  UPDATE_ENTITY = 'UPDATE_ENTITY',
  DELETE_ENTITY = 'DELETE_ENTITY',
  CREATE_RELATION = 'CREATE_RELATION',
  DELETE_RELATION = 'DELETE_RELATION',
}

/**
 * Represents a single operation in a transaction using discriminated union.
 */
export type TransactionOperation =
  | {
      type: OperationType.CREATE_ENTITY;
      data: Omit<Entity, 'createdAt' | 'lastModified'>;
    }
  | {
      type: OperationType.UPDATE_ENTITY;
      data: { name: string; updates: Partial<Entity> };
    }
  | {
      type: OperationType.DELETE_ENTITY;
      data: { name: string };
    }
  | {
      type: OperationType.CREATE_RELATION;
      data: Omit<Relation, 'createdAt' | 'lastModified'>;
    }
  | {
      type: OperationType.DELETE_RELATION;
      data: { from: string; to: string; relationType: string };
    };

/**
 * Transaction execution result.
 */
export interface TransactionResult {
  /** Whether the transaction was successful */
  success: boolean;
  /** Number of operations executed */
  operationsExecuted: number;
  /** Error message if transaction failed */
  error?: string;
  /** Path to rollback backup if created */
  rollbackBackup?: string;
}

/**
 * Manages atomic transactions for knowledge graph operations.
 *
 * Provides ACID-like guarantees:
 * - Atomicity: All operations succeed or all fail
 * - Consistency: Graph is always in a valid state
 * - Isolation: Each transaction operates on a snapshot
 * - Durability: Changes are persisted to disk
 *
 * @example
 * ```typescript
 * const storage = new GraphStorage('/data/memory.jsonl');
 * const txManager = new TransactionManager(storage);
 *
 * // Begin transaction
 * txManager.begin();
 *
 * // Stage operations
 * txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
 * txManager.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' });
 *
 * // Commit atomically (or rollback on error)
 * const result = await txManager.commit();
 * if (result.success) {
 *   console.log(`Transaction completed: ${result.operationsExecuted} operations`);
 * }
 * ```
 */
export class TransactionManager {
  private operations: TransactionOperation[] = [];
  private inTransaction: boolean = false;
  private ioManager: IOManager;
  private transactionBackup?: string;

  constructor(private storage: GraphStorage) {
    this.ioManager = new IOManager(storage);
  }

  /**
   * Begin a new transaction.
   *
   * Creates a backup of the current state for rollback purposes.
   * Only one transaction can be active at a time.
   *
   * @throws {KnowledgeGraphError} If a transaction is already in progress
   *
   * @example
   * ```typescript
   * txManager.begin();
   * // ... stage operations ...
   * await txManager.commit();
   * ```
   */
  begin(): void {
    if (this.inTransaction) {
      throw new KnowledgeGraphError('Transaction already in progress', 'TRANSACTION_ACTIVE');
    }

    this.operations = [];
    this.inTransaction = true;
  }

  /**
   * Stage a create entity operation.
   *
   * @param entity - Entity to create (without timestamps)
   *
   * @example
   * ```typescript
   * txManager.begin();
   * txManager.createEntity({
   *   name: 'Alice',
   *   entityType: 'person',
   *   observations: ['Software engineer'],
   *   importance: 8
   * });
   * ```
   */
  createEntity(entity: Omit<Entity, 'createdAt' | 'lastModified'>): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.CREATE_ENTITY,
      data: entity,
    });
  }

  /**
   * Stage an update entity operation.
   *
   * @param name - Name of entity to update
   * @param updates - Partial entity updates
   *
   * @example
   * ```typescript
   * txManager.begin();
   * txManager.updateEntity('Alice', {
   *   importance: 9,
   *   observations: ['Lead software engineer']
   * });
   * ```
   */
  updateEntity(name: string, updates: Partial<Entity>): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.UPDATE_ENTITY,
      data: { name, updates },
    });
  }

  /**
   * Stage a delete entity operation.
   *
   * @param name - Name of entity to delete
   *
   * @example
   * ```typescript
   * txManager.begin();
   * txManager.deleteEntity('OldEntity');
   * ```
   */
  deleteEntity(name: string): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.DELETE_ENTITY,
      data: { name },
    });
  }

  /**
   * Stage a create relation operation.
   *
   * @param relation - Relation to create (without timestamps)
   *
   * @example
   * ```typescript
   * txManager.begin();
   * txManager.createRelation({
   *   from: 'Alice',
   *   to: 'Bob',
   *   relationType: 'mentors'
   * });
   * ```
   */
  createRelation(relation: Omit<Relation, 'createdAt' | 'lastModified'>): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.CREATE_RELATION,
      data: relation,
    });
  }

  /**
   * Stage a delete relation operation.
   *
   * @param from - Source entity name
   * @param to - Target entity name
   * @param relationType - Type of relation
   *
   * @example
   * ```typescript
   * txManager.begin();
   * txManager.deleteRelation('Alice', 'Bob', 'mentors');
   * ```
   */
  deleteRelation(from: string, to: string, relationType: string): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.DELETE_RELATION,
      data: { from, to, relationType },
    });
  }

  /**
   * Commit the transaction, applying all staged operations atomically.
   *
   * Creates a backup before applying changes. If any operation fails,
   * automatically rolls back to the pre-transaction state.
   *
   * Phase 9B: Supports progress tracking and cancellation via LongRunningOperationOptions.
   *
   * @param options - Optional progress/cancellation options (Phase 9B)
   * @returns Promise resolving to transaction result
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
   *
   * @example
   * ```typescript
   * txManager.begin();
   * txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
   * txManager.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' });
   *
   * const result = await txManager.commit();
   * if (result.success) {
   *   console.log(`Committed ${result.operationsExecuted} operations`);
   * } else {
   *   console.error(`Transaction failed: ${result.error}`);
   * }
   *
   * // With progress tracking (Phase 9B)
   * const result = await txManager.commit({
   *   onProgress: (p) => console.log(`${p.percentage}% complete`),
   * });
   * ```
   */
  async commit(options?: LongRunningOperationOptions): Promise<TransactionResult> {
    this.ensureInTransaction();

    // Setup progress reporter
    const reportProgress = createProgressReporter(options?.onProgress);
    const totalOperations = this.operations.length;
    reportProgress?.(createProgress(0, 100, 'commit'));

    try {
      // Check for early cancellation (inside try block to handle gracefully)
      checkCancellation(options?.signal, 'commit');
      // Phase 1: Create backup for rollback (0-20% progress)
      reportProgress?.(createProgress(5, 100, 'creating backup'));
      const backupResult = await this.ioManager.createBackup({
        description: 'Transaction backup (auto-created)',
      });
      this.transactionBackup = backupResult.path;

      // Check for cancellation after backup
      checkCancellation(options?.signal, 'commit');
      reportProgress?.(createProgress(20, 100, 'backup created'));

      // Phase 2: Load graph (20-30% progress)
      reportProgress?.(createProgress(25, 100, 'loading graph'));
      const graph = await this.storage.getGraphForMutation();
      const timestamp = new Date().toISOString();
      reportProgress?.(createProgress(30, 100, 'graph loaded'));

      // Phase 3: Apply all operations (30-80% progress)
      let operationsExecuted = 0;
      for (const operation of this.operations) {
        // Check for cancellation between operations
        checkCancellation(options?.signal, 'commit');

        this.applyOperation(graph, operation, timestamp);
        operationsExecuted++;

        // Map operation progress (0-100%) to overall progress (30-80%)
        const opProgress = totalOperations > 0 ? Math.round(30 + (operationsExecuted / totalOperations) * 50) : 80;
        reportProgress?.(createProgress(opProgress, 100, 'applying operations'));
      }

      // Check for cancellation before save
      checkCancellation(options?.signal, 'commit');

      // Phase 4: Save the modified graph (80-95% progress)
      reportProgress?.(createProgress(85, 100, 'saving graph'));
      await this.storage.saveGraph(graph);
      reportProgress?.(createProgress(95, 100, 'graph saved'));

      // Clean up transaction state
      this.inTransaction = false;
      this.operations = [];

      // Delete the transaction backup (no longer needed)
      if (this.transactionBackup) {
        await this.ioManager.deleteBackup(this.transactionBackup);
        this.transactionBackup = undefined;
      }

      // Report completion
      reportProgress?.(createProgress(100, 100, 'commit'));

      return {
        success: true,
        operationsExecuted,
      };
    } catch (error) {
      // Rollback on error
      const rollbackResult = await this.rollback();

      return {
        success: false,
        operationsExecuted: 0,
        error: error instanceof Error ? error.message : String(error),
        rollbackBackup: rollbackResult.backupUsed,
      };
    }
  }

  /**
   * Rollback the current transaction.
   *
   * Restores the graph to the pre-transaction state using the backup.
   * Automatically called by commit() on failure.
   *
   * @returns Promise resolving to rollback result
   *
   * @example
   * ```typescript
   * txManager.begin();
   * txManager.createEntity({ name: 'Test', entityType: 'temp', observations: [] });
   *
   * // Explicit rollback (e.g., user cancellation)
   * const result = await txManager.rollback();
   * console.log(`Rolled back, restored from: ${result.backupUsed}`);
   * ```
   */
  async rollback(): Promise<{ success: boolean; backupUsed?: string }> {
    if (!this.transactionBackup) {
      this.inTransaction = false;
      this.operations = [];
      return { success: false };
    }

    try {
      // Restore from backup
      await this.ioManager.restoreFromBackup(this.transactionBackup);

      // Clean up
      const backupUsed = this.transactionBackup;
      await this.ioManager.deleteBackup(this.transactionBackup);

      this.inTransaction = false;
      this.operations = [];
      this.transactionBackup = undefined;

      return { success: true, backupUsed };
    } catch (error) {
      // Rollback failed - keep backup for manual recovery
      this.inTransaction = false;
      this.operations = [];

      return { success: false, backupUsed: this.transactionBackup };
    }
  }

  /**
   * Check if a transaction is currently in progress.
   *
   * @returns True if transaction is active
   */
  isInTransaction(): boolean {
    return this.inTransaction;
  }

  /**
   * Get the number of staged operations in the current transaction.
   *
   * @returns Number of operations staged
   */
  getOperationCount(): number {
    return this.operations.length;
  }

  /**
   * Ensure a transaction is in progress, or throw an error.
   *
   * @private
   */
  private ensureInTransaction(): void {
    if (!this.inTransaction) {
      throw new KnowledgeGraphError('No transaction in progress. Call begin() first.', 'NO_TRANSACTION');
    }
  }

  /**
   * Apply a single operation to the graph.
   *
   * @private
   */
  private applyOperation(graph: KnowledgeGraph, operation: TransactionOperation, timestamp: string): void {
    switch (operation.type) {
      case OperationType.CREATE_ENTITY: {
        const entity: Entity = {
          ...operation.data,
          createdAt: timestamp,
          lastModified: timestamp,
        };
        // Check for duplicates
        if (graph.entities.some(e => e.name === entity.name)) {
          throw new KnowledgeGraphError(`Entity "${entity.name}" already exists`, 'DUPLICATE_ENTITY');
        }
        graph.entities.push(entity);
        break;
      }

      case OperationType.UPDATE_ENTITY: {
        const { name, updates } = operation.data;
        const entity = graph.entities.find(e => e.name === name);
        if (!entity) {
          throw new KnowledgeGraphError(`Entity "${name}" not found`, 'ENTITY_NOT_FOUND');
        }
        // Sanitize updates to prevent prototype pollution
        Object.assign(entity, sanitizeObject(updates as Record<string, unknown>));
        entity.lastModified = timestamp;
        break;
      }

      case OperationType.DELETE_ENTITY: {
        const { name } = operation.data;
        const index = graph.entities.findIndex(e => e.name === name);
        if (index === -1) {
          throw new KnowledgeGraphError(`Entity "${name}" not found`, 'ENTITY_NOT_FOUND');
        }
        graph.entities.splice(index, 1);
        // Delete related relations
        graph.relations = graph.relations.filter(r => r.from !== name && r.to !== name);
        break;
      }

      case OperationType.CREATE_RELATION: {
        const relation: Relation = {
          ...operation.data,
          createdAt: timestamp,
          lastModified: timestamp,
        };
        // Check for duplicates
        const exists = graph.relations.some(
          r => r.from === relation.from && r.to === relation.to && r.relationType === relation.relationType
        );
        if (exists) {
          throw new KnowledgeGraphError(
            `Relation "${relation.from}" -> "${relation.to}" (${relation.relationType}) already exists`,
            'DUPLICATE_RELATION'
          );
        }
        graph.relations.push(relation);
        break;
      }

      case OperationType.DELETE_RELATION: {
        const { from, to, relationType } = operation.data;
        const index = graph.relations.findIndex(
          r => r.from === from && r.to === to && r.relationType === relationType
        );
        if (index === -1) {
          throw new KnowledgeGraphError(
            `Relation "${from}" -> "${to}" (${relationType}) not found`,
            'RELATION_NOT_FOUND'
          );
        }
        graph.relations.splice(index, 1);
        break;
      }

      default: {
        // Exhaustiveness check - TypeScript will error if we miss a case
        const _exhaustiveCheck: never = operation;
        throw new KnowledgeGraphError(`Unknown operation type: ${(_exhaustiveCheck as TransactionOperation).type}`, 'UNKNOWN_OPERATION');
      }
    }
  }
}

// ==================== Phase 10 Sprint 1: BatchTransaction ====================

/**
 * Phase 10 Sprint 1: Fluent API for building and executing batch transactions.
 *
 * BatchTransaction provides a builder pattern for accumulating multiple
 * graph operations and executing them atomically in a single transaction.
 * This reduces I/O overhead and ensures consistency across related changes.
 *
 * @example
 * ```typescript
 * const storage = new GraphStorage('/data/memory.jsonl');
 * const batch = new BatchTransaction(storage);
 *
 * // Build the batch with fluent API
 * const result = await batch
 *   .createEntity({ name: 'Alice', entityType: 'person', observations: ['Developer'] })
 *   .createEntity({ name: 'Bob', entityType: 'person', observations: ['Designer'] })
 *   .createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' })
 *   .updateEntity('Alice', { importance: 8 })
 *   .execute();
 *
 * if (result.success) {
 *   console.log(`Batch completed: ${result.operationsExecuted} operations in ${result.executionTimeMs}ms`);
 * }
 * ```
 */
export class BatchTransaction {
  private operations: BatchOperation[] = [];
  private storage: GraphStorage;

  /**
   * Create a new BatchTransaction instance.
   *
   * @param storage - GraphStorage instance to execute operations against
   */
  constructor(storage: GraphStorage) {
    this.storage = storage;
  }

  /**
   * Add a create entity operation to the batch.
   *
   * @param entity - Entity to create (without timestamps)
   * @returns This BatchTransaction for chaining
   *
   * @example
   * ```typescript
   * batch.createEntity({
   *   name: 'Alice',
   *   entityType: 'person',
   *   observations: ['Software engineer'],
   *   importance: 8
   * });
   * ```
   */
  createEntity(entity: Omit<Entity, 'createdAt' | 'lastModified'>): this {
    this.operations.push({ type: 'createEntity', data: entity });
    return this;
  }

  /**
   * Add an update entity operation to the batch.
   *
   * @param name - Name of entity to update
   * @param updates - Partial entity updates
   * @returns This BatchTransaction for chaining
   *
   * @example
   * ```typescript
   * batch.updateEntity('Alice', { importance: 9 });
   * ```
   */
  updateEntity(name: string, updates: Partial<Entity>): this {
    this.operations.push({ type: 'updateEntity', data: { name, updates } });
    return this;
  }

  /**
   * Add a delete entity operation to the batch.
   *
   * @param name - Name of entity to delete
   * @returns This BatchTransaction for chaining
   *
   * @example
   * ```typescript
   * batch.deleteEntity('OldEntity');
   * ```
   */
  deleteEntity(name: string): this {
    this.operations.push({ type: 'deleteEntity', data: { name } });
    return this;
  }

  /**
   * Add a create relation operation to the batch.
   *
   * @param relation - Relation to create (without timestamps)
   * @returns This BatchTransaction for chaining
   *
   * @example
   * ```typescript
   * batch.createRelation({
   *   from: 'Alice',
   *   to: 'Bob',
   *   relationType: 'mentors'
   * });
   * ```
   */
  createRelation(relation: Omit<Relation, 'createdAt' | 'lastModified'>): this {
    this.operations.push({ type: 'createRelation', data: relation });
    return this;
  }

  /**
   * Add a delete relation operation to the batch.
   *
   * @param from - Source entity name
   * @param to - Target entity name
   * @param relationType - Type of relation
   * @returns This BatchTransaction for chaining
   *
   * @example
   * ```typescript
   * batch.deleteRelation('Alice', 'Bob', 'mentors');
   * ```
   */
  deleteRelation(from: string, to: string, relationType: string): this {
    this.operations.push({ type: 'deleteRelation', data: { from, to, relationType } });
    return this;
  }

  /**
   * Add observations to an existing entity.
   *
   * @param name - Name of entity to add observations to
   * @param observations - Observations to add
   * @returns This BatchTransaction for chaining
   *
   * @example
   * ```typescript
   * batch.addObservations('Alice', ['Knows TypeScript', 'Leads team']);
   * ```
   */
  addObservations(name: string, observations: string[]): this {
    this.operations.push({ type: 'addObservations', data: { name, observations } });
    return this;
  }

  /**
   * Delete observations from an existing entity.
   *
   * @param name - Name of entity to delete observations from
   * @param observations - Observations to delete
   * @returns This BatchTransaction for chaining
   *
   * @example
   * ```typescript
   * batch.deleteObservations('Alice', ['Old fact']);
   * ```
   */
  deleteObservations(name: string, observations: string[]): this {
    this.operations.push({ type: 'deleteObservations', data: { name, observations } });
    return this;
  }

  /**
   * Add multiple operations from an array.
   *
   * @param operations - Array of batch operations
   * @returns This BatchTransaction for chaining
   *
   * @example
   * ```typescript
   * batch.addOperations([
   *   { type: 'createEntity', data: { name: 'A', entityType: 'x', observations: [] } },
   *   { type: 'createEntity', data: { name: 'B', entityType: 'x', observations: [] } }
   * ]);
   * ```
   */
  addOperations(operations: BatchOperation[]): this {
    this.operations.push(...operations);
    return this;
  }

  /**
   * Get the number of operations in this batch.
   *
   * @returns Number of operations queued
   */
  size(): number {
    return this.operations.length;
  }

  /**
   * Clear all operations from the batch.
   *
   * @returns This BatchTransaction for chaining
   */
  clear(): this {
    this.operations = [];
    return this;
  }

  /**
   * Get a copy of the operations in this batch.
   *
   * @returns Array of batch operations
   */
  getOperations(): BatchOperation[] {
    return [...this.operations];
  }

  /**
   * Execute all operations in the batch atomically.
   *
   * All operations are applied within a single transaction. If any
   * operation fails, all changes are rolled back (when stopOnError is true).
   *
   * @param options - Batch execution options
   * @returns Promise resolving to batch result
   *
   * @example
   * ```typescript
   * const result = await batch.execute();
   * if (result.success) {
   *   console.log(`Created ${result.entitiesCreated} entities`);
   * } else {
   *   console.error(`Failed at operation ${result.failedOperationIndex}: ${result.error}`);
   * }
   * ```
   */
  async execute(options: BatchOptions = {}): Promise<BatchResult> {
    const startTime = Date.now();
    const { stopOnError = true, validateBeforeExecute = true } = options;

    const result: BatchResult = {
      success: true,
      operationsExecuted: 0,
      entitiesCreated: 0,
      entitiesUpdated: 0,
      entitiesDeleted: 0,
      relationsCreated: 0,
      relationsDeleted: 0,
      executionTimeMs: 0,
    };

    if (this.operations.length === 0) {
      result.executionTimeMs = Date.now() - startTime;
      return result;
    }

    // Load graph for mutation
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();

    // Optional: Validate all operations before executing
    if (validateBeforeExecute) {
      const validationError = this.validateOperations(graph);
      if (validationError) {
        return {
          ...result,
          success: false,
          error: validationError.message,
          failedOperationIndex: validationError.index,
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    // Execute operations
    for (let i = 0; i < this.operations.length; i++) {
      const operation = this.operations[i];

      try {
        this.applyBatchOperation(graph, operation, timestamp, result);
        result.operationsExecuted++;
      } catch (error) {
        result.success = false;
        result.error = error instanceof Error ? error.message : String(error);
        result.failedOperationIndex = i;

        if (stopOnError) {
          result.executionTimeMs = Date.now() - startTime;
          return result;
        }
      }
    }

    // Save the modified graph if successful (or if stopOnError is false)
    if (result.success || !stopOnError) {
      try {
        await this.storage.saveGraph(graph);
      } catch (error) {
        result.success = false;
        result.error = `Failed to save graph: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    result.executionTimeMs = Date.now() - startTime;
    return result;
  }

  /**
   * Validate all operations before executing.
   * @private
   */
  private validateOperations(
    graph: KnowledgeGraph
  ): { message: string; index: number } | null {
    const entityNames = new Set(graph.entities.map(e => e.name));
    const pendingCreates = new Set<string>();
    const pendingDeletes = new Set<string>();

    for (let i = 0; i < this.operations.length; i++) {
      const op = this.operations[i];

      switch (op.type) {
        case 'createEntity': {
          const name = op.data.name;
          if (entityNames.has(name) && !pendingDeletes.has(name)) {
            return { message: `Entity "${name}" already exists`, index: i };
          }
          if (pendingCreates.has(name)) {
            return { message: `Duplicate create for entity "${name}" in batch`, index: i };
          }
          pendingCreates.add(name);
          break;
        }

        case 'updateEntity':
        case 'addObservations':
        case 'deleteObservations': {
          const name = op.data.name;
          const exists = (entityNames.has(name) || pendingCreates.has(name)) && !pendingDeletes.has(name);
          if (!exists) {
            return { message: `Entity "${name}" not found`, index: i };
          }
          break;
        }

        case 'deleteEntity': {
          const name = op.data.name;
          const exists = (entityNames.has(name) || pendingCreates.has(name)) && !pendingDeletes.has(name);
          if (!exists) {
            return { message: `Entity "${name}" not found for deletion`, index: i };
          }
          pendingDeletes.add(name);
          break;
        }

        case 'createRelation': {
          const { from, to } = op.data;
          const fromExists = (entityNames.has(from) || pendingCreates.has(from)) && !pendingDeletes.has(from);
          const toExists = (entityNames.has(to) || pendingCreates.has(to)) && !pendingDeletes.has(to);
          if (!fromExists) {
            return { message: `Source entity "${from}" not found for relation`, index: i };
          }
          if (!toExists) {
            return { message: `Target entity "${to}" not found for relation`, index: i };
          }
          break;
        }

        case 'deleteRelation': {
          // Relations are validated at execution time
          break;
        }
      }
    }

    return null;
  }

  /**
   * Apply a single batch operation to the graph.
   * @private
   */
  private applyBatchOperation(
    graph: KnowledgeGraph,
    operation: BatchOperation,
    timestamp: string,
    result: BatchResult
  ): void {
    switch (operation.type) {
      case 'createEntity': {
        const entity: Entity = {
          ...operation.data,
          createdAt: timestamp,
          lastModified: timestamp,
        };
        if (graph.entities.some(e => e.name === entity.name)) {
          throw new KnowledgeGraphError(`Entity "${entity.name}" already exists`, 'DUPLICATE_ENTITY');
        }
        graph.entities.push(entity);
        result.entitiesCreated++;
        break;
      }

      case 'updateEntity': {
        const { name, updates } = operation.data;
        const entity = graph.entities.find(e => e.name === name);
        if (!entity) {
          throw new KnowledgeGraphError(`Entity "${name}" not found`, 'ENTITY_NOT_FOUND');
        }
        // Sanitize updates to prevent prototype pollution
        Object.assign(entity, sanitizeObject(updates as Record<string, unknown>));
        entity.lastModified = timestamp;
        result.entitiesUpdated++;
        break;
      }

      case 'deleteEntity': {
        const { name } = operation.data;
        const index = graph.entities.findIndex(e => e.name === name);
        if (index === -1) {
          throw new KnowledgeGraphError(`Entity "${name}" not found`, 'ENTITY_NOT_FOUND');
        }
        graph.entities.splice(index, 1);
        // Delete related relations
        graph.relations = graph.relations.filter(r => r.from !== name && r.to !== name);
        result.entitiesDeleted++;
        break;
      }

      case 'createRelation': {
        const relation: Relation = {
          ...operation.data,
          createdAt: timestamp,
          lastModified: timestamp,
        };
        const exists = graph.relations.some(
          r => r.from === relation.from && r.to === relation.to && r.relationType === relation.relationType
        );
        if (exists) {
          throw new KnowledgeGraphError(
            `Relation "${relation.from}" -> "${relation.to}" (${relation.relationType}) already exists`,
            'DUPLICATE_RELATION'
          );
        }
        graph.relations.push(relation);
        result.relationsCreated++;
        break;
      }

      case 'deleteRelation': {
        const { from, to, relationType } = operation.data;
        const index = graph.relations.findIndex(
          r => r.from === from && r.to === to && r.relationType === relationType
        );
        if (index === -1) {
          throw new KnowledgeGraphError(
            `Relation "${from}" -> "${to}" (${relationType}) not found`,
            'RELATION_NOT_FOUND'
          );
        }
        graph.relations.splice(index, 1);
        result.relationsDeleted++;
        break;
      }

      case 'addObservations': {
        const { name, observations } = operation.data;
        const entity = graph.entities.find(e => e.name === name);
        if (!entity) {
          throw new KnowledgeGraphError(`Entity "${name}" not found`, 'ENTITY_NOT_FOUND');
        }
        // Add only new observations
        const existingSet = new Set(entity.observations);
        const newObs = observations.filter((o: string) => !existingSet.has(o));
        entity.observations.push(...newObs);
        entity.lastModified = timestamp;
        result.entitiesUpdated++;
        break;
      }

      case 'deleteObservations': {
        const { name, observations } = operation.data;
        const entity = graph.entities.find(e => e.name === name);
        if (!entity) {
          throw new KnowledgeGraphError(`Entity "${name}" not found`, 'ENTITY_NOT_FOUND');
        }
        const toDelete = new Set(observations);
        entity.observations = entity.observations.filter((o: string) => !toDelete.has(o));
        entity.lastModified = timestamp;
        result.entitiesUpdated++;
        break;
      }

      default: {
        const _exhaustiveCheck: never = operation;
        throw new KnowledgeGraphError(
          `Unknown batch operation type: ${(_exhaustiveCheck as BatchOperation).type}`,
          'UNKNOWN_OPERATION'
        );
      }
    }
  }
}
