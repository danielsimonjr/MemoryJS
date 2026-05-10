/**
 * BackgroundIndexer Smoke Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import {
  BackgroundIndexer,
  makeTFIDFUpdater,
  type IndexUpdater,
} from '../../../src/search/BackgroundIndexer.js';
import { TFIDFIndexManager } from '../../../src/search/TFIDFIndexManager.js';

describe('BackgroundIndexer', () => {
  let storage: GraphStorage;
  let dir: string;
  const ORIGINAL = process.env.MEMORY_INDEX_UPDATE_MODE;

  beforeEach(async () => {
    dir = join(tmpdir(), `bg-indexer-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    storage = new GraphStorage(join(dir, 'mem.jsonl'));
    await storage.saveGraph({ entities: [], relations: [] });
  });

  afterEach(async () => {
    storage.clearCache();
    await fs.rm(dir, { recursive: true, force: true });
    if (ORIGINAL === undefined) delete process.env.MEMORY_INDEX_UPDATE_MODE;
    else process.env.MEMORY_INDEX_UPDATE_MODE = ORIGINAL;
  });

  function makeUpdater(name: string): IndexUpdater & { upserts: string[]; deletes: string[] } {
    const upserts: string[] = [];
    const deletes: string[] = [];
    return {
      name,
      upserts,
      deletes,
      applyUpsert(entityName) {
        upserts.push(entityName);
      },
      applyDelete(entityName) {
        deletes.push(entityName);
      },
    };
  }

  it('disabled when MEMORY_INDEX_UPDATE_MODE is unset', () => {
    delete process.env.MEMORY_INDEX_UPDATE_MODE;
    const indexer = new BackgroundIndexer(storage, storage.events);
    expect(indexer.enabled).toBe(false);
    indexer.start();
    expect(indexer.pendingSize()).toBe(0);
  });

  it('enabled queues entity-created events but does not apply until flush', async () => {
    process.env.MEMORY_INDEX_UPDATE_MODE = 'async';
    const indexer = new BackgroundIndexer(storage, storage.events, { intervalMs: 60_000 });
    const updater = makeUpdater('tfidf');
    indexer.registerUpdater(updater);
    indexer.start();

    storage.events.emitEntityCreated({ name: 'A', entityType: 'note', observations: [] });
    expect(indexer.pendingSize()).toBe(1);
    expect(updater.upserts).toEqual([]);

    const applied = await indexer.flush();
    expect(applied).toBe(1);
    expect(updater.upserts).toEqual(['A']);
    expect(indexer.pendingSize()).toBe(0);

    indexer.stop();
  });

  it('coalesces consecutive ops on the same entity per the merge rules', async () => {
    process.env.MEMORY_INDEX_UPDATE_MODE = 'async';
    const indexer = new BackgroundIndexer(storage, storage.events, { intervalMs: 60_000 });
    const updater = makeUpdater('tfidf');
    indexer.registerUpdater(updater);
    indexer.start();

    storage.events.emitEntityCreated({ name: 'A', entityType: 'note', observations: [] });
    storage.events.emitEntityUpdated('A', { observations: [] });
    storage.events.emitEntityUpdated('A', { observations: ['final'] });

    expect(indexer.pendingSize()).toBe(1); // single coalesced op
    await indexer.flush();
    expect(updater.upserts).toEqual(['A']);
    expect(updater.deletes).toEqual([]);

    indexer.stop();
  });

  it('delete-then-create resolves to upsert (entity reinstated)', async () => {
    process.env.MEMORY_INDEX_UPDATE_MODE = 'async';
    const indexer = new BackgroundIndexer(storage, storage.events, { intervalMs: 60_000 });
    const updater = makeUpdater('tfidf');
    indexer.registerUpdater(updater);
    indexer.start();

    storage.events.emitEntityDeleted('A');
    storage.events.emitEntityCreated({ name: 'A', entityType: 'note', observations: [] });

    await indexer.flush();
    expect(updater.upserts).toEqual(['A']);
    expect(updater.deletes).toEqual([]);

    indexer.stop();
  });

  it('upsert-then-delete resolves to delete', async () => {
    process.env.MEMORY_INDEX_UPDATE_MODE = 'async';
    const indexer = new BackgroundIndexer(storage, storage.events, { intervalMs: 60_000 });
    const updater = makeUpdater('tfidf');
    indexer.registerUpdater(updater);
    indexer.start();

    storage.events.emitEntityCreated({ name: 'A', entityType: 'note', observations: [] });
    storage.events.emitEntityDeleted('A');

    await indexer.flush();
    expect(updater.upserts).toEqual([]);
    expect(updater.deletes).toEqual(['A']);

    indexer.stop();
  });

  it('updater errors are logged but do not abort the flush', async () => {
    process.env.MEMORY_INDEX_UPDATE_MODE = 'async';
    const indexer = new BackgroundIndexer(storage, storage.events, { intervalMs: 60_000 });
    const failing: IndexUpdater = {
      name: 'failing',
      applyUpsert: vi.fn(() => {
        throw new Error('boom');
      }),
      applyDelete: vi.fn(),
    };
    const ok = makeUpdater('ok');
    indexer.registerUpdater(failing);
    indexer.registerUpdater(ok);
    indexer.start();

    storage.events.emitEntityCreated({ name: 'A', entityType: 'note', observations: [] });
    await indexer.flush();
    // Failing updater attempted, ok updater still ran.
    expect(failing.applyUpsert).toHaveBeenCalled();
    expect(ok.upserts).toEqual(['A']);

    indexer.stop();
  });

  it('unregisterUpdater removes a registered updater', async () => {
    process.env.MEMORY_INDEX_UPDATE_MODE = 'async';
    const indexer = new BackgroundIndexer(storage, storage.events, { intervalMs: 60_000 });
    const updater = makeUpdater('tfidf');
    indexer.registerUpdater(updater);
    indexer.unregisterUpdater('tfidf');
    indexer.start();

    storage.events.emitEntityCreated({ name: 'A', entityType: 'note', observations: [] });
    await indexer.flush();
    expect(updater.upserts).toEqual([]);

    indexer.stop();
  });

  describe('makeTFIDFUpdater factory', () => {
    it('upserts a known entity into the TFIDFIndexManager', async () => {
      process.env.MEMORY_INDEX_UPDATE_MODE = 'async';
      const indexManager = new TFIDFIndexManager(dir);
      // Build a minimal index so isInitialized() returns true.
      await indexManager.buildIndex({ entities: [], relations: [] });

      // Persist the entity into storage so getEntityByName resolves it.
      await storage.saveGraph({
        entities: [{ name: 'A', entityType: 'note', observations: ['hello world'] }],
        relations: [],
      });

      const indexer = new BackgroundIndexer(storage, storage.events, { intervalMs: 60_000 });
      indexer.registerUpdater(makeTFIDFUpdater(indexManager));
      indexer.start();

      storage.events.emitEntityCreated({ name: 'A', entityType: 'note', observations: ['hello world'] });
      await indexer.flush();
      expect(indexManager.getDocumentCount()).toBe(1);

      indexer.stop();
    });

    it('removes a deleted entity from the TFIDFIndexManager', async () => {
      process.env.MEMORY_INDEX_UPDATE_MODE = 'async';
      const indexManager = new TFIDFIndexManager(dir);
      await indexManager.buildIndex({
        entities: [{ name: 'A', entityType: 'note', observations: ['hello'] }],
        relations: [],
      });
      expect(indexManager.getDocumentCount()).toBe(1);

      const indexer = new BackgroundIndexer(storage, storage.events, { intervalMs: 60_000 });
      indexer.registerUpdater(makeTFIDFUpdater(indexManager));
      indexer.start();

      storage.events.emitEntityDeleted('A');
      await indexer.flush();
      expect(indexManager.getDocumentCount()).toBe(0);

      indexer.stop();
    });

    it('upsert is a no-op when the index has not been built', async () => {
      process.env.MEMORY_INDEX_UPDATE_MODE = 'async';
      const indexManager = new TFIDFIndexManager(dir);
      // buildIndex NOT called — isInitialized() is false.
      await storage.saveGraph({
        entities: [{ name: 'A', entityType: 'note', observations: [] }],
        relations: [],
      });

      const indexer = new BackgroundIndexer(storage, storage.events, { intervalMs: 60_000 });
      indexer.registerUpdater(makeTFIDFUpdater(indexManager));
      indexer.start();

      storage.events.emitEntityCreated({ name: 'A', entityType: 'note', observations: [] });
      await indexer.flush();
      expect(indexManager.isInitialized()).toBe(false);
      expect(indexManager.getDocumentCount()).toBe(0);

      indexer.stop();
    });
  });
});
