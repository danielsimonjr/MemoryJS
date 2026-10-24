/**
 * Shared test helper - remove a SQLite database file and its WAL files
 *
 * In WAL mode, SQLite keeps `<db>-wal` and `<db>-shm` next to the database
 * file. Windows does not delete a file that a connection holds open (EPERM).
 * Close every connection to the database (`ManagerContext.close()` or
 * `SQLiteStorage.close()`) before you call this helper.
 *
 * The helper does not hide an error. If a connection stays open, the removal
 * fails on Windows and the test fails, so a leaked connection is visible.
 *
 * @example
 * ```typescript
 * import { removeSqliteFiles } from '../../test-utils/sqlite-files.js';
 *
 * afterEach(() => {
 *   ctx.close();
 *   removeSqliteFiles(dbPath);
 * });
 * ```
 */

import { rmSync } from 'node:fs';

/** The file name suffixes of a SQLite database in WAL mode: the database, the WAL and the shared-memory index. */
export const SQLITE_FILE_SUFFIXES = ['', '-wal', '-shm'] as const;

/** Removes `dbPath` and its `-wal` and `-shm` files. A missing file is not an error. */
export function removeSqliteFiles(dbPath: string): void {
  for (const suffix of SQLITE_FILE_SUFFIXES) {
    rmSync(dbPath + suffix, { force: true });
  }
}
