/**
 * StorageInfraFacade
 *
 * Owns the env-gated optional storage infrastructure that `ManagerContext`
 * used to hold inline: the observation column store, the tiered posting-list
 * index, the compressed entity cache, and the Bloom pre-screener with its
 * event subscriptions.
 *
 * Every member is lazy and resolved at most once. Env flags are read on the
 * first access of each member, matching the pre-extraction behaviour. Nothing
 * is constructed by `peek*` or by the constructor.
 *
 * @module core/context/StorageInfraFacade
 * @internal
 */

import { TieredIndex, buildTieredIndex } from '../../search/tiered/TieredIndex.js';
import { LRUHotTier } from '../../search/tiered/LRUHotTier.js';
import { DiskWarmTier } from '../../search/tiered/DiskWarmTier.js';
import { BrotliColdTier } from '../../search/tiered/BrotliColdTier.js';
import { CompressedMap } from '../../utils/compression/CompressedMap.js';
import { ZlibCompressionAdapter } from '../../utils/compression/ICompressionAdapter.js';
import { BloomPreScreener } from '../../search/BloomPreScreener.js';
import { JsonlColumnStore } from '../columns/JsonlColumnStore.js';
import type { IColumnStore, ObservationColumn } from '../columns/IColumnStore.js';
import type { GraphStorage } from '../GraphStorage.js';
import type { CachePressureCoordinator } from '../../utils/CachePressureCoordinator.js';
import type { Entity } from '../../types/index.js';
import { readEnvStrictFlag } from '../../utils/envConfig.js';
import { sidecarPath } from '../../utils/sidecarPath.js';

/** Storage events that invalidate the Bloom pre-screener. */
const BLOOM_INVALIDATING_EVENTS = [
  'entity:created',
  'entity:updated',
  'entity:deleted',
  'entity:renamed',
  'graph:saved',
] as const;

/** Constructor dependencies for {@link StorageInfraFacade}. */
export interface StorageInfraDeps {
  /** Storage whose file path and event emitter the sidecars derive from. */
  storage: GraphStorage;
  /** Shared cache-pressure coordinator (compressed cache registers with it). */
  cachePressure: CachePressureCoordinator;
  /** Absolute path of the observation column sidecar. */
  columnStorePath: string;
  /**
   * Invoked once when the Bloom pre-screener is constructed, so the owner can
   * attach it to an already-built search manager.
   */
  onBloomScreenerReady?: (screener: BloomPreScreener) => void;
}

/**
 * Lazy, env-gated storage infrastructure. See the module doc for the
 * resolution rules.
 *
 * @internal
 */
export class StorageInfraFacade {
  private readonly storage: GraphStorage;
  private readonly cachePressure: CachePressureCoordinator;
  private readonly columnStorePath: string;
  private readonly onBloomScreenerReady?: (screener: BloomPreScreener) => void;

  /** `undefined` = unresolved, `null` = env-gated off. */
  private _observationColumnStore: IColumnStore<ObservationColumn> | null | undefined;
  /** `undefined` = unresolved, `null` = env-gated off. */
  private _tieredPostingsIndex: TieredIndex<unknown> | null | undefined;
  /** `undefined` = unresolved, `null` = env-gated off. */
  private _compressedEntityCache: CompressedMap<string, Entity> | null | undefined;
  /** `undefined` = unresolved, `null` = env-gated off. */
  private _bloomPreScreener: BloomPreScreener | null | undefined;
  private _bloomPreScreenerUnsubscribe: Array<() => void> = [];

  constructor(deps: StorageInfraDeps) {
    this.storage = deps.storage;
    this.cachePressure = deps.cachePressure;
    this.columnStorePath = deps.columnStorePath;
    this.onBloomScreenerReady = deps.onBloomScreenerReady;
  }

