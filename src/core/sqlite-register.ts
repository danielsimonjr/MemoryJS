/**
 * SQLiteStorage registration shim (S9).
 *
 * Evaluating this module registers the `SQLiteStorage` constructor with
 * `StorageFactory`, wiring the `type: 'sqlite'` / `MEMORY_STORAGE_TYPE=sqlite`
 * path without `StorageFactory` itself holding a static import of the
 * SQLiteStorage module (whose top-level `better-sqlite3` import loads the
 * native addon).
 *
 * Imported (for its side effect) by:
 * - `src/core/index.ts` — the core barrel's `SQLiteStorage` re-export
 * - `src/core/ManagerContext.ts` — so direct ManagerContext consumers keep
 *   env-driven sqlite selection working
 * - `src/sqlite.ts` — the `./sqlite` subpath entry
 *
 * Under a tree-shaking bundler honouring `"sideEffects": false`, this module
 * may be dropped when nothing sqlite-related is imported; `StorageFactory`
 * then raises a descriptive error pointing at `preloadSQLiteStorage()`.
 *
 * @module core/sqlite-register
 * @internal
 */

import { SQLiteStorage } from './SQLiteStorage.js';
import { registerSQLiteStorage } from './StorageFactory.js';
import type { IGraphStorage } from '../types/index.js';

registerSQLiteStorage(SQLiteStorage as unknown as new (path: string) => IGraphStorage);

export { SQLiteStorage };
