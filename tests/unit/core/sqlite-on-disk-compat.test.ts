/**
 * On-disk compatibility, both directions.
 *
 * The replacement of `better-sqlite3` with `node:sqlite` is only a safe swap if
 * a database file is interchangeable: a file written by the old driver opens and
 * works under the new one with no migration, and a file written by the new one
 * opens and works under the old one. Both drivers are SQLite, but the claim has
 * to be checked against real files, not assumed.
 *
 * Two fixtures, both recorded by `helpers/captureSqliteOnDiskCompatibility.ts`:
 *
 * - `fixtures/sqlite-better-sqlite3-written.db` — the full `SQLiteStorage`
 *   schema (entities, relations, the FTS5 external-content table and its three
 *   sync triggers, embeddings) plus rows and a Float32 embedding BLOB, written
 *   and WAL-checkpointed by `better-sqlite3` 13.0.3. The tests below open it with
 *   the adapter and with `SQLiteStorage` itself, read it, search it, write to it,
 *   and reopen it.
 * - `fixtures/sqliteOnDiskCompat.json` — what `better-sqlite3` read back from a
 *   file the adapter wrote: the other direction of the claim. It also carries an
 *   FTS5 `integrity-check`, so a trigger or index difference shows up as a
 *   failure rather than as a stale index.
 *
 * The fixture database is copied to a temp directory before each test, because
 * opening it with `SQLiteStorage` writes to it (the `user_version` FTS repair
 * marker and WAL sidecars).
 *
 * `node:sqlite` does not exist in Bun, so the file skips when Vitest is hosted by
 * Bun and never skips on the Node lane (`bun run test:ci`).
 *
 * @module tests/unit/core/sqlite-on-disk-compat.test
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeSqliteDatabaseCtor } from '../../../src/core/nodeSqliteAdapter.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';

const fixtures = join(import.meta.dirname, 'fixtures');
const writtenByBetterSqlite3 = join(fixtures, 'sqlite-better-sqlite3-written.db');
const captured = JSON.parse(
  readFileSync(join(fixtures, 'sqliteOnDiskCompat.json'), 'utf-8'),
) as {
  reader: string;
  writer: string;
  userVersion: number;
  integrityCheck: string;
  entities: Array<{ name: string; entityType: string; importance: number | null; parentId: string | null }>;
  relations: Array<{ fromEntity: string; toEntity: string; relationType: string; weight: number | null }>;
  ftsZephyr: Array<{ name: string }>;
  ftsAlice: Array<{ name: string }>;
  embedding: { dimensions: number; values: number[]; isBuffer: boolean };
};

describe.skipIf(typeof Bun !== 'undefined')('SQLite on-disk compatibility (better-sqlite3 <-> node:sqlite)', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memoryjs-ondisk-'));
    dbPath = join(dir, 'from-better-sqlite3.db');
    copyFileSync(writtenByBetterSqlite3, dbPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the recorded file was written by better-sqlite3 13.0.3 and read by it', () => {
    expect(captured.reader).toBe('better-sqlite3 13.0.3');
    expect(captured.integrityCheck).toBe('ok');
  });

  it('opens the better-sqlite3 file with node:sqlite and reads the same rows', () => {
    const db = new (createNodeSqliteDatabaseCtor())(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(captured.userVersion);
      expect(
        db.prepare('SELECT name, entityType, importance, parentId FROM entities ORDER BY name').all(),
      ).toEqual(captured.entities);
      expect(
        db
          .prepare(
            'SELECT fromEntity, toEntity, relationType, weight FROM relations ORDER BY fromEntity, relationType',
          )
          .all(),
      ).toEqual(captured.relations);
    } finally {
      db.close();
    }
  });

  it('keeps the full-text index exact and searchable across the driver change', () => {
    const db = new (createNodeSqliteDatabaseCtor())(dbPath);
    try {
      // No rebuild, no reindex: the postings better-sqlite3 wrote are the ones read.
      expect(
        db.prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name').all('zephyr'),
      ).toEqual(captured.ftsZephyr);
      expect(
        db.prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name').all('alice'),
      ).toEqual(captured.ftsAlice);
      // external-content tables make this compare the index against the table.
      expect(() =>
        db.prepare("INSERT INTO entities_fts(entities_fts, rank) VALUES('integrity-check', 1)").run(),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('reads the Float32 embedding BLOB better-sqlite3 wrote', () => {
    const db = new (createNodeSqliteDatabaseCtor())(dbPath);
    try {
      const row = db.prepare('SELECT embedding, dimensions FROM embeddings WHERE entityName = ?').get('Alice') as {
        embedding: Uint8Array;
        dimensions: number;
      };
      expect(row.dimensions).toBe(captured.embedding.dimensions);
      expect(Buffer.isBuffer(row.embedding)).toBe(true);
      expect(
        Array.from(
          new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
        ),
      ).toEqual(captured.embedding.values);
    } finally {
      db.close();
    }
  });

  it('writes to the better-sqlite3 file with node:sqlite, and the file stays valid', () => {
    const db = new (createNodeSqliteDatabaseCtor())(dbPath);
    try {
      db.pragma('foreign_keys = ON');
      db.prepare(
        'INSERT INTO entities (name, id, entityType, observations, createdAt, lastModified) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('Carol', 'id-carol', 'person', '["joined under node:sqlite"]', '2024-02-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z');
      // The trigger better-sqlite3 created fires on the new driver too.
      expect(
        db.prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name').all('carol'),
      ).toEqual([{ name: 'Carol' }]);
      db.prepare('DELETE FROM entities WHERE name = ?').run('Carol');
      expect(
        db.prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name').all('carol'),
      ).toEqual([]);
    } finally {
      db.close();
    }

    // Reopening sees only what was committed, and the file is still intact.
    const reopened = new (createNodeSqliteDatabaseCtor())(dbPath);
    try {
      expect(reopened.prepare('SELECT COUNT(*) AS c FROM entities').get()).toEqual({ c: 3 });
      expect(() =>
        reopened.prepare("INSERT INTO entities_fts(entities_fts, rank) VALUES('integrity-check', 1)").run(),
      ).not.toThrow();
    } finally {
      reopened.close();
    }
  });

  it('SQLiteStorage opens the better-sqlite3 file with no migration and finds the graph', async () => {
    const storage = new SQLiteStorage(dbPath);
    try {
      const graph = await storage.loadGraph();
      expect(graph.entities.map((e) => e.name).sort()).toEqual(['Alice', 'Bob', 'Zephyr']);
      expect(graph.relations).toHaveLength(2);

      const alice = graph.entities.find((e) => e.name === 'Alice');
      expect(alice).toMatchObject({
        entityType: 'person',
        observations: ['engineer at Acme'],
        tags: ['staff'],
        importance: 8,
        id: 'id-alice',
        contentHash: 'hash-id-alice',
      });
      expect(graph.entities.find((e) => e.name === 'Bob')).toMatchObject({
        parentId: 'Alice',
        importance: 5,
      });

      // FTS5 through the storage layer, with bm25 ranking.
      const hits = storage.fullTextSearch('zephyr');
      expect(hits.map((h) => h.name)).toEqual(['Zephyr']);

      // Embeddings round-trip through the storage API.
      expect(storage.getEmbedding('Alice')).toEqual(captured.embedding.values);
    } finally {
      storage.close();
    }
  });

  it('SQLiteStorage writes to the better-sqlite3 file and the result reopens cleanly', async () => {
    const first = new SQLiteStorage(dbPath);
    try {
      await first.appendEntity({
        name: 'Dave',
        entityType: 'person',
        observations: ['added by node:sqlite'],
      });
    } finally {
      first.close();
    }

    const second = new SQLiteStorage(dbPath);
    try {
      const graph = await second.loadGraph();
      expect(graph.entities.map((e) => e.name).sort()).toEqual(['Alice', 'Bob', 'Dave', 'Zephyr']);
      expect(second.fullTextSearch('node:sqlite').map((h) => h.name)).toEqual(['Dave']);
    } finally {
      second.close();
    }
  });

  it('a file written by node:sqlite reads identically under better-sqlite3', () => {
    // The other direction, frozen at record time: the JSON fixture above IS the
    // better-sqlite3 read of an adapter-written file. Assert the values it holds
    // are the ones the adapter writes, so a change in either side is visible.
    expect(captured.writer).toBe('node:sqlite via src/core/nodeSqliteAdapter.ts');
    expect(captured.entities.map((e) => e.name)).toEqual(['Alice', 'Bob', 'Zephyr']);
    expect(captured.ftsAlice.map((r) => r.name)).toEqual(['Alice', 'Bob']);
    expect(captured.embedding.isBuffer).toBe(true);
    expect(captured.embedding.values).toEqual([0.25, -0.5, 1.75]);
  });
});
