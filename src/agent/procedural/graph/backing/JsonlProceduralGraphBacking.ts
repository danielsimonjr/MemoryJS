/**
 * Single-file JSONL procedural-graph backing.
 *
 * Full state is loaded at `open()`, mutated in memory under an `AsyncMutex`,
 * and re-published via `durableWriteFile` on every write. Head lines are
 * append-only with increasing `headVersion`; the latest wins on load.
 *
 * Refuses to open when `MEMORY_STORAGE_SEGMENT_COUNT` activates GraphStorage
 * segment mode (A3).
 *
 * @module agent/procedural/graph/backing/JsonlProceduralGraphBacking
 * @experimental
 */

import { readFile } from 'node:fs/promises';
import { durableWriteFile } from '../../../../utils/durableWriteFile.js';
import { logger } from '../../../../utils/logger.js';
import { LockedProceduralGraphBacking } from './LockedProceduralGraphBacking.js';
import { ProceduralGraphState } from './ProceduralGraphState.js';

const MAX_SEGMENT_COUNT = 1024;
const SEGMENT_COUNT_PATTERN = /^[1-9][0-9]*$/;

const SEGMENT_MODE_ERROR = 'PG JSONL backing does not support MEMORY_STORAGE_SEGMENT_COUNT>=2';

export class JsonlProceduralGraphBacking extends LockedProceduralGraphBacking {
  readonly kind = 'jsonl' as const;

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
    const state = await loadJsonlFile(filePath);
    return new JsonlProceduralGraphBacking(filePath, state);
  }

  protected override async afterWrite(): Promise<void> {
    await durableWriteFile(this.filePath, this.state.toJsonl());
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

async function loadJsonlFile(filePath: string): Promise<ProceduralGraphState> {
  const state = new ProceduralGraphState();
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return state;
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
        break;
      }
      throw new Error(`Invalid JSONL line in procedural graph backing: ${filePath}`);
    }
    state.applyRecord(parsed);
  }
  return state;
}
