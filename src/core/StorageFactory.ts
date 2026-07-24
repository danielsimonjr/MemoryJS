/**
 * Storage Factory
 *
 * Factory for creating IGraphStorage implementations.
 * Supports different storage backends based on configuration.
 *
 * Supported storage types:
 * - 'jsonl': JSONL file-based storage (default) - simple, human-readable
 * - 'sqlite': SQLite database storage (better-sqlite3 native) - indexed, ACID transactions, FTS5
 * - 'postgres' / 'postgresql': PostgreSQL backend - JSONB, GIN indexes,
 *     optional peer dep on `pg`
 *
 * S9 (load-graph optimization): this module deliberately has NO static import
 * of `SQLiteStorage`, so importing the factory alone never evaluates the
 * SQLiteStorage module (whose static `better-sqlite3` import loads the native
 * addon). The SQLiteStorage constructor is delivered through a small registry:
 *
 * - `src/core/sqlite-register.ts` performs the registration as a module side
 *   effect. It is imported by the core barrel, by `ManagerContext`, and by the
 *   `./sqlite` subpath entry, so every supported Node import path has the
 *   constructor registered before `createStorage` can run.
 * - Bundlers honouring `"sideEffects": false` may tree-shake that side effect
 *   away when nothing sqlite-related is imported; such consumers get a
 *   descriptive error steering them to `preloadSQLiteStorage()` (a used call,
 *   never shaken) or an explicit `SQLiteStorage` import.
 *
 * @module core/StorageFactory
 */

import { GraphStorage } from './GraphStorage.js';
import { PostgreSQLStorage } from './PostgreSQLStorage.js';
import type { IGraphStorage, StorageConfig } from '../types/index.js';

/**
 * Default storage type when not specified.
 */
const DEFAULT_STORAGE_TYPE = 'jsonl';

/**
 * Constructor shape of `SQLiteStorage` as consumed by the factory.
 */
type SQLiteStorageConstructor = new (path: string) => IGraphStorage;

/**
 * Registered SQLiteStorage constructor (set by `registerSQLiteStorage`).
 */
let sqliteStorageCtor: SQLiteStorageConstructor | undefined;

/**
 * Register the SQLiteStorage constructor used for `type: 'sqlite'`.
 *
 * Called as a module side effect by `src/core/sqlite-register.ts` whenever
 * the SQLiteStorage module is evaluated. Also useful in tests to inject a
 * mock constructor.
 *
 * @internal
 */
export function registerSQLiteStorage(ctor: SQLiteStorageConstructor): void {
  sqliteStorageCtor = ctor;
}

/**
 * Explicitly load and register the SQLiteStorage backend via dynamic
 * `import()`.
 *
 * Not needed for plain Node consumers (the core barrel registers the
 * constructor as a side effect on import). Escape hatch for bundled
 * consumers whose tree-shaker (honouring `"sideEffects": false`) dropped the
 * registration side effect: call and await this once before constructing
 * sqlite-backed storage.
 */
export async function preloadSQLiteStorage(): Promise<void> {
  if (!sqliteStorageCtor) {
    const mod = await import('./SQLiteStorage.js');
    sqliteStorageCtor = mod.SQLiteStorage as unknown as SQLiteStorageConstructor;
  }
}

/**
 * Resolve the registered SQLiteStorage constructor or fail with guidance.
 */
function resolveSQLiteStorage(): SQLiteStorageConstructor {
  if (!sqliteStorageCtor) {
    throw new Error(
      'SQLite storage was requested but the SQLiteStorage backend is not loaded. ' +
      "Import '@danielsimonjr/memoryjs' (root), '@danielsimonjr/memoryjs/core', or " +
      "'@danielsimonjr/memoryjs/sqlite' — or call and await preloadSQLiteStorage() — " +
      'before creating sqlite-backed storage. (A tree-shaking bundler may have removed ' +
      'the automatic registration side effect.)'
    );
  }
  return sqliteStorageCtor;
}

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

    case 'sqlite': {
      const SQLiteStorageCtor = resolveSQLiteStorage();
      return new SQLiteStorageCtor(config.path);
    }

    case 'postgres':
    case 'postgresql':
      // `config.path` is the Postgres connection string for this backend
      // (e.g. `postgres://user:pass@host:5432/db`). `pg` is an optional peer
      // dependency — see PostgreSQLStorage for the install message.
      return new PostgreSQLStorage(config.path);

    default:
      throw new Error(
        `Unknown storage type: ${storageType}. ` +
        `Supported types: jsonl, sqlite, postgres`
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
  const storageType =
    (process.env.MEMORY_STORAGE_TYPE as 'jsonl' | 'sqlite' | 'postgres' | 'postgresql') ||
    DEFAULT_STORAGE_TYPE;
  return createStorage({ type: storageType, path });
}
