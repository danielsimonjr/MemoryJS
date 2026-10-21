import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

type RawDb = {
  pragma: (q: string) => Array<{ name: string }>;
  exec: (sql: string) => void;
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
};

const entity = (name: string) => ({
  name,
  entityType: 'note',
  observations: ['x'],
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
});

const VECTOR = [0.5, 0.25, -1];

describe('SQLiteStorage embeddings contentHash', () => {
  let dir: string;
  let storage: SQLiteStorage | null = null;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'memoryjs-emb-hash-'));
    storage = null;
  });

  afterEach(() => {
    if (storage) {
      storage.close();
      storage = null;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const rawDb = (s: SQLiteStorage): RawDb => (s as unknown as { db: RawDb }).db;

  it('creates the embeddings table with a contentHash column', async () => {
    storage = new SQLiteStorage(path.join(dir, 'memory.db'));
    await storage.saveGraph({ entities: [entity('a')], relations: [] });
    storage.storeEmbedding('a', VECTOR, 'm');

    const names = rawDb(storage).pragma('table_info(embeddings)').map((c) => c.name);

    expect(names).toContain('contentHash');
  });

  it('stores and loads the contentHash', async () => {
    storage = new SQLiteStorage(path.join(dir, 'memory.db'));
    await storage.saveGraph({ entities: [entity('a')], relations: [] });
    storage.storeEmbedding('a', VECTOR, 'm', 'h1');

    expect(await storage.loadEmbeddingMetadata()).toEqual([
      { entityName: 'a', embeddingModel: 'm', contentHash: 'h1' },
    ]);
  });

  it('stores null when the contentHash is omitted', async () => {
    storage = new SQLiteStorage(path.join(dir, 'memory.db'));
    await storage.saveGraph({ entities: [entity('a')], relations: [] });
    storage.storeEmbedding('a', VECTOR, 'm');

    const meta = await storage.loadEmbeddingMetadata();

    expect(meta).toHaveLength(1);
    expect(meta[0].contentHash).toBeNull();
  });

  it('replaces the contentHash on a second store', async () => {
    storage = new SQLiteStorage(path.join(dir, 'memory.db'));
    await storage.saveGraph({ entities: [entity('a')], relations: [] });
    storage.storeEmbedding('a', VECTOR, 'm', 'h1');
    storage.storeEmbedding('a', VECTOR, 'm', 'h2');

    const meta = await storage.loadEmbeddingMetadata();

    expect(meta).toHaveLength(1);
    expect(meta[0].contentHash).toBe('h2');
  });

  it('returns an empty list when no embedding exists', async () => {
    storage = new SQLiteStorage(path.join(dir, 'memory.db'));
    await storage.loadGraph();

    expect(await storage.loadEmbeddingMetadata()).toEqual([]);
  });

  it('adds the column to an old embeddings table on open', async () => {
    const dbPath = path.join(dir, 'memory.db');

    const storage1 = new SQLiteStorage(dbPath);
    await storage1.saveGraph({ entities: [entity('a')], relations: [] });
    rawDb(storage1).exec('DROP TABLE IF EXISTS embeddings');
    rawDb(storage1).exec(`
      CREATE TABLE embeddings (
        entityName TEXT PRIMARY KEY REFERENCES entities(name) ON DELETE CASCADE,
        embedding BLOB NOT NULL,
        embeddingModel TEXT NOT NULL,
        embeddingUpdatedAt TEXT NOT NULL,
        dimensions INTEGER NOT NULL
      )
    `);
    rawDb(storage1)
      .prepare(
        'INSERT INTO embeddings (entityName, embedding, embeddingModel, embeddingUpdatedAt, dimensions) VALUES (?, ?, ?, ?, ?)',
      )
      .run('a', Buffer.from(new Float32Array(VECTOR).buffer), 'm', new Date().toISOString(), 3);
    storage1.close();

    storage = new SQLiteStorage(dbPath);
    await storage.loadGraph();

    const names = rawDb(storage).pragma('table_info(embeddings)').map((c) => c.name);
    const meta = await storage.loadEmbeddingMetadata();

    expect(names).toContain('contentHash');
    expect(meta).toEqual([{ entityName: 'a', embeddingModel: 'm', contentHash: null }]);
    expect(storage.getEmbedding('a')).toEqual(VECTOR);
  });

  it('deleteEntities removes the embedding row', async () => {
    storage = new SQLiteStorage(path.join(dir, 'memory.db'));
    await storage.saveGraph({ entities: [entity('a'), entity('b')], relations: [] });
    storage.storeEmbedding('a', VECTOR, 'm');
    storage.storeEmbedding('b', VECTOR, 'm');

    await storage.deleteEntities(['a']);

    expect(storage.hasEmbedding('a')).toBe(false);
    expect(storage.hasEmbedding('b')).toBe(true);
    expect(await storage.loadEmbeddingMetadata()).toHaveLength(1);
  });
});
