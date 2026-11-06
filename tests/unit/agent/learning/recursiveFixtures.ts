/** Shared fixtures for the Recursa recursive-learner tests (RS-21). Scripted, deterministic. */
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { Diagnosis, Feedback, TaskRecord } from '../../../../src/types/learning.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { AgentReflectionManager } from '../../../../src/agent/AgentReflectionManager.js';
import { LearningReflector } from '../../../../src/agent/learning/LearningReflector.js';
import { RecursiveLearner, type RecursiveLearnerOptions } from '../../../../src/agent/learning/RecursiveLearner.js';
import type { DiagnoserLike, KnowledgeEditorLike } from '../../../../src/agent/learning/LeafLearnerOptions.js';
import type { TaskSubset } from '../../../../src/agent/learning/SplitStrategies.js';
import type { SplitFn } from '../../../../src/agent/learning/RecursiveLearner.js';
import type { RevisionOp } from '../../../../src/types/skills.js';
import { makeRevision, skillInput } from '../knowledge/knowledgeFixtures.js';
import { makeRepo, makeTraces, stubDiagnoser, taskFor, TASK_INPUT } from './leafFixtures.js';

/** Split that cuts the tasks into consecutive chunks of `size`. */
export function splitBySize(size: number): SplitFn {
  return async (_name, tasks): Promise<TaskSubset[]> => {
    const out: TaskSubset[] = [];
    for (let i = 0; i < tasks.length; i += size) {
      out.push({
        label: `chunk-${out.length + 1}`,
        taskIds: tasks.slice(i, i + size).map((t) => t.id),
        rationale: `chunks of ${size}`,
      });
    }
    return out;
  };
}

/** Task fixtures: four facts, each with its expected answer. */
export const TASKS: TaskRecord[] = ['a', 'b', 'c', 'd'].map((k) => taskFor(`task-${k}`, `${k}-value`));

/**
 * Skill words per task. Distinct words keep the merger's near-duplicate dedup (token Jaccard 0.85)
 * from merging the skills of different tasks.
 */
const WORDS: Record<string, string> = {
  'task-a': 'granite meadow compass',
  'task-b': 'harbor lantern pebble',
  'task-c': 'zephyr orchard quartz',
  'task-d': 'velvet thimble walrus',
};

/**
 * Skill op that teaches the scripted solver one task (its body carries `FIX:<taskId>`).
 *
 * @param taskId - Task the skill fixes.
 * @param expected - Expected answer.
 * @returns A `skill.add` op.
 */
export function distinctFix(taskId: string, expected: string): RevisionOp {
  return {
    op: 'skill.add',
    skill: skillInput(`fix-${taskId}`, {
      description: TASK_INPUT,
      body: `FIX:${taskId} answer ${expected} ${WORDS[taskId] ?? taskId}`,
    }) as Extract<RevisionOp, { op: 'skill.add' }>['skill'],
  };
}

/** Expected answers keyed by task id. */
export const EXPECTED: Record<string, string> = Object.fromEntries(TASKS.map((t) => [t.id, `${t.id.slice(5)}-value`]));

/**
 * Editor that adds one skill per failed task (the first `perRound` of them), which teaches the
 * scripted solver that task.
 *
 * @param perRound - Maximum fixes per call.
 * @returns The editor.
 */
export function fixEditor(perRound = Number.POSITIVE_INFINITY): KnowledgeEditorLike {
  let calls = 0;
  return {
    async edit(diagnoses: Diagnosis[]) {
      calls += 1;
      const picked = diagnoses.slice(0, perRound);
      const ops: RevisionOp[] = picked.map((d) => distinctFix(d.taskId, EXPECTED[d.taskId]!));
      return makeRevision(`rev-${calls}-${picked.map((d) => d.taskId).join('+')}`, '', ops);
    },
  };
}

/**
 * Editor that fixes only the failed tasks in `allowed` and proposes nothing for the others, so a
 * child whose subset is outside `allowed` stalls with no progress.
 *
 * @param allowed - Task ids the editor may fix.
 * @returns The editor.
 */
export function selectiveEditor(allowed: string[]): KnowledgeEditorLike {
  let calls = 0;
  return {
    async edit(diagnoses: Diagnosis[]) {
      calls += 1;
      const picked = diagnoses.filter((d) => allowed.includes(d.taskId));
      return makeRevision(`sel-${calls}-${picked.map((d) => d.taskId).join('+') || 'none'}`, '', picked.map((d) => distinctFix(d.taskId, EXPECTED[d.taskId]!)));
    },
  };
}

/** Editor that proposes nothing. */
export const noopEditor: KnowledgeEditorLike = {
  async edit() {
    return makeRevision(`rev-noop-${Math.random().toString(36).slice(2, 8)}`, '', []);
  },
};

/**
 * Diagnoser that throws whenever a failed task is in `ids`, and classifies the rest like the stub.
 *
 * @param ids - Task ids that make the diagnoser throw.
 * @returns The diagnoser.
 */
export function throwingDiagnoser(ids: string[]): DiagnoserLike {
  return {
    async diagnose(failed: Array<{ task: TaskRecord; feedback: Feedback }>, knowledge, signal, call) {
      if (failed.some((f) => ids.includes(f.task.id))) throw new Error('diagnoser boom');
      return stubDiagnoser.diagnose(failed, knowledge, signal, call);
    },
  };
}

/** Learner over `storage` with its reflector and reflection store. */
export interface Built {
  /** Learner under test. */
  learner: RecursiveLearner;
  /** Trace store. */
  traces: ReturnType<typeof makeTraces>;
  /** Reflection store (reads back `scope: 'learning'` records). */
  reflections: AgentReflectionManager;
}

/**
 * Build a recursive learner over `storage`.
 *
 * @param storage - Storage.
 * @param overrides - Diagnoser, editor and split overrides.
 * @returns The learner and its stores.
 */
export function buildRecursive(
  storage: IGraphStorage,
  overrides: { diagnoser?: DiagnoserLike; editor?: KnowledgeEditorLike; split?: SplitFn } & Partial<Pick<RecursiveLearnerOptions, 'merger' | 'validator' | 'repository'>> = {},
): Built {
  const entityManager = new EntityManager(storage as never);
  const traces = makeTraces(storage);
  const reflections = new AgentReflectionManager(storage, entityManager);
  const options: RecursiveLearnerOptions = {
    repository: makeRepo(storage),
    traces,
    storage,
    entityManager,
    diagnoser: overrides.diagnoser ?? stubDiagnoser,
    editor: overrides.editor ?? fixEditor(),
    reflector: new LearningReflector(reflections, traces),
    split: overrides.split ?? splitBySize(2),
    ...(overrides.merger ? { merger: overrides.merger } : {}),
    ...(overrides.validator ? { validator: overrides.validator } : {}),
    ...(overrides.repository ? { repository: overrides.repository } : {}),
  };
  return { learner: new RecursiveLearner(options), traces, reflections };
}
