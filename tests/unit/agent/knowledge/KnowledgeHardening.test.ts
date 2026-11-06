/**
 * Regression tests for the Phase 1B/1C challenger findings on the knowledge
 * side: unknown and malformed revision ops reject instead of applying or
 * throwing (items 5, 6), revision-written skills match SkillManager entities
 * (item 7), unversioned instruction patches never report a conflict under
 * contention (item 8), and loadForContext validates its budget (item 10).
 */
import { describe, it, expect } from 'vitest';
import { InstructionSetManager } from '../../../../src/agent/knowledge/InstructionSetManager.js';
import { KnowledgeRepository } from '../../../../src/agent/knowledge/KnowledgeRepository.js';
import { SkillManager } from '../../../../src/agent/skills/SkillManager.js';
import { skillDedupHash, skillObservations } from '../../../../src/agent/skills/skillRecordUtils.js';
import { isSkillEntity } from '../../../../src/types/agent-memory.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { RevisionOp, SkillId } from '../../../../src/types/skills.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { fakeFailures, fakeSkills, makeRevision, makeSkill, seedSkill, skillInput } from './knowledgeFixtures.js';

async function world(storage: IGraphStorage, skills = fakeSkills([])) {
  const sets = new InstructionSetManager(storage);
  await sets.add({ role: 'solver', id: 'instructions-solver-main' });
  await seedSkill(storage, makeSkill('skill-a'));
  const repo = new KnowledgeRepository({ storage, instructionSets: sets, skills, failures: fakeFailures([]) });
  await repo.snapshot();
  return { sets, repo };
}

async function entityDump(storage: IGraphStorage): Promise<string> {
  const graph = await storage.loadGraph();
  return JSON.stringify(graph.entities.map((e) => [e.name, e.version ?? 1]).sort());
}

withBothBackends('KnowledgeRepository hardening', (backend) => {
  it('item 5: an unknown op is rejected with its index, nothing written', async () => {
    const storage = backend.create();
    const { repo } = await world(storage);
    const before = await entityDump(storage);
    const ops = [
      { op: 'instruction.patch', id: 'instructions-solver-main', heading: 'Goal', text: 'x', sources: [] },
      { op: 'skill.explode' },
    ] as unknown as RevisionOp[];
    const result = await repo.applyRevision(makeRevision('r-unknown', 'K-0', ops), { expectedSnapshotId: 'K-0' });
    expect(result).toEqual({ status: 'rejected', failedOpIndex: 1, reason: 'unknown op: skill.explode' });
    expect(await entityDump(storage)).toBe(before);
  });

  it('item 6: malformed ops reject (never throw) and an unknown kind is refused', async () => {
    const storage = backend.create();
    const { repo } = await world(storage);
    const before = await entityDump(storage);
    const malformed: unknown[] = [
      { op: 'skill.add' },
      { op: 'skill.add', skill: { ...skillInput('no-scope'), scope: undefined } },
      { op: 'skill.add', skill: { ...skillInput('bad-kind'), kind: 'zzz' } },
      { op: 'skill.update', id: 'skill-a', patch: { scope: {} } },
      { op: 'skill.update', id: 'skill-a', patch: { scope: { domains: [1] } } },
      { op: 'memory.reflect', summary: 'no evidence' },
      { op: 'instruction.patch', id: 'instructions-solver-main' },
      null,
    ];
    for (const op of malformed) {
      const result = await repo.applyRevision(makeRevision('r-bad', 'K-0', [op as RevisionOp]), {
        expectedSnapshotId: 'K-0',
      });
      expect(result.status, JSON.stringify(op)).toBe('rejected');
      expect(result).toMatchObject({ failedOpIndex: 0 });
    }
    expect(await entityDump(storage)).toBe(before);
  });

  it('item 7: revision-written skills carry the SkillManager contentHash and observations', async () => {
    const storage = backend.create();
    const sm = new SkillManager(storage);
    const { repo } = await world(storage, sm);
    const added = await repo.applyRevision(
      makeRevision('r-add', 'K-0', [{ op: 'skill.add', skill: skillInput('fresh') }]),
      { expectedSnapshotId: 'K-0' },
    );
    expect(added.status).toBe('applied');
    const created = (await storage.loadGraph()).entities.filter(isSkillEntity).find((e) => e.skillRecord.name === 'fresh')!;
    expect(created.contentHash).toBe(skillDedupHash('fresh', created.skillRecord.body));
    expect(created.observations).toEqual(skillObservations(created.skillRecord));

    const oldBody = created.skillRecord.body;
    const snap = (added as { snapshotId: string }).snapshotId;
    const updated = await repo.applyRevision(
      makeRevision('r-upd', snap, [{ op: 'skill.update', id: created.name as SkillId, patch: { body: 'New body.', description: 'changed desc' } }]),
      { expectedSnapshotId: snap },
    );
    expect(updated.status).toBe('applied');
    const live = storage.getEntityByName(created.name)!;
    expect(live.contentHash).toBe(skillDedupHash('fresh', 'New body.'));
    expect(live.observations).toContain('[description]: changed desc');
    const readded = await sm.add({ ...skillInput('fresh'), body: oldBody });
    expect(readded).not.toBe(created.name);
  });

  it('item 10: loadForContext rejects a negative or NaN budget', async () => {
    const storage = backend.create();
    const { repo } = await world(storage);
    for (const budgetTokens of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(repo.loadForContext({ role: 'solver', taskHint: 'x', budgetTokens })).rejects.toBeInstanceOf(RangeError);
    }
    await expect(repo.loadForContext({ role: 'solver', taskHint: 'x', budgetTokens: 0 })).resolves.toBeDefined();
  });
});

withBothBackends('InstructionSetManager contention', (backend) => {
  it('item 8: 20 concurrent unversioned patches all land; none reports a conflict', async () => {
    const storage = backend.create();
    const sets = new InstructionSetManager(storage);
    const id = await sets.add({ role: 'solver' });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => sets.patchSection(id, `S${i}`, `text ${i}`, [])),
    );
    expect(results.every((r) => r === 'updated')).toBe(true);
    expect(sets.get(id)!.sections.map((s) => s.heading).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `S${i}`).sort(),
    );
  });

  it('item 8: concurrent OCC patches at the same version: exactly one wins', async () => {
    const storage = backend.create();
    const sets = new InstructionSetManager(storage);
    const id = await sets.add({ role: 'solver' });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => sets.patchSection(id, 'Goal', `v${i}`, [], { expectedVersion: 1 })),
    );
    expect(results.filter((r) => r === 'updated')).toHaveLength(1);
    expect(results.filter((r) => r === 'version-conflict')).toHaveLength(4);
  });
});

describe('knowledge hardening fixtures', () => {
  it('skillDedupHash separates name from body', () => {
    expect(skillDedupHash('ab', 'c')).not.toBe(skillDedupHash('a', 'bc'));
  });
});
