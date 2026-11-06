/**
 * Recursa write path: SkillManager / InstructionSetManager / KnowledgeRepository
 * write through EntityManager (governance hooks run), SkillManager emits
 * skill:* events, publish records `publishedHash`, absorb marks
 * `lineage.producedBy = 'manual'`, and the token multiplier default reads
 * MEMORY_CONTEXT_TOKEN_MULTIPLIER. Runs on JSONL and SQLite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SkillManager, type AddSkillInput } from '../../../../src/agent/skills/SkillManager.js';
import { SkillPublisher, SKILL_MARKER_FILE } from '../../../../src/agent/skills/SkillPublisher.js';
import { InstructionSetManager } from '../../../../src/agent/knowledge/InstructionSetManager.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import type { GraphStorage } from '../../../../src/core/GraphStorage.js';
import { GovernanceError } from '../../../../src/features/GovernanceManager.js';
import type { GraphEvent, IGraphStorage } from '../../../../src/types/types.js';
import { makeTempDir, withBothBackends } from '../../../helpers/tempStorage.js';

const SKILL: AddSkillInput = {
  name: 'Release notes',
  description: 'Use when writing release notes',
  kind: 'convention',
  scope: { domains: ['release'] },
  uncertainty: 0.2,
  body: '## Rules\nBe brief.',
};

withBothBackends('Recursa write path', (backend) => {
  let storage: IGraphStorage;
  let entityManager: EntityManager;
  const savedMultiplier = process.env.MEMORY_CONTEXT_TOKEN_MULTIPLIER;

  beforeEach(() => {
    storage = backend.create();
    entityManager = new EntityManager(storage as unknown as GraphStorage);
  });

  afterEach(() => {
    if (savedMultiplier === undefined) delete process.env.MEMORY_CONTEXT_TOKEN_MULTIPLIER;
    else process.env.MEMORY_CONTEXT_TOKEN_MULTIPLIER = savedMultiplier;
  });

  it('emits skill:added, skill:updated and skill:retired after each committed write', async () => {
    const seen: GraphEvent[] = [];
    storage.events?.onAny((event) => {
      if (event.type.startsWith('skill:')) seen.push(event);
    });
    const skills = new SkillManager(storage, entityManager);
    const id = await skills.add(SKILL);
    await skills.recordOutcome(id, 'helped');
    await skills.retire(id, 'obsolete');
    expect(seen.map((e) => e.type)).toEqual(['skill:added', 'skill:updated', 'skill:retired']);
    expect(seen.every((e) => 'skillId' in e && e.skillId === id)).toBe(true);
  });

  it('runs governance hooks: a denied update leaves the skill unchanged', async () => {
    const skills = new SkillManager(storage, entityManager);
    const id = await skills.add(SKILL);
    entityManager.setGovernanceHooks({ canUpdate: () => false });
    await expect(skills.update(id, { description: 'changed' }, { expectedVersion: 1 })).rejects.toBeInstanceOf(
      GovernanceError,
    );
    expect(skills.get(id)?.description).toBe(SKILL.description);
  });

  it('runs governance hooks on create for skills and instruction sets', async () => {
    entityManager.setGovernanceHooks({ canCreate: () => false });
    await expect(new SkillManager(storage, entityManager).add(SKILL)).rejects.toBeInstanceOf(GovernanceError);
    await expect(
      new InstructionSetManager(storage, { entityManager }).add({ role: 'solver' }),
    ).rejects.toBeInstanceOf(GovernanceError);
  });

  it('bumps the version once per OCC instruction patch and rejects a stale version', async () => {
    const sets = new InstructionSetManager(storage, { entityManager });
    const id = await sets.add({ role: 'solver' });
    expect(await sets.patchSection(id, 'Goal', 'Answer.', [], { expectedVersion: 1 })).toBe('updated');
    expect(storage.getEntityByName(id)?.version).toBe(2);
    expect(await sets.patchSection(id, 'Goal', 'Stale.', [], { expectedVersion: 1 })).toBe('version-conflict');
    expect(await sets.patchSection(id, 'Goal', 'Unversioned.', [])).toBe('updated');
    expect(storage.getEntityByName(id)?.version).toBe(3);
  });

  it('stores publishedHash on publish and marks an absorbed edit producedBy manual', async () => {
    const skills = new SkillManager(storage, entityManager);
    const publisher = new SkillPublisher(storage, skills);
    const id = await skills.add(SKILL);
    const dir = join(makeTempDir('skill-write-path-'), 'tree');
    const result = await publisher.publish(dir);
    expect(skills.get(id)?.publishedHash).toBe(result.marker.skills[id]);
    expect(skills.get(id)?.lineage.producedBy).toBeUndefined();

    const file = join(dir, id, 'SKILL.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Be brief.', 'Be very brief.'), 'utf8');
    const report = await publisher.importSkills(dir);
    expect(report.absorbed).toEqual([id]);
    expect(skills.get(id)?.lineage.producedBy).toBe('manual');
    const marker = JSON.parse(readFileSync(join(dir, SKILL_MARKER_FILE), 'utf8')) as {
      skills: Record<string, string>;
    };
    expect(skills.get(id)?.publishedHash).toBe(marker.skills[id]);
  });

  it('render reads the default multiplier from MEMORY_CONTEXT_TOKEN_MULTIPLIER', async () => {
    const sets = new InstructionSetManager(storage, { entityManager });
    const id = await sets.add({ role: 'solver' });
    await sets.patchSection(id, 'Goal', 'one two three four five six seven eight nine ten', []);
    const budget = 20;
    process.env.MEMORY_CONTEXT_TOKEN_MULTIPLIER = '1';
    expect(await sets.render('solver', { budgetTokens: budget })).toContain('Goal');
    process.env.MEMORY_CONTEXT_TOKEN_MULTIPLIER = '10';
    expect(await sets.render('solver', { budgetTokens: budget })).not.toContain('Goal');
    expect(await sets.render('solver', { budgetTokens: budget, multiplier: 1 })).toContain('Goal');
  });
});

describe('SkillManager default write path', () => {
  it('constructs its own EntityManager when none is passed', () => {
    expect(() => new SkillManager({} as IGraphStorage)).not.toThrow();
  });
});
