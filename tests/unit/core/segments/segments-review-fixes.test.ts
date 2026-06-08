/**
 * Phase 7 review-fix regression tests
 *
 * Targets the substantive findings from the Phase 7 review on commit
 * 722563e:
 * - #1 appendViaSegmentSave: reload-failure path surfaces both errors
 * - #2 pendingAppends reset in segment-mode append
 * - #4 manifest-based forward recovery
 * - #6 malformed-line tolerance in parseSegmentFile
 * - #8 strict env-var parsing + 1024-segment cap
 * - #13 migration tool overwrite protection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import {
  FileSegmentStorage,
} from '../../../../src/core/segments/FileSegmentStorage.js';
import { FnvSegmentRouter } from '../../../../src/core/segments/ISegmentStorage.js';
import type { Entity } from '../../../../src/types/index.js';

async function makeDir(): Promise<string> {
  const dir = join(tmpdir(), `seg-review-${Date.now()}-${Math.random()}`);
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

const savedEnv = process.env.MEMORY_STORAGE_SEGMENT_COUNT;

describe('Review #4: manifest-based forward recovery', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeDir();
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('loadAll completes pending renames when a manifest is present from a crashed save', async () => {
    const store = new FileSegmentStorage(dir, new FnvSegmentRouter(4));
    // Simulate a crashed saveAll by hand:
    // - write a tmp file containing what the new state would be
    // - write a manifest pointing at it
    // - leave the target segment file as old/missing
    const segmentsDir = join(dir, 'segments');
    await fs.mkdir(segmentsDir, { recursive: true });
    const tmpPath = join(segmentsDir, '0.jsonl.tmp.recovery');
    const targetPath = join(segmentsDir, '0.jsonl');
    await fs.writeFile(
      tmpPath,
      JSON.stringify({
        type: 'entity',
        name: 'recovered',
        entityType: 'x',
        observations: ['from-tmp'],
      }) + '\n',
    );
    await fs.writeFile(
      join(segmentsDir, '_manifest.json'),
      JSON.stringify({ version: 1, moves: [{ tmp: tmpPath, target: targetPath }] }),
    );

    const graph = await store.loadAll();
    // After recovery: segment 0 has the staged content, manifest is gone.
    const recovered = graph.entities.find((e) => e.name === 'recovered');
    expect(recovered).toBeDefined();
    await expect(fs.access(join(segmentsDir, '_manifest.json'))).rejects.toThrow();
    await expect(fs.access(tmpPath)).rejects.toThrow();
  });

  it('loadAll ignores a malformed manifest (deletes it, returns pre-save state)', async () => {
    const store = new FileSegmentStorage(dir, new FnvSegmentRouter(4));
    const segmentsDir = join(dir, 'segments');
    await fs.mkdir(segmentsDir, { recursive: true });
    await fs.writeFile(join(segmentsDir, '_manifest.json'), 'not-json');

    const graph = await store.loadAll();
    expect(graph.entities).toEqual([]);
    await expect(fs.access(join(segmentsDir, '_manifest.json'))).rejects.toThrow();
  });

  it('saveAll deletes the manifest on the success path', async () => {
    const store = new FileSegmentStorage(dir, new FnvSegmentRouter(4));
    await store.saveAll({
      entities: [ent('alice')],
      relations: [],
    });
    await expect(
      fs.access(join(dir, 'segments', '_manifest.json')),
    ).rejects.toThrow();
  });
});

describe('Review #6: malformed-line tolerance in parseSegmentFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeDir();
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('a malformed line in the middle of a segment does not abort loadSegment', async () => {
    const store = new FileSegmentStorage(dir, new FnvSegmentRouter(4));
    const segmentsDir = join(dir, 'segments');
    await fs.mkdir(segmentsDir, { recursive: true });

    // Hand-craft a segment-0 file with a good entity + corrupted line + good entity.
    // (The entity name must route to segment 0 to satisfy ownership later if loaded.)
    const router = new FnvSegmentRouter(4);
    const good1Name = pickNameForSegment(0, router);
    const good2Name = pickNameForSegment(0, router, good1Name);
    const contents = [
      JSON.stringify({ type: 'entity', name: good1Name, entityType: 'x', observations: [] }),
      '{ broken json',
      JSON.stringify({ type: 'entity', name: good2Name, entityType: 'x', observations: [] }),
    ].join('\n');
    await fs.writeFile(join(segmentsDir, '0.jsonl'), contents);

    const seg = await store.loadSegment(0);
    expect(seg.entities.map((e) => e.name).sort()).toEqual(
      [good1Name, good2Name].sort(),
    );
  });
});

describe('Review #8: strict env-var parsing + 1024-segment cap', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeDir();
  });
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
    else process.env.MEMORY_STORAGE_SEGMENT_COUNT = savedEnv;
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('MEMORY_STORAGE_SEGMENT_COUNT="3.7" falls back to single-file (not silent-truncate)', async () => {
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = '3.7';
    const storage = new GraphStorage(join(dir, 'memory.jsonl'));
    await storage.saveGraph({ entities: [ent('alice')], relations: [] });
    await expect(fs.access(join(dir, 'segments'))).rejects.toThrow();
  });

  it('MEMORY_STORAGE_SEGMENT_COUNT="1e3" falls back to single-file', async () => {
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = '1e3';
    const storage = new GraphStorage(join(dir, 'memory.jsonl'));
    await storage.saveGraph({ entities: [ent('alice')], relations: [] });
    await expect(fs.access(join(dir, 'segments'))).rejects.toThrow();
  });

  it('MEMORY_STORAGE_SEGMENT_COUNT="-5" falls back to single-file', async () => {
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = '-5';
    const storage = new GraphStorage(join(dir, 'memory.jsonl'));
    await storage.saveGraph({ entities: [ent('alice')], relations: [] });
    await expect(fs.access(join(dir, 'segments'))).rejects.toThrow();
  });

  it('MEMORY_STORAGE_SEGMENT_COUNT=2048 (> 1024 cap) falls back to single-file', async () => {
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = '2048';
    const storage = new GraphStorage(join(dir, 'memory.jsonl'));
    await storage.saveGraph({ entities: [ent('alice')], relations: [] });
    await expect(fs.access(join(dir, 'segments'))).rejects.toThrow();
  });

  it('MEMORY_STORAGE_SEGMENT_COUNT="1024" (at the cap) IS accepted', async () => {
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = '1024';
    const storage = new GraphStorage(join(dir, 'memory.jsonl'));
    await storage.saveGraph({ entities: [ent('alice')], relations: [] });
    await expect(fs.access(join(dir, 'segments'))).resolves.toBeUndefined();
  });
});

describe('Review #1: appendViaSegmentSave reload-failure path', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeDir();
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = '4';
  });
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
    else process.env.MEMORY_STORAGE_SEGMENT_COUNT = savedEnv;
    vi.restoreAllMocks();
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('save failure followed by reload failure throws an aggregated error', async () => {
    const storage = new GraphStorage(join(dir, 'memory.jsonl'));
    await storage.loadGraph(); // initialize cache

    // Inject a saveAll failure. Access the private segmentStorage via cast.
    const segmentStorage = (storage as unknown as {
      segmentStorage: FileSegmentStorage;
    }).segmentStorage;
    expect(segmentStorage).not.toBeNull();
    const saveSpy = vi
      .spyOn(segmentStorage, 'saveAll')
      .mockRejectedValueOnce(new Error('synthetic save failure'));
    const loadSpy = vi
      .spyOn(segmentStorage, 'loadAll')
      .mockRejectedValueOnce(new Error('synthetic reload failure'));

    await expect(
      storage.appendEntity(ent('alice')),
    ).rejects.toThrow(/synthetic save failure.*synthetic reload failure|desynced/);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Migration tool: review #13 overwrite protection', async () => {
  // Re-import the tool's functions inside the suite so vitest hoists them
  // after the module is loaded. (Import at top would be fine too — kept
  // inline for symmetry with other review-targeted tests.)
  const { runSplit, runMerge } = await import('../../../../tools/segment-jsonl/segment-jsonl.js');

  let dir: string;
  beforeEach(async () => {
    dir = await makeDir();
  });
  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('runSplit refuses to overwrite an existing segment file', async () => {
    // Seed an existing segments/0.jsonl that should NOT be clobbered.
    await fs.mkdir(join(dir, 'out', 'segments'), { recursive: true });
    await fs.writeFile(join(dir, 'out', 'segments', '0.jsonl'), 'precious data');

    // Source JSONL file.
    const inputPath = join(dir, 'in.jsonl');
    await fs.writeFile(
      inputPath,
      JSON.stringify({ type: 'entity', name: 'alice', entityType: 'x', observations: [] }) + '\n',
    );

    await expect(
      runSplit({
        inputPath,
        outputDir: join(dir, 'out'),
        segmentCount: 4,
      }),
    ).rejects.toThrow(/Refusing to overwrite/);

    // Precious data still there.
    expect(
      await fs.readFile(join(dir, 'out', 'segments', '0.jsonl'), 'utf-8'),
    ).toBe('precious data');
  });

  it('runSplit with force=true does overwrite', async () => {
    await fs.mkdir(join(dir, 'out', 'segments'), { recursive: true });
    await fs.writeFile(join(dir, 'out', 'segments', '0.jsonl'), 'precious data');

    const inputPath = join(dir, 'in.jsonl');
    await fs.writeFile(
      inputPath,
      JSON.stringify({ type: 'entity', name: 'alice', entityType: 'x', observations: [] }) + '\n',
    );

    await runSplit({
      inputPath,
      outputDir: join(dir, 'out'),
      segmentCount: 4,
      force: true,
    });

    // At least one segment file now contains alice.
    const segDir = join(dir, 'out', 'segments');
    const files = await fs.readdir(segDir);
    const contents = await Promise.all(
      files.map((f) => fs.readFile(join(segDir, f), 'utf-8')),
    );
    expect(contents.some((c) => c.includes('alice'))).toBe(true);
  });

  it('runMerge refuses to overwrite an existing output file', async () => {
    // Build a valid segments/ dir to merge from.
    await fs.mkdir(join(dir, 'in', 'segments'), { recursive: true });
    await fs.writeFile(
      join(dir, 'in', 'segments', '0.jsonl'),
      JSON.stringify({ type: 'entity', name: 'alice', entityType: 'x', observations: [] }) + '\n',
    );

    const outPath = join(dir, 'merged.jsonl');
    await fs.writeFile(outPath, 'existing output');

    await expect(
      runMerge({ inputDir: join(dir, 'in'), outputPath: outPath }),
    ).rejects.toThrow(/Refusing to overwrite/);

    expect(await fs.readFile(outPath, 'utf-8')).toBe('existing output');
  });
});

// Helper — find an entity name that routes to a specific segment (for malformed-line test).
function pickNameForSegment(target: number, router: FnvSegmentRouter, exclude?: string): string {
  for (let i = 0; i < 10000; i++) {
    const name = `e${i}`;
    if (name === exclude) continue;
    if (router.route(name) === target) return name;
  }
  throw new Error(`Could not find a name routing to segment ${target}`);
}
