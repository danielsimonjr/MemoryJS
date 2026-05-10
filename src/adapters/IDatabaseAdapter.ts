/**
 * Database Adapter Interface
 *
 * Phase 4 step 47 (§12.1) — adapter interface for backing the
 * knowledge graph with an external database (Postgres, MongoDB, etc.)
 * instead of the bundled JSONL / SQLite storage.
 *
 * **No external deps.** This module ships only the interface and a
 * `null` reference implementation. Concrete adapters (`pg`, `mongodb`,
 * etc.) live in companion packages so the main library doesn't carry
 * those install costs.
 *
 * To plug a real database in, implement `IDatabaseAdapter` and inject
 * it via `new ManagerContext(storage)` where `storage` wraps your
 * adapter behind the existing `IGraphStorage` shape. Sample wrappers
 * are provided in `docs/superpowers/plans/2026-04-25-eta-database-adapters.md`.
 *
 * @module adapters/IDatabaseAdapter
 */

import type { Entity, Relation, KnowledgeGraph } from '../types/types.js';

/**
 * Minimal CRUD contract any backing database must satisfy. Modeled
 * after `IGraphStorage` but narrower — only the operations a
 * caller-supplied database actually needs to implement to wire into
 * the storage layer above it.
 *
 * Read methods may return either a fresh copy or a live reference to
 * implementation-internal state; callers should treat results as
 * immutable until they obtain a mutable copy via `getGraphForMutation`.
 */
export interface IDatabaseAdapter {
  /** Stable name for diagnostics — `'postgres'`, `'mongodb'`, etc. */
  readonly name: string;

  /** Open the connection / pool. Idempotent. */
  connect(): Promise<void>;

  /** Close the connection / pool. Idempotent. */
  disconnect(): Promise<void>;

  /** Whether `connect()` has succeeded and the adapter is ready to serve queries. */
  isConnected(): boolean;

  // ==================== Entity CRUD ====================

  /** Insert (or upsert when supported) an entity. */
  putEntity(entity: Entity): Promise<void>;

  /** Look up an entity by name. */
  getEntity(name: string): Promise<Entity | undefined>;

  /** Delete an entity by name. Returns true if a row was removed. */
  deleteEntity(name: string): Promise<boolean>;

  /** List every entity. Implementations should stream when the result set is large. */
  listEntities(): Promise<Entity[]>;

  // ==================== Relation CRUD ====================

  putRelation(relation: Relation): Promise<void>;
  deleteRelation(from: string, to: string, relationType: string): Promise<boolean>;
  listRelations(): Promise<Relation[]>;

  // ==================== Bulk loaders ====================

  /**
   * Snapshot the current state of the database into a `KnowledgeGraph`.
   * Used by the storage layer above when it needs a full copy
   * (`loadGraph()` cache-warming, `getGraphForMutation()`). Should be
   * cheap on hot reads — implementations typically return a streamed
   * cursor reified into arrays.
   */
  snapshot(): Promise<KnowledgeGraph>;

  /**
   * Apply a multi-entity / multi-relation write atomically. Used by
   * `BatchTransaction.execute()` and similar bulk paths.
   */
  applyBatch(ops: DatabaseBatchOp[]): Promise<void>;

  /**
   * Stream every entity. Implementations should pull from a server-
   * side cursor when available (Postgres `DECLARE CURSOR`, Mongo
   * `find().cursor()`) so the full result set never has to live in
   * memory at once. The reference `InMemoryDatabaseAdapter` simply
   * yields its in-memory map.
   */
  streamEntities(): AsyncIterable<Entity>;

  /**
   * Run `fn` inside a transaction. Implementations decide the isolation
   * level — the contract is just "either every write inside `fn`
   * commits, or none do". `fn` should perform writes via the same
   * adapter instance (real adapters may shadow methods to route
   * through the transaction handle).
   *
   * Re-entrancy is not required: an inner `withTransaction` may join
   * the outer transaction, start a savepoint, or throw, depending on
   * the adapter. Document the choice in the implementation's JSDoc.
   */
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Single operation in a `applyBatch` payload. Modeled after the
 * `BatchOperation` type in `src/types/types.ts` but kept narrower so
 * adapters can implement just what they need.
 */
export type DatabaseBatchOp =
  | { kind: 'put-entity'; entity: Entity }
  | { kind: 'delete-entity'; name: string }
  | { kind: 'put-relation'; relation: Relation }
  | { kind: 'delete-relation'; from: string; to: string; relationType: string };

/**
 * Reference no-op adapter. Useful as a "loud failure" stand-in: every
 * method (including `connect`) rejects with an explicit unimplemented
 * error so a caller who reaches for this adapter notices their
 * misconfiguration rather than silently losing data. Use
 * `InMemoryDatabaseAdapter` for tests that need a working backend.
 */
export class NullDatabaseAdapter implements IDatabaseAdapter {
  readonly name = 'null';

  connect(): Promise<void> {
    return Promise.reject(
      new Error('NullDatabaseAdapter: connect is unimplemented (use a real adapter)'),
    );
  }

  async disconnect(): Promise<void> {
    // disconnect-on-disconnected is a legitimate cleanup pattern; keep it
    // forgiving so teardown paths don't have to special-case the null
    // adapter.
  }

  isConnected(): boolean {
    return false;
  }

