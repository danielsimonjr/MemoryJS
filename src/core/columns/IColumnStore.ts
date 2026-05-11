/**
 * Column Store — Interface + In-Memory Reference Impl
 *
 * Phase 8 task 64 (§4.3) — first task in the columnar observation
 * storage breakdown. Defines a per-key value store keyed by entity
 * name plus a memory-only reference implementation used by tests
 * and by callers that want columnar semantics without a side-car
 * file.
 *
 * **Why a column store?** The in-memory `KnowledgeGraph` holds every
 * observation string inline on each entity. For graphs with > 10k
 * entities and chatty observation logs, that's tens of MB even when
 * the caller only asked for entity names. A column store breaks
 * observation strings off into a side channel so name/entityType
 * lookups stay cheap.
 *
 * **Generic over value type:** the interface is `IColumnStore<T>` so
 * future phases can reuse it for tags, embeddings, or other
 * per-entity columns without inventing a new contract each time.
 * `ObservationColumn = string[]` is the canonical first user.
 *
 * **No external deps.** Pure TS.
 *
 * @module core/columns/IColumnStore
 * @experimental The `IColumnStore` interface is stable but the
 *   `JsonlColumnStore` wire format (task 65) may grow new sidecar
 *   fields in non-breaking ways. Pre-Phase-8 stores (no sidecar)
 *   stay fully readable via the inline fallback path in
 *   `EntityManager` (tasks 66 + 67).
 */

/**
 * Canonical value type for the observation column. Just `string[]`
 * today; making it a named alias lets us add metadata fields (e.g.
 * per-observation timestamps) in a non-breaking way later.
 */
export type ObservationColumn = string[];

/**
 * Per-entity-name value store. Implementations should treat reads
 * as cheap, sub-millisecond on cached storage. Batch operations
 * collapse multiple writes into a single durable I/O when the
 * backend supports it.
 */
export interface IColumnStore<T> {
  /**
   * Look up the value for `name`. Returns `undefined` when the key
   * is absent — callers fall back to the inline `Entity` field in
   * that case (e.g. pre-migration data).
   */
  get(name: string): Promise<T | undefined>;

  /**
   * Whether a value exists for `name`. Distinguished from
   * `get(name) !== undefined` because a future implementation may
   * support tombstones / explicit empty values.
   */
  has(name: string): Promise<boolean>;

  /**
   * Replace the value for `name`. Idempotent — re-putting the same
   * value is a no-op cost-wise except for a fresh durable write.
   */
  put(name: string, value: T): Promise<void>;

  /**
   * Delete the value for `name`. Returns `true` when something was
   * removed, `false` for an absent key.
   */
  delete(name: string): Promise<boolean>;

  /**
   * Atomically replace values for many names. Backends should
   * collapse this to a single durable I/O when possible (the JSONL
   * backend rewrites its sidecar once; the in-memory backend
   * mutates the Map). On failure the whole batch is rejected — no
   * partial state visible.
   */
  batchPut(entries: ReadonlyArray<{ name: string; value: T }>): Promise<void>;

  /**
   * Iterate every key. Used by migration tooling + diagnostics.
   * Order is implementation-defined.
   */
  keys(): AsyncIterable<string>;

  /** Snapshot of every (name, value) pair. Used for migration. */
  entries(): Promise<Array<{ name: string; value: T }>>;

  /** Total entry count. Cheap for in-memory; may scan for disk-backed. */
  size(): Promise<number>;

  /** Drop every entry. Useful for tests + reset. */
  clear(): Promise<void>;
}

// ==================== In-memory reference impl ====================

/**
 * Map-backed reference implementation. Used by tests + by callers
 * who want column-store semantics without an extra disk file.
 * Production deployments want `JsonlColumnStore` (task 65).
 *
 * @example
 * ```typescript
 * const store = new InMemoryColumnStore<ObservationColumn>();
 * await store.put('alice', ['likes coffee', 'works at TechCo']);
 * const observations = await store.get('alice');
 * ```
 */
export class InMemoryColumnStore<T> implements IColumnStore<T> {
  private readonly data: Map<string, T> = new Map();

  async get(name: string): Promise<T | undefined> {
    return this.data.get(name);
  }

  async has(name: string): Promise<boolean> {
    return this.data.has(name);
  }

  async put(name: string, value: T): Promise<void> {
    this.data.set(name, value);
  }

  async delete(name: string): Promise<boolean> {
    return this.data.delete(name);
  }

  async batchPut(entries: ReadonlyArray<{ name: string; value: T }>): Promise<void> {
    // In-memory backend has no atomicity concern; iterate and set.
    // `JsonlColumnStore` (task 65) overrides this to write the
    // sidecar exactly once for the whole batch.
    for (const entry of entries) {
      this.data.set(entry.name, entry.value);
    }
  }

  async *keys(): AsyncIterable<string> {
    for (const key of this.data.keys()) {
      yield key;
    }
  }

  async entries(): Promise<Array<{ name: string; value: T }>> {
    return [...this.data.entries()].map(([name, value]) => ({ name, value }));
  }

  async size(): Promise<number> {
    return this.data.size;
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}
