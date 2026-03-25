/**
 * Ref Index
 *
 * Provides stable alias → entity-name dereferencing with JSONL sidecar persistence.
 * Allows human-readable, stable references to entities that survive entity renames.
 *
 * @module core/RefIndex
 */

import { promises as fs } from 'fs';
import { Mutex } from 'async-mutex';
import { RefConflictError } from '../utils/errors.js';

/**
 * A single registered alias entry.
 */
export interface RefEntry {
  /** The stable alias (e.g. "tool_output_step5") */
  ref: string;
  /** The entity name this alias resolves to */
  entityName: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Optional description */
  description?: string;
}

/**
 * Statistics about the ref index.
 */
export interface RefIndexStats {
  totalRefs: number;
  /** Refs whose entity no longer exists (requires caller to check) */
  orphanedRefs: number;
  lastRebuiltAt: string;
}

/**
 * Maintains the alias → entity-name map with O(1) lookups.
 *
 * Persisted as a JSONL sidecar file. In-memory Map is the source of truth once
 * loaded; reads never hit disk after the first load.
 *
 * Uses async-mutex so concurrent callers do not corrupt the JSONL file.
 *
 * @example
 * ```typescript
 * const index = new RefIndex('/path/to/memory-refs.jsonl');
 * await index.register('step5_output', 'EntityName', 'Tool output from step 5');
 * const entityName = await index.resolve('step5_output'); // 'EntityName'
 * ```
 */
export class RefIndex {
  /** In-memory map: ref → RefEntry */
  private entries: Map<string, RefEntry> = new Map();

  /** Reverse map: entityName → Set<ref> for O(1) reverse lookup */
  private reverseIndex: Map<string, Set<string>> = new Map();

  /** Guards all file I/O and map mutations */
  private mutex = new Mutex();

  /** Whether the index has been loaded from disk */
  private loaded = false;

  /** Timestamp of last load/rebuild */
  private lastRebuiltAt: string = new Date().toISOString();

  constructor(private indexFilePath: string) {}

  // ============================================================
  // PUBLIC API
  // ============================================================

  /**
   * Register a new alias pointing to an entity name.
   *
   * @param ref - Stable alias string
   * @param entityName - Entity name to resolve to
   * @param description - Optional human-readable description
   * @returns The newly created RefEntry
   * @throws {RefConflictError} If the ref is already registered
   */
  async register(ref: string, entityName: string, description?: string): Promise<RefEntry> {
    return this.mutex.runExclusive(async () => {
      await this.ensureLoaded();

      if (this.entries.has(ref)) {
        throw new RefConflictError(ref);
      }

      const entry: RefEntry = {
        ref,
        entityName,
        createdAt: new Date().toISOString(),
        ...(description !== undefined ? { description } : {}),
      };

      // Append to JSONL sidecar BEFORE updating in-memory state so that a
      // disk-write failure leaves the in-memory map consistent (no phantom entry).
      await this.appendEntry(entry);

      this.entries.set(ref, entry);
      this.addToReverseIndex(entityName, ref);

      return entry;
    });
  }

  /**
   * Resolve alias → entity name.
   *
   * @param ref - Alias to look up
   * @returns Entity name, or null if the ref is not registered
   */
  async resolve(ref: string): Promise<string | null> {
    return this.mutex.runExclusive(async () => {
      await this.ensureLoaded();
      return this.entries.get(ref)?.entityName ?? null;
    });
  }

  /**
   * Reverse lookup: entity name → all aliases pointing to it.
   *
   * @param entityName - Entity name to find aliases for
   * @returns Array of ref strings (may be empty)
   */
  async refsForEntity(entityName: string): Promise<string[]> {
    return this.mutex.runExclusive(async () => {
      await this.ensureLoaded();
      const refs = this.reverseIndex.get(entityName);
      return refs ? Array.from(refs) : [];
    });
  }

