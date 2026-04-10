/** Atomic transaction support for knowledge graph operations. */

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

export enum OperationType {
  CREATE_ENTITY = 'CREATE_ENTITY',
  UPDATE_ENTITY = 'UPDATE_ENTITY',
  DELETE_ENTITY = 'DELETE_ENTITY',
  CREATE_RELATION = 'CREATE_RELATION',
  DELETE_RELATION = 'DELETE_RELATION',
}

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

export interface TransactionResult {
  success: boolean;
  operationsExecuted: number;
  error?: string;
  rollbackBackup?: string;
}

/** Manages atomic transactions with backup-based rollback. */
export class TransactionManager {
  private operations: TransactionOperation[] = [];
  private inTransaction: boolean = false;
  private ioManager: IOManager;
  private transactionBackup?: string;

  constructor(private storage: GraphStorage) {
    this.ioManager = new IOManager(storage);
  }

  /** Begin a new transaction. */
  begin(): void {
    if (this.inTransaction) {
      throw new KnowledgeGraphError('Transaction already in progress', 'TRANSACTION_ACTIVE');
    }

    this.operations = [];
    this.inTransaction = true;
  }

  /** Stage a create entity operation. */
  createEntity(entity: Omit<Entity, 'createdAt' | 'lastModified'>): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.CREATE_ENTITY,
      data: entity,
    });
  }

  /** Stage an update entity operation. */
  updateEntity(name: string, updates: Partial<Entity>): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.UPDATE_ENTITY,
      data: { name, updates },
    });
  }

  /** Stage a delete entity operation. */
  deleteEntity(name: string): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.DELETE_ENTITY,
      data: { name },
    });
  }

  /** Stage a create relation operation. */
  createRelation(relation: Omit<Relation, 'createdAt' | 'lastModified'>): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.CREATE_RELATION,
      data: relation,
    });
  }

  /** Stage a delete relation operation. */
  deleteRelation(from: string, to: string, relationType: string): void {
    this.ensureInTransaction();
    this.operations.push({
      type: OperationType.DELETE_RELATION,
      data: { from, to, relationType },
    });
  }

  /** Commit the transaction, applying all staged operations atomically. */
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

  /** Rollback the current transaction. */
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

  /** Check if a transaction is currently in progress. */
  isInTransaction(): boolean {
    return this.inTransaction;
  }

  /** Get the number of staged operations. */
  getOperationCount(): number {
    return this.operations.length;
  }

  /** @private */
  private ensureInTransaction(): void {
    if (!this.inTransaction) {
      throw new KnowledgeGraphError('No transaction in progress. Call begin() first.', 'NO_TRANSACTION');
    }
  }

  /** @private */
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

/** Fluent API for building and executing batch transactions. */
export class BatchTransaction {
  private operations: BatchOperation[] = [];
  private storage: GraphStorage;

  constructor(storage: GraphStorage) {
    this.storage = storage;
  }

  /** Add a create entity operation. */
  createEntity(entity: Omit<Entity, 'createdAt' | 'lastModified'>): this {
    this.operations.push({ type: 'createEntity', data: entity });
    return this;
  }

  /** Add an update entity operation. */
  updateEntity(name: string, updates: Partial<Entity>): this {
    this.operations.push({ type: 'updateEntity', data: { name, updates } });
    return this;
  }

  /** Add a delete entity operation. */
  deleteEntity(name: string): this {
    this.operations.push({ type: 'deleteEntity', data: { name } });
    return this;
  }

  /** Add a create relation operation. */
  createRelation(relation: Omit<Relation, 'createdAt' | 'lastModified'>): this {
    this.operations.push({ type: 'createRelation', data: relation });
    return this;
  }

  /** Add a delete relation operation. */
  deleteRelation(from: string, to: string, relationType: string): this {
    this.operations.push({ type: 'deleteRelation', data: { from, to, relationType } });
    return this;
  }

  /** Add observations to an existing entity. */
  addObservations(name: string, observations: string[]): this {
    this.operations.push({ type: 'addObservations', data: { name, observations } });
    return this;
  }

  /** Delete observations from an existing entity. */
  deleteObservations(name: string, observations: string[]): this {
    this.operations.push({ type: 'deleteObservations', data: { name, observations } });
    return this;
  }

  /** Add multiple operations from an array. */
  addOperations(operations: BatchOperation[]): this {
    this.operations.push(...operations);
    return this;
  }

  /** Get the number of operations in this batch. */
  size(): number {
    return this.operations.length;
  }

  /** Clear all operations. */
  clear(): this {
    this.operations = [];
    return this;
  }

  /** Get a copy of the operations. */
  getOperations(): BatchOperation[] {
    return [...this.operations];
  }

  /** Execute all operations atomically. */
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

    // Track per-operation results when stopOnError is false
    const operationResults: import('../types/index.js').OperationResult[] = [];
    let failedCount = 0;

    // Execute operations
    for (let i = 0; i < this.operations.length; i++) {
      const operation = this.operations[i];

      try {
        this.applyBatchOperation(graph, operation, timestamp, result);
        result.operationsExecuted++;
        if (!stopOnError) {
          operationResults.push({ index: i, success: true });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.success = false;
        result.failedOperationIndex ??= i;

        if (stopOnError) {
          result.error = errorMsg;
          result.executionTimeMs = Date.now() - startTime;
          return result;
        }

        failedCount++;
        operationResults.push({ index: i, success: false, error: errorMsg });
      }
    }

    // Attach per-operation results when not stopping on error
    if (!stopOnError && operationResults.length > 0) {
      result.operationResults = operationResults;
      if (failedCount > 0) {
        result.error = `${failedCount} of ${this.operations.length} operations failed`;
      }
    }

    // Save the modified graph if any operations succeeded
    if (result.operationsExecuted > 0) {
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
