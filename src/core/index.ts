/**
 * Core Module Barrel Export
 * Phase 4: Added ObservationManager, HierarchyManager, and GraphTraversal exports
 */

export { GraphStorage } from './GraphStorage.js';
export { SQLiteStorage } from './SQLiteStorage.js';
export { EntityManager } from './EntityManager.js';
export { RelationManager } from './RelationManager.js';
export { ObservationManager } from './ObservationManager.js';
export { HierarchyManager } from './HierarchyManager.js';
export { ManagerContext } from './ManagerContext.js';
// Phase 4 Sprint 6-8: Graph traversal algorithms
export { GraphTraversal } from './GraphTraversal.js';
// Backward compatibility alias
export { ManagerContext as KnowledgeGraphManager } from './ManagerContext.js';
export {
  TransactionManager,
  OperationType,
  BatchTransaction,
  type TransactionOperation,
  type TransactionResult,
} from './TransactionManager.js';
export { createStorage, createStorageFromPath } from './StorageFactory.js';
// Phase 10 Sprint 2: Graph change events
export { GraphEventEmitter } from './GraphEventEmitter.js';
