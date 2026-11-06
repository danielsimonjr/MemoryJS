/**
 * LearningTrace (RS-22): persistence and reopen, tree load, Mermaid output, OCC retry under
 * concurrent appends, and the size cap that keeps each entity under 16 KiB.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../../src/core/SQLiteStorage.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { RelationManager } from '../../../../src/core/RelationManager.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { EvalMetrics, LearningTraceAction, LearningTraceRecord } from '../../../../src/types/learning.js';
import { LearningTrace, TRACE_RECORD_BYTE_BUDGET, foldTraceActions } from '../../../../src/agent/learning/LearningTrace.js';
import { decodeChunks, encodeChunks } from '../../../../src/agent/learning/observationChunks.js';
import { makeTempJsonlPath, makeTempSqlitePath, cleanupTempDirs } from '../../../helpers/tempStorage.js';

const opened: Array<{ close?: () => void }> = [];
function track<T>(storage: T): T {
  opened.push(storage as unknown as { close?: () => void });
  return storage;
}
afterEach(() => {
  for (const storage of opened.splice(0)) storage.close?.();
  cleanupTempDirs();
});

const BACKENDS = [
  { name: 'jsonl', path: makeTempJsonlPath, open: (p: string) => track(new GraphStorage(p)) as unknown as IGraphStorage },
  { name: 'sqlite', path: makeTempSqlitePath, open: (p: string) => track(new SQLiteStorage(p)) as unknown as IGraphStorage },
] as const;

function metrics(allPass: number): EvalMetrics {
  return { tasks: 4, allPass, meanCriteria: allPass, byCategory: {} };
}

function action(i: number): LearningTraceAction {
  const at = new Date(Date.UTC(2026, 10, 6, 0, 0, i % 60)).toISOString() as LearningTraceAction['startedAt'];
  return { kind: 'solve', startedAt: at, endedAt: at, addrs: [`interaction://log/${i}`], outcome: 'ok' };
}

function baseRecord(overrides: Partial<Omit<LearningTraceRecord, 'id'>> = {}): Omit<LearningTraceRecord, 'id'> {
  return {
    learnerKind: 'leaf',
    round: 0,
    subsetLabel: 'all',
    actions: [],
    revisionIds: [],
    metrics: metrics(0.5),
    ...overrides,
  };
}

describe.each(BACKENDS)('LearningTrace persistence [$name]', (backend) => {
  it('persists records, survives reopen, and loads a three-level tree', async () => {
    const path = backend.path();
    const first = backend.open(path);
    const traces = new LearningTrace(first, { entityManager: new EntityManager(first as never), relationManager: new RelationManager(first as never) });
    const root = await traces.create(baseRecord({ learnerKind: 'recursive', subsetLabel: 'root', round: 0 }));
    const mid = await traces.create(baseRecord({ parentTraceId: root, subsetLabel: 'mid', round: 1 }));
    const leafA = await traces.create(baseRecord({ parentTraceId: mid, subsetLabel: 'leaf-a', round: 2, metrics: metrics(1) }));
    const leafB = await traces.create(baseRecord({ parentTraceId: mid, subsetLabel: 'leaf-b', round: 2 }));
    await traces.appendAction(leafA, action(0));
    await traces.setMetrics(leafA, metrics(0.75));
    await traces.addRevisionId(leafA, 'revision-abc');
    await traces.addRevisionId(leafA, 'revision-abc');
    first.close?.();

    const second = backend.open(path);
    const reopened = new LearningTrace(second);
    const record = await reopened.get(leafA);
    expect(record?.id).toBe(leafA);
    expect(record?.actions).toHaveLength(1);
    expect(record?.metrics.allPass).toBe(0.75);
    expect(record?.revisionIds).toEqual(['revision-abc']);
    expect(await reopened.get('trace-missing')).toBeUndefined();

    const tree = await reopened.load(root);
    expect(tree.record.id).toBe(root);
    expect(tree.children).toHaveLength(1);
    const midNode = tree.children[0]!;
    expect(midNode.record.id).toBe(mid);
    expect(midNode.children.map((c) => c.record.id).sort()).toEqual([leafA, leafB].sort());
    expect(midNode.children.every((c) => c.children.length === 0)).toBe(true);
  });

  it('rejects an unknown parent and an unknown trace on load', async () => {
    const storage = backend.open(backend.path());
    const traces = new LearningTrace(storage);
    await expect(traces.create(baseRecord({ parentTraceId: 'trace-nope' }))).rejects.toThrow(/unknown trace/);
    await expect(traces.load('trace-nope')).rejects.toThrow(/unknown trace/);
    await expect(traces.appendAction('trace-nope', action(0))).rejects.toThrow(/unknown trace/);
  });

  it('does not loop on a cycle of child_of relations', async () => {
    const storage = backend.open(backend.path());
    const relations = new RelationManager(storage as never);
    const traces = new LearningTrace(storage, { relationManager: relations });
    const a = await traces.create(baseRecord({ subsetLabel: 'a' }));
    const b = await traces.create(baseRecord({ subsetLabel: 'b', parentTraceId: a }));
    await relations.createRelations([{ from: a, to: b, relationType: 'child_of' }]);
    const tree = await traces.load(a);
    expect(tree.record.id).toBe(a);
    expect(tree.children[0]?.record.id).toBe(b);
    expect(tree.children[0]?.children).toHaveLength(0);
  });

  it('retries on version conflicts so concurrent appendAction calls all commit', async () => {
    const storage = backend.open(backend.path());
    const traces = new LearningTrace(storage);
    const id = await traces.create(baseRecord());
    const writes = Array.from({ length: 20 }, (_, i) => traces.appendAction(id, action(i)));
    await Promise.all(writes);
    const record = await traces.get(id);
    expect(record?.actions).toHaveLength(20);
    const outcomes = new Set(record?.actions.map((a) => a.addrs[0]));
    expect(outcomes.size).toBe(20);
  });

  it('keeps 1,200 actions under the 16 KiB entity limit and folds the oldest', async () => {
    const storage = backend.open(backend.path());
    const entities = new EntityManager(storage as never);
    const traces = new LearningTrace(storage, { entityManager: entities });
    const id = await traces.create(baseRecord());
    // Batched: one committed write per 100 actions. The single-append path
    // is covered by the concurrent test above; Windows CI cannot afford 1,200
    // full-graph saves inside the 30 s test timeout.
    for (let i = 0; i < 1200; i += 100) {
      await traces.appendActions(id, Array.from({ length: 100 }, (_, j) => action(i + j)));
    }
    const entity = storage.getEntityByName(id);
    expect(JSON.stringify(entity).length).toBeLessThan(16384);
    const record = await traces.get(id);
    expect(record!.actions.length).toBeLessThanOrEqual(1000);
    expect(record!.actions[0]!.kind).toBe('merge');
    expect(record!.actions[0]!.addrs).toEqual([]);
    expect(record!.actions[0]!.outcome).toMatch(/^folded \d+ actions$/);
    const folded = Number(/\d+/.exec(record!.actions[0]!.outcome)![0]);
    expect(folded + record!.actions.length - 1).toBe(1200);
    expect(record!.actions.at(-1)!.addrs).toEqual(['interaction://log/1199']);
  });
});

describe('LearningTrace helpers', () => {
  it('folds 5,000 appended actions and keeps the record under 16 KiB', () => {
    let record: LearningTraceRecord = { id: 'trace-x', ...baseRecord() };
    for (let i = 0; i < 5000; i += 1) record = foldTraceActions({ ...record, actions: [...record.actions, action(i)] }, 1000);
    expect(Buffer.byteLength(JSON.stringify(record), 'utf8')).toBeLessThan(16 * 1024);
    const folded = Number(/\d+/.exec(record.actions[0]!.outcome)![0]);
    expect(folded + record.actions.length - 1).toBe(5000);
  });

  it('decodeChunks requires chunk indices exactly 1..n', () => {
    const enc = encodeChunks('[t', 'a'.repeat(4000) + 'b'.repeat(4000));
    expect(enc).toHaveLength(2);
    expect(() => decodeChunks([enc[0]!, enc[0]!], '[t')).toThrow(/duplicate or out-of-range/);
    expect(() => decodeChunks(['[t 5/2] a', '[t 1/2] b'], '[t')).toThrow(/duplicate or out-of-range/);
    expect(() => decodeChunks(['[t 7/2] a', '[t 5/2] b'], '[t')).toThrow(/duplicate or out-of-range/);
    expect(decodeChunks([enc[1]!, enc[0]!], '[t')).toBe('a'.repeat(4000) + 'b'.repeat(4000));
  });

  it('foldTraceActions returns the same record when it already fits', () => {
    const record = { ...baseRecord(), id: 'trace-x', actions: [action(0), action(1)] } as LearningTraceRecord;
    expect(foldTraceActions(record, 10)).toEqual(record);
  });

  it('foldTraceActions accumulates the folded count across folds', () => {
    let record = { ...baseRecord(), id: 'trace-y', actions: [] as LearningTraceAction[] } as LearningTraceRecord;
    for (let i = 0; i < 30; i += 1) record = foldTraceActions({ ...record, actions: [...record.actions, action(i)] }, 5);
    expect(record.actions).toHaveLength(5);
    expect(record.actions[0]!.outcome).toBe('folded 26 actions');
    expect(record.actions.slice(1).map((a) => a.addrs[0])).toEqual([26, 27, 28, 29].map((i) => `interaction://log/${i}`));
    expect(JSON.stringify(record).length).toBeLessThan(TRACE_RECORD_BYTE_BUDGET);
  });

  it('toMermaid renders a graph TD with escaped labels', async () => {
    const storage = track(new GraphStorage(makeTempJsonlPath())) as unknown as IGraphStorage;
    const traces = new LearningTrace(storage);
    const root = await traces.create(baseRecord({ learnerKind: 'recursive', subsetLabel: 'say "hi"\nnow', round: 0, metrics: metrics(0.5) }));
    const child = await traces.create(baseRecord({ parentTraceId: root, subsetLabel: 'child', round: 1, metrics: metrics(1) }));
    const tree = await traces.load(root);
    const mermaid = traces.toMermaid(tree);
    expect(mermaid.split('\n')[0]).toBe('graph TD');
    expect(mermaid).toContain('n0["recursive r0 say #quot;hi#quot; now (allPass=0.5)"]');
    expect(mermaid).toContain('n1["leaf r1 child (allPass=1)"]');
    expect(mermaid).toContain('n0 --> n1');
    expect(child).toMatch(/^trace-/);
  });
});

