#!/usr/bin/env node
/**
 * Segment JSONL Migration Tool
 *
 * Phase 7 task 63 — converts between a single-file JSONL knowledge
 * graph and the N-segment on-disk layout consumed by
 * `FileSegmentStorage` (task 60). Pure file shuffling — reuses
 * `FnvSegmentRouter` + `splitGraphIntoSegments` /
 * `mergeSegmentsIntoGraph` from `src/core/segments/ISegmentStorage.ts`
 * so routing stays bit-identical to the runtime backend.
 *
 * Usage:
 *   node tools/segment-jsonl/segment-jsonl.ts split <input.jsonl> <output-dir> --segments=N [--dry-run]
 *   node tools/segment-jsonl/segment-jsonl.ts merge <input-dir> <output.jsonl> [--dry-run]
 *
 * @module tools/segment-jsonl
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  FnvSegmentRouter,
  splitGraphIntoSegments,
  mergeSegmentsIntoGraph,
  type Segment,
} from '../../src/core/segments/ISegmentStorage.js';
import type {
  Entity,
  Relation,
  KnowledgeGraph,
} from '../../src/types/types.js';

/** Parsed shape of a single JSONL line — either an entity or a relation record. */
interface EntityLine extends Entity {
  type: 'entity';
}
interface RelationLine extends Relation {
  type: 'relation';
}
type JsonlLine = EntityLine | RelationLine;

/** Result returned by `parseArgs`. The shape is a discriminated union on `mode`. */
export type ParsedArgs =
  | {
      mode: 'split';
      input: string;
      output: string;
      segments: number;
      dryRun: boolean;
      force: boolean;
    }
  | {
      mode: 'merge';
      input: string;
      output: string;
      dryRun: boolean;
      force: boolean;
    };

/**
 * Parse `argv` (typically `process.argv.slice(2)`) into a `ParsedArgs`
 * discriminant. Throws a descriptive `Error` on malformed input.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    throw new Error('Missing subcommand. Expected "split" or "merge".');
  }
  const mode = argv[0];
  if (mode !== 'split' && mode !== 'merge') {
    throw new Error(`Unknown subcommand "${mode}". Expected "split" or "merge".`);
  }

  const positional: string[] = [];
  let segments: number | undefined;
  let dryRun = false;

  let force = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg.startsWith('--segments=')) {
      const value = arg.slice('--segments='.length);
      const n = Number(value);
      // Strict — reject floats, hex, exponents. `parseInt('3.7')`
      // silently truncated to 3, which is a footgun for operators.
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(
          `Invalid --segments value "${value}". Must be a positive integer.`,
        );
      }
      segments = n;
    } else if (arg === '--segments') {
      const value = argv[++i];
      const n = value === undefined ? Number.NaN : Number(value);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(
          `Invalid --segments value "${value ?? ''}". Must be a positive integer.`,
        );
      }
      segments = n;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag "${arg}".`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 2) {
    throw new Error(
      `${mode} requires exactly 2 positional args (input, output); got ${positional.length}.`,
    );
  }

  const [input, output] = positional as [string, string];

  if (mode === 'split') {
    if (segments === undefined) {
      throw new Error('split requires --segments=N.');
    }
    return { mode: 'split', input, output, segments, dryRun, force };
  }
  return { mode: 'merge', input, output, dryRun, force };
}

/**
 * Serialise an entity to a JSONL line matching the format used by
 * `GraphStorage.saveGraphInternal()` — `{ type: 'entity', ...e }`.
 * Optional fields with `undefined` values are dropped by `JSON.stringify`.
 */
function serializeEntity(e: Entity): string {
  return JSON.stringify({ type: 'entity', ...e });
}

function serializeRelation(r: Relation): string {
  return JSON.stringify({ type: 'relation', ...r });
}

function parseLine(line: string): JsonlLine | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const raw = JSON.parse(trimmed) as { type?: unknown };
  if (raw.type === 'entity') return raw as EntityLine;
  if (raw.type === 'relation') return raw as RelationLine;
  return null;
}

