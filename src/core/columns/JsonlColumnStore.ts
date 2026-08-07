/**
 * JsonlColumnStore — JSONL-sidecar-backed `IColumnStore<T>`
 *
 * Phase 8 task 65 (§4.3) — durable on-disk implementation of
 * `IColumnStore`. Persists every (name, value) pair as a single
 * line in a sidecar JSONL file. The whole sidecar is rewritten on
 * every mutation via temp-file + fsync + rename — same pattern as
 * `GraphStorage.durableWriteFile`. This trades write efficiency
 * for correctness; a future task may add per-entry append + periodic
 * compaction once profiling shows it's worth the complexity.
 *
 * Wire format (one JSON object per line):
 *
 * ```jsonl
 * {"name":"alice","value":["likes coffee","works at TechCo"]}
 * {"name":"bob","value":["plays chess"]}
 * ```
 *
 * `value` is `T` JSON-encoded — the canonical first user is
 * `ObservationColumn = string[]` but the class is generic over T.
 *
 * @module core/columns/JsonlColumnStore
 * @experimental Wire format may grow new optional sidecar fields
 *   (e.g. per-entry timestamps) in non-breaking ways. Existing
 *   sidecars stay readable. Single-writer only — concurrent
 *   processes are not supported in this first pass.
 */

import { promises as fs } from 'fs';
import { Mutex } from 'async-mutex';
import { logger } from '../../utils/logger.js';
import { durableWriteFile } from '../../utils/durableWriteFile.js';
import type { IColumnStore } from './IColumnStore.js';

interface SidecarLine<T> {
  name: string;
  value: T;
}

/**
 * Durable JSONL-backed column store.
 *
 * Concurrent mutations from separate PROCESSES against the same sidecar
 * path will still produce lost writes — that remains out of scope.
 *
 * In-process concurrency IS handled, via `async-mutex`, following the same
 * pattern as `RefIndex`. It previously was not, and the class documented
 * the opposite: "in-process callers are fine because every mutation is
 * awaited end-to-end". That was false for this codebase's own primary
 * caller. `ObservationManager` mirrors writes from SYNCHRONOUS event
 * listeners that fire `void shadowWriteColumn(...)`, so several
 * read-modify-write cycles overlap. Because `flush` rewrites the WHOLE
 * sidecar from an in-memory Map, two overlapping `put`s each loaded their
 * own Map and the later flush erased the earlier entity outright.
 * Measured: creating three entities in one bulk save left exactly one in
 * the sidecar, silently.
 *
 * @example
 * ```typescript
 * const store = new JsonlColumnStore<ObservationColumn>('./memory.observations.jsonl');
 * await store.put('alice', ['likes coffee']);
 * const obs = await store.get('alice'); // ['likes coffee']
 * ```
 */
export class JsonlColumnStore<T> implements IColumnStore<T> {
  private cache: Map<string, T> | null = null;

  /**
   * Serialises read-modify-write cycles. `flush` rewrites the entire sidecar from
   * the in-memory Map, so two overlapping mutations lose data even when they touch
   * different keys. Same reason `RefIndex` holds one.
   */
  private readonly mutex = new Mutex();

  /**
   * The IN-FLIGHT load, not just the finished one. Without this, two concurrent
   * callers both see `cache === null`, both call `loadFromDisk`, and each gets its
   * OWN Map — after which their flushes overwrite each other wholesale.
   */
  private loadPromise: Promise<Map<string, T>> | null = null;

  /**
   * Bumped by `reload()`. An in-flight load carries the generation it started in and
   * only publishes its Map if that generation is still current — otherwise a load
   * already running when `reload()` is called would resolve afterwards and reinstate
   * exactly the stale snapshot the caller asked to discard.
   */
  private generation = 0;

  constructor(private readonly sidecarPath: string) {}

  async get(name: string): Promise<T | undefined> {
    const cache = await this.ensureLoaded();
    return cache.get(name);
  }

  async has(name: string): Promise<boolean> {
    const cache = await this.ensureLoaded();
    return cache.has(name);
  }

