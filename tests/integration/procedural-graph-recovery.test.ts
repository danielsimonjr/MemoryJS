/**
 * Procedural-graph backing crash/recovery (feature plan 7.6).
 *
 * After an injected mid-write failure, a reopened backing must observe either
 * the previous complete retained head or the new complete retained head —
 * never a partial or corrupt head.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonlProceduralGraphBacking } from '../../src/agent/procedural/graph/backing/JsonlProceduralGraphBacking.js';
import { SqliteProceduralGraphBacking } from '../../src/agent/procedural/graph/backing/SqliteProceduralGraphBacking.js';
import type { IProceduralGraphBacking } from '../../src/agent/procedural/graph/backing/IProceduralGraphBacking.js';
import { graphDigest } from '../../src/agent/procedural/graph/canonical.js';
import {
  __resetDatabaseCtorForTests,
} from '../../src/core/SQLiteStorage.js';
import { isNodeSqliteAvailable } from '../../src/core/nodeSqliteAdapter.js';
import type { PGHead, PGSnapshot } from '../../src/types/proceduralGraph.js';
import {
  makeAtomicFailureRound,
  makeCommit,
  makeSnapshot,
} from '../unit/agent/procedural/graph/backing/backingContract.js';

const crashWrite = vi.hoisted(() => ({
  active: false,
  tornPrefix(text: string): string {
    const lines = text.split('\n');
    let last = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i]!.trim() !== '') last = i;
    }
    if (last <= 0) {
      return text.slice(0, Math.max(1, Math.floor(text.length / 2)));
    }
    const kept = lines.slice(0, last).join('\n');
    const torn = lines[last]!.slice(0, Math.max(1, Math.floor(lines[last]!.length / 2)));
    return `${kept}\n${torn}`;
  },
}));

vi.mock('../../src/utils/durableWriteFile.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/durableWriteFile.js')>();
  const { writeFile } = await import('node:fs/promises');
  return {
    ...actual,
    durableWriteFile: async (target: string, content: string | Buffer) => {
      if (!crashWrite.active) {
        return actual.durableWriteFile(target, content);
      }
      crashWrite.active = false;
      const text = typeof content === 'string' ? content : content.toString('utf8');
      // Crash mid-write: land a torn prefix on durableWriteFile's target.
      await writeFile(target, crashWrite.tornPrefix(text));
      throw new Error('simulated crash mid-write');
    },
  };
});

const previousSqliteDriver = process.env.MEMORY_SQLITE_DRIVER;
let dir: string;

beforeEach(() => {
  crashWrite.active = false;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
});

afterEach(() => {
  crashWrite.active = false;
  fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  if (previousSqliteDriver === undefined) {
    delete process.env.MEMORY_SQLITE_DRIVER;
  } else {
    process.env.MEMORY_SQLITE_DRIVER = previousSqliteDriver;
  }
  __resetDatabaseCtorForTests();
});

describe('procedural graph recovery (JSONL)', () => {
  it('write two revisions, then a mid-write crash leaves a pre-write or post-write complete head', async () => {
    const filePath = path.join(dir, 'pg.jsonl');
    const backing = await JsonlProceduralGraphBacking.open(filePath);
    const seeded = await seedTwoRevisions(backing);
    const crashed = makeSnapshot({
      revisionId: 'rev-3',
      parentRevisionId: 'rev-2',
      nodes: [
        { id: 'Start', type: 'STATE', description: 'start v3' },
        { id: 'End', type: 'STATE', description: 'end' },
      ],
    });

    crashWrite.active = true;
    await expect(
      backing.commitRetainedRevision(makeCommit(crashed, 2, 0.91, 'fp-3')),
    ).rejects.toThrow(/simulated crash mid-write/);
    await backing.close();

    const reopened = await JsonlProceduralGraphBacking.open(filePath);
    try {
      await assertRecoveredHead(reopened, seeded, crashed);
    } finally {
      await reopened.close();
    }
  });
});

describe('procedural graph recovery (SQLite default driver)', () => {
  beforeAll(() => {
    delete process.env.MEMORY_SQLITE_DRIVER;
    __resetDatabaseCtorForTests();
  });

  it('close() inside commitRetainedRevision via a throwing round serializer leaves no partial head', async () => {
    await expectSqliteCrashRecovery(path.join(dir, 'pg.db'));
  });
});

describe.skipIf(!isNodeSqliteAvailable())('procedural graph recovery (SQLite node driver)', () => {
  beforeAll(() => {
    process.env.MEMORY_SQLITE_DRIVER = 'node';
    __resetDatabaseCtorForTests();
  });

  it('close() inside commitRetainedRevision via a throwing round serializer leaves no partial head', async () => {
    await expectSqliteCrashRecovery(path.join(dir, 'pg-node.db'));
  });
});

interface SeededGraph {
  graphId: string;
  preHead: PGHead;
  rev2: PGSnapshot;
}

async function seedTwoRevisions(backing: IProceduralGraphBacking): Promise<SeededGraph> {
  const initial = makeSnapshot();
  await backing.createGraph(initial);
  const rev2 = makeSnapshot({ revisionId: 'rev-2', parentRevisionId: 'rev-1' });
  const committed = await backing.commitRetainedRevision(makeCommit(rev2, 1, 0.7, 'fp-2'));
  expect(committed.status).toBe('committed');
  const preHead = await backing.loadHead(initial.graphId);
  expect(preHead).toBeDefined();
  expect(preHead?.revisionId).toBe('rev-2');
  expect(preHead?.headVersion).toBe(2);
  return { graphId: initial.graphId, preHead: preHead!, rev2 };
}

async function expectSqliteCrashRecovery(dbPath: string): Promise<void> {
  const backing = await SqliteProceduralGraphBacking.open(dbPath);
  const seeded = await seedTwoRevisions(backing);
  const input = makeCommit(
    makeSnapshot({ revisionId: 'rev-3', parentRevisionId: 'rev-2' }),
    2,
    0.91,
    'fp-3',
  );
  const failingRound = makeAtomicFailureRound();
  input.round = {
    ...failingRound,
    get diagnostics() {
      void backing.close();
      return failingRound.diagnostics;
    },
  };

  await expect(backing.commitRetainedRevision(input)).rejects.toThrow();
  await backing.close();

  const reopened = await SqliteProceduralGraphBacking.open(dbPath);
  try {
    const head = await reopened.loadHead(seeded.graphId);
    expect(head).toEqual(seeded.preHead);
    expect(await reopened.loadRevision(seeded.graphId, 'rev-2')).toEqual(seeded.rev2);
    expect(await reopened.loadRevision(seeded.graphId, 'rev-3')).toBeUndefined();
    const listed = await reopened.listRevisions(seeded.graphId, { offset: 0, limit: 20 });
    expect(listed.items.map((item) => item.revisionId)).toEqual(['rev-2', 'rev-1']);
  } finally {
    await reopened.close();
  }
}

async function assertRecoveredHead(
  reopened: IProceduralGraphBacking,
  seeded: SeededGraph,
  crashed: PGSnapshot,
): Promise<void> {
  const head = await reopened.loadHead(seeded.graphId);
  expect(head).toBeDefined();
  assertCompleteHead(head!);

  const pre = seeded.preHead;
  const isPre = head!.revisionId === pre.revisionId && head!.headVersion === pre.headVersion;
  const isPost = head!.revisionId === crashed.revisionId && head!.headVersion === pre.headVersion + 1;
  expect(isPre || isPost).toBe(true);

  if (isPre) {
    expect(head).toEqual(pre);
    expect(await reopened.loadRevision(seeded.graphId, 'rev-2')).toEqual(seeded.rev2);
  } else {
    expect(head!.graphDigest).toBe(graphDigest(crashed));
    expect(await reopened.loadRevision(seeded.graphId, crashed.revisionId)).toEqual(crashed);
  }

  const loadedHeadRevision = await reopened.loadRevision(seeded.graphId, head!.revisionId);
  expect(loadedHeadRevision).toBeDefined();
  expect(loadedHeadRevision?.revisionId).toBe(head!.revisionId);
}

function assertCompleteHead(head: PGHead): void {
  expect(typeof head.graphId).toBe('string');
  expect(head.graphId.length).toBeGreaterThan(0);
  expect(typeof head.revisionId).toBe('string');
  expect(head.revisionId.length).toBeGreaterThan(0);
  expect(Number.isInteger(head.headVersion)).toBe(true);
  expect(head.headVersion).toBeGreaterThan(0);
  expect(typeof head.graphDigest).toBe('string');
  expect(head.graphDigest.length).toBeGreaterThan(0);
  expect(head.validationMean === null || typeof head.validationMean === 'number').toBe(true);
  expect(head.evaluationFingerprint === null || typeof head.evaluationFingerprint === 'string').toBe(true);
  expect(head.validationReportRef === null || typeof head.validationReportRef === 'string').toBe(true);
  expect(typeof head.updatedAt).toBe('string');
  expect(head.updatedAt.length).toBeGreaterThan(0);
}
