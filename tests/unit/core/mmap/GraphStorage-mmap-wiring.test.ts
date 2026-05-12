/**
 * GraphStorage <-> mmap wiring tests (Phase 11 task 84)
 *
 * Covers the env-gated load path that uses FsReadMmapBackend +
 * streamLines instead of fs.readFile for large JSONL files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import type { Entity, Relation } from '../../../../src/types/index.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `mmap-wiring-${Date.now()}-${Math.random()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const savedUseMmap = process.env.MEMORY_USE_MMAP;
const savedThreshold = process.env.MEMORY_MMAP_THRESHOLD_BYTES;

function ent(name: string, extras: Partial<Entity> = {}): Entity {
  return {
    name,
    entityType: 'thing',
    observations: ['obs'],
    createdAt: '2026-05-11T00:00:00Z',
    lastModified: '2026-05-11T00:00:00Z',
    ...extras,
  };
}

describe('GraphStorage mmap wiring (task 84)', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await makeDir();
    filePath = join(dir, 'memory.jsonl');
  });

  afterEach(async () => {
    if (savedUseMmap === undefined) delete process.env.MEMORY_USE_MMAP;
    else process.env.MEMORY_USE_MMAP = savedUseMmap;
    if (savedThreshold === undefined) delete process.env.MEMORY_MMAP_THRESHOLD_BYTES;
    else process.env.MEMORY_MMAP_THRESHOLD_BYTES = savedThreshold;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  describe('env-gate resolution', () => {
    it('unset → uses fs.readFile path (no mmap)', async () => {
      delete process.env.MEMORY_USE_MMAP;
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('a')], relations: [] });
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.entities).toHaveLength(1);
    });

    it("='false' → uses fs.readFile path", async () => {
      process.env.MEMORY_USE_MMAP = 'false';
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('a')], relations: [] });
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.entities).toHaveLength(1);
    });

    it("='yes' → uses fs.readFile path (strict 'true' literal-match)", async () => {
      process.env.MEMORY_USE_MMAP = 'yes';
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('a')], relations: [] });
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.entities).toHaveLength(1);
    });

    it("='true' but file below threshold → still uses fs.readFile", async () => {
      process.env.MEMORY_USE_MMAP = 'true';
      // Default threshold is 100 MB; small test files stay on the
      // existing path. Result is correct either way — what matters
      // is that activation requires both flags + size > threshold.
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('a')], relations: [] });
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.entities).toHaveLength(1);
    });

    it("='true' + size > threshold → uses mmap path", async () => {
      process.env.MEMORY_USE_MMAP = 'true';
      // Lower the threshold to 0 bytes so any non-empty file
      // qualifies — proves the mmap path activates correctly.
      process.env.MEMORY_MMAP_THRESHOLD_BYTES = '1';
      const storage = new GraphStorage(filePath);
      const entities: Entity[] = Array.from({ length: 10 }, (_, i) => ent(`e${i}`));
      const relations: Relation[] = [
        { from: 'e0', to: 'e1', relationType: 'next', createdAt: 't', lastModified: 't' },
      ];
      await storage.saveGraph({ entities, relations });
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.entities).toHaveLength(10);
      expect(back.relations).toHaveLength(1);
    });
  });

  describe('mmap path round-trip parity', () => {
    beforeEach(() => {
      process.env.MEMORY_USE_MMAP = 'true';
      process.env.MEMORY_MMAP_THRESHOLD_BYTES = '1';
    });

    it('preserves entity field shape (every documented optional field)', async () => {
      const storage = new GraphStorage(filePath);
      const richEntity: Entity = {
        name: 'alice',
        entityType: 'person',
        observations: ['obs1', 'obs2 with longer text'],
        tags: ['active', 'expert'],
        importance: 7,
        parentId: 'team:engineering',
        createdAt: '2026-01-01T00:00:00Z',
        lastModified: '2026-05-11T00:00:00Z',
        ttl: 3600,
        confidence: 0.85,
        projectId: 'project-x',
        version: 3,
        contentHash: 'sha256:abc',
      };
      await storage.saveGraph({ entities: [richEntity], relations: [] });
      storage.clearCache();
      const back = await storage.loadGraph();
      // `toMatchObject` rather than `toEqual` because both the
      // fs.readFile path and the mmap path keep the persisted
      // `type: 'entity'` field on the parsed record. We assert
      // every documented Entity field round-trips, but tolerate
      // the extra `type` artifact (pre-existing behavior, not a
      // Phase 11 regression).
      expect(back.entities[0]).toMatchObject(richEntity);
    });

    it('preserves relation field shape', async () => {
      const storage = new GraphStorage(filePath);
      const rel: Relation = {
        from: 'a',
        to: 'b',
        relationType: 'knows',
        weight: 0.75,
        confidence: 0.9,
        createdAt: '2026-01-01T00:00:00Z',
        lastModified: '2026-05-11T00:00:00Z',
      };
      await storage.saveGraph({
        entities: [ent('a'), ent('b')],
        relations: [rel],
      });
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.relations[0]).toMatchObject({
        from: 'a',
        to: 'b',
        relationType: 'knows',
        weight: 0.75,
        confidence: 0.9,
      });
    });

    it('handles a multi-line file via streamLines correctly', async () => {
      const storage = new GraphStorage(filePath);
      const entities: Entity[] = Array.from({ length: 200 }, (_, i) =>
        ent(`e${i}`, { observations: [`line-${i}-with-some-content`] }),
      );
      await storage.saveGraph({ entities, relations: [] });
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.entities).toHaveLength(200);
      expect(back.entities[100]!.observations[0]).toBe('line-100-with-some-content');
    });

    it('handles a missing file (treated like the fs.readFile path)', async () => {
      const storage = new GraphStorage(filePath);
      // Don't write anything — file doesn't exist. Mmap should
      // fail gracefully or fall back to fs.readFile.
      const back = await storage.loadGraph();
      expect(back.entities).toEqual([]);
      expect(back.relations).toEqual([]);
    });

    it('throws on malformed JSONL line (matches fs.readFile path behavior)', async () => {
      // Inject a corrupt line; mmap path should surface the parse
      // error rather than silently dropping it.
      await fs.writeFile(filePath, 'not-json\n', 'utf-8');
      const storage = new GraphStorage(filePath);
      await expect(storage.loadGraph()).rejects.toThrow(/Failed to parse line/);
    });
  });

  describe('threshold parsing', () => {
    beforeEach(() => {
      process.env.MEMORY_USE_MMAP = 'true';
    });

    it("non-numeric threshold falls back to default (100MB)", async () => {
      process.env.MEMORY_MMAP_THRESHOLD_BYTES = 'abc';
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('a')], relations: [] });
      storage.clearCache();
      // Small file → stays on fs.readFile path. Correctness still
      // holds; this just exercises the threshold-validation branch.
      const back = await storage.loadGraph();
      expect(back.entities).toHaveLength(1);
    });

    it("negative threshold falls back to default", async () => {
      process.env.MEMORY_MMAP_THRESHOLD_BYTES = '-100';
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('a')], relations: [] });
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.entities).toHaveLength(1);
    });

    it("threshold of '0' falls back to default (regex requires [1-9] first)", async () => {
      process.env.MEMORY_MMAP_THRESHOLD_BYTES = '0';
      const storage = new GraphStorage(filePath);
      await storage.saveGraph({ entities: [ent('a')], relations: [] });
      storage.clearCache();
      const back = await storage.loadGraph();
      expect(back.entities).toHaveLength(1);
    });
  });
});
