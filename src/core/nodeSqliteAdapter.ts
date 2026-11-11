/**
 * The SQLite driver: a `better-sqlite3`-shaped facade over Node's built-in `node:sqlite`.
 *
 * WHY THIS EXISTS
 *
 * MemoryJS used to depend on the native `better-sqlite3` addon, which gets its
 * binary from an `install` script (`prebuild-install || node-gyp rebuild`), not
 * from a prebuilt platform package. Any installer that does not run install
 * scripts therefore produces a `better-sqlite3` directory with no
 * `better_sqlite3.node` in it, and every call fails with "Could not locate the
 * bindings file". That is exactly what happens in a deployed Claude Code plugin:
 * the plugin installer runs no install scripts, and the memory-mcp plugin was
 * completely unusable for that reason.
 *
 * `node:sqlite` ships inside Node itself, so there is no addon to build, no ABI
 * to mismatch, and no per-platform prebuild. It reads and writes the same
 * on-disk SQLite format, has FTS5 from Node 22.16.0, and has had a stable
 * synchronous API since 22.13.0. Sprint 9 of the dependency-reduction plan made
 * it the only driver, so this module is no longer a fallback: it is the backend.
 *
 * WHAT IT ADDS OVER THE RAW MODULE
 *
 * `better-sqlite3` and `node:sqlite` differ in a handful of observable ways that
 * `SQLiteStorage` and its callers already rely on. This module normalises them,
 * and each normalisation is covered by `tests/unit/core/sqlite-driver-parity.test.ts`
 * against a fixture recorded from `better-sqlite3` 13.0.3 before it was removed:
 *
 * - `db.pragma(source)` — `node:sqlite` has none. Reader pragmas return rows;
 *   setter pragmas return what SQLite returns for that statement (`[]` for most,
 *   a row for `journal_mode = X`), and `{ simple: true }` yields the first column
 *   of the first row.
 * - `db.transaction(fn)` — `node:sqlite` has none. Wrapping is explicit
 *   `BEGIN`/`COMMIT`/`ROLLBACK`, with `SAVEPOINT` nesting like better-sqlite3.
 * - Rows — `node:sqlite` returns null-prototype objects, `better-sqlite3` returns
 *   plain ones. Rows are converted to plain objects in column order.
 * - Integers — `node:sqlite` throws `ERR_OUT_OF_RANGE` for a value it cannot
 *   represent as a number, and returns `bigint` only when asked. better-sqlite3
 *   returns a (lossy) number. Statements read bigints and convert with `Number`,
 *   which reproduces better-sqlite3's result exactly, including for values above
 *   2^53.
 * - BLOBs — `node:sqlite` returns a `Uint8Array`, better-sqlite3 a `Buffer`.
 *   Values are wrapped in `Buffer.from`, which shares the memory.
 * - Bound values — `node:sqlite` rejects `undefined`; better-sqlite3 binds it as
 *   NULL. `undefined` is mapped to `null`, and the value types neither driver can
 *   bind raise better-sqlite3's exact `TypeError` text.
 * - Errors — `node:sqlite` throws a plain `Error` with `code: 'ERR_SQLITE_ERROR'`
 *   and a numeric `errcode`. Callers match better-sqlite3's `SQLITE_*` codes
 *   (for example `SQLITE_CORRUPT_VTAB`), so errors are re-thrown as a
 *   `SqliteError` with the same `name`, `code`, and message.
 * - Construction — `{ readonly: true }` is better-sqlite3's option name;
 *   `node:sqlite` spells it `readOnly`.
 *
 * SCOPE — deliberately narrow
 *
 * This implements only the surface MemoryJS uses: `exec`, `prepare`
 * (+ `run`/`get`/`all`), `pragma`, `transaction` and `close`. It is a
 * compatibility shim, not a general better-sqlite3 reimplementation, and it
 * should not grow into one — if a caller starts needing more of better-sqlite3's
 * API, that is a decision to make explicitly rather than by quietly extending
 * this file. `iterate`, `pluck`, `raw`, `safeIntegers`, `function` and
 * `aggregate` are intentionally absent: no call site in `src/` uses them.
 *
 * @module core/nodeSqliteAdapter
 */