  /**
   * Remove a single alias. Silent if the ref does not exist.
   *
   * @param ref - Alias to remove
   */
  async deregister(ref: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.ensureLoaded();

      const entry = this.entries.get(ref);
      if (!entry) return;

      this.entries.delete(ref);
      this.removeFromReverseIndex(entry.entityName, ref);

      await this.persistAll();
    });
  }

  /**
   * Remove all aliases pointing to a deleted entity.
   *
   * @param entityName - Entity that was deleted
   * @returns Number of refs removed
   */
  async purgeEntity(entityName: string): Promise<number> {
    return this.mutex.runExclusive(async () => {
      await this.ensureLoaded();

      const refs = this.reverseIndex.get(entityName);
      if (!refs || refs.size === 0) return 0;

      const count = refs.size;
      for (const ref of refs) {
        this.entries.delete(ref);
      }
      this.reverseIndex.delete(entityName);

      await this.persistAll();
      return count;
    });
  }

  /**
   * List all registered refs with optional filtering.
   *
   * @param filter - Optional filter criteria
   * @returns Array of RefEntry objects
   */
  async listRefs(filter?: { entityName?: string }): Promise<RefEntry[]> {
    return this.mutex.runExclusive(async () => {
      await this.ensureLoaded();

      const all = Array.from(this.entries.values());

      if (filter?.entityName !== undefined) {
        return all.filter(e => e.entityName === filter.entityName);
      }

      return all;
    });
  }

  /**
   * Return statistics about the ref index.
   *
   * @param existingEntityNames - Optional set of known entity names to compute orphans.
   *   If omitted, orphanedRefs is reported as 0.
   */
  async stats(existingEntityNames?: Set<string>): Promise<RefIndexStats> {
    return this.mutex.runExclusive(async () => {
      await this.ensureLoaded();

      let orphanedRefs = 0;
      if (existingEntityNames) {
        for (const entry of this.entries.values()) {
          if (!existingEntityNames.has(entry.entityName)) {
            orphanedRefs++;
          }
        }
      }

      return {
        totalRefs: this.entries.size,
        orphanedRefs,
        lastRebuiltAt: this.lastRebuiltAt,
      };
    });
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  /**
   * Load from JSONL sidecar on first access. No-op on subsequent calls.
   * MUST be called inside mutex.runExclusive().
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const data = await fs.readFile(this.indexFilePath, 'utf-8');
      const lines = data.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as RefEntry;
          if (entry.ref && entry.entityName && entry.createdAt) {
            this.entries.set(entry.ref, entry);
            this.addToReverseIndex(entry.entityName, entry.ref);
          }
        } catch {
          // Skip malformed lines (mirrors GraphStorage pattern)
        }
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No sidecar yet — start empty
      } else {
        throw error;
      }
    }

    this.loaded = true;
    this.lastRebuiltAt = new Date().toISOString();
  }

  /**
   * Append a single entry to the JSONL sidecar (fast path).
   * MUST be called inside mutex.runExclusive().
   */
  private async appendEntry(entry: RefEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.indexFilePath, line, 'utf-8');
  }

  /**
   * Rewrite the full JSONL sidecar from the in-memory map.
   * Used after deregister/purge where a full rewrite is needed.
   * MUST be called inside mutex.runExclusive().
   */
  private async persistAll(): Promise<void> {
    const lines = Array.from(this.entries.values())
      .map(entry => JSON.stringify(entry))
      .join('\n');

    await fs.writeFile(this.indexFilePath, lines.length > 0 ? lines + '\n' : '', 'utf-8');
  }

  /**
   * Add a ref to the reverse index for a given entity name.
   */
  private addToReverseIndex(entityName: string, ref: string): void {
    if (!this.reverseIndex.has(entityName)) {
      this.reverseIndex.set(entityName, new Set());
    }
    this.reverseIndex.get(entityName)!.add(ref);
  }

  /**
   * Remove a ref from the reverse index for a given entity name.
   */
  private removeFromReverseIndex(entityName: string, ref: string): void {
    const refs = this.reverseIndex.get(entityName);
    if (refs) {
      refs.delete(ref);
      if (refs.size === 0) {
        this.reverseIndex.delete(entityName);
      }
    }
  }
}
