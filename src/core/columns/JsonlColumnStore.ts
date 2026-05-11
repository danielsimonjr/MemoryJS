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
import { randomBytes } from 'crypto';
import { logger } from '../../utils/logger.js';
import type { IColumnStore } from './IColumnStore.js';

interface SidecarLine<T> {
  name: string;
  value: T;
}

/**
 * Durable JSONL-backed column store.
 *
 * Assumes a single writer at a time — concurrent mutations from
 * separate processes against the same sidecar path will produce
 * lost writes. In-process callers are fine because every mutation
 * is awaited end-to-end.
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
  }

  async delete(name: string): Promise<boolean> {
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
  }

  async batchPut(entries: ReadonlyArray<{ name: string; value: T }>): Promise<void> {
    const cache = await this.ensureLoaded();
    if (entries.length === 0) return;
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
    this.cache = null;
  }

  private async ensureLoaded(): Promise<Map<string, T>> {
    if (this.cache !== null) {
      return this.cache;
    }
    this.cache = await this.loadFromDisk();
    return this.cache;
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
    await this.durableWriteFile(content);
  }

  private async durableWriteFile(content: string): Promise<void> {
    const tmpPath = `${this.sidecarPath}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
    const fd = await fs.open(tmpPath, 'w');
    try {
      await fd.write(content);
      await fd.sync();
    } finally {
      await fd.close();
    }
    try {
      await fs.rename(tmpPath, this.sidecarPath);
    } catch {
      const fallbackFd = await fs.open(this.sidecarPath, 'w');
      try {
        await fallbackFd.write(content);
        await fallbackFd.sync();
      } finally {
        await fallbackFd.close();
      }
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    }
  }
}
