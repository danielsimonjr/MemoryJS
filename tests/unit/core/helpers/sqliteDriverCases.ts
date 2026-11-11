/**
 * The driver-parity corpus: one list of operations, run through a
 * better-sqlite3-shaped driver, returning a JSON-serializable record.
 *
 * The same functions drive both sides of the parity claim:
 *
 * - `tests/unit/core/helpers/captureSqliteDriverParity.ts` runs them through
 *   `better-sqlite3` 13.0.3 and writes
 *   `tests/unit/core/fixtures/sqliteDriverParity.json` (recorded once, before
 *   the package was removed from `package.json`).
 * - `tests/unit/core/sqlite-driver-parity.test.ts` runs them through
 *   `createNodeSqliteDatabaseCtor()` and compares the record field by field.
 *
 * Everything that can reach a user or a stored file is in here: row values and
 * their JavaScript types, `changes` and `lastInsertRowid`, pragma results,
 * `bm25()` rankings, transaction and savepoint outcomes, BLOBs, integers above
 * 2^53, `undefined` / `null` binding, Unicode, the shape of each error that
 * `SQLiteStorage` or its callers can meet, and the on-disk schema.
 *
 * The corpus is deliberately driver-agnostic: it uses only `exec`, `prepare`
 * (`run` / `get` / `all`), `pragma`, `transaction` and `close`, because that is
 * the whole surface `src/` uses.
 *
 * @module tests/unit/core/helpers/sqliteDriverCases
 */

/** The narrow driver surface the corpus is allowed to use. */
export interface CorpusDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  pragma(source: string, options?: { simple?: boolean }): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

/** A constructor for {@link CorpusDatabase}. */
export type CorpusCtor = new (path: string, options?: { readonly?: boolean }) => CorpusDatabase;

/** One captured value in the record. */
export type Captured = unknown;

/**
 * Describe a value so that a JS-type difference is visible even when the value
 * is the same: `1` and `1n` would otherwise compare equal after JSON.
 */
function describe(value: unknown): unknown {
  if (value === undefined) return { $type: 'undefined' };
  if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
  if (value instanceof Uint8Array) {
    return { $type: value.constructor.name, bytes: Array.from(value) };
  }
  if (value === null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { $type: 'number', value }
      : { $type: 'number', value: String(value) };
  }
  if (Array.isArray(value)) return value.map(describe);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = describe((value as Record<string, unknown>)[key]);
    }
    return {
      $type: 'object',
      proto: Object.getPrototypeOf(value) === null ? 'null' : 'Object',
      value: out,
    };
  }
  return value;
}

