/**
 * IncrementalIndexer queue operations (CL-17 enqueue)
 *
 * Covers the shared enqueue path used by queueCreate / queueUpdate / queueDelete:
 * shutdown rejection, last-write-wins per entity, payload shape, and auto-flush.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { IncrementalIndexer } from '../../../src/search/IncrementalIndexer.js';
import type { EmbeddingService, IVectorStore } from '../../../src/types/index.js';

function makeEmbedding(): EmbeddingService {
  return {
    isConfigured: () => true,
    getDimensions: () => 4,
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4]),
    embedBatch: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => [0.1, 0.2, 0.3, 0.4])),
    ),
    getProviderName: () => 'mock',
    getModelName: () => 'mock-model',
  } as unknown as EmbeddingService;
}

function makeStore(): IVectorStore {
  return {
    add: vi.fn(),
    remove: vi.fn(),
    findNearest: vi.fn().mockReturnValue([]),
    has: vi.fn().mockReturnValue(false),
    size: vi.fn().mockReturnValue(0),
    clear: vi.fn(),
    getMemoryUsage: vi.fn().mockReturnValue({ vectorBytes: 0, metadataBytes: 0, totalBytes: 0, vectorCount: 0 }),
  } as unknown as IVectorStore;
}

describe('IncrementalIndexer queue (enqueue)', () => {
  let indexer: IncrementalIndexer | undefined;

  afterEach(async () => {
    if (indexer) await indexer.shutdown();
    indexer = undefined;
    vi.useRealTimers();
  });

  function create(flushThreshold = 1000): IncrementalIndexer {
    indexer = new IncrementalIndexer(makeEmbedding(), makeStore(), {
      flushThreshold,
      flushIntervalMs: 60_000,
    });
    return indexer;
  }

  it('stores create and update ops with type, entityName, text and queuedAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const idx = create();
    idx.queueCreate('a', 'text a');
    idx.queueUpdate('b', 'text b');

    const queue = idx.getQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0]).toStrictEqual({
      type: 'create',
      entityName: 'a',
      text: 'text a',
      queuedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    });
    expect(queue[1]).toStrictEqual({
      type: 'update',
      entityName: 'b',
      text: 'text b',
      queuedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    });
  });

  it('stores delete ops without a text key', () => {
    const idx = create();
    idx.queueDelete('gone');
    const [op] = idx.getQueue();
    expect(op).toBeDefined();
    expect(Object.keys(op!)).toEqual(['type', 'entityName', 'queuedAt']);
    expect(op!.type).toBe('delete');
  });

  it('keeps only the latest operation for an entity (last write wins)', () => {
    const idx = create();
    idx.queueCreate('a', 'first');
    idx.queueUpdate('other', 'x');
    idx.queueDelete('a');
    const queue = idx.getQueue();
    expect(queue.map((o) => [o.entityName, o.type])).toEqual([
      ['other', 'update'],
      ['a', 'delete'],
    ]);
  });

  it('rejects every queue method after shutdown with the same message', async () => {
    const idx = create();
    await idx.shutdown();
    expect(() => idx.queueCreate('a', 't')).toThrow('Indexer is shutdown');
    expect(() => idx.queueUpdate('a', 't')).toThrow('Indexer is shutdown');
    expect(() => idx.queueDelete('a')).toThrow('Indexer is shutdown');
    indexer = undefined;
  });

  it('schedules an auto-flush once the queue reaches flushThreshold', async () => {
    const embedding = makeEmbedding();
    const store = makeStore();
    indexer = new IncrementalIndexer(embedding, store, { flushThreshold: 2, flushIntervalMs: 60_000 });
    indexer.queueCreate('a', 'alpha');
    expect(indexer.getQueueSize()).toBe(1);
    indexer.queueCreate('b', 'beta');
    // auto-flush runs on setImmediate; wait one macrotask for it to start and finish
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(indexer.getQueueSize()).toBe(0);
    expect(store.add).toHaveBeenCalledTimes(2);
  });
});
