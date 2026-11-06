/** KnowledgeRepository (RS-5): snapshots, digest, diff, revisions on both backends. */
import { describe, it, expect } from 'vitest';
import { InstructionSetManager } from '../../../../src/agent/knowledge/InstructionSetManager.js';
import { KnowledgeRepository } from '../../../../src/agent/knowledge/KnowledgeRepository.js';
import { digestOf } from '../../../../src/agent/knowledge/knowledgeDigest.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { RevisionOp, SkillId } from '../../../../src/types/skills.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import {
  closeStorage,
  fakeFailures,
  fakeSkills,
  makeRevision,
  makeSkill,
  reopen,
  seedSkill,
  skillInput,
} from './knowledgeFixtures.js';

interface World {
  storage: IGraphStorage;
  sets: InstructionSetManager;
  repo: KnowledgeRepository;
  setId: string;
}

/** One solver set with a Goal section and one live skill "skill-a". */
async function seedWorld(storage: IGraphStorage): Promise<World> {
  const sets = new InstructionSetManager(storage);
  const setId = await sets.add({
    role: 'solver',
    id: 'instructions-solver-main',
    sections: [{ heading: 'Goal', text: 'v1 goal', sources: [], uncertainty: 0.1 }],
  });
  await seedSkill(storage, makeSkill('skill-a'));
  const repo = new KnowledgeRepository({
    storage,
    instructionSets: sets,
    skills: fakeSkills([]),
    failures: fakeFailures([]),
  });
  return { storage, sets, repo, setId };
}

/** Entity names plus record JSON, for asserting "no writes happened". */
async function fingerprint(storage: IGraphStorage): Promise<string> {
  const graph = await storage.loadGraph();
  return JSON.stringify(
    [...graph.entities].map((e) => [e.name, e.version ?? 1, JSON.stringify(e)]).sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    ),
  );
}

withBothBackends('KnowledgeRepository snapshots', (backend) => {
  it('K-n ids count snapshots, labels are metadata, and the digest ignores key order', async () => {
    const storage = backend.create();
    const { repo } = await seedWorld(storage);
    const k0 = await repo.snapshot('baseline');
    expect(k0.id).toBe('K-0');
    expect(k0.label).toBe('baseline');
    const k1 = await repo.snapshot();
    expect(k1.id).toBe('K-1');
    expect(k1.label).toBeUndefined();
    expect(digestOf({ instructionSets: k0.instructionSets, skills: k0.skills })).toBe(k0.digest);
    const reversedKeys = {
      skills: k0.skills.map((s) => Object.fromEntries(Object.entries(s).reverse())),
      instructionSets: k0.instructionSets,
    };
    expect(digestOf(reversedKeys)).toBe(k0.digest);
  });

  it('digest is identical after reloading the storage from disk', async () => {
    const storage = backend.create();
    const { repo } = await seedWorld(storage);
    const k0 = await repo.snapshot();
    const reloaded = reopen(backend, storage);
    try {
      const again = await new KnowledgeRepository({
        storage: reloaded,
        instructionSets: new InstructionSetManager(reloaded),
        skills: fakeSkills([]),
        failures: fakeFailures([]),
      }).getSnapshot('K-0');
      expect(again?.digest).toBe(k0.digest);
    } finally {
      closeStorage(reloaded);
    }
  });
});

withBothBackends('KnowledgeRepository diff', (backend) => {
  it('diff(a,b) and diff(b,a) are exact mirrors', async () => {
    const storage = backend.create();
    const { repo } = await seedWorld(storage);
    await repo.snapshot();
    const applied = await repo.applyRevision(
      makeRevision('revision-d1', 'K-0', [
        { op: 'skill.add', skill: skillInput('skill-b') },
        { op: 'instruction.patch', id: 'instructions-solver-main', heading: 'Goal', text: 'v2 goal', sources: [] },
        { op: 'instruction.patch', id: 'instructions-solver-main', heading: 'Style', text: 'brief', sources: [] },
      ]),
      { expectedSnapshotId: 'K-0' },
    );
    expect(applied).toEqual({ status: 'applied', snapshotId: 'K-1' });

    const forward = await repo.diff('K-0', 'K-1');
    const backward = await repo.diff('K-1', 'K-0');
    expect(forward).toBeDefined();
    expect(backward).toBeDefined();
    expect(forward!.skills.added).toHaveLength(1);
    expect(backward!.skills.removed).toEqual(forward!.skills.added);
    expect(backward!.skills.added).toEqual(forward!.skills.removed);
    expect(forward!.sections.changed).toEqual(['instructions-solver-main#Goal']);
    expect(backward!.sections.changed).toEqual(forward!.sections.changed);
    expect(forward!.sections.added).toEqual(['instructions-solver-main#Style']);
    expect(backward!.sections.removed).toEqual(forward!.sections.added);
    expect(await repo.diff('K-1', 'K-1')).toMatchObject({ skills: { added: [], removed: [], updated: [] } });
    expect(await repo.diff('K-0', 'K-missing')).toBeUndefined();
  });
});

