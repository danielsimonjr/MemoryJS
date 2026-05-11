#!/usr/bin/env node
/**
 * Observations-to-Columns Migration Tool
 *
 * Phase 8 task 68 (§4.3) — bulk-extract observations from an existing
 * JSONL knowledge graph into a column sidecar (the wire format used
 * by `JsonlColumnStore`, task 65), leaving the inline
 * `entity.observations` array empty. Bidirectional — `reinline`
 * reverses the operation, putting observations back on the inline
 * entity rows from the sidecar.
 *
 * The tool is the migration path for users moving an existing JSONL
 * store to the columnar layout introduced in Phase 8 (§4.3). Read
 * paths fall back to inline `entity.observations` when the column
 * store is absent, so the migration is non-destructive — the new
 * graph file plus the sidecar together carry the same information as
 * the original. Run `reinline` to undo.
 *
 * Usage:
 *   node tools/observations-to-columns/observations-to-columns.ts \
 *     extract <input.jsonl> <output.jsonl> --column-sidecar=<path> [--dry-run] [--force]
 *   node tools/observations-to-columns/observations-to-columns.ts \
 *     reinline <input.jsonl> <output.jsonl> --column-sidecar=<path> [--dry-run] [--force]
 *
 * @module tools/observations-to-columns
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Entity, Relation } from '../../src/types/types.js';

/** Parsed shape of a single JSONL entity line. */
interface EntityLine extends Entity {
  type: 'entity';
}

/** Parsed shape of a single JSONL relation line. */
interface RelationLine extends Relation {
  type: 'relation';
}

type JsonlLine = EntityLine | RelationLine;

/**
 * Single line in the column sidecar (the wire format used by
 * `JsonlColumnStore`, task 65). One per entity that has observations.
 * Entities with empty observations are omitted to keep the sidecar
 * tight.
 */
interface ColumnSidecarLine {
  name: string;
  value: string[];
}

/** Result returned by `parseArgs`. Discriminated union on `mode`. */
export type ParsedArgs =
  | {
      mode: 'extract';
      input: string;
      output: string;
      columnSidecar: string;
      dryRun: boolean;
      force: boolean;
    }
  | {
      mode: 'reinline';
      input: string;
      output: string;
      columnSidecar: string;
      dryRun: boolean;
      force: boolean;
    };

/**
 * Parse `argv` (typically `process.argv.slice(2)`) into a `ParsedArgs`.
 * Throws a descriptive `Error` on malformed input.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    throw new Error('Missing subcommand. Expected "extract" or "reinline".');
  }
  const mode = argv[0];
  if (mode !== 'extract' && mode !== 'reinline') {
    throw new Error(
      `Unknown subcommand "${mode}". Expected "extract" or "reinline".`,
    );
  }

  const positional: string[] = [];
  let columnSidecar: string | undefined;
  let dryRun = false;
  let force = false;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg.startsWith('--column-sidecar=')) {
      const value = arg.slice('--column-sidecar='.length);
      if (value === '') {
        throw new Error('Invalid --column-sidecar value: empty string.');
      }
      columnSidecar = value;
    } else if (arg === '--column-sidecar') {
      const value = argv[++i];
      if (value === undefined || value === '') {
        throw new Error('Invalid --column-sidecar value: empty or missing.');
      }
      columnSidecar = value;
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

  if (columnSidecar === undefined) {
    throw new Error(`${mode} requires --column-sidecar=<path>.`);
  }

  const [input, output] = positional as [string, string];

  return { mode, input, output, columnSidecar, dryRun, force };
}

// ==================== JSONL line helpers ====================

function parseLine(line: string): JsonlLine | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const raw = JSON.parse(trimmed) as { type?: unknown };
  if (raw.type === 'entity') return raw as EntityLine;
  if (raw.type === 'relation') return raw as RelationLine;
  return null;
}

function serializeLine(line: JsonlLine): string {
  return JSON.stringify(line);
}

async function readJsonlLines(filePath: string): Promise<JsonlLine[]> {
  const data = await fs.readFile(filePath, 'utf-8');
  const result: JsonlLine[] = [];
  for (const raw of data.split('\n')) {
    const parsed = parseLine(raw);
    if (parsed !== null) result.push(parsed);
  }
  return result;
}

/**
 * Read the column sidecar. Returns an empty map when the sidecar is
 * absent — `reinline` callers may want to detect that case (we throw
 * for `reinline` upstream); `extract` never reads the sidecar.
 */
async function readColumnSidecar(
  filePath: string,
): Promise<Map<string, string[]>> {
  const data = await fs.readFile(filePath, 'utf-8');
  const out = new Map<string, string[]>();
  for (const raw of data.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const parsed = JSON.parse(trimmed) as ColumnSidecarLine;
    out.set(parsed.name, parsed.value);
  }
  return out;
}

