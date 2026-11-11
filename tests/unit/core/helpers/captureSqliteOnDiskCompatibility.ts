/**
 * One-time recorder for the on-disk compatibility fixtures.
 *
 * The claim Sprint 9 has to prove is bidirectional: a database file written by
 * `better-sqlite3` opens and works under `node:sqlite` with no migration, and a
 * file written by `node:sqlite` opens and works under `better-sqlite3`. Both
 * drivers are the same SQLite, but the claim is only worth having if it is
 * checked against a real file from each side, so this recorder writes one with
 * the real package and reads one written by the adapter.
 *
 * It produces:
 *
 * - `fixtures/sqlite-better-sqlite3-written.db` — the full `SQLiteStorage`
 *   schema (entities, relations, the FTS5 external-content table, all three
 *   sync triggers, embeddings) plus rows, WAL checkpointed by `better-sqlite3`.
 *   `sqlite-on-disk-compat.test.ts` opens this file with the adapter and with
 *   `SQLiteStorage`, reads it, searches it, writes to it and reopens it.
 * - `fixtures/sqliteOnDiskCompat.json` — what `better-sqlite3` read back from a
 *   file the adapter wrote, which is the other direction of the same claim.
 *
 * Run it against a scratch install (`better-sqlite3` is no longer a dependency):
 *
 *   mkdir -p /tmp/bs3 && cd /tmp/bs3 && npm init -y && npm install better-sqlite3@13.0.3
 *   BETTER_SQLITE3_PATH=/tmp/bs3/node_modules/better-sqlite3 \
 *     npx tsx tests/unit/core/helpers/captureSqliteOnDiskCompatibility.ts
 *
 * @module tests/unit/core/helpers/captureSqliteOnDiskCompatibility
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNodeSqliteDatabaseCtor } from '../../../../src/core/nodeSqliteAdapter.js';
import type { CorpusCtor } from './sqliteDriverCases.js';

const packagePath = process.env.BETTER_SQLITE3_PATH;
if (!packagePath) {
  throw new Error(
    'Set BETTER_SQLITE3_PATH to a better-sqlite3@13.0.3 install path before recording ' +
      '(see the header of this file).',
  );
}

const require = createRequire(join(packagePath, 'package.json'));
const BetterSqlite3 = require(packagePath) as CorpusCtor;

const fixtures = resolve(import.meta.dirname, '..', 'fixtures');
const tmp = mkdtempSync(join(tmpdir(), 'memoryjs-ondisk-'));
const nodeCtor: CorpusCtor = createNodeSqliteDatabaseCtor() as unknown as CorpusCtor;

/** The schema `SQLiteStorage` creates, in the order it creates it. */
const STORAGE_SCHEMA = `
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
`;

/** The rows both sides write, so the two files hold the same graph. */
const ENTITIES: ReadonlyArray<readonly [string, string, string, string, string | null, number | null, string | null]> = [
  ['Alice', 'id-alice', 'person', '["engineer at Acme"]', '["staff"]', 8, null],
  ['Bob', 'id-bob', 'person', '["designer, works with Alice"]', null, 5, 'Alice'],
  ['Zephyr', 'id-zephyr', 'project', '["weather balloon programme"]', '["science"]', 9, null],
];

/** The subset of a connection `seed` needs. */
interface SeedTarget {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
  pragma(source: string, options?: { simple?: boolean }): unknown;
}

/** Insert the shared graph into an open database. */
function seed(db: SeedTarget): void {
  db.exec(STORAGE_SCHEMA);
  const ins = db.prepare(
    'INSERT INTO entities (name, id, entityType, observations, tags, importance, createdAt, lastModified, parentId, contentHash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [name, id, type, observations, tags, importance, parentId] of ENTITIES) {
    ins.run(
      name,
      id,
      type,
      observations,
      tags,
      importance,
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T00:00:00.000Z',
      parentId,
      `hash-${id}`,
    );
  }
  db.prepare(
    'INSERT INTO relations (fromEntity, toEntity, relationType, createdAt, lastModified, weight, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('Bob', 'Alice', 'works_with', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', 0.9, 0.8);
  db.prepare(
    'INSERT INTO relations (fromEntity, toEntity, relationType, createdAt, lastModified, weight, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('Zephyr', 'Alice', 'led_by', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', null, null);
  // A Float32 embedding BLOB, the shape `storeEmbedding` writes.
  const vector = new Float32Array([0.25, -0.5, 1.75]);
  db.prepare(
    'INSERT INTO embeddings (entityName, embedding, embeddingModel, embeddingUpdatedAt, dimensions, contentHash) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('Alice', Buffer.from(vector.buffer), 'test-model', '2024-01-01T00:00:00.000Z', 3, 'hash-id-alice');
  db.pragma('user_version = 1');
}

try {
  // 1. Write the fixture file with the real package.
  const bs3Path = join(fixtures, 'sqlite-better-sqlite3-written.db');
  const bs3 = new BetterSqlite3(bs3Path);
  bs3.pragma('journal_mode = WAL');
  bs3.pragma('foreign_keys = ON');
  seed(bs3 as unknown as SeedTarget);
  bs3.pragma('wal_checkpoint(TRUNCATE)');
  bs3.close();

  // 2. Write a file with the adapter, then read it back with the real package.
  const nodePath = join(tmp, 'node-written.db');
  const node = new nodeCtor(nodePath);
  node.pragma('journal_mode = WAL');
  node.pragma('foreign_keys = ON');
  seed(node as unknown as SeedTarget);
  node.pragma('wal_checkpoint(TRUNCATE)');
  node.close();

  const readBack = new BetterSqlite3(nodePath);
  const captured = {
    reader: 'better-sqlite3 13.0.3',
    writer: 'node:sqlite via src/core/nodeSqliteAdapter.ts',
    userVersion: readBack.pragma('user_version', { simple: true }),
    integrityCheck: (() => {
      try {
        readBack.prepare("INSERT INTO entities_fts(entities_fts, rank) VALUES('integrity-check', 1)").run();
        return 'ok';
      } catch (error) {
        return `failed: ${(error as Error).message}`;
      }
    })(),
    entities: readBack.prepare('SELECT name, entityType, importance, parentId FROM entities ORDER BY name').all(),
    relations: readBack
      .prepare('SELECT fromEntity, toEntity, relationType, weight FROM relations ORDER BY fromEntity, relationType')
      .all(),
    ftsZephyr: readBack
      .prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name')
      .all('zephyr'),
    ftsAlice: readBack
      .prepare('SELECT name FROM entities_fts WHERE entities_fts MATCH ? ORDER BY name')
      .all('alice'),
    embedding: (() => {
      const row = readBack.prepare('SELECT embedding, dimensions FROM embeddings WHERE entityName = ?').get('Alice') as {
        embedding: Uint8Array;
        dimensions: number;
      };
      return {
        dimensions: row.dimensions,
        values: Array.from(
          new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
        ),
        isBuffer: Buffer.isBuffer(row.embedding),
      };
    })(),
  };
  readBack.close();

  writeFileSync(
    join(fixtures, 'sqliteOnDiskCompat.json'),
    `${JSON.stringify(captured, null, 2)}\n`,
  );
  console.log(`wrote ${bs3Path} and ${join(fixtures, 'sqliteOnDiskCompat.json')}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