  /**
   * Lazy `IColumnStore<ObservationColumn>` for the shadow observation
   * column. Returns `null` when `MEMORY_OBSERVATIONS_COLUMNAR` is
   * unset / `false` / any other value. Strict literal-match on
   * `'true'` keeps the activation gate predictable (no `'yes'` /
   * `'1'` / `'TRUE'` surprises). The sidecar lives at
   * `<basename>-observations.jsonl` next to the main storage file.
   *
   * **Read once, cached for the life of the ManagerContext.** The
   * env-var value is read on first access and the resolved column
   * store (or `null`) is cached. Flipping
   * `MEMORY_OBSERVATIONS_COLUMNAR` at runtime has no effect after
   * the first access — restart the process. Matches the precedent
   * set by Phase 7's `MEMORY_STORAGE_SEGMENT_COUNT` on
   * `GraphStorage`. If runtime reconfiguration becomes a
   * requirement, expose a `setObservationColumnStore` method on
   * `ManagerContext` rather than reading the env on every call.
   *
   * @experimental Phase 8 — call signature stable; the underlying
   *   sidecar format may grow new fields in non-breaking ways.
   */
  get observationColumnStore(): IColumnStore<ObservationColumn> | null {
    if (this._observationColumnStore === undefined) {
      this._observationColumnStore = readEnvStrictFlag('MEMORY_OBSERVATIONS_COLUMNAR')
        ? new JsonlColumnStore<ObservationColumn>(this.columnStorePath)
        : null;
    }
    return this._observationColumnStore;
  }

  /**
   * Lazy `ITieredIndex<string, unknown>` building block for callers
   * who want hot/warm/cold posting-list caching. Returns `null` when
   * `MEMORY_TIERED_INDEX` is not exactly `'true'` (strict literal
   * match — `'1'` / `'yes'` / `'TRUE'` decline, matching the
   * `MEMORY_OBSERVATIONS_COLUMNAR` precedent).
   *
   * **Wiring**: a `LRUHotTier` (10k entries default) → `DiskWarmTier`
   * (sidecar at `<basename>-tiered-warm.jsonl`) → `BrotliColdTier`
   * (shard at `<basename>-tiered-cold.jsonl.br`) chain. Use
   * `tieredPostingsIndex.stats()` for hit-rate diagnostics; the
   * tier-stats roll up into `ctx.diagnostics()`.
   *
   * **Direct integration with `OptimizedInvertedIndex` is intentionally
   * deferred** — the existing class uses tightly-coupled `Uint32Array`
   * posting layouts that don't map cleanly onto an `ITieredIndex<V>`.
   * Callers who want the cache today can compose it themselves on top
   * of any string-keyed corpus; a follow-up phase will retrofit
   * `OptimizedInvertedIndex` to consume the tiered backing.
   *
   * Read once at first access — restart the process to flip the env
   * var. Matches `observationColumnStore` precedent.
   *
   * Phase 9 tasks 73 + 74.
   *
   * @internal Until `OptimizedInvertedIndex` (or another concrete
   *   index implementation) actually consumes this property, the
   *   typing `TieredIndex<unknown>` is loose and the property has
   *   no in-tree caller. Marked `@internal` per Phase 9 review #5
   *   so external adopters don't lock themselves to a surface that
   *   may grow stricter generics once a concrete consumer lands.
   *   The `@experimental` notes still apply: tier sizing defaults
   *   and the `stats()` shape may change in non-breaking ways.
   */
  get tieredPostingsIndex(): TieredIndex<unknown> | null {
    if (this._tieredPostingsIndex === undefined) {
      if (!readEnvStrictFlag('MEMORY_TIERED_INDEX')) {
        this._tieredPostingsIndex = null;
        return null;
      }
      const filePath = this.storage.getFilePath();
      const warmPath = sidecarPath(filePath, '-tiered-warm', '.jsonl');
      const coldPath = sidecarPath(filePath, '-tiered-cold', '.jsonl.br');
      this._tieredPostingsIndex = buildTieredIndex<unknown>({
        makeHot: (onEvict) => new LRUHotTier({ maxEntries: 10_000, onEvict, name: 'hot' }),
        makeWarm: (onEvict) => new DiskWarmTier({ filePath: warmPath, maxEntries: 100_000, onEvict, name: 'warm' }),
        makeCold: () => new BrotliColdTier({ filePath: coldPath, name: 'cold' }),
      });
    }
    return this._tieredPostingsIndex;
  }

