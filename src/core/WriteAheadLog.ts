/**
 * Write-Ahead Log (WAL)
 *
 * Phase 6 step 40 (§2.1) — durability scaffolding for the JSONL
 * backend. Closes the deferral by shipping the append-only log + the
 * recovery-replay machinery so a crash mid-write can't lose
 * acknowledged operations.
 *
 * **Usage shape:**
 *
 * 1. Before each mutation, `append(op)` writes the op to
 *    `<storage>.wal` and `fsync`s.
 * 2. The mutation then applies to the main JSONL file.
 * 3. On successful main-file write, `checkpoint()` truncates the WAL.
 * 4. On startup, `replay()` reads any unchecked-pointed entries and
 *    returns them so the caller can re-apply.
 *
 * The WAL is JSONL itself — one operation per line — so it can be
 * inspected with `cat` / `jq` like the rest of the storage layer.
 *
 * **No external deps.** Uses Node's built-in `fs` + `fs/promises`.
 *
 * @module core/WriteAheadLog
 * @experimental WAL entry shape (`WALEntry`) may grow new
 *   operation kinds in non-breaking ways; recovery code falls back
 *   to skipping unknown kinds with a warning.
 */

import { promises as fs, openSync, writeSync, fsyncSync, closeSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import type { Entity, Relation } from '../types/types.js';
import { logger } from '../utils/logger.js';

/** A single durable operation recorded ahead of the main-file write. */
export type WALEntry =
  | { op: 'put-entity'; entity: Entity; ts: string }
  | { op: 'delete-entity'; name: string; ts: string }
  | { op: 'put-relation'; relation: Relation; ts: string }
  | {
      op: 'delete-relation';
      from: string;
      to: string;
      relationType: string;
      ts: string;
    };

export interface WALOptions {
  /** Force fsync after every append. Default: true (durable). */
  fsyncOnAppend?: boolean;
}

/**
 * Append-only write-ahead log over a single file. Designed for one
 * writer at a time — concurrent appends from multiple processes
 * aren't supported; rely on file-locking at the storage layer if
 * that matters.
 *
 * @example
 * ```typescript
 * const wal = new WriteAheadLog('/data/memory.jsonl.wal');
 * await wal.append({ op: 'put-entity', entity: ..., ts: new Date().toISOString() });
 * // ... apply to main storage ...
 * await wal.checkpoint();
 * ```
 */
export class WriteAheadLog {
  private readonly fsyncOnAppend: boolean;

  constructor(public readonly walPath: string, options: WALOptions = {}) {
    this.fsyncOnAppend = options.fsyncOnAppend ?? true;
  }

  /**
   * Path the WAL companion file lives at. Derived from a primary
   * storage path by appending `.wal`. Stable so recovery code can
   * find the WAL without separate config.
   */
  static walPathFor(storagePath: string): string {
    return `${storagePath}.wal`;
  }

  /**
   * Append a single op, sync to disk (when `fsyncOnAppend`), and
   * return. Synchronous fsync is the slow path — but it's the
   * point of a WAL. Callers who want softer durability can pass
   * `fsyncOnAppend: false` and accept a window of crash-loss.
   */
  async append(entry: WALEntry): Promise<void> {
    await fs.mkdir(dirname(this.walPath), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    if (this.fsyncOnAppend) {
      // Use sync ops here to ensure fsync ordering — async fs.appendFile
      // can interleave with the main-file write on some filesystems.
      const fd = openSync(this.walPath, 'a');
      try {
        writeSync(fd, line);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } else {
      await fs.appendFile(this.walPath, line);
    }
  }

  /** Whether a non-empty WAL exists on disk. */
  hasPending(): boolean {
    if (!existsSync(this.walPath)) return false;
    try {
      const stat = require('fs').statSync(this.walPath);
      return stat.size > 0;
    } catch {
      return false;
    }
  }

  /**
   * Read every entry from the WAL. Used by recovery on startup —
   * the caller replays each entry into main storage, then calls
   * `checkpoint()` to drop the WAL.
   *
   * Malformed lines are logged and skipped — a corrupt tail
   * shouldn't block replay of the well-formed prefix.
   */
  async replay(): Promise<WALEntry[]> {
    try {
      await fs.access(this.walPath);
    } catch {
      return [];
    }
    const text = await fs.readFile(this.walPath, 'utf-8');
    const entries: WALEntry[] = [];
    let lineNum = 0;
    for (const line of text.split('\n')) {
      lineNum++;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (isKnownOp(parsed)) {
          entries.push(parsed as WALEntry);
        } else {
          logger.warn(
            `[WAL] Skipping entry with unknown op '${parsed.op}' at ${this.walPath}:${lineNum}`,
          );
        }
      } catch (err) {
        logger.warn(
          `[WAL] Skipping malformed entry at ${this.walPath}:${lineNum}: ${(err as Error).message}`,
        );
      }
    }
    return entries;
  }

  /**
   * Mark every queued entry as durably applied to main storage by
   * truncating the WAL. Idempotent — calling `checkpoint()` on an
   * absent WAL is a no-op.
   */
  async checkpoint(): Promise<void> {
    try {
      await fs.unlink(this.walPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * Snapshot stat info for diagnostics. Returns `null` when the
   * WAL doesn't exist.
   */
  async stats(): Promise<{ path: string; size: number; entryCount: number } | null> {
    try {
      const stat = await fs.stat(this.walPath);
      const entries = await this.replay();
      return {
        path: this.walPath,
        size: stat.size,
        entryCount: entries.length,
      };
    } catch {
      return null;
    }
  }
}

function isKnownOp(value: unknown): value is WALEntry {
  if (!value || typeof value !== 'object') return false;
  const op = (value as { op?: unknown }).op;
  return (
    op === 'put-entity' ||
    op === 'delete-entity' ||
    op === 'put-relation' ||
    op === 'delete-relation'
  );
}

/**
 * Apply replayed WAL entries to a `KnowledgeGraph`-shaped snapshot.
 * Mutates the snapshot in place — caller is responsible for serializing
 * it back to main storage afterwards. Order matters: replay applies
 * entries in the order they were appended.
 *
 * @example
 * ```typescript
 * const wal = new WriteAheadLog(WriteAheadLog.walPathFor(path));
 * const pending = await wal.replay();
 * if (pending.length > 0) {
 *   const graph = await storage.loadGraph();
 *   applyWALToGraph(pending, graph);
 *   await storage.saveGraph(graph);
 *   await wal.checkpoint();
 * }
 * ```
 */
export function applyWALToGraph(
  entries: WALEntry[],
  graph: { entities: Entity[]; relations: Relation[] },
): void {
  for (const entry of entries) {
    switch (entry.op) {
      case 'put-entity': {
        const idx = graph.entities.findIndex((e) => e.name === entry.entity.name);
        if (idx >= 0) graph.entities[idx] = entry.entity;
        else graph.entities.push(entry.entity);
        break;
      }
      case 'delete-entity':
        graph.entities = graph.entities.filter((e) => e.name !== entry.name);
        graph.relations = graph.relations.filter(
          (r) => r.from !== entry.name && r.to !== entry.name,
        );
        break;
      case 'put-relation': {
        const existing = graph.relations.find(
          (r) =>
            r.from === entry.relation.from &&
            r.to === entry.relation.to &&
            r.relationType === entry.relation.relationType,
        );
        if (!existing) graph.relations.push(entry.relation);
        break;
      }
      case 'delete-relation':
        graph.relations = graph.relations.filter(
          (r) =>
            !(
              r.from === entry.from &&
              r.to === entry.to &&
              r.relationType === entry.relationType
            ),
        );
        break;
    }
  }
}

// Helper to keep callers from having to import `path/join` themselves
// when they want to build a WAL companion next to their main file.
export const _internal = { join };
