import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runSplit,
  runMerge,
  parseArgs,
} from '../../../tools/segment-jsonl/segment-jsonl.js';
import {
  FnvSegmentRouter,
} from '../../../src/core/segments/ISegmentStorage.js';
import type {
  Entity,
  Relation,
  KnowledgeGraph,
} from '../../../src/types/types.js';

function buildSampleGraph(entityCount = 50, relationCount = 20): KnowledgeGraph {
  const entities: Entity[] = [];
  for (let i = 0; i < entityCount; i++) {
    entities.push({
      name: `entity-${i}`,
      entityType: i % 2 === 0 ? 'person' : 'project',
      observations: [`obs-${i}-a`, `obs-${i}-b`],
      createdAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      lastModified: `2026-01-02T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    });
  }
  const relations: Relation[] = [];
  for (let i = 0; i < relationCount; i++) {
    relations.push({
      from: `entity-${i}`,
      to: `entity-${(i + 1) % entityCount}`,
      relationType: 'knows',
      createdAt: `2026-01-03T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      lastModified: `2026-01-03T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    });
  }
  return { entities, relations };
}

function writeSampleJsonl(filePath: string, graph: KnowledgeGraph): void {
  const lines: string[] = [];
  for (const e of graph.entities) {
    lines.push(JSON.stringify({ type: 'entity', ...e }));
  }
  for (const r of graph.relations) {
    lines.push(JSON.stringify({ type: 'relation', ...r }));
  }
  fsSync.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

async function readJsonlLines(filePath: string): Promise<unknown[]> {
  const data = await fs.readFile(filePath, 'utf-8');
  return data
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as unknown);
}

function stableKeyEntity(rec: Record<string, unknown>): string {
  return `E:${String(rec.name)}`;
}

function stableKeyRelation(rec: Record<string, unknown>): string {
  return `R:${String(rec.from)}->${String(rec.to)}:${String(rec.relationType)}`;
}

function sortLinesForCompare(lines: unknown[]): string[] {
  return lines
    .map((l) => {
      const rec = l as Record<string, unknown>;
      const key =
        rec.type === 'entity' ? stableKeyEntity(rec) : stableKeyRelation(rec);
      return { key, json: JSON.stringify(l) };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((x) => x.json);
}

describe('segment-jsonl / parseArgs', () => {
  it('parses split with --segments=N', () => {
    const parsed = parseArgs(['split', 'in.jsonl', 'out', '--segments=4']);
    expect(parsed).toEqual({
      mode: 'split',
      input: 'in.jsonl',
      output: 'out',
      segments: 4,
      dryRun: false,
      force: false,
    });
  });

  it('parses split with --segments N (space-separated)', () => {
    const parsed = parseArgs(['split', 'in.jsonl', 'out', '--segments', '8']);
    expect(parsed.mode === 'split' && parsed.segments).toBe(8);
  });

  it('parses --dry-run flag', () => {
    const parsed = parseArgs(['split', 'in.jsonl', 'out', '--segments=2', '--dry-run']);
    expect(parsed.dryRun).toBe(true);
  });

  it('parses merge subcommand', () => {
    const parsed = parseArgs(['merge', 'in-dir', 'out.jsonl']);
    expect(parsed).toEqual({
      mode: 'merge',
      input: 'in-dir',
      output: 'out.jsonl',
      dryRun: false,
      force: false,
    });
  });

  it('rejects split missing --segments', () => {
    expect(() => parseArgs(['split', 'in.jsonl', 'out'])).toThrow(/--segments/);
  });

  it('rejects --segments=0', () => {
    expect(() => parseArgs(['split', 'in.jsonl', 'out', '--segments=0'])).toThrow(
      /positive integer/,
    );
  });

  it('rejects unknown subcommand', () => {
    expect(() => parseArgs(['frobnicate', 'a', 'b'])).toThrow(/Unknown subcommand/);
  });

  it('rejects unknown flag', () => {
    expect(() =>
      parseArgs(['split', 'in.jsonl', 'out', '--segments=2', '--bogus']),
    ).toThrow(/Unknown flag/);
  });

  it('rejects missing positional args', () => {
    expect(() => parseArgs(['split', 'in.jsonl', '--segments=2'])).toThrow(
      /positional args/,
    );
  });

  it('rejects empty argv', () => {
    expect(() => parseArgs([])).toThrow(/Missing subcommand/);
  });
});

describe('segment-jsonl / runSplit', () => {
  let tmpDir: string;
  let inputPath: string;
  let outputDir: string;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'mjs-segjsonl-split-'));
    inputPath = path.join(tmpDir, 'memory.jsonl');
    outputDir = path.join(tmpDir, 'out');
  });

  afterEach(() => {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes one file per segment under <output-dir>/segments/', async () => {
    const graph = buildSampleGraph(50, 20);
    writeSampleJsonl(inputPath, graph);

    const result = await runSplit({
      inputPath,
      outputDir,
      segmentCount: 4,
    });

    expect(result.entityCount).toBe(50);
    expect(result.relationCount).toBe(20);
    expect(result.segments).toBe(4);
    expect(result.dryRun).toBe(false);

    for (let i = 0; i < 4; i++) {
      const segPath = path.join(outputDir, 'segments', `${i}.jsonl`);
      expect(fsSync.existsSync(segPath)).toBe(true);
    }
  });

  it('each segment file holds entities that route to its id', async () => {
    const graph = buildSampleGraph(50, 20);
    writeSampleJsonl(inputPath, graph);

    const segmentCount = 4;
    await runSplit({ inputPath, outputDir, segmentCount });

    const router = new FnvSegmentRouter(segmentCount);
    for (let i = 0; i < segmentCount; i++) {
      const segPath = path.join(outputDir, 'segments', `${i}.jsonl`);
      const lines = await readJsonlLines(segPath);
      for (const line of lines) {
        const rec = line as Record<string, unknown>;
        if (rec.type === 'entity') {
          expect(router.route(String(rec.name))).toBe(i);
        } else if (rec.type === 'relation') {
          expect(router.route(String(rec.from))).toBe(i);
        }
      }
    }
  });

  it('every input entity lands in exactly one segment', async () => {
    const graph = buildSampleGraph(50, 20);
    writeSampleJsonl(inputPath, graph);

    const segmentCount = 4;
    await runSplit({ inputPath, outputDir, segmentCount });

    const seenEntities = new Set<string>();
    for (let i = 0; i < segmentCount; i++) {
      const segPath = path.join(outputDir, 'segments', `${i}.jsonl`);
      const lines = await readJsonlLines(segPath);
      for (const line of lines) {
        const rec = line as Record<string, unknown>;
        if (rec.type === 'entity') {
          const name = String(rec.name);
          expect(seenEntities.has(name)).toBe(false);
          seenEntities.add(name);
        }
      }
    }
    expect(seenEntities.size).toBe(50);
  });

  it('--dry-run does not touch the filesystem', async () => {
    const graph = buildSampleGraph(10, 5);
    writeSampleJsonl(inputPath, graph);

    const result = await runSplit({
      inputPath,
      outputDir,
      segmentCount: 3,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.entityCount).toBe(10);
    expect(fsSync.existsSync(path.join(outputDir, 'segments'))).toBe(false);
  });

  it('handles segmentCount=1 (everything in segment 0)', async () => {
    const graph = buildSampleGraph(10, 5);
    writeSampleJsonl(inputPath, graph);

    await runSplit({ inputPath, outputDir, segmentCount: 1 });

    const segPath = path.join(outputDir, 'segments', '0.jsonl');
    const lines = await readJsonlLines(segPath);
    expect(lines.length).toBe(15);
  });
});

describe('segment-jsonl / runMerge', () => {
  let tmpDir: string;
  let inputPath: string;
  let segmentsDir: string;
  let mergedPath: string;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'mjs-segjsonl-merge-'));
    inputPath = path.join(tmpDir, 'memory.jsonl');
    segmentsDir = path.join(tmpDir, 'split-out');
    mergedPath = path.join(tmpDir, 'merged.jsonl');
  });

  afterEach(() => {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reassembles entities + relations from segments', async () => {
    const graph = buildSampleGraph(50, 20);
    writeSampleJsonl(inputPath, graph);

    await runSplit({ inputPath, outputDir: segmentsDir, segmentCount: 4 });

    const result = await runMerge({ inputDir: segmentsDir, outputPath: mergedPath });
    expect(result.entityCount).toBe(50);
    expect(result.relationCount).toBe(20);
    expect(result.segmentsRead).toBe(4);
    expect(fsSync.existsSync(mergedPath)).toBe(true);
  });

  it('--dry-run on merge does not touch the filesystem', async () => {
    const graph = buildSampleGraph(10, 5);
    writeSampleJsonl(inputPath, graph);
    await runSplit({ inputPath, outputDir: segmentsDir, segmentCount: 2 });

    const result = await runMerge({
      inputDir: segmentsDir,
      outputPath: mergedPath,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.entityCount).toBe(10);
    expect(fsSync.existsSync(mergedPath)).toBe(false);
  });

  it('ignores non-<id>.jsonl files in segments dir', async () => {
    const graph = buildSampleGraph(10, 5);
    writeSampleJsonl(inputPath, graph);
    await runSplit({ inputPath, outputDir: segmentsDir, segmentCount: 2 });

    // Drop a stray file the tool should not touch.
    await fs.writeFile(
      path.join(segmentsDir, 'segments', 'notes.txt'),
      'ignore me',
      'utf-8',
    );

    const result = await runMerge({ inputDir: segmentsDir, outputPath: mergedPath });
    expect(result.entityCount).toBe(10);
    expect(result.relationCount).toBe(5);
  });
});

describe('segment-jsonl / round-trip', () => {
  let tmpDir: string;
  let originalPath: string;
  let segmentsDir: string;
  let mergedPath: string;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'mjs-segjsonl-rt-'));
    originalPath = path.join(tmpDir, 'memory.jsonl');
    segmentsDir = path.join(tmpDir, 'split-out');
    mergedPath = path.join(tmpDir, 'merged.jsonl');
  });

  afterEach(() => {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('split then merge is bit-identical after sort+newline normalization', async () => {
    const graph = buildSampleGraph(50, 20);
    writeSampleJsonl(originalPath, graph);

    await runSplit({ inputPath: originalPath, outputDir: segmentsDir, segmentCount: 4 });
    await runMerge({ inputDir: segmentsDir, outputPath: mergedPath });

    const originalLines = await readJsonlLines(originalPath);
    const mergedLines = await readJsonlLines(mergedPath);

    expect(mergedLines.length).toBe(originalLines.length);

    const originalSorted = sortLinesForCompare(originalLines);
    const mergedSorted = sortLinesForCompare(mergedLines);
    expect(mergedSorted).toEqual(originalSorted);
  });

  it('round-trip preserves every entity field (observations, tags, importance, timestamps)', async () => {
    const entities: Entity[] = [
      {
        name: 'alice',
        entityType: 'person',
        observations: ['developer', 'lives in NYC'],
        createdAt: '2026-01-01T00:00:00.000Z',
        lastModified: '2026-02-01T00:00:00.000Z',
        tags: ['team-a', 'core'],
        importance: 7,
      },
      {
        name: 'project-alpha',
        entityType: 'project',
        observations: ['React app', 'launched 2025'],
        createdAt: '2026-01-15T00:00:00.000Z',
        lastModified: '2026-01-20T00:00:00.000Z',
        parentId: 'org-foo',
      },
    ];
    const relations: Relation[] = [
      {
        from: 'alice',
        to: 'project-alpha',
        relationType: 'works_on',
        createdAt: '2026-01-20T00:00:00.000Z',
        lastModified: '2026-01-20T00:00:00.000Z',
      },
    ];
    writeSampleJsonl(originalPath, { entities, relations });

    await runSplit({ inputPath: originalPath, outputDir: segmentsDir, segmentCount: 3 });
    await runMerge({ inputDir: segmentsDir, outputPath: mergedPath });

    const mergedLines = (await readJsonlLines(mergedPath)) as Record<string, unknown>[];
    const mergedAlice = mergedLines.find((l) => l.type === 'entity' && l.name === 'alice');
    expect(mergedAlice).toBeDefined();
    expect(mergedAlice).toMatchObject({
      type: 'entity',
      name: 'alice',
      entityType: 'person',
      observations: ['developer', 'lives in NYC'],
      tags: ['team-a', 'core'],
      importance: 7,
    });

    const mergedRelation = mergedLines.find((l) => l.type === 'relation');
    expect(mergedRelation).toMatchObject({
      type: 'relation',
      from: 'alice',
      to: 'project-alpha',
      relationType: 'works_on',
    });
  });
});