  /**
   * Lazy `CompressedMap<string, Entity>` for callers who want to
   * hold a large entity set in RAM at a fraction of the uncompressed
   * cost. Activated by `MEMORY_CACHE_COMPRESS='true'` (strict
   * literal-match — matches `MEMORY_OBSERVATIONS_COLUMNAR` and
   * `MEMORY_TIERED_INDEX` precedents).
   *
   * **Default configuration:** hot threshold 1000 entries
   * (uncompressed working set), Zlib adapter at level 6 (best
   * compress-speed/ratio trade-off per Phase 10 task 77 benchmark).
   * Brotli is the right pick for cold-storage shards; zlib for hot
   * caches like this one.
   *
   * **Direct integration with `GraphStorage.cache` is intentionally
   * deferred** — the existing cache holds a `KnowledgeGraph`
   * snapshot, not per-entity entries, so swapping in a
   * `CompressedMap` would require restructuring every read/write
   * path. Callers who want compressed entity caching today can
   * compose this property over the storage layer themselves; the
   * follow-up phase that rewires `GraphStorage` to entity-level
   * caching will pick this up.
   *
   * Phase 10 task 79.
   *
   * @internal Until `GraphStorage.cache` is restructured to use
   *   per-entity caching, the property has no in-tree consumer.
   *   Marked `@internal` per Phase 9 precedent so external adopters
   *   don't lock themselves to a surface that may grow stricter
   *   typing once a concrete consumer lands.
   */
  get compressedEntityCache(): CompressedMap<string, Entity> | null {
    if (this._compressedEntityCache === undefined) {
      if (!readEnvStrictFlag('MEMORY_CACHE_COMPRESS')) {
        this._compressedEntityCache = null;
        return null;
      }
      const pressure = this.cachePressure.enabled ? this.cachePressure : undefined;
      const compressed = new CompressedMap<string, Entity>({
        hotThreshold: 1000,
        adapter: new ZlibCompressionAdapter(6),
        onInsert: () => pressure?.evictIfOverBudget(),
      });
      this._compressedEntityCache = compressed;
      pressure?.register({
        name: 'compressed-entities',
        currentEntries: () => compressed.currentEntries(),
        evictTo: (target) => compressed.evictTo(target),
      });
    }
    return this._compressedEntityCache;
  }

  /**
   * Opt-in `BloomPreScreener` for fuzzy search candidate pre-screening.
   *
   * Enabled only when `MEMORY_FUZZY_BLOOM_PRESCREEN` is the strict literal
   * `'true'` (read once, at first access). When disabled the getter returns
   * `null` and nothing is constructed. When enabled it is attached to
   * `searchManager.fuzzySearcher`; every entity write clears it and the next
   * fuzzy search rebuilds it from the current graph.
   *
   * @experimental
   */
  get bloomPreScreener(): BloomPreScreener | null {
    if (this._bloomPreScreener === undefined) {
      if (!readEnvStrictFlag('MEMORY_FUZZY_BLOOM_PRESCREEN')) {
        this._bloomPreScreener = null;
        return null;
      }
      const screener = new BloomPreScreener(this.storage);
      const events = this.storage.events;
      if (events) {
        const clear = (): void => screener.clear();
        for (const type of BLOOM_INVALIDATING_EVENTS) {
          this._bloomPreScreenerUnsubscribe.push(events.on(type, clear));
        }
      }
      this._bloomPreScreener = screener;
      this.onBloomScreenerReady?.(screener);
    }
    return this._bloomPreScreener;
  }

  /**
   * Side-effect-free read of the tiered index for diagnostics. Returns the
   * cached instance, or null when unresolved or disabled. Never constructs.
   */
  peekTieredPostingsIndex(): TieredIndex<unknown> | null {
    return this._tieredPostingsIndex ?? null;
  }

  /**
   * Side-effect-free read of the Bloom pre-screener. Returns the cached
   * instance, or null when unresolved or disabled. Never constructs.
   */
  peekBloomPreScreener(): BloomPreScreener | null {
    return this._bloomPreScreener ?? null;
  }

  /**
   * Detach the Bloom pre-screener's event listeners and forget the instance,
   * so the next access re-resolves it. Does not close the storage. The caller
   * is responsible for detaching the screener from any search manager first.
   */
  close(): void {
    for (const unsubscribe of this._bloomPreScreenerUnsubscribe) unsubscribe();
    this._bloomPreScreenerUnsubscribe = [];
    this._bloomPreScreener = undefined;
  }
}