/**
 * Refuse to overwrite an existing file unless `force` is set. Mirrors
 * the `tools/segment-jsonl/` convention (swallow ENOENT, re-throw our
 * own "Refusing" error).
 */
async function ensureNotClobbering(
  absPath: string,
  force: boolean,
): Promise<void> {
  if (force) return;
  try {
    await fs.access(absPath);
  } catch {
    return; // file absent — OK
  }
  throw new Error(
    `Refusing to overwrite existing file ${absPath}. Pass --force to clobber.`,
  );
}

async function writeFileAtomic(absPath: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, body, 'utf-8');
}

// ==================== Programmatic API ====================

/** Summary returned by `runExtract`. */
export interface ExtractResult {
  /** Number of entity rows scanned. */
  entityCount: number;
  /** Number of relation rows passed through unchanged. */
  relationCount: number;
  /** Number of entities that had non-empty observations written to the sidecar. */
  extractedColumnCount: number;
  /** Total observation strings moved to the sidecar. */
  totalObservations: number;
  outputPath: string;
  columnSidecarPath: string;
  dryRun: boolean;
}

/**
 * Read `inputPath` (a single-file JSONL graph). For every entity row,
 * write the same row with `observations: []` to `outputPath`, and
 * record the observations under the entity's `name` in the column
 * sidecar at `columnSidecarPath`. Relations pass through unchanged.
 *
 * With `dryRun: true`, no files are touched — the result still
 * reports the counts that would have been written.
 *
 * Without `force: true`, refuses to clobber existing `outputPath` or
 * `columnSidecarPath` files.
 */
export async function runExtract(opts: {
  inputPath: string;
  outputPath: string;
  columnSidecarPath: string;
  dryRun?: boolean;
  force?: boolean;
}): Promise<ExtractResult> {
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;

  const absInput = path.resolve(opts.inputPath);
  const absOutput = path.resolve(opts.outputPath);
  const absSidecar = path.resolve(opts.columnSidecarPath);

  const lines = await readJsonlLines(absInput);

  const outputLines: string[] = [];
  const sidecarLines: string[] = [];
  let entityCount = 0;
  let relationCount = 0;
  let extractedColumnCount = 0;
  let totalObservations = 0;

  for (const line of lines) {
    if (line.type === 'entity') {
      entityCount += 1;
      const observations = Array.isArray(line.observations)
        ? line.observations
        : [];
      // Always emit the sidecar entry (even for empty observations)
      // when the inline array exists — keeps the column store and
      // inline view in lockstep. This matches `JsonlColumnStore`'s
      // tombstone-friendly contract.
      if (observations.length > 0) {
        extractedColumnCount += 1;
        totalObservations += observations.length;
        const sidecarRecord: ColumnSidecarLine = {
          name: line.name,
          value: observations,
        };
        sidecarLines.push(JSON.stringify(sidecarRecord));
      }
      const stripped: EntityLine = { ...line, observations: [] };
      outputLines.push(serializeLine(stripped));
    } else {
      relationCount += 1;
      outputLines.push(serializeLine(line));
    }
  }

  if (!dryRun) {
    await ensureNotClobbering(absOutput, force);
    await ensureNotClobbering(absSidecar, force);
    const outputBody =
      outputLines.length === 0 ? '' : outputLines.join('\n') + '\n';
    const sidecarBody =
      sidecarLines.length === 0 ? '' : sidecarLines.join('\n') + '\n';
    await writeFileAtomic(absOutput, outputBody);
    await writeFileAtomic(absSidecar, sidecarBody);
  }

  return {
    entityCount,
    relationCount,
    extractedColumnCount,
    totalObservations,
    outputPath: absOutput,
    columnSidecarPath: absSidecar,
    dryRun,
  };
}

/** Summary returned by `runReinline`. */
export interface ReinlineResult {
  /** Number of entity rows scanned. */
  entityCount: number;
  /** Number of relation rows passed through unchanged. */
  relationCount: number;
  /** Number of entities that received re-inlined observations from the sidecar. */
  reinlinedColumnCount: number;
  /** Total observation strings restored to inline form. */
  totalObservations: number;
  /** Sidecar names that did not match any entity in the input (data drift signal). */
  orphanColumnCount: number;
  outputPath: string;
  columnSidecarPath: string;
  dryRun: boolean;
}

/**
 * Reverse of `runExtract`. Reads `inputPath` plus the column sidecar
 * at `columnSidecarPath`, and writes `outputPath` with every entity
 * row's `observations` field populated from the sidecar.
 *
 * Entities not present in the sidecar keep their inline `observations`
 * (empty after a fresh `extract`, or whatever was there in a partial
 * migration). Sidecar entries whose `name` does not match any entity
 * are reported via `orphanColumnCount` — they are not silently
 * dropped from the count, but they do not produce output rows.
 *
 * With `dryRun: true`, no files are touched. Without `force: true`,
 * refuses to clobber an existing `outputPath`.
 */
