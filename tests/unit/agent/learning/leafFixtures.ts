/** Shared fixtures for the Recursa leaf-learner tests (RS-17, RS-18). Scripted, deterministic. */
import type { IGraphStorage } from '../../../../src/types/types.js';
import { isSkillEntity } from '../../../../src/types/agent-memory.js';
import type { CriterionResult, Diagnosis, Feedback, SolveResult, TaskRecord } from '../../../../src/types/learning.js';
import type { KnowledgeRevisionRecord, RevisionOp, SkillRecord } from '../../../../src/types/skills.js';
import { KnowledgeRepository, type SkillManagerLike } from '../../../../src/agent/knowledge/KnowledgeRepository.js';
import { InstructionSetManager } from '../../../../src/agent/knowledge/InstructionSetManager.js';
import { LearningTrace } from '../../../../src/agent/learning/LearningTrace.js';
import type { DiagnoserLike, KnowledgeEditorLike } from '../../../../src/agent/learning/LeafLearner.js';
import type { LoadedKnowledge, LearningSolver as Solver } from '../../../../src/agent/learning/types.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { RelationManager } from '../../../../src/core/RelationManager.js';
import { DeterministicJudge } from '../../../../src/agent/evaluation/DeterministicJudge.js';
import { fakeFailures, makeRevision, skillInput } from '../knowledge/knowledgeFixtures.js';

/** Question text shared by every task, so the lexical skill matcher selects the fix skills. */
export const TASK_INPUT = 'question about widget';

/** Task with one `fact` criterion whose expected value is `expected`. */
export function taskFor(id: string, expected: string, category = 'general'): TaskRecord {
  return { id, input: TASK_INPUT, category, rubric: [{ id: 'c1', text: 'states the value', kind: 'fact', expected }] };
}

/** Expected value of a fixture task. */
export function expectedOf(task: TaskRecord): string {
  return String(task.rubric[0]!.expected);
}

/** Skill manager over the live storage: `match` returns every live skill (up to the limit). */
export function liveSkills(storage: IGraphStorage): SkillManagerLike {
  const records = async (): Promise<SkillRecord[]> =>
    (await storage.loadGraph()).entities.filter(isSkillEntity).map((e) => e.skillRecord);
  const unused = async (): Promise<never> => {
    throw new Error('liveSkills: method not used by these tests');
  };
  return {
    add: unused as SkillManagerLike['add'],
    get: () => undefined,
    list: records,
    update: unused as SkillManagerLike['update'],
    retire: unused as SkillManagerLike['retire'],
    recordOutcome: unused as SkillManagerLike['recordOutcome'],
    loadForContext: unused as SkillManagerLike['loadForContext'],
    match: async (_hint, options = {}) =>
      (await records())
        .filter((r) => r.retired === undefined)
        .slice(0, options.limit ?? 5)
        .map((skill) => ({ skill, score: 1, matched: [] })),
  };
}

/** Repository over `storage` with live skills and no failures. */
export function makeRepo(storage: IGraphStorage): KnowledgeRepository {
  return new KnowledgeRepository({
    storage,
    instructionSets: new InstructionSetManager(storage),
    skills: liveSkills(storage),
    failures: fakeFailures([]),
  });
}

/** Trace store over `storage`. */
export function makeTraces(storage: IGraphStorage): LearningTrace {
  return new LearningTrace(storage, {
    entityManager: new EntityManager(storage as never),
    relationManager: new RelationManager(storage as never),
  });
}

/** Options for {@link scriptedSolver}. */
export interface SolverScript {
  /** Tasks answered correctly even without any knowledge. */
  passWithoutKnowledge?: string[];
  /** Tasks answered correctly only on their first call (nondeterministic solver). */
  firstCallOnly?: string[];
  /** Tasks whose solver call throws. */
  throwFor?: string[];
  /** Tokens reported per call. */
  tokens?: { input: number; output: number };
  /** Called on the first solve, e.g. to abort a run. */
  onFirstCall?: () => void;
}

/**
 * Solver that answers from the knowledge it is given. A task is answered correctly when the
 * knowledge carries `FIX:<id>` (and no `BROKEN:<id>`), or when the script says it passes anyway.
 *
 * @param script - Behaviour of the solver.
 * @returns Solver and a call counter.
 */
