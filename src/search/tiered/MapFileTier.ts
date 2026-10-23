/**
 * MapFileTier — shared base of the file-backed index tiers
 *
 * `DiskWarmTier` and `BrotliColdTier` keep their entries in memory and in
 * one file. This base class holds the lock, the lazy load and the operations
 * that both tiers share. A subclass supplies the file access and its own
 * `put`.
 *
 * Each line of the file text holds one `{ "k": key, "v": value }` object. A
 * subclass can store that text in another form, for example compressed.
 *
 * @module search/tiered/MapFileTier
 */

import { Mutex } from 'async-mutex';
import {
  parseJsonlMapLines,
  serializeJsonlMap,
  type JsonlMapFormat,
} from '../../utils/jsonlMapFile.js';
import type { IIndexTier } from './ITieredIndex.js';

/** Line format of the file-backed tiers. */
const TIER_LINE_FORMAT: JsonlMapFormat = { keyField: 'k', valueField: 'v' };

/**
 * Base class of the file-backed tiers.
 *
 * Every operation runs under one lock, because the tier keeps one file.
 * Reads and reloads wait for the lock too, so a failed flush never exposes
 * uncommitted data.
 *
 * @typeParam V - Value type stored in the tier
 */
export abstract class MapFileTier<V> implements IIndexTier<string, V> {
  abstract readonly name: string;

  protected abstract readonly filePath: string;

  /** The loaded entries, or null until the first read or write. */
  protected cache: Map<string, V> | null = null;

  protected readonly mutex = new Mutex();

  /** Returns the text that starts each warning from this tier. */
  protected abstract warnPrefix(): string;

  /** Returns the file text, or null when the file does not exist. */
  protected abstract readContent(): Promise<string | null>;

  /** Replaces the file text with `content`. */
  protected abstract writeContent(content: string): Promise<void>;

  abstract put(key: string, value: V): Promise<void>;

  async get(key: string): Promise<V | undefined> {
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      return cache.get(key);
    });
  }

  async has(key: string): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      return cache.has(key);
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      if (!cache.has(key)) return false;
      const snapshot = new Map(cache);
      cache.delete(key);
      try {
        await this.flush(cache);
      } catch (err) {
        cache.clear();
        for (const [k, v] of snapshot) cache.set(k, v);
        throw err;
      }
      return true;
    });
  }

  async size(): Promise<number> {
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      return cache.size;
    });
  }

  async clear(): Promise<void> {
    return this.mutex.runExclusive(async () => {
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
    });
  }

  /**
   * Drops the in-memory entries. The next read loads the file again, so
   * edits made by another process become visible.
   */
  async reload(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.cache = null;
    });
  }

  /**
   * Returns the entries, loading them from the file on first use.
   * The caller must hold the lock.
   */
  protected async ensureLoaded(): Promise<Map<string, V>> {
    if (this.cache !== null) {
      return this.cache;
    }
    this.cache = await this.loadFromDisk();
    return this.cache;
  }

  /**
   * Writes the entries to the file. The caller must hold the lock.
   *
   * @param cache - Entries to write, in file order
   */
  protected async flush(cache: Map<string, V>): Promise<void> {
    await this.writeContent(serializeJsonlMap(cache, TIER_LINE_FORMAT));
  }

  private async loadFromDisk(): Promise<Map<string, V>> {
    const raw = await this.readContent();
    if (raw === null) {
      return new Map();
    }
    return parseJsonlMapLines<V>(raw, {
      ...TIER_LINE_FORMAT,
      warnPrefix: this.warnPrefix(),
      keyLabel: 'key',
      filePath: this.filePath,
    });
  }
}