  async put(name: string, value: T): Promise<void> {
    // Locked end-to-end: load, mutate and flush must not interleave with another
    // mutation, or the later flush writes a Map that never saw the earlier change.
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      // Snapshot prior state so we can roll the cache back if the disk
      // flush fails — without this, the in-memory cache would be the
      // new value while disk holds the old one, and a process restart
      // (which re-reads disk) loses the write silently. Restores the
      // `IColumnStore.batchPut` JSDoc's atomicity promise.
      const hadPrior = cache.has(name);
      const priorValue = hadPrior ? cache.get(name)! : undefined;
      cache.set(name, value);
      try {
        await this.flush(cache);
      } catch (err) {
        if (hadPrior) cache.set(name, priorValue!);
        else cache.delete(name);
        throw err;
      }
    });
  }

  async delete(name: string): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      if (!cache.has(name)) return false;
      const priorValue = cache.get(name)!;
      cache.delete(name);
      try {
        await this.flush(cache);
      } catch (err) {
        cache.set(name, priorValue);
        throw err;
      }
      return true;
    });
  }

  async batchPut(entries: ReadonlyArray<{ name: string; value: T }>): Promise<void> {
    if (entries.length === 0) return;
    // Locked like put/delete: an unserialised batch interleaving with a single put
    // loses whichever flush lands first, and a batch loses proportionally more.
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      // Snapshot the whole map so a flush failure restores every key
      // we touched. Matches the "atomic batch" contract.
      const priorSnapshot = new Map(cache);
      for (const entry of entries) {
        cache.set(entry.name, entry.value);
      }
      try {
        await this.flush(cache);
      } catch (err) {
        cache.clear();
        for (const [k, v] of priorSnapshot) cache.set(k, v);
        throw err;
      }
    });
  }

  async *keys(): AsyncIterable<string> {
    const cache = await this.ensureLoaded();
    for (const key of cache.keys()) {
      yield key;
    }
  }

  async entries(): Promise<Array<{ name: string; value: T }>> {
    const cache = await this.ensureLoaded();
    return [...cache.entries()].map(([name, value]) => ({ name, value }));
  }

  async size(): Promise<number> {
    const cache = await this.ensureLoaded();
    return cache.size;
  }

  async clear(): Promise<void> {
    const cache = await this.ensureLoaded();
    if (cache.size === 0) return;
    const priorSnapshot = new Map(cache);
    cache.clear();
    try {
      await this.flush(cache);
    } catch (err) {
      for (const [k, v] of priorSnapshot) cache.set(k, v);
      throw err;
    }
  }

  /**
   * Drop the in-memory cache so the next read pulls from disk. Used
   * by callers that know an external process (the migration tool, a
   * hand-edit) modified the sidecar while we held a stale snapshot.
   * Cheap — the next `ensureLoaded` re-parses the sidecar lazily.
   *
   * Phase 8 review fix (#4).
   */
  async reload(): Promise<void> {
    // Bump first: any load already in flight will see a changed generation and
    // decline to publish its now-stale snapshot.
    this.generation++;
    this.cache = null;
    this.loadPromise = null;
  }

  private async ensureLoaded(): Promise<Map<string, T>> {
    if (this.cache !== null) {
      return this.cache;
    }
    // Memoise the in-flight promise, not just the resolved value. The `await` below
    // is a suspension point: without this, two concurrent callers both observe
    // `cache === null` and each ends up with a DIFFERENT Map, after which their
    // whole-file flushes silently erase one another.
    if (this.loadPromise === null) {
      const startedIn = this.generation;
      this.loadPromise = this.loadFromDisk()
        .then((map) => {
          // Only publish if no reload() intervened while we were reading.
          if (this.generation === startedIn) this.cache = map;
          return map;
        })
        .finally(() => {
          this.loadPromise = null;
        });
    }
    return this.loadPromise;
  }

  private async loadFromDisk(): Promise<Map<string, T>> {
    const map = new Map<string, T>();
    let raw: string;
    try {
      raw = await fs.readFile(this.sidecarPath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return map;
      }
      throw error;
    }
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed = JSON.parse(trimmed) as SidecarLine<T>;
        if (typeof parsed.name !== 'string') {
          logger.warn(`JsonlColumnStore: skipping line with non-string name in ${this.sidecarPath}`);
          continue;
        }
        map.set(parsed.name, parsed.value);
      } catch {
        logger.warn(`JsonlColumnStore: skipping malformed line in ${this.sidecarPath}`);
      }
    }
    return map;
  }

  private async flush(cache: Map<string, T>): Promise<void> {
    const lines: string[] = [];
    for (const [name, value] of cache) {
      lines.push(JSON.stringify({ name, value }));
    }
    const content = lines.length === 0 ? '' : lines.join('\n') + '\n';
    await durableWriteFile(this.sidecarPath, content);
  }
}
