/**
 * FileSegmentStorage tests
 *
 * Covers Phase 7 task 60 (JSONL-per-segment backend) + task 61
 * (`findOutgoingRelations` / `findIncomingRelations` lookup
 * helpers).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileSegmentStorage } from '../../../../src/core/segments/FileSegmentStorage.js';
import {
  FnvSegmentRouter,
} from '../../../../src/core/segments/ISegmentStorage.js';
import type { Entity, KnowledgeGraph, Relation } from '../../../../src/types/types.js';

/**
 * Probe once whether this environment can create symlinks. Windows denies
 * symlink creation without Developer Mode or elevation (EPERM). The probe
 * decides skip versus run; it never weakens the assertion where symlinks work.
 */
function probeSymlinkSupport(): { ok: true } | { ok: false; reason: string } {
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'fss-symlink-probe-'));
    const target = join(dir, 'target');
    writeFileSync(target, '');
    symlinkSync(target, join(dir, 'link'));
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? String(err);
    return { ok: false, reason: `this environment cannot create symlinks (${code})` };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
const symlinkSupport = probeSymlinkSupport();

function ent(name: string, entityType = 'thing', observations: string[] = []): Entity {
  return { name, entityType, observations };
}

function makeStore(rootDir: string, segmentCount = 4): FileSegmentStorage {
  return new FileSegmentStorage(rootDir, new FnvSegmentRouter(segmentCount));
}

