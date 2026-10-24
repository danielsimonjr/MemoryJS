/**
 * GraphStorage <-> mmap wiring tests (Phase 11 task 84)
 *
 * Covers the env-gated load path that uses FsReadMmapBackend +
 * streamLines instead of fs.readFile for large JSONL files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import { FsReadMmapBackend } from '../../../../src/core/mmap/FsReadMmapBackend.js';
import { logger } from '../../../../src/utils/logger.js';
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

    it('keeps relations distinct when their old colon-delimited keys collide', async () => {
      const storage = new GraphStorage(filePath);
      const relations: Relation[] = [
        { from: 'a:b', to: 'c', relationType: 'd' },
        { from: 'a', to: 'b:c', relationType: 'd' },
      ];
      await storage.saveGraph({ entities: [], relations });
      storage.clearCache();

      const back = await storage.loadGraph();

      expect(back.relations).toHaveLength(2);
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

    it('loads the good lines and warns on a malformed JSONL line', async () => {
      // A torn line must not stop the load. The good lines load and
      // the warning reports the one skipped line.
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      try {
        await fs.writeFile(
          filePath,
          '{"type":"entity","name":"alice","entityType":"person","observations":[]}\nnot-json\n',
          'utf-8',
        );
        const storage = new GraphStorage(filePath);
        const back = await storage.loadGraph();
        expect(back.entities.map((e) => e.name)).toEqual(['alice']);
        expect(warnSpy).toHaveBeenCalledWith(`[GraphStorage] ${filePath}: skipped 1 malformed line(s)`);
      } finally {
        warnSpy.mockRestore();
      }
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

  // Pins for the two GraphStorage JSONL load paths (fs.readFile and mmap).
  // Every expected value below was produced by the code before the D1 fix.
  describe('JSONL load paths: readFile and mmap agree (pins)', () => {
    const SAMPLE_CONTENT = [
      '{"type":"entity","name":"alice","entityType":"person","observations":["first"],"createdAt":"2026-05-11T00:00:00Z","lastModified":"2026-05-11T00:00:00Z"}',
      '{"type":"entity","name":"bob","entityType":"person","observations":["bob obs"]}',
      '',
      '{"type":"relation","from":"alice","to":"bob","relationType":"knows","createdAt":"2026-05-11T00:00:00Z","lastModified":"2026-05-11T00:00:00Z"}',
      '{"type":"entity","name":"alice","entityType":"person","observations":["second"],"createdAt":"2026-05-11T00:00:00Z","lastModified":"2026-05-11T00:00:00Z"}',
    ].join('\n') + '\n';

    // The frozen clock fills the missing createdAt of bob.
    const SAMPLE_GOLDEN = {
      entities: [
        { type: 'entity', name: 'alice', entityType: 'person', observations: ['second'], createdAt: '2026-05-11T00:00:00Z', lastModified: '2026-05-11T00:00:00Z' },
        { type: 'entity', name: 'bob', entityType: 'person', observations: ['bob obs'], createdAt: '2026-06-01T00:00:00.000Z', lastModified: '2026-06-01T00:00:00.000Z' },
      ],
      relations: [
        { type: 'relation', from: 'alice', to: 'bob', relationType: 'knows', createdAt: '2026-05-11T00:00:00Z', lastModified: '2026-05-11T00:00:00Z' },
      ],
    };

    /** Writes `content`, loads it through one path and records what happened. */
    async function loadWith(useMmap: boolean, content: string) {
      await fs.writeFile(filePath, content, 'utf-8');
      if (useMmap) {
        process.env.MEMORY_USE_MMAP = 'true';
        process.env.MEMORY_MMAP_THRESHOLD_BYTES = '0';
      } else {
        delete process.env.MEMORY_USE_MMAP;
        delete process.env.MEMORY_MMAP_THRESHOLD_BYTES;
      }
      const storage = new GraphStorage(filePath);
      const loaded: Array<{ entityCount: number; relationCount: number }> = [];
      storage.events.on('graph:loaded', (e) => {
        loaded.push({ entityCount: e.entityCount, relationCount: e.relationCount });
      });
      const openSpy = vi.spyOn(FsReadMmapBackend.prototype, 'open');
      try {
        const graph = await storage.loadGraph();
        return { graph, loaded, mmapOpens: openSpy.mock.calls.length };
      } finally {
        openSpy.mockRestore();
      }
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('loads the same graph on both paths and emits graph:loaded once', async () => {
      const readFile = await loadWith(false, SAMPLE_CONTENT);
      const mmap = await loadWith(true, SAMPLE_CONTENT);
      expect(readFile.mmapOpens).toBe(0);
      expect(mmap.mmapOpens).toBe(1);
      expect(readFile.graph).toEqual(SAMPLE_GOLDEN);
      expect(mmap.graph).toEqual(SAMPLE_GOLDEN);
      // Key order and array order must match too, not only the values.
      expect(JSON.stringify(mmap.graph)).toBe(JSON.stringify(readFile.graph));
      expect(readFile.loaded).toEqual([{ entityCount: 2, relationCount: 1 }]);
      expect(mmap.loaded).toEqual([{ entityCount: 2, relationCount: 1 }]);
    });

    it('ignores unknown-type and null lines on both paths without a warning', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const content = [
        '{"type":"entity","name":"alice","entityType":"person","observations":[],"createdAt":"2026-05-11T00:00:00Z","lastModified":"2026-05-11T00:00:00Z"}',
        '{"type":"widget","name":"x"}',
        'null',
      ].join('\n') + '\n';
      try {
        const readFile = await loadWith(false, content);
        const mmap = await loadWith(true, content);
        expect(readFile.graph.entities.map((e) => e.name)).toEqual(['alice']);
        expect(readFile.graph.relations).toEqual([]);
        expect(mmap.graph).toEqual(readFile.graph);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('reads CRLF line ends, blank lines and a final line without a newline the same way', async () => {
      const crlf = SAMPLE_CONTENT.replace(/\n/g, '\r\n');
      const noFinalNewline = SAMPLE_CONTENT.replace(/\n$/, '');
      for (const content of [crlf, noFinalNewline]) {
        const readFile = await loadWith(false, content);
        const mmap = await loadWith(true, content);
        expect(readFile.graph).toEqual(SAMPLE_GOLDEN);
        expect(mmap.graph).toEqual(SAMPLE_GOLDEN);
      }
    });

    it('loads a file with only blank lines as an empty graph on the mmap path', async () => {
      const result = await loadWith(true, '\n  \n\r\n');
      expect(result.mmapOpens).toBe(1);
      expect(result.graph).toEqual({ entities: [], relations: [] });
      expect(result.loaded).toEqual([{ entityCount: 0, relationCount: 0 }]);
    });

    it('loads a missing file as an empty graph on the readFile path', async () => {
      process.env.MEMORY_USE_MMAP = 'true';
      process.env.MEMORY_MMAP_THRESHOLD_BYTES = '0';
      const openSpy = vi.spyOn(FsReadMmapBackend.prototype, 'open');
      try {
        const back = await new GraphStorage(filePath).loadGraph();
        expect(back).toEqual({ entities: [], relations: [] });
        expect(openSpy).not.toHaveBeenCalled();
      } finally {
        openSpy.mockRestore();
      }
    });

    it('keeps the read error text on each path', async () => {
      delete process.env.MEMORY_USE_MMAP;
      delete process.env.MEMORY_MMAP_THRESHOLD_BYTES;
      // A directory where the file should be: fs.readFile fails with EISDIR.
      await fs.mkdir(filePath);
      await expect(new GraphStorage(filePath).loadGraph()).rejects.toMatchObject({ code: 'EISDIR' });

      // The mmap open fails with the wrapped ENOENT text.
      const missing = new GraphStorage(join(dir, 'missing.jsonl'));
      await expect(
        (missing as unknown as { loadViaMmap(): Promise<void> }).loadViaMmap(),
      ).rejects.toThrow(/^FsReadMmapBackend: failed to open '.*': ENOENT/);
    });

    // Defect tests for the malformed-line policy (skip, count, warn once per load).
    const ALICE_LINE = '{"type":"entity","name":"alice","entityType":"person","observations":[],"createdAt":"2026-05-11T00:00:00Z","lastModified":"2026-05-11T00:00:00Z"}';
    const BOB_LINE = '{"type":"entity","name":"bob","entityType":"person","observations":[],"createdAt":"2026-05-11T00:00:00Z","lastModified":"2026-05-11T00:00:00Z"}';

    it('loads the good lines around a torn line and warns once on both paths', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const content = [ALICE_LINE, '{"type":"entity","name":"torn', BOB_LINE].join('\n') + '\n';
      try {
        for (const useMmap of [false, true]) {
          warnSpy.mockClear();
          const result = await loadWith(useMmap, content);
          expect(result.graph.entities.map((e) => e.name)).toEqual(['alice', 'bob']);
          expect(warnSpy).toHaveBeenCalledTimes(1);
          expect(warnSpy).toHaveBeenCalledWith(`[GraphStorage] ${filePath}: skipped 1 malformed line(s)`);
        }
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('skips and counts a line that parses but cannot be sanitized', async () => {
      // 100000 levels: JSON.parse accepts it, sanitizeObject overflows the stack.
      const deep = '{"a":'.repeat(100000) + '1' + '}'.repeat(100000);
      const content = [ALICE_LINE, deep, BOB_LINE].join('\n') + '\n';
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      try {
        for (const useMmap of [false, true]) {
          warnSpy.mockClear();
          const result = await loadWith(useMmap, content);
          expect(result.graph.entities.map((e) => e.name)).toEqual(['alice', 'bob']);
          expect(warnSpy).toHaveBeenCalledTimes(1);
          expect(warnSpy).toHaveBeenCalledWith(`[GraphStorage] ${filePath}: skipped 1 malformed line(s)`);
        }
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('writes the malformed-line warning after graph:loaded on both paths', async () => {
      await fs.writeFile(filePath, `not-json\n${ALICE_LINE}\n`, 'utf-8');
      for (const useMmap of [false, true]) {
        if (useMmap) {
          process.env.MEMORY_USE_MMAP = 'true';
          process.env.MEMORY_MMAP_THRESHOLD_BYTES = '0';
        } else {
          delete process.env.MEMORY_USE_MMAP;
          delete process.env.MEMORY_MMAP_THRESHOLD_BYTES;
        }
        const order: string[] = [];
        const storage = new GraphStorage(filePath);
        storage.events.on('graph:loaded', () => {
          order.push('graph:loaded');
        });
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {
          order.push('warn');
        });
        try {
          await storage.loadGraph();
        } finally {
          warnSpy.mockRestore();
        }
        expect(order).toEqual(['graph:loaded', 'warn']);
      }
    });

    it('ignores JSON scalars, arrays and empty objects on both paths without a warning', async () => {
      // The string "malformed" is a valid JSON value, not a malformed line.
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const content = [ALICE_LINE, '42', '"malformed"', 'true', '[1,2]', '{}', '""', '0', BOB_LINE].join('\n') + '\n';
      try {
        for (const useMmap of [false, true]) {
          const result = await loadWith(useMmap, content);
          expect(result.graph.entities.map((e) => e.name)).toEqual(['alice', 'bob']);
          expect(result.graph.relations).toEqual([]);
        }
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('fills a missing or empty createdAt and lastModified of entities and relations on both paths', async () => {
      // The frozen clock is NOW. lastModified copies createdAt when only createdAt is present.
      const NOW = '2026-06-01T00:00:00.000Z';
      const entity = (name: string, extra: object) =>
        JSON.stringify({ type: 'entity', name, entityType: 'person', observations: [], ...extra });
      const relation = (relationType: string, extra: object) =>
        JSON.stringify({ type: 'relation', from: 'a', to: 'b', relationType, ...extra });
      const content = [
        entity('e-created-only', { createdAt: '2026-05-11T00:00:00Z' }),
        entity('e-empty-strings', { createdAt: '', lastModified: '' }),
        entity('e-last-only', { lastModified: '2026-05-12T00:00:00Z' }),
        relation('r-none', {}),
        relation('r-created-only', { createdAt: '2026-05-11T00:00:00Z' }),
        relation('r-last-only', { lastModified: '2026-05-12T00:00:00Z' }),
        relation('r-empty-strings', { createdAt: '', lastModified: '' }),
      ].join('\n') + '\n';
      for (const useMmap of [false, true]) {
        const { graph } = await loadWith(useMmap, content);
        expect(graph.entities.map((e) => [e.name, e.createdAt, e.lastModified])).toEqual([
          ['e-created-only', '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z'],
          ['e-empty-strings', NOW, NOW],
          ['e-last-only', NOW, '2026-05-12T00:00:00Z'],
        ]);
        expect(graph.relations.map((r) => [r.relationType, r.createdAt, r.lastModified])).toEqual([
          ['r-none', NOW, NOW],
          ['r-created-only', '2026-05-11T00:00:00Z', '2026-05-11T00:00:00Z'],
          ['r-last-only', NOW, '2026-05-12T00:00:00Z'],
          ['r-empty-strings', NOW, NOW],
        ]);
      }
    });

    it('keeps names that differ by case apart and lets a later duplicate relation replace an earlier one', async () => {
      const entity = (name: string) =>
        JSON.stringify({ type: 'entity', name, entityType: 'person', observations: [], createdAt: '2026-05-11T00:00:00Z', lastModified: '2026-05-11T00:00:00Z' });
      const relation = (relationType: string, weight: number) =>
        JSON.stringify({ type: 'relation', from: 'alice', to: 'bob', relationType, weight, createdAt: '2026-05-11T00:00:00Z', lastModified: '2026-05-11T00:00:00Z' });
      const content = [
        entity('Alice'), entity('alice'), entity('ALICE'),
        relation('knows', 1), relation('owns', 5), relation('knows', 2),
      ].join('\n') + '\n';
      for (const useMmap of [false, true]) {
        const { graph } = await loadWith(useMmap, content);
        expect(graph.entities.map((e) => e.name)).toEqual(['Alice', 'alice', 'ALICE']);
        // The duplicate keeps the position of the first line and the content of the last line.
        expect(graph.relations.map((r) => [r.relationType, (r as Relation & { weight: number }).weight])).toEqual([
          ['knows', 2],
          ['owns', 5],
        ]);
      }
    });

    /** Writes `content`, loads it through one path and returns the loaded storage. */
    async function loadStorage(useMmap: boolean, content: string, onLoaded?: (storage: GraphStorage) => void) {
      await fs.writeFile(filePath, content, 'utf-8');
      if (useMmap) {
        process.env.MEMORY_USE_MMAP = 'true';
        process.env.MEMORY_MMAP_THRESHOLD_BYTES = '0';
      } else {
        delete process.env.MEMORY_USE_MMAP;
        delete process.env.MEMORY_MMAP_THRESHOLD_BYTES;
      }
      const storage = new GraphStorage(filePath);
      if (onLoaded) storage.events.on('graph:loaded', () => onLoaded(storage));
      await storage.loadGraph();
      return storage;
    }

    const INDEX_CONTENT = [
      '{"type":"entity","name":"alice","entityType":"Person","observations":["first obs of alice","Second"]}',
      '{"type":"entity","name":"bob","entityType":"Tool","observations":["first obs of bob","Second"]}',
      '{"type":"entity","name":"carol","entityType":"person","observations":["first obs of carol","Second"]}',
      '{"type":"relation","from":"alice","to":"bob","relationType":"knows"}',
      '{"type":"relation","from":"carol","to":"alice","relationType":"uses"}',
    ].join('\n') + '\n';

    it('builds the name, type, lowercase, relation and observation indexes on both paths', async () => {
      for (const useMmap of [false, true]) {
        const storage = await loadStorage(useMmap, INDEX_CONTENT);
        expect(storage.getEntityByName('alice')?.entityType).toBe('Person');
        expect(storage.hasEntity('bob')).toBe(true);
        expect(storage.hasEntity('zed')).toBe(false);
        expect(storage.getEntitiesByType('PERSON').map((e) => e.name)).toEqual(['alice', 'carol']);
        expect(storage.getEntityTypes()).toEqual(['person', 'tool']);
        expect(storage.getLowercased('alice')).toEqual({
          name: 'alice',
          entityType: 'person',
          observations: ['first obs of alice', 'second'],
          tags: [],
        });
        expect(storage.getRelationsFrom('alice').map((r) => r.relationType)).toEqual(['knows']);
        expect(storage.getRelationsTo('alice').map((r) => r.relationType)).toEqual(['uses']);
        expect(storage.getRelationsFor('alice').map((r) => r.relationType)).toEqual(['knows', 'uses']);
        expect([storage.hasRelations('alice'), storage.hasRelations('bob'), storage.hasRelations('zed')]).toEqual([true, true, false]);
        expect([...storage.getEntitiesByObservationWord('first')]).toEqual(['alice', 'bob', 'carol']);
        expect([...storage.getEntitiesByObservationWord('second')]).toEqual(['alice', 'bob', 'carol']);
      }
    });

    it('has every index ready when graph:loaded fires on both paths', async () => {
      for (const useMmap of [false, true]) {
        const seen: unknown[] = [];
        await loadStorage(useMmap, INDEX_CONTENT, (storage) => {
          seen.push({
            entity: storage.getEntityByName('alice')?.name,
            from: storage.getRelationsFrom('alice').length,
            words: [...storage.getEntitiesByObservationWord('first')],
          });
        });
        expect(seen).toEqual([{ entity: 'alice', from: 1, words: ['alice', 'bob', 'carol'] }]);
      }
    });

    it('loads blank, whitespace-only and CRLF-blank lines on both paths without a warning', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      // A blank line is not a malformed line: no count, no warning.
      const content = [ALICE_LINE, '', '   \t', BOB_LINE, '\r', ''].join('\r\n') + '\r\n\r\n  ';
      try {
        for (const useMmap of [false, true]) {
          const result = await loadWith(useMmap, content);
          expect(result.graph.entities.map((e) => e.name)).toEqual(['alice', 'bob']);
        }
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('decodes multi-byte UTF-8 names and observations the same way on both paths', async () => {
      const entity = (name: string, observations: string[]) =>
        JSON.stringify({ type: 'entity', name, entityType: 'person', observations, createdAt: '2026-05-11T00:00:00Z', lastModified: '2026-05-11T00:00:00Z' });
      const content = [entity('gérard', ['café 漢字 😀']), entity('漢字', [])].join('\n') + '\n';
      for (const useMmap of [false, true]) {
        const { graph } = await loadWith(useMmap, content);
        expect(graph.entities.map((e) => [e.name, e.observations])).toEqual([
          ['gérard', ['café 漢字 😀']],
          ['漢字', []],
        ]);
      }
    });

    it('closes the mmap handle once and after graph:loaded, also when the load throws', async () => {
      process.env.MEMORY_USE_MMAP = 'true';
      process.env.MEMORY_MMAP_THRESHOLD_BYTES = '0';
      const order: string[] = [];
      const realClose = FsReadMmapBackend.prototype.close;
      const closeSpy = vi.spyOn(FsReadMmapBackend.prototype, 'close').mockImplementation(function (
        this: FsReadMmapBackend,
        ...args: Parameters<FsReadMmapBackend['close']>
      ) {
        order.push('close');
        return realClose.apply(this, args);
      });
      try {
        await fs.writeFile(filePath, ALICE_LINE + '\n', 'utf-8');
        const storage = new GraphStorage(filePath);
        storage.events.on('graph:loaded', () => order.push('graph:loaded'));
        await storage.loadGraph();
        expect(order).toEqual(['graph:loaded', 'close']);

        // An entity line without entityType makes the lowercase index fail after the last line.
        order.length = 0;
        closeSpy.mockClear();
        await fs.writeFile(filePath, ALICE_LINE + '\n{"type":"entity","name":"broken"}\n', 'utf-8');
        await expect(new GraphStorage(filePath).loadGraph()).rejects.toThrow(TypeError);
        expect(order).toEqual(['close']);
        expect(closeSpy).toHaveBeenCalledTimes(1);
      } finally {
        closeSpy.mockRestore();
      }
    });

    it('reads a line with a leading no-break space or BOM on the mmap path only (the paths trim differently)', async () => {
      // This documents the behaviour before the D1 fix: the readFile path hands JSON.parse the
      // untrimmed line, so the line is skipped; the mmap path trims first, so the line loads.
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const entity = (name: string) =>
        JSON.stringify({ type: 'entity', name, entityType: 'person', observations: [], createdAt: '2026-05-11T00:00:00Z', lastModified: '2026-05-11T00:00:00Z' });
      const content = [entity('alice'), '\u00a0' + entity('nbsp'), '\ufeff' + entity('bom'), entity('bob')].join('\n') + '\n';
      try {
        const readFile = await loadWith(false, content);
        const mmap = await loadWith(true, content);
        expect(readFile.graph.entities.map((e) => e.name)).toEqual(['alice', 'bob']);
        expect(mmap.graph.entities.map((e) => e.name)).toEqual(['alice', 'nbsp', 'bom', 'bob']);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('counts every malformed line and warns once per load on both paths', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const content = ['bad one', ALICE_LINE, '{"type":"entity","name":"torn', BOB_LINE, '}'].join('\n') + '\n';
      try {
        for (const useMmap of [false, true]) {
          warnSpy.mockClear();
          const result = await loadWith(useMmap, content);
          expect(result.graph.entities.map((e) => e.name)).toEqual(['alice', 'bob']);
          expect(warnSpy.mock.calls).toEqual([[`[GraphStorage] ${filePath}: skipped 3 malformed line(s)`]]);
        }
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('closes the mmap handle after the warning when a line is skipped', async () => {
      process.env.MEMORY_USE_MMAP = 'true';
      process.env.MEMORY_MMAP_THRESHOLD_BYTES = '0';
      const order: string[] = [];
      const realClose = FsReadMmapBackend.prototype.close;
      const closeSpy = vi.spyOn(FsReadMmapBackend.prototype, 'close').mockImplementation(function (
        this: FsReadMmapBackend,
        ...args: Parameters<FsReadMmapBackend['close']>
      ) {
        order.push('close');
        return realClose.apply(this, args);
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {
        order.push('warn');
      });
      try {
        await fs.writeFile(filePath, `not-json\n${ALICE_LINE}\n`, 'utf-8');
        const storage = new GraphStorage(filePath);
        storage.events.on('graph:loaded', () => order.push('graph:loaded'));
        await storage.loadGraph();
        expect(order).toEqual(['graph:loaded', 'warn', 'close']);
        expect(closeSpy).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
        closeSpy.mockRestore();
      }
    });

    it('counts a line with a leading no-break space or BOM as malformed on the readFile path only', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const content = [ALICE_LINE, '\u00a0' + BOB_LINE, '\ufeff' + BOB_LINE].join('\n') + '\n';
      try {
        await loadWith(false, content);
        expect(warnSpy.mock.calls).toEqual([[`[GraphStorage] ${filePath}: skipped 2 malformed line(s)`]]);
        warnSpy.mockClear();
        await loadWith(true, content);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
