/**
 * SQLite subpath entry (`@danielsimonjr/memoryjs/sqlite`).
 *
 * S9: dedicated entry for the SQLite backend so consumers that want it can
 * import it directly — and consumers that don't never touch the
 * `better-sqlite3` native addon (import any other subpath instead of the
 * root).
 *
 * Importing this module also registers the `SQLiteStorage` constructor with
 * `StorageFactory` (via `core/sqlite-register.js`), enabling
 * `MEMORY_STORAGE_TYPE=sqlite` / `type: 'sqlite'` selection.
 *
 * @packageDocumentation
 * @module @danielsimonjr/memoryjs/sqlite
 */

// Side effect: registers SQLiteStorage with StorageFactory.
export { SQLiteStorage } from './core/sqlite-register.js';
export { preloadSQLiteStorage, registerSQLiteStorage } from './core/StorageFactory.js';