describe('FileSegmentStorage', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `file-segment-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  });

  describe('basic round-trip', () => {
    it('saveAll → loadAll preserves a small graph across 4 segments', async () => {
      const store = makeStore(testDir, 4);
      const graph: KnowledgeGraph = {
        entities: [ent('alice'), ent('bob'), ent('carol'), ent('dave')],
        relations: [
          { from: 'alice', to: 'bob', relationType: 'knows' },
          { from: 'carol', to: 'dave', relationType: 'knows' },
        ],
      };
      await store.saveAll(graph);
      const back = await store.loadAll();
      expect(back.entities.map((e) => e.name).sort()).toEqual(
        graph.entities.map((e) => e.name).sort(),
      );
      expect(back.relations).toHaveLength(2);
    });

    it('preserves optional entity fields (tags, importance, observations)', async () => {
      const store = makeStore(testDir, 4);
      const alice: Entity = {
        name: 'alice',
        entityType: 'person',
        observations: ['likes coffee', 'lives in NYC'],
        tags: ['friend', 'colleague'],
        importance: 8,
      };
      await store.saveAll({ entities: [alice], relations: [] });
      const back = await store.loadAll();
      expect(back.entities).toHaveLength(1);
      expect(back.entities[0]).toMatchObject({
        name: 'alice',
        entityType: 'person',
        observations: ['likes coffee', 'lives in NYC'],
        tags: ['friend', 'colleague'],
        importance: 8,
      });
    });

    it('preserves relation metadata across round-trip', async () => {
      const store = makeStore(testDir, 4);
      const rel: Relation = {
        from: 'alice',
        to: 'bob',
        relationType: 'knows',
        weight: 0.9,
      };
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [rel],
      });
      const back = await store.loadAll();
      expect(back.relations).toHaveLength(1);
      expect(back.relations[0]).toMatchObject({
        from: 'alice',
        to: 'bob',
        relationType: 'knows',
        weight: 0.9,
      });
    });
  });

  describe('on-disk layout', () => {
    it('writes each entity to its router-assigned segment file', async () => {
      const store = makeStore(testDir, 4);
      const router = store.router;
      const entities = ['alice', 'bob', 'carol', 'dave'].map((n) => ent(n));
      await store.saveAll({ entities, relations: [] });

      for (const e of entities) {
        const id = router.route(e.name);
        const path = store.segmentPath(id);
        const raw = await fs.readFile(path, 'utf-8');
        const found = raw
          .split('\n')
          .filter((l) => l.trim() !== '')
          .map((l) => JSON.parse(l) as { type: string; name?: string });
        expect(found.some((x) => x.type === 'entity' && x.name === e.name)).toBe(true);
      }
    });

    it('writes JSONL lines tagged with type=entity/relation (cat-able format)', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [{ from: 'alice', to: 'bob', relationType: 'knows' }],
      });
      const aliceId = store.router.route('alice');
      const raw = await fs.readFile(store.segmentPath(aliceId), 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim() !== '');
      const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      for (const p of parsed) {
        expect(['entity', 'relation']).toContain(p.type);
      }
    });

    it('places relations in the segment of their `from` endpoint, not `to`', async () => {
      const store = makeStore(testDir, 4);
      const router = store.router;
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [{ from: 'alice', to: 'bob', relationType: 'knows' }],
      });
      const aliceId = router.route('alice');
      const bobId = router.route('bob');
      if (aliceId === bobId) return; // skip if collision

      const aliceFile = await fs.readFile(store.segmentPath(aliceId), 'utf-8');
      const bobFile = await fs.readFile(store.segmentPath(bobId), 'utf-8');
      expect(aliceFile).toContain('"type":"relation"');
      const bobRelations = bobFile
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as { type: string })
        .filter((p) => p.type === 'relation');
      expect(bobRelations).toHaveLength(0);
    });
  });

  describe('missing files', () => {
    it('loadSegment returns an empty segment when the file does not exist', async () => {
      const store = makeStore(testDir, 4);
      const seg = await store.loadSegment(0);
      expect(seg.entities).toEqual([]);
      expect(seg.relations).toEqual([]);
      expect(seg.id).toBe(0);
    });

    it('loadAll on a fresh rootDir returns an empty graph', async () => {
      const store = makeStore(testDir, 4);
      const graph = await store.loadAll();
      expect(graph.entities).toEqual([]);
      expect(graph.relations).toEqual([]);
    });

    it('entityCount on a fresh rootDir returns 0', async () => {
      const store = makeStore(testDir, 4);
      expect(await store.entityCount()).toBe(0);
    });

    it('saveSegment auto-creates the segments directory on first write', async () => {
      const nested = join(testDir, 'never-created-yet');
      const store = makeStore(nested, 4);
      const id = store.router.route('alice');
      await store.saveSegment({ id, entities: [ent('alice')], relations: [] });
      const seg = await store.loadSegment(id);
      expect(seg.entities.map((e) => e.name)).toEqual(['alice']);
    });
  });

  describe('saveSegment validation', () => {
    it('rejects entities that route to a different segment', async () => {
      const store = makeStore(testDir, 4);
      const aliceId = store.router.route('alice');
      const wrongId = (aliceId + 1) % store.segmentCount;
      await expect(
        store.saveSegment({ id: wrongId, entities: [ent('alice')], relations: [] }),
      ).rejects.toThrow(/routes to segment/);
    });

    it('rejects relations whose `from` routes to a different segment', async () => {
      const store = makeStore(testDir, 4);
      const aliceId = store.router.route('alice');
      const wrongId = (aliceId + 1) % store.segmentCount;
      await expect(
        store.saveSegment({
          id: wrongId,
          entities: [],
          relations: [{ from: 'alice', to: 'bob', relationType: 'x' }],
        }),
      ).rejects.toThrow(/routes to segment/);
    });

    it('rejects invalid segment ids on load/save', async () => {
      const store = makeStore(testDir, 4);
      await expect(store.loadSegment(-1)).rejects.toThrow();
      await expect(store.loadSegment(4)).rejects.toThrow();
      await expect(store.loadSegment(0.5)).rejects.toThrow();
    });
  });

  describe('atomicity', () => {
    it('saveAll failure mid-stage leaves prior state intact', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [],
      });
      const beforeNames = (await store.loadAll()).entities.map((e) => e.name).sort();

      // Force `writeFile`/`fd.write` to throw partway through the
      // staging phase by stubbing fs.open after the first call.
      const realOpen = fs.open.bind(fs);
      let callCount = 0;
      const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        callCount++;
        if (callCount > 1) {
          throw new Error('simulated disk failure mid-stage');
        }
        return realOpen(...(args as Parameters<typeof realOpen>));
      });

      await expect(
        store.saveAll({
          entities: [ent('eve'), ent('frank'), ent('george'), ent('henry')],
          relations: [],
        }),
      ).rejects.toThrow(/simulated disk failure/);

      spy.mockRestore();

      const afterNames = (await store.loadAll()).entities.map((e) => e.name).sort();
      expect(afterNames).toEqual(beforeNames);
    });

    it('per-segment saveSegment is atomic — temp files do not survive a successful write', async () => {
      const store = makeStore(testDir, 4);
      const id = store.router.route('alice');
      await store.saveSegment({ id, entities: [ent('alice')], relations: [] });
      const files = await fs.readdir(join(testDir, 'segments'));
      const tmps = files.filter((f) => f.includes('.tmp.'));
      expect(tmps).toHaveLength(0);
    });
  });

  describe('manifest recovery confinement', () => {
    it('recovers a validated relative temp filename', async () => {
      const store = makeStore(testDir, 4);
      const segmentsDir = join(testDir, 'segments');
      await fs.mkdir(segmentsDir, { recursive: true });

      const name = 'recovered';
      const id = store.router.route(name);
      const target = `${id}.jsonl`;
      const tmp = `${target}.tmp.123.0123456789ab`;
      await fs.writeFile(
        join(segmentsDir, tmp),
        JSON.stringify({
          type: 'entity',
          name,
          entityType: 'thing',
          observations: [],
        }),
      );
      await fs.writeFile(
        join(segmentsDir, '_manifest.json'),
        JSON.stringify({ version: 1, moves: [{ tmp, target }] }),
      );

      const graph = await store.loadAll();

      expect(graph.entities.map((entity) => entity.name)).toContain(name);
      await expect(
        fs.access(join(segmentsDir, '_manifest.json')),
      ).rejects.toThrow();
    });

    it('rejects manifest paths outside the segments directory', async () => {
      const store = makeStore(testDir, 4);
      const segmentsDir = join(testDir, 'segments');
      await fs.mkdir(segmentsDir, { recursive: true });

      const outsideTmp = join(testDir, '0.jsonl.tmp.123.0123456789ab');
      const outsideTarget = join(testDir, '0.jsonl');
      await fs.writeFile(outsideTmp, 'new content');
      await fs.writeFile(outsideTarget, 'original content');
      await fs.writeFile(
        join(segmentsDir, '_manifest.json'),
        JSON.stringify({
          version: 1,
          moves: [{ tmp: outsideTmp, target: outsideTarget }],
        }),
      );

      await expect(store.loadAll()).rejects.toThrow(/outside segments directory/);
      expect(await fs.readFile(outsideTmp, 'utf-8')).toBe('new content');
      expect(await fs.readFile(outsideTarget, 'utf-8')).toBe('original content');
    });

    // Skips (with the probe's reason in the test name) only where symlink creation is denied.
    // Wherever symlinks work, the confinement assertion below runs unchanged.
    it.skipIf(!symlinkSupport.ok)(
      `rejects symlink temp files during recovery${symlinkSupport.ok ? '' : ` [skipped: ${symlinkSupport.reason}]`}`,
      async () => {
        const store = makeStore(testDir, 4);
        const segmentsDir = join(testDir, 'segments');
        await fs.mkdir(segmentsDir, { recursive: true });

        const outside = join(testDir, 'outside.jsonl');
        const target = '0.jsonl';
        const tmp = `${target}.tmp.123.0123456789ab`;
        await fs.writeFile(outside, 'outside content');
        await fs.writeFile(join(segmentsDir, target), '');
        await fs.symlink(outside, join(segmentsDir, tmp));
        await fs.writeFile(
          join(segmentsDir, '_manifest.json'),
          JSON.stringify({ version: 1, moves: [{ tmp, target }] }),
        );

        await expect(store.loadAll()).rejects.toThrow(/regular file/);
        expect(await fs.readFile(outside, 'utf-8')).toBe('outside content');
      },
    );
  });

  describe('stress / property-based round-trip', () => {
    const counts = [4, 8, 16];
    for (const segmentCount of counts) {
      it(`100-entity / 50-relation graph survives saveAll/loadAll on ${segmentCount} segments`, async () => {
        const store = makeStore(testDir, segmentCount);
        const entities: Entity[] = Array.from({ length: 100 }, (_, i) =>
          ent(`entity-${i}`, 'thing', [`observation-${i}`]),
        );
        const relations: Relation[] = Array.from({ length: 50 }, (_, i) => ({
          from: `entity-${i}`,
          to: `entity-${i + 1}`,
          relationType: 'next',
        }));
        await store.saveAll({ entities, relations });
        const back = await store.loadAll();

        expect(back.entities).toHaveLength(100);
        expect(back.relations).toHaveLength(50);

        const names = new Set(back.entities.map((e) => e.name));
        for (let i = 0; i < 100; i++) {
          expect(names.has(`entity-${i}`)).toBe(true);
        }

        const relKeys = new Set(
          back.relations.map((r) => `${r.from}::${r.to}::${r.relationType}`),
        );
        for (let i = 0; i < 50; i++) {
          expect(relKeys.has(`entity-${i}::entity-${i + 1}::next`)).toBe(true);
        }
      });
    }

    it('entityCount matches the number of entities saved', async () => {
      const store = makeStore(testDir, 8);
      const entities: Entity[] = Array.from({ length: 75 }, (_, i) => ent(`e${i}`));
      await store.saveAll({ entities, relations: [] });
      expect(await store.entityCount()).toBe(75);
    });
  });

  describe('findOutgoingRelations (task 61)', () => {
    it('returns all relations whose `from` matches', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice'), ent('bob'), ent('carol')],
        relations: [
          { from: 'alice', to: 'bob', relationType: 'knows' },
          { from: 'alice', to: 'carol', relationType: 'manages' },
          { from: 'bob', to: 'carol', relationType: 'reports_to' },
        ],
      });
      const out = await store.findOutgoingRelations('alice');
      expect(out).toHaveLength(2);
      expect(out.map((r) => r.to).sort()).toEqual(['bob', 'carol']);
    });

    it('returns [] for an unknown entity', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice')],
        relations: [],
      });
      expect(await store.findOutgoingRelations('nonexistent')).toEqual([]);
    });

    it('only reads ONE segment — verified via loadSegment call count', async () => {
      const store = makeStore(testDir, 8);
      await store.saveAll({
        entities: Array.from({ length: 20 }, (_, i) => ent(`e${i}`)),
        relations: [{ from: 'e0', to: 'e1', relationType: 'next' }],
      });
      const loadSpy = vi.spyOn(store, 'loadSegment');
      await store.findOutgoingRelations('e0');
      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(loadSpy).toHaveBeenCalledWith(store.router.route('e0'));
      loadSpy.mockRestore();
    });
  });

  describe('findIncomingRelations (task 61)', () => {
    it('returns all relations whose `to` matches, regardless of source segment', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [
          ent('alice'),
          ent('bob'),
          ent('carol'),
          ent('dave'),
          ent('target'),
        ],
        relations: [
          { from: 'alice', to: 'target', relationType: 'knows' },
          { from: 'bob', to: 'target', relationType: 'reports_to' },
          { from: 'carol', to: 'target', relationType: 'manages' },
          { from: 'dave', to: 'alice', relationType: 'knows' }, // distractor
        ],
      });
      const incoming = await store.findIncomingRelations('target');
      expect(incoming).toHaveLength(3);
      expect(incoming.map((r) => r.from).sort()).toEqual(['alice', 'bob', 'carol']);
    });

    it('returns [] for an unknown entity', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [{ from: 'alice', to: 'bob', relationType: 'knows' }],
      });
      expect(await store.findIncomingRelations('nonexistent')).toEqual([]);
    });

    it('scans every segment — verified via loadSegment call count', async () => {
      const store = makeStore(testDir, 8);
      await store.saveAll({
        entities: Array.from({ length: 20 }, (_, i) => ent(`e${i}`)),
        relations: [{ from: 'e0', to: 'e1', relationType: 'next' }],
      });
      const loadSpy = vi.spyOn(store, 'loadSegment');
      await store.findIncomingRelations('e1');
      expect(loadSpy).toHaveBeenCalledTimes(store.segmentCount);
      loadSpy.mockRestore();
    });
  });
});

describe('FileSegmentStorage segment file modes', () => {
  let testDir: string;
  let previousUmask: number;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `file-segment-modes-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
    // A fixed umask makes the default mode of a new file the same on every machine.
    previousUmask = process.umask(0o022);
  });

  afterEach(async () => {
    process.umask(previousUmask);
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  function twelveEntityGraph(): KnowledgeGraph {
    return {
      entities: Array.from({ length: 12 }, (_, i) => ent(`item-${i}`, 'thing', [`note ${i}`])),
      relations: [],
    };
  }

  async function segmentFileModes(): Promise<Map<string, number>> {
    const dir = join(testDir, 'segments');
    const modes = new Map<string, number>();
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      modes.set(name, (await fs.stat(join(dir, name))).mode & 0o777);
    }
    return modes;
  }

  it('saveAll writes every segment file with mode 0o600', async () => {
    if (process.platform === 'win32') return; // POSIX modes don't apply
    await makeStore(testDir).saveAll(twelveEntityGraph());

    const modes = await segmentFileModes();
    expect(modes.size).toBeGreaterThan(0);
    for (const [name, mode] of modes) {
      expect(mode, name).toBe(0o600);
    }
  });

  it('saveAll writes the recovery manifest with mode 0o600 when a segment rename fails', async () => {
    if (process.platform === 'win32') return; // POSIX modes don't apply
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(((from: string, to: string) =>
      String(to).endsWith('.jsonl')
        ? Promise.reject(new Error('synthetic-segment-rename'))
        : realRename(from, to)) as typeof fs.rename);

    await expect(makeStore(testDir).saveAll(twelveEntityGraph())).rejects.toThrow(
      /Segment commit incomplete/,
    );
    vi.restoreAllMocks();

    const manifest = join(testDir, 'segments', '_manifest.json');
    expect((await fs.stat(manifest)).mode & 0o777).toBe(0o600);
  });

  it('saveAll keeps a tighter existing segment mode and does not widen it', async () => {
    if (process.platform === 'win32') return; // POSIX modes don't apply
    const store = makeStore(testDir);
    await store.saveAll(twelveEntityGraph());
    const [name] = [...(await segmentFileModes()).keys()];
    const target = join(testDir, 'segments', name);
    await fs.chmod(target, 0o640);

    await store.saveAll(twelveEntityGraph());

    expect((await fs.stat(target)).mode & 0o777).toBe(0o640 & 0o600);
  });
});

