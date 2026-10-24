/**
 * Pin tests for the TF-IDF IDF recalculation and the add and update paths.
 *
 * Index state is compared without `lastUpdated`, which is a wall-clock value.
 * Key order is compared too, because a Map key order is observable in the
 * serialized index.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TFIDFIndexManager } from '../../../src/search/TFIDFIndexManager.js';
import type { ReadonlyKnowledgeGraph } from '../../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const graph: ReadonlyKnowledgeGraph = {
  entities: [
    { name: 'A', entityType: 'note', observations: ['alpha beta'] },
    { name: 'B', entityType: 'note', observations: ['beta gamma'] },
    { name: 'C', entityType: 'note', observations: ['gamma delta'] },
  ],
  relations: [],
};

/** Index state without the wall-clock timestamp, with key order kept. */
const stateOf = (manager: TFIDFIndexManager): string => {
  const { lastUpdated: _lastUpdated, ...rest } = manager.getIndex()!;
  return JSON.stringify(rest, (_key, value) =>
    value instanceof Map ? Array.from(value.entries()) : value,
  );
};

const idfOf = (manager: TFIDFIndexManager): Array<[string, number]> =>
  Array.from(manager.getIndex()!.idf.entries());

describe('TFIDFIndexManager IDF and add/update pins', () => {
  let testDir: string;
  let first: TFIDFIndexManager;
  let second: TFIDFIndexManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `tfidf-twins-${Date.now()}-${Math.random()}`);
    await fs.mkdir(join(testDir, 'one'), { recursive: true });
    await fs.mkdir(join(testDir, 'two'), { recursive: true });
    first = new TFIDFIndexManager(join(testDir, 'one'));
    second = new TFIDFIndexManager(join(testDir, 'two'));
    await first.buildIndex(graph);
    await second.buildIndex(graph);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('builds the golden IDF values for the three-document corpus', () => {
    expect(idfOf(first)).toStrictEqual([
      ['a', 1.0986122886681096],
      ['note', 0],
      ['alpha', 1.0986122886681096],
      ['beta', 0.4054651081081644],
      ['b', 1.0986122886681096],
      ['gamma', 0.4054651081081644],
      ['c', 1.0986122886681096],
      ['delta', 1.0986122886681096],
    ]);
  });

  it('addDocument and updateDocument leave the same state when an existing document changes terms', () => {
    const changed = { name: 'A', entityType: 'note', observations: ['alpha delta'] };

    first.addDocument(changed);
    second.updateDocument(changed);

    expect(stateOf(first)).toBe(stateOf(second));
    expect(idfOf(first)).toStrictEqual(idfOf(second));
    expect(idfOf(first)).toStrictEqual([
      ['a', 1.0986122886681096],
      ['note', 0],
      ['alpha', 1.0986122886681096],
      ['beta', 1.0986122886681096],
      ['b', 1.0986122886681096],
      ['gamma', 0.4054651081081644],
      ['c', 1.0986122886681096],
      ['delta', 0.4054651081081644],
    ]);
  });

  it('addDocument and updateDocument leave the same state when an existing document keeps its terms', () => {
    const same = { name: 'B', entityType: 'note', observations: ['gamma beta'] };

    first.addDocument(same);
    second.updateDocument(same);

    expect(stateOf(first)).toBe(stateOf(second));
    expect(idfOf(first)).toStrictEqual(idfOf(second));
  });

  it('addDocument and updateDocument leave the same state for a new document', () => {
    const added = { name: 'D', entityType: 'note', observations: ['epsilon alpha'] };

    first.addDocument(added);
    second.updateDocument(added);

    expect(stateOf(first)).toBe(stateOf(second));
    expect(idfOf(first)).toStrictEqual(idfOf(second));
  });

  it('addDocument and updateDocument leave the same state inside an IDF batch', () => {
    const changed = { name: 'C', entityType: 'note', observations: ['delta epsilon'] };

    first.beginIdfBatch();
    try {
      first.addDocument(changed);
    } finally {
      first.endIdfBatch();
    }
    second.beginIdfBatch();
    try {
      second.updateDocument(changed);
    } finally {
      second.endIdfBatch();
    }

    expect(stateOf(first)).toBe(stateOf(second));
  });

  it('recalculates every term from the document frequency map, including a zero count, on a new document', () => {
    // A zero count is only reachable through a damaged index file. The full
    // pass writes log(N / 0) for it, which is Infinity.
    (first as any).documentFrequency.set('zeta', 0);

    first.addDocument({ name: 'D', entityType: 'note', observations: ['epsilon'] });

    expect(first.getIndex()!.idf.get('zeta')).toBe(Infinity);
    expect(first.getIndex()!.idf.get('epsilon')).toBe(1.3862943611198906);
  });
});
