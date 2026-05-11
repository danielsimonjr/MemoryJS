/**
 * Lazy Entity Hydration (`EntityProxy`)
 *
 * Phase 6 step 36 (§3.2) — closes the deferral by shipping the
 * proxy-based deferred-load pattern for entities. An `EntityProxy`
 * captures an entity name and looks up the full record only when a
 * field is actually accessed; bulk graph operations that touch only
 * `name` / `entityType` (sort, filter, head/tail) skip the full
 * `observations[]` deserialization until they need it.
 *
 * **Why this matters:** the in-memory `KnowledgeGraph` holds every
 * observation string of every entity. For graphs with > 10k entities
 * and chatty observation logs, that's tens of MB even when the
 * caller only wanted entity names. `EntityProxy` is the opt-in
 * escape hatch — `EntityProxyFactory.list()` returns proxies that
 * each read-through to a single `getEntityByName()` on demand and
 * cache the result locally.
 *
 * **No external deps.** Uses the existing `IGraphStorage.getEntityByName`
 * fast path on both the JSONL and SQLite backends.
 *
 * @module core/EntityProxy
 * @experimental Field-access surface (which fields trigger
 *   hydration) may evolve in non-breaking ways as the `Entity`
 *   shape grows. `metadata` is fully eager today.
 */

import type { Entity } from '../types/types.js';

/** Minimal storage shape `EntityProxy` needs. Matches `IGraphStorage`. */
export interface EntityProxyStorage {
  getEntityByName(name: string): Entity | undefined;
}

/**
 * Lazy snapshot of an entity. `name` and `entityType` are eager
 * (cheap and frequently needed for sort/filter). All other fields
 * trigger a single `getEntityByName()` on first access, with the
 * result cached for the lifetime of the proxy.
 *
 * @example
 * ```typescript
 * const proxy = new EntityProxy('alice', 'person', storage);
 * console.log(proxy.name);          // eager, no read
 * console.log(proxy.observations);  // hydrates, caches, returns
 * console.log(proxy.observations);  // cached, no read
 * ```
 */
export class EntityProxy {
  private cached: Entity | undefined;
  /** True after `hydrate()` ran successfully (including hits with `undefined` entity). */
  private hydrated = false;

  constructor(
    public readonly name: string,
    public readonly entityType: string,
    private readonly storage: EntityProxyStorage,
  ) {}

  /**
   * Force the read-through. Subsequent field accesses are served
   * from the cache. Returns the loaded entity, or `undefined` if the
   * backing record vanished between proxy creation and hydration.
   */
  hydrate(): Entity | undefined {
    if (!this.hydrated) {
      this.cached = this.storage.getEntityByName(this.name);
      this.hydrated = true;
    }
    return this.cached;
  }

  /** Force a re-read on next access. Useful after a known write. */
  invalidate(): void {
    this.hydrated = false;
    this.cached = undefined;
  }

  /**
   * Pre-populate the cache with an already-loaded entity. Lets a
   * factory that just performed `getEntityByName()` avoid the second
   * read that `hydrate()` would otherwise trigger.
   */
  seed(entity: Entity | undefined): void {
    this.cached = entity;
    this.hydrated = true;
  }

  /** Whether the proxy has loaded its backing entity yet. */
  isHydrated(): boolean {
    return this.hydrated;
  }

  // ==================== Lazy accessors ====================

  get observations(): readonly string[] {
    const e = this.hydrate();
    return e?.observations ?? [];
  }

  get tags(): readonly string[] | undefined {
    return this.hydrate()?.tags;
  }

  get importance(): number | undefined {
    return this.hydrate()?.importance;
  }

  get parentId(): string | undefined {
    return this.hydrate()?.parentId;
  }

  get createdAt(): string | undefined {
    return this.hydrate()?.createdAt;
  }

  get lastModified(): string | undefined {
    return this.hydrate()?.lastModified;
  }

  /**
   * Snapshot the proxy as a plain `Entity`. Forces hydration. When
   * the backing record vanished, returns a minimal entity built from
   * the cached `name` + `entityType` and an empty `observations`
   * array — matches the contract of `getEntityByName()` callers that
   * already do `?? defaultEntity` themselves.
   */
  toEntity(): Entity {
    const loaded = this.hydrate();
    return (
      loaded ?? {
        name: this.name,
        entityType: this.entityType,
        observations: [],
      }
    );
  }
}

/**
 * Builds `EntityProxy` collections from a storage layer. Used by
 * callers who want to iterate a large entity list while paying the
 * full deserialization cost only for entities they actually inspect.
 *
 * @example
 * ```typescript
 * const factory = new EntityProxyFactory(storage);
 * const proxies = factory.fromIndex(['alice', 'bob', 'carol']);
 * const persons = proxies.filter((p) => p.entityType === 'person');
 * // `observations` only loaded for the kept entries:
 * for (const p of persons) console.log(p.observations);
 * ```
 */
export class EntityProxyFactory {
  constructor(private readonly storage: EntityProxyStorage) {}

  /**
   * Build a proxy from a `(name, entityType)` pair without hitting
   * storage. Callers typically get these pairs from a lightweight
   * index (NameIndex, FTS5 row preview, etc.) rather than from a
   * full `loadGraph()`.
   */
  fromPair(name: string, entityType: string): EntityProxy {
    return new EntityProxy(name, entityType, this.storage);
  }

  /**
   * Build proxies for a known list of `(name, entityType)` pairs.
   * Does not touch storage — caller-supplied entityType is trusted.
   */
  fromIndex(pairs: ReadonlyArray<{ name: string; entityType: string }>): EntityProxy[] {
    return pairs.map((p) => new EntityProxy(p.name, p.entityType, this.storage));
  }

  /**
   * Build a proxy from just a name. This *does* touch storage once
   * (to discover the entityType) — strictly less efficient than
   * `fromPair` when the caller already knows the type. Returns
   * `undefined` when the entity doesn't exist.
   */
  fromName(name: string): EntityProxy | undefined {
    const entity = this.storage.getEntityByName(name);
    if (!entity) return undefined;
    const proxy = new EntityProxy(name, entity.entityType, this.storage);
    // Seed with the already-loaded record so subsequent accesses
    // don't re-hit storage. Using `hydrate()` here would do a
    // redundant second read.
    proxy.seed(entity);
    return proxy;
  }
}
