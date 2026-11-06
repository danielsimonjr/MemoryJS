/**
 * knowledgeLayersForWakeUp section split (S2): instructions load only for L0 and skills only
 * for L1, each within its own budget, with one skill match per wake-up.
 */
import { describe, it, expect, vi } from 'vitest';
import { InstructionSetManager } from '../../../src/agent/knowledge/InstructionSetManager.js';
import { KnowledgeRepository } from '../../../src/agent/knowledge/KnowledgeRepository.js';
import { knowledgeLayersForWakeUp } from '../../../src/agent/knowledgeContext.js';
import { estimateTokensFromText } from '../../../src/utils/tokenEstimate.js';
import { withBothBackends } from '../../helpers/tempStorage.js';
import { fakeFailures, fakeSkills, makeSkill } from './knowledge/knowledgeFixtures.js';

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

withBothBackends('knowledgeLayersForWakeUp sections', (backend) => {
  it('520-token instructions do not starve skills in a 600-token L1', async () => {
    const storage = backend.create();
    const sets = new InstructionSetManager(storage);
    const id = await sets.add({ role: 'shared' });
    await sets.patchSection(id, 'Rules', words(400), []);
    const skills = fakeSkills([makeSkill('skill-a', { body: 'Follow the cursor until exhausted.' })]);
    const match = vi.spyOn(skills, 'match');
    const failures = fakeFailures([]);
    const lookup = vi.spyOn(failures, 'lookupForTask');
    const repo = new KnowledgeRepository({ storage, instructionSets: sets, skills, failures });
    const load = vi.spyOn(repo, 'loadForContext');

    const layers = await knowledgeLayersForWakeUp(repo, 'paginate api', {
      maxL0Tokens: 600, maxL1Tokens: 600, multiplier: 1.3,
    });

    expect(estimateTokensFromText(layers.l0, 1.3)).toBeGreaterThan(500);
    expect(layers.l1).toContain('## Skills');
    expect(layers.l1).toContain('Follow the cursor until exhausted.');
    expect(match).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ sections: ['instructions'], budgetTokens: 600 }));
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ sections: ['skills'], budgetTokens: 600 }));
  });

  it('loadForContext defaults to every section', async () => {
    const storage = backend.create();
    const sets = new InstructionSetManager(storage);
    await sets.patchSection(await sets.add({ role: 'shared' }), 'Rules', 'be brief', []);
    const skills = fakeSkills([makeSkill('skill-b')]);
    const repo = new KnowledgeRepository({ storage, instructionSets: sets, skills, failures: fakeFailures([]) });
    const all = await repo.loadForContext({ role: 'shared', taskHint: 'x' });
    expect(all.markdown).toContain('## Instructions (shared)');
    expect(all.markdown).toContain('## Skills');
    const only = await repo.loadForContext({ role: 'shared', taskHint: 'x', sections: ['skills'] });
    expect(only.markdown).not.toContain('## Instructions');
    expect(only.skillIds).toEqual(['skill-b']);
  });
});

describe('knowledgeLayersForWakeUp budgets', () => {
  it('skips loading a layer with no budget', async () => {
    const loadForContext = vi.fn(async () => ({ markdown: '', skillIds: [], instructionSetIds: [], failureIds: [], tokens: 0 }));
    await knowledgeLayersForWakeUp({ loadForContext } as never, 'x', { maxL0Tokens: 0, maxL1Tokens: 10, multiplier: 1.3 });
    expect(loadForContext).toHaveBeenCalledTimes(1);
  });
});