function stripType<T extends { type: string }>(rec: T): Omit<T, 'type'> {
  const { type: _type, ...rest } = rec;
  void _type;
  return rest;
}

async function readJsonlAsGraph(filePath: string): Promise<KnowledgeGraph> {
  const data = await fs.readFile(filePath, 'utf-8');
  const lines = data.split('\n');
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === null) continue;
    if (parsed.type === 'entity') {
      entities.push(stripType(parsed));
    } else {
      relations.push(stripType(parsed));
    }
  }
  return { entities, relations };
}

function segmentToLines(segment: Segment): string[] {
  const lines: string[] = [];
  for (const e of segment.entities) lines.push(serializeEntity(e));
  for (const r of segment.relations) lines.push(serializeRelation(r));
  return lines;
}

function graphToLines(graph: KnowledgeGraph): string[] {
  const lines: string[] = [];
  for (const e of graph.entities) lines.push(serializeEntity(e));
  for (const r of graph.relations) lines.push(serializeRelation(r));
  return lines;
}

/** Summary returned by `runSplit` for callers that want programmatic access. */
export interface SplitResult {
  entityCount: number;
  relationCount: number;
  segments: number;
  outputDir: string;
  segmentFiles: string[];
  dryRun: boolean;
}

/**
 * Read `inputPath` (a single-file JSONL graph), shard it into
 * `segmentCount` segments via `FnvSegmentRouter`, and write
 * `<outputDir>/segments/<id>.jsonl` for each. With `dryRun: true`,
 * no files are touched — the result still reports what would have
 * been written.
 */
export async function runSplit(opts: {
  inputPath: string;
  outputDir: string;
  segmentCount: number;
  dryRun?: boolean;
  /** When false (default), refuse to clobber existing segment files. */
  force?: boolean;
}): Promise<SplitResult> {
  const { inputPath, outputDir, segmentCount } = opts;
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;

  const absInput = path.resolve(inputPath);
  const absOutDir = path.resolve(outputDir);

  const graph = await readJsonlAsGraph(absInput);
  const router = new FnvSegmentRouter(segmentCount);
  const segments = splitGraphIntoSegments(graph, router);

  const segmentsDir = path.join(absOutDir, 'segments');
  const segmentFiles: string[] = [];
  for (let i = 0; i < segmentCount; i++) {
    segmentFiles.push(path.join(segmentsDir, `${i}.jsonl`));
  }

  if (!dryRun) {
    // Refuse to overwrite an existing segments directory unless
    // `--force` is set — protects against silently nuking a
    // hand-edited segment file.
    if (!force) {
      const existing: string[] = [];
      for (const f of segmentFiles) {
        try {
          await fs.access(f);
          existing.push(f);
        } catch {
          /* file absent — OK */
        }
      }
      if (existing.length > 0) {
        throw new Error(
          `Refusing to overwrite ${existing.length} existing segment file(s): ${existing.join(', ')}. Pass --force to clobber.`,
        );
      }
    }
    await fs.mkdir(segmentsDir, { recursive: true });
    for (const seg of segments) {
      const lines = segmentToLines(seg);
      const filePath = path.join(segmentsDir, `${seg.id}.jsonl`);
      const body = lines.length === 0 ? '' : lines.join('\n') + '\n';
      await fs.writeFile(filePath, body, 'utf-8');
    }
  }

  return {
    entityCount: graph.entities.length,
    relationCount: graph.relations.length,
    segments: segmentCount,
    outputDir: absOutDir,
    segmentFiles,
    dryRun,
  };
}

/** Summary returned by `runMerge`. */
export interface MergeResult {
  entityCount: number;
  relationCount: number;
  segmentsRead: number;
  outputPath: string;
  dryRun: boolean;
}

/**
 * Read every `<inputDir>/segments/*.jsonl` (in segment-id order),
 * merge them into a single graph, and write `outputPath`. With
 * `dryRun: true`, no files are touched but the result reports the
 * counts that would have been written.
 */