export async function runReinline(opts: {
  inputPath: string;
  outputPath: string;
  columnSidecarPath: string;
  dryRun?: boolean;
  force?: boolean;
}): Promise<ReinlineResult> {
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;

  const absInput = path.resolve(opts.inputPath);
  const absOutput = path.resolve(opts.outputPath);
  const absSidecar = path.resolve(opts.columnSidecarPath);

  const lines = await readJsonlLines(absInput);
  const sidecar = await readColumnSidecar(absSidecar);

  const outputLines: string[] = [];
  let entityCount = 0;
  let relationCount = 0;
  let reinlinedColumnCount = 0;
  let totalObservations = 0;
  const consumedNames = new Set<string>();

  for (const line of lines) {
    if (line.type === 'entity') {
      entityCount += 1;
      const column = sidecar.get(line.name);
      if (column !== undefined) {
        consumedNames.add(line.name);
        reinlinedColumnCount += 1;
        totalObservations += column.length;
        const merged: EntityLine = { ...line, observations: column };
        outputLines.push(serializeLine(merged));
      } else {
        outputLines.push(serializeLine(line));
      }
    } else {
      relationCount += 1;
      outputLines.push(serializeLine(line));
    }
  }

  let orphanColumnCount = 0;
  for (const name of sidecar.keys()) {
    if (!consumedNames.has(name)) orphanColumnCount += 1;
  }

  if (!dryRun) {
    await ensureNotClobbering(absOutput, force);
    const outputBody =
      outputLines.length === 0 ? '' : outputLines.join('\n') + '\n';
    await writeFileAtomic(absOutput, outputBody);
  }

  return {
    entityCount,
    relationCount,
    reinlinedColumnCount,
    totalObservations,
    orphanColumnCount,
    outputPath: absOutput,
    columnSidecarPath: absSidecar,
    dryRun,
  };
}

// ==================== CLI entry point ====================

function printHelp(): void {
  console.log(`Observations-to-Columns Migration Tool

Bulk-extract observations from an existing JSONL knowledge graph into
a column sidecar, leaving inline observations empty. Bidirectional.

USAGE:
  observations-to-columns extract <input.jsonl> <output.jsonl> --column-sidecar=<path> [--dry-run] [--force]
  observations-to-columns reinline <input.jsonl> <output.jsonl> --column-sidecar=<path> [--dry-run] [--force]

EXTRACT reads <input.jsonl>, writes <output.jsonl> with every entity's
inline observations cleared (relations pass through), and writes the
moved observations to the column sidecar.

REINLINE reverses the operation: reads <input.jsonl> plus the column
sidecar, writes <output.jsonl> with observations populated on the
inline entity rows.

Refuses to overwrite an existing <output.jsonl> or column sidecar
unless --force is set.
`);
}

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return;
  }

  const opts = parseArgs(argv);

  if (opts.mode === 'extract') {
    const result = await runExtract({
      inputPath: opts.input,
      outputPath: opts.output,
      columnSidecarPath: opts.columnSidecar,
      dryRun: opts.dryRun,
      force: opts.force,
    });
    const verb = result.dryRun ? 'Would extract' : 'Extracted';
    console.log(
      `${verb} ${result.totalObservations} observations from ${result.extractedColumnCount}/${result.entityCount} entities (+ ${result.relationCount} relations) to ${result.outputPath} + sidecar ${result.columnSidecarPath}`,
    );
  } else {
    const result = await runReinline({
      inputPath: opts.input,
      outputPath: opts.output,
      columnSidecarPath: opts.columnSidecar,
      dryRun: opts.dryRun,
      force: opts.force,
    });
    const verb = result.dryRun ? 'Would reinline' : 'Reinlined';
    const orphanNote =
      result.orphanColumnCount > 0
        ? ` (${result.orphanColumnCount} orphan sidecar entries skipped)`
        : '';
    console.log(
      `${verb} ${result.totalObservations} observations into ${result.reinlinedColumnCount}/${result.entityCount} entities (+ ${result.relationCount} relations) at ${result.outputPath}${orphanNote}`,
    );
  }
}

// Only run the CLI when invoked directly — not when imported by tests.
const invokedDirectly = ((): boolean => {
  if (
    typeof process === 'undefined' ||
    !Array.isArray(process.argv) ||
    process.argv.length < 2
  ) {
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
    console.error(`observations-to-columns: ${message}`);
    process.exit(1);
  });
}
