import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { SQLiteVectorStore, InMemoryVectorStore } from '../../../src/search/VectorStore.js';

describe('ManagerContext semantic search vector store', () => {
  const originalStorageType = process.env.MEMORY_STORAGE_TYPE;
  const originalProvider = process.env.MEMORY_EMBEDDING_PROVIDER;
  let dir: string;
  let ctx: ManagerContext | undefined;

  beforeEach(() => {
    delete process.env.MEMORY_STORAGE_TYPE;
    process.env.MEMORY_EMBEDDING_PROVIDER = 'local';
    dir = mkdtempSync(join(tmpdir(), 'mctx-vector-'));
  });

  afterEach(() => {
    try {
      if (originalStorageType === undefined) {
        delete process.env.MEMORY_STORAGE_TYPE;
      } else {
        process.env.MEMORY_STORAGE_TYPE = originalStorageType;
      }
      if (originalProvider === undefined) {
        delete process.env.MEMORY_EMBEDDING_PROVIDER;
      } else {
        process.env.MEMORY_EMBEDDING_PROVIDER = originalProvider;
      }
    } finally {
      ctx?.close();
      ctx = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses SQLiteVectorStore for SQLite storage', () => {
    ctx = new ManagerContext({ storagePath: join(dir, 'm.db'), storageType: 'sqlite' });
    expect(ctx.semanticSearch!.getVectorStore()).toBeInstanceOf(SQLiteVectorStore);
  });

  it('uses InMemoryVectorStore for JSONL storage', () => {
    ctx = new ManagerContext(join(dir, 'm.jsonl'));
    expect(ctx.semanticSearch!.getVectorStore()).toBeInstanceOf(InMemoryVectorStore);
  });

  it('returns null semantic search when the provider is none', () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
    ctx = new ManagerContext({ storagePath: join(dir, 'm.db'), storageType: 'sqlite' });
    expect(ctx.semanticSearch).toBeNull();
  });
});
