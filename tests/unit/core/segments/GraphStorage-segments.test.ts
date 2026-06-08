/**
 * GraphStorage <-> FileSegmentStorage wiring tests
 *
 * Covers Phase 7 task 62: `GraphStorage` routes load/save/append
 * paths through `FileSegmentStorage` when
 * `MEMORY_STORAGE_SEGMENT_COUNT >= 2` is set. Tests assert behavioral
 * equivalence with the single-file path so the env var is a pure
 * deployment knob, not a semantic change.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import type { Entity, Relation } from '../../../../src/types/index.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `gs-seg-test-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function ent(name: string, extras: Partial<Entity> = {}): Entity {
  return {
    name,
    entityType: 'thing',
    observations: [],
    createdAt: '2026-05-11T00:00:00Z',
    lastModified: '2026-05-11T00:00:00Z',
    ...extras,
  };
}

describe('GraphStorage + segments wiring', () => {
  let testDir: string;
  let filePath: string;
  const savedEnv = process.env.MEMORY_STORAGE_SEGMENT_COUNT;

  beforeEach(async () => {
    testDir = await makeDir();
    filePath = join(testDir, 'memory.jsonl');
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
    else process.env.MEMORY_STORAGE_SEGMENT_COUNT = savedEnv;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      /* swallow cleanup */
    }
  });

  describe('env var resolution', () => {
    it('unset → single-file mode (no segments/ dir created)', async () => {
      delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('alice')], relations: [] });
      await expect(fs.access(join(testDir, 'segments'))).rejects.toThrow();
      await expect(fs.access(filePath)).resolves.toBeUndefined();
    });

    it('=1 → single-file mode (degraded gracefully)', async () => {
      process.env.MEMORY_STORAGE_SEGMENT_COUNT = '1';
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('alice')], relations: [] });
      await expect(fs.access(join(testDir, 'segments'))).rejects.toThrow();
    });

    it('=4 → segments/ dir created, no single file', async () => {
      process.env.MEMORY_STORAGE_SEGMENT_COUNT = '4';
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('alice')], relations: [] });
      const segDir = join(testDir, 'segments');
      await expect(fs.access(segDir)).resolves.toBeUndefined();
      const files = await fs.readdir(segDir);
      expect(files.some((f) => f.endsWith('.jsonl'))).toBe(true);
    });

    it('non-integer value falls back to single-file mode', async () => {
      process.env.MEMORY_STORAGE_SEGMENT_COUNT = 'abc';
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('alice')], relations: [] });
      await expect(fs.access(join(testDir, 'segments'))).rejects.toThrow();
    });
  });

  describe('round-trip parity (single-file vs segments=4)', () => {
    const graph = {
      entities: [ent('alice'), ent('bob'), ent('carol'), ent('dave'), ent('eve')],
      relations: [
        { from: 'alice', to: 'bob', relationType: 'knows', createdAt: 't', lastModified: 't' } as Relation,
        { from: 'carol', to: 'dave', relationType: 'knows', createdAt: 't', lastModified: 't' } as Relation,
      ],
    };

    it('=4 saveGraph → loadGraph returns the same entity/relation set', async () => {
      process.env.MEMORY_STORAGE_SEGMENT_COUNT = '4';
      const storage = new GraphStorage(filePath);
      await storage.saveGraph(graph);
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.entities.map((e) => e.name).sort()).toEqual(
        graph.entities.map((e) => e.name).sort(),
      );
      expect(back.relations).toHaveLength(2);
    });

    it('saveGraph in segments=4 then loadGraph in a fresh instance reads the same data', async () => {
      process.env.MEMORY_STORAGE_SEGMENT_COUNT = '4';
      const storage1 = new GraphStorage(filePath);
      await storage1.saveGraph(graph);

      // Fresh instance simulates a process restart.
      const storage2 = new GraphStorage(filePath);
      const back = await storage2.loadGraph();
      expect(back.entities).toHaveLength(5);
    });

    it('loading a missing segments/ dir returns an empty graph', async () => {
      process.env.MEMORY_STORAGE_SEGMENT_COUNT = '4';
      const storage = new GraphStorage(filePath);
      const back = await storage.loadGraph();
      expect(back.entities).toEqual([]);
      expect(back.relations).toEqual([]);
    });
  });

  describe('append paths (appendEntity / appendRelation / updateEntity) in segment mode', () => {
    beforeEach(() => {
      process.env.MEMORY_STORAGE_SEGMENT_COUNT = '4';
    });

    it('appendEntity persists to segment files and is readable on reload', async () => {
      const storage = new GraphStorage(filePath);
      await storage.loadGraph(); // initialize cache
      await storage.appendEntity(ent('alice'));
      await storage.appendEntity(ent('bob'));

      const fresh = new GraphStorage(filePath);
      const back = await fresh.loadGraph();
      expect(back.entities.map((e) => e.name).sort()).toEqual(['alice', 'bob']);
    });

    it('appendRelation persists and survives reload', async () => {
      const storage = new GraphStorage(filePath);
      await storage.loadGraph();
      await storage.appendEntity(ent('alice'));
      await storage.appendEntity(ent('bob'));
      await storage.appendRelation({
        from: 'alice',
        to: 'bob',
        relationType: 'knows',
        createdAt: 't',
        lastModified: 't',
      });

      const fresh = new GraphStorage(filePath);
      const back = await fresh.loadGraph();
      expect(back.relations).toHaveLength(1);
      expect(back.relations[0]).toMatchObject({ from: 'alice', to: 'bob' });
    });

    it('updateEntity persists changes and survives reload', async () => {
      const storage = new GraphStorage(filePath);
      await storage.loadGraph();
      await storage.appendEntity(ent('alice', { observations: ['original'] }));

      const updated = await storage.updateEntity('alice', {
        observations: ['updated'],
      });
      expect(updated).toBe(true);

      const fresh = new GraphStorage(filePath);
      const back = await fresh.loadGraph();
      const alice = back.entities.find((e) => e.name === 'alice');
      expect(alice?.observations).toEqual(['updated']);
    });

    it('updateEntity returns false for an unknown entity', async () => {
      const storage = new GraphStorage(filePath);
      await storage.loadGraph();
      const result = await storage.updateEntity('ghost', { observations: ['x'] });
      expect(result).toBe(false);
    });
  });

  describe('cross-segment scaling', () => {
    it('100 entities across 8 segments round-trip', async () => {
      process.env.MEMORY_STORAGE_SEGMENT_COUNT = '8';
      const entities = Array.from({ length: 100 }, (_, i) => ent(`e${i}`));
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities, relations: [] });

      const fresh = new GraphStorage(filePath);
      const back = await fresh.loadGraph();
      expect(back.entities).toHaveLength(100);
    });
  });
});
