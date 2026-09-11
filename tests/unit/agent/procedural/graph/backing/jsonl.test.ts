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

describe('JsonlProceduralGraphBacking append-only persistence', () => {
  it('each write appends only its own records; earlier bytes are untouched and a reopen sees the same state', async () => {
    const backing = await JsonlProceduralGraphBacking.open(filePath);
    await backing.createGraph(makeSnapshot({ graphId: 'g', revisionId: 'rev-1' }));
    const afterCreate = fs.readFileSync(filePath, 'utf8');
    await backing.appendRejection({
      graphId: 'g',
      runId: 'r',
      round: 1,
      proposalDigest: 'p',
      edits: { add_nodes: [], delete_nodes: [], add_edges: [], delete_edges: [] },
      reason: 'parse',
      diagnostics: [],
      retainedMean: null,
      retainedRevisionId: 'rev-1',
      trajectoryRefs: [],
      fingerprint: 'fp',
      recordedAt: '2026-01-01T00:00:00.000Z',
    });
    const afterRejection = fs.readFileSync(filePath, 'utf8');
    expect(afterRejection.startsWith(afterCreate)).toBe(true);
    const delta = afterRejection.slice(afterCreate.length).trim().split('\n');
    expect(delta).toHaveLength(1);
    expect(JSON.parse(delta[0]!)).toMatchObject({ kind: 'rejection', graphId: 'g' });
    await backing.close();

    const reopened = await JsonlProceduralGraphBacking.open(filePath);
    expect((await reopened.loadHead('g'))?.revisionId).toBe('rev-1');
    expect((await reopened.listRejections('g', { offset: 0, limit: 10 })).total).toBe(1);
    await reopened.close();
  });

  it('a torn trailing line is compacted away at open so later appends never leave corruption mid-file', async () => {
    const backing = await JsonlProceduralGraphBacking.open(filePath);
    await backing.createGraph(makeSnapshot({ graphId: 'g', revisionId: 'rev-1' }));
    await backing.close();
    fs.appendFileSync(filePath, '{"kind":"head","graphId":"g","revisionId":"rev-9","headVer');

    const healed = await JsonlProceduralGraphBacking.open(filePath);
    const compacted = fs.readFileSync(filePath, 'utf8');
    expect(compacted).not.toContain('rev-9');
    for (const line of compacted.split('\n').filter((l) => l.trim() !== '')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    await healed.appendRound('g', {
      runId: 'r', round: 1, retainedRevisionId: 'rev-1', outcome: 'accepted', baselineMean: null,
      candidateMean: null, diagnostics: [], repairs: [], startedAt: 't', finishedAt: 't',
    });
    await healed.close();

    const again = await JsonlProceduralGraphBacking.open(filePath);
    expect((await again.loadHead('g'))?.revisionId).toBe('rev-1');
    await again.close();
  });
});

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
