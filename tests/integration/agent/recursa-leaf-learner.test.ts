/**
 * Recursa Phase 4 integration: the real Diagnoser (RS-15), KnowledgeEditor (RS-16),
 * RevisionValidator (RS-17) and LeafLearner (RS-18) over a temp JSONL ManagerContext.
 *
 * The solver is deterministic and reads the knowledge it is given: a task is answered correctly
 * only when the knowledge names the skill that teaches it (`Learned: <taskId>`), and never when the
 * knowledge carries a `BROKEN:<taskId>` marker. The judge is the production `DeterministicJudge`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { LearningTrace } from '../../../src/agent/learning/LearningTrace.js';
import { Diagnoser } from '../../../src/agent/learning/Diagnoser.js';
import { KnowledgeEditor } from '../../../src/agent/learning/KnowledgeEditor.js';
import { RevisionValidator } from '../../../src/agent/learning/RevisionValidator.js';
import { LeafLearner, type LeafCallContext } from '../../../src/agent/learning/LeafLearner.js';
import { createLeafLearnerDeps } from '../../../src/agent/learning/LeafLearnerDeps.js';
import type { LoadedKnowledge, LearningSolver as Solver } from '../../../src/agent/learning/types.js';
import { DeterministicJudge } from '../../../src/agent/evaluation/DeterministicJudge.js';
import type { Diagnosis, Feedback, SolveResult, TaskRecord } from '../../../src/types/learning.js';
import type { KnowledgeRevisionRecord, RevisionOp } from '../../../src/types/skills.js';
import { makeTempDir, makeTempJsonlPath, cleanupTempDirs } from '../../helpers/tempStorage.js';
import { skillInput } from '../../unit/agent/knowledge/knowledgeFixtures.js';

/**
 * Task whose source document is absent from knowledge, so the real fallback diagnoser classifies a
 * failure as `missing-knowledge` and the editor drafts a `skill.add` for it.
 *
 * @param id - Task id.
 * @param expected - Expected answer.
 * @returns The task.
 */
function taskWithSource(id: string, expected: string): TaskRecord {
  return {
    id,
    input: `${id} general question`,
    category: 'general',
    sources: [{ ref: `doc-${id}`, kind: 'document' }],
    rubric: [{ id: 'c1', text: 'states the value', kind: 'fact', expected }],
  };
}

/** Three tasks: `task-a` and `task-c` pass without knowledge; `task-b` needs its learned skill. */
const TASKS: TaskRecord[] = [taskWithSource('task-a', 'alpha'), taskWithSource('task-b', 'beta'), taskWithSource('task-c', 'gamma')];
const TASK_IDS = TASKS.map((t) => t.id);
const PASSING_WITHOUT_KNOWLEDGE = ['task-a', 'task-c'];

/**
 * Deterministic solver that reads the knowledge markdown.
 *
 * @returns The solver.
 */
function knowledgeSolver(): Solver {
  return {
    async solve(task: TaskRecord, knowledge: LoadedKnowledge): Promise<SolveResult> {
      const expected = String(task.rubric[0]!.expected);
      const broken = knowledge.markdown.includes(`BROKEN:${task.id}`);
      const learned = knowledge.markdown.includes(`Learned: ${task.id}`);
      const passes = !broken && (PASSING_WITHOUT_KNOWLEDGE.includes(task.id) || learned);
      return { answer: passes ? expected : 'no idea', traceAddrs: [] };
    },
  };
}

/**
 * `skill.add` op that breaks one task: its body carries `BROKEN:<taskId>` and its description matches
 * the task input, so the skill is loaded for that task.
 *
 * @param taskId - Task to break.
 * @returns The op.
 */
function breakingOp(taskId: string): RevisionOp {
  return {
    op: 'skill.add',
    skill: skillInput(`break-${taskId}`, {
      description: `${taskId} general question`,
      body: `BROKEN:${taskId} misleading advice`,
    }) as Extract<RevisionOp, { op: 'skill.add' }>['skill'],
  };
}

