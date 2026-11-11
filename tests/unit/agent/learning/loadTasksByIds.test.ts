/**
 * Characterization tests for `loadTasksByIds`, the shared task re-hydration used by
 * `loadRun` (leaf) and `loadRecursive` (recursive).
 *
 * Error strings are public behaviour: they name the label and the missing id.
 *
 * @module tests/unit/agent/learning/loadTasksByIds
 */

import { describe, it, expect, afterEach } from 'vitest';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { RelationManager } from '../../../../src/core/RelationManager.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { TaskRecord } from '../../../../src/types/learning.js';
import { LearningTrace } from '../../../../src/agent/learning/LearningTrace.js';
import { loadRun, loadTasksByIds } from '../../../../src/agent/learning/LeafLearnerStore.js';
import { loadRecursive } from '../../../../src/agent/learning/RecursiveLearnerState.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';

const opened: Array<{ close?: () => void }> = [];
function track<T>(storage: T): T {
  opened.push(storage as unknown as { close?: () => void });
  return storage;
}
afterEach(() => {
  for (const storage of opened.splice(0)) storage.close?.();
  cleanupTempDirs();
});

function makeTraces(storage: IGraphStorage): LearningTrace {
  return new LearningTrace(storage, {
    entityManager: new EntityManager(storage as never),
    relationManager: new RelationManager(storage as never),
  });
}

function task(id: string): TaskRecord {
  return { id, input: `input-${id}`, category: 'general', rubric: [{ id: 'c1', text: 't', kind: 'fact', expected: 'x' }] };
}

async function seed(traces: LearningTrace, tasks: readonly TaskRecord[]): Promise<string> {
  const id = await traces.create({
    learnerKind: 'leaf',
    round: 0,
    subsetLabel: 'all',
    actions: [],
    revisionIds: [],
    metrics: { tasks: tasks.length, allPass: 0, meanCriteria: 0, byCategory: {} },
  });
  await traces.writeTasks(id, JSON.stringify(tasks));
  return id;
}

describe.each([['LeafLearner'], ['RecursiveLearner']] as const)('loadTasksByIds [%s]', (label) => {
  it('returns the tasks in the given id order', async () => {
    const traces = makeTraces(track(new GraphStorage(makeTempJsonlPath())));
    const id = await seed(traces, [task('a'), task('b'), task('c')]);
    const loaded = await loadTasksByIds(traces, id, ['c', 'a'], label);
    expect(loaded.map((t) => t.id)).toEqual(['c', 'a']);
  });

  it('returns an empty list for no ids', async () => {
    const traces = makeTraces(track(new GraphStorage(makeTempJsonlPath())));
    const id = await seed(traces, [task('a')]);
    await expect(loadTasksByIds(traces, id, [], label)).resolves.toEqual([]);
  });

  it('throws the exact missing-tasks error when the trace has no task records', async () => {
    const traces = makeTraces(track(new GraphStorage(makeTempJsonlPath())));
    const id = await traces.create({
      learnerKind: 'leaf',
      round: 0,
      subsetLabel: 'all',
      actions: [],
      revisionIds: [],
      metrics: { tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} },
    });
    await expect(loadTasksByIds(traces, id, ['a'], label)).rejects.toThrow(
      `${label}: trace "${id}" has no task records`,
    );
  });

  it('throws the exact missing-id error when the ids name an unknown task', async () => {
    const traces = makeTraces(track(new GraphStorage(makeTempJsonlPath())));
    const id = await seed(traces, [task('a')]);
    await expect(loadTasksByIds(traces, id, ['ghost'], label)).rejects.toThrow(
      `${label}: trace "${id}" lacks task ghost`,
    );
  });

  it('throws the missing-tasks error for an unknown trace id', async () => {
    const traces = makeTraces(track(new GraphStorage(makeTempJsonlPath())));
    await expect(loadTasksByIds(traces, 'no-such-trace', ['a'], label)).rejects.toThrow(
      `${label}: trace "no-such-trace" has no task records`,
    );
  });
});

// The public loaders are the reason the label is a parameter: pin their error text too, so a
// helper wired with the wrong label would fail here as well as on the helper.
describe('loadRun keeps its LeafLearner errors', () => {
  it('uses the shared task lookup and keeps its missing-task wording', async () => {
    const traces = makeTraces(track(new GraphStorage(makeTempJsonlPath())));
    const id = await traces.create({
      learnerKind: 'leaf',
      round: 0,
      subsetLabel: 'all',
      actions: [],
      revisionIds: [],
      metrics: { tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} },
    });
    await traces.writeState(
      id,
      JSON.stringify({ schema: 1, stateRev: 1, taskIds: ['ghost'], state: {}, options: {} }),
    );
    await traces.writeTasks(id, JSON.stringify([]));
    await expect(loadRun(traces, id)).rejects.toThrow(`LeafLearner: trace "${id}" lacks task ghost`);
  });
});

describe('loadRecursive keeps its RecursiveLearner errors', () => {
  it('uses the shared task lookup and keeps its missing-task wording', async () => {
    const traces = makeTraces(track(new GraphStorage(makeTempJsonlPath())));
    const id = await traces.create({
      learnerKind: 'recursive',
      round: 0,
      subsetLabel: 'root',
      actions: [],
      revisionIds: [],
      metrics: { tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} },
    });
    await traces.writeState(
      id,
      JSON.stringify({ kind: 'recursive', schema: 2, stateRev: 1, taskIds: ['ghost'] }),
    );
    await traces.writeTasks(id, JSON.stringify([]));
    await expect(loadRecursive(traces, id)).rejects.toThrow(`RecursiveLearner: trace "${id}" lacks task ghost`);
  });
});
