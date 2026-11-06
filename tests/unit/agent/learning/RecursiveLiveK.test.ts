/** Recursive learner B1/S6 (spec §3.4): results and stop reasons come from live K, not child overlays. */
import { describe, it, expect } from 'vitest';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import { isSkillEntity } from '../../../../src/types/agent-memory.js';
import type { RevisionValidator } from '../../../../src/agent/learning/RevisionValidator.js';
import { RevisionMerger, type ChildOutcome } from '../../../../src/agent/learning/RevisionMerger.js';
import { judge, makeRepo, scriptedSolver } from './leafFixtures.js';
import { TASKS, buildRecursive } from './recursiveFixtures.js';
import { skillInput } from '../knowledge/knowledgeFixtures.js';

const ALL_IDS = TASKS.map((t) => t.id);
const opts = (budget: Record<string, unknown> = { maxRounds: 4 }) => ({ taskIds: ALL_IDS, tasks: TASKS, budget, validationSampleSize: 5 });

async function liveSkillCount(storage: IGraphStorage): Promise<number> {
  return (await storage.loadGraph()).entities.filter(isSkillEntity).length;
}

const rejectAll = {
  async validate() {
    return { verdict: 'reject', fixed: [], regressed: [], unchanged: [], reason: 'stub reject' };
  },
} as unknown as RevisionValidator;

const acceptAll = {
  async validate() {
    return { verdict: 'accept', fixed: ALL_IDS, regressed: [], unchanged: [] };
  },
} as unknown as RevisionValidator;

describe('RecursiveLearner live-K results', () => {
  withBothBackends('live K', (backend) => {
    it('a rejected merge stops no-progress with after = the round before and no live skills', async () => {
      const storage = backend.create();
      const built = buildRecursive(storage, { validator: rejectAll });
      const result = await built.learner.learn(opts(), { solver: scriptedSolver({}), judge });
      expect(result.stoppedBecause).toBe('no-progress');
      expect(result.after.allPass).toBe(0);
      expect(result.after.allPass).toBe(result.before.allPass);
      expect(await liveSkillCount(storage)).toBe(0);
    });

    it('an applied merge is evaluated on live K: all-pass only when the live pass is all-pass', async () => {
      const storage = backend.create();
      const real = new RevisionMerger();
      const dropD = {
        async merge(children: ChildOutcome[], o?: { baseSnapshotId: string }) {
          const out = await real.merge(children, o);
          out.revision.ops = out.revision.ops.map((op) =>
            op.op === 'skill.add' ? { ...op, skill: { ...op.skill, body: op.skill.body.split('FIX:task-d').join('gone') } } : op,
          );
          return out;
        },
      };
      const built = buildRecursive(storage, { validator: acceptAll, merger: dropD });
      const result = await built.learner.learn(opts({ maxRounds: 1 }), { solver: scriptedSolver({}), judge });
      expect(result.stoppedBecause).not.toBe('all-pass');
      expect(result.after.allPass).toBe(0.75);
      expect(await liveSkillCount(storage)).toBeGreaterThanOrEqual(1);
      const state = await built.learner.state(result.traceId);
      expect(state.lastMerge?.evaluation).toEqual({ 'task-a': true, 'task-b': true, 'task-c': true, 'task-d': false });
    });

    it('applied and all-pass on live K reports all-pass with the live skills present', async () => {
      const storage = backend.create();
      const built = buildRecursive(storage);
      const result = await built.learner.learn(opts(), { solver: scriptedSolver({}), judge });
      expect(result.stoppedBecause).toBe('all-pass');
      expect(result.after.allPass).toBe(1);
      expect(await liveSkillCount(storage)).toBeGreaterThanOrEqual(1);
    });

    it('S6: an apply-conflict rebases and continues to the next round, stopping only on budget', async () => {
      const storage = backend.create();
      const repo = makeRepo(storage);
      let interlopes = 1;
      const racing = new Proxy(repo, {
        get(target, prop, receiver) {
          if (prop === 'applyRevision') {
            return async (...args: Parameters<typeof repo.applyRevision>) => {
              if (interlopes-- > 0) {
                const base = await target.snapshot('interloper-base');
                await target.applyRevision(
                  { id: 'interloper', baseSnapshotId: base.id, ops: [{ op: 'skill.add', skill: skillInput('interloper') as never }], rationale: 'x', diagnosedFailureIds: [], producedBy: 'leaf', createdAt: new Date().toISOString() } as never,
                  { expectedSnapshotId: base.id },
                );
              }
              return target.applyRevision(...args);
            };
          }
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
      const built = buildRecursive(storage, { repository: racing });
      const result = await built.learner.learn(opts({ maxRounds: 3 }), { solver: scriptedSolver({}), judge });
      const actions = (await built.traces.get(result.traceId))?.actions ?? [];
      expect(actions.some((a) => a.kind === 'merge' && a.outcome.startsWith('apply-conflict'))).toBe(true);
      expect(actions.filter((a) => a.kind === 'split').length).toBeGreaterThanOrEqual(2);
      expect(result.stoppedBecause).toBe('all-pass');
      expect(result.after.allPass).toBe(1);
    });

    it('S6: a persistent conflict stops on the round budget', async () => {
      const storage = backend.create();
      const repo = makeRepo(storage);
      const always = new Proxy(repo, {
        get(target, prop, receiver) {
          if (prop === 'applyRevision') return async () => ({ status: 'conflict', currentSnapshotId: 'K-x' });
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
      const built = buildRecursive(storage, { repository: always });
      const result = await built.learner.learn(opts({ maxRounds: 2 }), { solver: scriptedSolver({}), judge });
      expect(result.stoppedBecause).toBe('budget-rounds');
      expect(result.after.allPass).toBe(0);
    });
  });
});