withBothBackends('KnowledgeRepository.applyRevision', (backend) => {
  it('applies a valid revision, writes the entities and takes a new snapshot', async () => {
    const storage = backend.create();
    const { repo, sets } = await seedWorld(storage);
    await repo.snapshot();
    const before = (await repo.getSnapshot('K-0'))!.digest;
    const ops: RevisionOp[] = [
      { op: 'skill.add', skill: skillInput('skill-c') },
      { op: 'skill.update', id: 'skill-a' as SkillId, patch: { body: 'Updated body.' } },
      { op: 'instruction.patch', id: 'instructions-solver-main', heading: 'Goal', text: 'v2 goal', sources: [] },
      { op: 'heuristic.add', condition: 'user asks for review', action: 'request the PR' },
      { op: 'memory.reflect', summary: 'cursor loops matter', evidence: ['skill-a'] },
    ];
    expect(await repo.applyRevision(makeRevision('revision-ok', 'K-0', ops), { expectedSnapshotId: 'K-0' })).toEqual({
      status: 'applied',
      snapshotId: 'K-1',
    });
    const graph = await storage.loadGraph();
    const names = graph.entities.map((e) => e.name);
    expect(names.filter((n) => n.startsWith('skill-skill-c-'))).toHaveLength(1);
    expect(names.some((n) => n.startsWith('h_'))).toBe(true);
    expect(names.some((n) => n.startsWith('reflection-'))).toBe(true);
    expect(sets.get('instructions-solver-main')?.sections[0]?.text).toBe('v2 goal');
    const after = await repo.getSnapshot('K-1');
    expect(after?.digest).not.toBe(before);
    expect(after?.skills.find((s) => s.id === 'skill-a')?.body).toBe('Updated body.');
    expect(after?.memoryRefs.heuristicIds).toHaveLength(1);
    expect(after?.memoryRefs.reflectionIds).toHaveLength(1);
  });

  it('op 3 of 5 fails: rejected with failedOpIndex 2 and zero writes', async () => {
    const storage = backend.create();
    const { repo } = await seedWorld(storage);
    await repo.snapshot();
    const snapshotsBefore = await fingerprint(storage);
    const result = await repo.applyRevision(
      makeRevision('revision-bad', 'K-0', [
        { op: 'skill.add', skill: skillInput('skill-x') },
        { op: 'instruction.patch', id: 'instructions-solver-main', heading: 'Goal', text: 'should not persist', sources: [] },
        { op: 'skill.update', id: 'skill-missing' as SkillId, patch: { body: 'nope' } },
        { op: 'skill.retire', id: 'skill-a' as SkillId, reason: 'should not persist' },
        { op: 'heuristic.add', condition: 'c', action: 'a' },
      ]),
      { expectedSnapshotId: 'K-0' },
    );
    expect(result.status).toBe('rejected');
    expect(result).toMatchObject({ failedOpIndex: 2 });
    expect((result as { reason: string }).reason).toContain('unknown skill id');
    expect(await fingerprint(storage)).toBe(snapshotsBefore);
    expect(await repo.getSnapshot('K-1')).toBeUndefined();
  });

  it('rejects an unknown skill id on skill.retire at index 0', async () => {
    const storage = backend.create();
    const { repo } = await seedWorld(storage);
    await repo.snapshot();
    const result = await repo.applyRevision(
      makeRevision('revision-unknown', 'K-0', [{ op: 'skill.retire', id: 'skill-nope' as SkillId, reason: 'x' }]),
      { expectedSnapshotId: 'K-0' },
    );
    expect(result).toMatchObject({ status: 'rejected', failedOpIndex: 0 });
  });

  it('rejects invalid skill content such as uncertainty above 1', async () => {
    const storage = backend.create();
    const { repo } = await seedWorld(storage);
    await repo.snapshot();
    const result = await repo.applyRevision(
      makeRevision('revision-range', 'K-0', [{ op: 'skill.add', skill: skillInput('skill-z', { uncertainty: 1.5 }) }]),
      { expectedSnapshotId: 'K-0' },
    );
    expect(result).toMatchObject({ status: 'rejected', failedOpIndex: 0 });
    expect((result as { reason: string }).reason).toContain('uncertainty');
  });

  it('two revisions on the same base: one applies, one gets conflict (concurrent)', async () => {
    const storage = backend.create();
    const { repo } = await seedWorld(storage);
    await repo.snapshot();
    const [first, second] = await Promise.all([
      repo.applyRevision(makeRevision('revision-r1', 'K-0', [{ op: 'skill.add', skill: skillInput('skill-r1') }]), { expectedSnapshotId: 'K-0' }),
      repo.applyRevision(makeRevision('revision-r2', 'K-0', [{ op: 'skill.add', skill: skillInput('skill-r2') }]), { expectedSnapshotId: 'K-0' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['applied', 'conflict']);
    const conflict = first.status === 'conflict' ? first : second;
    expect(conflict).toEqual({ status: 'conflict', currentSnapshotId: 'K-1' });
  });

  it('an unknown expectedSnapshotId is a conflict', async () => {
    const storage = backend.create();
    const { repo } = await seedWorld(storage);
    await repo.snapshot();
    const result = await repo.applyRevision(makeRevision('revision-u', 'K-9', []), { expectedSnapshotId: 'K-9' });
    expect(result).toEqual({ status: 'conflict', currentSnapshotId: 'K-0' });
  });
});
