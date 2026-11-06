/**
 * 09 - Recursa skills, instruction sets, knowledge snapshots, and SKILL.md publishing.
 *
 * Run: bun run examples/09-recursa-skills-knowledge.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ManagerContext } from '../src/index.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  // skillPublishRoot confines every SKILL.md publish/import directory to this root.
  const ctx = new ManagerContext({ storagePath, skillPublishRoot: dirname(storagePath) });
  try {
    // Skills: reusable knowledge with a scope (domains are required).
    const refundId = await ctx.skillManager.add({
      name: 'Refund duplicate charges',
      description: 'Use when a customer reports the same charge twice',
      kind: 'procedure',
      scope: { domains: ['billing'], tasks: ['billing-dispute'] },
      uncertainty: 0.15,
      body: '1. Confirm both charges in the ledger.\n2. Refund the later one.',
      sources: [{ ref: 'runbook:billing', kind: 'document' }],
    });
    await ctx.skillManager.add({
      name: 'Reset password',
      description: 'Use when a user is locked out of their account',
      kind: 'procedure',
      scope: { domains: ['auth'] },
      uncertainty: 0.3,
      body: 'Send a reset link to the verified email address.',
    });
    const matches = await ctx.skillManager.match('customer charged twice billing', { limit: 3 });
    await ctx.skillManager.recordOutcome(refundId, 'helped');

    // Instruction sets: role-scoped guidance (solver, learner, or shared).
    const instructionId = await ctx.instructionSets.add({
      role: 'solver',
      sections: [
        {
          heading: 'Tone',
          text: 'Be brief and confirm the amount before acting.',
          sources: [{ ref: 'style-guide', kind: 'document' }],
          uncertainty: 0.1,
        },
      ],
    });
    const rendered = await ctx.instructionSets.render('solver', { budgetTokens: 200 });

    // Knowledge snapshot: instructions + skills + failures at a point in time.
    const snapshot = await ctx.knowledgeRepository.snapshot('before-review');
    const loaded = await ctx.knowledgeRepository.loadForContext({
      role: 'solver',
      taskHint: 'customer charged twice',
      budgetTokens: 400,
    });

    // Publish the live skills as SKILL.md files below the confined root.
    const published = await ctx.skillPublisher.publish('published-skills');

    return {
      matchedSkill: matches[0]?.skill.name ?? null,
      refundRetrieved: ctx.skillManager.get(refundId)?.name ?? null,
      instructionSetId: instructionId.startsWith('instructions-solver-'),
      renderedHasTone: rendered.includes('Tone'),
      snapshotHasSkills: snapshot.skills.length,
      loadedSkillIds: loaded.skillIds.length,
      loadedMentionsRefund: loaded.markdown.includes('Refund duplicate charges'),
      publishedSkillCount: published.skillCount,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-09-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
