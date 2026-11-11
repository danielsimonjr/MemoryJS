/**
 * Recursa spec 6C: the whole loop over a 32-document synthetic corpus. Bootstrap maps the corpus and
 * writes a `bootstrap` snapshot, the practice tasks are split with `stratifiedSplit`, and the
 * recursive learner learns on the train side with a solver that answers a task only when its
 * learned skill is loaded. Metrics must improve (with real judged criteria), the trace tree must be
 * recursive (multi-task subsets or a grandchild), the published SKILL.md set must equal the live
 * skill set, the held-out test split is evaluated on live K, and `ctx.close()` must close the handles.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { LearningTrace } from '../../../src/agent/learning/LearningTrace.js';
import { Evaluator, stratifiedSplit, type Solver } from '../../../src/agent/evaluation/Evaluator.js';
import { DeterministicJudge } from '../../../src/agent/evaluation/DeterministicJudge.js';
import type { LearningSolver } from '../../../src/agent/learning/types.js';
import type { LoadedKnowledge } from '../../../src/agent/knowledge/KnowledgeRepository.js';
import type { EvalMetrics, SolveResult, TaskRecord } from '../../../src/types/learning.js';
import { syntheticCorpus } from '../../unit/agent/bootstrap/bootstrapFixtures.js';
import { makeTempDir, cleanupTempDirs } from '../../helpers/tempStorage.js';

/** Backends the loop runs on: the storage file name for each. */
const BACKENDS = [
  { name: 'jsonl' as const, file: 'memory.jsonl' },
  { name: 'sqlite' as const, file: 'memory.db' },
];

/**
 * Collect every file named `SKILL.md` under a directory.
 *
 * @param dir - Directory to scan.
 * @returns Paths of the files found.
 */
function skillFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...skillFiles(path));
    else if (name === 'SKILL.md') out.push(path);
  }
  return out;
}