import { createRequire } from 'node:module';

/** `require` shim: this package builds to ESM, where bare `require` is undefined. */
const nodeRequire = createRequire(import.meta.url);

/** Options `SQLiteStorage` and the procedural-graph backing pass to the constructor. */
export interface SqliteOpenOptions {
  /** Open the file read-only. Node's own option name (`readOnly`) is accepted too. */
  readonly?: boolean;
  /** Alias for {@link SqliteOpenOptions.readonly}, matching `node:sqlite`. */
  readOnly?: boolean;
}

/** What `run()` reports about the statement it executed. */
export interface SqliteRunResult {
  /** Rows changed by the statement, as a number (better-sqlite3's shape). */
  changes: number;
  /** Rowid of the last inserted row. */
  lastInsertRowid: number | bigint;
}

/** The statement surface `SQLiteStorage` relies on. */
export interface SqliteStatement {
  /** Execute the statement and report `changes` / `lastInsertRowid`. */
  run(...params: unknown[]): SqliteRunResult;
  /** Execute the statement and return its first row, or `undefined`. */
  get(...params: unknown[]): unknown;
  /** Execute the statement and return every row. */
  all(...params: unknown[]): unknown[];
}

/** A function wrapped by `SqliteDatabase.transaction`. */
export type SqliteTransactionFunction<T extends (...args: never[]) => unknown> = T & {
  /** Run the wrapped function inside `BEGIN` (the default). */
  deferred?: () => ReturnType<T>;
  /** Run the wrapped function inside `BEGIN IMMEDIATE`. */
  immediate?: () => ReturnType<T>;
  /** Run the wrapped function inside `BEGIN EXCLUSIVE`. */
  exclusive?: () => ReturnType<T>;
};

/** The database surface `SQLiteStorage` relies on. */
export interface SqliteDatabase {
  /** Run one or more SQL statements, discarding any rows. */
  exec(sql: string): void;
  /** Compile one statement. */
  prepare(sql: string): SqliteStatement;
  /** better-sqlite3's `pragma()`: read pragmas return rows, setters apply them. */
  pragma(source: string, options?: { simple?: boolean }): unknown;
  /** Wrap `fn` in a transaction, returning a callable with better-sqlite3's shape. */
  transaction<T extends (...args: never[]) => unknown>(fn: T): SqliteTransactionFunction<T>;
  /** Close the connection. */
  close(): void;
}

/** Extended result codes, mapped to better-sqlite3's `code` strings. */
const SQLITE_CODES: Readonly<Record<number, string>> = {
  1: 'SQLITE_ERROR',
  2: 'SQLITE_INTERNAL',
  3: 'SQLITE_PERM',
  4: 'SQLITE_ABORT',
  5: 'SQLITE_BUSY',
  6: 'SQLITE_LOCKED',
  7: 'SQLITE_NOMEM',
  8: 'SQLITE_READONLY',
  9: 'SQLITE_INTERRUPT',
  10: 'SQLITE_IOERR',
  11: 'SQLITE_CORRUPT',
  12: 'SQLITE_NOTFOUND',
  13: 'SQLITE_FULL',
  14: 'SQLITE_CANTOPEN',
  15: 'SQLITE_PROTOCOL',
  16: 'SQLITE_EMPTY',
  17: 'SQLITE_SCHEMA',
  18: 'SQLITE_TOOBIG',
  19: 'SQLITE_CONSTRAINT',
  20: 'SQLITE_MISMATCH',
  21: 'SQLITE_MISUSE',
  22: 'SQLITE_NOLFS',
  23: 'SQLITE_AUTH',
  24: 'SQLITE_FORMAT',
  25: 'SQLITE_RANGE',
  26: 'SQLITE_NOTADB',
  27: 'SQLITE_NOTICE',
  28: 'SQLITE_WARNING',
  100: 'SQLITE_ROW',
  101: 'SQLITE_DONE',
  267: 'SQLITE_CORRUPT_VTAB',
  275: 'SQLITE_CONSTRAINT_CHECK',
  787: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  1299: 'SQLITE_CONSTRAINT_NOTNULL',
  1555: 'SQLITE_CONSTRAINT_PRIMARYKEY',
  1811: 'SQLITE_CONSTRAINT_TRIGGER',
  2067: 'SQLITE_CONSTRAINT_UNIQUE',
};