/** Capture an error the way a caller sees it: name, code, and message. */
function describeError(fn: () => unknown): unknown {
  try {
    fn();
    return { threw: false };
  } catch (error) {
    return {
      threw: true,
      ctor: error instanceof Error ? error.constructor.name : typeof error,
      name: error instanceof Error ? (error as { name?: string }).name : undefined,
      code: (error as { code?: unknown }).code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run the whole corpus against one driver.
 *
 * @param Ctor - The driver constructor under test.
 * @param files - Turns a file name into a path in a fresh directory.
 * @returns The record to freeze or compare.
 */
export function runCorpus(Ctor: CorpusCtor, files: (name: string) => string): Record<string, Captured> {
  const record: Record<string, Captured> = {};

  // ---------- CRUD ----------
  {
    const db = new Ctor(files('crud.db'));
    db.exec(`
      CREATE TABLE entities (
        name TEXT PRIMARY KEY,
        entityType TEXT NOT NULL,
        observations TEXT NOT NULL,
        importance INTEGER,
        parentId TEXT
      )
    `);
    const insert = db.prepare(
      'INSERT INTO entities (name, entityType, observations, importance, parentId) VALUES (?, ?, ?, ?, ?)',
    );
    record.crudInsertRun = describe(insert.run('Alice', 'person', '["engineer"]', 7, null));
    record.crudInsertSecond = describe(insert.run('Bob', 'person', '["designer"]', null, 'Alice'));
    record.crudGet = describe(db.prepare('SELECT * FROM entities WHERE name = ?').get('Alice'));
    record.crudGetMiss = describe(db.prepare('SELECT * FROM entities WHERE name = ?').get('Nobody'));
    record.crudAll = describe(
      db.prepare('SELECT name, importance FROM entities ORDER BY name').all(),
    );
    const update = db.prepare('UPDATE entities SET importance = ? WHERE name = ?');
    record.crudUpdateChanges = describe(update.run(9, 'Alice'));
    record.crudUpdateMiss = describe(update.run(9, 'Nobody'));
    const del = db.prepare('DELETE FROM entities WHERE name = ?');
    record.crudDeleteChanges = describe(del.run('Bob'));
    record.crudDeleteMiss = describe(del.run('Bob'));
    record.crudCount = describe(db.prepare('SELECT COUNT(*) AS c FROM entities').get());
    db.close();
  }

  // ---------- pragmas ----------
  {
    const db = new Ctor(files('pragma.db'));
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    db.pragma('foreign_keys = ON');
    record.pragmaSimpleForeignKeys = describe(db.pragma('foreign_keys', { simple: true }));
    record.pragmaRowsForeignKeys = describe(db.pragma('foreign_keys'));
    record.pragmaTableInfo = describe(
      (db.pragma('table_info(t)') as Array<{ name: string }>).map((c) => c.name),
    );
    record.pragmaJournalModeSetter = describe(db.pragma('journal_mode = WAL'));
    record.pragmaJournalModeReader = describe(db.pragma('journal_mode'));
    record.pragmaUserVersionSetter = describe(db.pragma('user_version = 7'));
    record.pragmaUserVersionSimple = describe(db.pragma('user_version', { simple: true }));
    record.pragmaSynchronous = describe(db.pragma('synchronous = NORMAL'));
    record.pragmaBusyTimeout = describe(db.pragma('busy_timeout = 5000'));
    record.pragmaCacheSize = describe(db.pragma('cache_size = -64000'));
    record.pragmaTempStore = describe(db.pragma('temp_store = MEMORY'));
    record.pragmaWalCheckpoint = describe(db.pragma('wal_checkpoint(TRUNCATE)'));
    db.close();
  }

  // ---------- FTS5: results, order and bm25 ranking ----------
  {
    const db = new Ctor(files('fts.db'));
    db.exec(`
      CREATE TABLE entities (
        name TEXT PRIMARY KEY,
        entityType TEXT NOT NULL,
        observations TEXT NOT NULL,
        tags TEXT
      );
      CREATE VIRTUAL TABLE entities_fts USING fts5(
        name, entityType, observations, tags,
        content='entities', content_rowid='rowid'
      );
      CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, name, entityType, observations, tags)
        VALUES (NEW.rowid, NEW.name, NEW.entityType, NEW.observations, NEW.tags);
      END;
    `);
    const ins = db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?)');
    ins.run('Needle', 'note', '["singular zephyr"]', null);
    ins.run('Haystack', 'note', '["ordinary content zephyr zephyr"]', null);
    ins.run('Archive', 'note', '["historical records"]', null);
    ins.run('Ünïcode', 'note', '["naïve café zephyr"]', null);

    // The exact query SQLiteStorage builds: each term quoted, joined with OR.
    const ranked = db
      .prepare(`
        SELECT name, bm25(entities_fts, 10, 5, 3, 1) AS score
        FROM entities_fts
        WHERE entities_fts MATCH ?
        ORDER BY score
      `)
      .all('"zephyr"');
    record.ftsRankedNames = describe((ranked as Array<{ name: string }>).map((r) => r.name));
    record.ftsRankedScores = describe(
      (ranked as Array<{ score: number }>).map((r) => r.score.toFixed(12)),
    );
    record.ftsLimit = describe(
      db
        .prepare(`
          SELECT name FROM entities_fts
          WHERE entities_fts MATCH ?
          ORDER BY bm25(entities_fts, 10, 5, 3, 1)
          LIMIT ?
        `)
        .all('"zephyr"', 2),
    );
    record.ftsNoMatch = describe(
      db.prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ?').all('"nothingmatches"'),
    );
    // Prefix and column-filter syntax, to show the FTS5 build is the full module.
    record.ftsPrefix = describe(
      db
        .prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name')
        .all('zeph*'),
    );
    record.ftsColumnFilter = describe(
      db
        .prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name')
        .all('observations:zephyr'),
    );
    // Unicode matching: tokenizer behaviour must be identical.
    record.ftsUnicode = describe(
      db.prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ?').all('"café"'),
    );
    record.ftsIntegrityCheck = describeError(() =>
      db.prepare("INSERT INTO entities_fts(entities_fts, rank) VALUES('integrity-check', 1)").run(),
    );
    db.close();
  }

  // ---------- transactions and rollback ----------
  {
    const db = new Ctor(files('tx.db'));
    db.exec('CREATE TABLE t (n INTEGER, label TEXT)');
    const ins = db.prepare('INSERT INTO t (n, label) VALUES (?, ?)');

    const commit = db.transaction(() => {
      ins.run(1, 'a');
      ins.run(2, 'b');
      return 'ok';
    });
    record.txCommitReturn = describe(commit());
    record.txCommitRows = describe(db.prepare('SELECT n FROM t ORDER BY n').all());

    const rollback = db.transaction(() => {
      ins.run(3, 'c');
      throw new Error('boom');
    });
    record.txRollbackError = describeError(() => rollback());
    record.txRollbackRows = describe(db.prepare('SELECT n FROM t ORDER BY n').all());

    // A savepoint-nested transaction: the inner rollback must not undo the outer.
    const outer = db.transaction(() => {
      ins.run(4, 'd');
      try {
        db.transaction(() => {
          ins.run(5, 'e');
          throw new Error('inner');
        })();
      } catch {
        // swallowed: the outer transaction continues
      }
      ins.run(6, 'f');
    });
    record.txNestedError = describeError(() => outer());
    record.txNestedRows = describe(db.prepare('SELECT n FROM t ORDER BY n').all());

    // deferred / immediate / exclusive are part of better-sqlite3's callable.
    record.txHasModes = describe([
      typeof (commit as unknown as { deferred?: unknown }).deferred,
      typeof (commit as unknown as { immediate?: unknown }).immediate,
      typeof (commit as unknown as { exclusive?: unknown }).exclusive,
    ]);
    db.close();
  }

  // ---------- WAL and a second connection reading a committed write ----------
  {
    const path = files('wal.db');
    const writer = new Ctor(path);
    writer.pragma('journal_mode = WAL');
    writer.exec('CREATE TABLE t (n INTEGER)');
    writer.prepare('INSERT INTO t (n) VALUES (?)').run(1);

    const reader = new Ctor(path, { readonly: true });
    record.walReadonlySeesCommitted = describe(reader.prepare('SELECT n FROM t').all());
    record.walReadonlyWriteRefused = describeError(() =>
      reader.exec('INSERT INTO t (n) VALUES (2)'),
    );
    reader.close();

    writer.prepare('INSERT INTO t (n) VALUES (?)').run(2);
    record.walWriterCount = describe(writer.prepare('SELECT COUNT(*) AS c FROM t').get());
    writer.pragma('wal_checkpoint(TRUNCATE)');
    writer.close();

    // Reopen: the committed rows are on disk.
    const reopened = new Ctor(path);
    record.walReopenRows = describe(reopened.prepare('SELECT n FROM t ORDER BY n').all());
    record.walJournalMode = describe(reopened.pragma('journal_mode', { simple: true }));
    reopened.close();
  }

  // ---------- large BLOB ----------
  {
    const db = new Ctor(files('blob.db'));
    db.exec('CREATE TABLE bl (id INTEGER PRIMARY KEY, data BLOB)');
    const big = Buffer.alloc(256 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    record.blobInsert = describe(db.prepare('INSERT INTO bl (data) VALUES (?)').run(big));
    const read = db.prepare('SELECT data FROM bl WHERE id = 1').get() as { data: Uint8Array };
    record.blobReadLength = describe(read.data.byteLength);
    record.blobReadConstructor = describe(read.data.constructor.name);
    // FNV-1a over the bytes, so the fixture is small but the content is checked.
    record.blobReadHash = describe(
      (() => {
        let hash = 0x811c9dc5;
        for (const byte of read.data) {
          hash ^= byte;
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash.toString(16);
      })(),
    );
    // A small blob keeps the same read type.
    db.prepare('INSERT INTO bl (data) VALUES (?)').run(Buffer.from([1, 2, 3]));
    const small = db.prepare('SELECT data FROM bl WHERE id = 2').get() as { data: Uint8Array };
    record.blobSmallBytes = describe(Array.from(small.data));
    record.blobSmallIsBuffer = describe(Buffer.isBuffer(small.data));
    // A Float32Array, the shape `storeEmbedding` binds.
    const vector = new Float32Array([1.5, -2.25, 0, 3.125]);
    db.exec('CREATE TABLE emb (id INTEGER PRIMARY KEY, v BLOB NOT NULL)');
    db.prepare('INSERT INTO emb (v) VALUES (?)').run(Buffer.from(vector.buffer));
    const stored = db.prepare('SELECT v FROM emb WHERE id = 1').get() as { v: Uint8Array };
    record.blobFloat32RoundTrip = describe(
      Array.from(new Float32Array(stored.v.buffer, stored.v.byteOffset, stored.v.byteLength / 4)),
    );
    db.close();
  }

  // ---------- integers above 2^53 ----------
  {
    const db = new Ctor(files('int.db'));
    db.exec('CREATE TABLE i (id INTEGER PRIMARY KEY, v INTEGER)');
    const ins = db.prepare('INSERT INTO i (v) VALUES (?)');
    record.intBindBigintAboveSafe = describe(ins.run(9007199254740993n));
    record.intReadAboveSafe = describe(db.prepare('SELECT v FROM i WHERE id = 1').get());
    record.intBindSafe = describe(ins.run(9007199254740991n));
    record.intReadSafe = describe(db.prepare('SELECT v FROM i WHERE id = 2').get());
    record.intBindNegative = describe(ins.run(-9007199254740993n));
    record.intReadNegative = describe(db.prepare('SELECT v FROM i WHERE id = 3').get());
    // A number that is already unsafe: bound as a double, stored as an integer.
    record.intBindUnsafeNumber = describe(ins.run(2 ** 60));
    record.intReadUnsafeNumber = describe(db.prepare('SELECT v FROM i WHERE id = 4').get());
    record.intMaxInt64 = describe(ins.run(9223372036854775807n));
    record.intReadMaxInt64 = describe(db.prepare('SELECT v FROM i WHERE id = 5').get());
    db.close();
  }

  // ---------- NULL / undefined / bindable types ----------
  {
    const db = new Ctor(files('null.db'));
    db.exec('CREATE TABLE n (id INTEGER PRIMARY KEY, v TEXT)');
    const ins = db.prepare('INSERT INTO n (v) VALUES (?)');
    record.bindNull = describe(ins.run(null));
    record.bindUndefined = describe(ins.run(undefined));
    record.bindString = describe(ins.run('text'));
    record.bindNumber = describe(ins.run(42));
    record.bindBoolean = describeError(() => ins.run(true));
    record.bindFalse = describeError(() => ins.run(false));
    record.bindDate = describeError(() => ins.run(new Date(0)));
    record.bindObject = describeError(() => ins.run({ a: 1 }));
    record.bindSymbol = describeError(() => ins.run(Symbol('s')));
    record.undefinedIsNull = describe(db.prepare('SELECT v FROM n WHERE id = 2').get());
    record.nullIsNull = describe(db.prepare('SELECT v FROM n WHERE id = 1').get());
    // Missing parameters are an error in both.
    record.bindTooFew = describeError(() => ins.run());
    db.close();
  }

  // ---------- Unicode ----------
  {
    const db = new Ctor(files('unicode.db'));
    db.exec('CREATE TABLE u (id INTEGER PRIMARY KEY, v TEXT)');
    const ins = db.prepare('INSERT INTO u (v) VALUES (?)');
    const values = [
      'naïve café',
      '日本語のテキスト',
      'emoji 🧠🔍',
      'combining e + U+0301: e\u0301',
      'quotes \' " ` and\nnewlines\tand\ttabs',
      'surrogate pair 😀',
    ];
    record.unicodeInserts = describe(values.map((v) => ins.run(v)));
    record.unicodeReadBack = describe(db.prepare('SELECT v FROM u ORDER BY id').all());
    record.unicodeLengths = describe(
      (db.prepare('SELECT v FROM u ORDER BY id').all() as Array<{ v: string }>).map((r) => r.v.length),
    );
    // LIKE with COLLATE NOCASE, which `simpleSearch` uses.
    record.unicodeLikeNoCase = describe(
      db.prepare("SELECT v FROM u WHERE v LIKE ? ESCAPE '\\' COLLATE NOCASE").all('%CAFÉ%'),
    );
    // A raw NUL byte in TEXT. `node:sqlite` truncates a text column at the NUL
    // when it converts to a JS string; better-sqlite3 returns the whole value.
    // Storage is identical (hex proves it), so this is a read-side deviation,
    // and it is unreachable through MemoryJS's own writes: observations are
    // stored with `JSON.stringify`, which escapes NUL as `\u0000`.
    db.prepare('INSERT INTO u (v) VALUES (?)').run('nul-in-\u0000-middle');
    record.nulTextStoredHex = describe(
      db.prepare("SELECT hex(v) AS h FROM u WHERE v LIKE 'nul-in%'").get(),
    );
    record.nulTextRead = describe(
      db.prepare("SELECT v FROM u WHERE v LIKE 'nul-in%'").get(),
    );
    // The path MemoryJS actually uses: JSON-encoded text round-trips exactly.
    const jsonEncoded = JSON.stringify({ o: ['a\u0000b'] });
    db.prepare('INSERT INTO u (v) VALUES (?)').run(jsonEncoded);
    record.nulJsonEncodedRoundTrip = describe(
      db.prepare('SELECT v FROM u WHERE v = ?').get(jsonEncoded),
    );
    db.close();
  }

  // ---------- error shapes ----------
  {
    const db = new Ctor(files('errors.db'));
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE p (name TEXT PRIMARY KEY);
      CREATE TABLE c (
        name TEXT PRIMARY KEY,
        pid TEXT REFERENCES p(name) ON DELETE CASCADE,
        v INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX u_v ON p(name);
    `);
    db.prepare('INSERT INTO p (name) VALUES (?)').run('a');
    db.prepare('INSERT INTO c (name, pid, v) VALUES (?, ?, ?)').run('x', 'a', 1);

    record.errUnique = describeError(() => db.prepare('INSERT INTO p (name) VALUES (?)').run('a'));
    record.errForeignKey = describeError(() =>
      db.prepare('INSERT INTO c (name, pid, v) VALUES (?, ?, ?)').run('y', 'missing', 1),
    );
    record.errNotNull = describeError(() =>
      db.prepare('INSERT INTO c (name, pid, v) VALUES (?, ?, ?)').run('z', 'a', null),
    );
    record.errNoSuchTable = describeError(() => db.prepare('SELECT * FROM nope').all());
    record.errSyntax = describeError(() => db.prepare('selec 1').all());
    record.errNoSuchColumn = describeError(() => db.prepare('SELECT nope FROM p').all());
    record.errNoSuchModule = describeError(() =>
      db.exec('CREATE VIRTUAL TABLE x USING nosuchmodule'),
    );
    db.close();

    // A read-only connection refusing a write.
    const ro = new Ctor(files('errors.db'), { readonly: true });
    record.errReadonly = describeError(() => ro.exec("INSERT INTO p (name) VALUES ('b')"));
    ro.close();

    // A closed connection is not usable.
    const closed = new Ctor(files('closed.db'));
    closed.exec('CREATE TABLE t (a)');
    closed.close();
    record.errClosedPrepare = describeError(() => closed.prepare('SELECT 1').all());
    record.errClosedExec = describeError(() => closed.exec('SELECT 1'));
  }

  // ---------- stale FTS posting (the SQLITE_CORRUPT_VTAB path) ----------
  {
    const db = new Ctor(files('stale.db'));
    db.exec(`
      CREATE TABLE entities (name TEXT PRIMARY KEY, body TEXT);
      CREATE VIRTUAL TABLE entities_fts USING fts5(
        name, body, content='entities', content_rowid='rowid'
      );
      CREATE TRIGGER ai AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, name, body) VALUES (NEW.rowid, NEW.name, NEW.body);
      END;
    `);
    db.prepare('INSERT INTO entities VALUES (?, ?)').run('a', 'hello zephyr');
    // Drop the delete trigger, then delete: the posting survives with no row.
    db.exec('DROP TRIGGER ai');
    db.prepare('DELETE FROM entities WHERE name = ?').run('a');
    record.stalePostingError = describeError(() =>
      db.prepare('SELECT rowid, name FROM entities_fts WHERE entities_fts MATCH ?').all('zephyr'),
    );
    // The joined form SQLiteStorage falls back to skips the stale posting.
    record.stalePostingJoined = describe(
      db
        .prepare(`
          SELECT e.name AS name FROM entities_fts f
          JOIN entities e ON e.rowid = f.rowid
          WHERE entities_fts MATCH ?
        `)
        .all('zephyr'),
    );
    db.close();
  }

  // ---------- on-disk format ----------
  {
    const path = files('ondisk.db');
    const db = new Ctor(path);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE entities (
        name TEXT PRIMARY KEY,
        id TEXT,
        entityType TEXT NOT NULL,
        observations TEXT NOT NULL,
        tags TEXT,
        importance INTEGER,
        createdAt TEXT NOT NULL,
        lastModified TEXT NOT NULL
      );
      CREATE INDEX idx_entity_type ON entities(entityType);
    `);
    const ins = db.prepare(
      'INSERT INTO entities (name, id, entityType, observations, tags, importance, createdAt, lastModified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    ins.run(
      'Alice', 'id-1', 'person', '["engineer"]', '["team"]', 7,
      '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z',
    );
    ins.run(
      'Bob', 'id-2', 'person', '["designer"]', null, null,
      '2024-01-02T00:00:00.000Z', '2024-01-02T00:00:00.000Z',
    );
    db.pragma('user_version = 3');
    db.pragma('wal_checkpoint(TRUNCATE)');
    record.ondiskRows = describe(db.prepare('SELECT * FROM entities ORDER BY name').all());
    record.ondiskUserVersion = describe(db.pragma('user_version', { simple: true }));
    record.ondiskSchema = describe(
      db
        .prepare(
          "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .all(),
    );
    db.close();
  }

  // ---------- the schema SQLiteStorage creates, end to end ----------
  {
    const db = new Ctor(files('storage-schema.db'));
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        name TEXT PRIMARY KEY,
        id TEXT,
        entityType TEXT NOT NULL,
        observations TEXT NOT NULL,
        tags TEXT,
        importance INTEGER,
        parentId TEXT REFERENCES entities(name) ON DELETE SET NULL,
        createdAt TEXT NOT NULL,
        lastModified TEXT NOT NULL,
        projectId TEXT,
        version INTEGER DEFAULT 1,
        parentEntityName TEXT,
        rootEntityName TEXT,
        isLatest INTEGER DEFAULT 1,
        supersededBy TEXT,
        contentHash TEXT,
        agentMetadata TEXT
      );
      CREATE TABLE IF NOT EXISTS relations (
        fromEntity TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
        toEntity TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
        relationType TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastModified TEXT NOT NULL,
        weight REAL,
        confidence REAL,
        properties TEXT,
        metadata TEXT,
        PRIMARY KEY (fromEntity, toEntity, relationType)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
        name, entityType, observations, tags,
        content='entities', content_rowid='rowid'
      );
      CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, name, entityType, observations, tags)
        VALUES (NEW.rowid, NEW.name, NEW.entityType, NEW.observations, NEW.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, entityType, observations, tags)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.entityType, OLD.observations, OLD.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, entityType, observations, tags)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.entityType, OLD.observations, OLD.tags);
        INSERT INTO entities_fts(rowid, name, entityType, observations, tags)
        VALUES (NEW.rowid, NEW.name, NEW.entityType, NEW.observations, NEW.tags);
      END;
      CREATE TABLE IF NOT EXISTS embeddings (
        entityName TEXT PRIMARY KEY REFERENCES entities(name) ON DELETE CASCADE,
        embedding BLOB NOT NULL,
        embeddingModel TEXT NOT NULL,
        embeddingUpdatedAt TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        contentHash TEXT
      );
    `);
    const insEntity = db.prepare(
      'INSERT INTO entities (name, id, entityType, observations, tags, importance, parentId, createdAt, lastModified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insEntity.run(
      'Parent', 'p1', 'person', '["root entity"]', null, 5, null,
      '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z',
    );
    insEntity.run(
      'Child', 'p2', 'person', '["child of Parent, mentions zephyr"]', '["x"]', 2, 'Parent',
      '2024-01-02T00:00:00.000Z', '2024-01-02T00:00:00.000Z',
    );
    db.prepare(
      'INSERT INTO relations (fromEntity, toEntity, relationType, createdAt, lastModified, weight) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      'Child', 'Parent', 'child_of',
      '2024-01-02T00:00:00.000Z', '2024-01-02T00:00:00.000Z', 0.75,
    );
    record.storageSchemaFts = describe(
      db
        .prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name')
        .all('"zephyr"'),
    );
    record.storageSchemaParent = describe(
      db.prepare('SELECT name, parentId FROM entities ORDER BY name').all(),
    );
    // ON DELETE SET NULL on parentId, ON DELETE CASCADE on relations.
    db.prepare('DELETE FROM entities WHERE name = ?').run('Parent');
    record.storageSchemaAfterCascade = describe({
      entities: db.prepare('SELECT name, parentId FROM entities ORDER BY name').all(),
      relations: db.prepare('SELECT fromEntity, toEntity FROM relations').all(),
    });
    record.storageSchemaFtsAfterCascade = describe(
      db
        .prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name')
        .all('"zephyr"'),
    );
    db.close();
  }

  return record;
}