describe.each(BACKENDS)('Recursa 6C: bootstrap, split, recursive learn on $name', (backend) => {
  let root: string | undefined;
  let context: ManagerContext | undefined;
  const savedEmbed = process.env.MEMORY_EMBEDDING_PROVIDER;

  afterEach(async () => {
    if (context) await context.close();
    context = undefined;
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
    if (savedEmbed === undefined) delete process.env.MEMORY_EMBEDDING_PROVIDER;
    else process.env.MEMORY_EMBEDDING_PROVIDER = savedEmbed;
    cleanupTempDirs();
  });

  it('improves before/after metrics on a recursive tree, publishes the live skill set, evaluates held-out tasks and closes handles', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
    root = makeTempDir('recursa-loop-');
    const publishDir = join(root, 'skills');
    context = new ManagerContext({ storagePath: join(root, backend.file), storageType: backend.name, skillPublishRoot: root });
    const ctx = context;

    // 1. Bootstrap the 32-document corpus (no learning yet; the learner runs on the train split below).
    const boot = await ctx.bootstrapper({ learning: { publishDir } }).run({
      sources: syntheticCorpus(32, 4),
      budget: { maxRounds: 2 },
      corpusLabel: 'corpus',
      taskCount: 12,
    });
    expect(boot.taskIds).toHaveLength(12);
    const bootSnapshot = await ctx.knowledgeRepository.getSnapshot(boot.snapshotId);
    expect(bootSnapshot?.label).toBe('bootstrap');

    // Practice tasks come back from storage; the input carries the task id so lexical matching works.
    // Two categories so `auto` splits the train side into two multi-task subsets.
    const graph = await ctx.storage.loadGraph();
    const tasks: TaskRecord[] = boot.taskIds
      .map((id) => graph.entities.find((e) => e.name === id)?.taskRecord)
      .filter((t): t is TaskRecord => t !== undefined)
      .map((t, i) => ({ ...t, input: `Learned ${t.id}`, category: i % 2 === 0 ? 'ledger' : 'vendor' }));
    expect(tasks).toHaveLength(12);

    // 2. Stratified split (seeded); learn on the train side only.
    const split = stratifiedSplit(tasks, { testFraction: 0.25, by: 'difficulty', seed: 42 });
    expect(split.train.length + split.test.length).toBe(tasks.length);
    expect(split.train.length).toBeGreaterThan(3);
    expect(split.test.length).toBeGreaterThan(0);

    // 3. Scripted solver: answers the expected value only when the task's learned skill is loaded.
    const expectedOf = (task: TaskRecord): string =>
      task.rubric.map((c) => (Array.isArray(c.expected) ? c.expected.join(' ') : String(c.expected ?? ''))).join('; ');
    const solver: LearningSolver = {
      async solve(task: TaskRecord, knowledge: LoadedKnowledge): Promise<SolveResult> {
        const learned = knowledge.markdown.includes(`Learned: ${task.id}`);
        return { answer: learned ? expectedOf(task) : 'unknown', traceAddrs: [] };
      },
    };
    const judge = new DeterministicJudge();
    const heldOut = async (): Promise<EvalMetrics> => {
      const evalSolver: Solver = async (task) => {
        const knowledge = await ctx.knowledgeRepository.loadForContext({ role: 'solver', taskHint: task.input });
        return (await solver.solve(task, knowledge)).answer;
      };
      return (await new Evaluator().evaluate(split.test, evalSolver, judge)).metrics;
    };
    const heldOutBefore = await heldOut();

    const loop = ctx.learningLoop({ solver, judge, publishDir });
    const result = await loop.learn({
      taskIds: split.train.map((t) => t.id),
      tasks: split.train,
      budget: { maxRounds: 3 },
      validationSampleSize: 4,
      split: 'auto',
    });

    // 4. Metrics improve, and the criteria behind them are real (S2).
    expect(result.before.tasks).toBe(split.train.length);
    expect(result.after.allPass).toBeGreaterThan(result.before.allPass);
    expect(result.after.meanCriteria).toBeGreaterThan(0);
    for (const bucket of Object.values(result.after.byCategory)) {
      if (bucket.allPass === 1) expect(bucket.meanCriteria).toBe(1);
      if (bucket.allPass > 0) expect(bucket.meanCriteria).toBeGreaterThan(0);
    }

    // 5. Recursive trace tree: a non-singleton subset or a grandchild; it renders to Mermaid.
    const traces = new LearningTrace(ctx.storage, { entityManager: ctx.entityManager, relationManager: ctx.relationManager });
    const tree = await traces.load(result.traceId);
    expect(tree.record.learnerKind).toBe('recursive');
    expect(tree.children.length).toBeGreaterThanOrEqual(2);
    const status = (await loop.status(result.traceId)) as {
      subsets?: Array<{ taskIds: string[] }>;
      criteria?: { current: Record<string, Array<{ criterionId: string }>> };
    };
    // The run carries the judged criteria behind its pass map, not empty placeholders.
    expect(Object.values(status.criteria?.current ?? {}).some((c) => c.length > 0)).toBe(true);
    const multiTask = (status.subsets ?? []).filter((s) => s.taskIds.length >= 2).length;
    const grandchildren = tree.children.reduce((n, c) => n + c.children.length, 0);
    expect(multiTask >= 2 || grandchildren > 0).toBe(true);
    expect(traces.toMermaid(tree)).toContain('recursive');

    // 6. The published SKILL.md set equals the live skill set.
    const published = skillFiles(publishDir).map((f) => basename(dirname(f))).sort();
    const live = (await ctx.skillManager.list()).map((s) => s.id).sort();
    expect(published.length).toBeGreaterThanOrEqual(1);
    expect(published).toEqual(live);

    // 7. Held-out test split evaluated on live K: metrics are reported and do not regress.
    const heldOutAfter = await heldOut();
    expect(heldOutAfter.tasks).toBe(split.test.length);
    expect(Number.isNaN(heldOutAfter.allPass) || Number.isNaN(heldOutAfter.meanCriteria)).toBe(false);
    expect(heldOutAfter.allPass).toBeGreaterThanOrEqual(heldOutBefore.allPass);

    // 8. Close releases every handle: the SQLite connection is closed; the temp dir can be removed.
    const db = (ctx.storage as unknown as { db?: { prepare?: (sql: string) => unknown } | null }).db ?? undefined;
    await ctx.close();
    context = undefined;
    if (backend.name === 'sqlite') {
      expect(db).toBeDefined();
      // The driver throws a statement against a closed connection.
      expect(() => db!.prepare!('SELECT 1')).toThrow();
    }
    rmSync(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
    root = undefined;
  });
});