/**
 * An error raised by SQLite, shaped like `better-sqlite3`'s `SqliteError`.
 *
 * `code` is the `SQLITE_*` string callers already match on; `errcode` keeps
 * Node's numeric extended result code.
 */
export class SqliteError extends Error {
  /** The `SQLITE_*` code, for example `SQLITE_CONSTRAINT_UNIQUE`. */
  readonly code: string;
  /** Node's numeric extended result code. */
  readonly errcode: number;

  constructor(message: string, errcode: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SqliteError';
    this.errcode = errcode;
    this.code = SQLITE_CODES[errcode] ?? 'SQLITE_ERROR';
  }
}

/** The text better-sqlite3 raises for a value it cannot bind. */
const UNBINDABLE = 'SQLite3 can only bind numbers, strings, bigints, buffers, and null';

/**
 * Convert an error thrown by `node:sqlite` into the `SqliteError` shape callers
 * expect. A non-SQLite error (bad bind value, closed handle) is normalised to
 * the message and class better-sqlite3 raised, because callers already branch on
 * those; anything else passes through unchanged.
 */
function normalizeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  // A closed connection: better-sqlite3 raises a TypeError with this text.
  if ((error as { code?: unknown }).code === 'ERR_INVALID_STATE') {
    return new TypeError('The database connection is not open');
  }
  const errcode = (error as { errcode?: unknown }).errcode;
  if (typeof errcode !== 'number') return error;
  return new SqliteError(error.message, errcode, error);
}

/** True for a plain object, which better-sqlite3 reads as named parameters. */
function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Count the positional `?` placeholders and collect the named ones in `sql`.
 *
 * `better-sqlite3` validates the call's parameters against the statement and
 * raises `RangeError` when they do not line up; `node:sqlite` silently binds
 * NULL for a missing value. The count is taken from the SQL text with string
 * literals, quoted identifiers and comments skipped, so a `?` inside a literal
 * is not mistaken for a parameter.
 */
function parametersOf(sql: string): { positional: number; named: Set<string> } {
  let positional = 0;
  const named = new Set<string>();
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char;
      for (i++; i < sql.length; i++) {
        if (sql[i] === close) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (sql[i + 1] === close) i++;
          else break;
        }
      }
      continue;
    }
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (char === '?') {
      positional++;
      continue;
    }
    if (char === '@' || char === ':' || char === '$') {
      const match = /^[@:$][A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i, i + 64));
      if (match) {
        named.add(match[0].slice(1));
        i += match[0].length - 1;
      }
    }
  }
  return { positional, named };
}

/** What the wrapper knows about the statement's parameters. */
interface ParameterPlan {
  positional: number;
  named: Set<string>;
}

/**
 * Prepare the arguments for one call, reproducing better-sqlite3's rules.
 *
 * A single plain-object argument is named binding: unknown keys are ignored and
 * a missing one is an error. Otherwise the arguments are positional, and the
 * count must equal the statement's placeholder count. Values that neither driver
 * can bind raise better-sqlite3's exact `TypeError`.
 */
function bindParams(plan: ParameterPlan, params: readonly unknown[]): unknown[] | Record<string, unknown> {
  const first = params[0];
  if (params.length === 1 && isPlainObject(first)) {
    const values = first as Record<string, unknown>;
    if (plan.named.size === 0) {
      // better-sqlite3 reads the object as named parameters, finds no name to
      // bind, and reports the positional placeholders as unfilled.
      throw new RangeError('Too few parameter values were provided');
    }
    for (const key of plan.named) {
      if (!(key in values)) throw new RangeError(`Missing named parameter "${key}"`);
    }
    const out: Record<string, unknown> = {};
    for (const key of plan.named) out[key] = bindValue(values[key]);
    return out;
  }
  if (params.length < plan.positional) {
    throw new RangeError('Too few parameter values were provided');
  }
  if (params.length > plan.positional) {
    throw new RangeError('Too many parameter values were provided');
  }
  return params.map((value) => bindValue(value));
}

