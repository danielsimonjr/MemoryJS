/**
 * Durable-write budget of the Recursa learners (RS-18/RS-21).
 *
 * The learners persist a resumable state machine, so every phase used to cost its own durable
 * write: a JSONL append plus fsync, or one SQLite transaction. That is correct but very expensive
 * per unit of progress, and it is what made the recursive tests ~10x slower on Windows than on
 * Linux (an fsync there costs ~20x the Linux figure, and one 32-document recursa run paid 276 of
 * them). The learners now coalesce a step's writes into one commit, so this file pins the write
 * budget of a full run rather than let it creep back
 * up: adding a phase that saves twice is a real regression, and it should fail here.
 *
 * The assertions count durable commits, not time, so they mean the same thing on every OS and
 * under any machine load. The ceilings are deliberately loose (about 2x the measured count) so a
 * different split or an extra action does not fail an unrelated change; a return to per-phase
 * writes is a 3-5x jump and always trips them.
 */
import { describe, expect, it } from 'vitest';
import type { IGraphStorage } from '../../../../src/types/types.js';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../../src/core/SQLiteStorage.js';
import { LearningTrace } from '../../../../src/agent/learning/LearningTrace.js';
import { RecursiveLearner } from '../../../../src/agent/learning/RecursiveLearner.js';
import { TASKS, buildRecursive } from './recursiveFixtures.js';
import { judge, scriptedSolver } from './leafFixtures.js';
import { makeTempJsonlPath, makeTempSqlitePath, cleanupTempDirs } from '../../../helpers/tempStorage.js';

const ALL_IDS = TASKS.map((t) => t.id);

/** A commit counter over the two storage-level durable primitives. */
interface Commits {
  jsonlAppends: number;
  jsonlRewrites: number;
  /** Total flushes over every trace. */
  traceFlushes: number;
  /** Flushes per trace id. */
  byTrace: Map<string, number>;
  restore: () => void;
}

/**
 * Count the durable commits a run performs.
 *
 * `flush` is the one place a learner's queued trace writes become durable, so counting it counts
 * exactly the commits the learners are responsible for; the storage counters say how many file
 * operations those turned into.
 *
 * @param storage - Storage the run writes to.
 * @returns The live counters and a function that restores the patched prototypes.
 */
function countCommits(storage: IGraphStorage): Commits {
  const counts: Commits = { jsonlAppends: 0, jsonlRewrites: 0, traceFlushes: 0, byTrace: new Map(), restore: () => undefined };
  const patched: Array<() => void> = [];
  const patch = (target: object, name: string, onCall: (...args: unknown[]) => void): void => {
    const rec = target as unknown as Record<string, (...a: unknown[]) => unknown>;
    const original = rec[name];
    if (typeof original !== 'function') return;
    rec[name] = function (this: unknown, ...args: unknown[]) {
      onCall(...args);
      return original.apply(this, args);
    };
    patched.push(() => {
      rec[name] = original;
    });
  };

  const proto = Object.getPrototypeOf(storage) as object;
  if (proto === GraphStorage.prototype) {
    patch(proto, 'durableAppendFile', () => {
      counts.jsonlAppends += 1;
    });
    patch(proto, 'durableWriteFile', () => {
      counts.jsonlRewrites += 1;
    });
  }
  patch(LearningTrace.prototype, 'flush', (traceId: unknown) => {
    counts.traceFlushes += 1;
    if (typeof traceId === 'string') counts.byTrace.set(traceId, (counts.byTrace.get(traceId) ?? 0) + 1);
  });
  counts.restore = () => {
    for (const undo of patched.reverse()) undo();
  };
  return counts;
}

describe.each([
  { name: 'jsonl', path: makeTempJsonlPath, open: (p: string) => new GraphStorage(p) as unknown as IGraphStorage },
  { name: 'sqlite', path: makeTempSqlitePath, open: (p: string) => new SQLiteStorage(p) as unknown as IGraphStorage },
] as const)('Recursa durable-write budget [$name]', (backend) => {
  it('a full recursive run commits once per learner step, not once per phase write', async () => {
    const storage = backend.open(backend.path());
    const counts = countCommits(storage);
    try {
      const built = buildRecursive(storage);
      const result = await built.learner.learn(
        { taskIds: ALL_IDS, tasks: TASKS, budget: { maxRounds: 4 }, validationSampleSize: 5 },
        { solver: scriptedSolver({}), judge },
      );
      expect(result.stoppedBecause).toBe('all-pass');

      // A four-task, two-leaf run: 2 children x (start + solve + judge + diagnose + edit +
      // validate x2 + apply) plus the parent's plan/merge/reflect. Measured 76 flushes before any
      // further tuning; the ceiling catches a return to per-phase writes (which was 3x this).
      expect(counts.traceFlushes).toBeLessThanOrEqual(120);
      if (backend.name === 'jsonl') {
        // One append per flush at most, plus the handful of snapshot/skill/failure writes. Before
        // coalescing this run performed 276 appends.
        expect(counts.jsonlAppends).toBeLessThanOrEqual(140);
        expect(counts.jsonlRewrites).toBeLessThanOrEqual(8);
      }
    } finally {
      counts.restore();
      (storage as unknown as { close?: () => void }).close?.();
      cleanupTempDirs();
    }
  });

  it('coalesces a leaf step into a single commit', async () => {
    const storage = backend.open(backend.path());
    const traces = new LearningTrace(storage);
    const counts = countCommits(storage);
    try {
      const built = buildRecursive(storage);
      const started = await built.learner.start({ taskIds: ALL_IDS, tasks: TASKS, budget: { maxRounds: 4 } });
      // `plan` writes a trace action and the run state to the parent, and creates one child trace
      // per subset (each child's own create + task records + first state is one commit). All the
      // parent's writes for the step must land in a single commit.
      const before = counts.byTrace.get(started.traceId) ?? 0;
      await built.learner.plan(started.traceId);
      expect((counts.byTrace.get(started.traceId) ?? 0) - before).toBe(1);
      expect((await traces.get(started.traceId))?.actions.some((a) => a.kind === 'split')).toBe(true);
    } finally {
      counts.restore();
      (storage as unknown as { close?: () => void }).close?.();
      cleanupTempDirs();
    }
  });
});

describe('Recursa durable-write budget helpers', () => {
  it('counts the flushes of a RecursiveLearner step', async () => {
    const storage = new GraphStorage(makeTempJsonlPath()) as unknown as IGraphStorage;
    const counts = countCommits(storage);
    try {
      const learner = buildRecursive(storage).learner;
      expect(learner).toBeInstanceOf(RecursiveLearner);
      const started = await learner.start({ taskIds: ALL_IDS, tasks: TASKS, budget: { maxRounds: 4 } });
      const before = counts.byTrace.get(started.traceId) ?? 0;
      await learner.plan(started.traceId);
      expect((counts.byTrace.get(started.traceId) ?? 0) - before).toBe(1);
    } finally {
      counts.restore();
      (storage as unknown as { close?: () => void }).close?.();
      cleanupTempDirs();
    }
  });
});
