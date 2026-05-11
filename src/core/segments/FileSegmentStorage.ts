/**
 * File Segment Storage — JSONL-per-segment backend
 *
 * Phase 7 task 60 (§5.3) — second task in the segment-files
 * breakdown. Persists each `Segment` to its own JSONL file under
 * `<rootDir>/segments/<id>.jsonl`. Line format matches
 * `GraphStorage`: one JSON object per line tagged with
 * `type: 'entity' | 'relation'` so a segment file is `cat`-able by
 * hand and parseable by the same `JSON.parse(line)` recipe used
 * everywhere else.
 *
 * Phase 7 task 61 — `findOutgoingRelations` / `findIncomingRelations`
 * lookup helpers exploit the routing rule (relations live in the
 * segment owning their `from` endpoint): an outgoing lookup hits one
 * segment, an incoming lookup must scan all of them.
 *
 * Atomicity: per-segment writes go through the temp-file + rename
 * pattern from `GraphStorage.durableWriteFile`, including the
 * Windows EPERM fallback (see CLAUDE.md "Gotchas"). `saveAll()` uses
 * a two-phase write — every tmp file lands first, then every rename
 * fires — so a crash *before* the first rename leaves all-old state,
 * and a crash *after* the last rename leaves all-new state. Crashes
 * in between leave a partially-applied snapshot (a smaller window
 * than save-one-at-a-time but not a true atomic commit; documented
 * on `saveAll` itself).
 *
 * **No external deps.** Pure Node `fs/promises` + `crypto`.
 *
 * @module core/segments/FileSegmentStorage
 * @experimental File layout (`segments/<id>.jsonl`) may grow sidecar
 *   files (e.g. `manifest.json`, `<id>.idx`) in non-breaking ways.
 *   The JSONL line format is the same one `GraphStorage` writes.
 */

import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { join, dirname } from 'path';
import type { Entity, KnowledgeGraph, Relation } from '../../types/types.js';
import {
  type ISegmentStorage,
  type Segment,
  type SegmentId,
  type SegmentRouter,
  mergeSegmentsIntoGraph,
  splitGraphIntoSegments,
} from './ISegmentStorage.js';

/** Serialized entity line — JSON.stringify of `{ type: 'entity', ...entity }`. */
interface EntityLine {
  type: 'entity';
  name: string;
  entityType: string;
  observations: string[];
  [extra: string]: unknown;
}

/** Serialized relation line — JSON.stringify of `{ type: 'relation', ...relation }`. */
interface RelationLine {
  type: 'relation';
  from: string;
  to: string;
  relationType: string;
  [extra: string]: unknown;
}

type SegmentLine = EntityLine | RelationLine;

export class FileSegmentStorage implements ISegmentStorage {
  readonly segmentCount: number;
  private readonly segmentsDir: string;

  constructor(
    public readonly rootDir: string,
    public readonly router: SegmentRouter,
  ) {
    this.segmentCount = router.segmentCount;
    this.segmentsDir = join(rootDir, 'segments');
  }

  /** Path to the JSONL file backing segment `id`. */
  segmentPath(id: SegmentId): string {
    this.assertValidId(id);
    return join(this.segmentsDir, `${id}.jsonl`);
  }

  async loadSegment(id: SegmentId): Promise<Segment> {
    this.assertValidId(id);
    const path = this.segmentPath(id);
    let raw: string;
    try {
      raw = await fs.readFile(path, 'utf-8');
    } catch (err) {
      if (isENOENT(err)) {
        return { id, entities: [], relations: [] };
      }
      throw err;
    }
    return parseSegmentFile(id, raw);
  }

  async saveSegment(segment: Segment): Promise<void> {
    this.assertValidId(segment.id);
    this.assertOwnership(segment);
    await this.ensureDir();
    const content = serializeSegment(segment);
    await durableWriteFile(this.segmentPath(segment.id), content);
  }

  async loadAll(): Promise<KnowledgeGraph> {
    const segs: Segment[] = [];
    for (let i = 0; i < this.segmentCount; i++) {
      segs.push(await this.loadSegment(i));
    }
    return mergeSegmentsIntoGraph(segs);
  }

  /**
   * Replace every segment file with slices of `graph`.
   *
   * Two-phase commit: every tmp file is written + fsynced before any
   * rename runs. A crash before the first rename leaves the prior
   * segments intact; a crash after the last rename leaves the new
   * snapshot intact. A crash in between leaves a mix — the window is
   * small (no I/O between renames) but not zero. Callers that need
   * true atomicity should wrap this in a higher-level transaction.
   */
  async saveAll(graph: KnowledgeGraph): Promise<void> {
    const segs = splitGraphIntoSegments(graph, this.router);
    await this.ensureDir();

    const staged: Array<{ tmp: string; target: string }> = [];
    try {
      for (const seg of segs) {
        const target = this.segmentPath(seg.id);
        const content = serializeSegment(seg);
        const tmp = await writeTmpFile(target, content);
        staged.push({ tmp, target });
      }
    } catch (err) {
      for (const { tmp } of staged) {
        try {
          await fs.unlink(tmp);
        } catch {
          /* best-effort cleanup */
        }
      }
      throw err;
    }

    for (const { tmp, target } of staged) {
      await renameWithFallback(tmp, target);
    }
  }