/** Map one bound value, translating `undefined` to NULL like better-sqlite3. */
function bindValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'bigint'
    || typeof value === 'string'
    || value instanceof Uint8Array
  ) {
    return value;
  }
  throw new TypeError(UNBINDABLE);
}

/**
 * Call one statement method with prepared arguments.
 *
 * Positional values are spread; a named-binding object is passed as one
 * argument, which is how `node:sqlite` takes named parameters.
 */
function invoke(
  stmt: NodeSqliteStatement,
  method: 'run' | 'get' | 'all',
  args: unknown[] | Record<string, unknown>,
): unknown {
  return Array.isArray(args) ? stmt[method](...args) : stmt[method](args);
}

/**
 * Convert one column value from `node:sqlite` to better-sqlite3's representation.
 *
 * Integers arrive as `bigint` (the statement reads bigints so a value above 2^53
 * does not throw) and become numbers; BLOBs become `Buffer`.
 */
function column(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return value;
}

/** Convert a row object into a plain object, preserving column order. */
function row<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isPlainObject(value)) return value as T;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    out[key] = column(source[key]);
  }
  return out as T;
}

/** Minimal shape of the `node:sqlite` module this adapter needs. */
interface NodeSqliteModule {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean; timeout?: number },
  ) => NodeSqliteConnection;
}

