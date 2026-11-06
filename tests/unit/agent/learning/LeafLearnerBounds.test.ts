/**
 * Bounded leaf state (RS-18 size bound): tasks are persisted once as `[leaf-tasks]`, solver answers
 * are capped before judging and dropped once judged, and the `[leaf-state]` observation stays small
 * after the judge step even for large answers.
 */
import { describe, it, expect } from 'vitest';
import { LeafLearner } from '../../../../src/agent/learning/LeafLearner.js';
import { ANSWER_CAP_BYTES } from '../../../../src/agent/learning/LeafLearnerStore.js';
import { splitForObservations, OBSERVATION_CHUNK_CHARS } from '../../../../src/agent/learning/observationChunks.js';
import type { SolveResult, TaskRecord } from '../../../../src/types/learning.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { makeRepo, makeTraces, judgeAnswer, scriptedEditor, stubDiagnoser, taskFor } from './leafFixtures.js';

/** Number of tasks in the run. */
const TASK_COUNT = 50;
/** Size of each solver answer in bytes. */
const ANSWER_BYTES = 10 * 1024;
/** Upper bound on the `[leaf-state]` observation after the judge step, in bytes. */
const STATE_LIMIT_BYTES = 32 * 1024;

const TASKS: TaskRecord[] = Array.from({ length: TASK_COUNT }, (_, i) => taskFor(`task-${String(i).padStart(3, '0')}`, `value-${i}`));

/** Build a learner over `storage` with an empty editor (so a reopened run stops as `no-progress`). */
function build(storage: IGraphStorage) {
  const traces = makeTraces(storage);
  const learner = new LeafLearner({
    repository: makeRepo(storage),
    traces,
    diagnoser: stubDiagnoser,
    editor: scriptedEditor([]),
  });
  return { traces, learner };
}

/** Solver answer of `ANSWER_BYTES` bytes that does not contain any expected value. */
function bigAnswer(): SolveResult {
  return { answer: 'z'.repeat(ANSWER_BYTES), traceAddrs: ['interaction://log/bounds'] };
}

withBothBackends('LeafLearner bounded state', (backend) => {
  it(`keeps [leaf-state] under ${STATE_LIMIT_BYTES} bytes after the judge step with ${TASK_COUNT} tasks of ${ANSWER_BYTES}-byte answers`, async () => {
    const storage = backend.create();
    const { traces, learner } = build(storage);
    const { traceId } = await learner.start({ taskIds: TASKS.map((t) => t.id), tasks: TASKS, budget: { maxRounds: 2 } });

    // Solve: every answer is persisted capped, never whole.
    const request = await learner.next(traceId);
    expect(request.kind).toBe('solve');
    const solved: Record<string, SolveResult> = Object.fromEntries(TASKS.map((t) => [t.id, bigAnswer()]));
    await learner.submit(traceId, 'solve', solved);
    const afterSolve = (await traces.readState(traceId)) ?? '';
    expect(afterSolve).toContain('"truncated":true');
    expect(afterSolve).not.toContain('z'.repeat(ANSWER_CAP_BYTES + 1));

    // Judge: the in-process judge still sees the full text.
    const judgeStep = await learner.next(traceId);
    expect(judgeStep.kind).toBe('judge');
    if (judgeStep.kind !== 'judge') throw new Error('expected a judge step');
    expect(judgeStep.answers).toHaveLength(TASK_COUNT);
    for (const entry of judgeStep.answers) {
      expect(entry.answer.length).toBe(ANSWER_BYTES);
      expect(entry.truncated).toBeUndefined();
    }
    const verdicts: Record<string, Awaited<ReturnType<typeof judgeAnswer>>> = {};
    for (const entry of judgeStep.answers) verdicts[entry.task.id] = await judgeAnswer(entry.task, entry.answer);
    await learner.submit(traceId, 'judge', verdicts);

    // After the judge step the persisted run carries feedback only.
    const afterJudge = (await traces.readState(traceId)) ?? '';
    expect(Buffer.byteLength(afterJudge, 'utf8')).toBeLessThan(STATE_LIMIT_BYTES);
    expect(afterJudge).not.toContain('z'.repeat(100));
    expect(afterJudge).not.toContain('"truncated"');

    // Each stored chunk respects the entity observation cap; the state spans several of them.
    await storage.ensureLoaded();
    const observations = storage.getEntityByName(traceId)!.observations;
    const stateChunks = observations.filter((o) => o.startsWith('[leaf-state '));
    expect(stateChunks.length).toBeGreaterThan(1);
    for (const chunk of stateChunks) expect(chunk.length).toBeLessThanOrEqual(5000);

    // Tasks live in their own observation, written once.
    const tasksJson = await traces.readTasks(traceId);
    expect(tasksJson).toBeDefined();
    expect(JSON.parse(tasksJson!)).toHaveLength(TASK_COUNT);
    expect(observations.filter((o) => o.startsWith('[leaf-tasks ')).every((o) => o.length <= 5000)).toBe(true);
    await expect(traces.writeTasks(traceId, '[]')).rejects.toThrow(/already has task records/);

    // A reopened learner (new instance over the same storage) continues from the persisted state:
    // diagnosis runs, and the empty editor ends the run as no-progress.
    const reopened = build(storage).learner;
    const next = await reopened.next(traceId);
    expect(next.kind).toBe('done');
    if (next.kind !== 'done') throw new Error('expected done');
    expect(next.result.stoppedBecause).toBe('no-progress');
    expect(next.result.after.allPass).toBe(0);
  });
});

describe('observation chunking', () => {
  it('splits within the chunk size and never splits a surrogate pair', () => {
    const text = `${'a'.repeat(OBSERVATION_CHUNK_CHARS - 1)}\u{1F600}${'b'.repeat(10)}`;
    const parts = splitForObservations(text);
    expect(parts.every((p) => p.length <= OBSERVATION_CHUNK_CHARS)).toBe(true);
    expect(parts.join('')).toBe(text);
    for (const part of parts) expect(/[\ud800-\udbff]$/.test(part)).toBe(false);
  });

  it('returns one empty piece for empty text', () => {
    expect(splitForObservations('')).toEqual(['']);
  });
});
