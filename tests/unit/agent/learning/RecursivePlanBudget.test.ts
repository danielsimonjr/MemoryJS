/** Recursive learner planning and budgets (spec §3.7 S1, S2, S3). */
import { describe, it, expect } from 'vitest';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { split as realSplit, type SplitContext } from '../../../../src/agent/learning/SplitStrategies.js';
import type { SplitStrategyName, TaskRecord } from '../../../../src/types/learning.js';
import type { TraceTree } from '../../../../src/agent/learning/LearningTrace.js';
import { judge, scriptedSolver, taskFor } from './leafFixtures.js';
import { TASKS, buildRecursive, selectiveEditor, splitBySize } from './recursiveFixtures.js';

const ALL_IDS = TASKS.map((t) => t.id);
const count = (tree: TraceTree): number => 1 + tree.children.reduce((n, c) => n + count(c), 0);

describe('RecursiveLearner planning and budgets', () => {
  withBothBackends('plan', (backend) => {
    it('S2: 10 uncategorized tasks run as one forced leaf, not a chain', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => taskFor(`u-${i}`, `v${i}`));
      const built = buildRecursive(backend.create(), { split: realSplit });
      const result = await built.learner.learn(
        { taskIds: tasks.map((t) => t.id), tasks, budget: { maxRounds: 1 }, validationSampleSize: 2, maxDepth: 3 },
        { solver: scriptedSolver({ passWithoutKnowledge: tasks.map((t) => t.id) }), judge },
      );
      const tree = await built.traces.load(result.traceId);
      expect(count(tree)).toBe(2);
      expect(tree.children[0]!.record.learnerKind).toBe('leaf');
      const state = await built.learner.state(result.traceId);
      expect(state.lastStrategy).toBe('leaf');
    });

    it('S2: the next round split receives real diagnoses, feedback and a skillMatch', async () => {
      const seen: Array<{ name: SplitStrategyName; ctx: SplitContext | undefined }> = [];
      const spy = async (name: SplitStrategyName, tasks: TaskRecord[], ctx?: SplitContext) => {
        seen.push({ name, ctx });
        return splitBySize(2)(name, tasks, ctx);
      };
      const built = buildRecursive(backend.create(), { editor: selectiveEditor(['task-c', 'task-d']), split: spy });
      await built.learner.learn({ taskIds: ALL_IDS, tasks: TASKS, budget: { maxRounds: 4 }, validationSampleSize: 5 }, { solver: scriptedSolver({}), judge });
      const second = seen[1]!.ctx!;
      expect(second.diagnoses?.['task-a']?.kind).toBe('missing-knowledge');
      expect(second.feedback?.['task-a']?.allPass).toBe(false);
      expect(typeof second.skillMatch).toBe('function');
      const modes = await realSplit('byFailureMode', TASKS, second);
      expect(modes.map((m) => m.label)).toContain('missing-knowledge:fact');
    });

    it('S3: submitChild rejects a child that is not done, naming its phase', async () => {
      const built = buildRecursive(backend.create());
      const started = await built.learner.start({ taskIds: ALL_IDS, tasks: TASKS, budget: { maxRounds: 2 }, validationSampleSize: 5 });
      const { childTraceIds } = await built.learner.plan(started.traceId);
      await expect(built.learner.submitChild(started.traceId, childTraceIds[0]!)).rejects.toThrow(/phase solve, not done/);
    });

    it('S1: 4 children x 100 tokens with maxTokens 300 stop under 400', async () => {
      const built = buildRecursive(backend.create(), { split: splitBySize(1) });
      const result = await built.learner.learn(
        { taskIds: ALL_IDS, tasks: TASKS, budget: { maxRounds: 4, maxTokens: 300 }, validationSampleSize: 5, concurrency: 1 },
        { solver: scriptedSolver({ tokens: { input: 50, output: 50 } }), judge },
      );
      expect(result.stoppedBecause).toBe('budget-tokens');
      expect(result.report!.totalTokens).toBeLessThan(400);
      const tree = await built.traces.load(result.traceId);
      const shares = await Promise.all(tree.children.map(async (c) => JSON.parse((await built.traces.readState(c.record.id))!).options.budget.maxTokens));
      expect(shares.every((t: number) => t === 75)).toBe(true);
    });
  });
});