/** Minimal shape of one `node:sqlite` connection. */
interface NodeSqliteConnection {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

/** Minimal shape of one `node:sqlite` statement. */
interface NodeSqliteStatement {
  setReadBigInts(enabled: boolean): void;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * True when this runtime provides `node:sqlite`.
 *
 * Probed rather than inferred from `process.version`: the module can be gated by
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
 * Build the SQLite constructor backed by `node:sqlite`.
 *
 * Throws if `node:sqlite` is unavailable. Since Sprint 9 there is no fallback to
 * degrade to: the message names the Node version floor instead.
 */
export function createNodeSqliteDatabaseCtor(): new (
  path: string,
  options?: SqliteOpenOptions,
) => SqliteDatabase {
  const { DatabaseSync } = nodeRequire('node:sqlite') as NodeSqliteModule;

  return class NodeSqliteDatabase implements SqliteDatabase {
    readonly #db: NodeSqliteConnection;
    /** Open transactions on this connection; drives `SAVEPOINT` nesting. */
    #depth = 0;

    constructor(path: string, options?: SqliteOpenOptions) {
      const readOnly = options?.readonly === true || options?.readOnly === true;
      // `node:sqlite` rejects an explicit `undefined` options argument, so pass
      // one only when a read-only open is requested.
      this.#db = readOnly ? new DatabaseSync(path, { readOnly: true }) : new DatabaseSync(path);
    }

    exec(sql: string): void {
      try {
        this.#db.exec(sql);
      } catch (error) {
        throw normalizeError(error);
      }
    }

    prepare(sql: string): SqliteStatement {
      let stmt: NodeSqliteStatement;
      try {
        stmt = this.#db.prepare(sql);
        // Ask for bigints so an INTEGER above 2^53 reads as bigint instead of
        // raising ERR_OUT_OF_RANGE; `column()` turns it back into the (lossy)
        // number better-sqlite3 returns.
        stmt.setReadBigInts(true);
      } catch (error) {
        throw normalizeError(error);
      }

      const plan = parametersOf(sql);

      return {
        run: (...params: unknown[]) => {
          const args = bindParams(plan, params);
          try {
            const info = invoke(stmt, 'run', args) as {
              changes: number | bigint;
              lastInsertRowid: number | bigint;
            };
            // better-sqlite3 reports `changes` and `lastInsertRowid` as numbers;
            // node:sqlite returns bigints once the statement reads bigints.
            // Normalise so callers comparing `changes === 1` still work.
            return {
              changes: typeof info.changes === 'bigint' ? Number(info.changes) : info.changes,
              lastInsertRowid:
                typeof info.lastInsertRowid === 'bigint'
                  ? Number(info.lastInsertRowid)
                  : info.lastInsertRowid,
            };
          } catch (error) {
            throw normalizeError(error);
          }
        },
        get: (...params: unknown[]) => {
          const args = bindParams(plan, params);
          try {
            return row<unknown>(invoke(stmt, 'get', args));
          } catch (error) {
            throw normalizeError(error);
          }
        },
        all: (...params: unknown[]) => {
          const args = bindParams(plan, params);
          try {
            return (invoke(stmt, 'all', args) as unknown[]).map((value) => row<unknown>(value));
          } catch (error) {
            throw normalizeError(error);
          }
        },
      };
    }

    /**
     * better-sqlite3's `.pragma(source)`.
     *
     * A reader pragma (`table_info(...)`) returns rows. A setter
     * (`journal_mode = WAL`) returns whatever SQLite returns for that statement,
     * which is what better-sqlite3 hands back too: `[]` for most settings, a row
     * for `journal_mode`. `node:sqlite` has no `pragma()`, so this goes through
     * `prepare().all()`, falling back to `exec()` for a statement that SQLite
     * refuses to prepare.
     */
    pragma(source: string, options?: { simple?: boolean }): unknown {
      let rows: unknown[];
      try {
        rows = this.#db.prepare(`PRAGMA ${source}`).all() as unknown[];
      } catch (error) {
        try {
          this.#db.exec(`PRAGMA ${source}`);
          return undefined;
        } catch {
          throw normalizeError(error);
        }
      }
      // better-sqlite3's `{ simple: true }` yields the FIRST COLUMN OF THE FIRST
      // ROW rather than the row array — `pragma('foreign_keys', {simple:true})`
      // is `1`, not `[{foreign_keys: 1}]`.
      if (options?.simple === true) {
        const first = row<Record<string, unknown>>(rows[0]);
        if (first === undefined) return undefined;
        return Object.values(first)[0];
      }
      return rows.map((value) => row<unknown>(value));
    }

    /**
     * better-sqlite3's `.transaction(fn)`: a callable that wraps `fn` in a
     * transaction and returns its result.
     *
     * Nesting uses `SAVEPOINT`, as better-sqlite3 does, so a transaction opened
     * inside another rolls back to its own savepoint instead of failing. An
     * async function is refused, because better-sqlite3 refuses it too and a
     * transaction cannot span an await.
     */
    transaction<T extends (...args: never[]) => unknown>(fn: T): SqliteTransactionFunction<T> {
      const run = (mode: 'BEGIN' | 'BEGIN IMMEDIATE' | 'BEGIN EXCLUSIVE', args: never[]): unknown => {
        const nested = this.#depth > 0;
        const savepoint = `memoryjs_tx_${this.#depth}`;
        this.#db.exec(nested ? `SAVEPOINT ${savepoint}` : mode);
        this.#depth++;
        try {
          const result = fn(...args);
          if (result instanceof Promise) {
            throw new TypeError('Transaction function cannot return a promise');
          }
          this.#depth--;
          this.#db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
          return result;
        } catch (error) {
          this.#depth--;
          try {
            this.#db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
          } catch {
            // A failed ROLLBACK must not mask the original error, which is the
            // one that explains what actually went wrong.
          }
          throw normalizeError(error);
        }
      };

      const transaction = ((...args: never[]) => run('BEGIN', args)) as SqliteTransactionFunction<T>;
      transaction.deferred = ((...args: never[]) => run('BEGIN', args)) as unknown as () => ReturnType<T>;
      transaction.immediate = ((...args: never[]) =>
        run('BEGIN IMMEDIATE', args)) as unknown as () => ReturnType<T>;
      transaction.exclusive = ((...args: never[]) =>
        run('BEGIN EXCLUSIVE', args)) as unknown as () => ReturnType<T>;
      return transaction;
    }

    close(): void {
      this.#db.close();
    }
  };
}
