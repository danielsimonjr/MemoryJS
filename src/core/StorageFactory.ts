/**
 * Storage Factory
 *
 * Factory for creating IGraphStorage implementations.
 * Supports different storage backends based on configuration.
 *
 * Supported storage types:
 * - 'jsonl': JSONL file-based storage (default) - simple, human-readable
 * - 'sqlite': SQLite database storage (better-sqlite3 native) - indexed, ACID transactions, FTS5
 *
 * @module core/StorageFactory
 */

import { GraphStorage } from './GraphStorage.js';
import { SQLiteStorage } from './SQLiteStorage.js';
import type { IGraphStorage, StorageConfig } from '../types/index.js';

/**
 * Default storage type when not specified.
 */
const DEFAULT_STORAGE_TYPE = 'jsonl';

/**
 * Create a storage instance based on configuration.
 *
 * Uses environment variable MEMORY_STORAGE_TYPE to override default.
 *
 * @param config - Storage configuration
 * @returns IGraphStorage implementation
 * @throws Error if storage type is not supported
 *
 * @example
 * ```typescript
 * // Create default JSONL storage
 * const storage = createStorage({ type: 'jsonl', path: './memory.jsonl' });
 *
 * // Create SQLite storage
 * const storage = createStorage({ type: 'sqlite', path: './memory.db' });
 *
 * // Or use path-only shorthand (uses MEMORY_STORAGE_TYPE env var or defaults to jsonl)
 * const storage = createStorageFromPath('./memory.jsonl');
 * ```
 */
export function createStorage(config: StorageConfig): IGraphStorage {
  // Allow environment override
  const storageType = process.env.MEMORY_STORAGE_TYPE || config.type || DEFAULT_STORAGE_TYPE;

  switch (storageType) {
    case 'jsonl':
      return new GraphStorage(config.path);

    case 'sqlite':
      return new SQLiteStorage(config.path);

    default:
      throw new Error(
        `Unknown storage type: ${storageType}. ` +
        `Supported types: jsonl, sqlite`
      );
  }
}

/**
 * Create a storage instance from a file path.
 *
 * Uses default storage type (jsonl) or MEMORY_STORAGE_TYPE env var.
 *
 * @param path - Path to storage file
 * @returns IGraphStorage implementation
 */
export function createStorageFromPath(path: string): IGraphStorage {
  const storageType = (process.env.MEMORY_STORAGE_TYPE as 'jsonl' | 'sqlite') || DEFAULT_STORAGE_TYPE;
  return createStorage({ type: storageType, path });
}
