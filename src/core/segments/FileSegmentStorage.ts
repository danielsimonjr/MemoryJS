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
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path';
import type { Entity, KnowledgeGraph, Relation } from '../../types/types.js';
import { logger } from '../../utils/logger.js';
import { sanitizeObject } from '../../utils/entityUtils.js';
import { durableWriteFile } from '../../utils/durableWriteFile.js';
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

  /** Path to the manifest sidecar that drives crash-atomic `saveAll`. */
  private manifestPath(): string {
    return join(this.segmentsDir, '_manifest.json');
  }

  /**
   * If a prior `saveAll` crashed in phase 3 (mid-rename), the
   * manifest sidecar survives. Replay its remaining renames forward
   * (the tmp files contain the new state we wanted to commit),
   * then delete the manifest. Called at the top of `loadAll` so
   * readers never observe a torn snapshot.
   */
  private async recoverFromManifestIfPresent(): Promise<void> {
    const manifestPath = this.manifestPath();
    let manifestContent: string;
    try {
      const manifestStat = await fs.lstat(manifestPath);
      if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
        throw new Error('Segment recovery manifest must be a regular file');
      }
      manifestContent = await fs.readFile(manifestPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }

    let manifest: { version?: unknown; moves?: unknown };
    try {
      manifest = JSON.parse(manifestContent);
    } catch {
      // Malformed manifest — bail out by deleting it. Worst case the
      // store is in the pre-saveAll state since the tmps weren't
      // renamed; users see the old snapshot.
      await fs.unlink(manifestPath).catch(() => undefined);
      return;
    }

    if (manifest.version !== 1 || !Array.isArray(manifest.moves)) {
      await fs.unlink(manifestPath).catch(() => undefined);
      return;
    }

    let moves: Array<{ tmp: string; target: string }>;
    try {
      moves = validateManifestMoves(
        manifest.moves,
        this.segmentsDir,
        this.segmentCount,
      );
    } catch (err) {
      await fs.unlink(manifestPath).catch(() => undefined);
      throw err;
    }

    for (const move of moves) {
      let tmpStat;
      try {
        // If the tmp is still around, we crashed before renaming it.
        // Complete the move. If the tmp is gone, the rename had
        // already happened — skip silently.
        tmpStat = await fs.lstat(move.tmp);
      } catch (err) {
        if (isENOENT(err)) continue;
        throw err;
      }
      if (tmpStat.isSymbolicLink() || !tmpStat.isFile()) {
        throw new Error(`Segment recovery temp must be a regular file: ${move.tmp}`);
      }

      await assertExistingPathIsRegularFile(move.target, 'recovery target');
      await assertRealPathIsDirectChild(move.tmp, this.segmentsDir);
      await assertRealPathIsDirectChildIfPresent(move.target, this.segmentsDir);
      await renameWithFallback(move.tmp, move.target);
    }
    await fs.unlink(manifestPath).catch(() => undefined);
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
    // Forward-recovery: if a prior `saveAll` crashed between renames,
    // the manifest sidecar lists the unfinished rename moves and we
    // complete them before reading. This is what makes the multi-
    // segment save crash-atomic from the loader's perspective.
    await this.recoverFromManifestIfPresent();
    const segs: Segment[] = [];
    for (let i = 0; i < this.segmentCount; i++) {
      segs.push(await this.loadSegment(i));
    }
    return mergeSegmentsIntoGraph(segs);
  }

  /**
   * Replace every segment file with slices of `graph`.
   *
   * **Crash atomicity (manifest-based):** the save proceeds in three
   * phases:
   *
   * 1. Stage — every tmp file is written + fsynced.
   * 2. Manifest — a `segments/_manifest.json` sidecar is written +
   *    fsynced atomically (temp + rename). It lists every staged
   *    (tmp, target) pair.
   * 3. Commit — each tmp is renamed onto its target, then the
   *    manifest is deleted.
   *
   * A crash:
   * - Before phase 2 → no manifest, all targets are old; staged tmp
   *   files leak (`recoverFromManifestIfPresent` cleans them up on
   *   the next `loadAll`).
   * - During phase 3 → manifest survives, listing the in-progress
   *   moves; the next `loadAll` finishes the rename loop and deletes
   *   the manifest. Loaders see the new snapshot atomically.
   *
   * This is the multi-file analog of the temp+rename trick the
   * single-file `GraphStorage.durableWriteFile` uses. The previous
   * "two-phase staging" was misleading — a crash mid-rename DID
   * leave a torn snapshot. The manifest sidecar closes that window.
   */
  async saveAll(graph: KnowledgeGraph): Promise<void> {
    const segs = splitGraphIntoSegments(graph, this.router);
    await this.ensureDir();

    // Phase 1 — stage tmps. Tracked in `staged` so we can clean up
    // on any phase-1 failure.
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
        try { await fs.unlink(tmp); } catch { /* best-effort */ }
      }
      throw err;
    }

    // Phase 2 — write the manifest atomically.
    const manifestPath = this.manifestPath();
    try {
      const manifestContent = JSON.stringify({
        version: 1,
        // Store filenames, not absolute paths. Recovery reconstructs them
        // beneath `segmentsDir` and validates both names before any rename.
        moves: staged.map(({ tmp, target }) => ({
          tmp: basename(tmp),
          target: basename(target),
        })),
      });
      const manifestTmp = await writeTmpFile(manifestPath, manifestContent);
      await renameWithFallback(manifestTmp, manifestPath);
    } catch (err) {
      for (const { tmp } of staged) {
        try { await fs.unlink(tmp); } catch { /* best-effort */ }
      }
      throw err;
    }

    // Phase 3 — perform the renames. On failure, leave the manifest
    // in place so the next `loadAll` can complete recovery. Unlink
    // remaining tmps that didn't get renamed so they don't leak
    // across recovery cycles.
    let renamedThroughIdx = -1;
    try {
      for (let i = 0; i < staged.length; i++) {
        await renameWithFallback(staged[i]!.tmp, staged[i]!.target);
        renamedThroughIdx = i;
      }
    } catch (err) {
      for (let i = renamedThroughIdx + 1; i < staged.length; i++) {
        try { await fs.unlink(staged[i]!.tmp); } catch { /* may not exist */ }
      }
      throw err;
    }

    // Phase 3 complete — drop the manifest.
    try {
      await fs.unlink(manifestPath);
    } catch {
      // Manifest already gone (someone else recovered, or it never
      // got written). Either way, our state is now consistent.
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

function validateManifestMoves(
  rawMoves: unknown[],
  segmentsDir: string,
  segmentCount: number,
): Array<{ tmp: string; target: string }> {
  if (rawMoves.length > segmentCount) {
    throw new Error(
      `Invalid segment recovery manifest: expected at most ${segmentCount} moves`,
    );
  }

  const targetIds = new Set<number>();
  const tmpPaths = new Set<string>();

  return rawMoves.map((rawMove, index) => {
    if (
      rawMove === null ||
      typeof rawMove !== 'object' ||
      Array.isArray(rawMove)
    ) {
      throw new Error(`Invalid segment recovery manifest move ${index + 1}`);
    }

    const move = rawMove as Record<string, unknown>;
    const target = resolveManifestPath(
      move.target,
      segmentsDir,
      /^(0|[1-9]\d*)\.jsonl$/,
      'target',
      index,
    );
    const tmp = resolveManifestPath(
      move.tmp,
      segmentsDir,
      /^(0|[1-9]\d*)\.jsonl\.tmp\.\d+\.[0-9a-f]{12}$/,
      'temp',
      index,
    );

    if (target.segmentId !== tmp.segmentId) {
      throw new Error(
        `Invalid segment recovery manifest move ${index + 1}: temp and target segment ids differ`,
      );
    }
    if (target.segmentId >= segmentCount) {
      throw new Error(
        `Invalid segment recovery manifest move ${index + 1}: segment id ${target.segmentId} is out of range`,
      );
    }
    if (targetIds.has(target.segmentId)) {
      throw new Error(
        `Invalid segment recovery manifest move ${index + 1}: duplicate target segment`,
      );
    }
    if (tmpPaths.has(tmp.path)) {
      throw new Error(
        `Invalid segment recovery manifest move ${index + 1}: duplicate temp file`,
      );
    }

    targetIds.add(target.segmentId);
    tmpPaths.add(tmp.path);
    return { tmp: tmp.path, target: target.path };
  });
}

function resolveManifestPath(
  rawPath: unknown,
  segmentsDir: string,
  expectedName: RegExp,
  kind: 'temp' | 'target',
  moveIndex: number,
): { path: string; segmentId: number } {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new Error(
      `Invalid segment recovery manifest move ${moveIndex + 1}: ${kind} path must be a string`,
    );
  }
  if (rawPath.split(/[/\\]/).includes('..')) {
    throw new Error(
      `Invalid segment recovery manifest move ${moveIndex + 1}: ${kind} path traversal is not allowed`,
    );
  }
  if (!isAbsolute(rawPath) && basename(rawPath) !== rawPath) {
    throw new Error(
      `Invalid segment recovery manifest move ${moveIndex + 1}: ${kind} must be a filename`,
    );
  }

  const resolvedDir = resolve(segmentsDir);
  const resolvedPath = resolve(resolvedDir, rawPath);
  const relativePath = relative(resolvedDir, resolvedPath);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    dirname(resolvedPath) !== resolvedDir
  ) {
    throw new Error(
      `Invalid segment recovery manifest move ${moveIndex + 1}: ${kind} path is outside segments directory`,
    );
  }

  const match = expectedName.exec(relativePath);
  if (!match) {
    throw new Error(
      `Invalid segment recovery manifest move ${moveIndex + 1}: unexpected ${kind} filename`,
    );
  }

  return { path: resolvedPath, segmentId: Number(match[1]) };
}

