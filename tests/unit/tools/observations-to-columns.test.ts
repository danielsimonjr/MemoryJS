import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runExtract,
  runReinline,
  parseArgs,
} from '../../../tools/observations-to-columns/observations-to-columns.js';
import type {
  Entity,
  Relation,
  KnowledgeGraph,
} from '../../../src/types/types.js';

// ==================== Fixtures ====================

function buildSampleGraph(
  entityCount = 20,
  relationCount = 8,
): KnowledgeGraph {
  const entities: Entity[] = [];
  for (let i = 0; i < entityCount; i++) {
    entities.push({
      name: `entity-${i}`,
      entityType: i % 2 === 0 ? 'person' : 'project',
      observations: [`obs-${i}-a`, `obs-${i}-b`],
      createdAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      lastModified: `2026-01-02T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      tags: i % 3 === 0 ? ['core'] : undefined,
      importance: i % 5,
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

/** Stable, type-aware sort key used to compare two graph files modulo ordering. */
function stableKey(rec: Record<string, unknown>): string {
  if (rec.type === 'entity') return `E:${String(rec.name)}`;
  return `R:${String(rec.from)}->${String(rec.to)}:${String(rec.relationType)}`;
}

function sortLinesForCompare(lines: unknown[]): string[] {
  return lines
    .map((l) => {
      const rec = l as Record<string, unknown>;
      return { key: stableKey(rec), json: JSON.stringify(l) };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((x) => x.json);
}

// ==================== parseArgs ====================

describe('observations-to-columns / parseArgs', () => {
  it('parses extract with --column-sidecar=path', () => {
    const parsed = parseArgs([
      'extract',
      'in.jsonl',
      'out.jsonl',
      '--column-sidecar=col.jsonl',
    ]);
    expect(parsed).toEqual({
      mode: 'extract',
      input: 'in.jsonl',
      output: 'out.jsonl',
      columnSidecar: 'col.jsonl',
      dryRun: false,
      force: false,
    });
  });

  it('parses extract with --column-sidecar path (space-separated)', () => {
    const parsed = parseArgs([
      'extract',
      'in.jsonl',
      'out.jsonl',
      '--column-sidecar',
      'col.jsonl',
    ]);
    expect(parsed.mode === 'extract' && parsed.columnSidecar).toBe('col.jsonl');
  });

  it('parses reinline subcommand', () => {
    const parsed = parseArgs([
      'reinline',
      'in.jsonl',
      'out.jsonl',
      '--column-sidecar=col.jsonl',
    ]);
    expect(parsed).toEqual({
      mode: 'reinline',
      input: 'in.jsonl',
      output: 'out.jsonl',
      columnSidecar: 'col.jsonl',
      dryRun: false,
      force: false,
    });
  });

  it('parses --dry-run flag', () => {
    const parsed = parseArgs([
      'extract',
      'in.jsonl',
      'out.jsonl',
      '--column-sidecar=col.jsonl',
      '--dry-run',
    ]);
    expect(parsed.dryRun).toBe(true);
  });

  it('parses --force flag', () => {
    const parsed = parseArgs([
      'extract',
      'in.jsonl',
      'out.jsonl',
      '--column-sidecar=col.jsonl',
      '--force',
    ]);
    expect(parsed.force).toBe(true);
  });

  it('rejects extract missing --column-sidecar', () => {
    expect(() => parseArgs(['extract', 'in.jsonl', 'out.jsonl'])).toThrow(
      /--column-sidecar/,
    );
  });

  it('rejects reinline missing --column-sidecar', () => {
    expect(() => parseArgs(['reinline', 'in.jsonl', 'out.jsonl'])).toThrow(
      /--column-sidecar/,
    );
  });

  it('rejects empty --column-sidecar value', () => {
    expect(() =>
      parseArgs(['extract', 'in.jsonl', 'out.jsonl', '--column-sidecar=']),
    ).toThrow(/empty/);
  });

  it('rejects unknown subcommand', () => {
    expect(() =>
      parseArgs(['frobnicate', 'a', 'b', '--column-sidecar=c']),
    ).toThrow(/Unknown subcommand/);
  });

  it('rejects unknown flag', () => {
    expect(() =>
      parseArgs([
        'extract',
        'in.jsonl',
        'out.jsonl',
        '--column-sidecar=col.jsonl',
        '--bogus',
      ]),
    ).toThrow(/Unknown flag/);
  });

  it('rejects missing positional args', () => {
    expect(() =>
      parseArgs(['extract', 'in.jsonl', '--column-sidecar=col.jsonl']),
    ).toThrow(/positional args/);
  });

  it('rejects extra positional args', () => {
    expect(() =>
      parseArgs([
        'extract',
        'in.jsonl',
        'out.jsonl',
        'extra.jsonl',
        '--column-sidecar=col.jsonl',
      ]),
    ).toThrow(/positional args/);
  });

  it('rejects empty argv', () => {
    expect(() => parseArgs([])).toThrow(/Missing subcommand/);
  });
});

// ==================== runExtract ====================

describe('observations-to-columns / runExtract', () => {
  let tmpDir: string;
  let inputPath: string;
  let outputPath: string;
  let sidecarPath: string;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'mjs-obs2col-ext-'));
    inputPath = path.join(tmpDir, 'memory.jsonl');
    outputPath = path.join(tmpDir, 'memory.columnar.jsonl');
    sidecarPath = path.join(tmpDir, 'memory.observations.jsonl');
  });

  afterEach(() => {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a graph file with cleared inline observations and a populated sidecar', async () => {
    const graph = buildSampleGraph(10, 4);
    writeSampleJsonl(inputPath, graph);

    const result = await runExtract({
      inputPath,
      outputPath,
      columnSidecarPath: sidecarPath,
    });

    expect(result.entityCount).toBe(10);
    expect(result.relationCount).toBe(4);
    expect(result.extractedColumnCount).toBe(10); // every entity had 2 obs
    expect(result.totalObservations).toBe(20);
    expect(result.dryRun).toBe(false);

    const outputLines = (await readJsonlLines(outputPath)) as Record<
      string,
      unknown
    >[];
    const outputEntities = outputLines.filter((l) => l.type === 'entity');
    expect(outputEntities.length).toBe(10);
    for (const ent of outputEntities) {
      expect(ent.observations).toEqual([]);
    }
    const outputRelations = outputLines.filter((l) => l.type === 'relation');
    expect(outputRelations.length).toBe(4);

    const sidecarLines = (await readJsonlLines(sidecarPath)) as Record<
      string,
      unknown
    >[];
    expect(sidecarLines.length).toBe(10);
    for (const line of sidecarLines) {
      expect(typeof line.name).toBe('string');
      expect(Array.isArray(line.value)).toBe(true);
      const value = line.value as string[];
      expect(value.length).toBe(2);
    }
  });

  it('preserves all non-observation entity fields', async () => {
    const graph: KnowledgeGraph = {
      entities: [
        {
          name: 'alice',
          entityType: 'person',
          observations: ['developer', 'lives in NYC'],
          createdAt: '2026-01-01T00:00:00.000Z',
          lastModified: '2026-02-01T00:00:00.000Z',
          tags: ['team-a', 'core'],
          importance: 7,
          parentId: 'org-foo',
        },
      ],
      relations: [],
    };
    writeSampleJsonl(inputPath, graph);

    await runExtract({
      inputPath,
      outputPath,
      columnSidecarPath: sidecarPath,
    });

    const outputLines = (await readJsonlLines(outputPath)) as Record<
      string,
      unknown
    >[];
    expect(outputLines[0]).toMatchObject({
      type: 'entity',
      name: 'alice',
      entityType: 'person',
      observations: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-02-01T00:00:00.000Z',
      tags: ['team-a', 'core'],
      importance: 7,
      parentId: 'org-foo',
    });

    const sidecarLines = (await readJsonlLines(sidecarPath)) as Record<
      string,
      unknown
    >[];
    expect(sidecarLines[0]).toEqual({
      name: 'alice',
      value: ['developer', 'lives in NYC'],
    });
  });

  it('omits entities with empty observations from the sidecar', async () => {
    const graph: KnowledgeGraph = {
      entities: [
        {
          name: 'has-obs',
          entityType: 'person',
          observations: ['only one'],
        },
        {
          name: 'empty-obs',
          entityType: 'person',
          observations: [],
        },
      ],
      relations: [],
    };
    writeSampleJsonl(inputPath, graph);

    const result = await runExtract({
      inputPath,
      outputPath,
      columnSidecarPath: sidecarPath,
    });

    expect(result.entityCount).toBe(2);
    expect(result.extractedColumnCount).toBe(1);
    expect(result.totalObservations).toBe(1);

    const sidecarLines = (await readJsonlLines(sidecarPath)) as Record<
      string,
      unknown
    >[];
    expect(sidecarLines.length).toBe(1);
    expect(sidecarLines[0]).toEqual({ name: 'has-obs', value: ['only one'] });
  });

  it('--dry-run does not touch the filesystem', async () => {
    const graph = buildSampleGraph(5, 2);
    writeSampleJsonl(inputPath, graph);

    const result = await runExtract({
      inputPath,
      outputPath,
      columnSidecarPath: sidecarPath,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.entityCount).toBe(5);
    expect(result.relationCount).toBe(2);
    expect(fsSync.existsSync(outputPath)).toBe(false);
    expect(fsSync.existsSync(sidecarPath)).toBe(false);
  });

  it('refuses to overwrite existing output file without --force', async () => {
    const graph = buildSampleGraph(3, 1);
    writeSampleJsonl(inputPath, graph);
    fsSync.writeFileSync(outputPath, 'pre-existing content', 'utf-8');

    await expect(
      runExtract({
        inputPath,
        outputPath,
        columnSidecarPath: sidecarPath,
      }),
    ).rejects.toThrow(/Refusing to overwrite/);

    // pre-existing content unchanged
    expect(fsSync.readFileSync(outputPath, 'utf-8')).toBe(
      'pre-existing content',
    );
  });

  it('refuses to overwrite existing sidecar file without --force', async () => {
    const graph = buildSampleGraph(3, 1);
    writeSampleJsonl(inputPath, graph);
    fsSync.writeFileSync(sidecarPath, 'pre-existing sidecar', 'utf-8');

    await expect(
      runExtract({
        inputPath,
        outputPath,
        columnSidecarPath: sidecarPath,
      }),
    ).rejects.toThrow(/Refusing to overwrite/);
  });

  it('--force allows overwriting existing output + sidecar', async () => {
    const graph = buildSampleGraph(3, 1);
    writeSampleJsonl(inputPath, graph);
    fsSync.writeFileSync(outputPath, 'pre-existing content', 'utf-8');
    fsSync.writeFileSync(sidecarPath, 'pre-existing sidecar', 'utf-8');

    const result = await runExtract({
      inputPath,
      outputPath,
      columnSidecarPath: sidecarPath,
      force: true,
    });

    expect(result.entityCount).toBe(3);
    // Files must have been replaced with valid JSONL.
    const outputLines = (await readJsonlLines(outputPath)) as Record<
      string,
      unknown
    >[];
    expect(outputLines.length).toBe(4);
    const sidecarLines = (await readJsonlLines(sidecarPath)) as Record<
      string,
      unknown
    >[];
    expect(sidecarLines.length).toBe(3);
  });
});

// ==================== runReinline ====================

describe('observations-to-columns / runReinline', () => {
  let tmpDir: string;
  let columnarPath: string;
  let sidecarPath: string;
  let reinlinedPath: string;
  let originalPath: string;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'mjs-obs2col-re-'));
    originalPath = path.join(tmpDir, 'memory.jsonl');
    columnarPath = path.join(tmpDir, 'memory.columnar.jsonl');
    sidecarPath = path.join(tmpDir, 'memory.observations.jsonl');
    reinlinedPath = path.join(tmpDir, 'memory.reinlined.jsonl');
  });

  afterEach(() => {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rebuilds inline observations from the sidecar', async () => {
    const graph = buildSampleGraph(10, 4);
    writeSampleJsonl(originalPath, graph);

    await runExtract({
      inputPath: originalPath,
      outputPath: columnarPath,
      columnSidecarPath: sidecarPath,
    });

    const result = await runReinline({
      inputPath: columnarPath,
      outputPath: reinlinedPath,
      columnSidecarPath: sidecarPath,
    });

    expect(result.entityCount).toBe(10);
    expect(result.relationCount).toBe(4);
    expect(result.reinlinedColumnCount).toBe(10);
    expect(result.totalObservations).toBe(20);
    expect(result.orphanColumnCount).toBe(0);

    const reinlinedLines = (await readJsonlLines(reinlinedPath)) as Record<
      string,
      unknown
    >[];
    const reinlinedEntities = reinlinedLines.filter(
      (l) => l.type === 'entity',
    );
    for (const ent of reinlinedEntities) {
      const observations = ent.observations as string[];
      expect(observations.length).toBe(2);
    }
  });

  it('leaves entities without sidecar entry untouched', async () => {
    // Manually craft a columnar input where one entity is absent from the sidecar.
    const lines = [
      JSON.stringify({
        type: 'entity',
        name: 'has-sidecar',
        entityType: 'person',
        observations: [],
      }),
      JSON.stringify({
        type: 'entity',
        name: 'no-sidecar',
        entityType: 'person',
        observations: ['kept-inline'],
      }),
    ];
    fsSync.writeFileSync(columnarPath, lines.join('\n') + '\n', 'utf-8');
    fsSync.writeFileSync(
      sidecarPath,
      JSON.stringify({ name: 'has-sidecar', value: ['from-sidecar'] }) + '\n',
      'utf-8',
    );

    const result = await runReinline({
      inputPath: columnarPath,
      outputPath: reinlinedPath,
      columnSidecarPath: sidecarPath,
    });

    expect(result.reinlinedColumnCount).toBe(1);
    expect(result.orphanColumnCount).toBe(0);

    const out = (await readJsonlLines(reinlinedPath)) as Record<
      string,
      unknown
    >[];
    const hasSidecar = out.find((l) => l.name === 'has-sidecar');
    const noSidecar = out.find((l) => l.name === 'no-sidecar');
    expect(hasSidecar?.observations).toEqual(['from-sidecar']);
    expect(noSidecar?.observations).toEqual(['kept-inline']);
  });

  it('reports orphan sidecar entries (sidecar names not present in input)', async () => {
    fsSync.writeFileSync(
      columnarPath,
      JSON.stringify({
        type: 'entity',
        name: 'alice',
        entityType: 'person',
        observations: [],
      }) + '\n',
      'utf-8',
    );
    const sidecarLines = [
      JSON.stringify({ name: 'alice', value: ['real'] }),
      JSON.stringify({ name: 'ghost', value: ['orphan'] }),
    ];
    fsSync.writeFileSync(sidecarPath, sidecarLines.join('\n') + '\n', 'utf-8');

    const result = await runReinline({
      inputPath: columnarPath,
      outputPath: reinlinedPath,
      columnSidecarPath: sidecarPath,
    });

    expect(result.reinlinedColumnCount).toBe(1);
    expect(result.orphanColumnCount).toBe(1);

    // Only the real entity is in the output — orphans don't materialise.
    const out = (await readJsonlLines(reinlinedPath)) as Record<
      string,
      unknown
    >[];
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      type: 'entity',
      name: 'alice',
      observations: ['real'],
    });
  });

  it('--dry-run does not touch the filesystem', async () => {
    const graph = buildSampleGraph(3, 1);
    writeSampleJsonl(originalPath, graph);
    await runExtract({
      inputPath: originalPath,
      outputPath: columnarPath,
      columnSidecarPath: sidecarPath,
    });

    const result = await runReinline({
      inputPath: columnarPath,
      outputPath: reinlinedPath,
      columnSidecarPath: sidecarPath,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.entityCount).toBe(3);
    expect(fsSync.existsSync(reinlinedPath)).toBe(false);
  });

  it('refuses to overwrite existing output file without --force', async () => {
    const graph = buildSampleGraph(3, 1);
    writeSampleJsonl(originalPath, graph);
    await runExtract({
      inputPath: originalPath,
      outputPath: columnarPath,
      columnSidecarPath: sidecarPath,
    });
    fsSync.writeFileSync(reinlinedPath, 'pre-existing content', 'utf-8');

    await expect(
      runReinline({
        inputPath: columnarPath,
        outputPath: reinlinedPath,
        columnSidecarPath: sidecarPath,
      }),
    ).rejects.toThrow(/Refusing to overwrite/);
  });

  it('--force allows overwriting existing output', async () => {
    const graph = buildSampleGraph(3, 1);
    writeSampleJsonl(originalPath, graph);
    await runExtract({
      inputPath: originalPath,
      outputPath: columnarPath,
      columnSidecarPath: sidecarPath,
    });
    fsSync.writeFileSync(reinlinedPath, 'pre-existing content', 'utf-8');

    const result = await runReinline({
      inputPath: columnarPath,
      outputPath: reinlinedPath,
      columnSidecarPath: sidecarPath,
      force: true,
    });

    expect(result.entityCount).toBe(3);
    const out = (await readJsonlLines(reinlinedPath)) as Record<
      string,
      unknown
    >[];
    expect(out.filter((l) => l.type === 'entity').length).toBe(3);
  });
});

// ==================== Round-trip ====================

describe('observations-to-columns / round-trip', () => {
  let tmpDir: string;
  let originalPath: string;
  let columnarPath: string;
  let sidecarPath: string;
  let reinlinedPath: string;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'mjs-obs2col-rt-'));
    originalPath = path.join(tmpDir, 'memory.jsonl');
    columnarPath = path.join(tmpDir, 'memory.columnar.jsonl');
    sidecarPath = path.join(tmpDir, 'memory.observations.jsonl');
    reinlinedPath = path.join(tmpDir, 'memory.reinlined.jsonl');
  });

  afterEach(() => {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extract → reinline yields a graph entity-set-equivalent to the original', async () => {
    const graph = buildSampleGraph(20, 8);
    writeSampleJsonl(originalPath, graph);

    await runExtract({
      inputPath: originalPath,
      outputPath: columnarPath,
      columnSidecarPath: sidecarPath,
    });
    await runReinline({
      inputPath: columnarPath,
      outputPath: reinlinedPath,
      columnSidecarPath: sidecarPath,
    });

    const originalLines = await readJsonlLines(originalPath);
    const reinlinedLines = await readJsonlLines(reinlinedPath);

    expect(reinlinedLines.length).toBe(originalLines.length);

    const originalSorted = sortLinesForCompare(originalLines);
    const reinlinedSorted = sortLinesForCompare(reinlinedLines);
    expect(reinlinedSorted).toEqual(originalSorted);
  });

  it('round-trip preserves every entity field including observations content', async () => {
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

    await runExtract({
      inputPath: originalPath,
      outputPath: columnarPath,
      columnSidecarPath: sidecarPath,
    });
    await runReinline({
      inputPath: columnarPath,
      outputPath: reinlinedPath,
      columnSidecarPath: sidecarPath,
    });

    const reinlinedLines = (await readJsonlLines(reinlinedPath)) as Record<
      string,
      unknown
    >[];

    const reinlinedAlice = reinlinedLines.find(
      (l) => l.type === 'entity' && l.name === 'alice',
    );
    expect(reinlinedAlice).toMatchObject({
      type: 'entity',
      name: 'alice',
      entityType: 'person',
      observations: ['developer', 'lives in NYC'],
      tags: ['team-a', 'core'],
      importance: 7,
    });

    const reinlinedRelation = reinlinedLines.find((l) => l.type === 'relation');
    expect(reinlinedRelation).toMatchObject({
      type: 'relation',
      from: 'alice',
      to: 'project-alpha',
      relationType: 'works_on',
    });
  });

  it('handles an empty graph', async () => {
    fsSync.writeFileSync(originalPath, '', 'utf-8');

    const extract = await runExtract({
      inputPath: originalPath,
      outputPath: columnarPath,
      columnSidecarPath: sidecarPath,
    });
    expect(extract.entityCount).toBe(0);
    expect(extract.relationCount).toBe(0);
    expect(extract.totalObservations).toBe(0);

    const reinline = await runReinline({
      inputPath: columnarPath,
      outputPath: reinlinedPath,
      columnSidecarPath: sidecarPath,
    });
    expect(reinline.entityCount).toBe(0);
    expect(reinline.relationCount).toBe(0);
    expect(reinline.totalObservations).toBe(0);

    expect(fsSync.readFileSync(reinlinedPath, 'utf-8')).toBe('');
    expect(fsSync.readFileSync(sidecarPath, 'utf-8')).toBe('');
  });
});