describe('Recursa Phase 4: leaf learner over real components (JSONL)', () => {
  const contexts: ManagerContext[] = [];
  const savedEmbedding = process.env.MEMORY_EMBEDDING_PROVIDER;

  beforeEach(() => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
  });

  afterEach(() => {
    for (const ctx of contexts.splice(0)) ctx.close();
    if (savedEmbedding === undefined) delete process.env.MEMORY_EMBEDDING_PROVIDER;
    else process.env.MEMORY_EMBEDDING_PROVIDER = savedEmbedding;
    cleanupTempDirs();
  });

  /**
   * Fresh JSONL context and the real RS-15 / RS-16 / RS-22 pieces wired to it.
   *
   * @returns The context, the trace store and the real editor.
   */
  function setup() {
    const ctx = new ManagerContext({ storagePath: makeTempJsonlPath(), storageType: 'jsonl' });
    contexts.push(ctx);
    const traces = new LearningTrace(ctx.storage, { entityManager: ctx.entityManager, relationManager: ctx.relationManager });
    const editor = new KnowledgeEditor({ skills: ctx.skillManager });
    return { ctx, traces, editor };
  }

  it('learns the missing skill, publishes SKILL.md files, and stops all-pass', async () => {
    const { ctx, traces, editor } = setup();
    const publishDir = makeTempDir('recursa-publish-');
    const adapters = createLeafLearnerDeps({
      diagnoser: new Diagnoser({ failureManager: ctx.failureManager, reflections: ctx.reflectionManager }),
      editor,
      round: () => 0,
      tasks: () => ({}),
      results: () => ({}),
      feedback: () => ({}),
      baseSnapshotId: () => '',
    });
    const learner = new LeafLearner({
      repository: ctx.knowledgeRepository,
      traces,
      diagnoser: adapters.diagnoser,
      editor: adapters.editor,
      publisher: ctx.skillPublisher,
      publishDir,
    });

    const result = await learner.learn(
      { taskIds: TASK_IDS, tasks: TASKS, budget: { maxRounds: 3 } },
      { solver: knowledgeSolver(), judge: new DeterministicJudge() },
    );

    expect(result.stoppedBecause).toBe('all-pass');
    expect(result.before.allPass).toBeCloseTo(2 / 3);
    expect(result.after.allPass).toBe(1);
    expect((await ctx.skillManager.list()).map((s) => s.name)).toContain('Learned: task-b');
    const published = readdirSync(publishDir, { recursive: true }).map(String);
    expect(published.some((f) => f.endsWith('SKILL.md'))).toBe(true);
  });

  it('rejects an edit that breaks a passing task and leaves K unchanged', async () => {
    const { ctx, traces, editor } = setup();
    const repository = ctx.knowledgeRepository;
    const digestBefore = (await repository.snapshot('before')).digest;

    // Real editor output plus one op that breaks task-a, which passes today.
    let sabotaged: KnowledgeRevisionRecord | undefined;
    const sabotage = {
      edit: async (diagnoses: Diagnosis[], knowledge: LoadedKnowledge, signal?: AbortSignal, call?: LeafCallContext) => {
        const drafted = await editor.edit(
          diagnoses,
          {
            tasks: call!.tasks,
            results: call!.results,
            knowledge,
            round: call!.round,
            baseSnapshotId: call!.baseSnapshotId,
          },
          signal,
        );
        sabotaged = { ...drafted, ops: [...drafted.ops, breakingOp('task-a')] };
        return sabotaged;
      },
    };
    const diagnoser = new Diagnoser({ failureManager: ctx.failureManager, reflections: ctx.reflectionManager });
    const learner = new LeafLearner({
      repository,
      traces,
      diagnoser: createLeafLearnerDeps({
        diagnoser,
        editor,
        round: () => 0,
        tasks: () => ({}),
        results: () => ({}),
        feedback: () => ({}),
        baseSnapshotId: () => '',
      }).diagnoser,
      editor: sabotage,
    });

    const result = await learner.learn(
      { taskIds: TASK_IDS, tasks: TASKS, budget: { maxRounds: 3 } },
      { solver: knowledgeSolver(), judge: new DeterministicJudge() },
    );

    expect(result.stoppedBecause).toBe('no-progress');
    expect(result.after.allPass).toBeCloseTo(2 / 3);
    expect((await repository.snapshot('after')).digest).toBe(digestBefore);
    expect(await ctx.skillManager.list()).toHaveLength(0);

    // The same verdict from the RS-17 validator, run directly on the sabotaged revision.
    expect(sabotaged).toBeDefined();
    const passingFeedback = (id: string): Feedback => ({
      taskId: id,
      criteria: [{ criterionId: 'c1', pass: true }],
      allPass: true,
      source: 'judge',
    });
    const verdict = await new RevisionValidator().validate(sabotaged!, {
      repository,
      affectedTaskIds: ['task-b'],
      allTasks: TASKS,
      priorFeedback: { 'task-a': passingFeedback('task-a'), 'task-c': passingFeedback('task-c') },
      validationSampleSize: 2,
      solver: knowledgeSolver(),
      judge: new DeterministicJudge(),
    });
    expect(verdict.verdict).toBe('reject');
    expect(verdict.regressed).toContain('task-a');
  });
});
