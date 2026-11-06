/** KnowledgeRepository (RS-5): rollbackTo and loadForContext on both backends. */
import { it, expect } from 'vitest';
import { InstructionSetManager } from '../../../../src/agent/knowledge/InstructionSetManager.js';
import { KnowledgeRepository } from '../../../../src/agent/knowledge/KnowledgeRepository.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { SkillId } from '../../../../src/types/skills.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import {
  fakeFailures,
  fakeSkills,
  makeFailure,
  makeRevision,
  makeSkill,
  seedSkill,
  skillInput,
} from './knowledgeFixtures.js';

const SET_ID = 'instructions-solver-main';

async function seed(storage: IGraphStorage) {
  const sets = new InstructionSetManager(storage);
  await sets.add({
    role: 'solver',
    id: SET_ID,
    sections: [{ heading: 'Goal', text: 'v1 goal', sources: [], uncertainty: 0.1 }],
  });
  await seedSkill(storage, makeSkill('skill-a'));
  const liveSkills = [makeSkill('skill-a')];
  const repo = new KnowledgeRepository({
    storage,
    instructionSets: sets,
    skills: fakeSkills(liveSkills),
    failures: fakeFailures([makeFailure('failure-1')]),
  });
  return { sets, repo };
}

withBothBackends('KnowledgeRepository.rollbackTo', (backend) => {
  it('restores sections, retires skills added later, and labels the new snapshot', async () => {
    const storage = backend.create();
    const { sets, repo } = await seed(storage);
    await repo.snapshot();
    expect(
      await repo.applyRevision(
        makeRevision('revision-roll', 'K-0', [
          { op: 'instruction.patch', id: SET_ID, heading: 'Goal', text: 'v2 goal', sources: [] },
          { op: 'skill.add', skill: skillInput('skill-b') },
        ]),
        { expectedSnapshotId: 'K-0' },
      ),
    ).toEqual({ status: 'applied', snapshotId: 'K-1' });
    expect(sets.get(SET_ID)?.sections[0]?.text).toBe('v2 goal');
    const k1 = await repo.getSnapshot('K-1');
    const laterSkill = k1!.skills.find((s) => s.name === 'skill-b')!;

    const result = await repo.rollbackTo('K-0');
    expect(result).toEqual({ status: 'restored', snapshotId: 'K-2' });
    expect(sets.get(SET_ID)?.sections[0]?.text).toBe('v1 goal');
    const k2 = await repo.getSnapshot('K-2');
    expect(k2?.label).toBe('rollback:K-0');
    expect(k2?.instructionSets[0]?.sections[0]?.text).toBe('v1 goal');
    const retired = k2!.skills.find((s) => s.id === laterSkill.id);
    expect(retired?.retired?.reason).toBe('rollback:K-0');
    expect(k2!.skills.find((s) => s.id === ('skill-a' as SkillId))?.retired).toBeUndefined();
    expect((await storage.loadGraph()).entities.some((e) => e.name === laterSkill.id)).toBe(true);
  });

  it('returns not-found for an unknown snapshot and writes nothing', async () => {
    const storage = backend.create();
    const { repo } = await seed(storage);
    await repo.snapshot();
    expect(await repo.rollbackTo('K-99')).toEqual({ status: 'not-found' });
    expect(await repo.getSnapshot('K-1')).toBeUndefined();
  });
});

withBothBackends('KnowledgeRepository.loadForContext', (backend) => {
  const role = 'solver' as const;
  const taskHint = 'paginating api results';

  it('includes instructions, skills and failures in order when the budget is large', async () => {
    const storage = backend.create();
    const { repo } = await seed(storage);
    const loaded = await repo.loadForContext({ role, taskHint, budgetTokens: 1_000_000 });
    const order = ['## Instructions (solver)', '## Skills', '## Failure lessons'].map((h) => loaded.markdown.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(loaded.skillIds).toEqual(['skill-a']);
    expect(loaded.failureIds).toEqual(['failure-1']);
    expect(loaded.instructionSetIds).toEqual([SET_ID]);
    expect(loaded.tokens).toBeLessThanOrEqual(1_000_000);
  });

  it('trims in priority order: a budget that fits only instructions drops skills and failures', async () => {
    const storage = backend.create();
    const { repo, sets } = await seed(storage);
    const instructionsOnly = new KnowledgeRepository({
      storage,
      instructionSets: sets,
      skills: fakeSkills([]),
      failures: fakeFailures([]),
    });
    const baseline = await instructionsOnly.loadForContext({ role, taskHint, budgetTokens: 1_000_000 });
    expect(baseline.tokens).toBeGreaterThan(0);

    const trimmed = await repo.loadForContext({ role, taskHint, budgetTokens: baseline.tokens });
    expect(trimmed.instructionSetIds).toEqual([SET_ID]);
    expect(trimmed.skillIds).toEqual([]);
    expect(trimmed.failureIds).toEqual([]);
    expect(trimmed.tokens).toBeLessThanOrEqual(baseline.tokens);
  });

  it('includes shared sets for the role and excludes sets of other roles', async () => {
    const storage = backend.create();
    const { repo, sets } = await seed(storage);
    await sets.add({ role: 'shared', id: 'instructions-shared-style', sections: [{ heading: 'Style', text: 'be brief', sources: [], uncertainty: 0.1 }] });
    await sets.add({ role: 'learner', id: 'instructions-learner-x', sections: [{ heading: 'Learn', text: 'learner only', sources: [], uncertainty: 0.1 }] });
    const loaded = await repo.loadForContext({ role, taskHint, budgetTokens: 1_000_000 });
    expect(loaded.instructionSetIds.sort()).toEqual(['instructions-shared-style', SET_ID].sort());
    expect(loaded.markdown).toContain('be brief');
    expect(loaded.markdown).not.toContain('learner only');
  });

  it('never exceeds the budget and returns nothing for a zero budget', async () => {
    const storage = backend.create();
    const { repo } = await seed(storage);
    for (const budgetTokens of [1, 10, 25, 60, 120, 400]) {
      const loaded = await repo.loadForContext({ role, taskHint, budgetTokens });
      expect(loaded.tokens).toBeLessThanOrEqual(budgetTokens);
    }
    const none = await repo.loadForContext({ role, taskHint, budgetTokens: 0 });
    expect(none).toEqual({ markdown: '', skillIds: [], instructionSetIds: [], failureIds: [], tokens: 0 });
  });
});