describe('FileSegmentStorage saveSegment ownership and temp files', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `file-segment-owner-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('expected the promise to reject');
  }

  it('names the class and the entity when an entity routes to another segment', async () => {
    const message = await rejectionMessage(
      makeStore(testDir).saveSegment({ id: 0, entities: [ent('alpha')], relations: [] }),
    );
    expect(message).toBe("FileSegmentStorage.saveSegment: entity 'alpha' routes to segment 3, not 0");
  });

  it('names the class and the relation when a relation routes to another segment', async () => {
    const relation: Relation = { from: 'alpha', to: 'beta', relationType: 'knows' };
    const message = await rejectionMessage(
      makeStore(testDir).saveSegment({ id: 0, entities: [], relations: [relation] }),
    );
    expect(message).toBe(
      "FileSegmentStorage.saveSegment: relation from='alpha' routes to segment 3, not 0",
    );
  });

  it('writes each temp file with the plain write flag, so a stale temp file is replaced', async () => {
    // Leave a stale file at every temp path that `open` receives.
    const realOpen = fs.open.bind(fs);
    const flags: string[] = [];
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const [path, flag] = args;
      if (String(path).includes('.tmp.')) {
        flags.push(String(flag));
        await fs.writeFile(path, 'stale');
      }
      return realOpen(...args);
    });
    const entities = Array.from({ length: 12 }, (_, i) => ent(`item-${i}`));

    await makeStore(testDir).saveAll({ entities, relations: [] });
    vi.restoreAllMocks();

    expect(flags.length).toBeGreaterThan(1);
    expect(new Set(flags)).toEqual(new Set(['w']));
    expect((await makeStore(testDir).loadAll()).entities).toHaveLength(12);
  });
});

describe('FileSegmentStorage temp file open mode on every platform', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `file-segment-open-mode-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  interface OpenCall {
    path: string;
    flag: string;
    mode: unknown;
  }

  function twelveEntityGraph(): KnowledgeGraph {
    return {
      entities: Array.from({ length: 12 }, (_, i) => ent(`item-${i}`, 'thing', [`note ${i}`])),
      relations: [],
    };
  }

  /**
   * Record the arguments of every `open` of a temp file and let the call through.
   * A mode without the owner write bit is replaced by 0o600 for the real call, so
   * that the test never leaves a read-only file behind. The record keeps the mode
   * that the code under test asked for.
   */
  function recordTmpOpens(): OpenCall[] {
    const calls: OpenCall[] = [];
    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation((async (...args: Parameters<typeof fs.open>) => {
      const [path, flag, mode] = args;
      if (!String(path).includes('.tmp.')) return realOpen(...args);
      calls.push({ path: String(path), flag: String(flag), mode });
      const writable = typeof mode === 'number' && (mode & 0o200) === 0 ? 0o600 : mode;
      return realOpen(path, flag, writable);
    }) as typeof fs.open);
    return calls;
  }

  /** Make `fs.stat` report `mode` for every path that is not a temp file. A missing path still rejects. */
  function reportExistingMode(mode: number): void {
    const realStat = fs.stat.bind(fs);
    vi.spyOn(fs, 'stat').mockImplementation((async (...args: Parameters<typeof fs.stat>) => {
      const stat = await realStat(...args);
      if (String(args[0]).includes('.tmp.')) return stat;
      return Object.create(stat, { mode: { value: 0o100000 | mode } });
    }) as typeof fs.stat);
  }

  it('passes mode 0o600 to open for every staged segment file and for the manifest', async () => {
    const calls = recordTmpOpens();

    await makeStore(testDir).saveAll(twelveEntityGraph());
    vi.restoreAllMocks();

    const segmentCalls = calls.filter(c => c.path.includes('.jsonl.tmp.'));
    const manifestCalls = calls.filter(c => c.path.includes('_manifest.json.tmp.'));
    expect(segmentCalls.length).toBeGreaterThan(1);
    expect(manifestCalls).toHaveLength(1);
    expect(calls).toHaveLength(segmentCalls.length + manifestCalls.length);
    for (const call of calls) {
      expect(call.mode, call.path).toBe(0o600);
      expect(call.flag, call.path).toBe('w');
    }
  });

  it('narrows the mode of a segment file that is wider than owner read and write', async () => {
    const store = makeStore(testDir);
    await store.saveAll(twelveEntityGraph());
    const calls = recordTmpOpens();
    reportExistingMode(0o640);

    await store.saveAll(twelveEntityGraph());
    vi.restoreAllMocks();

    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.mode, call.path).toBe(0o600);
    }
  });

  it('keeps the tighter mode of an existing segment file, and gives a new manifest 0o600', async () => {
    const store = makeStore(testDir);
    await store.saveAll(twelveEntityGraph());
    const calls = recordTmpOpens();
    reportExistingMode(0o440);

    await store.saveAll(twelveEntityGraph());
    vi.restoreAllMocks();

    const segmentCalls = calls.filter(c => c.path.includes('.jsonl.tmp.'));
    const manifestCalls = calls.filter(c => c.path.includes('_manifest.json.tmp.'));
    expect(segmentCalls.length).toBeGreaterThan(1);
    for (const call of segmentCalls) {
      expect(call.mode, call.path).toBe(0o400);
    }
    // The manifest does not exist between saves, so it is a new file.
    expect(manifestCalls.map(c => c.mode)).toEqual([0o600]);
  });
});