  async entityCount(): Promise<number> {
    let total = 0;
    for (let i = 0; i < this.segmentCount; i++) {
      const seg = await this.loadSegment(i);
      total += seg.entities.length;
    }
    return total;
  }

  /**
   * Return every relation whose `from === fromName`. Routes through
   * the segment owning `fromName` and reads only that one file —
   * O(segment-size), not O(graph-size). Mirror of the routing rule:
   * all outgoing edges for an entity live in one place.
   */
  async findOutgoingRelations(fromName: string): Promise<Relation[]> {
    const id = this.router.route(fromName);
    const seg = await this.loadSegment(id);
    return seg.relations.filter((r) => r.from === fromName);
  }

  /**
   * Return every relation whose `to === toName`. The `to` endpoint is
   * unindexed by the routing rule, so this scans every segment file.
   * Asymmetric with `findOutgoingRelations` by design — outgoing is
   * O(1 segment), incoming is O(segmentCount segments). Callers that
   * need fast incoming lookups should build a secondary index.
   */
  async findIncomingRelations(toName: string): Promise<Relation[]> {
    const out: Relation[] = [];
    for (let i = 0; i < this.segmentCount; i++) {
      const seg = await this.loadSegment(i);
      for (const r of seg.relations) {
        if (r.to === toName) out.push(r);
      }
    }
    return out;
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.segmentsDir, { recursive: true });
  }

  private assertValidId(id: SegmentId): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.segmentCount) {
      throw new Error(
        `Segment id must be an integer in [0, ${this.segmentCount}), got ${id}`,
      );
    }
  }

  private assertOwnership(segment: Segment): void {
    for (const e of segment.entities) {
      const expected = this.router.route(e.name);
      if (expected !== segment.id) {
        throw new Error(
          `FileSegmentStorage.saveSegment: entity '${e.name}' routes to segment ${expected}, not ${segment.id}`,
        );
      }
    }
    for (const r of segment.relations) {
      const expected = this.router.route(r.from);
      if (expected !== segment.id) {
        throw new Error(
          `FileSegmentStorage.saveSegment: relation from='${r.from}' routes to segment ${expected}, not ${segment.id}`,
        );
      }
    }
  }
}

// ==================== Internal helpers ====================

function serializeSegment(seg: Segment): string {
  const lines: string[] = [];
  for (const e of seg.entities) {
    const line: EntityLine = { type: 'entity', ...(e as Entity) };
    lines.push(JSON.stringify(line));
  }
  for (const r of seg.relations) {
    const line: RelationLine = { type: 'relation', ...(r as Relation) };
    lines.push(JSON.stringify(line));
  }
  return lines.join('\n');
}

function parseSegmentFile(id: SegmentId, raw: string): Segment {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const item = JSON.parse(trimmed) as SegmentLine;
    if (item.type === 'entity') {
      const { type: _t, ...rest } = item;
      entities.push(rest as unknown as Entity);
    } else if (item.type === 'relation') {
      const { type: _t, ...rest } = item;
      relations.push(rest as unknown as Relation);
    }
  }
  return { id, entities, relations };
}

function isENOENT(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * Write `content` durably to `target` via a temp file + rename.
 * Mirrors `GraphStorage.durableWriteFile` including the Windows
 * EPERM fallback documented in CLAUDE.md "Gotchas".
 */
async function durableWriteFile(target: string, content: string): Promise<void> {
  await fs.mkdir(dirname(target), { recursive: true });
  const tmp = await writeTmpFile(target, content);
  await renameWithFallback(tmp, target);
}

async function writeTmpFile(target: string, content: string): Promise<string> {
  const tmpPath = `${target}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  const fd = await fs.open(tmpPath, 'w');
  try {
    await fd.write(content);
    await fd.sync();
  } finally {
    await fd.close();
  }
  return tmpPath;
}

async function renameWithFallback(tmp: string, target: string): Promise<void> {
  try {
    await fs.rename(tmp, target);
  } catch {
    const fallback = await fs.open(target, 'w');
    try {
      const content = await fs.readFile(tmp, 'utf-8');
      await fallback.write(content);
      await fallback.sync();
    } finally {
      await fallback.close();
    }
    try {
      await fs.unlink(tmp);
    } catch {
      /* best-effort cleanup */
    }
  }
}
