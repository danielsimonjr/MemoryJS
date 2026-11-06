/**
 * Loadability contract (spec §3.4, D1/D2): a skill the KnowledgeEditor builds for a task is
 * loaded for that task through a real SkillManager + KnowledgeRepository.
 */
import { describe, it, expect } from 'vitest';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { Bootstrapper } from '../../../../src/agent/bootstrap/Bootstrapper.js';
import { realKnowledge, syntheticCorpus } from '../bootstrap/bootstrapFixtures.js';
import { isTaskEntity } from '../../../../src/types/agent-memory.js';
import type { Diagnosis, LearnResult, TaskRecord } from '../../../../src/types/learning.js';
import { KnowledgeEditor } from '../../../../src/agent/learning/KnowledgeEditor.js';
import { skillIdsForTaskIds, selectSkills } from '../../../../src/agent/knowledge/knowledgeLoad.js';

const EMPTY = { tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} };
const learner = {
  async learn(): Promise<LearnResult> {
    return { snapshotId: 'K', traceId: 't', before: EMPTY, after: EMPTY, stoppedBecause: 'all-pass' } as unknown as LearnResult;
  },
};

describe('learned skill loadability', () => {
  withBothBackends('editor skills reach their own task', (backend) => {
    it('loads >= 38/40 editor-built skills for their own task', async () => {
      const storage = backend.create();
      const { skills, repository } = realKnowledge(storage);
      const boot = new Bootstrapper({ storage, skills, repository, learner });
      await boot.run({
        sources: syntheticCorpus(50, 5),
        solver: { async solve() { return { answer: '', traceAddrs: [] }; } },
        budget: { maxRounds: 1 },
        corpusLabel: 'c',
        taskCount: 40,
      } as never);
      const tasks = (await storage.loadGraph()).entities.filter(isTaskEntity).map((e) => e.taskRecord as TaskRecord);
      expect(tasks.length).toBe(40);
      const editor = new KnowledgeEditor({ skills });
      const diagnoses: Diagnosis[] = tasks.map((t) => ({
        taskId: t.id,
        kind: 'missing-knowledge',
        summary: 'The solver did not know where the material is stored.',
        evidenceAddrs: [],
        relatedSkillIds: [],
      }) as unknown as Diagnosis);
      const base = await repository.snapshot('base');
      const revision = await editor.edit(diagnoses, {
        tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
        results: {},
        knowledge: { markdown: '', skillIds: [], instructionSetIds: [], failureIds: [], tokens: 0 },
        round: 0,
        baseSnapshotId: base.id,
      });
      const added = revision.ops.filter((op) => op.op === 'skill.add');
      expect(added).toHaveLength(40);
      for (const op of added) {
        if (op.op !== 'skill.add') continue;
        expect(op.skill.scope.tasks?.[0]).toMatch(/^task:/);
        expect(op.skill.sources.some((s) => s.kind === 'task')).toBe(true);
        expect(op.skill.description).toContain(' — ');
      }
      expect((await repository.applyRevision(revision, { expectedSnapshotId: base.id })).status).toBe('applied');
      let loaded = 0;
      for (const t of tasks) {
        const includeSkillIds = await repository.skillIdsForTasks([t.id]);
        const k = await repository.loadForContext({ role: 'solver', taskHint: t.input, includeSkillIds });
        const own = (await skills.list()).find((s) => s.scope.tasks?.includes(`task:${t.id}`));
        if (own && k.skillIds.includes(own.id)) loaded++;
      }
      expect(loaded).toBeGreaterThanOrEqual(38);
    });
  });

  it('loads more than 5 relevant skills (maxSkills default 20) and honours maxSkills', async () => {
    const { BACKEND_CASES } = await import('../../../helpers/tempStorage.js');
    const storage = BACKEND_CASES[0]!.create();
    const { skills, repository } = realKnowledge(storage);
    for (let i = 0; i < 8; i++) {
      await skills.add({ name: `S${i}`, description: `locate source states orion${i} ledger vendor`, kind: 'navigation', scope: { domains: ['locate'] }, uncertainty: 0.5, body: `B${i}`, resources: [], sources: [] });
    }
    const all = await repository.loadForContext({ role: 'solver', taskHint: 'locate source states ledger vendor' });
    expect(all.skillIds).toHaveLength(8);
    const three = await repository.loadForContext({ role: 'solver', taskHint: 'locate source states ledger vendor', maxSkills: 3 });
    expect(three.skillIds).toHaveLength(3);
    await expect(repository.loadForContext({ role: 'solver', taskHint: 'x', maxSkills: -1 })).rejects.toThrow(RangeError);
    const scratch = await repository.cloneForValidation();
    const unrelated = (await skills.list())[0]!;
    const k = await scratch.loadForContext({ role: 'solver', taskHint: 'zzz qqq', includeSkillIds: [unrelated.id] });
    expect(k.skillIds).toEqual([unrelated.id]);
  });

  it('skillIdsForTaskIds and selectSkills', () => {
    const mk = (id: string, tasks: string[], retired = false) => ({ id, scope: { domains: [], tasks }, ...(retired ? { retired: { at: 'x', reason: 'r' } } : {}) }) as never;
    expect(skillIdsForTaskIds([mk('a', ['task:1']), mk('b', ['task:2']), mk('c', ['task:1'], true)], ['1'])).toEqual(['a']);
    expect(skillIdsForTaskIds([mk('a', ['task:1'])], [])).toEqual([]);
    expect(selectSkills([mk('a', [])], [mk('a', []), mk('b', [])], 5).map((s: { id: string }) => s.id)).toEqual(['a', 'b']);
  });
});
