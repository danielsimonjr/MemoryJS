/**
 * ObservableDataModel Adapter
 *
 * Projects a memoryjs knowledge graph into a `Record<string, JSONValue>`
 * shape that satisfies JSON-UI's `ObservableDataModel` interface contract,
 * for use as the external store backing a `DataProvider` in the Neural
 * Computer runtime's Path C integration.
 *
 * NC reads durable state from memoryjs through this adapter and renders
 * that state in JSON-UI's non-input components. The user never writes
 * durable state through `DataProvider.set` — writes flow through the NC
 * orchestrator as LLM-dispatched memoryjs transactions (see NC spec
 * "Ephemeral UI State"). The adapter is therefore **read-only** at the
 * JSON-UI interface boundary: `set()` and `delete()` throw
 * `ReadOnlyMemoryGraphDataError`.
 *
 * @module features/ObservableDataModelAdapter
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import type { Entity, Relation } from '../types/types.js';

/**
 * A JSON round-trippable value. Matches `@json-ui/core`'s `JSONValue` shape
 * exactly; declared inline here to avoid a hard dependency on JSON-UI.
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * Structural match for JSON-UI's `ObservableDataModel` interface from
 * `@json-ui/core`'s `runtime.ts`. Declared locally so the adapter does not
 * import `@json-ui/core` at runtime. Any consumer passing the adapter into
 * `<DataProvider store={adapter} />` gets structural type-compatibility
 * automatically — TypeScript's structural typing matches on method shapes.
 */
export interface ObservableDataModelShape {
  get(path: string): JSONValue | undefined;
  set(path: string, value: JSONValue): void;
  delete(path: string): void;
  snapshot(): Readonly<Record<string, JSONValue>>;
  subscribe(callback: () => void): () => void;
}

/**
 * Thrown by the adapter's `set()` and `delete()` methods. Durable state
 * writes go through memoryjs's own transaction API (`ctx.governanceManager.
 * withTransaction`), not through `DataProvider`. The error message names the
 * alternative so callers know where to route the write.
 */
export class ReadOnlyMemoryGraphDataError extends Error {
  override readonly name = 'ReadOnlyMemoryGraphDataError';
  constructor(operation: 'set' | 'delete', path: string) {
    super(
      `Cannot ${operation}(${JSON.stringify(path)}) on the memoryjs ObservableDataModel adapter. ` +
        'Durable state is read-only at the DataProvider boundary; write through ' +
        'ctx.governanceManager.withTransaction() or ctx.entityManager / ctx.observationManager directly.',
    );
  }
}

/**
 * A projection function that maps a memoryjs graph state (entities +
 * relations) into a flat `Record<string, JSONValue>` view consumable by
 * JSON-UI's `DataProvider`.
 *
 * The projection is application-specific — memoryjs stores entities and
 * relations; what paths the UI needs are decided by the consumer. For
 * example, NC's simplest projection might be
 *
 * ```typescript
 * (entities) => ({
 *   user: entities.find(e => e.entityType === "user") ?? null,
 *   messageCount: entities.filter(e => e.entityType === "message").length,
 * })
 * ```
 *
 * Projections MUST return only `JSONValue`-compatible values — `Date`,
 * `Map`, class instances, functions, etc. will break `DataProvider`'s
 * `useSyncExternalStore` binding because React uses `Object.is` tearing
 * protection and any accidental non-plain-object inside the snapshot
 * will produce spurious re-renders or silent corruption.
 *
 * The projection is called at most once per mutation event — the adapter
 * caches the result and invalidates only when the graph changes. It is
 * NOT called on every `get()` or `snapshot()` call.
 */
export type GraphProjection = (
  entities: ReadonlyArray<Entity>,
  relations: ReadonlyArray<Relation>,
) => Record<string, JSONValue>;

/**
 * Options for `createObservableDataModelFromGraph`.
 */