async function assertExistingPathIsRegularFile(
  path: string,
  description: string,
): Promise<void> {
  try {
    const stat = await fs.lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Segment ${description} must be a regular file: ${path}`);
    }
  } catch (err) {
    if (isENOENT(err)) return;
    throw err;
  }
}

async function assertRealPathIsDirectChild(
  path: string,
  segmentsDir: string,
): Promise<void> {
  const [realFile, realDir] = await Promise.all([
    fs.realpath(path),
    fs.realpath(segmentsDir),
  ]);
  if (dirname(realFile) !== realDir) {
    throw new Error(`Segment recovery path escapes segments directory: ${path}`);
  }
}

async function assertRealPathIsDirectChildIfPresent(
  path: string,
  segmentsDir: string,
): Promise<void> {
  try {
    await assertRealPathIsDirectChild(path, segmentsDir);
  } catch (err) {
    if (isENOENT(err)) return;
    throw err;
  }
}

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
  let malformedCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    // Per-line tolerance: a single garbage line (half-written tail
    // from a crash, hand-edit typo, etc.) should not take the whole
    // segment down. Mirrors `GraphStorage.loadFromDisk`'s
    // try/catch-per-line semantics. Malformed lines are counted and
    // logged once at the end of the file for diagnostics.
    let item: SegmentLine;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        malformedCount++;
        continue;
      }
      item = sanitizeObject(parsed as Record<string, unknown>) as SegmentLine;
    } catch {
      malformedCount++;
      continue;
    }
    if (item.type === 'entity') {
      const { type: _t, ...rest } = item;
      entities.push(rest as unknown as Entity);
    } else if (item.type === 'relation') {
      const { type: _t, ...rest } = item;
      relations.push(rest as unknown as Relation);
    } else {
      malformedCount++;
    }
  }
  if (malformedCount > 0) {
    logger.warn(
      `[FileSegmentStorage] Segment ${id}: skipped ${malformedCount} malformed line(s)`,
    );
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

// Note: per-segment writes go through `durableWriteFile` imported
// from `src/utils/durableWriteFile.ts`. The local `writeTmpFile` +
// `renameWithFallback` helpers below remain because the two-phase
// crash-atomic `saveAll` (stage every tmp, then commit every rename,
// then drop the manifest) uses them standalone — that's a different
// pattern than "one durable write to one target."

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
    await assertExistingPathIsRegularFile(target, 'rename target');
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