export function scriptedSolver(script: SolverScript = {}): Solver & { calls: number } {
  const perTask = new Map<string, number>();
  const passes = new Set(script.passWithoutKnowledge ?? []);
  const firstOnly = new Set(script.firstCallOnly ?? []);
  const throws = new Set(script.throwFor ?? []);
  const solver = {
    calls: 0,
    async solve(task: TaskRecord, knowledge: LoadedKnowledge): Promise<SolveResult> {
      solver.calls += 1;
      if (solver.calls === 1) script.onFirstCall?.();
      const n = (perTask.get(task.id) ?? 0) + 1;
      perTask.set(task.id, n);
      if (throws.has(task.id)) throw new Error(`solver crashed on ${task.id}`);
      const broken = knowledge.markdown.includes(`BROKEN:${task.id}`);
      const fixed = knowledge.markdown.includes(`FIX:${task.id}`);
      const usable = !broken && (fixed || passes.has(task.id)) && !(firstOnly.has(task.id) && n > 1);
      const answer = usable ? expectedOf(task) : 'no idea';
      return {
        answer,
        traceAddrs: [`interaction://log/${task.id}/${n}`],
        ...(script.tokens ? { tokens: { ...script.tokens } } : {}),
      };
    },
  };
  return solver;
}

/** Deterministic rubric judge (the production `DeterministicJudge`). */
export const judge = new DeterministicJudge();

/**
 * Skill op that teaches the solver one task: the body carries `FIX:<taskId>`.
 *
 * @param taskId - Task the skill fixes.
 * @param expected - Expected answer.
 * @returns A `skill.add` op.
 */
export function fixOp(taskId: string, expected: string): RevisionOp {
  return {
    op: 'skill.add',
    skill: skillInput(`fix-${taskId}`, {
      description: TASK_INPUT,
      body: `FIX:${taskId} answer ${expected}`,
    }) as Extract<RevisionOp, { op: 'skill.add' }>['skill'],
  };
}

/**
 * Skill op that breaks one task: the body carries `BROKEN:<taskId>`.
 *
 * @param taskId - Task the skill breaks.
 * @returns A `skill.add` op.
 */
export function breakOp(taskId: string): RevisionOp {
  return {
    op: 'skill.add',
    skill: skillInput(`break-${taskId}`, {
      description: TASK_INPUT,
      body: `BROKEN:${taskId} misleading advice`,
    }) as Extract<RevisionOp, { op: 'skill.add' }>['skill'],
  };
}

/** Editor that returns the ops of each call from `script`; calls past the script return no ops. */
export function scriptedEditor(script: Array<RevisionOp[]>): KnowledgeEditorLike & { calls: number } {
  const editor = {
    calls: 0,
    async edit(_diagnoses: Diagnosis[]): Promise<KnowledgeRevisionRecord> {
      const ops = script[editor.calls] ?? [];
      editor.calls += 1;
      return makeRevision(`revision-${editor.calls}`, '', ops);
    },
  };
  return editor;
}

/** Diagnoser that classifies every failed task as missing knowledge. */
export const stubDiagnoser: DiagnoserLike = {
  async diagnose(failed): Promise<Diagnosis[]> {
    return failed.map(({ task }) => ({
      taskId: task.id,
      kind: 'missing-knowledge',
      summary: `missing ${task.id}`,
      evidenceAddrs: [`interaction://log/${task.id}`],
      relatedSkillIds: [],
      confidence: 0.5,
    }));
  },
};

/**
 * Judge results for a task answer, for driving `submit` by hand.
 *
 * @param task - Task judged.
 * @param answer - Answer text.
 * @returns Criterion results.
 */
export async function judgeAnswer(task: TaskRecord, answer: string): Promise<CriterionResult[]> {
  return judge.judge(task, answer);
}

/** Count of `K-<n>` snapshot entities in storage (no writes by validation may change it). */
export async function snapshotCount(storage: IGraphStorage): Promise<number> {
  return (await storage.loadGraph()).entities.filter((e) => /^K-\d+$/.test(e.name)).length;
}