export interface ObservableDataModelAdapterOptions {
  /** Graph projection function. See `GraphProjection`. */
  projection: GraphProjection;
  /**
   * Logger for adapter-level errors (e.g., projection threw, listener
   * threw). Defaults to `console.error`. Pass a custom logger to route
   * errors into the host runtime's observability pipeline.
   */
  onError?: (err: Error) => void;
}

/**
 * Walk a plain JSON object by a `/`-separated path. Declared locally so the
 * adapter does not import from `@json-ui/core`. Mirrors core's `getByPath`
 * behavior: empty path returns `undefined`, leading slashes are stripped,
 * empty segments are ignored, missing intermediate keys return `undefined`.
 */
function getByPath(
  obj: Record<string, JSONValue>,
  path: string,
): JSONValue | undefined {
  if (!path || path === '/') return undefined;
  const segments = path.split('/').filter((seg) => seg.length > 0);
  if (segments.length === 0) return undefined;
  let cur: JSONValue | undefined = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        return undefined;
      }
      cur = cur[idx];
    } else {
      cur = (cur as Record<string, JSONValue>)[seg];
    }
  }
  return cur;
}

const EMPTY_SNAPSHOT: Readonly<Record<string, JSONValue>> = Object.freeze({});

/**
 * Create an `ObservableDataModel`-compatible adapter that reads its state
 * from a memoryjs `GraphStorage` via a caller-provided `GraphProjection`.
 *
 * The returned object satisfies the structural shape that JSON-UI's
 * `<DataProvider store={...} />` expects in external-store mode.
 *
 * **Async factory.** The factory awaits `storage.loadGraph()` once to warm
 * the storage cache, then returns a synchronous adapter. All subsequent
 * reads come from `storage.cachedGraph` (a sync accessor) — the adapter
 * does not block on I/O after construction.
 *
 * **Read-only.** `set()` and `delete()` throw `ReadOnlyMemoryGraphDataError`
 * because durable state in the Neural Computer architecture is owned by
 * memoryjs transactions, not by the React layer. Route writes through
 * `ctx.governanceManager.withTransaction` or the managers directly.
 *
 * **Event-driven invalidation.** The adapter subscribes to the storage's
 * `GraphEventEmitter` via `onAny` and invalidates its cached snapshot on
 * every mutation event. Because `GraphEventEmitter.emit` is synchronous
 * (a plain `for` loop over listeners), the adapter's subscribers fire
 * synchronously with the mutating call, matching JSON-UI's external-store
 * contract.
 *
 * **Cleanup.** The adapter holds one event-emitter subscription for its
 * lifetime. Call `dispose()` on the returned object to release it when the
 * adapter is no longer needed (e.g., on app teardown).
 *
 * @example
 * ```typescript
 * import { ManagerContext, createObservableDataModelFromGraph } from '@danielsimonjr/memoryjs';
 *
 * const ctx = new ManagerContext('./memory.jsonl');
 *
 * const adapter = await createObservableDataModelFromGraph(ctx.storage, {
 *   projection: (entities) => ({
 *     user: entities.find((e) => e.entityType === 'user') ?? null,
 *     messageCount: entities.filter((e) => e.entityType === 'message').length,
 *   }),
 * });
 *
 * // In the React tree:
 * <DataProvider store={adapter}>{children}</DataProvider>
 * ```
 */