  putEntity(): Promise<void> {
    return Promise.reject(new Error('NullDatabaseAdapter: putEntity is unimplemented'));
  }
  getEntity(): Promise<Entity | undefined> {
    return Promise.reject(new Error('NullDatabaseAdapter: getEntity is unimplemented'));
  }
  deleteEntity(): Promise<boolean> {
    return Promise.reject(new Error('NullDatabaseAdapter: deleteEntity is unimplemented'));
  }
  listEntities(): Promise<Entity[]> {
    return Promise.reject(new Error('NullDatabaseAdapter: listEntities is unimplemented'));
  }
  putRelation(): Promise<void> {
    return Promise.reject(new Error('NullDatabaseAdapter: putRelation is unimplemented'));
  }
  deleteRelation(): Promise<boolean> {
    return Promise.reject(new Error('NullDatabaseAdapter: deleteRelation is unimplemented'));
  }
  listRelations(): Promise<Relation[]> {
    return Promise.reject(new Error('NullDatabaseAdapter: listRelations is unimplemented'));
  }
  snapshot(): Promise<KnowledgeGraph> {
    return Promise.reject(new Error('NullDatabaseAdapter: snapshot is unimplemented'));
  }
  applyBatch(): Promise<void> {
    return Promise.reject(new Error('NullDatabaseAdapter: applyBatch is unimplemented'));
  }
  streamEntities(): AsyncIterable<Entity> {
    return (async function* () {
      throw new Error('NullDatabaseAdapter: streamEntities is unimplemented');
    })();
  }
  withTransaction<T>(): Promise<T> {
    return Promise.reject(new Error('NullDatabaseAdapter: withTransaction is unimplemented'));
  }
}

/**
 * In-memory adapter — useful for tests, ephemeral processes, and as
 * a known-good reference implementation against which real adapters
 * can be compared (the contract test in `tests/integration/` runs
 * against this and any registered adapter).
 */
export class InMemoryDatabaseAdapter implements IDatabaseAdapter {
  readonly name = 'in-memory';
  private connected = false;
  private entities: Map<string, Entity> = new Map();
  private relations: Map<string, Relation> = new Map();

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.entities.clear();
    this.relations.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async putEntity(entity: Entity): Promise<void> {
    this.checkConnected();
    this.entities.set(entity.name, entity);
  }

  async getEntity(name: string): Promise<Entity | undefined> {
    this.checkConnected();
    return this.entities.get(name);
  }

  async deleteEntity(name: string): Promise<boolean> {
    this.checkConnected();
    return this.entities.delete(name);
  }

  async listEntities(): Promise<Entity[]> {
    this.checkConnected();
    return [...this.entities.values()];
  }

  async putRelation(relation: Relation): Promise<void> {
    this.checkConnected();
    this.relations.set(relationKey(relation.from, relation.to, relation.relationType), relation);
  }

  async deleteRelation(from: string, to: string, relationType: string): Promise<boolean> {
    this.checkConnected();
    return this.relations.delete(relationKey(from, to, relationType));
  }

  async listRelations(): Promise<Relation[]> {
    this.checkConnected();
    return [...this.relations.values()];
  }

  async snapshot(): Promise<KnowledgeGraph> {
    this.checkConnected();
    return {
      entities: [...this.entities.values()],
      relations: [...this.relations.values()],
    };
  }

  /**
   * Yield every entity. Reference impl is trivially in-memory; real
   * adapters should stream from a server-side cursor.
   */
  async *streamEntities(): AsyncIterable<Entity> {
    this.checkConnected();
    for (const entity of this.entities.values()) {
      yield entity;
    }
  }

  /**
   * In-memory transaction: snapshots the maps, runs `fn`, restores on
   * throw. Re-entrant calls join the outermost transaction (the inner
   * snapshot is identical to the outer pre-state, so commits/rollbacks
   * compose naturally).
   */
  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    this.checkConnected();
    const entitySnapshot = new Map(this.entities);
    const relationSnapshot = new Map(this.relations);
    try {
      return await fn();
    } catch (err) {
      this.entities = entitySnapshot;
      this.relations = relationSnapshot;
      throw err;
    }
  }

  async applyBatch(ops: DatabaseBatchOp[]): Promise<void> {
    this.checkConnected();
    // Snapshot before applying so a thrown op rolls back to the
    // pre-batch state — matches the "atomic" contract in the
    // interface JSDoc.
    const entitySnapshot = new Map(this.entities);
    const relationSnapshot = new Map(this.relations);
    try {
      for (const op of ops) {
        switch (op.kind) {
          case 'put-entity':
            this.entities.set(op.entity.name, op.entity);
            break;
          case 'delete-entity':
            this.entities.delete(op.name);
            break;
          case 'put-relation':
            this.relations.set(
              relationKey(op.relation.from, op.relation.to, op.relation.relationType),
              op.relation,
            );
            break;
          case 'delete-relation':
            this.relations.delete(relationKey(op.from, op.to, op.relationType));
            break;
        }
      }
    } catch (err) {
      this.entities = entitySnapshot;
      this.relations = relationSnapshot;
      throw err;
    }
  }

  private checkConnected(): void {
    if (!this.connected) {
      throw new Error('InMemoryDatabaseAdapter: not connected (call connect() first)');
    }
  }
}

function relationKey(from: string, to: string, relationType: string): string {
  return `${from} ${to} ${relationType}`;
}
