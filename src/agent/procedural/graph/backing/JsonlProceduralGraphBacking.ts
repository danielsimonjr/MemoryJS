/**
 * Single-file JSONL procedural-graph backing.
 *
 * Full state is loaded at `open()` and mutated in memory under an
 * `AsyncMutex`. Persistence is **append-only**: every mutation appends the
 * records it produced (`ProceduralGraphState.drainPendingLines`) through
 * `durableAppendFile`, so a write costs O(delta) rather than O(total state).
 * Record order on disk is irrelevant to the loader; head lines carry an
 * increasing `headVersion` and the highest wins.
 *
 * Crash safety: an append can only tear its own tail, and the loader
 * tolerates one torn trailing line. Two situations would otherwise leave a
 * torn line *inside* the file, and both trigger a full atomic re-publication
 * via `durableWriteFile`: (1) a torn tail found at `open()` is compacted away
 * before the backing is returned; (2) a failed append marks the backing so
 * the next write republishes the complete state instead of appending.
 *
 * Refuses to open when `MEMORY_STORAGE_SEGMENT_COUNT` activates GraphStorage
 * segment mode (A3).
 *
 * @module agent/procedural/graph/backing/JsonlProceduralGraphBacking
 * @experimental
 */

import { readFile } from 'node:fs/promises';
import { durableAppendFile, durableWriteFile } from '../../../../utils/durableWriteFile.js';
import { logger } from '../../../../utils/logger.js';
import { LockedProceduralGraphBacking } from './LockedProceduralGraphBacking.js';
import { ProceduralGraphState } from './ProceduralGraphState.js';

const MAX_SEGMENT_COUNT = 1024;
const SEGMENT_COUNT_PATTERN = /^[1-9][0-9]*$/;

const SEGMENT_MODE_ERROR = 'PG JSONL backing does not support MEMORY_STORAGE_SEGMENT_COUNT>=2';

export class JsonlProceduralGraphBacking extends LockedProceduralGraphBacking {
  readonly kind = 'jsonl' as const;

  /** When true the next write republishes the whole file instead of appending. */
  private needsRepublish = false;

  private constructor(
    private readonly filePath: string,
    state: ProceduralGraphState,
  ) {
    super(state);
  }

  static async open(filePath: string): Promise<JsonlProceduralGraphBacking> {
    if (isSegmentModeActive()) {
      throw new Error(SEGMENT_MODE_ERROR);
    }
    const { state, tornTail } = await loadJsonlFile(filePath);
    // Loading never queues lines, but be explicit so the first append is a pure delta.
    state.drainPendingLines();
    if (tornTail) {
      // Compact the torn trailing line away now; appending after it would
      // leave corruption in the middle of the file.
      await durableWriteFile(filePath, state.toJsonl());
    }
    return new JsonlProceduralGraphBacking(filePath, state);
  }

  protected override async afterWrite(): Promise<void> {
    const lines = this.state.drainPendingLines();
    if (this.needsRepublish) {
      await durableWriteFile(this.filePath, this.state.toJsonl());
      this.needsRepublish = false;
      return;
    }
    if (lines.length === 0) {
      return;
    }
    try {
      await durableAppendFile(this.filePath, `${lines.join('\n')}\n`);
    } catch (error) {
      // The tail may now be torn; heal it on the next write with a full,
      // atomic re-publication of the in-memory state.
      this.needsRepublish = true;
      throw error;
    }
  }
}

/**
 * Same regex/range as `GraphStorage.resolveSegmentStorage`: a plain positive
 * decimal integer in `[2, 1024]` activates segment mode.
 */
function isSegmentModeActive(): boolean {
  const raw = process.env.MEMORY_STORAGE_SEGMENT_COUNT;
  if (!raw) return false;
  if (!SEGMENT_COUNT_PATTERN.test(raw)) return false;
  const count = Number(raw);
  return Number.isInteger(count) && count >= 2 && count <= MAX_SEGMENT_COUNT;
}

async function loadJsonlFile(
  filePath: string,
): Promise<{ state: ProceduralGraphState; tornTail: boolean }> {
  const state = new ProceduralGraphState();
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state, tornTail: false };
    }
    throw error;
  }

  const lines = text.split('\n');
  let lastNonEmpty = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.trim() !== '') lastNonEmpty = i;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!.trim();
    if (raw === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (i === lastNonEmpty) {
        logger.warn(`Ignoring torn trailing JSONL line in procedural graph backing: ${filePath}`);
        return { state, tornTail: true };
      }
      throw new Error(`Invalid JSONL line in procedural graph backing: ${filePath}`);
    }
    state.applyRecord(parsed);
  }
  return { state, tornTail: false };
}
