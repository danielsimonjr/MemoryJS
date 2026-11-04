/**
 * DES-1: storage capability guards. Real GraphStorage and SQLiteStorage
 * instances must satisfy the delta/lock guards; a minimal fake must not.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import {
  hasDeltaPrimitives,
  hasWriteLock,
  withStorageWriteLock,
} from '../../../src/core/storageCapabilities.js';
import type { IGraphStorage } from '../../../src/types/index.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('storageCapabilities (DES-1)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `des1-caps-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('hasDeltaPrimitives', () => {
    it('is true for a real GraphStorage', () => {
      const storage = new GraphStorage(join(dir, 'graph.jsonl'));
      expect(hasDeltaPrimitives(storage)).toBe(true);
    });

    it('is true for a real SQLiteStorage', () => {
      const storage = new SQLiteStorage(join(dir, 'graph.db'));
      try {
        expect(hasDeltaPrimitives(storage)).toBe(true);
      } finally {
        storage.close();
      }
    });

    it('is false for a minimal fake that lacks the batch primitives', () => {
      const fake = {
        loadGraph: async () => ({ entities: [], relations: [] }),
        getFilePath: () => join(dir, 'fake.jsonl'),
      } as unknown as IGraphStorage;
      expect(hasDeltaPrimitives(fake)).toBe(false);
    });

    it('is false when only some of the five primitives are present', () => {
      const partial = {
        appendEntities: async () => undefined,
        appendRelations: async () => undefined,
        updateEntities: async () => [],
        deleteEntities: async () => ({ deletedEntities: [], deletedRelations: [] }),
      } as unknown as IGraphStorage;
      expect(hasDeltaPrimitives(partial)).toBe(false);
    });
  });

  describe('hasWriteLock', () => {
    it('is true for real GraphStorage and SQLiteStorage', () => {
      const graph = new GraphStorage(join(dir, 'graph.jsonl'));
      const sqlite = new SQLiteStorage(join(dir, 'graph.db'));
      try {
        expect(hasWriteLock(graph)).toBe(true);
        expect(hasWriteLock(sqlite)).toBe(true);
      } finally {
        sqlite.close();
      }
    });

    it('is false for a fake without graphMutex', () => {
      const fake = { loadGraph: async () => ({ entities: [], relations: [] }) } as unknown as IGraphStorage;
      expect(hasWriteLock(fake)).toBe(false);
    });
  });

  describe('withStorageWriteLock', () => {
    it('serialises two concurrent callers on a real storage', async () => {
      const storage = new GraphStorage(join(dir, 'graph.jsonl'));
      const events: string[] = [];

      const run = (label: string, ms: number) =>
        withStorageWriteLock(storage, async () => {
          events.push(`${label}:start`);
          await sleep(ms);
          events.push(`${label}:end`);
          return label;
        });

      const results = await Promise.all([run('a', 30), run('b', 5)]);

      expect(results).toEqual(['a', 'b']);
      expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    });

    it('releases the lock when the callback throws', async () => {
      const storage = new GraphStorage(join(dir, 'graph.jsonl'));
      await expect(
        withStorageWriteLock(storage, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const after = await withStorageWriteLock(storage, async () => 'free');
      expect(after).toBe('free');
    });

    it('runs immediately on a fake without graphMutex', async () => {
      const fake = {} as IGraphStorage;
      const value = await withStorageWriteLock(fake, async () => 42);
      expect(value).toBe(42);
    });
  });
});