export async function runMerge(opts: {
  inputDir: string;
  outputPath: string;
  dryRun?: boolean;
  /** When false (default), refuse to clobber an existing output file. */
  force?: boolean;
}): Promise<MergeResult> {
  const { inputDir, outputPath } = opts;
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;

  const absInDir = path.resolve(inputDir);
  const absOutPath = path.resolve(outputPath);

  const segmentsDir = path.join(absInDir, 'segments');
  const entries = await fs.readdir(segmentsDir);

  // Match `<id>.jsonl` strictly so we never pick up sidecar files.
  const segmentFiles: { id: number; file: string }[] = [];
  for (const entry of entries) {
    const match = /^(\d+)\.jsonl$/.exec(entry);
    if (match === null) continue;
    const id = Number.parseInt(match[1]!, 10);
    segmentFiles.push({ id, file: path.join(segmentsDir, entry) });
  }
  segmentFiles.sort((a, b) => a.id - b.id);

  const segments: Segment[] = [];
  for (const { id, file } of segmentFiles) {
    const partial = await readJsonlAsGraph(file);
    segments.push({ id, entities: partial.entities, relations: partial.relations });
  }

  const graph = mergeSegmentsIntoGraph(segments);

  if (!dryRun) {
    if (!force) {
      try {
        await fs.access(absOutPath);
        throw new Error(
          `Refusing to overwrite existing output file ${absOutPath}. Pass --force to clobber.`,
        );
      } catch (err) {
        // Re-throw our own error; swallow ENOENT (file is absent → OK).
        if (err instanceof Error && err.message.startsWith('Refusing')) throw err;
      }
    }
    await fs.mkdir(path.dirname(absOutPath), { recursive: true });
    const lines = graphToLines(graph);
    const body = lines.length === 0 ? '' : lines.join('\n') + '\n';
    await fs.writeFile(absOutPath, body, 'utf-8');
  }

  return {
    entityCount: graph.entities.length,
    relationCount: graph.relations.length,
    segmentsRead: segments.length,
    outputPath: absOutPath,
    dryRun,
  };
}

function printHelp(): void {
  console.log(`Segment JSONL Migration Tool

Convert between single-file JSONL and the N-segment on-disk layout
used by FileSegmentStorage.

USAGE:
  segment-jsonl split <input.jsonl> <output-dir> --segments=N [--dry-run] [--force]
  segment-jsonl merge <input-dir> <output.jsonl> [--dry-run] [--force]

SPLIT writes <output-dir>/segments/<id>.jsonl for id in [0, N). Refuses
to overwrite existing segment files unless --force is set.
MERGE reads <input-dir>/segments/*.jsonl in id order and concatenates.
Refuses to overwrite the output file unless --force is set.

ROUTING:
  Each entity routes to segment fnv1a32(entity.name) % N. Relations
  live in the segment owning their 'from' endpoint.
`);
}

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return;
  }

  const opts = parseArgs(argv);

  if (opts.mode === 'split') {
    const result = await runSplit({
      inputPath: opts.input,
      outputDir: opts.output,
      segmentCount: opts.segments,
      dryRun: opts.dryRun,
      force: opts.force,
    });
    const verb = result.dryRun ? 'Would split' : 'Split';
    console.log(
      `${verb} ${result.entityCount} entities + ${result.relationCount} relations across ${result.segments} segments in ${result.outputDir}`,
    );
  } else {
    const result = await runMerge({
      inputDir: opts.input,
      outputPath: opts.output,
      dryRun: opts.dryRun,
      force: opts.force,
    });
    const verb = result.dryRun ? 'Would merge' : 'Merged';
    console.log(
      `${verb} ${result.segmentsRead} segments into ${result.entityCount} entities + ${result.relationCount} relations at ${result.outputPath}`,
    );
  }
}

// Only run the CLI when invoked directly — not when imported by tests.
const invokedDirectly = (() => {
  if (typeof process === 'undefined' || !Array.isArray(process.argv) || process.argv.length < 2) {
    return false;
  }
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    const resolved = path.resolve(entry);
    const self = new URL(import.meta.url).pathname;
    return resolved === self || resolved === self.replace(/\.js$/, '.ts');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`segment-jsonl: ${message}`);
    process.exit(1);
  });
}
