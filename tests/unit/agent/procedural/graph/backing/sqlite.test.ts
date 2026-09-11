/**
 * SQLite procedural-graph backing contract runner.
 *
 * Executes the shared suite against the default driver and, when available,
 * again with `MEMORY_SQLITE_DRIVER=node` after `__resetDatabaseCtorForTests()`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteProceduralGraphBacking } from '../../../../../../src/agent/procedural/graph/backing/SqliteProceduralGraphBacking.js';
import {
  __resetDatabaseCtorForTests,
} from '../../../../../../src/core/SQLiteStorage.js';
import { isNodeSqliteAvailable } from '../../../../../../src/core/nodeSqliteAdapter.js';
import {
  makeAtomicFailureRound,
  makeCommit,
  makeSnapshot,
  runBackingContract,
} from './backingContract.js';

const previousDriver = process.env.MEMORY_SQLITE_DRIVER;
let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
  dbPath = path.join(dir, 'pg.db');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  if (previousDriver === undefined) {
    delete process.env.MEMORY_SQLITE_DRIVER;
  } else {
    process.env.MEMORY_SQLITE_DRIVER = previousDriver;
  }
  __resetDatabaseCtorForTests();
});

describe('SqliteProceduralGraphBacking (default driver)', () => {
  beforeAll(() => {
    delete process.env.MEMORY_SQLITE_DRIVER;
    __resetDatabaseCtorForTests();
    console.info('SqliteProceduralGraphBacking driver: default');
  });

  runBackingContract('sqlite', () => SqliteProceduralGraphBacking.open(dbPath));

  it('commit is atomic under an injected failure', async () => {
    await expectAtomicCommit(dbPath);
  });
});

describe.skipIf(!isNodeSqliteAvailable())('SqliteProceduralGraphBacking (node driver)', () => {
  beforeAll(() => {
    process.env.MEMORY_SQLITE_DRIVER = 'node';
    __resetDatabaseCtorForTests();
    console.info('SqliteProceduralGraphBacking driver: node');
  });

  runBackingContract('sqlite-node', () => SqliteProceduralGraphBacking.open(dbPath));

  it('commit is atomic under an injected failure', async () => {
    await expectAtomicCommit(dbPath);
  });
});

async function expectAtomicCommit(file: string): Promise<void> {
  const backing = await SqliteProceduralGraphBacking.open(file);
  try {
    const snapshot = makeSnapshot();
    await backing.createGraph(snapshot);
    const beforeHead = await backing.loadHead(snapshot.graphId);
    const beforeRevs = await backing.listRevisions(snapshot.graphId, { offset: 0, limit: 20 });
    const input = makeCommit(
      makeSnapshot({ revisionId: 'rev-boom', parentRevisionId: 'rev-1' }),
      1,
      0.9,
      'fp-boom',
    );
    input.round = makeAtomicFailureRound();
    await expect(backing.commitRetainedRevision(input)).rejects.toThrow();
    expect(await backing.loadHead(snapshot.graphId)).toEqual(beforeHead);
    expect(await backing.listRevisions(snapshot.graphId, { offset: 0, limit: 20 })).toEqual(beforeRevs);
    expect(await backing.loadRevision(snapshot.graphId, 'rev-boom')).toBeUndefined();
  } finally {
    await backing.close();
  }
}

describe('SqliteProceduralGraphBacking pragma parity', () => {
  it('applies MEMORY_SQLITE_SYNCHRONOUS like the primary backend and falls back to NORMAL', async () => {
    const previous = process.env.MEMORY_SQLITE_SYNCHRONOUS;
    try {
      process.env.MEMORY_SQLITE_SYNCHRONOUS = 'full';
      const full = await SqliteProceduralGraphBacking.open(path.join(dir, 'full.db'));
      expect(readSynchronous(full)).toBe(2);
      await full.close();

      process.env.MEMORY_SQLITE_SYNCHRONOUS = 'bogus';
      const normal = await SqliteProceduralGraphBacking.open(path.join(dir, 'normal.db'));
      expect(readSynchronous(normal)).toBe(1);
      await normal.close();
    } finally {
      if (previous === undefined) delete process.env.MEMORY_SQLITE_SYNCHRONOUS;
      else process.env.MEMORY_SQLITE_SYNCHRONOUS = previous;
    }
  });
});

/** synchronous pragma as SQLite reports it: 0 = OFF, 1 = NORMAL, 2 = FULL. */
function readSynchronous(backing: SqliteProceduralGraphBacking): number {
  const db = (backing as unknown as { db: { pragma(s: string, o?: { simple?: boolean }): unknown } }).db;
  const value = db.pragma('synchronous', { simple: true });
  return Number(typeof value === 'object' && value !== null ? (value as { synchronous: number }).synchronous : value);
}
