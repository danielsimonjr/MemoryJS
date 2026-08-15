/**
 * A `better-sqlite3`-shaped facade over Node's built-in `node:sqlite`.
 *
 * WHY THIS EXISTS
 *
 * `better-sqlite3` gets its native binary from an `install` script
 * (`prebuild-install || node-gyp rebuild`), not from a prebuilt platform
 * package. Any installer that does not run install scripts therefore produces a
 * `better-sqlite3` directory with no `better_sqlite3.node` in it, and every call
 * fails with "Could not locate the bindings file".
 *
 * That is exactly what happens in a deployed Claude Code plugin: the plugin
 * installer runs no install scripts. The memory-mcp plugin was completely
 * unusable for this reason — its `.mcp.json` pins `MEMORY_STORAGE_TYPE=sqlite`,
 * so every tool call died on the missing addon. Note the contrast with other
 * native deps in the same tree (`@rolldown/binding-win32-x64-msvc`,
 * `lightningcss-win32-x64-msvc`): those ship the binary INSIDE a
 * platform-specific package, so they install fine without scripts.
 *
 * `node:sqlite` (Node 22.5+) needs no addon at all, and reads the same on-disk
 * SQLite format, so it is a drop-in for that environment.
 *
 * SCOPE — deliberately narrow
 *
 * This implements only the surface `SQLiteStorage` actually uses: `exec`,
 * `prepare` (+ `run`/`get`/`all`), `pragma`, `transaction` and `close`. It is a
 * compatibility shim, not a general better-sqlite3 reimplementation, and it
 * should not grow into one — if `SQLiteStorage` starts needing more of
 * better-sqlite3's API, that is a decision to make explicitly rather than by
 * quietly extending this file.
 */

import { createRequire } from 'node:module';

/** `require` shim: this package builds to ESM, where bare `require` is undefined. */
const nodeRequire = createRequire(import.meta.url);

/** Shape of the better-sqlite3 statement surface that SQLiteStorage relies on. */
interface AdaptedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** Shape of the better-sqlite3 database surface that SQLiteStorage relies on. */
interface AdaptedDatabase {
  exec(sql: string): void;
  prepare(sql: string): AdaptedStatement;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

/**
 * True when this runtime provides `node:sqlite`.
 *
 * Probed rather than inferred from `process.version`: the module is gated by
 * build flags as well as version, so a version check can be wrong in both
 * directions.
 */
export function isNodeSqliteAvailable(): boolean {
  try {
    nodeRequire('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a `better-sqlite3`-compatible constructor backed by `node:sqlite`.
 *
 * Throws if `node:sqlite` is unavailable — callers decide the fallback policy;
 * this module does not silently degrade further.
 */
export function createNodeSqliteDatabaseCtor(): new (path: string, options?: unknown) => AdaptedDatabase {
  const { DatabaseSync } = nodeRequire('node:sqlite') as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
        get(...p: unknown[]): unknown;
        all(...p: unknown[]): unknown[];
      };
      close(): void;
    };
  };

  return class NodeSqliteDatabase implements AdaptedDatabase {
    readonly #db: InstanceType<typeof DatabaseSync>;

    constructor(path: string) {
      this.#db = new DatabaseSync(path);
    }

    exec(sql: string): void {
      this.#db.exec(sql);
    }

    prepare(sql: string): AdaptedStatement {
      const stmt = this.#db.prepare(sql);
      return {
        run: (...params: unknown[]) => {
          const info = stmt.run(...params);
          // better-sqlite3 reports `changes` as a number; node:sqlite may return
          // a bigint. Normalise so callers comparing `changes === 1` still work.
          return {
            changes: typeof info.changes === 'bigint' ? Number(info.changes) : info.changes,
            lastInsertRowid: info.lastInsertRowid,
          };
        },
        get: (...params: unknown[]) => stmt.get(...params),
        all: (...params: unknown[]) => stmt.all(...params),
      };
    }

    /**
     * better-sqlite3's `.pragma(source)` returns rows for reader pragmas
     * (`table_info(...)`) and applies setter pragmas (`journal_mode = WAL`).
     *
     * `node:sqlite` has no `pragma()`, so reader form goes through `prepare().all()`
     * and setter form through `exec()`. Setters are attempted second because a
     * setter run through `prepare().all()` can throw on some builds, whereas a
     * reader run through `exec()` silently discards the rows the caller wanted.
     */
    pragma(source: string, options?: { simple?: boolean }): unknown {
      let rows: unknown[];
      try {
        rows = this.#db.prepare(`PRAGMA ${source}`).all();
      } catch {
        this.#db.exec(`PRAGMA ${source}`);
        return undefined;
      }
      // better-sqlite3's `{ simple: true }` yields the FIRST COLUMN OF THE FIRST
      // ROW rather than the row array — `pragma('foreign_keys', {simple:true})`
      // is `1`, not `[{foreign_keys: 1}]`. Missed on the first pass because
      // SQLiteStorage itself never uses simple mode; its own test suite does,
      // and caught it.
      if (options?.simple === true) {
        const first = rows[0];
        if (first === undefined || first === null) return undefined;
        return Object.values(first as Record<string, unknown>)[0];
      }
      return rows;
    }

    /**
     * better-sqlite3's `.transaction(fn)` returns a callable that wraps `fn` in a
     * transaction. Reproduced with explicit BEGIN/COMMIT/ROLLBACK.
     *
     * Not nestable — better-sqlite3 uses SAVEPOINTs for nesting. SQLiteStorage
     * never nests (every `transaction()` call site invokes the returned function
     * immediately and does not open another), so nesting is deliberately not
     * supported rather than half-supported.
     */
    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      const db = this.#db;
      return function transactional(this: unknown, ...args: never[]): unknown {
        db.exec('BEGIN');
        try {
          const result = fn.apply(this, args);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // A failed ROLLBACK must not mask the original error, which is the
            // one that explains what actually went wrong.
          }
          throw error;
        }
      } as T;
    }

    close(): void {
      this.#db.close();
    }
  };
}