describe('FileSegmentStorage saveSegment router access', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `file-segment-router-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  /** Names that route to `id` under a four-segment router, found by search. */
  function namesRoutedTo(id: number, count: number): string[] {
    const router = new FnvSegmentRouter(4);
    const names: string[] = [];
    for (let i = 0; names.length < count; i++) {
      if (router.route(`probe-${i}`) === id) names.push(`probe-${i}`);
    }
    return names;
  }

  async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected the promise to reject');
  }

  it('reads the router once for each entity and each relation that it checks', async () => {
    const store = makeStore(testDir);
    const router = store.router;
    let reads = 0;
    Object.defineProperty(store, 'router', {
      get() {
        reads++;
        return router;
      },
    });
    const [first, second] = namesRoutedTo(3, 2);
    const [foreign] = namesRoutedTo(0, 1);

    // Two entities pass, then the relation fails: three checks, three reads.
    await rejection(
      store.saveSegment({
        id: 3,
        entities: [ent(first!), ent(second!)],
        relations: [{ from: foreign!, to: first!, relationType: 'knows' }],
      }),
    );

    expect(reads).toBe(3);
  });

  it('names the router access in the error when the router has no route method', async () => {
    const store = new FileSegmentStorage(testDir, { segmentCount: 4 } as unknown as FnvSegmentRouter);

    const error = await rejection(
      store.saveSegment({ id: 0, entities: [ent('alpha')], relations: [] }),
    );

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('this.router.route is not a function');
  });
});
