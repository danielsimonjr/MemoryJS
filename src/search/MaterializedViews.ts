/**
 * Materialized Search Views
 *
 * Pre-computed result sets for repeated filter-based queries. A view is
 * defined by a `SearchFilters` predicate; the manager keeps a cached
 * list of matching entity names per view and invalidates the cache via
 * `GraphEventEmitter` whenever an entity create/update/delete might
 * affect membership.
 *
 * Designed for the workload where the same filter shape is queried many
 * times between writes (a graph dashboard, a per-tag feed, a per-type
 * agent lookup). Not a replacement for fuzzy / semantic search — only
 * the structural-filter shape from `SearchFilters` is supported.
 *
 * @module search/MaterializedViews
 */

import type { GraphEventEmitter } from '../core/GraphEventEmitter.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import type { Entity } from '../types/types.js';
import { SearchFilterChain, type SearchFilters } from './SearchFilterChain.js';

/** A registered view's stable identifier and its filter predicate. */
export interface ViewDefinition {
  /** Stable name — used as the lookup key in `query()` and the invalidation broadcast. */
  name: string;
  /** Filter predicate. Identical to what `SearchFilterChain.applyFilters` accepts. */
  filters: SearchFilters;
}

/** State of a materialised view. */
interface ViewState {
  /** The view definition. */
  def: ViewDefinition;
  /** Entity names matching the filter, sorted by name for deterministic output. */
  members: string[];
  /** Last refresh time (ms since epoch). */
  computedAt: number;
  /** True when the cached list is known stale. */
  dirty: boolean;
}

/** Snapshot returned by `query()`. */
export interface ViewSnapshot {
  name: string;
  members: string[];
  computedAt: number;
  /** Whether `query()` had to recompute on this call (after invalidation). */
  refreshed: boolean;
}

/**
 * Manages a small number of named materialised views over the graph.
 *
 * Views are registered up-front via `register()`. After that, every
 * `query(name)` returns the cached member list — fast O(view size). Any
 * graph-mutation event that COULD change membership marks every view as
 * dirty; the next `query()` recomputes against the live graph.
 *
 * The manager subscribes to `GraphEventEmitter` lazily (on first
 * `register()`) and unsubscribes via `dispose()`. Multiple views share a
 * single subscription.
 */
export class MaterializedViewsManager {
  private views: Map<string, ViewState> = new Map();
  private unsubscribers: Array<() => void> = [];

  constructor(
    private storage: GraphStorage,
    private events: GraphEventEmitter,
  ) {}

  /**
   * Register (or replace) a view definition. The view is computed lazily
   * — the next `query(name)` call materialises members against the
   * current graph.
   */
  register(def: ViewDefinition): void {
    if (this.views.size === 0) this.attachListeners();
    this.views.set(def.name, {
      def,
      members: [],
      computedAt: 0,
      dirty: true,
    });
  }

  /** Drop a view. */
  unregister(name: string): void {
    this.views.delete(name);
    if (this.views.size === 0) this.detachListeners();
  }

  /** Drop every view and detach event listeners. */
  dispose(): void {
    this.views.clear();
    this.detachListeners();
  }

  /** Read-only iterator over registered view definitions. */
  list(): ViewDefinition[] {
    return [...this.views.values()].map((v) => v.def);
  }

  /**
   * Look up a view's members. If the view is dirty (just registered, or
   * a graph mutation invalidated it), recomputes against the current
   * graph and caches the result. Throws if `name` was never registered.
   */
  async query(name: string): Promise<ViewSnapshot> {
    const state = this.views.get(name);
    if (!state) throw new Error(`MaterializedViewsManager: no view named "${name}"`);

    let refreshed = false;
    if (state.dirty) {
      const graph = await this.storage.loadGraph();
      const filtered = SearchFilterChain.applyFilters(graph.entities as Entity[], state.def.filters);
      state.members = filtered.map((e) => e.name).sort();
      state.computedAt = Date.now();
      state.dirty = false;
      refreshed = true;
    }
    return {
      name: state.def.name,
      members: [...state.members],
      computedAt: state.computedAt,
      refreshed,
    };
  }

  /**
   * Force every view to be marked dirty. Useful in tests that rebuild
   * the graph and want a fresh recomputation on the next query.
   */
  invalidateAll(): void {
    for (const state of this.views.values()) state.dirty = true;
  }

  /** Snapshot of internal state for diagnostics. */
  snapshot(): Array<{ name: string; size: number; dirty: boolean; computedAt: number }> {
    return [...this.views.values()].map((v) => ({
      name: v.def.name,
      size: v.members.length,
      dirty: v.dirty,
      computedAt: v.computedAt,
    }));
  }

  /**
   * Subscribe to entity-mutation events. Any event marks every view as
   * dirty — finer-grained invalidation (per-view filter predicate
   * checks) is a possible follow-up but not in scope yet.
   */
  private attachListeners(): void {
    if (this.unsubscribers.length > 0) return;
    const markDirty = (): void => {
      for (const state of this.views.values()) state.dirty = true;
    };
    this.unsubscribers.push(this.events.on('entity:created', markDirty));
    this.unsubscribers.push(this.events.on('entity:updated', markDirty));
    this.unsubscribers.push(this.events.on('entity:deleted', markDirty));
  }

  private detachListeners(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }
}
