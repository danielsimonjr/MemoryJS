/**
 * 15 - SQLite backend: FTS5 full-text search, persistence across contexts, and close().
 *
 * Run: bun run examples/15-sqlite.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../src/index.js';
import { SQLiteStorage } from '../src/sqlite.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  // storageType 'sqlite' selects SQLiteStorage (MEMORY_STORAGE_TYPE, when set, takes precedence).
  const ctx = new ManagerContext({ storagePath, storageType: 'sqlite' });
  const isSqlite = ctx.storage instanceof SQLiteStorage;
  try {
    await ctx.entityManager.createEntities([
      { name: 'Ledger', entityType: 'doc', observations: ['Quarterly refund ledger for billing'], importance: 6 },
      { name: 'Runbook', entityType: 'doc', observations: ['Steps for shipping labels'] },
    ]);

    // FTS5 with BM25 ranking, reached through the storage backend.
    const storage: unknown = ctx.storage;
    const ranked = storage instanceof SQLiteStorage
      ? storage.fullTextSearch('refund ledger', { limit: 5 })
      : [];

    // The same search surface as the JSONL backend.
    const matches = await ctx.searchManager.searchNodes('shipping');

    // Writes are durable: a fresh context on the same file sees them. close() is idempotent.
    ctx.close();
    const reopened = new ManagerContext({ storagePath, storageType: 'sqlite' });
    const persisted = await reopened.entityManager.getEntity('Ledger');
    reopened.close();

    return {
      isSqlite,
      ftsTop: ranked[0]?.name ?? null,
      ftsHasScore: ranked.length > 0 && ranked[0].score !== 0,
      searchHits: matches.entities.map((e) => e.name),
      persistedAcrossContexts: persisted?.importance === 6,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-15-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.db')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