export async function createObservableDataModelFromGraph(
  storage: GraphStorage,
  options: ObservableDataModelAdapterOptions,
): Promise<ObservableDataModelShape & { dispose(): void }> {
  const {
    projection,
    onError = (err) =>
      console.error('[memoryjs ObservableDataModel adapter]', err),
  } = options;

  // Warm the storage cache once so all subsequent reads can be synchronous
  // via `storage.cachedGraph`. Cache stays warm for the lifetime of the
  // storage; this is a one-time cost.
  await storage.loadGraph();

  // Cached snapshot — invalidated (set to null) whenever a graph mutation
  // fires. The first `get`/`snapshot` call after an invalidation rebuilds
  // the projection from the current graph state. This gives identity-
  // stable snapshots between mutations, matching JSON-UI's
  // `useSyncExternalStore` contract (React uses `Object.is(prev, next)`
  // for tearing protection; identical references mean no re-render).
  let cachedSnapshot: Readonly<Record<string, JSONValue>> | null = null;
  let disposed = false;

  // Map<symbol, cb> instead of Set<cb> so that the same callback can be
  // registered multiple times as independent subscriptions — matches the
  // "two independent subscriptions" invariant in JSON-UI core's
  // `createStagingBuffer` / `createObservableDataModel`.
  const listeners = new Map<symbol, () => void>();

  const buildSnapshot = (): Readonly<Record<string, JSONValue>> => {
    if (cachedSnapshot !== null) return cachedSnapshot;
    const graph = storage.cachedGraph;
    if (graph === null) {
      // Cache somehow became cold after the factory warmed it — treat as
      // empty rather than throwing. React will re-read on the next notify.
      cachedSnapshot = EMPTY_SNAPSHOT;
      return cachedSnapshot;
    }
    try {
      const projected = projection(graph.entities, graph.relations);
      // Freeze the top level so consumers cannot mutate the cached
      // snapshot and corrupt the next render pass. Deep-freezing would be
      // expensive; the projection is expected to return plain JSON values
      // and consumers are trusted not to reach into them to mutate.
      cachedSnapshot = Object.freeze(projected);
      return cachedSnapshot;
    } catch (err) {
      onError(err as Error);
      // Fall back to an empty snapshot so React's useSyncExternalStore
      // still gets a valid value. The error listener is the signal that
      // something is wrong; we do NOT want to crash the renderer.
      cachedSnapshot = EMPTY_SNAPSHOT;
      return cachedSnapshot;
    }
  };

  const notifyAll = () => {
    cachedSnapshot = null;
    // Snapshot the listener values so a listener that unsubscribes itself
    // during notification does not mutate the map we are iterating.
    const fire = Array.from(listeners.values());
    for (const cb of fire) {
      try {
        cb();
      } catch (err) {
        // Swallow listener errors — do not let one broken subscriber
        // stop the others. Mirrors the JSON-UI runtime-types spec.
        onError(err as Error);
      }
    }
  };

  // Subscribe to every graph mutation event. `onAny` is synchronous
  // (GraphEventEmitter.emit iterates listeners in a plain for loop), so
  // `notifyAll` fires synchronously with the mutating call. That matches
  // JSON-UI's external-store subscribe contract.
  const unsubscribeFromStorage = storage.events.onAny(() => {
    if (disposed) return;
    notifyAll();
  });

  return {
    get(path: string): JSONValue | undefined {
      if (!path) return undefined;
      const snap = buildSnapshot();
      return getByPath(snap as Record<string, JSONValue>, path);
    },

    set(path: string): void {
      throw new ReadOnlyMemoryGraphDataError('set', path);
    },

    delete(path: string): void {
      throw new ReadOnlyMemoryGraphDataError('delete', path);
    },

    snapshot(): Readonly<Record<string, JSONValue>> {
      return buildSnapshot();
    },

    subscribe(callback: () => void): () => void {
      const key = Symbol('memoryjs-adapter-listener');
      listeners.set(key, callback);
      return () => {
        listeners.delete(key);
      };
    },

    /**
     * Release the underlying graph-event subscription and mark the adapter
     * inert. Subsequent reads return the last-known cached snapshot and
     * no longer invalidate on mutations. Subscribers stop firing.
     *
     * Call this when tearing down the adapter (e.g., app shutdown or hot
     * reload). Not required for normal use — the storage is long-lived
     * and leaking one event subscription is harmless.
     */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeFromStorage();
      listeners.clear();
    },
  };
}
