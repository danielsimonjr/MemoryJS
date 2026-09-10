/**
 * JSONL procedural-graph backing contract runner plus A3 / torn-write cases.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonlProceduralGraphBacking } from '../../../../../../src/agent/procedural/graph/backing/JsonlProceduralGraphBacking.js';
import { logger } from '../../../../../../src/utils/logger.js';
import { makeSnapshot, runBackingContract } from './backingContract.js';

const previousSegment = process.env.MEMORY_STORAGE_SEGMENT_COUNT;
let dir: string;
let filePath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
  filePath = path.join(dir, 'pg.jsonl');
});

afterEach(() => {
  if (previousSegment === undefined) {
    delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
  } else {
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = previousSegment;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

runBackingContract('jsonl', () => JsonlProceduralGraphBacking.open(filePath));

describe('JsonlProceduralGraphBacking extras', () => {
  it('open refuses when MEMORY_STORAGE_SEGMENT_COUNT=4', async () => {
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = '4';
    await expect(JsonlProceduralGraphBacking.open(filePath)).rejects.toThrow(
      'PG JSONL backing does not support MEMORY_STORAGE_SEGMENT_COUNT>=2',
    );
  });

  it('a torn write (truncated last line) on disk still loads the previous complete head', async () => {
    const snapshot = makeSnapshot();
    const backing = await JsonlProceduralGraphBacking.open(filePath);
    await backing.createGraph(snapshot);
    const head = await backing.loadHead(snapshot.graphId);
    await backing.close();

    fs.appendFileSync(filePath, '{"kind":"head","graphId":"partial');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const reopened = await JsonlProceduralGraphBacking.open(filePath);
      try {
        expect(await reopened.loadHead(snapshot.graphId)).toEqual(head);
        expect(warn).toHaveBeenCalled();
      } finally {
        await reopened.close();
      }
    } finally {
      warn.mockRestore();
    }
  });
});
